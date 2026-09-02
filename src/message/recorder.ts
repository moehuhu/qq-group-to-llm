import { Context, Element, Session, Universal } from 'koishi'
import type { Config } from '../config'
import { MessageRecord, TABLE } from '../database'
import { rememberAvatar, type AvatarCache } from '../avatar'
import { logger } from '../logger'
import { AT_ALL_NAME, atToken, cardBlock, cleanContent, faceToken, mediaKind, mediaToken } from '../text'

/** 判断某条会话消息是否应该被记录 */
function shouldRecord(session: Session, config: Config): boolean {
  if (!session.guildId || !session.channelId) return false
  if (session.userId === session.selfId) return false
  if (config.listenAll) return true
  return config.groups.some((group) => {
    const [platform, channelId] = group.split(':')
    return (!platform || platform === session.platform) &&
      (!channelId || channelId === session.channelId)
  })
}

/** 媒体元素 → 占位符类型 */
const ELEMENT_MEDIA: Record<string, string> = {
  video: '视频',
  audio: '语音',
  file: '文件',
}

/** 媒体元素的地址。satori 统一放在 src 上，个别适配器给的是 url */
const src = (el: Element): string => String(el.attrs['src'] || el.attrs['url'] || '')

/**
 * 适配器挂在会话上的整份平台下发载荷（satori 的 setInternal），QQ 的形状是
 * `{ t, d: { … } }`。别的平台对不上就是空对象，取什么都是 undefined——
 * 这几段只在适配器漏了东西时兜底，不是主路径。
 */
function rawPayload(session: Session): {
  mentions?: unknown,
  attachments?: unknown,
  ark_data?: unknown,
  message_type?: unknown,
} {
  const event = session.event as {
    _data?: { d?: { mentions?: unknown, attachments?: unknown, ark_data?: unknown, message_type?: unknown } }
  }
  return event._data?.d ?? {}
}

/** 载荷里的提及列表。每项带 `id` 与 `username`——正是 at 元素上缺的那个名字 */
function rawMentions(session: Session): { id?: string, username?: string }[] {
  const list = rawPayload(session).mentions
  return Array.isArray(list) ? list : []
}

/**
 * 见过的人：`平台:用户 ID` → 昵称。
 *
 * QQ 的 at 元素上只有一个 openid，名字挂在同一份载荷的 mentions 列表里，
 * 而那只覆盖当前这条消息。被引用的那条、转发卡片里的那几条，它们的 at
 * 不在这份 mentions 里——只看当前载荷就只能落一个「某人」。
 * 所以每见到一个名字就记下来，回头认得出是谁。
 */
type NameBook = Map<string, string>

/** 记得住的人数上限。群成员再多也用不满，纯粹防着长期跑下来无限涨 */
const NAME_BOOK_LIMIT = 2000

function rememberName(book: NameBook, platform: string, id: string | undefined, name: string | undefined): void {
  const trimmed = String(name ?? '').trim()
  if (!id || !trimmed) return
  // 先删再塞，让它排到队尾；满了先扔最久没露过面的那个
  const key = `${platform}:${id}`
  book.delete(key)
  book.set(key, trimmed)
  if (book.size > NAME_BOOK_LIMIT) book.delete(book.keys().next().value!)
}

/** bot 自己的昵称。取不到退成「机器人」——总比落一个「某人」认得出是谁 */
function botName(session: Session): string {
  return String(session.bot.user?.nick || session.bot.user?.name || '').trim() || '机器人'
}

/**
 * 这条消息里的 at 元素该显示成谁。名字按四条来路依次找：
 *
 * 1. 元素自带的 `name`——别的平台的适配器会一并给上；
 * 2. 这份载荷的 mentions 列表，按 id 对上；
 * 3. 被 @ 的是 bot 自己——adapter-qq-crack 会把 bot 的 at 改写成 `selfId`，
 *    而 mentions 里记的是 bot 的 openid，两边对不上，得单拎出来认；
 * 4. 先前记下的名字（引用与转发里的 at 只能靠这条）。
 *
 * 四条都落空就返回空串，交给 `atToken` 兜底成「某人」。
 */
function mentionResolver(session: Session, book: NameBook): (el: Element) => string {
  const names = new Map<string, string>()
  for (const mention of rawMentions(session)) {
    if (mention.id && mention.username) names.set(mention.id, mention.username)
    rememberName(book, session.platform, mention.id, mention.username)
  }
  return (el) => {
    // `type="all"` 是 satori 的写法；个别适配器把 id 直接写成 all
    if (el.attrs['type'] === 'all' || el.attrs['id'] === 'all') return AT_ALL_NAME
    const name = String(el.attrs['name'] ?? '').trim()
    if (name) return name
    const id = String(el.attrs['id'] ?? '')
    if (!id) return ''
    return names.get(id) ||
      (id === session.selfId ? botName(session) : '') ||
      book.get(`${session.platform}:${id}`) || ''
  }
}

/**
 * 序列化一条消息要用到的东西：配置，加上把 at 元素换成名字的解析器。
 * 解析器得按会话现建（名字来自这条消息的载荷），不像 config 那样一处取就够。
 */
interface Serializer {
  config: Config
  /** at 元素 → 显示名，认不出是谁时返回空串 */
  mention: (el: Element) => string
}

/**
 * 将消息元素序列化为纯文本。
 * 图片、视频、引用等非文本元素替换为占位符，是否留地址由配置决定。
 */
function serializeNodes(nodes: Element[], serializer: Serializer, nested = false): string {
  const { config } = serializer
  return nodes.map((el) => {
    if (el.type === 'text') {
      return el.attrs['content'] ?? ''
    } else if (el.type === 'img' || el.type === 'image') {
      return mediaToken('图片', src(el), !nested)
    } else if (el.type === 'video' || el.type === 'audio' || el.type === 'file') {
      // 落到下面的兜底分支会存成 `[video]`，跟转发卡片那边解析出来的 `[视频]` 对不上，
      // 渲染和统计就得认两套词
      return mediaToken(ELEMENT_MEDIA[el.type], src(el), !nested && config.recordImages)
    } else if (el.type === 'emoji' || el.type === 'face') {
      // 表情元素带的 name 就是 QQ 里显示的名字（「[安详]」之类）。
      // 落到下面的兜底分支只会存下一个 [emoji]，这句话说了什么就没了。
      return faceToken(String(el.attrs['name'] ?? '')) || '[表情]'
    } else if (el.type === 'at') {
      // 落到兜底分支就是一个光秃秃的 `[at]`：@ 的是谁没了，「@张三 你看看」
      // 到了模型眼里成了「[at] 你看看」——一句话是冲谁说的，全靠这个名字
      return atToken(serializer.mention(el))
    } else if (el.type === 'quote') {
      // 引用由 quotePreview 单独压成正文首行，这里跳过，免得同一条引用在正文里出现两次
      return ''
    } else if (nested && el.children?.length) {
      return serializeNodes(el.children, serializer, true)
    }
    return `[${el.type}]`
  }).join('')
}

/**
 * 引用预览保留的原话字数上限。
 * 被引用的那条消息自己也在库里，正文这一行只是标出「回的是哪句」，
 * 抄全文既撑数据库也白白多喂模型一份——QQ 自己的引用条同样是截断展示的。
 */
const QUOTE_PREVIEW_LIMIT = 60

/** 昵称的字数上限。群名片可以很长，占满整行就把原话挤没了 */
const QUOTE_NAME_LIMIT = 24

/** 会破掉 `[引用 昵称]` 这对方括号边界的字符 */
const QUOTE_NAME_BREAKERS = /[[\]\r\n]/g

/**
 * 引用预览的格式：`[引用 张三] 原话`，独占正文首行。
 *
 * 昵称写在方括号**里**而不是括号外，是为了让渲染那边一眼断出边界——
 * 换成 `[引用] 张三: 原话`，遇上「我觉得可以：真的」这种原话就分不清
 * 哪一截是昵称了。所以昵称里的方括号与换行先剔掉，边界才咬得死。
 */
function quoteToken(name: string, preview: string): string {
  const label = name ? `引用 ${name}` : '引用'
  return preview ? `[${label}] ${preview}` : `[${label}]`
}

/** 被引用消息的发言人：优先群名片，再退到昵称、用户名，最后是用户 ID */
function quoteAuthor(quote: Universal.Message): string {
  const raw = quote.member?.nick || quote.member?.name ||
    quote.user?.nick || quote.user?.name || quote.user?.id || ''
  return raw.replace(QUOTE_NAME_BREAKERS, ' ').trim().slice(0, QUOTE_NAME_LIMIT)
}

/**
 * 把被引用的消息压成一行预览，没有引用时返回空串。
 *
 * 引用元素到了 QQ 适配器手里往往是个空壳——只有一个 messageId，children 是空的。
 * 光看 elements 就只能存下一个孤零零的 `[引用]`：回的是谁、回的是哪句，全丢了，
 * 模型读到的一来一回也就接不上。被引用消息的正文挂在 session.quote 上，
 * 这里以它为准，拿不到时才退回引用元素自己的子节点。
 */
function quotePreview(session: Session, serializer: Serializer): string {
  const { config } = serializer
  const quote = session.quote
  const element = (session.elements ?? []).find((el) => el.type === 'quote')
  if (!quote && !element) return ''
  if (!config.recordQuotes) return '[引用]'

  const nodes = quote?.elements?.length
    ? quote.elements
    : quote?.content
      ? Element.parse(quote.content)
      : element?.children ?? []
  // 预览只占一行，而被引用的正文未必只有一行（合并转发就是一整块），一律压平
  const flat = cleanContent(serializeNodes(nodes, serializer, true), config.recordImages)
    .replace(/\s+/g, ' ')
    .trim()
  // 按码位切，emoji 的代理对不会被劈成半个字
  const chars = [...flat]
  const preview = chars.length > QUOTE_PREVIEW_LIMIT
    ? `${chars.slice(0, QUOTE_PREVIEW_LIMIT).join('')}…`
    : flat
  return quoteToken(quote ? quoteAuthor(quote) : '', preview)
}

/** 平台原始载荷里的附件列表。对不上形状的平台就是空数组，什么也不会补 */
function rawAttachments(session: Session): { content_type?: string, url?: string }[] {
  const list = rawPayload(session).attachments
  return Array.isArray(list) ? list : []
}

/** elements 里已经出现过的媒体地址，用来认出哪些附件被适配器丢在了半路 */
function mediaUrls(nodes: Element[], urls = new Set<string>()): Set<string> {
  for (const el of nodes) {
    const url = src(el)
    if (url) urls.add(url)
    if (el.children?.length) mediaUrls(el.children, urls)
  }
  return urls
}

/**
 * 补回适配器漏掉的附件。
 *
 * adapter-qq-crack 转图片时按 `content_type.startsWith('image')` 认，
 * 转视频和语音却要求 content_type **精确等于** `'video'` / `'voice'`——
 * 而 QQ 下发的是 MIME（`video/mp4`、`audio/amr`），两个分支等于是死代码。
 * 于是一条纯视频消息在 elements 里一个元素都不剩，正文也是空的，
 * 落库就是一条什么都没有的空记录（库里那几条空记录就是这么来的）。
 *
 * 所以从原始载荷里按地址比对补一遍：已经转成元素的不补第二遍，
 * 哪天适配器修好了这里自然就不再出手。
 */
function droppedAttachments(session: Session, config: Config): string {
  const seen = mediaUrls(session.elements ?? [])
  return rawAttachments(session)
    .filter((item) => item.url && !seen.has(item.url))
    .map((item) => {
      const kind = mediaKind(item.content_type)
      return mediaToken(kind, item.url, kind === '图片' ? true : config.recordImages)
    })
    .join('')
}

/** 原始载荷里的卡片数据（Ark / 分享链接），对不上形状就是 undefined */
function rawCardData(session: Session): Record<string, unknown> | undefined {
  const ark = rawPayload(session).ark_data
  return ark && typeof ark === 'object' ? ark as Record<string, unknown> : undefined
}

/** 卡片字段的常见键名 → 渲染层的统一键。QQ 的 fields 键名不完全固定，别名都认一遍 */
const CARD_FIELD_ALIASES: Record<string, string[]> = {
  标题: ['title', 'name'],
  来源: ['source', 'subtitle', 'tag'],
  描述: ['desc', 'description', 'prompt', 'nickname', 'address'],
  封面: ['preview', 'cover', 'img', 'avatar'],
  链接: ['jump_url', 'url', 'link'],
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** 从载荷 ark_data 里读出一张卡片的字段，键为渲染层统一的五个键 */
function extractCardFields(ark: Record<string, unknown>): Record<string, string> {
  const fields = ark.fields
  const source = fields && typeof fields === 'object' ? fields as Record<string, unknown> : ark
  const out: Record<string, string> = {}
  for (const [key, aliases] of Object.entries(CARD_FIELD_ALIASES)) {
    for (const alias of aliases) {
      const value = firstString(source[alias])
      if (value) { out[key] = value; break }
    }
  }
  return out
}

/** 卡片类型的中文名：优先 ark_name，退回 ark_type，都没有就按内容猜 */
function cardKindName(ark: Record<string, unknown>, fields: Record<string, string>): string {
  return firstString(ark.ark_name)
    ?? firstString(ark.ark_type)
    ?? (fields.来源 || '卡片')
}

/**
 * 把 QQ 卡片消息压成自包含的占位块。适配器收到卡片时只留下
 * `[卡片消息] 小程序\n摘要: …` 这样一行占位文本，结构化字段全丢了——
 * 这里从原始载荷的 ark_data 里把字段捞回来，存成渲染层能还原的形态。
 * 没有卡片数据时返回空串。
 */
function buildCardBlock(session: Session): string {
  const ark = rawCardData(session)
  if (!ark) return ''
  const fields = extractCardFields(ark)
  return cardBlock(cardKindName(ark, fields), fields)
}

/** QQ 卡片消息在正文里留下的残缺占位文本：`[卡片消息] 小程序\n摘要: …` */
const CARD_PLACEHOLDER = /[ \t]*\[卡片消息\][^\n]*(?:\n[ \t]*摘要[:：][^\n]*)?/g

/**
 * 有结构化卡片块时，把正文里适配器留下的残缺占位文本清掉——
 * 卡片内容已经由 ark_data 完整还原，占位文本再留着就是两份卡片信息。
 */
function stripCardPlaceholder(body: string): string {
  if (!body) return body
  return body
    .replace(CARD_PLACEHOLDER, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

async function cacheImages(
  ctx: Context,
  content: string,
  log: ReturnType<typeof logger>,
): Promise<string> {
  const urls = [...content.matchAll(/\[图片\]\((https?:\/\/[^\s)]+)\)/g)]
    .map((match) => match[1])
  const cached: { url: string, data: string }[] = []
  for (const url of [...new Set(urls)]) {
    try {
      const data = await ctx.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
      const base64 = Buffer.from(data).toString('base64')
      cached.push({ url, data: `data:image/jpeg;base64,${base64}` })
    } catch (error) {
      log.warn(`图片缓存失败，保留原链接 ${url}:`, error)
    }
  }
  return JSON.stringify(cached)
}

async function buildRecord(ctx: Context, session: Session, config: Config, book: NameBook, log: ReturnType<typeof logger>): Promise<MessageRecord> {
  const suffix = session.messageId ||
    `${session.selfId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const serializer: Serializer = { config, mention: mentionResolver(session, book) }
  const elements = session.elements ?? []
  // 没有元素时才退回 session.content：有元素的话它只是同一份内容的 XML 形态，
  // 里头的 <quote/> 标签原样落库就成了正文里的一段噪音
  const body = elements.length
    ? cleanContent(serializeNodes(elements, serializer), config.recordImages)
    : cleanContent(session.content, config.recordImages)
  // 适配器漏掉的附件接在正文后面。正文是多行（压好的转发卡片）时另起一行——
  // 直接贴上去会挂到卡片最后一条记录的屁股上，像是那个人发的
  const dropped = droppedAttachments(session, config)
  // 适配器漏掉的卡片（Ark/分享链接）接在正文后面；卡片可能独占一条消息。
  // 有卡片时先清掉正文里的残缺占位文本，避免两份卡片信息
  const card = buildCardBlock(session)
  const main = card ? stripCardPlaceholder(body) : body
  const full = [main, dropped, card].filter(Boolean).join(main.includes('\n') ? '\n' : '')
  // 引用独占首行：正文可能好几行，混排在一起就分不清哪句是回的、哪句是说的
  const content = [quotePreview(session, serializer), full].filter(Boolean).join('\n')
  return {
    id: `${session.platform}_${suffix}`,
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    guildId: session.guildId,
    userId: session.userId,
    username: session.username || '',
    // 头像不再逐条留存：同一个人的地址在这里重复成千上万遍，
    // 改为按人存进 qq_group_avatars（见 avatar.ts），这一列只留着读老记录
    avatar: '',
    content,
    media: await cacheImages(ctx, content, log),
    timestamp: new Date(session.timestamp),
    messageId: session.messageId || '',
  }
}

/** 注册消息监听，将符合条件的消息写入数据库 */
export function applyMessageListener(ctx: Context, config: Config) {
  // 在插件作用域内取一次；dispose 阶段 ctx.logger 已不可用，不能延迟解析
  const log = logger(ctx)

  const scope = config.listenAll
    ? '全部群组'
    : config.groups.length ? `${config.groups.length} 个指定群组: ${config.groups.join(', ')}` : '无（未配置 groups）'
  log.info(`消息监听已启动，范围: ${scope}`)

  let recorded = 0
  // 认人用的名册跟着插件走：卸载即丢，不留跨实例的残留
  const book: NameBook = new Map()
  // 已经落过库的脸，用来省掉每条消息一次 upsert；头像本身存在库里，丢了缓存只是多写一次
  const faces: AvatarCache = new Map()

  ctx.on('message', async (session) => {
    if (!shouldRecord(session, config)) {
      log.debug(`跳过消息 ${session.platform}:${session.channelId} <- ${session.userId}`)
      return
    }
    // 说过话的人，回头被 @ 时就认得出——QQ 的 at 元素上只有一个 openid
    rememberName(book, session.platform, session.userId, session.username)
    const record = await buildRecord(ctx, session, config, book, log)
    if (!record.content) {
      // 一个字都没解析出来的消息不入库：空记录白占一条条数、把人均字数往下拉，
      // 投喂给模型的文本里还留一行没有内容的发言。
      // 打 warn 而不是 debug：这通常意味着又出现了一种没人认得的消息类型
      const types = (session.elements ?? []).map((el) => el.type).join('/') || '无'
      log.warn(`跳过无法解析的消息 ${record.id}（元素: ${types}，原始附件: ${rawAttachments(session).length} 个）`)
      return
    }
    try {
      await ctx.database.create(TABLE, record)
      recorded++
      log.debug(`已记录 #${recorded} ${record.channelId} ${record.username}(${record.userId}): ${record.content.slice(0, 60)}`)
    } catch (error) {
      log.warn(`记录消息失败 (id=${record.id}):`, error)
    }
    // 头像单独记：新面孔、换了头像或改了昵称才写一次，写失败不影响上面这条消息
    await rememberAvatar(ctx, faces, {
      platform: session.platform,
      userId: session.userId,
      username: session.username,
      avatar: session.author?.avatar,
    })
  })

  ctx.on('dispose', () => log.info(`消息监听已停止，本次运行共记录 ${recorded} 条`))
}
