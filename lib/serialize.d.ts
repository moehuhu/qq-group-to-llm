import { Session } from 'koishi';
import type { Config } from './types';
/**
 * 将消息元素序列化为纯文本。
 * 图片、引用等非文本元素替换为占位符，是否记录图片地址由配置决定。
 */
export declare function serializeContent(session: Session, config: Config): string;
