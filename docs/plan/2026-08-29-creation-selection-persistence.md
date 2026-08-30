# 创作区失焦选区持久化修复

日期：2026-08-29
状态：✅ 已交付

## 用户问题与根因

创作区选中文字后点击创作助手输入框，浏览器原生 `::selection` 随焦点转移消失；编辑器只向助手发布选区文本，没有保存 ProseMirror 的 `from/to` 区间，因此用户看不到“将要替换”的目标。`replace_selection` 仍能成功，是因为写回命令重新聚焦编辑器并使用当时的编辑器选区。

这是创作编辑器视觉反馈的共享边界问题，不是 React Flow 问题。画布文本节点复用富文本内核但不启用该扩展，避免改变其已有编辑行为。

## 修复设计

- 在共享 `useNomiRichTextEditor` 的可选扩展列表中接入一个创作专用 ProseMirror decoration plugin。
- 非空选区写入插件状态；编辑器失焦不会触发清除，助手输入时继续渲染 accent 背景。
- 文档变更通过 transaction mapping 跟踪范围；折叠选区、替换完成、文稿切换导致的空选区会清除 decoration。
- 只使用设计系统已有 `--nomi-accent-soft` 与 `--nomi-accent` token，不新增控件或并行颜色。

## 验收

- `persistentSelection.test.ts` 覆盖创建、插入映射、折叠清除和替换清除。
- `f3-f16b.walk.mjs` 真实 Electron 走查选中文稿后聚焦创作助手，断言原生选区为空时持久 decoration 仍显示选中文本。
- 已有 `read_selection -> replace_selection` 工具链继续由现有 agent-runtime 走查覆盖。

## 回滚

移除创作编辑器对 `PersistentSelectionExtension` 的启用和对应 decoration 样式即可；文稿 JSON、助手工具协议和画布文本节点不变。
