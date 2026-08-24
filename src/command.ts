import { Context, Session } from 'koishi'
import type { Config } from './config'
import { TABLE } from './model'
import { analyzeGroup, answerQuery, AnalysisTarget, fetchMessages, renderReport } from './analysis'

/** 分析结果缓存，键为 频道:天数 */
interface CacheEntry {
  expireAt: number
  report: string
}

function resolveTarget(session: Session, channelId: string): AnalysisTarget {
  return {
    channelId,
    guildId: session.guildId,
    groupName: session.event?.guild?.name,
  }
}

/** msglog：查询最近的原始消息记录 */
function applyLogCommand(ctx: Context, config: Config) {
  ctx.command('msglog [count:number]', '查询最近的消息记录')
    .option('group', '-g <group:string>  指定群组 ID')
    .option('user', '-u <user:string>  指定用户 ID')
    .action(async ({ options, session }, count) => {
      const limit = Math.min(Math.max(count ?? config.maxQuery, 1), config.maxQuery)
      const query: Record<string, string> = {}
      const channelId = options?.group || session?.channelId
      if (channelId) query.channelId = channelId
      if (options?.user) query.userId = options.user

      const records = await ctx.database
        .select(TABLE)
        .where(query)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute()

      if (!records.length) return '暂无消息记录'

      return records.map((record) => {
        const time = record.timestamp.toLocaleString('zh-CN', { hour12: false })
        return `[${time}] ${record.username || record.userId}: ${record.content}`
      }).join('\n')
    })
}

/** 群分析：调用 LLM 生成报告，或就聊天记录自由提问 */
function applyAnalysisCommand(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()

  ctx.command('群分析 [query:text]', '用 LLM 分析本群近期的聊天记录')
    .alias('group-analysis')
    .usage([
      '不带参数时生成一份分析报告（话题、金句、活跃榜）。',
      '带参数时就聊天记录自由提问，例如：群分析 今天有人聊到部署问题吗',
    ].join('\n'))
    .option('days', '-d <days:number>  分析最近几天的记录')
    .option('group', '-g <group:string>  指定频道 ID')
    .option('force', '-f  忽略缓存重新分析')
    .action(async ({ options, session }, query) => {
      const channelId = options.group || session?.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)
      const target = resolveTarget(session, channelId)
      const question = query?.trim()

      const cacheKey = `${channelId}:${days}`
      if (!question && !options.force && config.cacheMinutes > 0) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expireAt > Date.now()) return cached.report
      }

      const messages = await fetchMessages(ctx, config, target, days)
      if (messages.length < config.minMessages) {
        return `最近 ${days} 天只有 ${messages.length} 条记录，不足 ${config.minMessages} 条，无法分析。`
      }

      await session.send(`正在分析最近 ${days} 天的 ${messages.length} 条消息，请稍候…`)

      try {
        if (question) {
          return await answerQuery(ctx, messages, target, question)
        }
        const report = renderReport(await analyzeGroup(ctx, config, messages, target))
        if (config.cacheMinutes > 0) {
          cache.set(cacheKey, { report, expireAt: Date.now() + config.cacheMinutes * 60 * 1000 })
        }
        return report
      } catch (error) {
        ctx.logger.error('群分析执行失败:', error)
        return `群分析失败：${error instanceof Error ? error.message : String(error)}`
      }
    })

  ctx.on('dispose', () => cache.clear())
}

export function applyCommands(ctx: Context, config: Config) {
  applyLogCommand(ctx, config)
  applyAnalysisCommand(ctx, config)
}
