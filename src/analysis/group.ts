import { Context } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { calculateStats } from './stats'
import { MessageRecord, TABLE } from '../database'
import type {
  AnalysisContext,
  GoldenQuote,
  HighlightDialogue,
  HighlightRecord,
  GroupAnalysisResult,
  SummaryTopic,
} from '../types'

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

/** 规整金句：缺原文的直接丢弃，并补上 kind 供报告分组 */
export function normalizeQuote(item: Partial<GoldenQuote> | undefined): GoldenQuote | null {
  const content = String(item?.content ?? '').trim()
  if (!content) return null
  return {
    kind: 'quote',
    content,
    sender: item?.sender?.trim() || undefined,
    reason: item?.reason?.trim() || undefined,
  }
}

/**
 * 规整模型返回的高光对话：丢掉空轮次、按 maxHighlightLines 截断，
 * 并要求至少两人两轮——只有一个人自说自话的片段不算「对话」。
 * 校验放在截断之后，保证真正渲染出来的那几轮确实构成一段对话。
 */
export function normalizeDialogue(
  item: Partial<HighlightDialogue> | undefined,
  maxLines: number,
): HighlightDialogue | null {
  const lines = (Array.isArray(item?.lines) ? item.lines : [])
    .map((line) => ({
      sender: String(line?.sender ?? '').trim(),
      content: String(line?.content ?? '').trim(),
    }))
    .filter((line) => line.content)
    .slice(0, maxLines)

  if (lines.length < 2) return null
  if (new Set(lines.map((line) => line.sender)).size < 2) return null

  return {
    kind: 'dialogue',
    title: item?.title?.trim() || undefined,
    lines,
    academicPoint: item?.academicPoint?.trim() || undefined,
    reason: item?.reason?.trim() || undefined,
  }
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

  // 金句与高光对话判定标准不同，分两次独立抽取，互不干扰，最后并入同一个板块
  const [topics, quotes, dialogues] = await Promise.all([
    settle<SummaryTopic>(ctx.qqGroupLlm.summarizeTopics(messagesText, context), '话题总结'),
    config.maxGoldenQuotes > 0
      ? settle(ctx.qqGroupLlm.analyzeGoldenQuotes(messagesText, context), '金句提取')
      : Promise.resolve([]),
    config.maxHighlightDialogues > 0
      ? settle(ctx.qqGroupLlm.analyzeHighlightDialogues(messagesText, context), '高光对话')
      : Promise.resolve([]),
  ])

  // 模型偶尔会漏字段，缺主键的条目直接丢弃，避免污染报告
  const usableTopics = topics.filter((topic) => topic?.topic)
  const usableQuotes = quotes
    .map((item) => normalizeQuote(item))
    .filter((item): item is GoldenQuote => !!item)
    .slice(0, config.maxGoldenQuotes)
  const usableDialogues = dialogues
    .map((item) => normalizeDialogue(item, config.maxHighlightLines))
    .filter((item): item is HighlightDialogue => !!item)
    .slice(0, config.maxHighlightDialogues)

  const dropped = (topics.length - usableTopics.length) +
    (quotes.length - usableQuotes.length) + (dialogues.length - usableDialogues.length)
  if (dropped) log.warn(`丢弃 ${dropped} 条不合格的 LLM 结果（缺字段、超出条数上限，或不足两人两轮的高光对话）`)

  // 对话在前、金句在后：前者信息量更大，读报告时先看到
  const highlights: HighlightRecord[] = [...usableDialogues, ...usableQuotes]

  log.info(`群分析完成，耗时 ${Date.now() - startedAt}ms，产出 ${usableTopics.length} 个话题 / ` +
    `${usableDialogues.length} 段高光对话 / ${usableQuotes.length} 条金句`)

  return {
    groupName: context.groupName,
    timeRange: context.timeRange,
    totalMessages: messages.length,
    totalChars,
    totalParticipants: userStats.length,
    mostActivePeriod,
    userStats: userStats.slice(0, config.maxUsersInReport),
    topics: usableTopics.slice(0, config.maxTopics),
    highlights,
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
