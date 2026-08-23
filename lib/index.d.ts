import { Context } from 'koishi';
import type { Config } from './types';
export * from './types';
export { configSchema as Config } from './config';
export declare const name = "message-log";
export declare const apply: ((ctx: Context, config: Config) => void) & {
    inject: string[];
};
