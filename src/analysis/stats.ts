import type { MessageRecord } from '../database'
import type { UserStats } from '../types'

/** 序列化内容中代表表情/图片、引用的占位符 */
const MEDIA_PATTERN = /\[(图片|face|image|img|sticker|mface)\]/
const QUOTE_PATTERN = /\[引用\]/

/** 累加中的计数，不对外暴露 */
interface Accumulator {
  userId: string
  username: string
  messageCount: number
  charCount: number
  nightCount: number
  mediaCount: number
  quoteCount: number
}

/** 基于已序列化的消息文本统计发言数据 */
export function calculateStats(messages: MessageRecord[]) {
  const accumulators: Record<string, Accumulator> = {}
  const activeHours: Record<number, number> = {}
  let totalChars = 0

  for (const message of messages) {
    const userId = message.userId
    if (!userId) continue

    accumulators[userId] ??= {
      userId,
      username: userId,
      messageCount: 0,
      charCount: 0,
      nightCount: 0,
      mediaCount: 0,
      quoteCount: 0,
    }
    const acc = accumulators[userId]
    if (message.username) acc.username = message.username

    const hour = message.timestamp.getHours()
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
    messageCount: acc.messageCount,
    charCount: acc.charCount,
    avgChars: ratio(acc.charCount, acc.messageCount),
    nightRatio: ratio(acc.nightCount, acc.messageCount),
    emojiRatio: ratio(acc.mediaCount, acc.messageCount),
    replyRatio: ratio(acc.quoteCount, acc.messageCount),
  })).sort((a, b) => b.messageCount - a.messageCount)

  const busiest = Object.entries(activeHours).sort((a, b) => b[1] - a[1])[0]
  const mostActivePeriod = busiest
    ? `${busiest[0].padStart(2, '0')}:00 - ${String(Number(busiest[0]) + 1).padStart(2, '0')}:00`
    : undefined

  return { userStats, totalChars, mostActivePeriod }
}
