import { Schema } from 'koishi'
import * as prompts from './prompts'
import {
  DIALOGUES_STYLE, DIALOGUES_TEMPLATE,
  PERSONA_STYLE, PERSONA_TEMPLATE,
  REPORT_STYLE, REPORT_TEMPLATE,
} from '../render/theme'

/**
 * 一个命名模型。id 供各任务按名选用，字段齐全，是模型配置的唯一来源。
 */
export interface LLMModelConfig {
  /** 模型 id，任务配置里用这个名字引用它 */
  id: string
  /** OpenAI 兼容 API 地址 */
  endpoint: string
  /** API Key */
  apiKey: string
  /** 模型名称 */
  model: string
  /** 采样温度 */
  temperature: number
  /** 该模型同时在飞的请求数上限 */
  concurrency: number
}

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
  /** 图片缓存保留天数（0 表示永久保留） */
  mediaRetentionDays: number
  /** 统计与展示所用的时区（IANA 名称），留空跟随系统 */
  timezone: string

  /** 命名模型列表，各任务从这里按 id 选用模型 */
  llmModels: LLMModelConfig[]
  /** 以流式方式接收模型响应 */
  llmStream: boolean
  /** 请求失败后的重试次数 */
  llmRetries: number
  /** 话题总结与金句提取（同一次请求返回）使用的模型 id */
  llmModelTopic: string
  /** 高光对话使用的模型 id */
  llmModelHighlightDialogues: string
  /** 群聊问答使用的模型 id */
  llmModelQuery: string
  /** 用户画像使用的模型 id */
  llmModelUserPersona: string

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
  /** 群分析的页面模板与样式表，留空用内置的 */
  reportHtmlTemplate: string
  reportCssTemplate: string
  /** 高光对话的页面模板与样式表，留空用内置的 */
  dialoguesHtmlTemplate: string
  dialoguesCssTemplate: string
  /** 用户画像的页面模板与样式表，留空用内置的 */
  personaHtmlTemplate: string
  personaCssTemplate: string
  /** 追加样式，三张图共用，接在各自的样式表之后 */
  extraCss: string

  promptTopic: string
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
    mediaRetentionDays: Schema.number().default(30).min(0).description('图片缓存保留天数，按最后更新时间清理，0 表示永久保留'),
    timezone: Schema.string().default('').description('统计与展示所用的时区，填 IANA 名称如 `Asia/Shanghai`。留空跟随运行 Koishi 的机器时区。影响活跃时段柱状图的分桶、报告里的时间范围，以及投喂给模型的逐条时间戳'),
  }).description('消息记录'),

  Schema.object({
    llmStream: Schema.boolean().default(true)
      .description('以流式方式接收响应。关闭后服务端要等整段生成完才回响应头，提示词一长就容易超时失败（UND_ERR_HEADERS_TIMEOUT）'),
    llmRetries: Schema.number().default(2).min(0).max(5).step(1)
      .description('请求失败后的重试次数。仅对超时、连接中断、限流和 5xx 生效，鉴权或参数错误不重试'),
    llmModels: Schema.array(Schema.object({
      id: Schema.string().required().description('模型 id，下面各任务的"模型"配置填的就是它'),
      endpoint: Schema.string().required().description('OpenAI 兼容 API 地址（支持任意兼容 OpenAI 接口的厂商）'),
      apiKey: Schema.string().required().role('secret').description('API Key'),
      model: Schema.string().required().description('模型名称'),
      temperature: Schema.number().default(1).min(0).max(2).step(0.1).description('采样温度'),
      concurrency: Schema.number().default(1).min(1).step(1)
        .description('该模型同时在飞的请求数上限，超出的排队等待。不同厂商对并发的限制不一样，想提高某模型的利用率就在这里单独调大'),
    }).description('一个命名模型'))
      .required()
      .role('table')
      .description('命名模型列表，模型配置的唯一来源。想用不同模型（甚至不同厂商）生成不同类型的结果时，在这里定义若干模型，再在下方各任务的"模型"配置里分别指定'),
    llmModelTopic: Schema.string().default('default').description('「群分析」使用的模型 id——话题总结与金句提取在同一次请求里返回，共用这一个模型。留空或填错时回落到列表第一个'),
    llmModelHighlightDialogues: Schema.string().default('default').description('「高光对话」使用的模型 id，留空或填错时回落到列表第一个'),
    llmModelQuery: Schema.string().default('default').description('「群聊问答」使用的模型 id，留空或填错时回落到列表第一个'),
    llmModelUserPersona: Schema.string().default('default').description('「用户画像」使用的模型 id，留空或填错时回落到列表第一个'),
  }).description('LLM 接口'),

  Schema.object({
    analysisDays: Schema.number().default(1).min(1).max(7).description('「群分析」默认分析的天数'),
    maxMessages: Schema.number().default(500).min(50).max(5000).description('单次分析最多取用的消息条数（取最近的）'),
    minMessages: Schema.number().default(20).min(1).description('触发分析所需的最小消息条数'),
    cacheMinutes: Schema.number().default(5).min(0).description('分析结果缓存分钟数，0 表示不缓存'),
    maxUsersInReport: Schema.number().default(10).min(1).description('报告中展示的活跃用户数'),
    maxTopics: Schema.number().default(5).min(1).description('最多生成的话题数'),
    maxGoldenQuotes: Schema.number().default(3).min(0).description('群分析报告中最多收录的金句条数，0 表示不收金句'),
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
      .description('「金句」不收录这些用户。由于金句随话题在同一次模型请求里返回、共用同一份投喂消息，被屏蔽者的发言无法在投喂前剔除，改在结果层按昵称拦截：模型返回的金句若把话安到被屏蔽者头上（昵称张冠李戴或转述），会被直接丢弃'),
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
      .description('群分析提示词（话题总结 + 金句提取在同一次请求里返回）。占位符：{messages} {maxTopics} {maxGoldenQuotes} {groupName} {timeRange} {query}；返回结构是包含 topics 与 quotes 两个数组的对象')
      .default(prompts.TOPIC),
    promptHighlightDialogues: Schema.string().role('textarea')
      .description('高光对话提示词。占位符：{messages} {maxHighlightDialogues} {maxHighlightLines} {groupName} {timeRange}。投喂的 {messages} 是 JSON 数组，有头像的消息带一个短编号 `uid`（形如 `u1`），模型把它原样抄进返回的 lines 里，出图时插件再按 `qq_group_avatars` 这张「用户 ID → 头像地址」映射表还原成真正的头像地址——头像地址不进提示词，省下的上下文相当可观。改这段提示词时记得保留「照抄 `uid`」这条要求；老提示词里的 `avatar` 字段仍能解析，模型漏抄时也会拿昵称回表里兜底找一次，但记录里已经不带头像地址了')
      .default(prompts.HIGHLIGHT_DIALOGUES),
    promptQuery: Schema.string().role('textarea')
      .description('自然语言提问提示词，返回 JSON（answer 回答 + cited 引用的消息，含发送者昵称与原文）。占位符：{messages} {query} {groupName} {timeRange} {currentTime}')
      .default(prompts.QUERY),
    promptUserPersona: Schema.string().role('textarea')
      .description('用户画像提示词。占位符：{messages} {username} {userId} {lookbackDays}')
      .default(prompts.USER_PERSONA),
  }).description('提示词'),

  Schema.object({
    extraCss: Schema.string().role('textarea').default('')
      .description('追加样式，三张图共用，接在各自的样式表之后，同名规则覆盖前面的。改配色只要在这里重写一遍 `#card { --accent: #ff6b6b; }` 之类的变量即可，不必动下面那三份样式表——插件后续更新版面时也不会把你的改动盖掉'),
    reportHtmlTemplate: Schema.string().role('textarea')
      .description('「群分析」页面模板。除公共占位符外还有：`{groupName}` `{timeRange}`、`{stats}` 数字条、`{topics}` 热门话题、`{quotes}` 金句、`{ranks}` 活跃榜、`{hourly}` 活跃时段，以及 `{totalMessages}` `{totalParticipants}` `{totalChars}` `{mostActivePeriod}` 四个原始数值。调换四个分节的先后即可改版面，删掉哪个占位符哪节就不出现')
      .default(REPORT_TEMPLATE),
    reportCssTemplate: Schema.string().role('textarea')
      .description('「群分析」样式表')
      .default(REPORT_STYLE),
    dialoguesHtmlTemplate: Schema.string().role('textarea')
      .description('「高光对话」页面模板。除公共占位符外还有：`{groupName}` `{timeRange}`、`{dialogues}` 全部对话段、`{count}` 段数、`{totalMessages}` 取样条数')
      .default(DIALOGUES_TEMPLATE),
    dialoguesCssTemplate: Schema.string().role('textarea')
      .description('「高光对话」样式表')
      .default(DIALOGUES_STYLE),
    personaHtmlTemplate: Schema.string().role('textarea')
      .description('「用户画像」页面模板。除公共占位符外还有：`{name}` `{userId}`、`{avatar}` 头像、`{summary}` 整体印象、`{points}` 画像要点、`{evidence}` 代表发言，以及 `{columns}` 分栏开关（拼在 `.body` 的 class 上，删掉即恒定单列）')
      .default(PERSONA_TEMPLATE),
    personaCssTemplate: Schema.string().role('textarea')
      .description('「用户画像」样式表')
      .default(PERSONA_STYLE),
  }).description('版面模板（三个出口各一份页面模板与样式表，分别维护——改群分析的版面不会牵动画像那张图；只有「追加样式」是三张图共用的。页面模板的公共占位符：`{title}` 标题、`{width}` 图片宽度、`{style}` 样式表；清空任一项即回到内置那份。**`#card` 必须保留**——截图按这个元素裁切，找不到它会拍成整页视口，底下拖一大块空白）'),
])
