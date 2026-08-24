import { Context } from 'koishi'
import type { Config } from './config'
import { TABLE } from './model'

/** 注册 msglog 命令，查询最近的消息记录 */
export function applyQueryCommand(ctx: Context, config: Config) {
  ctx.command('msglog [count:number]', '查询最近的消息记录')
    .option('group', '-g <group:string>  指定群组 ID')
    .option('user', '-u <user:string>  指定用户 ID')
    .action(async ({ options, session }, count) => {
      const limit = Math.min(Math.max(count ?? config.maxQuery, 1), config.maxQuery)
      const query: Record<string, string> = {}
      const channelId = options?.group || session?.channelId
      if (channelId) query.channelId = channelId
      if (options?.user) query.userId = options.user

      const records = await ctx.database
        .select(TABLE)
        .where(query)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute()

      if (!records.length) return '暂无消息记录'

      return records.map((record) => {
        const time = record.timestamp.toLocaleString('zh-CN', { hour12: false })
        return `[${time}] ${record.username || record.userId}: ${record.content}`
      }).join('\n')
    })
}
