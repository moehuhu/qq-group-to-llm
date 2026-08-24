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

  promptTopic: string
  promptGoldenQuotes: string
  promptQuery: string
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
    groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表，格式 `平台:频道 ID`（listenAll 关闭时生效）'),
    recordImages: Schema.boolean().default(false).description('是否记录图片地址（关闭时图片内容记录为"[图片]"）'),
    recordQuotes: Schema.boolean().default(true).description('是否记录引用消息的引用内容'),
    retentionDays: Schema.number().default(0).min(0).description('消息保留天数，0 表示永久保留'),
    maxQuery: Schema.number().default(20).min(1).max(100).description('msglog 命令最多返回的消息条数'),
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
    promptTopic: Schema.string().role('textarea').description('话题总结提示词。占位符：{messages} {maxTopics} {groupName} {timeRange} {query}').default(
`你是群聊记录总结助手。请阅读下面的群聊记录，提取最多 {maxTopics} 个主要话题。

对每个话题请给出：
1. 话题名称：简明扼要，直接点出主题
2. 主要参与者：最多 5 人，使用昵称
3. 话题描述：讲清楚起因、经过、结论。写具体内容而不是"讨论了某某问题"这类空泛描述；描述中使用昵称而非用户 ID；使用纯文本，不要 markdown 语法

群聊：{groupName}
时间范围：{timeRange}
用户额外关注：{query}

群聊记录：
{messages}

请严格按以下 YAML 格式返回，并放在 markdown 代码块中：
\`\`\`yaml
- topic: "话题名称"
  contributors:
    - "昵称1"
    - "昵称2"
  detail: |-
    话题描述，可多行
\`\`\``),

    promptGoldenQuotes: Schema.string().role('textarea').description('金句提取提示词。占位符：{messages} {maxGoldenQuotes} {groupName} {timeRange}').default(
`请从下面的群聊记录中挑出最多 {maxGoldenQuotes} 条最有意思的「金句」。

挑选标准：观点新颖、表达生动、或有反差感与记忆点的原创发言。跳过纯粹的网络热词堆砌和复读。

群聊：{groupName}
时间范围：{timeRange}

群聊记录：
{messages}

请严格按以下 YAML 格式返回，并放在 markdown 代码块中：
\`\`\`yaml
- content: |-
    金句原文
  sender: "发言人昵称"
  reason: |-
    入选理由，纯文本
\`\`\``),

    promptQuery: Schema.string().role('textarea').description('自然语言提问提示词，返回纯文本。占位符：{messages} {query} {groupName} {timeRange} {currentTime}').default(
`你是群聊记录问答助手。请只依据下面的群聊记录回答用户的问题。

规则：
- 记录里没有的信息，直接说明"记录中没有相关内容"，不要编造
- 回答中使用昵称而非用户 ID
- 用纯文本回答，不要使用 markdown 语法，控制在 300 字以内

群聊：{groupName}
当前时间：{currentTime}
记录时间范围：{timeRange}

群聊记录：
{messages}

用户问题：{query}`),
  }).description('提示词'),
])
