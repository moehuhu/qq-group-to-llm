import { Context } from 'koishi'
import { load } from 'js-yaml'
import type { Config } from '../config'
import { logger } from '../logger'
import type { QueueTicket } from '../llm'
import { MessageRecord, PERSONA_TABLE, PersonaRecord, TABLE } from '../database'
import { findAvatar } from '../avatar'
import { resolveTimeFormatter, type TimeFormatter } from '../time'
import { cleanContent } from '../text'
import { buildMediaBook, inlineMediaTexts, type MediaBook, resolveMediaTokens, toPromptJson } from '../transcript'
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
  return records.reverse().map((record) => ({
    ...record,
    content: cleanContent(record.content, config.recordImages),
  }))
}

/**
 * 渲染成投喂给 LLM 的 JSON 数组字符串。每条消息带归属标记（群/频道）与发送者昵称，
 * 模型据此判断每句的归属；evidence 由模型照抄原文，不含发送者（画像针对同一人）。
 *
 * 给了媒体映射表时，正文里的图片占位符换成短编号 `[图片:m1]`，地址只留在表里
 * （与高光对话同一套，见 transcript.ts 的 MediaBook）：QQ 的图片地址动辄一两百字符，
 * 逐条展开既烧上下文，长地址还容易被模型抄串行——抄串了出图时就查不到那张图。
 */
function formatForPrompt(messages: MessageRecord[], time: TimeFormatter, medias?: MediaBook): string {
  return toPromptJson(messages, time, { medias, withScope: true, withDate: true })
}

async function loadRecord(ctx: Context, id: string): Promise<PersonaRecord | undefined> {
  const [record] = await ctx.database.select(PERSONA_TABLE).where({ id }).execute()
  return record
}

function parsePersona(ctx: Context, record?: PersonaRecord): UserPersonaProfile | null {
  const log = logger(ctx)
  if (!record?.persona) return null

  let profile: UserPersonaProfile | null = null
  // 新格式是 JSON 字符串；旧缓存是 YAML，解析失败时回退
  try {
    profile = JSON.parse(record.persona) as UserPersonaProfile
  } catch {
    try {
      profile = load(record.persona) as UserPersonaProfile
    } catch (error) {
      log.warn(`解析已存画像失败 (${record.id})，将忽略:`, error)
      return null
    }
  }
  if (!profile) return null

  // 规整旧缓存：evidence 曾存过 msgid 字符串与 {sender, content} 对象，统一压成原文数组
  if (Array.isArray(profile.evidence)) {
    profile.evidence = (profile.evidence as unknown[])
      .map((item) => {
        const text = item && typeof item === 'object' ? String((item as { content?: unknown })?.content ?? '') : String(item ?? '')
        return text.trim()
      })
      .filter(Boolean)
  } else {
    profile.evidence = []
  }
  return profile
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

/** 生成（或复用）用户画像。图片还是原始地址，出图前由 resolvePersona 换成 media 表里的缓存 */
async function generatePersona(
  ctx: Context,
  config: Config,
  target: PersonaTarget,
  force = false,
  ticket?: QueueTicket,
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

  // 头像存在映射表里（一人一行，见 avatar.ts）：命令触发时平台没给（比如不支持 getUser）就靠它
  const mapped = await findAvatar(ctx, target.platform, target.userId)
  /**
   * 头像按新鲜度取：命令触发时刚抓到的 → 映射表里的 → 老消息行自带的 → 画像里存的旧值。
   * recorded 只在取过消息之后才有值（且只可能来自升级前落的记录，新记录不带地址）。
   */
  const pickAvatar = (recorded?: string) =>
    target.avatar || mapped || recorded || record?.avatar || undefined

  if (!force && previous && isFresh(record, config.personaCacheDays)) {
    log.info(`命中画像缓存 ${id}（personaCacheDays=${config.personaCacheDays} 天内），跳过 LLM 调用`)
    return { persona: previous, avatar: pickAvatar(), cached: true, messageCount: 0 }
  }

  const messages = await collectMessages(ctx, config, target)
  if (messages.length < config.personaMinMessages) {
    log.info(`${id} 发言 ${messages.length} 条不足 personaMinMessages=${config.personaMinMessages}，` +
      `${previous ? '回落到已存画像' : '无已存画像可用'}`)
    // 本次无法生成，有旧画像时返回旧的总比什么都没有好
    return {
      persona: previous,
      avatar: pickAvatar(messages.find((message) => message.avatar)?.avatar),
      cached: !!previous,
      messageCount: messages.length,
      reason: `最近 ${config.personaLookbackDays} 天只有 ${messages.length} 条发言，` +
        `不足 ${config.personaMinMessages} 条`,
    }
  }

  const username = messages[messages.length - 1].username || target.username
  // 升级前的老记录里还带着发言当时的头像，映射表没有这个人时拿它兜底
  const recordedAvatar = [...messages].reverse().find((message) => message.avatar)?.avatar
  // 代表发言里可能带图。图片地址不进提示词：换成短编号 `[图片:m1]`，模型照抄编号，
  // 拿回来再按表还原成地址——地址长得离谱，直接给模型抄十有八九抄串行
  const medias = buildMediaBook(messages)
  if (medias.tokens.size) {
    log.info(`${id} 的发言里有 ${medias.tokens.size} 张图，投喂时以短编号代替地址`)
  }
  const generated = await ctx.qqGroupLlm.analyzeUserPersona({
    userId: target.userId,
    username,
    messages: formatForPrompt(messages, resolveTimeFormatter(ctx, config.timezone), medias),
  }, ticket)

  if (!generated) {
    log.warn(`${id} 的画像生成失败，${previous ? '保留已存画像' : '无已存画像可用'}`)
    return {
      persona: previous,
      avatar: pickAvatar(recordedAvatar),
      cached: !!previous,
      messageCount: messages.length,
      reason: 'LLM 未返回可用的画像结果',
    }
  }

  // 丢弃空的原话，只保留能展示的引用（画像针对同一人，只保留原文，不含发送者）
  const rawEvidence = (Array.isArray(generated.evidence) ? generated.evidence : []) as unknown[]
  const evidence = rawEvidence
    .map((item) => {
      // 兼容旧形态 {sender, content}：只取 content
      const text = item && typeof item === 'object' ? String((item as { content?: unknown })?.content ?? '') : String(item ?? '')
      // 模型抄回来的是图片短编号，按表还原成 `[图片](url)`——库里存的就是这个形态
      return resolveMediaTokens(text.trim(), medias)
    })
    .filter(Boolean)
  if (evidence.length < rawEvidence.length) {
    log.warn(`${id} 的画像有 ${rawEvidence.length - evidence.length} 条证据为空，已丢弃`)
  }

  const profile: UserPersonaProfile = { ...generated, evidence }
  log.debug(`${id} 本次画像: 特质 ${toArray(profile.keyTraits).length} 项 / ` +
    `兴趣 ${toArray(profile.interests).length} 项 / 证据 ${evidence.length}/${rawEvidence.length} 条`)

  // 本次没抓到头像时依次回退到映射表、老记录、库里的旧值，不要把已有的抹掉
  const avatar = pickAvatar(recordedAvatar) || ''
  const now = new Date()
  await ctx.database.upsert(PERSONA_TABLE, [{
    id,
    platform: target.platform,
    userId: target.userId,
    username,
    avatar,
    persona: JSON.stringify(profile),
    lastAnalysisAt: now,
    updatedAt: now,
  }])

  log.info(`用户画像 ${id} 已更新（完全由本次发言生成，未参考已存结论），` +
    `基于 ${messages.length} 条发言，总耗时 ${Date.now() - startedAt}ms`)
  return { persona: profile, avatar, cached: false, messageCount: messages.length }
}

/**
 * 生成（或复用）用户画像，并把代表发言里的图片换成 media 表里缓存的那张图。
 *
 * 库里存的一直是原始图片地址：短，且与消息同寿——把 base64 的图片数据塞进画像表，
 * 一条画像就能涨到几百 KB。出图前才换成缓存的图片数据：QQ 的图链只活几小时，
 * 直接拿地址渲染，命中缓存的旧画像几乎必然拉不到图（渲染层只剩一枚「图片」小标签）。
 * 缓存路径与新生成路径都走这一趟，所以放在最外层。
 */
export async function resolvePersona(
  ctx: Context,
  config: Config,
  target: PersonaTarget,
  force = false,
  ticket?: QueueTicket,
): Promise<PersonaOutcome> {
  const outcome = await generatePersona(ctx, config, target, force, ticket)
  const persona = outcome.persona
  if (!persona?.evidence?.length) return outcome
  return {
    ...outcome,
    persona: {
      ...persona,
      evidence: await inlineMediaTexts(ctx, target.platform, persona.evidence),
    },
  }
}
