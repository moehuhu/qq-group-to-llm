import { Context } from 'koishi'

export const TABLE = 'qq_group_messages'

export interface MessageRecord {
  id: string
  platform: string
  selfId: string
  channelId?: string
  guildId?: string
  userId?: string
  username: string
  content: string
  timestamp: Date
  messageId: string
}

declare module 'koishi' {
  interface Tables {
    qq_group_messages: MessageRecord
  }
}

/** 声明消息记录表结构 */
export function extendModel(ctx: Context) {
  ctx.database.extend(TABLE, {
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
}
