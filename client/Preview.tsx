/**
 * 版面预览的界面（React），跑在独立的预览窗口里（见 Launcher.tsx）。
 *
 * 渲染走的是插件自己那套纯函数（src/render/html.ts），跟真正出图时同一份代码，
 * 所以这里看到的就是截图会得到的样子——不是另写一套近似的预览。
 * 数据用写死的样本，见 sample.ts。
 *
 * 页面塞进 iframe 而不是直接插进控制台的 DOM：预览的样式表里全是
 * `body`、`*`、`.section` 这类通用选择器，漏到外面会把控制台自己的界面改花。
 * iframe 给了一层干净的边界，顺带也让 `html { width: … }` 这条按预期生效。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderDialoguesHtml, renderPersonaHtml, renderReportHtml } from '../src/render/html'
import type { RenderStyleConfig } from '../src/render/theme'
import { SAMPLE_DIALOGUES, SAMPLE_EVIDENCE, SAMPLE_PERSONA, SAMPLE_REPORT } from './sample'

/** 三个出口。渲染函数各不相同，用一张表把差异收在一处 */
const OUTPUTS = [
  { key: 'report', label: '群分析', render: (config: RenderStyleConfig) => renderReportHtml(SAMPLE_REPORT, config) },
  { key: 'dialogues', label: '高光对话', render: (config: RenderStyleConfig) => renderDialoguesHtml(SAMPLE_DIALOGUES, config) },
  { key: 'persona', label: '用户画像', render: (config: RenderStyleConfig) => renderPersonaHtml(SAMPLE_PERSONA, SAMPLE_EVIDENCE, undefined, config) },
] as const

/** 配置项没填时按 Schema 的默认宽度走，免得预览宽度是 NaN */
const DEFAULT_WIDTH = 1000

/** 量不到容器宽度时的兜底值，与弹窗的初始宽度相称 */
const FALLBACK_VIEW_WIDTH = 1040

export interface PreviewProps {
  /** 设置页正在编辑的配置，改一个字符就会换一个新对象 */
  config: Partial<RenderStyleConfig> | undefined
}

export default function Preview({ config }: PreviewProps) {
  const [active, setActive] = useState<string>(OUTPUTS[0].key)
  const output = OUTPUTS.find((item) => item.key === active) ?? OUTPUTS[0]
  const width = Number(config?.imageWidth) || DEFAULT_WIDTH

  // 模板与样式表都是用户手写的，写坏了（比如模板里少个反引号并不会报错，
  // 但自定义代码抛异常是可能的）不该把整个设置页带崩，接住了当作一条提示
  const { html, error } = useMemo(() => {
    try {
      return { html: output.render({ ...config, imageWidth: width }), error: '' }
    } catch (e) {
      return { html: '', error: e instanceof Error ? e.message : String(e) }
    }
  }, [output, config, width])

  // 预览按窗口宽度等比缩下来。窗口一拉宽就能看得更清楚，
  // 也不至于在窄窗里被裁掉右半边——图片本身的宽度是配置项，不能改
  const [viewWidth, setViewWidth] = useState(FALLBACK_VIEW_WIDTH)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const target = box.current
    if (!target) return
    const measure = () => setViewWidth(target.clientWidth || FALLBACK_VIEW_WIDTH)
    measure()
    // 用弹窗自己的 ResizeObserver：这个元素属于另一个文档，
    // 拿父窗口的构造器去观察它在部分浏览器上不会触发回调
    const view = target.ownerDocument.defaultView ?? window
    const observer = new view.ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(1, viewWidth / width)

  return (
    <div className="qgl-preview" ref={box}>
      <div className="qgl-preview-head">
        <div className="qgl-preview-tabs">
          {OUTPUTS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === active ? 'active' : ''}
              onClick={() => setActive(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="qgl-preview-note">
          示例数据 · {width}px{scale < 1 ? ` · 缩放 ${Math.round(scale * 100)}%` : ''}
        </span>
      </div>
      {error
        ? <div className="qgl-preview-error">渲染失败：{error}</div>
        : <Frame html={html} width={width} scale={scale} />}
    </div>
  )
}

/**
 * 预览画面。iframe 的高度得跟着内容走——固定高度要么截断长报告，
 * 要么给画像留一大截空白，所以内容加载完之后回读一次 #card 的实际高度。
 */
function Frame({ html, width, scale }: { html: string, width: number, scale: number }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    // srcdoc 换了之后浏览器要重新解析，量高度得等这一次 load
    const measure = () => {
      const card = frame.contentDocument?.querySelector('#card')
      if (card) setHeight(card.getBoundingClientRect().height)
    }
    frame.addEventListener('load', measure)
    // 图片（示例里那张占位图）加载完会把高度撑开，再补量一次
    const timer = setTimeout(measure, 800)
    return () => {
      frame.removeEventListener('load', measure)
      clearTimeout(timer)
    }
  }, [html])

  // 外层按缩放后的尺寸占位，好让它在窗口里居中；里面那张 iframe 仍是原始尺寸，
  // 只是被 transform 缩了——transform 不改变布局盒子，不套这一层就只能贴着左边
  return (
    <div className="qgl-preview-frame" style={{ width: width * scale, height: height * scale }}>
      <iframe
        ref={ref}
        title="版面预览"
        srcDoc={html}
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  )
}
