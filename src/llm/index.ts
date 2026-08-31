import { Context, Service } from 'koishi'
import type { Config, LLMModelConfig } from '../config'
import { logger } from '../logger'
import type { AnalysisContext, GroupSummary, HighlightDialogue, QueryAnswer, UserPersonaProfile } from '../types'
import {
  describeError, extractJson, fill, findLeftovers, formatUsage, isRetryable, repairJson,
} from './prompt'

/** 插件提供的所有 LLM 任务 */
export type LLMTaskId =
  | 'topic'
  | 'highlightDialogues'
  | 'query'
  | 'userPersona'

/** 任务 → 指定模型用的配置字段名 */
const TASK_MODEL_FIELD: Record<LLMTaskId, keyof Config> = {
  topic: 'llmModelTopic',
  highlightDialogues: 'llmModelHighlightDialogues',
  query: 'llmModelQuery',
  userPersona: 'llmModelUserPersona',
}

/** 任务 → 日志里用的名字 */
const TASK_NAMES: Record<LLMTaskId, string> = {
  topic: '群分析',
  highlightDialogues: '高光对话',
  query: '群聊问答',
  userPersona: '用户画像',
}

export class LLMService extends Service {
  static inject = ['http']

  private readonly log: ReturnType<typeof logger>

  /** 各模型当前在飞的请求数 */
  private readonly active = new Map<string, number>()
  /** 各模型等待名额的请求，先到先得 */
  private readonly waiting = new Map<string, Array<() => void>>()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'qqGroupLlm', true)
    this.log = logger(ctx)
  }

  /** 某模型的并发上限：取自命名模型自己的配置 */
  private limitOf(model: LLMModelConfig): number {
    return Math.max(1, model.concurrency)
  }

  /**
   * 按任务解析出它使用的模型。
   * 先从命名模型列表里按配置的 id 找；id 留空、填 default 或找不到时回落到列表第一个。
   */
  private resolveModel(taskId: LLMTaskId): LLMModelConfig {
    const configField = TASK_MODEL_FIELD[taskId]
    const target = this.config[configField] as string
    const named = this.config.llmModels.find((item) => item.id === target)
    if (named) return named
    const fallback = this.config.llmModels[0]
    if (!fallback) {
      throw new Error(`未配置任何命名模型，请先在插件配置的「LLM 接口 → 命名模型」中至少填一个。`)
    }
    if (target && target !== 'default') {
      this.log.warn(`[${TASK_NAMES[taskId]}] 配置的模型 id「${target}」不在命名模型列表中，回落到「${fallback.id}」`)
    }
    return fallback
  }

  /**
   * 取一个并发名额，名额满了就排队等。
   * 每个模型各有一道独立闸门，配额互不相干：
   * 一个模型在排队不会占掉另一个模型的在飞数，各自只受各自的上限约束。
   */
  private async acquire(model: LLMModelConfig, name: string): Promise<void> {
    const limit = this.limitOf(model)
    const active = this.active.get(model.id) ?? 0
    if (active < limit) {
      this.active.set(model.id, active + 1)
      return
    }
    this.log.info(`[${name}] 模型「${model.id}」已有 ${active} 个请求在飞（上限 ${limit}），排队等待`)
    let queue = this.waiting.get(model.id)
    if (!queue) {
      queue = []
      this.waiting.set(model.id, queue)
    }
    await new Promise<void>((resolve) => queue.push(resolve))
    // 名额由 release 直接转交，这里不再自增，否则会超发
  }

  /** 交还名额：有人在等就直接把名额转给他，避免中间出现空档被别人抢走 */
  private release(model: LLMModelConfig): void {
    const queue = this.waiting.get(model.id)
    const next = queue?.shift()
    if (next) next()
    else {
      const active = (this.active.get(model.id) ?? 1) - 1
      if (active > 0) this.active.set(model.id, active)
      else this.active.delete(model.id)
    }
  }

  /**
   * 并发闸门。接口扛不住太多并发请求，同时打过去会失败，
   * 因此各模型在飞数量始终不超过该模型配置里的 concurrency。
   * release 放在 finally 里：请求失败也必须还名额，否则会把后面的全饿死。
   */
  private async enqueue<T>(model: LLMModelConfig, task: () => Promise<T>, name: string): Promise<T> {
    await this.acquire(model, name)
    try {
      return await task()
    } finally {
      this.release(model)
    }
  }

  /** 调用 OpenAI 兼容接口，返回原始文本。经并发闸门限流，失败按需重试 */
  private chat(taskId: LLMTaskId, prompt: string): Promise<string> {
    const task = TASK_NAMES[taskId]
    const model = this.resolveModel(taskId)
    return this.enqueue(model, () => this.requestWithRetry(model, prompt, task), task)
  }

  /**
   * 带重试的请求。超时、连接抖动、429/5xx 都值得重发一次；
   * 鉴权失败、请求格式错误重试多少遍都一样，直接抛出去。
   * 重试在并发名额内进行，退避期间不释放名额——退避很短，
   * 放掉名额再抢回来反而可能被别的请求插队、越等越久。
   */
  private async requestWithRetry(model: LLMModelConfig, prompt: string, task: string): Promise<string> {
    const total = Math.max(0, this.config.llmRetries)
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(model, prompt, task)
      } catch (error) {
        if (attempt >= total || !isRetryable(error)) throw error
        const delay = 1000 * 2 ** attempt
        this.log.warn(`[${task}] 第 ${attempt + 1}/${total + 1} 次尝试失败（${describeError(error)}），` +
          `${delay}ms 后重试`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async request(model: LLMModelConfig, prompt: string, task: string): Promise<string> {
    if (!model.apiKey) {
      throw new Error(`模型「${model.id}」未配置 API Key，请在插件配置的「LLM 接口 → 命名模型」中填写。`)
    }

    const url = `${model.endpoint.replace(/\/+$/, '')}/chat/completions`
    const leftovers = findLeftovers(prompt)
    if (leftovers.length) {
      this.log.warn(`[${task}] 提示词存在未替换的占位符: ${leftovers.join(' ')}`)
    }

    const stream = this.config.llmStream
    this.log.info(`[${task}] 请求 ${model.model} @ ${model.endpoint}，提示词 ${prompt.length} 字，` +
      `temperature=${model.temperature}，${stream ? '流式' : '非流式'}`)
    this.log.debug(`[${task}] 完整提示词:\n${prompt}`)

    const payload: Record<string, unknown> = {
      model: model.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: model.temperature,
    }
    if (stream) {
      payload.stream = true
      // 用量只在最后一个分片里给，不要就统计不到 token
      payload.stream_options = { include_usage: true }
    }
    const headers = {
      Authorization: `Bearer ${model.apiKey}`,
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

    // 每 120 秒输出一次进度：当前已输出字数 + 输出速度（字/秒）+ 段落开头 100 字
    let chars = 0
    let speedBaseAt = startedAt
    let speedBaseChars = 0
    let preview = ''
    const progress = setInterval(() => {
      const now = Date.now()
      const elapsed = now - speedBaseAt
      const speed = elapsed > 0 ? (chars - speedBaseChars) / (elapsed / 1000) : 0
      const head = preview.slice(0, 100).replace(/\s+/g, ' ').trim()
      this.log.info(`[${task}] 流式进度：已输出 ${chars} 字，速度 ${speed.toFixed(1)} 字/秒` +
        (head ? `，段落开头 100 字：${head}` : ''))
      speedBaseAt = now
      speedBaseChars = chars
    }, 120000)

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
            // 只攒前 100 字用于进度预览，避免重复拼接全部内容
            if (preview.length < 100) preview += delta.slice(0, 100 - preview.length)
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

  /** 调用并解析 markdown 代码块中的 JSON */
  private async chatJson<T>(taskId: LLMTaskId, prompt: string): Promise<T[]> {
    const task = TASK_NAMES[taskId]
    const raw = await this.chat(taskId, prompt)
    const json = extractJson(raw)
    if (json === null) {
      this.log.warn(`[${task}] 未返回 JSON 代码块，完整响应:\n${raw}`)
      throw new Error(`LLM 未按格式返回结果（${task}）`)
    }

    let data: T | T[]
    try {
      data = JSON.parse(json) as T | T[]
    } catch (error) {
      // 注释、单引号、尾逗号这类格式毛病模型偶尔会犯，先修一遍再试
      const repaired = repairJson(json)
      let recovered: T | T[] | undefined
      if (repaired !== json) {
        try {
          recovered = JSON.parse(repaired) as T | T[]
        } catch {
          // 修完还是解析不了，说明坏在别处，按原始错误报出去
        }
      }
      if (recovered === undefined) {
        this.log.error(`[${task}] JSON 解析失败，完整 JSON:\n${json}`)
        throw error
      }
      this.log.warn(`[${task}] JSON 格式有误，已自动修正后解析成功。原始 JSON:\n${json}`)
      data = recovered
    }

    if (!data) {
      this.log.warn(`[${task}] JSON 解析结果为空`)
      return []
    }
    const list = Array.isArray(data) ? data : [data]
    this.log.info(`[${task}] 解析出 ${list.length} 条结果:\n${JSON.stringify(list, null, 2)}`)
    return list
  }

  /**
   * 话题与金句在同一次请求里返回。投喂的消息只有一份（无法再按任务分开屏蔽），
   * 返回的金句与话题都基于同一份记录。模型没返回 quotes 字段时按空数组处理。
   */
  async analyzeGroupSummary(messages: string, context: AnalysisContext): Promise<GroupSummary> {
    const results = await this.chatJson<GroupSummary>('topic', fill(this.config.promptTopic, {
      ...context,
      messages,
      maxTopics: String(this.config.maxTopics),
      maxGoldenQuotes: String(this.config.maxGoldenQuotes),
    }))
    const result = results[0]
    return {
      topics: Array.isArray(result?.topics) ? result.topics : [],
      quotes: Array.isArray(result?.quotes) ? result.quotes : [],
    }
  }

  /**
   * 截取带学术要素的冷幽默对话片段。
   * 模型直接返回每轮的发送者昵称与发言原文，原文不再按 id 回查。
   * 模型认为没有符合条件的片段时返回空数组。
   */
  async analyzeHighlightDialogues(
    messages: string,
    context: AnalysisContext,
  ): Promise<HighlightDialogue[]> {
    return this.chatJson<HighlightDialogue>('highlightDialogues', fill(this.config.promptHighlightDialogues, {
      ...context,
      messages,
      maxHighlightDialogues: String(this.config.maxHighlightDialogues),
      maxHighlightLines: String(this.config.maxHighlightLines),
    }))
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
    const profiles = await this.chatJson<UserPersonaProfile>('userPersona', fill(this.config.promptUserPersona, {
      messages: input.messages,
      userId: input.userId,
      username: input.username,
      lookbackDays: String(this.config.personaLookbackDays),
    }))

    const profile = profiles[0]
    if (!profile?.summary) {
      this.log.warn(`[用户画像] ${input.username}(${input.userId}) 的结果缺少 summary 字段，视为无效`)
      return null
    }
    return { ...profile, userId: input.userId, username: input.username }
  }

  /** 自然语言问答。返回回答与所引用的消息（发送者 + 原文），供调用方直接展示 */
  async answerQuery(messages: string, context: AnalysisContext): Promise<QueryAnswer> {
    const results = await this.chatJson<QueryAnswer>('query', fill(this.config.promptQuery, { ...context, messages }))
    const result = results[0]
    if (!result?.answer?.trim()) {
      this.log.warn('[群聊问答] 结果缺少 answer 字段，视为无效')
      return { answer: '' }
    }
    // 引用消息由模型直接照抄发送者与原文，缺 sender 或 content 的直接剔除
    const cited = (Array.isArray(result.cited) ? result.cited : [])
      .map((item) => ({
        sender: String(item?.sender ?? '').trim(),
        content: String(item?.content ?? '').trim(),
      }))
      .filter((item) => item.sender && item.content)
    return { answer: result.answer, cited }
  }
}

declare module 'koishi' {
  interface Context {
    qqGroupLlm: LLMService
  }
}
