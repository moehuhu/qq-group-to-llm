import { Context, Session } from 'koishi'
import type { Config, MessageRecord } from './types'
import { serializeContent } from './serialize'

/** 判断某条会话消息是否应该被记录 */
function shouldRecord(session: Session, config: Config): boolean {
  if (!session.guildId || !session.channelId) return false
  if (!config.recordBot && session.userId === session.selfId) return false
  if (config.listenAll) return true
  if (!config.groups.length) return false
  return config.groups.some((group) => {
    const [platform, channelId] = group.split(':')
    return (!platform || platform === session.platform) &&
      (!channelId || channelId === session.channelId)
  })
}

function buildRecord(session: Session, config: Config): MessageRecord {
  const suffix = session.messageId ||
    `${session.selfId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id: `${session.platform}_${suffix}`,
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId,
    guildId: session.guildId,
    userId: session.userId,
    username: session.username || session.event.user?.name || '',
    content: serializeContent(session, config),
    timestamp: new Date(session.timestamp),
    messageId: session.messageId || '',
  }
}

/** 注册消息监听，将符合条件的消息写入数据库 */
export function applyMessageListener(ctx: Context, config: Config) {
  ctx.on('message', async (session) => {
    if (!shouldRecord(session, config)) return
    const record = buildRecord(session, config)
    try {
      await ctx.database.create('chaoli_group_messages', record)
    } catch (error) {
      ctx.logger.warn('记录消息失败:', error)
    }
  })
}
