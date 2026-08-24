import { h } from 'koishi'

/** 转义 QQ markdown 中的特殊字符，避免内容破坏结构 */
export function escapeMarkdown(value: string | undefined | null): string {
  return (value ?? '')
    .replace(/([\\`*_[\]~#!>|])/g, '\\$&')
    .replace(/\n/g, ' ')
}

/**
 * 把文本包成 QQ markdown 消息，始终以 markdown 发送，不做超长降级。
 */
export function toMarkdownMessage(content: string): string | h {
  if (!content) return content
  return h('markdown', content)
}
