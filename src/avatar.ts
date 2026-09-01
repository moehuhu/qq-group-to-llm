/**
 * 头像映射表：「用户 ID ↔ 头像地址」的对应关系单独存一份，别处只传一个短编号。
 *
 * 起因是高光对话要出图，得知道每轮发言人的头像。原先的做法是把头像地址写进每一条
 * 消息记录，投喂时再一并发给模型、让它照抄回来——QQ 的头像地址动辄七八十个字符
 * （官方平台的 openid 形态更长），一个人说一万句就在库里重复一万遍，
 * 几百条记录光头像就能占掉上万字符的上下文，而且长地址模型抄着抄着就抄串行。
 *
 * 现在一人一行存进 qq_group_avatars，两头都只走编号：
 * - 落库：recorder 见到新的脸才写一次（rememberAvatar），消息行不再带地址；
 * - 投喂：每条只带表里的短编号 `u1`，模型抄回编号，出图前再还原成地址（resolve）。
 *
 * 上半截（buildAvatarBook 与它返回的表）是纯函数，不碰数据库；
 * 下半截（loadAvatarBook / rememberAvatar）负责与 qq_group_avatars 打交道。
 */
import { Context } from 'koishi'
import { AVATAR_TABLE, type AvatarRecord, type MessageRecord } from './database'
import { logger } from './logger'

/** 表里的一行：短编号 ↔ 用户 ID ↔ 头像地址 */
export interface AvatarEntry {
  /** 投喂给模型的短编号，形如 `u1`，仅在本次分析内有效 */
  uid: string
  /** 用户 ID；平台没给时退回昵称——认人总得有个键 */
  userId: string
  /** 最近一次见到的昵称，用于模型只抄回昵称时兜底 */
  username: string
  /** 头像地址，非空 */
  avatar: string
}

/** 建表要的最小信息：一条消息，或任何带用户 ID 与昵称的东西 */
export type AvatarSubject = Pick<MessageRecord, 'userId' | 'username'> | { userId?: string, username?: string }

/** 判断模型抄回来的是不是一个完整的头像地址（用户改过提示词、仍让模型抄地址时会遇到） */
const IS_URL = /^(https?:)?\/\//i

export interface AvatarBook {
  /** 表里的全部行，按编号分配顺序（即首次发言顺序） */
  readonly entries: readonly AvatarEntry[]
  /** 表里有几个人 */
  readonly size: number
  /** 若把头像地址逐条写进提示词，这些地址一共要占多少字符——日志里用它说明省了多少 */
  readonly inlineChars: number
  /** 取某人的编号；没有头像的人不进表，也就没有编号 */
  uidOf(subject: AvatarSubject): string | undefined
  /** 取某人的头像地址，取不到返回 undefined（渲染层退回首字色块） */
  avatarOf(subject: AvatarSubject): string | undefined
  /**
   * 把模型抄回来的标记还原成头像地址。编号、用户 ID、昵称都认，
   * 已经是完整地址的原样放行；都对不上时按 sender 昵称再找一次，找不到返回 undefined
   * （渲染层会退回首字色块，不至于挂错脸）。
   */
  resolve(token?: string | null, sender?: string | null): string | undefined
}

/** 认人用的键：优先用户 ID，平台没给就退昵称 */
function identity(subject: AvatarSubject): string {
  return subject.userId || subject.username || ''
}

/** 一行的主键：头像按平台分开存，不同平台的同一串 ID 不是同一个人 */
export function avatarKey(platform: string, userId: string): string {
  return `${platform}:${userId}`
}

/**
 * 建一张本次分析用的头像映射表。
 *
 * 只收 messages 里出现过的人：投喂时不该出现没人用得上的编号。
 * 头像地址优先取 stored（qq_group_avatars 里按人存的那份，最新），
 * 表里没这个人时才退回消息行自带的地址——那是升级前落的老记录。
 * 编号在首次露面时分配，之后不变；一个头像都没有的人不进表。
 */
export function buildAvatarBook(
  messages: MessageRecord[],
  stored: readonly AvatarRecord[] = [],
): AvatarBook {
  const known = new Map(stored.map((record) => [record.userId, record]))
  const byUserId = new Map<string, AvatarEntry>()

  for (const message of messages) {
    const userId = identity(message)
    if (!userId) continue
    const entry = byUserId.get(userId)
    if (entry) {
      // messages 按时间正序，后见到的昵称覆盖先见到的；
      // 地址只在表里没这个人、靠老记录兜底时才跟着往后更新
      if (message.username) entry.username = message.username
      if (!known.has(userId) && message.avatar?.trim()) entry.avatar = message.avatar.trim()
      continue
    }
    const avatar = known.get(userId)?.avatar?.trim() || message.avatar?.trim() || ''
    if (!avatar) continue
    byUserId.set(userId, {
      uid: `u${byUserId.size + 1}`,
      userId,
      username: message.username || known.get(userId)?.username || userId,
      avatar,
    })
  }

  const entries = [...byUserId.values()]
  const byUid = new Map(entries.map((entry) => [entry.uid, entry]))

  // 昵称索引只收「独此一人」的昵称：同名的两个人各有各的脸，认错不如不认
  const byName = new Map<string, AvatarEntry | null>()
  for (const entry of entries) {
    const name = entry.username.trim()
    if (!name) continue
    byName.set(name, byName.has(name) ? null : entry)
  }

  // 逐条写地址原本要占多少字符，等表建完再数一遍，免得中途换头像算错
  const inlineChars = messages.reduce(
    (sum, message) => sum + (byUserId.get(identity(message))?.avatar.length ?? 0),
    0,
  )

  return {
    entries,
    size: entries.length,
    inlineChars,
    uidOf: (subject) => byUserId.get(identity(subject))?.uid,
    avatarOf: (subject) => byUserId.get(identity(subject))?.avatar,
    resolve: (token, sender) => {
      const raw = String(token ?? '').trim()
      if (raw) {
        if (IS_URL.test(raw)) return raw
        const hit = byUid.get(raw) || byUserId.get(raw) || byName.get(raw)
        if (hit) return hit.avatar
      }
      const name = String(sender ?? '').trim()
      return (name && byName.get(name)?.avatar) || undefined
    },
  }
}

/**
 * 从 qq_group_avatars 把这批消息里出现过的人的头像捞出来，建表。
 *
 * 读表失败不该让整次分析失败：退回消息行里的老地址，最差也就是几张脸变成首字色块。
 */
export async function loadAvatarBook(ctx: Context, messages: MessageRecord[]): Promise<AvatarBook> {
  const ids = [...new Set(
    messages.filter((message) => message.userId).map((message) => avatarKey(message.platform, message.userId!)),
  )]
  if (!ids.length) return buildAvatarBook(messages)
  try {
    const stored = await ctx.database.get(AVATAR_TABLE, { id: { $in: ids } })
    return buildAvatarBook(messages, stored)
  } catch (error) {
    logger(ctx).warn('读取头像映射表失败，本次退回消息行里的头像:', error)
    return buildAvatarBook(messages)
  }
}

/**
 * 见过的脸：`平台:用户 ID` → 已落库的「昵称 + 头像」。
 * 跟着插件走，卸载即丢——它只是为了别让每条消息都去写一次库。
 */
export type AvatarCache = Map<string, string>

/** 记得住的人数上限。群成员再多也用不满，纯粹防着长期跑下来无限涨 */
const AVATAR_CACHE_LIMIT = 2000

/**
 * 把一个人的头像记进 qq_group_avatars。
 *
 * 消息是热路径，每条都写一次库太亏，所以先比对内存里的缓存：
 * 同一张脸配同一个昵称就直接跳过，只有新面孔、换了头像或改了昵称才落一次 upsert。
 * 插件重启后缓存是空的，每人会多写一次——一次而已，不值得为它再存点什么。
 */
export async function rememberAvatar(
  ctx: Context,
  cache: AvatarCache,
  who: { platform: string, userId?: string, username?: string, avatar?: string },
): Promise<void> {
  const avatar = String(who.avatar ?? '').trim()
  if (!who.userId || !avatar) return
  const id = avatarKey(who.platform, who.userId)
  const username = String(who.username ?? '').trim() || who.userId
  const signature = `${username}\n${avatar}`
  if (cache.get(id) === signature) return

  try {
    await ctx.database.upsert(AVATAR_TABLE, [{
      id,
      platform: who.platform,
      userId: who.userId,
      username,
      avatar,
      updatedAt: new Date(),
    }])
  } catch (error) {
    // 头像写不进去只是回头出图少张脸，不该影响消息记录本身
    logger(ctx).warn(`记录 ${id} 的头像失败:`, error)
    return
  }

  // 先删再塞，让它排到队尾；满了先扔最久没露过面的那个
  cache.delete(id)
  cache.set(id, signature)
  if (cache.size > AVATAR_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
}

/** 单独查一个人的头像，查不到返回 undefined。用户画像这类只认识一个人的场景用它 */
export async function findAvatar(
  ctx: Context,
  platform: string,
  userId: string | undefined,
): Promise<string | undefined> {
  if (!userId) return undefined
  try {
    const [record] = await ctx.database.get(AVATAR_TABLE, { id: avatarKey(platform, userId) })
    return record?.avatar?.trim() || undefined
  } catch (error) {
    logger(ctx).warn(`读取 ${platform}:${userId} 的头像失败:`, error)
    return undefined
  }
}
