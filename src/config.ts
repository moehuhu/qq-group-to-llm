import { Schema } from 'koishi'

export interface Config {
  /** 监听所有群组（true 时忽略 groups 配置） */
  listenAll: boolean
  /** 需要记录的群组列表（listenAll 为 false 时生效） */
  groups: string[]
  /** 记录图片消息内容（否则仅记录 "图片" 占位符） */
  recordImages: boolean
  /** 记录引用消息 */
  recordQuotes: boolean
  /** 消息保留天数（0 表示永久保留） */
  retentionDays: number
  /** 查询时最多返回的消息条数 */
  maxQuery: number
}

export const Config: Schema<Config> = Schema.object({
  listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
  groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表（listenAll 关闭时生效）'),
  recordImages: Schema.boolean().default(false).description('是否记录图片消息（关闭时图片内容记录为"图片"）'),
  recordQuotes: Schema.boolean().default(true).description('是否记录引用消息的引用内容'),
  retentionDays: Schema.number().default(0).description('消息保留天数，0 表示永久保留').min(0),
  maxQuery: Schema.number().default(20).description('查询命令最多返回的消息条数').min(1).max(100),
})
