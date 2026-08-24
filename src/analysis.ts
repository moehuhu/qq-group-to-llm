import { Context } from 'koishi'
import type { Config } from './config'
import { logger } from './logger'
import { MessageRecord, TABLE } from './model'
import type {
  AnalysisContext,
  GoldenQuote,
  GroupAnalysisResult,
  SummaryTopic,
  UserStats,
} from './types'

/** 序列化内容中代表表情/图片、引用的占位符 */
const MEDIA_PATTERN = /\[(图片|face|image|img|sticker|mface)\]/
const QUOTE_PATTERN = /\[引用\]/

export interface AnalysisTarget {
  channelId: string
  guildId?: string
  groupName?: string
}

const formatTime = (date: Date) => date.toLocaleString('zh-CN', { hour12: false })

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

/** 把消息渲染成投喂给 LLM 的文本 */
export function formatForPrompt(messages: MessageRecord[]): string {
  return messages.map((message) => {
    const time = message.timestamp.toLocaleTimeString('zh-CN', { hour12: false })
    return `[${time}] ${message.username || message.userId}: ${message.content}`
  }).join('\n')
}

/** 累加中的计数，不对外暴露 */
interface Accumulator {
  userId: string
  username: string
  messageCount: number
  charCount: number
  nightCount: number
  mediaCount: number
  quoteCount: number
}

/** 基于已序列化的消息文本统计发言数据 */
export function calculateStats(messages: MessageRecord[]) {
  const accumulators: Record<string, Accumulator> = {}
  const activeHours: Record<number, number> = {}
  let totalChars = 0

  for (const message of messages) {
    const userId = message.userId
    if (!userId) continue

    accumulators[userId] ??= {
      userId,
      username: userId,
      messageCount: 0,
      charCount: 0,
      nightCount: 0,
      mediaCount: 0,
      quoteCount: 0,
    }
    const acc = accumulators[userId]
    if (message.username) acc.username = message.username

    const hour = message.timestamp.getHours()
    activeHours[hour] = (activeHours[hour] || 0) + 1

    acc.messageCount++
    acc.charCount += message.content.length
    totalChars += message.content.length
    if (hour < 6) acc.nightCount++
    if (MEDIA_PATTERN.test(message.content)) acc.mediaCount++
    if (QUOTE_PATTERN.test(message.content)) acc.quoteCount++
  }

  const ratio = (value: number, total: number) => total ? Number((value / total).toFixed(2)) : 0
  const userStats: UserStats[] = Object.values(accumulators).map((acc) => ({
    userId: acc.userId,
    username: acc.username,
    messageCount: acc.messageCount,
    charCount: acc.charCount,
    avgChars: ratio(acc.charCount, acc.messageCount),
    nightRatio: ratio(acc.nightCount, acc.messageCount),
    emojiRatio: ratio(acc.mediaCount, acc.messageCount),
    replyRatio: ratio(acc.quoteCount, acc.messageCount),
  })).sort((a, b) => b.messageCount - a.messageCount)

  const busiest = Object.entries(activeHours).sort((a, b) => b[1] - a[1])[0]
  const mostActivePeriod = busiest
    ? `${busiest[0].padStart(2, '0')}:00 - ${String(Number(busiest[0]) + 1).padStart(2, '0')}:00`
    : undefined

  return { userStats, totalChars, mostActivePeriod }
}

function buildContext(messages: MessageRecord[], target: AnalysisTarget, query = ''): AnalysisContext {
  return {
    groupName: target.groupName || target.guildId || target.channelId,
    timeRange: messages.length
      ? `${formatTime(messages[0].timestamp)} ~ ${formatTime(messages[messages.length - 1].timestamp)}`
      : '（无记录）',
    currentTime: formatTime(new Date()),
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
  const context = buildContext(messages, target, query)
  const messagesText = formatForPrompt(messages)
  const { userStats, totalChars, mostActivePeriod } = calculateStats(messages)

  log.info(`开始群分析: ${context.groupName}，${messages.length} 条消息 / ${userStats.length} 人 / ${messagesText.length} 字，范围 ${context.timeRange}`)

  // 任一子任务失败不应拖垮整份报告
  const settle = async <T>(task: Promise<T[]>, name: string): Promise<T[]> => {
    try {
      return await task
    } catch (error) {
      log.warn(`${name}失败，该部分将留空:`, error)
      return []
    }
  }

  const [topics, goldenQuotes] = await Promise.all([
    settle<SummaryTopic>(ctx.qqGroupLlm.summarizeTopics(messagesText, context), '话题总结'),
    config.maxGoldenQuotes > 0
      ? settle<GoldenQuote>(ctx.qqGroupLlm.analyzeGoldenQuotes(messagesText, context), '金句提取')
      : Promise.resolve([]),
  ])

  log.info(`群分析完成，耗时 ${Date.now() - startedAt}ms，产出 ${topics.length} 个话题 / ${goldenQuotes.length} 条金句`)

  return {
    groupName: context.groupName,
    timeRange: context.timeRange,
    totalMessages: messages.length,
    totalChars,
    totalParticipants: userStats.length,
    mostActivePeriod,
    userStats: userStats.slice(0, config.maxUsersInReport),
    topics: topics.slice(0, config.maxTopics),
    goldenQuotes: goldenQuotes.slice(0, config.maxGoldenQuotes),
  }
}

/** 自然语言提问 */
export async function answerQuery(
  ctx: Context,
  messages: MessageRecord[],
  target: AnalysisTarget,
  query: string,
): Promise<string> {
  const log = logger(ctx)
  const context = buildContext(messages, target, query)
  log.info(`群聊问答: ${context.groupName} 基于 ${messages.length} 条消息，问题「${query}」`)
  return ctx.qqGroupLlm.answerQuery(formatForPrompt(messages), context)
}

/** 把分析结果渲染为纯文本报告 */
export function renderReport(result: GroupAnalysisResult): string {
  const lines = [
    `📊 群聊分析 · ${result.groupName}`,
    `时间范围: ${result.timeRange}`,
    `消息 ${result.totalMessages} 条 | 参与 ${result.totalParticipants} 人 | 共 ${result.totalChars} 字` +
      (result.mostActivePeriod ? ` | 最活跃时段 ${result.mostActivePeriod}` : ''),
  ]

  lines.push('', '💬 热门话题')
  if (result.topics.length) {
    for (const topic of result.topics) {
      const contributors = topic.contributors?.length ? `（${topic.contributors.join('、')}）` : ''
      lines.push(`· ${topic.topic}${contributors}`)
      if (topic.detail) lines.push(`  ${topic.detail.trim().replace(/\n/g, '\n  ')}`)
    }
  } else {
    lines.push('· 暂无')
  }

  if (result.goldenQuotes.length) {
    lines.push('', '✨ 群圣经')
    for (const quote of result.goldenQuotes) {
      lines.push(`· "${quote.content.trim()}" —— ${quote.sender || '匿名'}`)
      if (quote.reason) lines.push(`  ${quote.reason.trim()}`)
    }
  }

  if (result.userStats.length) {
    lines.push('', '🔥 活跃榜')
    result.userStats.forEach((user, index) => {
      lines.push(`${index + 1}. ${user.username} — ${user.messageCount} 条 / 平均 ${user.avgChars} 字`)
    })
  }

  return lines.join('\n')
}
