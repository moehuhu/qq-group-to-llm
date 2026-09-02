import { Context } from 'koishi'
import { AVATAR_TABLE, MEDIA_TABLE, PERSONA_TABLE, TABLE } from './tables'

export * from './tables'

/** 声明插件用到的数据表 */
export function extendModel(ctx: Context) {
  ctx.database.extend(TABLE, {
    id: 'string',
    platform: 'string',
    selfId: 'string',
    channelId: 'string',
    guildId: 'string',
    userId: 'string',
    username: 'string',
    avatar: 'text',
    content: 'text',
    timestamp: 'timestamp',
    messageId: 'string',
  }, {
    primary: 'id',
  })

  ctx.database.extend(AVATAR_TABLE, {
    id: 'string',
    platform: 'string',
    userId: 'string',
    username: 'string',
    avatar: 'text',
    updatedAt: 'timestamp',
  }, {
    primary: 'id',
  })

  ctx.database.extend(MEDIA_TABLE, {
    id: 'string',
    platform: 'string',
    url: 'text',
    data: 'text',
    mime: 'string',
    updatedAt: 'timestamp',
  }, {
    primary: 'id',
  })

  ctx.database.extend(PERSONA_TABLE, {
    id: 'string',
    platform: 'string',
    userId: 'string',
    username: 'string',
    avatar: 'text',
    persona: 'text',
    lastAnalysisAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    primary: 'id',
  })
}
