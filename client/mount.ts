/**
 * Vue 宿主里挂一个 React 根。
 *
 * 控制台本身是 Vue 3 的，插槽收的也是 Vue 组件；预览这块用 React 写，
 * 于是这里做一层薄壳：Vue 负责拿到设置页注入的响应式配置，React 负责画。
 * 两边的边界只有一处——watch 到新配置就 root.render 一次，别的什么都不共享。
 */
import { createElement, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defineComponent, h, inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { RenderStyleConfig } from '../src/render/theme'

/** 设置页注入的键：当前打开的插件全名，以及正在编辑（尚未保存）的配置 */
const PLUGIN_NAME = 'plugin:name'
const EDITING_CONFIG = 'manager.settings.config'

/** 这个插槽对所有插件的设置页都会渲染一次，得自己认出哪个是自己 */
const SELF = ['koishi-plugin-qq-group-to-llm', 'qq-group-to-llm']

export interface MountOptions {
  /** 要挂的 React 组件，收一个 config 属性 */
  component: ComponentType<{ config: Partial<RenderStyleConfig> | undefined }>
}

export function defineReactSlot({ component }: MountOptions) {
  return defineComponent({
    setup() {
      const container = ref<HTMLDivElement>()
      const name = inject<Ref<string | undefined>>(PLUGIN_NAME, ref(undefined))
      const config = inject<Ref<Partial<RenderStyleConfig> | undefined>>(EDITING_CONFIG, ref(undefined))
      const mine = () => SELF.includes(name.value ?? '')

      let root: Root | undefined
      const draw = () => {
        if (!container.value || !mine()) return
        root ??= createRoot(container.value)
        // 展开成新对象：Vue 的响应式代理是同一个引用，直接传进去 React 认不出变化
        root.render(createElement(component, { config: { ...config.value } }))
      }

      onMounted(draw)
      watch(config, draw, { deep: true })
      watch(name, draw)
      onBeforeUnmount(() => {
        // 卸载排到下一拍：React 不允许在自己渲染的过程中同步卸载根节点
        const current = root
        root = undefined
        if (current) setTimeout(() => current.unmount())
      })

      return () => mine() ? h('div', { ref: container, class: 'qgl-preview-host' }) : null
    },
  })
}
