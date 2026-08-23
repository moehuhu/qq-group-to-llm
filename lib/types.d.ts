export interface Config {
    /** 监听所有群组（true 时忽略 groups 配置） */
    listenAll: boolean;
    /** 需要记录的群组列表（listenAll 为 false 时生效） */
    groups: string[];
    /** 记录机器人的消息 */
    recordBot: boolean;
    /** 记录图片消息内容（否则仅记录 "图片" 占位符） */
    recordImages: boolean;
    /** 记录引用消息 */
    recordQuotes: boolean;
    /** 消息保留天数（0 表示永久保留） */
    retentionDays: number;
    /** 查询时最多返回的消息条数 */
    maxQuery: number;
}
export interface MessageRecord {
    id: string;
    platform: string;
    selfId: string;
    channelId?: string;
    guildId?: string;
    userId?: string;
    username: string;
    content: string;
    timestamp: Date;
    messageId: string;
}
declare module 'koishi' {
    interface Tables {
        messages: MessageRecord;
    }
}
