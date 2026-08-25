import { Schema } from 'koishi'
import * as prompts from './prompts'

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

  /** OpenAI 兼容 API 地址 */
  openaiEndpoint: string
  /** API Key */
  openaiApiKey: string
  /** 模型名称 */
  openaiModel: string
  /** 采样温度 */
  temperature: number

  /** 默认分析天数 */
  analysisDays: number
  /** 单次分析最多取用的消息条数 */
  maxMessages: number
  /** 触发分析所需的最小消息条数 */
  minMessages: number
  /** 分析结果缓存分钟数（0 表示不缓存） */
  cacheMinutes: number
  /** 报告中展示的活跃用户数 */
  maxUsersInReport: number
  /** 最多生成的话题数 */
  maxTopics: number
  /** 最多生成的金句数 */
  maxGoldenQuotes: number

  /** 画像回溯的天数窗口 */
  personaLookbackDays: number
  /** 单次画像最多取用的消息条数 */
  personaMaxMessages: number
  /** 触发画像分析所需的最少消息条数 */
  personaMinMessages: number
  /** 画像结果的复用天数，超期后再次请求会重新生成 */
  personaCacheDays: number
  /** 画像是否只统计当前频道（关闭则汇总所有已记录频道） */
  personaOnlyCurrentGroup: boolean
  /** 查看他人画像所需的最低权限等级 */
  personaViewAuthority: number
  /** 禁止分析画像的用户 ID */
  personaUserFilter: string[]

  promptTopic: string
  promptGoldenQuotes: string
  promptQuery: string
  promptUserPersona: string
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
    groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表，格式 `平台:频道 ID`（listenAll 关闭时生效）'),
    recordImages: Schema.boolean().default(false).description('是否记录图片地址（关闭时图片内容记录为"[图片]"）'),
    recordQuotes: Schema.boolean().default(true).description('是否记录引用消息的引用内容'),
    retentionDays: Schema.number().default(0).min(0).description('消息保留天数，0 表示永久保留'),
  }).description('消息记录'),

  Schema.object({
    openaiEndpoint: Schema.string().default('https://api.openai.com/v1').description('OpenAI 兼容 API 地址'),
    openaiApiKey: Schema.string().role('secret').description('API Key（支持任意兼容 OpenAI 接口的厂商）'),
    openaiModel: Schema.string().default('gpt-4o-mini').description('使用的模型名称'),
    temperature: Schema.number().default(1).min(0).max(2).step(0.1).description('采样温度'),
  }).description('LLM 接口'),

  Schema.object({
    analysisDays: Schema.number().default(1).min(1).max(7).description('「群分析」默认分析的天数'),
    maxMessages: Schema.number().default(500).min(50).max(5000).description('单次分析最多取用的消息条数（取最近的）'),
    minMessages: Schema.number().default(20).min(1).description('触发分析所需的最小消息条数'),
    cacheMinutes: Schema.number().default(5).min(0).description('分析结果缓存分钟数，0 表示不缓存'),
    maxUsersInReport: Schema.number().default(10).min(1).description('报告中展示的活跃用户数'),
    maxTopics: Schema.number().default(5).min(1).description('最多生成的话题数'),
    maxGoldenQuotes: Schema.number().default(3).min(0).description('最多生成的金句数'),
  }).description('分析设置'),

  Schema.object({
    personaLookbackDays: Schema.number().default(3).min(1).max(30).description('画像回溯的天数窗口'),
    personaMaxMessages: Schema.number().default(300).min(50).max(2000).description('单次画像最多取用的消息条数（取最近的）'),
    personaMinMessages: Schema.number().default(20).min(1).description('触发画像分析所需的最少消息条数'),
    personaCacheDays: Schema.number().default(3).min(0).description('画像结果的复用天数，0 表示每次都重新生成'),
    personaOnlyCurrentGroup: Schema.boolean().default(false).description('画像是否只统计当前频道（关闭则汇总该用户在所有已记录频道的发言）'),
    personaViewAuthority: Schema.number().default(3).min(0).max(4).step(1).description('查看他人画像所需的最低权限等级（0=所有人, 1=用户, 2=协管, 3=管理员, 4=主人）'),
    personaUserFilter: Schema.array(Schema.string()).default([]).description('禁止分析画像的用户 ID'),
  }).description('用户画像'),

  Schema.object({
    promptTopic: Schema.string().role('textarea')
      .description('话题总结提示词。占位符：{messages} {maxTopics} {groupName} {timeRange} {query}')
      .default(prompts.TOPIC),
    promptGoldenQuotes: Schema.string().role('textarea')
      .description('金句提取提示词。占位符：{messages} {maxGoldenQuotes} {groupName} {timeRange}')
      .default(prompts.GOLDEN_QUOTES),
    promptQuery: Schema.string().role('textarea')
      .description('自然语言提问提示词，返回纯文本。占位符：{messages} {query} {groupName} {timeRange} {currentTime}')
      .default(prompts.QUERY),
    promptUserPersona: Schema.string().role('textarea')
      .description('用户画像提示词。占位符：{messages} {previousAnalysis} {username} {userId} {lookbackDays}')
      .default(prompts.USER_PERSONA),
  }).description('提示词'),
])
