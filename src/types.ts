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
