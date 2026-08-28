import { Context, Service } from 'koishi'
import { load } from 'js-yaml'
import type { Config } from '../config'
import { logger } from '../logger'
import type { AnalysisContext, GoldenQuote, HighlightDialogue, SummaryTopic, UserPersonaProfile } from '../types'
import {
  describeError, extractYaml, fill, findLeftovers, formatUsage, isRetryable, repairYaml,
} from './prompt'

export class LLMService extends Service {
  static inject = ['http']

  private readonly log: ReturnType<typeof logger>

  /** 当前在飞的请求数 */
  private active = 0
  /** 等待名额的请求，先到先得 */
  private waiting: Array<() => void> = []

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'qqGroupLlm', true)
    this.log = logger(ctx)
  }

  private get limit(): number {
    return Math.max(1, this.config.llmConcurrency)
  }

  /** 取一个并发名额，名额满了就排队等 */
  private async acquire(name: string): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return
    }
    this.log.info(`[${name}] 已有 ${this.active} 个请求在飞（上限 ${this.limit}），排队等待`)
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    // 名额由 release 直接转交，这里不再自增，否则会超发
  }

  /** 交还名额：有人在等就直接把名额转给他，避免中间出现空档被别人抢走 */
  private release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.active--
  }

  /**
   * 并发闸门。接口扛不住太多并发请求，同时打过去会失败，
   * 因此在飞数量始终不超过 llmConcurrency。
   * release 放在 finally 里：请求失败也必须还名额，否则会把后面的全饿死。
   */
  private async enqueue<T>(task: () => Promise<T>, name: string): Promise<T> {
    await this.acquire(name)
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  /** 调用 OpenAI 兼容接口，返回原始文本。经并发闸门限流，失败按需重试 */
  private chat(prompt: string, task: string): Promise<string> {
    return this.enqueue(() => this.requestWithRetry(prompt, task), task)
  }

  /**
   * 带重试的请求。超时、连接抖动、429/5xx 都值得重发一次；
   * 鉴权失败、请求格式错误重试多少遍都一样，直接抛出去。
   * 重试在并发名额内进行，退避期间不释放名额——退避很短，
   * 放掉名额再抢回来反而可能被别的请求插队、越等越久。
   */
  private async requestWithRetry(prompt: string, task: string): Promise<string> {
    const total = Math.max(0, this.config.llmRetries)
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(prompt, task)
      } catch (error) {
        if (attempt >= total || !isRetryable(error)) throw error
        const delay = 1000 * 2 ** attempt
        this.log.warn(`[${task}] 第 ${attempt + 1}/${total + 1} 次尝试失败（${describeError(error)}），` +
          `${delay}ms 后重试`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async request(prompt: string, task: string): Promise<string> {
    if (!this.config.openaiApiKey) {
      throw new Error('未配置 API Key，请在插件配置中填写 openaiApiKey。')
    }

    const url = `${this.config.openaiEndpoint.replace(/\/+$/, '')}/chat/completions`
    const leftovers = findLeftovers(prompt)
    if (leftovers.length) {
      this.log.warn(`[${task}] 提示词存在未替换的占位符: ${leftovers.join(' ')}`)
    }

    const stream = this.config.llmStream
    this.log.info(`[${task}] 请求 ${this.config.openaiModel}，提示词 ${prompt.length} 字，` +
      `temperature=${this.config.temperature}，${stream ? '流式' : '非流式'}`)
    this.log.debug(`[${task}] 完整提示词:\n${prompt}`)

    const payload: Record<string, unknown> = {
      model: this.config.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: this.config.temperature,
    }
    if (stream) {
      payload.stream = true
      // 用量只在最后一个分片里给，不要就统计不到 token
      payload.stream_options = { include_usage: true }
    }
    const headers = {
      Authorization: `Bearer ${this.config.openaiApiKey}`,
      'Content-Type': 'application/json',
    }

    const startedAt = Date.now()
    let content: string
    let usage: any
    try {
      if (stream) {
        const collected = await this.ctx.http.post(url, payload, {
          headers,
          // 拿原始 Response 自己读流；responseType 传函数时 cordis 会把它当解码器
          responseType: (raw: Response) => this.readStream(raw, task, startedAt),
        })
        content = collected.content
        usage = collected.usage
      } else {
        const response: any = await this.ctx.http.post(url, payload, { headers })
        content = response?.choices?.[0]?.message?.content
        usage = response?.usage
        if (!content) {
          this.log.error(`[${task}] 返回空响应（耗时 ${Date.now() - startedAt}ms），完整响应体:\n` +
            JSON.stringify(response, null, 2))
          throw new Error(`LLM 返回空响应（${task}）`)
        }
      }
    } catch (error) {
      this.log.error(`[${task}] 请求失败（耗时 ${Date.now() - startedAt}ms，${url}）: ` +
        `${describeError(error)}`, error)
      throw error
    }

    const elapsed = Date.now() - startedAt
    if (!content) {
      this.log.error(`[${task}] 流式响应没有任何内容分片（耗时 ${elapsed}ms）`)
      throw new Error(`LLM 返回空响应（${task}）`)
    }

    this.log.info(`[${task}] 完成，耗时 ${elapsed}ms，响应 ${content.length} 字，${formatUsage(usage)}`)
    this.log.info(`[${task}] 完整响应:\n${content}`)

    return content
  }

  /**
   * 读取 SSE 流并拼回完整文本。
   *
   * 流式是这里的关键：非流式时服务端要等整段生成完才发响应头，
   * 长提示词很容易撞上 undici 那 5 分钟的 headersTimeout，
   * 报一个 UND_ERR_HEADERS_TIMEOUT 就没了。流式下响应头秒回，
   * 之后只要分片不断，就不会再触发超时。
   */
  private async readStream(
    raw: Response,
    task: string,
    startedAt: number,
  ): Promise<{ content: string; usage?: any }> {
    if (!raw.body) throw new Error(`LLM 未返回响应体（${task}）`)

    const reader = raw.body.getReader()
    const decoder = new TextDecoder()
    const parts: string[] = []
    let usage: any
    let buffer = ''
    let firstChunkAt = 0

    // 每秒输出一次进度：当前已输出字数 + 输出速度（字/秒）
    let chars = 0
    let speedBaseAt = startedAt
    let speedBaseChars = 0
    const progress = setInterval(() => {
      const now = Date.now()
      const elapsed = now - speedBaseAt
      const speed = elapsed > 0 ? (chars - speedBaseChars) / (elapsed / 1000) : 0
      this.log.info(`[${task}] 流式进度：已输出 ${chars} 字，速度 ${speed.toFixed(1)} 字/秒`)
      speedBaseAt = now
      speedBaseChars = chars
    }, 1000)

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let index: number
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (!line.startsWith('data:')) continue

          const payload = line.slice(5).trim()
          if (payload === '[DONE]') return { content: parts.join(''), usage }

          let chunk: any
          try {
            chunk = JSON.parse(payload)
          } catch {
            // 心跳或被截断的行，跳过即可
            continue
          }
          // 厂商可能把错误塞在流里，这时不会有 [DONE]
          if (chunk?.error) {
            throw new Error(`LLM 返回错误: ${JSON.stringify(chunk.error)}`)
          }
          const delta = chunk?.choices?.[0]?.delta?.content
          if (delta) {
            if (!firstChunkAt) {
              firstChunkAt = Date.now()
              this.log.debug(`[${task}] 首个分片到达，耗时 ${firstChunkAt - startedAt}ms`)
            }
            parts.push(delta)
            chars += delta.length
          }
          if (chunk?.usage) usage = chunk.usage
        }
      }
    } finally {
      clearInterval(progress)
      reader.cancel().catch(() => {})
    }

    return { content: parts.join(''), usage }
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
      // 缩进、列表标记这类格式毛病模型偶尔会犯，先修一遍再试
      const repaired = repairYaml(yaml)
      let recovered: T | T[] | undefined
      if (repaired !== yaml) {
        try {
          recovered = load(repaired) as T | T[]
        } catch {
          // 修完还是解析不了，说明坏在别处，按原始错误报出去
        }
      }
      if (recovered === undefined) {
        this.log.error(`[${task}] YAML 解析失败，完整 YAML:\n${yaml}`)
        throw error
      }
      this.log.warn(`[${task}] YAML 格式有误，已自动修正后解析成功。原始 YAML:\n${yaml}`)
      data = recovered
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

  /** 挑选单句成立的金句。kind 由调用方规整时补上，不要求模型返回 */
  async analyzeGoldenQuotes(messages: string, context: AnalysisContext): Promise<Omit<GoldenQuote, 'kind'>[]> {
    return this.chatYaml<Omit<GoldenQuote, 'kind'>>(fill(this.config.promptGoldenQuotes, {
      ...context,
      messages,
      maxGoldenQuotes: String(this.config.maxGoldenQuotes),
    }), '金句提取')
  }

  /** 截取带学术要素的冷幽默对话片段，模型认为没有符合条件的片段时返回空数组 */
  async analyzeHighlightDialogues(
    messages: string,
    context: AnalysisContext,
  ): Promise<Omit<HighlightDialogue, 'kind'>[]> {
    return this.chatYaml<Omit<HighlightDialogue, 'kind'>>(fill(this.config.promptHighlightDialogues, {
      ...context,
      messages,
      maxHighlightDialogues: String(this.config.maxHighlightDialogues),
      maxHighlightLines: String(this.config.maxHighlightLines),
    }), '高光对话')
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
