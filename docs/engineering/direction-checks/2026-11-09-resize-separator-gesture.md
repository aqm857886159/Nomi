# 方向检查：分隔条按下即认领手势（协调代批 P1 例外）

日期：2026-11-09

## 命中了什么

提交 `src/workbench/timeline/TimelineResizeHandle.tsx`（分隔条 pointerdown 增加一行 `preventDefault()`）时，fix-churn 原文：

> src/workbench/timeline/TimelineResizeHandle.tsx：目录 src/workbench/timeline/ 近 14 天已有 2 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 3 个

## 命中的是目录口径，不是文件本身

- `git log --since='14 days ago' -- src/workbench/timeline/TimelineResizeHandle.tsx` 没有提交；文件本身未到热点线。
- 命中只来自时间轴目录内其他文件的修复，不是这个把手连续修补。
- `node scripts/door-map.mjs TimelineResizeHandle` 找到唯一消费入口 `src/workbench/generation/GenerationWorkspace.tsx`；时间轴高度仍由原来的 store setter 钳制，不改变数据归属。

## 改法是统一替换，不是补特例

- 删除抽屉、Agent 面板、时间轴分隔条「只捕获指针、不取消浏览器默认拖动」的旧行为，三处统一成 pointerdown 先 `preventDefault()` 再捕获指针。
- 复用现有分隔条的写法（`EditorSplit.tsx`、`TimelineTextTrack.tsx` 已认领手势），不新增组件、依赖、分支或特例。
- `resizeSeparatorGesture.structure.test.ts` 扫描全部 `role="separator"` 且带 `onPointerDown` 的 JSX，防止其他分隔条遗漏；旧实现红在抽屉、Agent 面板、时间轴三处。
- 保留按键、双击复位及原有尺寸边界。指针按下不再把焦点移到分隔条，Agent 输入框可保留焦点；该行为与 #1359 涉及同一焦点概念，独立验收需核对。

## 批准

协调 2026-11-09 依 CLAUDE.md P1 例外代批，事后报用户。
