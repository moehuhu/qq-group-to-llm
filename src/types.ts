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
}

/** 一条「金句」：单句成立的精彩发言 */
export interface GoldenQuote {
  kind: 'quote'
  content: string
  sender?: string
  reason?: string
}

/** 高光对话里的一轮发言 */
export interface HighlightLine {
  sender: string
  content: string
}

/**
 * 一段「高光对话」：带学术要素的冷幽默群聊片段。
 * 与金句不同，它保留多轮上下文——笑点往往在一来一回之间才成立。
 */
export interface HighlightDialogue {
  kind: 'dialogue'
  /** 一句话概括这段对话在聊什么 */
  title?: string
  /** 按原始时间正序的对话轮次 */
  lines: HighlightLine[]
  /** 涉及的学科与具体概念 */
  academicPoint?: string
  /** 冷幽默的笑点所在 */
  reason?: string
}

/**
 * 报告中「高光记录」板块的条目。金句与高光对话由两次独立的抽取产生，
 * 判定标准互不干扰，在报告里合并成同一个板块展示。
 * kind 由本插件在规整阶段打上，不要求模型返回。
 */
export type HighlightRecord = GoldenQuote | HighlightDialogue

export interface UserStats {
  userId: string
  username: string
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
  userStats: UserStats[]
  topics: SummaryTopic[]
  highlights: HighlightRecord[]
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
  /** 支撑结论的原话，存 messageId；渲染时回查原文 */
  evidence: string[]
}
