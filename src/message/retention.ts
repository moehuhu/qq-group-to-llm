import { Context } from 'koishi'
import type { Config } from '../config'
import { MEDIA_TABLE, TABLE } from '../database'
import { logger } from '../logger'
import { createTimeFormatter } from '../time'

const CLEAN_INTERVAL = 6 * 60 * 60 * 1000 // 每 6 小时执行一次

/** 注册定时任务，删除超出保留期限的过期消息 */
export function applyRetentionCleanup(ctx: Context, config: Config) {
  const log = logger(ctx)

  if (config.retentionDays <= 0 && config.mediaRetentionDays <= 0) {
    log.info('消息永久保留，未启用定期清理')
    return
  }

  log.info(`定期清理已启用：消息保留 ${config.retentionDays > 0 ? `${config.retentionDays} 天` : '永久'}，` +
    `图片缓存保留 ${config.mediaRetentionDays > 0 ? `${config.mediaRetentionDays} 天` : '永久'}，` +
    `每 ${CLEAN_INTERVAL / 3600000} 小时执行一次`)

  ctx.setInterval(async () => {
    const startedAt = Date.now()
    try {
      const removed: string[] = []
      if (config.retentionDays > 0) {
        const cutoff = new Date(Date.now() - config.retentionDays * 24 * 60 * 60 * 1000)
        const result = await ctx.database.remove(TABLE, { timestamp: { $lt: cutoff } })
        removed.push(`消息 ${result.removed ?? 0} 条`)
      }
      if (config.mediaRetentionDays > 0) {
        const cutoff = new Date(Date.now() - config.mediaRetentionDays * 24 * 60 * 60 * 1000)
        const result = await ctx.database.remove(MEDIA_TABLE, { updatedAt: { $lt: cutoff } })
        removed.push(`图片缓存 ${result.removed ?? 0} 条`)
      }
      log.info(`清理完成：${removed.join('，')}，耗时 ${Date.now() - startedAt}ms`)
    } catch (error) {
      log.warn('清理过期消息失败:', error)
    }
  }, CLEAN_INTERVAL)
}
