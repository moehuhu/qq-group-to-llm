/** 数据表名与记录类型；建表逻辑见 ./index.ts */

export const TABLE = 'qq_group_messages'
export const PERSONA_TABLE = 'qq_group_personas'
export const AVATAR_TABLE = 'qq_group_avatars'

export interface MessageRecord {
  id: string
  platform: string
  selfId: string
  channelId?: string
  guildId?: string
  userId?: string
  username: string
  /**
   * 旧记录里的头像地址。头像已改为按人存进 qq_group_avatars（一人一行，
   * 不再逐条重复一份长地址），新记录这里恒为空串；升级前落的老记录仍留着地址，
   * 映射表里查不到人时拿它兜底。
   */
  avatar: string
  content: string
  /** 消息图片缓存：原始 URL → data URL，JSON 文本存储 */
  media: string
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

/**
 * 一个人的头像：`平台:用户 ID` → 最近一次见到的头像地址。
 *
 * 单独一张表而不是逐条消息存一份：QQ 的头像地址动辄七八十个字符，
 * 一个人说一万句就重复一万遍；投喂给模型时也只发映射表里的短编号（见 avatar.ts）。
 * 消息按 retentionDays 清掉之后这里仍留着，出图时那张脸不会跟着消息一起消失。
 */
export interface AvatarRecord {
  /** `平台:用户 ID` */
  id: string
  platform: string
  userId: string
  /** 最近一次见到的昵称，模型只抄回昵称时用它认人 */
  username: string
  avatar: string
  /** 头像或昵称变动的时间，同一张脸重复出现不会刷新它 */
  updatedAt: Date
}

declare module 'koishi' {
  interface Tables {
    qq_group_messages: MessageRecord
    qq_group_personas: PersonaRecord
    qq_group_avatars: AvatarRecord
  }
}
