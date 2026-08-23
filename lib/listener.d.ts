import { Context } from 'koishi';
import type { Config } from './types';
/** 注册消息监听，将符合条件的消息写入数据库 */
export declare function applyMessageListener(ctx: Context, config: Config): void;
