import { Context, Element, Session } from 'koishi'
import type { Config } from './config'
import { MessageRecord, TABLE } from './model'

/** 判断某条会话消息是否应该被记录 */
function shouldRecord(session: Session, config: Config): boolean {
  if (!session.guildId || !session.channelId) return false
  if (!config.recordBot && session.userId === session.selfId) return false
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
    } else if (el.type === 'quote') {
      return config.recordQuotes ? `[引用]${serializeNodes(el.children, config, true)}` : '[引用]'
    } else if (nested && el.children?.length) {
      return serializeNodes(el.children, config, true)
    }
    return `[${el.type}]`
  }).join('')
}

function buildRecord(session: Session, config: Config): MessageRecord {
  const suffix = session.messageId ||
    `${session.selfId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const content = serializeNodes(session.elements ?? [], config).trim()
  return {
    id: `${session.platform}_${suffix}`,
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    guildId: session.guildId,
    userId: session.userId,
    username: session.username || '',
    content: content || session.content || '',
    timestamp: new Date(session.timestamp),
    messageId: session.messageId || '',
  }
}

/** 注册消息监听，将符合条件的消息写入数据库 */
export function applyMessageListener(ctx: Context, config: Config) {
  ctx.on('message', async (session) => {
    if (!shouldRecord(session, config)) return
    try {
      await ctx.database.create(TABLE, buildRecord(session, config))
    } catch (error) {
      ctx.logger.warn('记录消息失败:', error)
    }
  })
}
