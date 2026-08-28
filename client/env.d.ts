/**
 * 控制台的类型补齐。
 *
 * `@koishijs/client` 直接以 TS 源码分发，里面到处 import `.vue` 文件；
 * tsc 不认这个扩展名，不补一条声明的话，光是 import 一下它就会刷屏报错。
 * 它自己带了一份等价的 global.d.ts，但要靠 `types` 字段拉进来，
 * 在这个工作区里解析不到（包用 exports 映射，不是 @types 那套），索性自己声明。
 */
declare module '*.vue' {
  import type { Component } from 'vue'
  const component: Component
  export default component
}

declare module '*.yaml' {
  const content: {}
  export default content
}

declare module '*.yml' {
  const content: {}
  export default content
}

declare module '*.css' {}
