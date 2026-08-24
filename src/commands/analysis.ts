import { Context, Session } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { AnalysisTarget, analyzeGroup, answerQuery, fetchMessages, renderReport } from '../analysis'

/** 分析结果缓存，键为 频道:天数 */
interface CacheEntry {
  expireAt: number
  report: string
}

/** 解析分析目标；群名优先取事件里的 guild.name，取不到时向平台查询 */
async function resolveTarget(ctx: Context, session: Session, channelId: string): Promise<AnalysisTarget> {
  const log = logger(ctx)
  let groupName = session.event?.guild?.name
  if (!groupName && session.guildId) {
    try {
      groupName = (await session.bot.getGuild(session.guildId)).name
      log.debug(`已通过平台接口取到群聊标题: ${groupName} (${session.guildId})`)
    } catch (error) {
      log.warn(`查询群 ${session.guildId} 名称失败，分析将回退使用群 ID:`, error)
    }
  }
  return {
    channelId,
    guildId: session.guildId,
    groupName,
  }
}

/** 群分析：调用 LLM 生成报告，或就聊天记录自由提问 */
export function applyAnalysisCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
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
    .action(async ({ options = {}, session }, query) => {
      if (!session) return

      const channelId = options.group || session.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)
      const target = await resolveTarget(ctx, session, channelId)
      const question = query?.trim()

      log.info(`群分析由 ${session.userId} 在 ${channelId} 发起，days=${days}，` +
        `模式=${question ? `问答「${question}」` : '报告'}${options.force ? '，强制刷新' : ''}`)

      const cacheKey = `${channelId}:${days}`
      if (!question && !options.force && config.cacheMinutes > 0) {
        const cached = cache.get(cacheKey)
        if (cached && cached.expireAt > Date.now()) {
          log.info(`命中群分析缓存 ${cacheKey}，剩余 ${Math.round((cached.expireAt - Date.now()) / 1000)}s，跳过 LLM 调用`)
          return cached.report
        }
      }

      const messages = await fetchMessages(ctx, config, target, days)
      if (messages.length < config.minMessages) {
        log.info(`群分析中止: ${messages.length} 条记录不足 minMessages=${config.minMessages}`)
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
          log.debug(`群分析结果已缓存 ${cacheKey}，${config.cacheMinutes} 分钟内复用`)
        }
        return report
      } catch (error) {
        log.error('群分析执行失败:', error)
        return `群分析失败：${error instanceof Error ? error.message : String(error)}`
      }
    })

  ctx.on('dispose', () => cache.clear())
}
