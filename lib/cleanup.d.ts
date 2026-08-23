import { Context } from 'koishi';
import type { Config } from './types';
/** 注册定时任务，删除超出保留期限的过期消息 */
export declare function applyRetentionCleanup(ctx: Context, config: Config): void;
