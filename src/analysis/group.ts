import { Context } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { calculateStats } from './stats'
import { resolveTimeFormatter, type TimeFormatter } from '../time'
import { cleanContent } from '../text'
import { layoutRecord } from '../transcript'
import { MessageRecord, TABLE } from '../database'
import type {
  AnalysisContext,
  CitedMessage,
  DialogueDigest,
  GoldenQuote,
  HighlightDialogue,
  HighlightLine,
  GroupAnalysisResult,
  QueryAnswerResult,
  ResolvedHighlightLine,
  ResolvedQuote,
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
 * 把消息渲染成投喂给 LLM 的文本，一条记录一段，行首是时间与发言人。
 * 正文本身可能是多行的（合并转发的「群聊的聊天记录」就是一整块），
 * 续行由 layoutRecord 缩进，免得被当成另一个人的发言。
 */
export function formatForPrompt(messages: MessageRecord[], time: TimeFormatter): string {
  return messages.map((message) => layoutRecord(
    `[${time.time(message.timestamp)}] ${message.username || message.userId}: `,
    message.content,
  )).join('\n')
}

/**
 * 带 <msgid:…> 锚点渲染，供模型在引用中标识消息。
 * 锚点只在行首出现一次，所以多行正文的续行必须缩进——
 * 否则锚点会被算到它后面那几行头上，引用的原文就对不上了。
 * 问答需要回查引用原文，故这里与 persona 的排法一致。
 */
export function formatForQueryPrompt(messages: MessageRecord[], time: TimeFormatter): string {
  return messages.map((message) => {
    const anchor = message.messageId || message.id
    return layoutRecord(
      `[${time.time(message.timestamp)}] ${message.username || message.userId}: <msgid:${anchor}> `,
      message.content,
    )
  }).join('\n')
}

/**
 * 按 messageId（缺省退到记录主键）在已投喂的消息里回查引用消息，保持引用顺序。
 * 只在 messages（本次问答实际投喂的记录）内回查：模型能引用的只有它看到过的消息，
 * 命不中的（编造的、或库里其他消息的 id）一律丢弃，杜绝引到别处的原文。
 * 消息在 fetchMessages 时已清洗过，这里直接用。
 */
export function resolveCitedMessages(
  messages: MessageRecord[],
  cited: string[],
  time: TimeFormatter,
): CitedMessage[] {
  const ids = [...new Set(cited.map((item) => item.replace(/^msgid:/, '').trim()).filter(Boolean))]
  if (!ids.length) return []

  const byId = new Map<string, MessageRecord>()
  for (const record of messages) {
    byId.set(record.messageId || record.id, record)
    byId.set(record.id, record)
  }
  return ids
    .map((id) => byId.get(id))
    .filter((record): record is MessageRecord => !!record?.content)
    .map((record) => ({
      sender: record.username || record.userId || '匿名',
      time: time.time(record.timestamp),
      content: record.content,
    }))
}

/** 把模型返回的条目压成一句可读的摘要，日志里用它指出具体丢的是哪一条 */
function summarizeDropped(text: string | undefined | null, limit = 50): string {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  return cleaned ? `「${cleaned.slice(0, limit)}${cleaned.length > limit ? '…' : ''}」` : '（无正文）'
}

/** 规整模型返回的金句候选：只认 msgid 与 reason，缺 msgid 的直接丢弃 */
export function normalizeQuote(item: Partial<GoldenQuote> | undefined): GoldenQuote | null {
  const msgid = String(item?.msgid ?? '').trim().replace(/^msgid:/, '')
  if (!msgid) return null
  return {
    msgid,
    reason: item?.reason?.trim() || undefined,
  }
}

/**
 * 按 msgid 在本次投喂的记录里回查金句原文与发送者，保持引用顺序。
 *
 * 模型只还原消息 id，不报正文也不报发言人——它抄的原文、还原的昵称都不可信。
 * 只在本批投喂（已剔除 quoteUserFilter 用户）的记录内回查：模型能引用的只有它
 * 看到过的消息，命不中的（编造的、或库里其他消息的 id）一律丢弃，杜绝引到
 * 别处的原文。消息在 fetchMessages 时已清洗过，这里直接用。
 */
export function resolveQuoteMessages(
  messages: MessageRecord[],
  quotes: GoldenQuote[],
): ResolvedQuote[] {
  const byId = new Map<string, MessageRecord>()
  for (const record of messages) {
    byId.set(record.messageId || record.id, record)
    byId.set(record.id, record)
  }
  return quotes.flatMap((quote) => {
    const record = byId.get(quote.msgid)
    if (!record?.content) return []
    return [{
      sender: record.username || record.userId || '匿名',
      content: record.content,
      reason: quote.reason?.trim() || undefined,
    }]
  })
}

/**
 * 规整模型返回的高光对话：丢掉空轮次、缺 msgid 的轮次，按 maxHighlightLines 截断，
 * 校验放在截断之后，保证真正渲染出来的那几轮确实构成一段对话。
 *
 * 模型只还原消息 id，不报正文也不报发言人——它会把原文抄错、昵称张冠李戴。
 * 所以这里只校验 msgid，正文与发言人等渲染前按 id 从库里回查。
 */
export function normalizeDialogue(
  item: Partial<HighlightDialogue<HighlightLine>> | undefined,
  maxLines: number,
): HighlightDialogue<HighlightLine> | null {
  const lines = (Array.isArray(item?.lines) ? item.lines : [])
    .map((line) => ({
      msgid: String(line?.msgid ?? '').trim().replace(/^msgid:/, ''),
    }))
    .filter((line) => line.msgid)
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
): Promise<GroupAnalysisResult> {
  const log = logger(ctx)
  const startedAt = Date.now()

  // 话题与金句的屏蔽名单是分开的：可以允许某人进话题和活跃榜，但不收他的金句
  const analysisMessages = excludeUsers(messages, config.analysisUserFilter)
  const quoteMessages = excludeUsers(messages, config.quoteUserFilter)
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
  // 金句投喂带 <msgid:…> 锚点：模型只还原消息 id，渲染前按 id 回查原文与发送者，
  // 不再信任它抄的原文和还原的昵称
  const [topics, quotes] = await Promise.all([
    settle<SummaryTopic>(() => ctx.qqGroupLlm.summarizeTopics(messagesText, context), '话题总结'),
    config.maxGoldenQuotes > 0
      ? settle(() => ctx.qqGroupLlm.analyzeGoldenQuotes(
        formatForQueryPrompt(quoteMessages, time), buildContext(quoteMessages, target, time, query)), '金句提取')
      : Promise.resolve([]),
  ])

  // 模型偶尔会漏字段，缺主键的条目直接丢弃，避免污染报告
  const usableTopics = topics.filter((topic) => topic?.topic)
  const normalizedQuotes = quotes
    .map((item) => normalizeQuote(item))
    .filter((item): item is GoldenQuote => !!item)
  const rawQuotes = normalizedQuotes.slice(0, config.maxGoldenQuotes)
  // 按 msgid 回查原文与发送者。投喂前已剔除 quoteUserFilter 用户，
  // 回查只在 quoteMessages 内进行，屏蔽用户的发言引不出来
  const usableQuotes = resolveQuoteMessages(quoteMessages, rawQuotes)

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
  const byQuoteId = new Map<string, MessageRecord>()
  for (const record of quoteMessages) {
    byQuoteId.set(record.messageId || record.id, record)
    byQuoteId.set(record.id, record)
  }
  let quoteRank = 0 // 第几个有效金句（归一化后按原始顺序计），用于判断是否超出上限
  for (const [index, item] of quotes.entries()) {
    const quote = normalizeQuote(item)
    if (!quote) {
      droppedDetails.push(`金句第 ${index + 1} 条：缺 msgid，无法回查`)
      continue
    }
    quoteRank += 1
    if (quoteRank > config.maxGoldenQuotes) {
      droppedDetails.push(`金句第 ${index + 1} 条「${summarizeDropped(quote.reason)}」：超出 maxGoldenQuotes=${config.maxGoldenQuotes} 上限`)
    } else if (!byQuoteId.get(quote.msgid)?.content) {
      droppedDetails.push(`金句第 ${index + 1} 条：msgid ${quote.msgid} 回查落空（编造或不在投喂范围内）`)
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
): Promise<DialogueDigest> {
  const log = logger(ctx)
  const startedAt = Date.now()

  const usable = excludeUsers(messages, config.dialogueUserFilter)
  if (messages.length !== usable.length) {
    log.info(`高光对话屏蔽了 ${messages.length - usable.length} 条发言`)
  }

  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time)
  // 高光对话也要逐条带 <msgid:…> 锚点：模型只还原消息 id，不报正文也不报发言人，
  // 渲染前按 id 回查原文与发言人——它抄的原文、还原的昵称都不可信
  const messagesText = formatForQueryPrompt(usable, time)

  log.info(`开始抽取高光对话: ${context.groupName}，${usable.length} 条消息，范围 ${context.timeRange}`)

  const raw = await ctx.qqGroupLlm.analyzeHighlightDialogues(messagesText, context)

  const normalized = raw.map((item) => normalizeDialogue(item, config.maxHighlightLines))
  const dialogues = normalized
    .filter((item): item is HighlightDialogue<HighlightLine> => !!item)
    .slice(0, config.maxHighlightDialogues)

  // 逐段记录被丢弃的高光对话，日志里指出具体是哪段、为什么丢
  const droppedDetails: string[] = []
  let dialogueRank = 0 // 第几段有效对话（归一化后按原始顺序计），用于判断是否超出上限
  for (const [index, item] of raw.entries()) {
    const dialogue = normalizeDialogue(item, config.maxHighlightLines)
    if (!dialogue) {
      const title = summarizeDropped(item?.title)
      const lineCount = Array.isArray(item?.lines) ? item.lines.filter((line) => String(line?.msgid ?? '').trim()).length : 0
      droppedDetails.push(`第 ${index + 1} 段「${title}」：有效轮次仅 ${lineCount} 轮（不足两人两轮）`)
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

/**
 * 把高光对话里的 msgid 回查成原文与发言人，供渲染层直接展示。
 *
 * 在本次投喂的记录（含被 dialogueUserFilter 屏蔽的）里回查，不带出投喂范围之外的原文；
 * 消息在 fetchMessages 时已清洗过，这里直接用。发言人、头像都取自消息记录本身，
 * 不再信任模型还原的昵称——被屏蔽用户的发言，其段连同 msgid 一起在这里丢弃。
 * 命中失败（历史记录被清理）的那轮没有正文，连同它所在的段一起丢弃——
 * 抽掉一轮剩下的对话就接不上了。
 */
export async function resolveDialogueDigest(
  ctx: Context,
  config: Config,
  digest: DialogueDigest<HighlightLine>,
): Promise<DialogueDigest<ResolvedHighlightLine>> {
  const log = logger(ctx)
  const ids = [...new Set(digest.dialogues.flatMap((dialogue) =>
    dialogue.lines.map((line) => line.msgid).filter(Boolean)))]

  const records = ids.length
    ? await ctx.database
      .select(TABLE)
      .where({ $or: [{ messageId: { $in: ids } }, { id: { $in: ids } }] })
      .execute()
    : []

  const byId = new Map<string, MessageRecord>()
  for (const record of records) {
    byId.set(record.messageId || record.id, record)
    byId.set(record.id, record)
  }

  const blocked = new Set(config.dialogueUserFilter)
  const droppedLines: string[] = []
  const dialogues = digest.dialogues.map((dialogue) => {
    const lines: ResolvedHighlightLine[] = []
    for (const line of dialogue.lines) {
      const record = byId.get(line.msgid)
      if (!record?.content) {
        droppedLines.push(`「${summarizeDropped(dialogue.title)}」轮次 ${line.msgid} 回查落空（历史记录已被清理或删除）`)
        continue
      }
      // 屏蔽名单按用户 ID 填的，发言人由记录回查拿到，正好在这里拦一道
      if (blocked.has(record.userId ?? '')) {
        droppedLines.push(`「${summarizeDropped(dialogue.title)}」轮次 ${line.msgid}（${record.username || record.userId || '匿名'}）命中 dialogueUserFilter，整段丢弃`)
        continue
      }
      lines.push({
        sender: record.username || record.userId || '匿名',
        content: record.content,
        avatar: record.avatar || undefined,
      })
    }
    return {
      title: dialogue.title,
      lines,
      reason: dialogue.reason,
    }
  })
  // 抽掉一轮剩下的对话就接不上了，整段丢弃
  const usable = dialogues.filter((dialogue) => dialogue.lines.length >= 2)
  if (droppedLines.length) {
    log.warn(`高光对话回查丢弃 ${droppedLines.length} 轮:\n- ` + droppedLines.join('\n- '))
  }

  return {
    groupName: digest.groupName,
    timeRange: digest.timeRange,
    totalMessages: digest.totalMessages,
    dialogues: usable,
  }
}

/** 自然语言提问 */
export async function answerQuery(
  ctx: Context,
  config: Config,
  messages: MessageRecord[],
  target: AnalysisTarget,
  query: string,
): Promise<QueryAnswerResult> {
  const log = logger(ctx)
  // 问答是「群分析」命令的一部分，沿用同一份屏蔽名单
  const usable = excludeUsers(messages, config.analysisUserFilter)
  const time = resolveTimeFormatter(ctx, config.timezone)
  const context = buildContext(usable, target, time, query)
  log.info(`群聊问答: ${context.groupName} 基于 ${usable.length} 条消息，问题「${query}」` +
    (messages.length !== usable.length ? `（屏蔽了 ${messages.length - usable.length} 条）` : ''))

  const outcome = await ctx.qqGroupLlm.answerQuery(formatForQueryPrompt(usable, time), context)
  const quoted = outcome.cited ?? []
  const quotedIds = [...new Set(quoted.map((item) => item.replace(/^msgid:/, '').trim()).filter(Boolean))]
  const quotes = resolveCitedMessages(usable, quoted, time)
  if (quotedIds.length) {
    // 找出回查落空的 msgid（编造的、或库里其他消息的 id），逐条指出具体是哪个
    const byId = new Map<string, boolean>()
    for (const record of usable) {
      byId.set(record.messageId || record.id, true)
      byId.set(record.id, true)
    }
    const miss = quotedIds.filter((id) => !byId.get(id))
    if (miss.length) {
      log.warn(`群聊问答: 丢弃 ${miss.length}/${quotedIds.length} 个引用 msgid（回查落空，可能是编造的 id）: ${miss.join(', ')}`)
    }
  }

  return {
    answer: outcome.answer,
    cited: quotes,
  }
}
