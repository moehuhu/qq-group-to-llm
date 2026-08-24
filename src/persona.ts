import { Context } from 'koishi'
import { dump, load } from 'js-yaml'
import type { Config } from './config'
import { MessageRecord, PERSONA_TABLE, PersonaRecord, TABLE } from './model'
import type { UserPersonaProfile } from './types'

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
  if (!record?.persona) return null
  try {
    return load(record.persona) as UserPersonaProfile
  } catch (error) {
    ctx.logger.warn(`解析历史画像失败 (${record.id})，将忽略:`, error)
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
  const id = buildId(target.platform, target.userId)
  const record = await loadRecord(ctx, id)
  const previous = parsePersona(ctx, record)

  if (!force && previous && isFresh(record, config.personaCacheDays)) {
    return { persona: previous, cached: true, messageCount: 0 }
  }

  const messages = await collectMessages(ctx, config, target)
  if (messages.length < config.personaMinMessages) {
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
    return { persona: previous, cached: !!previous, messageCount: messages.length, reason: 'LLM 未返回可用的画像结果' }
  }

  // 丢弃模型编造的 msgid，只保留真实存在的引用
  const known = new Map(messages.map((message) => [message.messageId || message.id, message]))
  const merged = mergePersona(previous, {
    ...generated,
    evidence: toArray(generated.evidence)
      .map((item) => item.replace(/^msgid:/, '').trim())
      .filter((item) => known.has(item)),
  })

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

  return { persona: merged, cached: false, messageCount: messages.length }
}

/** 把画像渲染为纯文本 */
export function renderPersona(persona: UserPersonaProfile, evidenceText: string[] = []): string {
  const lines = [`🪞 用户画像 · ${persona.username || persona.userId}`, '', persona.summary?.trim() || '（无总结）']

  const traits = toArray(persona.keyTraits)
  if (traits.length) lines.push('', `🏷 性格特质：${traits.join('、')}`)

  const interests = toArray(persona.interests)
  if (interests.length) lines.push('', `🎯 关注领域：${interests.join('、')}`)

  if (persona.communicationStyle?.trim()) {
    lines.push('', `🗣 表达风格：${persona.communicationStyle.trim()}`)
  }

  if (evidenceText.length) {
    lines.push('', '📌 代表发言')
    for (const quote of evidenceText) lines.push(`· ${quote}`)
  }

  return lines.join('\n')
}

/** 把 evidence 中的 messageId 回查成原文 */
export async function resolveEvidence(
  ctx: Context,
  persona: UserPersonaProfile,
  limit = 5,
): Promise<string[]> {
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
  return ids.map((id) => byId.get(id)?.content).filter(Boolean) as string[]
}
