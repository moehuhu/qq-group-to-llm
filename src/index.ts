import { Context, Schema, Session, Element } from 'koishi'

export const name = 'message-log'

export interface Config {
  /** 监听所有群组（true 时忽略 groups 配置） */
  listenAll: boolean
  /** 需要记录的群组列表（listenAll 为 false 时生效） */
  groups: string[]
  /** 记录机器人的消息 */
  recordBot: boolean
  /** 记录图片消息内容（否则仅记录 "图片" 占位符） */
  recordImages: boolean
  /** 记录引用消息 */
  recordQuotes: boolean
  /** 消息保留天数（0 表示永久保留） */
  retentionDays: number
  /** 查询时最多返回的消息条数 */
  maxQuery: number
}

export const Config: Schema<Config> = Schema.object({
  listenAll: Schema.boolean().default(true).description('监听所有群组（开启后忽略下方"监听群组"配置）'),
  groups: Schema.array(Schema.string()).default([]).description('需要记录的群组 ID 列表（listenAll 关闭时生效）'),
  recordBot: Schema.boolean().default(true).description('是否记录机器人自己发送的消息'),
  recordImages: Schema.boolean().default(false).description('是否记录图片消息（关闭时图片内容记录为"图片"）'),
  recordQuotes: Schema.boolean().default(true).description('是否记录引用消息的引用内容'),
  retentionDays: Schema.number().default(0).description('消息保留天数，0 表示永久保留').min(0),
  maxQuery: Schema.number().default(20).description('查询命令最多返回的消息条数').min(1).max(100),
})

export interface MessageRecord {
  id: string
  platform: string
  selfId: string
  channelId?: string
  guildId?: string
  userId?: string
  username: string
  content: string
  timestamp: Date
  messageId: string
}

declare module 'koishi' {
  interface Tables {
    message_log: MessageRecord
  }
}

/** 将消息元素序列化为纯文本（图片等元素替换为占位符） */
function serializeContent(session: Session, config: Config): string {
  const elements = session.elements ?? []
  const parts: string[] = []
  for (const el of elements) {
    if (el.type === 'text') {
      parts.push(el.attrs['content'] ?? '')
    } else if (el.type === 'img' || el.type === 'image') {
      parts.push(config.recordImages ? `[图片](${el.attrs['src'] || el.attrs['url'] || ''})` : '[图片]')
    } else if (el.type === 'quote') {
      parts.push(config.recordQuotes ? `[引用]${serializeNodes(el.children)}` : '[引用]')
    } else {
      parts.push(`[${el.type}]`)
    }
  }
  const text = parts.join('').trim()
  return text || session.content || ''
}

/** 递归序列化元素节点（用于引用消息内部） */
function serializeNodes(nodes: Element[]): string {
  const parts: string[] = []
  for (const el of nodes) {
    if (el.type === 'text') {
      parts.push(el.attrs['content'] ?? '')
    } else if (el.type === 'img' || el.type === 'image') {
      parts.push('[图片]')
    } else if (el.children?.length) {
      parts.push(serializeNodes(el.children))
    } else {
      parts.push(`[${el.type}]`)
    }
  }
  return parts.join('')
}

export const apply = Object.assign(function apply(ctx: Context, config: Config) {
  ctx.database.extend('message_log', {
    id: 'string',
    platform: 'string',
    selfId: 'string',
    channelId: 'string',
    guildId: 'string',
    userId: 'string',
    username: 'string',
    content: 'text',
    timestamp: 'timestamp',
    messageId: 'string',
  }, {
    primary: 'id',
  })

  /** 判断是否应该记录该会话消息 */
  function shouldRecord(session: Session): boolean {
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

  ctx.on('message', async (session) => {
    if (!shouldRecord(session)) return
    console.log(session)
    const record: MessageRecord = {
      id: `${session.platform}_${session.messageId || `${session.selfId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`}`,
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

    try {
      await ctx.database.create('message_log', record)
    } catch (error) {
      ctx.logger.warn('记录消息失败:', error)
    }
  })

  ctx.command('msglog [count:number]', '查询最近的消息记录')
    .option('group', '-g <group:string>  指定群组 ID')
    .option('user', '-u <user:string>  指定用户 ID')
    .action(async ({ options, session }, count) => {
      const limit = Math.min(Math.max(count ?? config.maxQuery, 1), config.maxQuery)
      const query: any = {}
      if (options?.group) {
        query.channelId = options.group
      } else if (session?.channelId) {
        query.channelId = session.channelId
      }
      if (options?.user) {
        query.userId = options.user
      }

      const records = await ctx.database
        .select('message_log')
        .where(query)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute()

      if (!records.length) return '暂无消息记录'

      const lines = records.map((record) => {
        const time = record.timestamp.toLocaleString('zh-CN', { hour12: false })
        return `[${time}] ${record.username || record.userId}: ${record.content}`
      })
      return lines.join('\n')
    })

  // 清理过期消息
  if (config.retentionDays > 0) {
    const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000
    ctx.setInterval(async () => {
      const cutoff = new Date(Date.now() - retentionMs)
      try {
        await ctx.database.remove('message_log', { timestamp: { $lt: cutoff } })
      } catch (error) {
        ctx.logger.warn('清理过期消息失败:', error)
      }
    }, 6 * 60 * 60 * 1000)
  }
}, { inject: ['database'] })
