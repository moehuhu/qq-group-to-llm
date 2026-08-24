import { Context } from 'koishi'
import { dump, load } from 'js-yaml'
import type { Config } from '../config'
import { logger } from '../logger'
import { MessageRecord, PERSONA_TABLE, PersonaRecord, TABLE } from '../database'
import type { UserPersonaProfile } from '../types'

export interface PersonaTarget {
  platform: string
  userId: string
  username: string
  /** 仅当 personaOnlyCurrentGroup 开启时用于限定范围 */
  channelId?: string
}

const buildId = (platform: string, userId: string) => `${platform}:${userId}`

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

/** 新画像为空的字段回退到历史画像，避免一次失败的生成抹掉已有结论 */
export function mergePersona(
  previous: UserPersonaProfile | null,
  current: UserPersonaProfile,
): UserPersonaProfile {
  if (!previous) return { ...current, lastMergedFromHistory: false }
  return {
    ...previous,
    ...current,
    summary: current.summary || previous.summary,
    communicationStyle: current.communicationStyle || previous.communicationStyle,
    keyTraits: toArray(current.keyTraits).length ? toArray(current.keyTraits) : toArray(previous.keyTraits),
    interests: toArray(current.interests).length ? toArray(current.interests) : toArray(previous.interests),
    evidence: toArray(current.evidence).length ? toArray(current.evidence) : toArray(previous.evidence),
    lastMergedFromHistory: true,
  }
}

/** 取该用户在回溯窗口内的发言，按时间正序 */
async function collectMessages(
  ctx: Context,
  config: Config,
  target: PersonaTarget,
): Promise<MessageRecord[]> {
  const log = logger(ctx)
  const since = new Date(Date.now() - config.personaLookbackDays * 24 * 60 * 60 * 1000)
  const query: Record<string, unknown> = {
    platform: target.platform,
    userId: target.userId,
    timestamp: { $gte: since },
  }
  if (config.personaOnlyCurrentGroup && target.channelId) {
    query.channelId = target.channelId
  }

  const records = await ctx.database
    .select(TABLE)
    .where(query as never)
    .orderBy('timestamp', 'desc')
    .limit(config.personaMaxMessages)
    .execute()

  const range = config.personaOnlyCurrentGroup && target.channelId ? `频道 ${target.channelId}` : '全部已记录频道'
  log.info(`取到 ${target.username}(${target.userId}) 最近 ${config.personaLookbackDays} 天在${range}的 ${records.length} 条发言` +
    (records.length >= config.personaMaxMessages ? `（已达 personaMaxMessages=${config.personaMaxMessages} 上限）` : ''))
  return records.reverse()
}

/** 带 <msgid:…> 锚点渲染，供模型在 evidence 中引用 */
function formatForPrompt(messages: MessageRecord[]): string {
  return messages.map((message) => {
    const time = message.timestamp.toLocaleString('zh-CN', { hour12: false })
    const scope = message.guildId ? `群:${message.guildId}` : `频道:${message.channelId}`
    const anchor = message.messageId || message.id
    return `[${time}] ${scope} <msgid:${anchor}> ${message.content}`
  }).join('\n')
}

function formatPreviousForPrompt(persona: UserPersonaProfile | null): string {
  if (!persona) return '（无历史画像，请从零开始）'
  return [
    `summary: ${persona.summary || '无'}`,
    `keyTraits: ${toArray(persona.keyTraits).join('; ') || '无'}`,
    `interests: ${toArray(persona.interests).join('; ') || '无'}`,
    `communicationStyle: ${persona.communicationStyle || '无'}`,
  ].join('\n')
}

async function loadRecord(ctx: Context, id: string): Promise<PersonaRecord | undefined> {
  const [record] = await ctx.database.select(PERSONA_TABLE).where({ id }).execute()
  return record
}

function parsePersona(ctx: Context, record?: PersonaRecord): UserPersonaProfile | null {
  const log = logger(ctx)
  if (!record?.persona) return null
  try {
    return load(record.persona) as UserPersonaProfile
  } catch (error) {
    log.warn(`解析历史画像失败 (${record.id})，将忽略:`, error)
    return null
  }
}

const isFresh = (record: PersonaRecord | undefined, cacheDays: number) =>
  cacheDays > 0 && !!record?.lastAnalysisAt &&
  Date.now() - new Date(record.lastAnalysisAt).getTime() < cacheDays * 24 * 60 * 60 * 1000

export interface PersonaOutcome {
  persona: UserPersonaProfile | null
  /** 直接复用了未过期的历史画像 */
  cached: boolean
  /** 用于本次分析的消息条数 */
  messageCount: number
  /** 无法生成时的原因 */
  reason?: string
}

/** 生成（或复用）用户画像 */
export async function resolvePersona(
  ctx: Context,
  config: Config,
  target: PersonaTarget,
  force = false,
): Promise<PersonaOutcome> {
  const log = logger(ctx)
  const id = buildId(target.platform, target.userId)
  const startedAt = Date.now()
  log.info(`开始处理用户画像 ${id}${force ? '（强制刷新）' : ''}`)

  const record = await loadRecord(ctx, id)
  const previous = parsePersona(ctx, record)
  log.debug(`历史画像 ${previous ? `存在，上次分析于 ${record?.lastAnalysisAt}` : '不存在'}`)

  if (!force && previous && isFresh(record, config.personaCacheDays)) {
    log.info(`命中画像缓存 ${id}（personaCacheDays=${config.personaCacheDays} 天内），跳过 LLM 调用`)
    return { persona: previous, cached: true, messageCount: 0 }
  }

  const messages = await collectMessages(ctx, config, target)
  if (messages.length < config.personaMinMessages) {
    log.info(`${id} 发言 ${messages.length} 条不足 personaMinMessages=${config.personaMinMessages}，` +
      `${previous ? '回落到历史画像' : '无历史画像可用'}`)
    // 记录不足但有历史画像时，返回旧的总比什么都没有好
    return {
      persona: previous,
      cached: !!previous,
      messageCount: messages.length,
      reason: `最近 ${config.personaLookbackDays} 天只有 ${messages.length} 条发言，` +
        `不足 ${config.personaMinMessages} 条`,
    }
  }

  const username = messages[messages.length - 1].username || target.username
  const generated = await ctx.qqGroupLlm.analyzeUserPersona({
    userId: target.userId,
    username,
    messages: formatForPrompt(messages),
    previousAnalysis: formatPreviousForPrompt(previous),
  })

  if (!generated) {
    log.warn(`${id} 的画像生成失败，${previous ? '保留历史画像' : '无历史画像可用'}`)
    return { persona: previous, cached: !!previous, messageCount: messages.length, reason: 'LLM 未返回可用的画像结果' }
  }

  // 丢弃模型编造的 msgid，只保留真实存在的引用
  const known = new Map(messages.map((message) => [message.messageId || message.id, message]))
  const claimed = toArray(generated.evidence).map((item) => item.replace(/^msgid:/, '').trim())
  const evidence = claimed.filter((item) => known.has(item))
  const fabricated = claimed.filter((item) => !known.has(item))
  if (fabricated.length) {
    log.warn(`${id} 的画像引用了 ${fabricated.length} 个不存在的 msgid，已丢弃: ${fabricated.join(', ')}`)
  }

  const merged = mergePersona(previous, { ...generated, evidence })
  log.debug(`${id} 合并后画像: 特质 ${toArray(merged.keyTraits).length} 项 / ` +
    `兴趣 ${toArray(merged.interests).length} 项 / 证据 ${evidence.length}/${claimed.length} 条`)

  const now = new Date()
  await ctx.database.upsert(PERSONA_TABLE, [{
    id,
    platform: target.platform,
    userId: target.userId,
    username,
    persona: dump(merged, { indent: 2, lineWidth: -1, noRefs: true }),
    lastAnalysisAt: now,
    updatedAt: now,
  }])

  log.info(`用户画像 ${id} 已更新（${merged.lastMergedFromHistory ? '基于历史迭代' : '首次生成'}），` +
    `基于 ${messages.length} 条发言，总耗时 ${Date.now() - startedAt}ms`)
  return { persona: merged, cached: false, messageCount: messages.length }
}

/** 把 evidence 中的 messageId 回查成原文 */
export async function resolveEvidence(
  ctx: Context,
  persona: UserPersonaProfile,
  limit = 5,
): Promise<string[]> {
  const log = logger(ctx)
  const ids = toArray(persona.evidence).slice(0, limit)
  if (!ids.length) return []

  const records = await ctx.database
    .select(TABLE)
    .where({ $or: [{ messageId: { $in: ids } }, { id: { $in: ids } }] })
    .execute()

  const byId = new Map<string, MessageRecord>()
  for (const record of records) {
    byId.set(record.messageId || record.id, record)
    byId.set(record.id, record)
  }
  const quotes = ids.map((id) => byId.get(id)?.content).filter(Boolean) as string[]
  if (quotes.length < ids.length) {
    log.debug(`证据回查: ${ids.length} 个 msgid 命中 ${quotes.length} 条原文，其余已被清理或删除`)
  }
  return quotes
}
