/**
 * 把消息记录排成投喂给模型的对话文本，以及正文里那些图片的来回替换。
 *
 * 排版这部分只管「怎么排」：正文一个字都不动——清洗归 text.ts，措辞归提示词模板。
 * 图片这部分管两趟替换：投喂前把地址换成短编号（省上下文、防模型抄错），
 * 出图前把地址换成媒体缓存里的图片数据（QQ 的图链只活几小时）。
 * 后者要读缓存（现在是文件存储，见 media.ts），是这个文件里唯一碰 Context 的地方。
 */
import type { Context } from 'koishi'
import type { AvatarBook } from './avatar'
import type { MessageRecord } from './database'
import { loadMedia } from './media'
import { logger } from './logger'
import type { TimeFormatter } from './time'

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

/** 一批文本里出现过的图片地址，去重。视频不缓存（报告里一律画成播放占位块），不收 */
export function imageUrls(texts: readonly string[]): string[] {
  return [...new Set(texts.flatMap((text) =>
    [...String(text ?? '').matchAll(IMAGE_PLACEHOLDER)]
      .filter((match) => match[1] === '图片' && match[2])
      .map((match) => match[2]!)))]
}

/**
 * 按地址取已缓存的图片：`url` → 图片数据（`data:image/jpeg;base64,…`）。
 *
 * 缓存里查不到的地址不进映射——入库时就没抓下来，或者已过保留期被清掉了；
 * 读缓存失败同样退回空映射。两种情况调用方都保留原始地址：图是锦上添花，不该让整次分析失败。
 */
export async function loadMediaData(
  ctx: Context,
  platform: string,
  urls: readonly string[],
): Promise<Map<string, string>> {
  if (!urls.length) return new Map()
  const entries = await Promise.all(urls.map(async (url) => [url, await loadMedia(ctx, url)] as const))
  return new Map(entries.filter((entry): entry is [string, string] => !!entry[1]))
}

/**
 * 为一批消息取图片缓存。缓存按平台分键（不同平台的同一串地址不是同一张图），
 * 所以按平台分组各查一次——一次分析里通常只有一个平台，也就只查一次。
 */
export async function loadMediaCache(
  ctx: Context,
  messages: MessageRecord[],
): Promise<Map<string, string>> {
  const byPlatform = new Map<string, string[]>()
  for (const message of messages) {
    const urls = imageUrls([message.content])
    if (!urls.length) continue
    byPlatform.set(message.platform, [...byPlatform.get(message.platform) ?? [], ...urls])
  }
  const cache = new Map<string, string>()
  for (const [platform, urls] of byPlatform) {
    for (const [url, data] of await loadMediaData(ctx, platform, [...new Set(urls)])) {
      cache.set(url, data)
    }
  }
  return cache
}

/**
 * 把正文里的图片地址换成缓存下来的图片数据。
 *
 * QQ 的图片地址只活几小时，出图时再去拉多半是一块空白（渲染层会退回「图片」小标签）。
 * 消息入库时已经把图抓下来存进了本地缓存（见 message/recorder.ts 与 media.ts），这里把
 * `[图片](https://…)` 原地换成 `[图片](data:image/jpeg;base64,…)`——渲染层认识这个形态
 * （见 render/html.ts 的 MEDIA_PATTERN），换完不必再动渲染层。
 * 缓存里没有的地址原样保留：拉不到那张图，也比连占位符都丢了好。
 */
export function inlineMediaData(text: string, cache: ReadonlyMap<string, string>): string {
  if (!cache.size) return text
  return String(text ?? '').replace(IMAGE_PLACEHOLDER, (raw, kind: string, url?: string) => {
    const data = kind === '图片' && url ? cache.get(url) : undefined
    return data ? `[${kind}](${data})` : raw
  })
}

/** 一批文本：里头的图片地址一次取缓存、一并换成缓存里的图片数据 */
export async function inlineMediaTexts(
  ctx: Context,
  platform: string,
  texts: readonly string[],
): Promise<string[]> {
  const urls = imageUrls(texts)
  if (!urls.length) return [...texts]
  const cache = await loadMediaData(ctx, platform, urls)
  if (!cache.size) {
    logger(ctx).info(`${urls.length} 张图都不在缓存里，保留原始地址（图链可能已过期）`)
    return [...texts]
  }
  logger(ctx).info(`图片改从缓存取，命中 ${cache.size}/${urls.length} 张` +
    (cache.size < urls.length ? '，其余保留原始地址' : ''))
  return texts.map((text) => inlineMediaData(text, cache))
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

/** 模型抄回的短编号占位形态：`[图片:m1]` / `[视频:m1]`，整段交给映射表还原 */
const MEDIA_BOOK_TOKEN = /\[(图片|视频)\s*[:：]\s*m(\d+)\]/g

/**
 * 把模型抄回来的媒体短编号还原成原始占位符——maskMediaContent 的反向操作。
 *
 * 模型的两种回法都要接得住：
 * - 给了映射表时照抄 `[图片:m1]`，按表还原成 `[图片](url)`；
 * - 老提示词（或模型自作主张）直接抄 `[图片](url)`，原样放行。
 * 有短编号却查不到（比如编号抄丢了一位）时保留原样——渲染层不认识它，
 * 会当普通文字排出来，至少不会静默丢图。
 */
export function resolveMediaTokens(content: string, medias?: MediaBook): string {
  if (!content) return content
  if (!medias) return stripMediaTokens(content)
  return content.replace(MEDIA_BOOK_TOKEN, (match, kind: string, token: string) =>
    medias.resolve(`[${kind}:m${token}]`) ?? match)
}

/**
 * 没有映射表时的兜底：模型抄回来的短编号占位符 `[图片:m1]` 无从还原地址，
 * 把编号尾巴剥掉，退成不带地址的 `[图片]`——渲染层认识这个形态。
 */
function stripMediaTokens(content: string): string {
  return content.replace(MEDIA_BOOK_TOKEN, (_, kind: string) => `[${kind}]`)
}

export interface PromptMessageOptions {
  /**
   * 头像映射表。给了就优先带发言人编号 uid、省掉 sender 昵称（高光对话需要模型把发言人照抄回来，
   * 返回后再按编号还原昵称与头像）；没有编号的人才退回 sender 昵称。
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
 * - content：发言原文，多行原样保留（JSON 字符串天然区分边界，不再靠缩进）；
 *   给了 medias 映射表时，正文里的图片占位符会被换成短编号 `[图片:m1]`，地址留在表里
 * - uid：发言人在头像映射表里的短编号，给了 avatars 且该发言人有头像时输出；
 *   有 uid 就不带 sender——昵称由映射表按编号还原，省上下文也省得模型抄错
 * - sender：发送者昵称（没有昵称时回落为用户 ID），仅在没有 uid 的人上输出
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
      content: options.medias
        ? maskMediaContent(message.content, options.medias)
        : message.content,
    }
    const uid = options.avatars?.uidOf(message)
    if (uid) {
      item.uid = uid
    } else {
      item.sender = message.username || message.userId || ''
    }
    if (options.withScope) {
      item.scope = message.guildId ? `群:${message.guildId}` : `频道:${message.channelId}`
    }
    return item
  })
  return JSON.stringify(list, null, 2)
}
