/**
 * 控制台扩展入口：往插件设置页里插一个版面预览的入口。
 *
 * 只注册一个插槽，设置页上就一行按钮；预览开在独立窗口里，见 Launcher.tsx。
 * 界面是 React 写的，中间隔着 mount.ts 那层 Vue 壳，见那边的说明。
 */
import { Context } from '@koishijs/client'
import Launcher from './Launcher'
import { defineReactSlot } from './mount'
import './style.css'

export default (ctx: Context) => {
  // order 为负数排在依赖提示之后，但仍在配置表单之前，一进设置页就能看到入口
  ctx.slot({
    type: 'plugin-details',
    component: defineReactSlot({ component: Launcher }),
    order: -100,
  })
}
