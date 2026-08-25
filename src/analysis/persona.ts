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
  /** 命令触发时抓到的头像地址，取不到时沿用库里已存的 */
  avatar?: string
  /** 仅当 personaOnlyCurrentGroup 开启时用于限定范围 */
  channelId?: string
}

const buildId = (platform: string, userId: string) => `${platform}:${userId}`

const toArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : []

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
    log.warn(`解析已存画像失败 (${record.id})，将忽略:`, error)
    return null
  }
}

const isFresh = (record: PersonaRecord | undefined, cacheDays: number) =>
  cacheDays > 0 && !!record?.lastAnalysisAt &&
  Date.now() - new Date(record.lastAnalysisAt).getTime() < cacheDays * 24 * 60 * 60 * 1000

export interface PersonaOutcome {
  persona: UserPersonaProfile | null
  /** 画像主人的头像地址，供渲染时展示 */
  avatar?: string
  /** 直接复用了未过期的已存画像 */
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

  // 命令层已经拦过一次，这里再拦一道：resolvePersona 是导出的，别的入口调进来同样要生效
  if (config.personaUserFilter.includes(target.userId)) {
    log.info(`${id} 在 personaUserFilter 中，拒绝分析`)
    return { persona: null, cached: false, messageCount: 0, reason: '该用户已被设置为不参与画像分析' }
  }

  const record = await loadRecord(ctx, id)
  const previous = parsePersona(ctx, record)
  log.debug(`已存画像 ${previous ? `存在，上次分析于 ${record?.lastAnalysisAt}` : '不存在'}（仅用于缓存与兜底，不参与本次生成）`)

  if (!force && previous && isFresh(record, config.personaCacheDays)) {
    log.info(`命中画像缓存 ${id}（personaCacheDays=${config.personaCacheDays} 天内），跳过 LLM 调用`)
    return { persona: previous, avatar: target.avatar || record?.avatar, cached: true, messageCount: 0 }
  }

  const messages = await collectMessages(ctx, config, target)
  if (messages.length < config.personaMinMessages) {
    log.info(`${id} 发言 ${messages.length} 条不足 personaMinMessages=${config.personaMinMessages}，` +
      `${previous ? '回落到已存画像' : '无已存画像可用'}`)
    // 本次无法生成，有旧画像时返回旧的总比什么都没有好
    return {
      persona: previous,
      avatar: target.avatar || messages.find((message) => message.avatar)?.avatar || record?.avatar,
      cached: !!previous,
      messageCount: messages.length,
      reason: `最近 ${config.personaLookbackDays} 天只有 ${messages.length} 条发言，` +
        `不足 ${config.personaMinMessages} 条`,
    }
  }

  const username = messages[messages.length - 1].username || target.username
  // 记录里存了发言当时的头像：命令触发时没抓到（比如平台不支持 getUser）就用这个兜底
  const recordedAvatar = [...messages].reverse().find((message) => message.avatar)?.avatar
  const generated = await ctx.qqGroupLlm.analyzeUserPersona({
    userId: target.userId,
    username,
    messages: formatForPrompt(messages),
  })

  if (!generated) {
    log.warn(`${id} 的画像生成失败，${previous ? '保留已存画像' : '无已存画像可用'}`)
    return {
      persona: previous,
      avatar: target.avatar || recordedAvatar || record?.avatar,
      cached: !!previous,
      messageCount: messages.length,
      reason: 'LLM 未返回可用的画像结果',
    }
  }

  // 丢弃模型编造的 msgid，只保留真实存在的引用
  const known = new Map(messages.map((message) => [message.messageId || message.id, message]))
  const claimed = toArray(generated.evidence).map((item) => item.replace(/^msgid:/, '').trim())
  const evidence = claimed.filter((item) => known.has(item))
  const fabricated = claimed.filter((item) => !known.has(item))
  if (fabricated.length) {
    log.warn(`${id} 的画像引用了 ${fabricated.length} 个不存在的 msgid，已丢弃: ${fabricated.join(', ')}`)
  }

  const profile: UserPersonaProfile = { ...generated, evidence }
  log.debug(`${id} 本次画像: 特质 ${toArray(profile.keyTraits).length} 项 / ` +
    `兴趣 ${toArray(profile.interests).length} 项 / 证据 ${evidence.length}/${claimed.length} 条`)

  // 本次没抓到头像时依次回退到记录里的、库里的旧值，不要把已有的抹掉
  const avatar = target.avatar || recordedAvatar || record?.avatar || ''
  const now = new Date()
  await ctx.database.upsert(PERSONA_TABLE, [{
    id,
    platform: target.platform,
    userId: target.userId,
    username,
    avatar,
    persona: dump(profile, { indent: 2, lineWidth: -1, noRefs: true }),
    lastAnalysisAt: now,
    updatedAt: now,
  }])

  log.info(`用户画像 ${id} 已更新（完全由本次发言生成，未参考已存结论），` +
    `基于 ${messages.length} 条发言，总耗时 ${Date.now() - startedAt}ms`)
  return { persona: profile, avatar, cached: false, messageCount: messages.length }
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
