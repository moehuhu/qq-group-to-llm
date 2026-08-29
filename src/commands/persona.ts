import { Context, Session } from 'koishi'
import type { Config } from '../config'
import { logger } from '../logger'
import { resolvePersona } from '../analysis'
import { renderHtmlToImage, renderPersonaHtml } from '../render'

/**
 * 取画像主人的头像。
 * 命令发出者本人的头像直接来自会话；查看他人时才需要问平台，
 * 拿不到就返回空，渲染时自动省略头像。
 */
async function resolveAvatar(session: Session, userId: string): Promise<string | undefined> {
  if (userId === session.userId) return session.author?.avatar

  try {
    const user = await session.bot.getUser(userId, session.guildId)
    return user?.avatar
  } catch {
    return undefined
  }
}

/** 用户画像：跨群汇总某个用户的发言，交给 LLM 生成画像 */
export function applyPersonaCommand(ctx: Context, config: Config) {
  const log = logger(ctx)
  ctx.command('用户画像 [target:user]', '用 LLM 生成指定用户的画像')
    .alias('user-persona')
    .usage([
      '不带参数时查看自己的画像，@某人 或传入用户 ID 可查看他人（需要权限）。',
      '画像每次都依据最近的发言重新生成，不参考此前的结论。',
    ].join('\n'))
    .option('force', '-f  忽略缓存重新生成')
    .userFields(['authority'])
    .action(async ({ options = {}, session }, target) => {
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
        const avatar = await resolveAvatar(session, userId)
        log.info(`${userId} 的头像${avatar ? `已取到: ${avatar}` : '未取到，结果中不展示'}`)

        const outcome = await resolvePersona(ctx, config, {
          platform: session.platform,
          userId,
          username: userId === session.userId ? (session.username || userId) : userId,
          avatar,
          channelId: session.channelId,
        }, options.force ?? false)

        const persona = outcome.persona
        if (!persona) {
          return outcome.reason ? `无法生成画像：${outcome.reason}。` : '无法生成画像。'
        }

        const evidence = persona.evidence
        const note = outcome.cached
          ? outcome.reason
            ? `（${outcome.reason}，展示的是此前的画像）`
            : '（复用了缓存的画像，可用 -f 强制重新生成）'
          : ''

        const image = await renderHtmlToImage(
          ctx, config,
          renderPersonaHtml(persona, evidence, outcome.avatar, config),
          '用户画像',
        )
        // 图文混在一条消息里在 QQ 官方接口上容易出问题，缓存说明另发一条。
        // 图片渲染或发送失败都不回退为 markdown，而是直接提示。
        // send 的返回值是消息 id，不要 return，否则会被命令当作文本再发一次。
        if (image) {
          try {
            await session.send(image)
          } catch (error) {
            log.warn('用户画像图片发送失败:', error)
            return `图片发送失败：${error instanceof Error ? error.message : String(error)}`
          }
          // 有缓存说明则作为另一条消息发出；两者都只 await 不 return
          if (note) await session.send(note)
          return
        }
        return '图片渲染失败，请稍后重试。'
      } catch (error) {
        log.error('用户画像生成失败:', error)
        return `用户画像生成失败：${error instanceof Error ? error.message : String(error)}`
      }
    })
}
