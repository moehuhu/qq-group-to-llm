import { Context, Service } from 'koishi'
import { load } from 'js-yaml'
import type { Config } from '../config'
import { logger } from '../logger'
import type { AnalysisContext, GoldenQuote, SummaryTopic, UserPersonaProfile } from '../types'
import { extractYaml, fill, findLeftovers, formatUsage } from './prompt'

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
    const leftovers = findLeftovers(prompt)
    if (leftovers.length) {
      this.log.warn(`[${task}] 提示词存在未替换的占位符: ${leftovers.join(' ')}`)
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
      this.log.error(`[${task}] 返回空响应（耗时 ${elapsed}ms），完整响应体:\n${JSON.stringify(response, null, 2)}`)
      throw new Error(`LLM 返回空响应（${task}）`)
    }

    this.log.info(`[${task}] 完成，耗时 ${elapsed}ms，响应 ${content.length} 字，${formatUsage(response.usage)}`)
    this.log.info(`[${task}] 完整响应:\n${content}`)

    return content
  }

  /** 调用并解析 markdown 代码块中的 YAML */
  private async chatYaml<T>(prompt: string, task: string): Promise<T[]> {
    const raw = await this.chat(prompt, task)
    const yaml = extractYaml(raw)
    if (yaml === null) {
      this.log.warn(`[${task}] 未返回 YAML 代码块，完整响应:\n${raw}`)
      throw new Error(`LLM 未按格式返回结果（${task}）`)
    }

    let data: T | T[]
    try {
      data = load(yaml) as T | T[]
    } catch (error) {
      this.log.error(`[${task}] YAML 解析失败，完整 YAML:\n${yaml}`)
      throw error
    }

    if (!data) {
      this.log.warn(`[${task}] YAML 解析结果为空`)
      return []
    }
    const list = Array.isArray(data) ? data : [data]
    this.log.info(`[${task}] 解析出 ${list.length} 条结果:\n${JSON.stringify(list, null, 2)}`)
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
   * 生成用户画像。每次都只依据传入的聊天记录重新生成，不参考已有结论。
   * 返回 null 表示模型没有给出可用结果。
   */
  async analyzeUserPersona(input: {
    userId: string
    username: string
    messages: string
  }): Promise<UserPersonaProfile | null> {
    const profiles = await this.chatYaml<UserPersonaProfile>(fill(this.config.promptUserPersona, {
      messages: input.messages,
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
