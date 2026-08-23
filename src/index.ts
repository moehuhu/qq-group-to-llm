import { Context } from 'koishi'
import type { Config } from './types'
import { applyMessageListener } from './listener'
import { applyQueryCommand } from './command'
import { applyRetentionCleanup } from './cleanup'

export * from './types'
export { configSchema as Config } from './config'

export const name = 'message-log'
export const inject = ['database'];
export const apply = Object.assign(function apply(ctx: Context, config: Config) {
  ctx.database.extend('chaoli_group_messages', {
    id: 'string',
    platform: 'string',
    selfId: 'string',
    channelId: 'string',
    guildId: 'string',
    userId: 'string',
    username: 'string',
    content: 'text',
    timestamp: 'timestamp',
    messageId: 'string',
  }, {
    primary: 'id',
  })

  applyMessageListener(ctx, config)
  applyQueryCommand(ctx, config)
  applyRetentionCleanup(ctx, config)
})
