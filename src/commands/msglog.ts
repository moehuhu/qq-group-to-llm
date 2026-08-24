import { Context } from 'koishi'
import type { Config } from '../config'
import { TABLE } from '../database'
import { logger } from '../logger'
import { escapeMarkdown, toMarkdownMessage } from '../markdown'

/** msglog：查询最近的原始消息记录 */
export function applyLogCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
  ctx.command('msglog [count:number]', '查询最近的消息记录')
    .option('group', '-g <group:string>  指定群组 ID')
    .option('user', '-u <user:string>  指定用户 ID')
    .action(async ({ options, session }, count) => {
      const limit = Math.min(Math.max(count ?? config.maxQuery, 1), config.maxQuery)
      const query: Record<string, string> = {}
      const channelId = options?.group || session?.channelId
      if (channelId) query.channelId = channelId
      if (options?.user) query.userId = options.user

      log.info(`msglog 由 ${session?.userId} 在 ${session?.channelId} 发起，条件 ${JSON.stringify(query)}，limit=${limit}`)

      const records = await ctx.database
        .select(TABLE)
        .where(query)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute()

      log.info(`msglog 返回 ${records.length} 条记录`)
      if (!records.length) return '暂无消息记录'

      const lines = ['# 📜 最近消息记录', '']
      for (const record of records) {
        const time = record.timestamp.toLocaleString('zh-CN', { hour12: false })
        lines.push(`- **${escapeMarkdown(record.username || record.userId)}** (${time})`)
        lines.push(`  ${escapeMarkdown(record.content)}`)
      }
      return toMarkdownMessage(lines.join('\n'))
    })
}
