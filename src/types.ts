/** 提示词模板可用的公共上下文，键名对应 {占位符} */
export interface AnalysisContext extends Record<string, string> {
  groupName: string
  timeRange: string
  currentTime: string
  query: string
}

export interface SummaryTopic {
  topic: string
  contributors?: string[]
  detail?: string
  /**
   * 支撑该话题的原话记录。仅用于防止模型张冠李戴，只作内部依据，
   * 渲染层不读取该字段，不会展示在结果里。
   */
  messages?: string[]
}

/**
 * 「话题 + 金句」在同一次模型请求里的返回结构。
 * 群分析只发一次请求，一次同时产出热门话题与金句。
 */
export interface GroupSummary {
  topics: SummaryTopic[]
  quotes: GoldenQuote[]
}

/**
 * 一条「金句」：单句成立的精彩发言，随群分析报告一起产出。
 *
 * 模型直接返回发送者昵称与发言原文，不返回 msgid。
 * 与高光对话同一套处理：原文与昵称由模型照抄，不做回查校验。
 */
export interface GoldenQuote {
  /** 发言人昵称 */
  sender: string
  /** 发言原文（模型从群聊记录里照抄，不做回查校验） */
  content: string
  /** 入选理由 */
  reason?: string
}

/**
 * 高光对话里的一轮发言，已还原成渲染直接可用的形态。
 *
 * 模型直接返回每轮的发送者昵称与发言原文，不返回 msgid，
 * 抽取阶段与渲染阶段共用同一结构，不再按 id 从数据库回查。
 */
export interface HighlightLine {
  /** 发言人昵称 */
  sender: string
  /** 发言原文（模型从群聊记录里照抄，不做回查校验） */
  content: string
  /** 发言人头像地址，由头像映射表按 uid 还原；取不到时渲染退回首字色块 */
  avatar?: string
}

/**
 * 模型返回的一轮发言（尚未还原头像）。
 *
 * 头像地址不进提示词，投喂时每条只带一个短编号 uid，模型照抄回来，
 * 由 avatar.ts 的映射表还原成地址；avatar 只为兼容改过提示词、
 * 仍让模型直接抄地址的旧配置而保留。
 */
export interface HighlightLineDraft {
  sender?: string
  content?: string
  /** 发言人在头像映射表里的短编号 */
  uid?: string
  /** 模型直接抄回来的头像地址（旧提示词的形态） */
  avatar?: string
}

/**
 * 一段「高光对话」：带学术要素的冷幽默群聊片段，由独立的「高光对话」命令产出。
 * 与金句不同，它保留多轮上下文——笑点往往在一来一回之间才成立。
 *
 * L 是单轮发言的类型，默认就是直接携带原文与昵称的 HighlightLine。
 */
export interface HighlightDialogue<L = HighlightLine> {
  /** 一句话概括这段对话在聊什么 */
  title?: string
  /** 按原始时间正序的对话轮次 */
  lines: L[]
  /** 入选原因 */
  reason?: string
}

/** 「高光对话」命令的产物：一批对话，加上取数范围供渲染标题用 */
export interface DialogueDigest<L = HighlightLine> {
  groupName: string
  timeRange: string
  /** 本次分析取用的消息条数 */
  totalMessages: number
  dialogues: HighlightDialogue<L>[]
}

/** 一条被引用的消息：发送者 + 原文，由模型直接从聊天记录照抄 */
export interface MessageQuote {
  /** 发言人昵称 */
  sender: string
  /** 发言原文（模型从群聊记录里照抄，不做回查校验） */
  content: string
}

/**
 * LLM 问答的原始返回。answer 是给用户看的回答，
 * cited 是回答所依据的消息（发送者 + 原文），随回答一起交给渲染层。
 */
export interface QueryAnswer {
  answer: string
  /** 回答所依据的引用消息（发送者 + 原文），可能混有模型编造的，展示时自行取舍 */
  cited?: MessageQuote[]
}

/** 「群聊问答」的最终产物：回答 + 引用消息，供渲染层直接展示 */
export interface QueryAnswerResult {
  answer: string
  /** 回答所依据的消息（发送者 + 原文），按模型引用的顺序 */
  cited: MessageQuote[]
}

export interface UserStats {
  userId: string
  username: string
  /** 该用户最近一次发言时的头像地址 */
  avatar?: string
  messageCount: number
  charCount: number
  avgChars: number
  /** 深夜（00:00-06:00）发言占比 */
  nightRatio: number
  /** 含表情/图片的发言占比 */
  emojiRatio: number
  /** 含引用的发言占比 */
  replyRatio: number
}

export interface GroupAnalysisResult {
  groupName: string
  timeRange: string
  totalMessages: number
  totalChars: number
  totalParticipants: number
  /** 发言最集中的整点时段，无数据时为 undefined */
  mostActivePeriod?: string
  /** 24 个整点各自的发言量，下标即小时（0-23），恒为 24 项 */
  hourly: number[]
  userStats: UserStats[]
  topics: SummaryTopic[]
  /** 金句，直接携带昵称与原文 */
  quotes: GoldenQuote[]
}

export interface UserPersonaProfile {
  userId: string
  username: string
  /** 整体印象 */
  summary: string
  /** 核心性格特质 */
  keyTraits: string[]
  /** 关注的主题与爱好 */
  interests: string[]
  /** 表达风格与情绪倾向 */
  communicationStyle: string
  /** 支撑结论的原话，由模型直接从聊天记录照抄，不含发送者（画像针对同一人） */
  evidence: string[]
}
