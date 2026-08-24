import { Context } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { renderPersona, resolveEvidence, resolvePersona } from '../analysis'

/** 用户画像：跨群汇总某个用户的发言，交给 LLM 生成画像 */
export function applyPersonaCommand(ctx: Context, config: Config) {
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
