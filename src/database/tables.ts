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
  /** 发言时的头像地址，用于渲染图片；平台没给就是空串 */
  avatar: string
  content: string
  timestamp: Date
  messageId: string
}

/** 一条持久化的用户画像，persona 字段存 JSON 文本（旧缓存可能是 YAML），仅用于缓存复用与展示 */
export interface PersonaRecord {
  /** `平台:用户 ID` */
  id: string
  platform: string
  userId: string
  username: string
  /** 头像地址，命令触发时从会话或平台接口取得 */
  avatar: string
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
