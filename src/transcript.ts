/**
 * 把消息记录排成投喂给模型的对话文本。不依赖任何服务，纯函数。
 *
 * 这里只管「怎么排」：正文一个字都不动——清洗归 text.ts，措辞归提示词模板。
 */
import type { Context } from 'koishi'
import type { AvatarBook } from './avatar'
import { MEDIA_TABLE, type MediaRecord, type MessageRecord } from './database'
import type { TimeFormatter } from './time'

/** 续行缩进。转发卡片内部的多行发言排版还在用（text.ts），LLM 投喂已改为 JSON 结构，不再依赖它 */
const CONTINUATION_INDENT = '    '

/** 正文内部的换行。QQ 给的是 \n，\r 是别的平台或粘贴带进来的 */
const LINE_BREAK = /\r\n|\r|\n/

/**
 * 图片占位符：入库时的形态是 `[图片](url)`。
 *
 * 高光对话出图时，这个形态会被替换成短编号 `[图片:m1]`（url 进 MediaBook 的映射表），
 * 模型照抄短编号后由 MediaBook 还原成本来的形态——与头像的 uid 同一套思路。
 */
export const IMAGE_PLACEHOLDER = /\[(图片|视频)\](?:\((https?:\/\/[^\s)]+)\))?/g

/**
 * 图片映射表：图片短编号 ↔ 原始占位符。
 *
 * 与头像映射表（avatar.ts）同一套思路：媒体地址动辄一两百字符，在提示词里逐条
 * 展开既白烧 token，长地址还容易被模型抄串行。给每条内容里的图片、视频发一个
 * 短编号 `m1`，模型照抄编号，返回后由 resolve 还原成 `[图片](url)`——render/html.ts
 * 认识的就是这个形态，还原后无需再动渲染层。
 *
 * 只搬「带地址的媒体」进表；关掉 recordImages（或平台没给地址）时 content 里只有
 * 裸占位符 `[图片]`，没有地址可省，原样保留。
 */
export interface MediaBook {
  /** 已见到的占位符 → 短编号（按首次出现顺序分配） */
  readonly tokens: ReadonlyMap<string, string>
  /** 把短编号还原成原始占位符；认不出编号时返回 undefined，调用方保留原文 */
  resolve(token?: string | null): string | undefined
}

export async function loadMediaCache(
  ctx: Context,
  messages: MessageRecord[],
): Promise<Map<string, string>> {
  const urls = [...new Set(messages.flatMap((message) =>
    [...String(message.content ?? '').matchAll(IMAGE_PLACEHOLDER)]
      .filter((match) => match[1] === '图片' && match[2])
      .map((match) => match[2]!)))]
  const records = await Promise.all(urls.map(async (url) => {
    const platform = messages.find((message) => message.content.includes(url))?.platform
    if (!platform) return undefined
    const [record] = await ctx.database.select(MEDIA_TABLE)
      .where({ platform, url })
      .execute()
    return record as MediaRecord | undefined
  }))
  return new Map(records.filter((record): record is MediaRecord => !!record && !!record.data)
    .map((record) => [record.url, record.data]))
}

/** 为一批消息建媒体映射表。一张表一次分析，编号只在本次分析内有效 */
export function buildMediaBook(messages: MessageRecord[], cachedData = new Map<string, string>): MediaBook {
  // 原始占位符 → 短编号占位形态（`[图片](url)` → `[图片:m1]`），供 maskMediaContent 替换
  const tokens = new Map<string, string>()
  // 短编号 → 原始占位符，供 resolve 把模型抄回的编号还原成地址
  const byToken = new Map<string, string>()
  for (const message of messages) {
    for (const match of String(message.content ?? '').matchAll(IMAGE_PLACEHOLDER)) {
      // 没地址的裸占位符没得省，只收带地址的
      if (!match[2]) continue
      const raw = match[0]
      const value = cachedData.get(match[2])
      if (tokens.has(raw)) continue
      const token = `[${match[1]}:m${tokens.size + 1}]`
      tokens.set(raw, token)
      byToken.set(token, value ? raw.replace(match[2], value) : raw)
    }
  }
  return {
    tokens,
    resolve: (token) => byToken.get(String(token ?? '').trim()),
  }
}

/**
 * 把一条消息的正文里的媒体占位符换成短编号。
 * 上面的媒体映射表先生成，再在这里顺着已登记的编号逐条替换：
 * 先扫表（知道该把谁换成谁），再替换（正文里只留编号）。
 */
function maskMediaContent(content: string, medias: MediaBook): string {
  if (!medias.tokens.size) return content
  let out = content
  for (const [raw, token] of medias.tokens) {
    out = out.split(raw).join(token)
  }
  return out
}

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
  /**
   * 媒体映射表。给了就把每条正文里的媒体占位符换成短编号（`[图片:m1]`），
   * 地址只留在表里，提示词里不再出现长 URL——与头像 uid 同一套思路，省上下文防抄错。
   */
  medias?: MediaBook
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
 * - content：发言原文，多行原样保留（JSON 字符串天然区分边界，不再靠缩进）；
 *   给了 medias 映射表时，正文里的图片占位符会被换成短编号 `[图片:m1]`，地址留在表里
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
      content: options.medias
        ? maskMediaContent(message.content, options.medias)
        : message.content,
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
