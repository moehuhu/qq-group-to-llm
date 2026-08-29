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
 * 一条「金句」：单句成立的精彩发言，随群分析报告一起产出。
 *
 * LLM 只返回引用的 msgid 与入选理由，不报正文、不报发言人——它会把原文抄错、
 * 抄漏或润色，昵称也可能张冠李戴。原文与发言人由数据库回查补上，保证一字不差。
 */
export interface GoldenQuote {
  /** 发言在库里的 <msgid:…> 锚点，渲染前回查原文与发言人 */
  msgid: string
  /** 入选理由 */
  reason?: string
}

/** 已回查原文与发送者的金句，供渲染层直接展示 */
export interface ResolvedQuote {
  /** 发言人昵称，缺省退回用户 ID */
  sender: string
  /** 清洗后的消息正文 */
  content: string
  /** 入选理由 */
  reason?: string
}

/**
 * 高光对话里的一轮发言。
 *
 * 模型只还原消息 id，不报正文、不报发言人——它会把原文抄错、抄漏或润色，
 * 昵称也可能张冠李戴。所以 LLM 的返回只存 msgid，渲染时再按 msgid 从数据库
 * 回查原文与发言人，保证白纸黑字跟原话一字不差。
 */
export interface HighlightLine {
  /** 发言在库里的 <msgid:…> 锚点，渲染前回查原文与发言人 */
  msgid: string
}

/** 已回查原文的高光对话轮次，供渲染层直接展示 */
export interface ResolvedHighlightLine {
  sender: string
  content: string
  /** 发言人头像，由记录里回查得到；渲染图片时用，取不到则退回首字色块 */
  avatar?: string
}

/**
 * 一段「高光对话」：带学术要素的冷幽默群聊片段，由独立的「高光对话」命令产出。
 * 与金句不同，它保留多轮上下文——笑点往往在一来一回之间才成立。
 *
 * L 是单轮发言的类型：抽取阶段是只带 msgid 的 HighlightLine，
 * 回查原文后是带正文与头像的 ResolvedHighlightLine。
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

/**
 * LLM 问答的原始返回。answer 是给用户看的回答，
 * cited 是回答所依据的消息 id，回查原文后随回答一起展示，防止张冠李戴。
 */
export interface QueryAnswer {
  answer: string
  /** 引用的消息 id（<msgid:…> 锚点），可能混有模型编造的，回查时丢弃 */
  cited?: string[]
}

/** 「群聊问答」的最终产物：回答 + 回查成功的引用消息，供渲染层直接展示 */
export interface QueryAnswerResult {
  answer: string
  /** 回答所依据的消息（含发言者与时间），按模型引用的顺序，回查失败的已剔除 */
  cited: CitedMessage[]
}

/** 一条被引用的原始消息，供「群聊问答」附在回答后核对 */
export interface CitedMessage {
  /** 发言人昵称，缺省退回用户 ID */
  sender: string
  /** 发言时间，按配置时区格式化 */
  time: string
  /** 清洗后的消息正文 */
  content: string
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
  /** 金句，已回查原文与发送者 */
  quotes: ResolvedQuote[]
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
