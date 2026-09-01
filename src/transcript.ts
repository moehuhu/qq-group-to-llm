/**
 * 把消息记录排成投喂给模型的对话文本。不依赖任何服务，纯函数。
 *
 * 这里只管「怎么排」：正文一个字都不动——清洗归 text.ts，措辞归提示词模板。
 */
import type { AvatarBook } from './avatar'
import type { MessageRecord } from './database'
import type { TimeFormatter } from './time'

/** 续行缩进。转发卡片内部的多行发言排版还在用（text.ts），LLM 投喂已改为 JSON 结构，不再依赖它 */
const CONTINUATION_INDENT = '    '

/** 正文内部的换行。QQ 给的是 \n，\r 是别的平台或粘贴带进来的 */
const LINE_BREAK = /\r\n|\r|\n/

/**
 * 排一条记录：`head` 顶在行首，正文接在它后面，多出来的行缩进。
 * 正文是单行（绝大多数情况）时，结果与直接拼接完全一致。
 */
export function layoutRecord(head: string, content: string | undefined | null): string {
  const [first = '', ...rest] = String(content ?? '').split(LINE_BREAK)
  return [head + first, ...rest.map((line) => CONTINUATION_INDENT + line)].join('\n')
}

export interface PromptMessageOptions {
  /**
   * 头像映射表。给了就在每条里带上发言人编号 uid（高光对话出图需要模型把发言人照抄回来），
   * 头像地址本身留在表里不进提示词——地址长、还容易被抄错。
   */
  avatars?: AvatarBook
  /** 是否在每条里带上 scope 归属字段（用户画像需要区分群/频道） */
  withScope?: boolean
  /** 时间戳用年月日时分秒（用户画像），否则用时分秒（群分析等） */
  withDate?: boolean
}

/**
 * 把消息记录排成投喂给模型的 JSON 数组字符串。
 * 与旧的纯文本行不同，每条消息是一个独立对象，字段：
 * - time：发言时间戳
 * - sender：发送者昵称（没有昵称时回落为用户 ID）
 * - content：发言原文，多行原样保留（JSON 字符串天然区分边界，不再靠缩进）
 * - uid：发言人在头像映射表里的短编号，仅在给了 avatars 且该发言人有头像时输出
 * - scope：归属标记 `群:xxx` / `频道:xxx`，仅在 withScope 时输出
 */
export function toPromptJson(
  messages: MessageRecord[],
  time: TimeFormatter,
  options: PromptMessageOptions = {},
): string {
  const list = messages.map((message) => {
    const item: Record<string, string> = {
      time: (options.withDate ? time.dateTime : time.time)(message.timestamp),
      sender: message.username || message.userId || '',
      content: message.content,
    }
    const uid = options.avatars?.uidOf(message)
    if (uid) item.uid = uid
    if (options.withScope) {
      item.scope = message.guildId ? `群:${message.guildId}` : `频道:${message.channelId}`
    }
    return item
  })
  return JSON.stringify(list, null, 2)
}
