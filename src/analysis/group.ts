import { Context } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { calculateStats } from './stats'
import { resolveTimeFormatter, type TimeFormatter } from '../time'
import { cleanContent } from '../text'
import { toPromptJson } from '../transcript'
import { loadAvatarBook, type AvatarBook } from '../avatar'
import { MessageRecord, TABLE } from '../database'
import type {
  AnalysisContext,
  DialogueDigest,
  GoldenQuote,
  HighlightDialogue,
  HighlightLine,
  HighlightLineDraft,
  GroupAnalysisResult,
  MessageQuote,
  QueryAnswerResult,
} from '../types'
import type { QueueTicket } from '../llm'
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
  // 老记录里可能还留着平台的残标记、没压过的转发排版块，读出来就地清一遍，
  // 省得渲染和提示词各处理一次
  return records.reverse().map((record) => ({
    ...record,
    content: cleanContent(record.content, config.recordImages),
  }))
}

/** 剔除被屏蔽用户的发言。空名单时原样返回，不做无谓的拷贝 */
export function excludeUsers(messages: MessageRecord[], blocked: string[]): MessageRecord[] {
  if (!blocked?.length) return messages
  return messages.filter((message) => !message.userId || !blocked.includes(message.userId))
}

/**
 * 把消息渲染成投喂给 LLM 的 JSON 数组字符串，一条记录一个对象。
 * 字段含 time / sender / content；给了头像映射表时额外带一个短编号 uid，
 * 供模型把发言人原样照抄进返回结果（高光对话出图用）。
 * 头像地址留在表里不进提示词——省上下文，也省得模型抄错长地址。
 * 没有头像的人不进表，也就不带 uid，模型把该字段留空即可。
 */
export function formatForPrompt(
  messages: MessageRecord[],
  time: TimeFormatter,
  avatars?: AvatarBook,
): string {
  return toPromptJson(messages, time, { avatars })
}

/** 把模型返回的条目压成一句可读的摘要，日志里用它指出具体丢的是哪一条 */
function summarizeDropped(text: string | undefined | null, limit = 50): string {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  return cleaned ? `「${cleaned.slice(0, limit)}${cleaned.length > limit ? '…' : ''}」` : '（无正文）'
}

/** 规整模型返回的金句候选：只认 sender 与 content 与 reason，缺内容的直接丢弃 */
export function normalizeQuote(item: Partial<GoldenQuote> | undefined): GoldenQuote | null {
  const sender = String(item?.sender ?? '').trim()
  const content = String(item?.content ?? '').trim()
  if (!sender || !content) return null
  return {
    sender,
    content,
    reason: item?.reason?.trim() || undefined,
  }
}

/**
 * 规整模型返回的高光对话：丢掉空轮次、缺 sender 或 content 的轮次，按 maxHighlightLines 截断，
 * 校验放在截断之后，保证真正渲染出来的那几轮确实构成一段对话。
 *
 * 模型直接返回每轮的发送者昵称、头像与发言原文，不做回查校验。
 */
export function normalizeDialogue(
  item: Partial<HighlightDialogue<HighlightLineDraft>> | undefined,
  maxLines: number,
  avatars?: AvatarBook,
): HighlightDialogue<HighlightLine> | null {
  const lines = (Array.isArray(item?.lines) ? item.lines : [])
    .map((line) => {
      const sender = String(line?.sender ?? '').trim()
      return {
        sender,
        content: String(line?.content ?? '').trim(),
        // 模型抄回来的是编号，这里按表还原成地址；编号抄丢了就拿昵称在表里找一次。
        // 没有表（旧调用）时只认模型直接抄回来的地址
        avatar: avatars
          ? avatars.resolve(line?.uid ?? line?.avatar, sender)
          : String(line?.avatar ?? '').trim() || undefined,
      }
    })
    .filter((line) => line.sender && line.content)
    .slice(0, maxLines)

  if (lines.length < 2) return null

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
  ticket?: QueueTicket,
): Promise<GroupAnalysisResult> {
  const log = logger(ctx)
  const startedAt = Date.now()

  // 话题与金句在同一次模型请求里返回、共用同一份投喂消息，无法再按任务分开屏蔽。
  // quoteUserFilter 退化为结果层的昵称拦截：投喂时被屏蔽者的发言照常进入，
  // 模型返回的金句若把话安到被屏蔽者头上（昵称张冠李戴或转述），就在结果层剔除。
  const analysisMessages = excludeUsers(messages, config.analysisUserFilter)
  const hidden = messages.length - analysisMessages.length
  if (hidden) {
    log.info(`群分析屏蔽了 ${config.analysisUserFilter.length} 个用户的 ${hidden} 条发言`)
  }

  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(analysisMessages, target, time, query)
  // 话题与金句都只认昵称，投喂时不带头像编号；活跃榜要出头像，映射表只给统计用
  const messagesText = formatForPrompt(analysisMessages, time)
  const avatars = await loadAvatarBook(ctx, analysisMessages)
  const { userStats, totalChars, mostActivePeriod, hourly } = calculateStats(analysisMessages, time, avatars)

  log.info(`开始群分析: ${context.groupName}，${analysisMessages.length} 条消息 / ${userStats.length} 人 / ${messagesText.length} 字，范围 ${context.timeRange}`)

  /** 模型调用失败不应让报告整个失败，留空即可 */
  const settle = async <T>(task: () => Promise<T>, name: string, fallback: T): Promise<T> => {
    try {
      return await task()
    } catch (error) {
      log.warn(`${name}失败，该部分将留空:`, error)
      return fallback
    }
  }

  // 话题与金句在同一次模型请求里返回，只投喂一份消息。
  // 高光对话不在这里抽取，它由独立的「高光对话」命令负责。
  // 金句由模型直接返回昵称与原文，投喂普通对话格式即可，无需 <msgid:…> 锚点
  const summary = await settle(
    () => ctx.qqGroupLlm.analyzeGroupSummary(messagesText, context, ticket),
    '话题与金句',
    { topics: [], quotes: [] },
  )
  const topics = summary.topics
  const quotes = summary.quotes

  // 模型偶尔会漏字段，缺主键的条目直接丢弃，避免污染报告
  const usableTopics = topics.filter((topic) => topic?.topic)
  // 金句按昵称做结果层拦截：quoteUserFilter 填的是用户 ID，而模型只认昵称，
  // 先建立 userId → 昵称 的映射，再剔除把话安到被屏蔽者头上的金句
  const quoteBlockedNames = new Set(
    analysisMessages
      .filter((message) => config.quoteUserFilter.includes(message.userId ?? ''))
      .map((message) => message.username)
      .filter(Boolean),
  )
  const usableQuotes = quotes
    .map((item) => normalizeQuote(item))
    .filter((item): item is GoldenQuote => !!item)
    .filter((quote) => !quoteBlockedNames.has(quote.sender))
    .slice(0, config.maxGoldenQuotes)

  // 逐条记录被丢弃的话题与金句，日志里指出具体是哪条、为什么丢
  const droppedDetails: string[] = []
  let topicRank = 0 // 第几个有效话题（按原始顺序计），用于判断是否超出上限
  for (const [index, topic] of topics.entries()) {
    if (!topic?.topic) {
      droppedDetails.push(`话题第 ${index + 1} 条「${summarizeDropped(topic?.detail ?? topic?.messages?.[0])}」缺少 topic 字段`)
      continue
    }
    topicRank += 1
    if (topicRank > config.maxTopics) {
      droppedDetails.push(`话题第 ${index + 1} 条「${summarizeDropped(topic.topic)}」：超出 maxTopics=${config.maxTopics} 上限`)
    }
  }
  let quoteRank = 0 // 第几个有效金句（归一化后按原始顺序计），用于判断是否超出上限
  for (const [index, item] of quotes.entries()) {
    const quote = normalizeQuote(item)
    if (!quote) {
      droppedDetails.push(`金句第 ${index + 1} 条：缺 sender 或 content，无法展示`)
      continue
    }
    if (quoteBlockedNames.has(quote.sender)) {
      droppedDetails.push(`金句第 ${index + 1} 条「${summarizeDropped(quote.content)}」：sender 属于 quoteUserFilter 屏蔽的用户`)
      continue
    }
    quoteRank += 1
    if (quoteRank > config.maxGoldenQuotes) {
      droppedDetails.push(`金句第 ${index + 1} 条「${summarizeDropped(quote.reason)}」：超出 maxGoldenQuotes=${config.maxGoldenQuotes} 上限`)
    }
  }
  if (droppedDetails.length) {
    log.warn(`丢弃 ${droppedDetails.length} 条不合格的 LLM 结果:\n- ` + droppedDetails.join('\n- '))
  }

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
  ticket?: QueueTicket,
): Promise<DialogueDigest> {
  const log = logger(ctx)
  const startedAt = Date.now()

  const usable = excludeUsers(messages, config.dialogueUserFilter)
  if (messages.length !== usable.length) {
    log.info(`高光对话屏蔽了 ${messages.length - usable.length} 条发言`)
  }

  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time)
  // 出图要头像，但地址不进提示词：先从库里取出这批人的「用户 ID ↔ 头像地址」映射表，
  // 投喂时每条只带表里的短编号 uid，模型照抄编号，落地时再还原成地址
  const avatars = await loadAvatarBook(ctx, usable)
  const messagesText = formatForPrompt(usable, time, avatars)

  log.info(`开始抽取高光对话: ${context.groupName}，${usable.length} 条消息，范围 ${context.timeRange}` +
    (avatars.size ? `，头像映射表 ${avatars.size} 人（头像地址不进提示词，省下约 ${avatars.inlineChars} 字）` : ''))

  const raw = await ctx.qqGroupLlm.analyzeHighlightDialogues(messagesText, context, ticket)

  const normalized = raw.map((item) => normalizeDialogue(item, config.maxHighlightLines, avatars))
  const dialogues = normalized
    .filter((item): item is HighlightDialogue<HighlightLine> => !!item)
    .slice(0, config.maxHighlightDialogues)

  // 逐段记录被丢弃的高光对话，日志里指出具体是哪段、为什么丢
  const droppedDetails: string[] = []
  let dialogueRank = 0 // 第几段有效对话（归一化后按原始顺序计），用于判断是否超出上限
  for (const [index, item] of raw.entries()) {
    const dialogue = normalizeDialogue(item, config.maxHighlightLines, avatars)
    if (!dialogue) {
      const title = summarizeDropped(item?.title)
      const lineCount = Array.isArray(item?.lines)
        ? item.lines.filter((line) => String(line?.sender ?? '').trim() && String(line?.content ?? '').trim()).length
        : 0
      droppedDetails.push(`第 ${index + 1} 段「${title}」：有效轮次仅 ${lineCount} 轮（不足两轮）`)
      continue
    }
    dialogueRank += 1
    if (dialogueRank > config.maxHighlightDialogues) {
      droppedDetails.push(`第 ${index + 1} 段「${summarizeDropped(dialogue.title)}」：超出 maxHighlightDialogues=${config.maxHighlightDialogues} 上限`)
    }
  }
  if (droppedDetails.length) {
    log.warn(`丢弃 ${droppedDetails.length} 段不合格的对话:\n- ` + droppedDetails.join('\n- '))
  }

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
  ticket?: QueueTicket,
): Promise<QueryAnswerResult> {
  const log = logger(ctx)
  // 问答是「群分析」命令的一部分，沿用同一份屏蔽名单
  const usable = excludeUsers(messages, config.analysisUserFilter)
  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time, query)
  log.info(`群聊问答: ${context.groupName} 基于 ${usable.length} 条消息，问题「${query}」` +
    (messages.length !== usable.length ? `（屏蔽了 ${messages.length - usable.length} 条）` : ''))

  const outcome = await ctx.qqGroupLlm.answerQuery(formatForPrompt(usable, time), context, ticket)
  const cited: MessageQuote[] = outcome.cited ?? []

  return {
    answer: outcome.answer,
    cited,
  }
}
