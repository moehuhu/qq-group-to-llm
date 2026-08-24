import { Context, Service } from 'koishi'
import { load } from 'js-yaml'
import type { Config } from './config'
import type { AnalysisContext, GoldenQuote, SummaryTopic } from './types'

/** 提示词占位符的统一填充 */
function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  )
}

export class LLMService extends Service {
  static inject = ['http']

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'qqGroupLlm', true)
  }

  /** 调用 OpenAI 兼容接口，返回原始文本 */
  private async chat(prompt: string, task: string): Promise<string> {
    if (!this.config.openaiApiKey) {
      throw new Error('未配置 API Key，请在插件配置中填写 openaiApiKey。')
    }

    const url = `${this.config.openaiEndpoint.replace(/\/+$/, '')}/chat/completions`
    this.ctx.logger.debug(`调用 LLM 进行${task}，模型 ${this.config.openaiModel}`)

    const response = await this.ctx.http.post(url, {
      model: this.config.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.config.temperature,
    }, {
      headers: {
        Authorization: `Bearer ${this.config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
    })

    const content = response?.choices?.[0]?.message?.content
    if (!content) {
      this.ctx.logger.error(`${task}返回空响应:`, JSON.stringify(response))
      throw new Error(`LLM 返回空响应（${task}）`)
    }
    return content
  }

  /** 调用并解析 markdown 代码块中的 YAML */
  private async chatYaml<T>(prompt: string, task: string): Promise<T[]> {
    const raw = await this.chat(prompt, task)
    const match = raw.match(/```ya?ml\s*([\s\S]*?)\s*```/)
    if (!match) {
      this.ctx.logger.warn(`${task}未返回 YAML 代码块，原始响应: ${raw.slice(0, 200)}`)
      throw new Error(`LLM 未按格式返回结果（${task}）`)
    }
    const data = load(match[1]) as T | T[]
    if (!data) return []
    return Array.isArray(data) ? data : [data]
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
