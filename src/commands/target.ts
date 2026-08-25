import { Context, Session } from 'koishi'
import { logger } from '../logger'
import type { AnalysisTarget } from '../analysis'

/**
 * 解析分析目标；群名优先取事件里的 guild.name，取不到时向平台查询。
 *
 * QQ 官方 bot 的消息事件里通常不带群名，必须补一次 getGuild，
 * 否则报告标题只会显示一串频道 ID。所有出图的命令都要走这里。
 */
export async function resolveTarget(
  ctx: Context,
  session: Session,
  channelId: string,
): Promise<AnalysisTarget> {
  const log = logger(ctx)
  let groupName = session.event?.guild?.name
  if (!groupName && session.guildId) {
    try {
      groupName = (await session.bot.getGuild(session.guildId)).name
      log.debug(`已通过平台接口取到群聊标题: ${groupName} (${session.guildId})`)
    } catch (error) {
      log.warn(`查询群 ${session.guildId} 名称失败，将回退使用群 ID:`, error)
    }
  }
  return { channelId, guildId: session.guildId, groupName }
}
