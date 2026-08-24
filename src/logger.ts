import { Context } from 'koishi'

export const PLUGIN_NAME = 'qq-group-to-llm'

/**
 * 统一取具名 logger。
 * 直接用 ctx.logger 时，日志名取决于传入的 Context 作用域，
 * 从服务或外层 ctx 调用会落到 root，日志难以过滤。
 */
export const logger = (ctx: Context) => ctx.logger(PLUGIN_NAME)
