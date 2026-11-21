# 从项目库重开也要摆全貌（打开时适应一次的两个输入各留一个写口）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-26 · 协调会话 · 分支 `claude/fit-on-reopen` · 接 #880（裁定 B：打开时适应一次、必定触发）

## 问题

合并后的 main（7a004de61）上真机复现：冷开项目摆了全貌（0.26，24 张全挂），返回项目库再打开同一个项目停在 1:1 左上角（4 张）。裁定 B 要求打开时适应「必定触发」，重开是日常路径。

## 根因（加日志实证）

`useAutoFitOnLoad` 判两样输入：内容载入没有（`isReady`）、用户有没有留下视角（`categoryViewports`）。

- 离开项目 → `categoryViewports` 清空，但画布组件和 React Flow 还停在旧视角 0.26。
- 「store → React Flow」同步看到没有记忆 → 推 1:1 兜底 → React Flow 回一次无来源事件的 `onMoveEnd` → 被记成「用户留下的视角」{1, 0,0}。
- 重开时判断看到「有记忆、有卡可见」→ 按设计保留 → 不摆。

同一判断的另一个输入 `isReady` 也有第二个写口（画布挂载时 `markReady()`），挂载先于内容时判断会看到空画布。没在这次复现里起作用，但属于同一类，一并收口。

## 先查别人

- **依赖里已有？** React Flow 自己就区分「用户发起」和「程序发起」：`node_modules/@xyflow/react/dist/esm/types/component-props.d.ts:184` 写明 `onMoveEnd` 在非用户发起的移动上 `event` 为 `null`。但只凭它不够：打开时适应（`setViewport` 零时长）、NaN 自愈这些程序移动同样无事件，它们必须记下来，否则同步会把画布拉回旧视角（2026-09-21 那次就是这么坏的）。所以要分的不是「有没有事件」，而是「是不是同步自己推出去的那一下」。
- **仓库里已有？** 同一个 `onMoveEnd` 已经用同样的办法跳过我们自己动画的中间帧：`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:276`（`isViewportAnimating`）。同步 effect 的注释也早就把这一下叫作「回声不是新命令」（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:263`），但只挡了重复写入 React Flow，没挡住它被记成记忆。本次沿用这一形状。
- **生态里已有？** React Flow 官方的保存/恢复示例只在用户显式保存时持久化视口，不在每次移动时写：https://reactflow.dev/examples/interaction/save-and-restore 。`onMoveEnd` 的签名与语义：https://reactflow.dev/api-reference/react-flow#onmoveend 。
- **TikHub 自媒体里怎么说？** 不适用：这是内部状态同步的时序问题，用户侧只表现为「有时摆全貌、有时不摆」，没有可查的外部讨论。
- **结论**：自研一个最小标记（同步边界上的 ref，只认那一下回声），不引入新依赖，也不改 `shouldFitOnOpen` 判据。

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
