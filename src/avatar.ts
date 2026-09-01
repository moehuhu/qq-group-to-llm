/**
 * 头像映射表：把「用户 ID ↔ 头像地址」的对应关系留在本地，投喂给模型的记录里只放一个短编号。
 *
 * 起因是高光对话要出图，得知道每轮发言人的头像。原先的做法是把头像地址写进每一条投喂记录，
 * 再让模型照抄回来——QQ 的头像地址动辄七八十个字符（官方平台的 openid 形态更长），
 * 几百条记录光头像就能占掉上万字符的上下文，而且长地址模型抄着抄着就抄错、抄串行。
 *
 * 改成给每个有头像的人发一个 `u1` 这样的编号：投喂时只带编号，模型抄回编号，
 * 落地时再由这张表还原成真正的地址。地址一次都不进提示词。
 *
 * 纯函数模块，不依赖任何服务；表随一次分析构建、用完即弃——
 * 头像本来就随每条消息落库，没必要再持久化一份。
 */
import type { MessageRecord } from './database'

/** 表里的一行：短编号 ↔ 用户 ID ↔ 头像地址 */
export interface AvatarEntry {
  /** 投喂给模型的短编号，形如 `u1`，仅在本次分析内有效 */
  uid: string
  /** 用户 ID；平台没给时退回昵称——认人总得有个键 */
  userId: string
  /** 该用户最近一次发言时的昵称，用于模型只抄回昵称时兜底 */
  username: string
  /** 最近一次发言时的头像地址，非空 */
  avatar: string
}

/** 判断模型抄回来的是不是一个完整的头像地址（用户改过提示词、仍让模型抄地址时会遇到） */
const IS_URL = /^(https?:)?\/\//i

export interface AvatarBook {
  /** 表里的全部行，按编号分配顺序（即首次发言顺序） */
  readonly entries: readonly AvatarEntry[]
  /** 表里有几个人 */
  readonly size: number
  /** 若把头像地址逐条写进提示词，这些地址一共要占多少字符——日志里用它说明省了多少 */
  readonly inlineChars: number
  /** 取某条记录的发言人编号；没有头像的人不进表，也就没有编号 */
  uidOf(message: Pick<MessageRecord, 'userId' | 'username'>): string | undefined
  /**
   * 把模型抄回来的标记还原成头像地址。编号、用户 ID、昵称都认，
   * 已经是完整地址的原样放行；都对不上时按 sender 昵称再找一次，找不到返回 undefined
   * （渲染层会退回首字色块，不至于挂错脸）。
   */
  resolve(token?: string | null, sender?: string | null): string | undefined
}

/** 认人用的键：优先用户 ID，平台没给就退昵称 */
function identity(message: Pick<MessageRecord, 'userId' | 'username'>): string {
  return message.userId || message.username || ''
}

/**
 * 从一批消息里建头像映射表。
 *
 * 同一个人可能换过头像，取时间上最后一次的那张（messages 已按时间正序）；
 * 编号在首次露面时分配，之后不变。没有头像的人不进表。
 */
export function buildAvatarBook(messages: MessageRecord[]): AvatarBook {
  const byUserId = new Map<string, AvatarEntry>()
  let inlineChars = 0

  for (const message of messages) {
    const avatar = message.avatar?.trim()
    if (!avatar) continue
    const userId = identity(message)
    if (!userId) continue
    inlineChars += avatar.length
    const known = byUserId.get(userId)
    if (known) {
      known.avatar = avatar
      if (message.username) known.username = message.username
      continue
    }
    byUserId.set(userId, {
      uid: `u${byUserId.size + 1}`,
      userId,
      username: message.username || userId,
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

  return {
    entries,
    size: entries.length,
    inlineChars,
    uidOf: (message) => byUserId.get(identity(message))?.uid,
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
