import { Context } from 'koishi'
import type { Config } from './config'
import { extendModel } from './model'
import { applyMessageListener } from './listener'
import { applyQueryCommand } from './command'
import { applyRetentionCleanup } from './cleanup'

export { Config } from './config'
export * from './model'

export const name = 'qq-group-to-llm'
export const inject = ['database']

export function apply(ctx: Context, config: Config) {
  extendModel(ctx)
  applyMessageListener(ctx, config)
  applyQueryCommand(ctx, config)
  applyRetentionCleanup(ctx, config)
}
