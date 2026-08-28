/**
 * 设置页里的预览入口（React）。
 *
 * 预览本身开在**另一个窗口**里：跟表单挤在同一页时，改一行 CSS 要来回滚动才能
 * 看到效果，两个窗口并排摆才谈得上边改边看。这里只留一个按钮和一行状态。
 *
 * 弹窗里是一个独立的 React 根——把父窗口的根 portal 过去也能渲染，
 * 但事件监听器挂在父文档的容器上，弹窗里的点击传不回来，标签页就点不动了。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import Preview from './Preview'
import type { RenderStyleConfig } from '../src/render/theme'

/** 窗口名固定：再点一次按钮是把已开的那扇窗拉到前面，而不是又开一扇 */
const WINDOW_NAME = 'qq-group-to-llm-preview'

/** 弹窗初始尺寸。够放下一张 1000px 宽的报告，外加工具条 */
const WINDOW_FEATURES = 'popup=yes,width=1120,height=940'

export interface LauncherProps {
  config: Partial<RenderStyleConfig> | undefined
}

export default function Launcher({ config }: LauncherProps) {
  const [opened, setOpened] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const win = useRef<Window | null>(null)
  const root = useRef<Root | null>(null)
  // 渲染时要用最新的配置，但 draw 又被 openWindow 引用，用 ref 避免把回调重建一遍
  const latest = useRef(config)
  latest.current = config

  const draw = useCallback(() => {
    root.current?.render(<Preview config={latest.current} />)
  }, [])

  /** 关掉弹窗并收拾干净。窗口是用户关的还是我们关的，都走这里 */
  const teardown = useCallback((close: boolean) => {
    const current = root.current
    root.current = null
    // 卸载排到下一拍：React 不允许在自己渲染的过程中同步卸载根节点
    if (current) setTimeout(() => current.unmount())
    if (close) win.current?.close()
    win.current = null
    setOpened(false)
  }, [])

  const open = useCallback(() => {
    if (win.current && !win.current.closed) {
      win.current.focus()
      return
    }
    const target = window.open('', WINDOW_NAME, WINDOW_FEATURES)
    if (!target) {
      setBlocked(true)
      return
    }
    setBlocked(false)
    prepare(target)
    win.current = target
    root.current = createRoot(target.document.getElementById('root')!)
    // 用户直接关窗口时把按钮状态复位，不然再点就没反应了
    target.addEventListener('pagehide', () => teardown(false))
    setOpened(true)
    draw()
  }, [draw, teardown])

  // 配置每改一个字符，父组件就带着新对象重渲染，这里把它推给弹窗
  useEffect(() => {
    if (root.current) draw()
  }, [config, draw])

  // 离开设置页时把弹窗一并关掉：留一扇不再更新的窗口在那里只会让人误会
  useEffect(() => () => teardown(true), [teardown])

  return (
    <div className="qgl-launcher">
      <span className="qgl-launcher-title">版面预览</span>
      <button type="button" className="qgl-launcher-button" onClick={open}>
        {opened ? '切换到预览窗口' : '在新窗口打开'}
      </button>
      <span className="qgl-launcher-note">
        {blocked
          ? '浏览器拦截了弹出窗口，请在地址栏右侧允许后重试'
          : opened
            ? '窗口已打开，改动模板、样式表或图片宽度会立刻重画，不用保存'
            : '用示例数据渲染，与出图走同一套代码；改配置即时生效，不用保存'}
      </span>
    </div>
  )
}

/**
 * 备好弹窗的文档：一个挂载点，加上父窗口那份样式。
 *
 * 样式表整份克隆过来，图省事之外也是为了跟着控制台的主题走——
 * 工具条用的是 `--k-color-border` 这类变量，另写一套就得自己维护明暗两版。
 * 报告本身的样式在 iframe 里，与这里互不干扰。
 */
function prepare(target: Window) {
  const doc = target.document
  doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>')
  doc.close()
  doc.title = '版面预览 · qq-group-to-llm'

  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
  for (const node of styles) {
    doc.head.appendChild(doc.importNode(node, true))
  }
  // 主题是挂在根元素上的类名与内联变量，一并搬过去，弹窗才不会永远是浅色
  doc.documentElement.className = document.documentElement.className
  doc.documentElement.setAttribute('style', document.documentElement.getAttribute('style') ?? '')
  doc.body.className = 'qgl-popup'

  const mount = doc.createElement('div')
  mount.id = 'root'
  doc.body.appendChild(mount)
}
