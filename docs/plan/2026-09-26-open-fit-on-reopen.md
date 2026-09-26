# 从项目库重开也要摆全貌（打开时适应一次的两个输入各留一个写口）

> 2026-09-26 · 协调会话 · 分支 `claude/fit-on-reopen` · 接 #880（裁定 B：打开时适应一次、必定触发）

## 问题

合并后的 main（7a004de61）上真机复现：冷开项目摆了全貌（0.26，24 张全挂），返回项目库再打开同一个项目停在 1:1 左上角（4 张）。裁定 B 要求打开时适应「必定触发」，重开是日常路径。

## 根因（加日志实证）

`useAutoFitOnLoad` 判两样输入：内容载入没有（`isReady`）、用户有没有留下视角（`categoryViewports`）。

- 离开项目 → `categoryViewports` 清空，但画布组件和 React Flow 还停在旧视角 0.26。
- 「store → React Flow」同步看到没有记忆 → 推 1:1 兜底 → React Flow 回一次无来源事件的 `onMoveEnd` → 被记成「用户留下的视角」{1, 0,0}。
- 重开时判断看到「有记忆、有卡可见」→ 按设计保留 → 不摆。

同一判断的另一个输入 `isReady` 也有第二个写口（画布挂载时 `markReady()`），挂载先于内容时判断会看到空画布。没在这次复现里起作用，但属于同一类，一并收口。

## 范围

- `GenerationCanvasReactFlow.tsx`：同步 effect 给推过去的视口打标（`storeSyncEchoRef`），`isStoreSyncEcho` 判回声。
- `GenerationCanvasReactFlowViewport.tsx`：`onMoveEnd` 遇到回声不记。
- 删 `markReady`（store 动作、类型、写边界登记、挂载 effect）；`restoreSnapshot` 是 `isReady=true` 的唯一写口。
- 新走查 `tests/ux/canvas-open-fit.walk.mjs`（冷开 + 离开前视角不在 1:1 的重开），挂进 full 画布套件 shard 1 与验证分档分类器。
- 单测 `canvasReadyOwner.test.ts`；合同、概念登记、教训。

## 不动

- `shouldFitOnOpen` 判据不变（打开时是空的不摆、有可用视角保留）。
- 用户手势 / 平移 / 用户触发的动画照旧记视角；切分类记忆照旧。

## 验收

- 新走查：修复后绿；把两处视口文件改回 main 版本 → 重开那一步红（已做）。
- used 夹具真机探针：重开 0.26 / 24 张（修前 1 / 4）。
- 单测：修前红（markReady 还在）、修后绿。
- 核心冒烟 empty / used、磁吸、卡片堆叠、拖拽平移走查、画布与项目单测全绿。

## 回滚

单个 revert；无数据迁移（视口记忆只在内存里、离开项目即清）。
