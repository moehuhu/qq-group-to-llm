import { Context, Element, Session, Universal } from 'koishi'
import type { Config } from '../config'
import { MessageRecord, TABLE } from '../database'
import { logger } from '../logger'
import { cleanContent, faceToken } from '../text'

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

/**
 * 将消息元素序列化为纯文本。
 * 图片、引用等非文本元素替换为占位符，是否展开由配置决定。
 */
function serializeNodes(nodes: Element[], config: Config, nested = false): string {
  return nodes.map((el) => {
    if (el.type === 'text') {
      return el.attrs['content'] ?? ''
    } else if (el.type === 'img' || el.type === 'image') {
      return !nested && config.recordImages
        ? `[图片](${el.attrs['src'] || el.attrs['url'] || ''})`
        : '[图片]'
    } else if (el.type === 'emoji' || el.type === 'face') {
      // 表情元素带的 name 就是 QQ 里显示的名字（「[安详]」之类）。
      // 落到下面的兜底分支只会存下一个 [emoji]，这句话说了什么就没了。
      return faceToken(String(el.attrs['name'] ?? '')) || '[表情]'
    } else if (el.type === 'quote') {
      // 引用由 quotePreview 单独压成正文首行，这里跳过，免得同一条引用在正文里出现两次
      return ''
    } else if (nested && el.children?.length) {
      return serializeNodes(el.children, config, true)
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
function quotePreview(session: Session, config: Config): string {
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
  const flat = cleanContent(serializeNodes(nodes, config, true))
    .replace(/\s+/g, ' ')
    .trim()
  // 按码位切，emoji 的代理对不会被劈成半个字
  const chars = [...flat]
  const preview = chars.length > QUOTE_PREVIEW_LIMIT
    ? `${chars.slice(0, QUOTE_PREVIEW_LIMIT).join('')}…`
    : flat
  return quoteToken(quote ? quoteAuthor(quote) : '', preview)
}

function buildRecord(session: Session, config: Config): MessageRecord {
  const suffix = session.messageId ||
    `${session.selfId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const elements = session.elements ?? []
  // 没有元素时才退回 session.content：有元素的话它只是同一份内容的 XML 形态，
  // 里头的 <quote/> 标签原样落库就成了正文里的一段噪音
  const body = elements.length
    ? cleanContent(serializeNodes(elements, config))
    : cleanContent(session.content)
  // 引用独占首行：正文可能好几行，混排在一起就分不清哪句是回的、哪句是说的
  const content = [quotePreview(session, config), body].filter(Boolean).join('\n')
  return {
    id: `${session.platform}_${suffix}`,
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    guildId: session.guildId,
    userId: session.userId,
    username: session.username || '',
    // 头像地址随发言一起留存：事后渲染时平台接口未必还查得到这个人
    avatar: session.author?.avatar || '',
    content,
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
  ctx.on('message', async (session) => {
    if (!shouldRecord(session, config)) {
      log.debug(`跳过消息 ${session.platform}:${session.channelId} <- ${session.userId}`)
      return
    }
    const record = buildRecord(session, config)
    try {
      await ctx.database.create(TABLE, record)
      recorded++
      log.debug(`已记录 #${recorded} ${record.channelId} ${record.username}(${record.userId}): ${record.content.slice(0, 60)}`)
    } catch (error) {
      log.warn(`记录消息失败 (id=${record.id}):`, error)
    }
  })

  ctx.on('dispose', () => log.info(`消息监听已停止，本次运行共记录 ${recorded} 条`))
}
