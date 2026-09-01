import { Context } from 'koishi'
import type { Config } from '../config'
import { TABLE } from '../database'
import { logger } from '../logger'
import { createTimeFormatter } from '../time'

const CLEAN_INTERVAL = 6 * 60 * 60 * 1000 // 每 6 小时执行一次

/** 注册定时任务，删除超出保留期限的过期消息 */
export function applyRetentionCleanup(ctx: Context, config: Config) {
  const log = logger(ctx)

  if (config.retentionDays <= 0) {
    log.info('消息永久保留，未启用定期清理')
    return
  }

  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000
  log.info(`定期清理已启用，保留 ${config.retentionDays} 天，每 ${CLEAN_INTERVAL / 3600000} 小时执行一次`)

  ctx.setInterval(async () => {
    const cutoff = new Date(Date.now() - retentionMs)
    const startedAt = Date.now()
    try {
      // 只删消息。头像映射表（qq_group_avatars）不跟着清：人还在群里脸就还该在，
      // 一行不过百余字节，而它一旦删了，老消息清空之后那张脸就再也找不回来了
      const result = await ctx.database.remove(TABLE, { timestamp: { $lt: cutoff } })
      const removed = (result as { removed?: number })?.removed
      log.info(`清理完成，删除 ${removed ?? '未知数量'} 条 ${createTimeFormatter(config.timezone).dateTime(cutoff)} 之前的消息，耗时 ${Date.now() - startedAt}ms`)
    } catch (error) {
      log.warn('清理过期消息失败:', error)
    }
  }, CLEAN_INTERVAL)
}
