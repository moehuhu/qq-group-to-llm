import { Schema } from 'koishi'
import * as prompts from './prompts'

export interface Config {
  /** 监听所有群组（true 时忽略 groups 配置） */
  listenAll: boolean
  /** 需要记录的群组列表（listenAll 为 false 时生效） */
  groups: string[]
  /** 记录图片与视频的地址（否则仅留 `[图片]` `[视频]` 占位符） */
  recordImages: boolean
  /** 记录被引用消息的发言人与原话摘要（关闭时只留 `[引用]` 占位） */
  recordQuotes: boolean
  /** 消息保留天数（0 表示永久保留） */
  retentionDays: number
  /** 统计与展示所用的时区（IANA 名称），留空跟随系统 */
  timezone: string

  /** OpenAI 兼容 API 地址 */
  openaiEndpoint: string
  /** API Key */
  openaiApiKey: string
  /** 模型名称 */
  openaiModel: string
  /** 采样温度 */
  temperature: number
  /** 同时在飞的模型请求数上限 */
  llmConcurrency: number
  /** 以流式方式接收模型响应 */
  llmStream: boolean
  /** 请求失败后的重试次数 */
  llmRetries: number

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
  /** 最多截取的高光对话段数 */
  maxHighlightDialogues: number
  /** 单段高光对话最多保留的轮次 */
  maxHighlightLines: number

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
  /** 群分析（话题与活跃榜）忽略这些用户的发言 */
  analysisUserFilter: string[]
  /** 金句不收录这些用户 */
  quoteUserFilter: string[]
  /** 高光对话不收录这些用户 */
  dialogueUserFilter: string[]
  /** 禁止分析画像的用户 ID */
  personaUserFilter: string[]

  /** 群分析与用户画像的结果以图片形式发送 */
  renderImage: boolean
  /** 图片宽度（CSS 像素） */
  imageWidth: number
  /** 截图缩放倍率，2 即二倍图 */
  imageScale: number

  promptTopic: string
  promptGoldenQuotes: string
  promptHighlightDialogues: string
  promptQuery: string
  promptUserPersona: string
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
    groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表，格式 `平台:频道 ID`（listenAll 关闭时生效）'),
    recordImages: Schema.boolean().default(false).description('是否记录图片与视频的地址（关闭时只留 `[图片]` `[视频]` 占位符。图片地址用于出图时还原成真正的图片；视频只作留存，报告里一律画成播放占位块）'),
    recordQuotes: Schema.boolean().default(true).description('是否记录被引用消息的发言人与原话摘要（存成正文首行 `[引用 张三] 原话`；关闭时只留 `[引用]`）'),
    retentionDays: Schema.number().default(0).min(0).description('消息保留天数，0 表示永久保留'),
    timezone: Schema.string().default('').description('统计与展示所用的时区，填 IANA 名称如 `Asia/Shanghai`。留空跟随运行 Koishi 的机器时区。影响活跃时段柱状图的分桶、报告里的时间范围，以及投喂给模型的逐条时间戳'),
  }).description('消息记录'),

  Schema.object({
    openaiEndpoint: Schema.string().default('https://api.openai.com/v1').description('OpenAI 兼容 API 地址'),
    openaiApiKey: Schema.string().role('secret').description('API Key（支持任意兼容 OpenAI 接口的厂商）'),
    openaiModel: Schema.string().default('gpt-4o-mini').description('使用的模型名称'),
    temperature: Schema.number().default(1).min(0).max(2).step(0.1).description('采样温度'),
    llmConcurrency: Schema.number().default(2).min(1).max(5).step(1)
      .description('同时进行的模型调用数上限，超出的排队等待。调大可能触发厂商的并发限制导致调用失败'),
    llmStream: Schema.boolean().default(true)
      .description('以流式方式接收响应。关闭后服务端要等整段生成完才回响应头，提示词一长就容易超时失败（UND_ERR_HEADERS_TIMEOUT）'),
    llmRetries: Schema.number().default(2).min(0).max(5).step(1)
      .description('请求失败后的重试次数。仅对超时、连接中断、限流和 5xx 生效，鉴权或参数错误不重试'),
  }).description('LLM 接口'),

  Schema.object({
    analysisDays: Schema.number().default(1).min(1).max(7).description('「群分析」默认分析的天数'),
    maxMessages: Schema.number().default(500).min(50).max(5000).description('单次分析最多取用的消息条数（取最近的）'),
    minMessages: Schema.number().default(20).min(1).description('触发分析所需的最小消息条数'),
    cacheMinutes: Schema.number().default(5).min(0).description('分析结果缓存分钟数，0 表示不缓存'),
    maxUsersInReport: Schema.number().default(10).min(1).description('报告中展示的活跃用户数'),
    maxTopics: Schema.number().default(5).min(1).description('最多生成的话题数'),
    maxGoldenQuotes: Schema.number().default(3).min(0).description('「高光对话」中最多收录的金句条数，0 表示不收金句'),
    maxHighlightDialogues: Schema.number().default(3).min(0).description('「高光对话」中最多截取的高光对话段数，0 表示不收对话'),
    maxHighlightLines: Schema.number().default(6).min(2).max(20).description('单段高光对话最多保留的轮次，超出的部分会被截断'),
  }).description('分析设置'),

  Schema.object({
    personaLookbackDays: Schema.number().default(3).min(1).max(30).description('画像回溯的天数窗口'),
    personaMaxMessages: Schema.number().default(300).min(50).max(2000).description('单次画像最多取用的消息条数（取最近的）'),
    personaMinMessages: Schema.number().default(20).min(1).description('触发画像分析所需的最少消息条数'),
    personaCacheDays: Schema.number().default(3).min(0).description('画像结果的复用天数，0 表示每次都重新生成'),
    personaOnlyCurrentGroup: Schema.boolean().default(false).description('画像是否只统计当前频道（关闭则汇总该用户在所有已记录频道的发言）'),
    personaViewAuthority: Schema.number().default(3).min(0).max(4).step(1).description('查看他人画像所需的最低权限等级（0=所有人, 1=用户, 2=协管, 3=管理员, 4=主人）'),
  }).description('用户画像'),

  Schema.object({
    analysisUserFilter: Schema.array(Schema.string()).default([])
      .description('「群分析」忽略这些用户的发言，他们不进话题、不进活跃榜、也不计入统计'),
    quoteUserFilter: Schema.array(Schema.string()).default([])
      .description('「金句」不收录这些用户的发言'),
    dialogueUserFilter: Schema.array(Schema.string()).default([])
      .description('「高光对话」不收录这些用户，含有他们的对话整段丢弃'),
    personaUserFilter: Schema.array(Schema.string()).default([])
      .description('不为这些用户生成「用户画像」'),
  }).description('用户屏蔽'),

  Schema.object({
    renderImage: Schema.boolean().default(true)
      .description('把「群分析」报告与「用户画像」渲染成图片发送（需要 puppeteer 服务；未启用或渲染失败时自动回退为文字）'),
    imageWidth: Schema.number().default(1000).min(480).max(1600)
      .description('图片宽度（CSS 像素）。不低于 820 时正文排成两列，低于则单列'),
    imageScale: Schema.number().default(1).min(1).max(3).step(1)
      .description('截图缩放倍率越大越清晰，但文件也越大'),
  }).description('图片渲染'),

  Schema.object({
    promptTopic: Schema.string().role('textarea')
      .description('话题总结提示词。占位符：{messages} {maxTopics} {groupName} {timeRange} {query}')
      .default(prompts.TOPIC),
    promptGoldenQuotes: Schema.string().role('textarea')
      .description('金句提取提示词。占位符：{messages} {maxGoldenQuotes} {groupName} {timeRange}')
      .default(prompts.GOLDEN_QUOTES),
    promptHighlightDialogues: Schema.string().role('textarea')
      .description('高光对话提示词。占位符：{messages} {maxHighlightDialogues} {maxHighlightLines} {groupName} {timeRange}')
      .default(prompts.HIGHLIGHT_DIALOGUES),
    promptQuery: Schema.string().role('textarea')
      .description('自然语言提问提示词，返回纯文本。占位符：{messages} {query} {groupName} {timeRange} {currentTime}')
      .default(prompts.QUERY),
    promptUserPersona: Schema.string().role('textarea')
      .description('用户画像提示词。占位符：{messages} {username} {userId} {lookbackDays}')
      .default(prompts.USER_PERSONA),
  }).description('提示词'),
])
