import { Session, Element } from 'koishi'
import type { Config } from './types'

/**
 * 将消息元素序列化为纯文本。
 * 图片、引用等非文本元素替换为占位符，是否记录图片地址由配置决定。
 */
export function serializeContent(session: Session, config: Config): string {
  const elements = session.elements ?? []
  const parts: string[] = []
  for (const el of elements) {
    if (el.type === 'text') {
      parts.push(el.attrs['content'] ?? '')
    } else if (el.type === 'img' || el.type === 'image') {
      parts.push(config.recordImages ? `[图片](${el.attrs['src'] || el.attrs['url'] || ''})` : '[图片]')
    } else if (el.type === 'quote') {
      parts.push(config.recordQuotes ? `[引用]${serializeNodes(el.children)}` : '[引用]')
    } else {
      parts.push(`[${el.type}]`)
    }
  }
  const text = parts.join('').trim()
  return text || session.content || ''
}

/** 递归序列化元素节点（用于引用消息内部） */
function serializeNodes(nodes: Element[]): string {
  const parts: string[] = []
  for (const el of nodes) {
    if (el.type === 'text') {
      parts.push(el.attrs['content'] ?? '')
    } else if (el.type === 'img' || el.type === 'image') {
      parts.push('[图片]')
    } else if (el.children?.length) {
      parts.push(serializeNodes(el.children))
    } else {
      parts.push(`[${el.type}]`)
    }
  }
  return parts.join('')
}
