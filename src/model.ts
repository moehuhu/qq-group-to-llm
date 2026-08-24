import { Context } from 'koishi'

export const TABLE = 'qq_group_messages'
export const PERSONA_TABLE = 'qq_group_personas'

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

/** 一条持久化的用户画像，persona 字段存 YAML 文本，供下次分析作为历史输入 */
export interface PersonaRecord {
  /** `平台:用户 ID` */
  id: string
  platform: string
  userId: string
  username: string
  persona: string
  lastAnalysisAt: Date
  updatedAt: Date
}

declare module 'koishi' {
  interface Tables {
    qq_group_messages: MessageRecord
    qq_group_personas: PersonaRecord
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

  ctx.database.extend(PERSONA_TABLE, {
    id: 'string',
    platform: 'string',
    userId: 'string',
    username: 'string',
    persona: 'text',
    lastAnalysisAt: 'timestamp',
    updatedAt: 'timestamp',
  }, {
    primary: 'id',
  })
}
