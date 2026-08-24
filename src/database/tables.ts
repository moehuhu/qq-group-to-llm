/** 数据表名与记录类型；建表逻辑见 ./index.ts */

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
