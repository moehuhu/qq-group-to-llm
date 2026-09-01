import type { AvatarBook } from '../avatar'
import type { MessageRecord } from '../database'
import type { TimeFormatter } from '../time'
import type { UserStats } from '../types'

/** 序列化内容中代表表情/图片、引用的占位符 */
const MEDIA_PATTERN = /\[(图片|face|image|img|sticker|mface)\]/
/** 引用预览带发言人时是 `[引用 张三]`，关掉 recordQuotes 时只有 `[引用]`，两种都算 */
const QUOTE_PATTERN = /\[引用(?: [^\]]*)?\]/

/** 累加中的计数，不对外暴露 */
interface Accumulator {
  userId: string
  username: string
  avatar: string
  messageCount: number
  charCount: number
  nightCount: number
  mediaCount: number
  quoteCount: number
}

/**
 * 基于已序列化的消息文本统计发言数据。
 * 整点由传入的格式化器决定，好让分桶和报告里展示的时间落在同一个时区。
 *
 * 活跃榜要出头像，而头像已改为按人存进映射表（见 avatar.ts）——给了 avatars 就从表里取，
 * 表里没有的人退回消息行自带的地址（升级前落的老记录才有）。
 */
export function calculateStats(messages: MessageRecord[], time: TimeFormatter, avatars?: AvatarBook) {
  const accumulators: Record<string, Accumulator> = {}
  const activeHours: Record<number, number> = {}
  let totalChars = 0

  for (const message of messages) {
    const userId = message.userId
    if (!userId) continue

    accumulators[userId] ??= {
      userId,
      username: userId,
      avatar: '',
      messageCount: 0,
      charCount: 0,
      nightCount: 0,
      mediaCount: 0,
      quoteCount: 0,
    }
    const acc = accumulators[userId]
    // messages 按时间正序，后写的覆盖先写的，最终留下最近一次的昵称与头像
    if (message.username) acc.username = message.username
    const avatar = avatars?.avatarOf(message) || message.avatar
    if (avatar) acc.avatar = avatar

    const hour = time.hour(message.timestamp)
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
    avatar: acc.avatar || undefined,
    messageCount: acc.messageCount,
    charCount: acc.charCount,
    avgChars: ratio(acc.charCount, acc.messageCount),
    nightRatio: ratio(acc.nightCount, acc.messageCount),
    emojiRatio: ratio(acc.mediaCount, acc.messageCount),
    replyRatio: ratio(acc.quoteCount, acc.messageCount),
  })).sort((a, b) => b.messageCount - a.messageCount)

  const busiest = Object.entries(activeHours).sort((a, b) => b[1] - a[1])[0]
  const mostActivePeriod = busiest
    ? `${busiest[0].padStart(2, '0')}:00 - ${String((Number(busiest[0]) + 1) % 24).padStart(2, '0')}:00`
    : undefined

  // 定长 24 项，没人说话的整点也要占位，否则柱状图会缺格
  const hourly = Array.from({ length: 24 }, (_, hour) => activeHours[hour] ?? 0)

  return { userStats, totalChars, mostActivePeriod, hourly }
}
