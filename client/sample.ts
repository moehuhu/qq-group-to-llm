/**
 * 预览用的示例数据。
 *
 * 固定一份写死的样本，不去查真实聊天记录：设置页要的是「改一行 CSS 立刻看到效果」，
 * 真数据既慢又不稳定（还得先跑一次模型），而且没有图片、转发这些边角情况，
 * 恰恰是最容易被自定义样式改坏的地方。
 *
 * 样本刻意把这些都塞了进来：引用条、提及、图片、合并转发、多人排行榜、
 * 深夜与峰值都有的柱状图，这样调样式时不至于漏掉某一块。
 */
import type { DialogueDigest, GroupAnalysisResult, UserPersonaProfile } from '../src/types'

/** 一条什么都占齐的消息：引用 + 提及 + 图片 + 合并转发 */
const RICH_MESSAGE = [
  '[引用 张三] 昨天说的那个方案',
  '[@李四] 你看这个 [图片](https://placehold.co/600x400/png) 后面还有字',
  '[群聊的聊天记录]',
  '王五: 收到，我这边没问题',
  '赵六: 那就这么定了',
].join('\n')

export const SAMPLE_REPORT: GroupAnalysisResult = {
  groupName: '示例群',
  timeRange: '08-27 00:00 ~ 08-28 00:00',
  totalMessages: 428,
  totalParticipants: 17,
  totalChars: 9012,
  mostActivePeriod: '20:00-21:00',
  hourly: [3, 1, 0, 0, 0, 2, 5, 9, 14, 22, 30, 26, 18, 24, 33, 41, 28, 19, 35, 52, 61, 47, 30, 12],
  topics: [
    {
      topic: '版面模板拆分',
      detail: '把页面模板和样式表按三个出口各拆一份，各自维护，互不影响。',
      contributors: ['张三', '李四'],
    },
    {
      topic: '周末聚餐',
      detail: '定在周六中午，人数还没最终确认。',
      contributors: ['王五'],
    },
  ],
  quotes: [
    { content: RICH_MESSAGE, sender: '李四', reason: '图文并茂，信息量大' },
    { content: '这也太离谱了吧', sender: '张三', reason: '语气到位' },
    { content: '我先撤了，明天见', sender: '王五', reason: '干脆利落' },
  ],
  userStats: ['张三', '李四', '王五', '赵六', '钱七'].map((username, index) => ({
    userId: `1000${index}`,
    username,
    messageCount: 90 - index * 17,
    charCount: (90 - index * 17) * (14 - index),
    avgChars: 14 - index,
    nightRatio: 0.1 * index,
    emojiRatio: 0.2,
    replyRatio: 0.15,
    avatar: '',
  })),
}

export const SAMPLE_DIALOGUES: DialogueDigest = {
  groupName: '示例群',
  timeRange: '08-27 00:00 ~ 08-28 00:00',
  totalMessages: 428,
  dialogues: [
    {
      title: '关于模板拆分',
      reason: '有来有回，信息密度高',
      lines: [
        { sender: '张三', content: RICH_MESSAGE, avatar: '' },
        { sender: '李四', content: '那样式表也要跟着拆吗', avatar: '' },
        { sender: '张三', content: '拆，三份各自维护，改一份不影响另外两份', avatar: '' },
      ],
    },
  ],
}

export const SAMPLE_PERSONA: UserPersonaProfile = {
  userId: '10001',
  username: '张三',
  summary: '话不多但每句都在点上，偏爱把问题拆成几步再动手，遇到含糊的需求会先问清楚再开工。',
  keyTraits: ['务实', '耐心', '较真'],
  interests: ['前端工程', '排版', '摄影'],
  communicationStyle: '短句为主，少用语气词，结论先行',
  evidence: [],
}

export const SAMPLE_EVIDENCE = [RICH_MESSAGE, '这个方案我同意，先按这个来']
