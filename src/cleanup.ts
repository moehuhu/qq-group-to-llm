import { Context } from 'koishi'
import type { Config } from './types'

const CLEAN_INTERVAL = 6 * 60 * 60 * 1000 // 每 6 小时执行一次

/** 注册定时任务，删除超出保留期限的过期消息 */
export function applyRetentionCleanup(ctx: Context, config: Config) {
  if (config.retentionDays <= 0) return
  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000
  ctx.setInterval(async () => {
    const cutoff = new Date(Date.now() - retentionMs)
    try {
      await ctx.database.remove('qq_group_messages', { timestamp: { $lt: cutoff } })
    } catch (error) {
      ctx.logger.warn('清理过期消息失败:', error)
    }
  }, CLEAN_INTERVAL)
}
