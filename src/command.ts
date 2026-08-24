import { Context, Session } from 'koishi'
import type { Config } from './config'
import { logger } from './logger'
import { TABLE } from './model'
import { analyzeGroup, answerQuery, AnalysisTarget, fetchMessages, renderReport } from './analysis'
import { renderPersona, resolveEvidence, resolvePersona } from './persona'

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
  const log = logger(ctx)
  ctx.command('msglog [count:number]', '查询最近的消息记录')
    .option('group', '-g <group:string>  指定群组 ID')
    .option('user', '-u <user:string>  指定用户 ID')
    .action(async ({ options, session }, count) => {
      const limit = Math.min(Math.max(count ?? config.maxQuery, 1), config.maxQuery)
      const query: Record<string, string> = {}
      const channelId = options?.group || session?.channelId
      if (channelId) query.channelId = channelId
      if (options?.user) query.userId = options.user

      log.info(`msglog 由 ${session?.userId} 在 ${session?.channelId} 发起，条件 ${JSON.stringify(query)}，limit=${limit}`)

      const records = await ctx.database
        .select(TABLE)
        .where(query)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .execute()

      log.info(`msglog 返回 ${records.length} 条记录`)
      if (!records.length) return '暂无消息记录'

      return records.map((record) => {
        const time = record.timestamp.toLocaleString('zh-CN', { hour12: false })
        return `[${time}] ${record.username || record.userId}: ${record.content}`
      }).join('\n')
    })
}

/** 群分析：调用 LLM 生成报告，或就聊天记录自由提问 */
function applyAnalysisCommand(ctx: Context, config: Config) {
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
    .action(async ({ options, session }, query) => {
      const channelId = options.group || session?.channelId
      if (!channelId) return '请在群聊中使用，或用 -g 指定频道 ID。'

      const days = Math.min(Math.max(options.days ?? config.analysisDays, 1), 7)
      const target = resolveTarget(session, channelId)
      const question = query?.trim()

      log.info(`群分析由 ${session?.userId} 在 ${channelId} 发起，days=${days}，` +
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

/** 用户画像：跨群汇总某个用户的发言，交给 LLM 生成画像 */
function applyPersonaCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
  ctx.command('用户画像 [target:user]', '用 LLM 生成指定用户的画像')
    .alias('user-persona')
    .usage([
      '不带参数时查看自己的画像，@某人 或传入用户 ID 可查看他人（需要权限）。',
      '画像会在历史结论的基础上迭代，而不是每次推倒重来。',
    ].join('\n'))
    .option('force', '-f  忽略缓存重新生成')
    .userFields(['authority'])
    .action(async ({ options, session }, target) => {
      if (!session?.userId) return '无法识别当前用户。'

      const userId = target?.split(':')[1] || session.userId
      log.info(`用户画像由 ${session.userId} 发起，目标 ${userId}${options.force ? '，强制刷新' : ''}`)

      if (userId !== session.userId && (session.user?.authority ?? 0) < config.personaViewAuthority) {
        log.info(`权限不足: ${session.userId} 权限 ${session.user?.authority ?? 0} < ${config.personaViewAuthority}，拒绝查看 ${userId}`)
        return `查看他人画像需要 ${config.personaViewAuthority} 级权限。`
      }
      if (config.personaUserFilter.includes(userId)) {
        log.info(`${userId} 在 personaUserFilter 中，拒绝分析`)
        return '该用户已被设置为不参与画像分析。'
      }

      await session.send('正在生成用户画像，请稍候…')

      try {
        const outcome = await resolvePersona(ctx, config, {
          platform: session.platform,
          userId,
          username: userId === session.userId ? (session.username || userId) : userId,
          channelId: session.channelId,
        }, options.force ?? false)

        if (!outcome.persona) {
          return outcome.reason ? `无法生成画像：${outcome.reason}。` : '无法生成画像。'
        }

        const evidence = await resolveEvidence(ctx, outcome.persona)
        const report = renderPersona(outcome.persona, evidence)
        const note = outcome.cached
          ? outcome.reason
            ? `\n\n（${outcome.reason}，展示的是此前的画像）`
            : '\n\n（复用了缓存的画像，可用 -f 强制重新生成）'
          : ''
        return report + note
      } catch (error) {
        log.error('用户画像生成失败:', error)
        return `用户画像生成失败：${error instanceof Error ? error.message : String(error)}`
      }
    })
}

export function applyCommands(ctx: Context, config: Config) {
  applyLogCommand(ctx, config)
  applyAnalysisCommand(ctx, config)
  applyPersonaCommand(ctx, config)
}
