import { Schema } from 'koishi'
import type { Config } from './types'

export const configSchema: Schema<Config> = Schema.object({
  listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
  groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表（listenAll 关闭时生效）'),
  recordBot: Schema.boolean().default(true).description('是否记录机器人自己发送的消息'),
  recordImages: Schema.boolean().default(false).description('是否记录图片消息（关闭时图片内容记录为"图片"）'),
  recordQuotes: Schema.boolean().default(true).description('是否记录引用消息的引用内容'),
  retentionDays: Schema.number().default(0).description('消息保留天数，0 表示永久保留').min(0),
  maxQuery: Schema.number().default(20).description('查询命令最多返回的消息条数').min(1).max(100),
})
