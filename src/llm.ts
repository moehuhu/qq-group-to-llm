import { Context, Service } from 'koishi'
import { load } from 'js-yaml'
import type { Config } from './config'
import { logger } from './logger'
import type { AnalysisContext, GoldenQuote, SummaryTopic, UserPersonaProfile } from './types'

/** 提示词占位符的统一填充 */
function fill(template: string, values: Record<string, string>): string {
  const filled = Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  )
  return filled
}

export class LLMService extends Service {
  static inject = ['http']

  private readonly log: ReturnType<typeof logger>

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'qqGroupLlm', true)
    this.log = logger(ctx)
  }

  /** 调用 OpenAI 兼容接口，返回原始文本 */
  private async chat(prompt: string, task: string): Promise<string> {
    if (!this.config.openaiApiKey) {
      throw new Error('未配置 API Key，请在插件配置中填写 openaiApiKey。')
    }

    const url = `${this.config.openaiEndpoint.replace(/\/+$/, '')}/chat/completions`
    const leftovers = prompt.match(/\{[a-zA-Z]\w*\}/g)
    if (leftovers?.length) {
      this.log.warn(`[${task}] 提示词存在未替换的占位符: ${[...new Set(leftovers)].join(' ')}`)
    }

    this.log.info(`[${task}] 请求 ${this.config.openaiModel}，提示词 ${prompt.length} 字，temperature=${this.config.temperature}`)
    this.log.debug(`[${task}] 完整提示词:\n${prompt}`)

    const startedAt = Date.now()
    let response: any
    try {
      response = await this.ctx.http.post(url, {
        model: this.config.openaiModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature,
      }, {
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
      })
    } catch (error) {
      this.log.error(`[${task}] 请求失败（耗时 ${Date.now() - startedAt}ms，${url}）:`, error)
      throw error
    }

    const elapsed = Date.now() - startedAt
    const content = response?.choices?.[0]?.message?.content
    if (!content) {
      this.log.error(`[${task}] 返回空响应（耗时 ${elapsed}ms）:`, JSON.stringify(response)?.slice(0, 500))
      throw new Error(`LLM 返回空响应（${task}）`)
    }

    const usage = response.usage
    const tokens = usage
      ? `tokens ${usage.prompt_tokens ?? '?'}+${usage.completion_tokens ?? '?'}=${usage.total_tokens ?? '?'}`
      : 'tokens 未返回'
    this.log.info(`[${task}] 完成，耗时 ${elapsed}ms，响应 ${content.length} 字，${tokens}`)
    this.log.debug(`[${task}] 完整响应:\n${content}`)

    return content
  }

  /** 调用并解析 markdown 代码块中的 YAML */
  private async chatYaml<T>(prompt: string, task: string): Promise<T[]> {
    const raw = await this.chat(prompt, task)
    const match = raw.match(/```ya?ml\s*([\s\S]*?)\s*```/)
    if (!match) {
      this.log.warn(`[${task}] 未返回 YAML 代码块，原始响应: ${raw.slice(0, 300)}`)
      throw new Error(`LLM 未按格式返回结果（${task}）`)
    }

    let data: T | T[]
    try {
      data = load(match[1]) as T | T[]
    } catch (error) {
      this.log.error(`[${task}] YAML 解析失败，内容:\n${match[1].slice(0, 500)}`)
      throw error
    }

    if (!data) {
      this.log.warn(`[${task}] YAML 解析结果为空`)
      return []
    }
    const list = Array.isArray(data) ? data : [data]
    this.log.debug(`[${task}] 解析出 ${list.length} 条结果`)
    return list
  }

  async summarizeTopics(messages: string, context: AnalysisContext): Promise<SummaryTopic[]> {
    return this.chatYaml<SummaryTopic>(fill(this.config.promptTopic, {
      ...context,
      messages,
      maxTopics: String(this.config.maxTopics),
    }), '话题总结')
  }

  async analyzeGoldenQuotes(messages: string, context: AnalysisContext): Promise<GoldenQuote[]> {
    return this.chatYaml<GoldenQuote>(fill(this.config.promptGoldenQuotes, {
      ...context,
      messages,
      maxGoldenQuotes: String(this.config.maxGoldenQuotes),
    }), '金句提取')
  }

  /**
   * 生成用户画像。传入历史画像时，模型会在其基础上迭代而非推倒重来。
   * 返回 null 表示模型没有给出可用结果。
   */
  async analyzeUserPersona(input: {
    userId: string
    username: string
    messages: string
    previousAnalysis: string
  }): Promise<UserPersonaProfile | null> {
    const profiles = await this.chatYaml<UserPersonaProfile>(fill(this.config.promptUserPersona, {
      messages: input.messages,
      previousAnalysis: input.previousAnalysis,
      userId: input.userId,
      username: input.username,
      lookbackDays: String(this.config.personaLookbackDays),
    }), '用户画像')

    const profile = profiles[0]
    if (!profile?.summary) {
      this.log.warn(`[用户画像] ${input.username}(${input.userId}) 的结果缺少 summary 字段，视为无效`)
      return null
    }
    return { ...profile, userId: input.userId, username: input.username }
  }

  /** 自然语言问答，返回纯文本 */
  async answerQuery(messages: string, context: AnalysisContext): Promise<string> {
    return this.chat(fill(this.config.promptQuery, { ...context, messages }), '群聊问答')
  }
}

declare module 'koishi' {
  interface Context {
    qqGroupLlm: LLMService
  }
}
