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

export interface GoldenQuote {
  content: string
  sender?: string
  reason?: string
}

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
  goldenQuotes: GoldenQuote[]
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
  /** 本次是否在历史画像基础上迭代 */
  lastMergedFromHistory?: boolean
}
