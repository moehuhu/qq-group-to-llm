import { Context } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { calculateStats } from './stats'
import { resolveTimeFormatter, type TimeFormatter } from '../time'
import { MessageRecord, TABLE } from '../database'
import type {
  AnalysisContext,
  DialogueDigest,
  GoldenQuote,
  HighlightDialogue,
  GroupAnalysisResult,
  SummaryTopic,
} from '../types'

export interface AnalysisTarget {
  channelId: string
  guildId?: string
  groupName?: string
}


/** 取指定频道最近 days 天的消息，按时间正序返回 */
export async function fetchMessages(
  ctx: Context,
  config: Config,
  target: AnalysisTarget,
  days: number,
): Promise<MessageRecord[]> {
  const log = logger(ctx)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const records = await ctx.database
    .select(TABLE)
    .where({ channelId: target.channelId, timestamp: { $gte: since } })
    .orderBy('timestamp', 'desc')
    .limit(config.maxMessages)
    .execute()

  log.info(`取到频道 ${target.channelId} 最近 ${days} 天的 ${records.length} 条消息` +
    (records.length >= config.maxMessages ? `（已达 maxMessages=${config.maxMessages} 上限，更早的消息被截断）` : ''))
  return records.reverse()
}

/** 剔除被屏蔽用户的发言。空名单时原样返回，不做无谓的拷贝 */
export function excludeUsers(messages: MessageRecord[], blocked: string[]): MessageRecord[] {
  if (!blocked?.length) return messages
  return messages.filter((message) => !message.userId || !blocked.includes(message.userId))
}

/**
 * 收集被屏蔽用户用过的昵称。
 * 模型只认昵称，屏蔽名单填的是用户 ID——两者对不上，
 * 所以还要用昵称在结果里再拦一道：别人转述、或模型张冠李戴时，
 * 光靠「不投喂」是拦不住的。
 */
export function blockedNames(messages: MessageRecord[], blocked: string[]): Set<string> {
  const names = new Set<string>()
  if (!blocked?.length) return names
  for (const message of messages) {
    if (message.userId && blocked.includes(message.userId) && message.username) {
      names.add(message.username)
    }
  }
  return names
}

/** 把消息渲染成投喂给 LLM 的文本 */
export function formatForPrompt(messages: MessageRecord[], time: TimeFormatter): string {
  return messages.map((message) => {
    return `[${time.time(message.timestamp)}] ${message.username || message.userId}: ${message.content}`
  }).join('\n')
}

/** 规整金句：缺原文的直接丢弃 */
export function normalizeQuote(item: Partial<GoldenQuote> | undefined): GoldenQuote | null {
  const content = String(item?.content ?? '').trim()
  if (!content) return null
  return {
    content,
    sender: item?.sender?.trim() || undefined,
    reason: item?.reason?.trim() || undefined,
  }
}

/**
 * 规整模型返回的高光对话：丢掉空轮次、按 maxHighlightLines 截断，
 * 并要求至少两人两轮——只有一个人自说自话的片段不算「对话」。
 * 校验放在截断之后，保证真正渲染出来的那几轮确实构成一段对话。
 *
 * avatars 是「昵称 → 头像地址」的对照表，用来给每轮发言补上头像；
 * 模型只会还原昵称，头像得从原始记录里回查。
 */
export function normalizeDialogue(
  item: Partial<HighlightDialogue> | undefined,
  maxLines: number,
  avatars: Map<string, string> = new Map(),
): HighlightDialogue | null {
  const lines = (Array.isArray(item?.lines) ? item.lines : [])
    .map((line) => {
      const sender = String(line?.sender ?? '').trim()
      return {
        sender,
        content: String(line?.content ?? '').trim(),
        avatar: avatars.get(sender) || undefined,
      }
    })
    .filter((line) => line.content)
    .slice(0, maxLines)

  if (lines.length < 2) return null
  if (new Set(lines.map((line) => line.sender)).size < 2) return null

  return {
    title: item?.title?.trim() || undefined,
    lines,
    reason: item?.reason?.trim() || undefined,
  }
}

function buildContext(
  messages: MessageRecord[],
  target: AnalysisTarget,
  time: TimeFormatter,
  query = '',
): AnalysisContext {
  return {
    groupName: target.groupName || target.guildId || target.channelId,
    timeRange: messages.length
      ? `${time.dateTime(messages[0].timestamp)} ~ ${time.dateTime(messages[messages.length - 1].timestamp)}`
      : '（无记录）',
    currentTime: time.dateTime(new Date()),
    query: query || '（无）',
  }
}

/** 生成完整的群聊分析报告 */
export async function analyzeGroup(
  ctx: Context,
  config: Config,
  messages: MessageRecord[],
  target: AnalysisTarget,
  query = '',
): Promise<GroupAnalysisResult> {
  const log = logger(ctx)
  const startedAt = Date.now()

  // 话题与金句的屏蔽名单是分开的：可以允许某人进话题和活跃榜，但不收他的金句
  const analysisMessages = excludeUsers(messages, config.analysisUserFilter)
  const quoteMessages = excludeUsers(messages, config.quoteUserFilter)
  const blockedQuoteNames = blockedNames(messages, config.quoteUserFilter)
  const hidden = messages.length - analysisMessages.length
  if (hidden) {
    log.info(`群分析屏蔽了 ${config.analysisUserFilter.length} 个用户的 ${hidden} 条发言`)
  }
  if (messages.length !== quoteMessages.length) {
    log.info(`金句屏蔽了 ${messages.length - quoteMessages.length} 条发言`)
  }

  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(analysisMessages, target, time, query)
  const messagesText = formatForPrompt(analysisMessages, time)
  const { userStats, totalChars, mostActivePeriod, hourly } = calculateStats(analysisMessages, time)

  log.info(`开始群分析: ${context.groupName}，${analysisMessages.length} 条消息 / ${userStats.length} 人 / ${messagesText.length} 字，范围 ${context.timeRange}`)

  /** 任一子任务失败不应拖垮整份报告 */
  const settle = async <T>(task: () => Promise<T[]>, name: string): Promise<T[]> => {
    try {
      return await task()
    } catch (error) {
      log.warn(`${name}失败，该部分将留空:`, error)
      return []
    }
  }

  // 两个子任务一起发出，实际同时在飞几个由 LLMService 的并发闸门说了算。
  // 这里不自己再控一层并发——两处各管一半的话，真实并发数就说不清了。
  // 高光对话不在这里抽取，它由独立的「高光对话」命令负责。
  const [topics, quotes] = await Promise.all([
    settle<SummaryTopic>(() => ctx.qqGroupLlm.summarizeTopics(messagesText, context), '话题总结'),
    config.maxGoldenQuotes > 0
      ? settle(() => ctx.qqGroupLlm.analyzeGoldenQuotes(
        formatForPrompt(quoteMessages, time), buildContext(quoteMessages, target, time, query)), '金句提取')
      : Promise.resolve([]),
  ])

  // 模型偶尔会漏字段，缺主键的条目直接丢弃，避免污染报告
  const usableTopics = topics.filter((topic) => topic?.topic)
  const usableQuotes = quotes
    .map((item) => normalizeQuote(item))
    .filter((item): item is GoldenQuote => !!item)
    .filter((quote) => !quote.sender || !blockedQuoteNames.has(quote.sender))
    .slice(0, config.maxGoldenQuotes)
  const dropped = (topics.length - usableTopics.length) + (quotes.length - usableQuotes.length)
  if (dropped) log.warn(`丢弃 ${dropped} 条不合格的 LLM 结果（缺字段或超出条数上限）`)

  log.info(`群分析完成，耗时 ${Date.now() - startedAt}ms，产出 ${usableTopics.length} 个话题 / ` +
    `${usableQuotes.length} 条金句`)

  return {
    groupName: context.groupName,
    timeRange: context.timeRange,
    totalMessages: analysisMessages.length,
    totalChars,
    totalParticipants: userStats.length,
    mostActivePeriod,
    hourly,
    userStats: userStats.slice(0, config.maxUsersInReport),
    topics: usableTopics.slice(0, config.maxTopics),
    quotes: usableQuotes,
  }
}

/**
 * 抽取高光对话。与群分析共用取数与上下文，但独立成命令——
 * 它只跑一次模型，篇幅也和报告差得远，混在报告里会把报告撑得很长。
 */
export async function analyzeDialogues(
  ctx: Context,
  config: Config,
  messages: MessageRecord[],
  target: AnalysisTarget,
): Promise<DialogueDigest> {
  const log = logger(ctx)
  const startedAt = Date.now()

  const usable = excludeUsers(messages, config.dialogueUserFilter)
  const blocked = blockedNames(messages, config.dialogueUserFilter)
  if (messages.length !== usable.length) {
    log.info(`高光对话屏蔽了 ${messages.length - usable.length} 条发言`)
  }

  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time)
  const messagesText = formatForPrompt(usable, time)

  log.info(`开始抽取高光对话: ${context.groupName}，${usable.length} 条消息，范围 ${context.timeRange}`)

  const raw = await ctx.qqGroupLlm.analyzeHighlightDialogues(messagesText, context)

  // 昵称 → 头像。usable 按时间正序，重名时后者胜出，取到的是最近一次的头像
  const avatars = new Map<string, string>()
  for (const message of usable) {
    if (message.username && message.avatar) avatars.set(message.username, message.avatar)
  }

  const dialogues = raw
    .map((item) => normalizeDialogue(item, config.maxHighlightLines, avatars))
    .filter((item): item is HighlightDialogue => !!item)
    // 整段丢弃：抽掉其中一轮，剩下的对话就接不上了
    .filter((item) => !item.lines.some((line) => blocked.has(line.sender)))
    .slice(0, config.maxHighlightDialogues)

  const dropped = raw.length - dialogues.length
  if (dropped) log.warn(`丢弃 ${dropped} 段不合格的对话（缺字段、超出条数上限，或不足两人两轮）`)

  log.info(`高光对话抽取完成，耗时 ${Date.now() - startedAt}ms，产出 ${dialogues.length} 段`)

  return {
    groupName: context.groupName,
    timeRange: context.timeRange,
    totalMessages: usable.length,
    dialogues,
  }
}

/** 自然语言提问 */
export async function answerQuery(
  ctx: Context,
  config: Config,
  messages: MessageRecord[],
  target: AnalysisTarget,
  query: string,
): Promise<string> {
  const log = logger(ctx)
  // 问答是「群分析」命令的一部分，沿用同一份屏蔽名单
  const usable = excludeUsers(messages, config.analysisUserFilter)
  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time, query)
  log.info(`群聊问答: ${context.groupName} 基于 ${usable.length} 条消息，问题「${query}」` +
    (messages.length !== usable.length ? `（屏蔽了 ${messages.length - usable.length} 条）` : ''))
  return ctx.qqGroupLlm.answerQuery(formatForPrompt(usable, time), context)
}
