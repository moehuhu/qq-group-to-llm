import { Context } from 'koishi'
import type { Config } from '../config'
import { applyAnalysisCommand } from './analysis'
import { applyHighlightCommand } from './highlights'
import { applyPersonaCommand } from './persona'

/** 注册插件提供的全部命令 */
export function applyCommands(ctx: Context, config: Config) {
  applyAnalysisCommand(ctx, config)
  applyHighlightCommand(ctx, config)
  applyPersonaCommand(ctx, config)
}
