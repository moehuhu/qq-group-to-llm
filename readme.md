# koishi-plugin-qq-group-to-llm

[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-group-to-llm?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-qq-group-to-llm)

记录 QQ 群消息并提供给 LLM 使用。

## 功能

- 监听群消息并写入 `qq_group_messages` 表（消息元素序列化为纯文本，图片/引用可配置展开）
- `msglog [count]` 命令查询最近的消息，支持 `-g <群组 ID>` / `-u <用户 ID>`
- 按 `retentionDays` 定期清理过期消息（0 表示永久保留）

## 目录结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | 插件入口，装配各模块 |
| `src/config.ts` | 配置项接口与 Schema |
| `src/model.ts` | 数据表结构与类型声明 |
| `src/listener.ts` | 消息监听、过滤与序列化 |
| `src/command.ts` | `msglog` 查询命令 |
| `src/cleanup.ts` | 过期消息清理定时任务 |
