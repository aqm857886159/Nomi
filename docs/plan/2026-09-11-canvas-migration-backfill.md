# 生成画布 React Flow 迁移回填②：缩放值单一真相 · 灯箱收起 chrome · 边标签恒定屏幕尺寸

> 依据：`Nomi-migration-audit-20260911.md`（OLD = `8f9365aeb`，NEW = `origin/main` @ `af3652e1c`）。
> 本 PR 只做审计 §③ 的 **行 2 / 行 4 / 行 7**，外加 **行 8 / 行 11** 两条纯注释裁决。
> 行 1（卡内滚轮）、行 3（滚轮语义设置）、行 5/6/9/10/12 不在本 PR；行 9/10/12 由并行的 backfill-a 车道做。

## 为什么要做这三条（一句话各一条）

- **行 2 是真 bug，不是观感**：剪辑节点内嵌时间轴在任何非 100% 缩放下，拖/裁片段的位移都算错——50% 缩放时片段只走一半，手指在这儿、片段在那儿。
- **行 4 是「看大图时脏」**：灯箱只有 40% 黑遮罩，工具条 / 导航栈 / 节点浮条会继续浮在画面上。
- **行 7 是「缩小就读不出这条边是什么」**：边模式胶囊跟着视口一起缩放，30% 时 9px 高，300% 时 66px 高。

## 逐行：OLD → NEW → 现在

### 行 2 · `canvasZoom` 冻结成 1（真 bug）

| | 位置 |
|---|---|
| OLD | `src/workbench/generationCanvas/components/useCanvasTransformStoreSync.ts`（每帧 `setCanvasTransform`） |
| NEW（坏） | 写入方零个：`store/generationCanvasStore.ts:59-60` 的 `setCanvasTransform`/`setCanvasZoom` 全仓无调用；读的人还在 —— `nodes/ClipNode.tsx:69` → `nodes/ClipNodeTimeline.tsx:195-196,258,475`、`nodes/shotTable/ShotTableNode.tsx:35`、`components/BatchPlanOverlay.tsx:49-50`、`nodes/useNodeDragResize.ts:206,291` |
| 现在 | 唯一真相 = React Flow 的 `transform[2]`：新模块 `reactFlow/canvasViewportScale.ts`（`selectFlowZoom` / `useCanvasLiveZoom` / `inverseViewportScale` / `edgeLabelTransform` / `shotTableDensityForZoom`） |

**审计漏掉的两个受害者**（本 PR 一并修）：

- `nodes/shotTable/ShotTableNode.tsx`：分镜表的密度档（full / compact / card）恒停在 `full`。
- `components/BatchPlanOverlay.tsx`：批量计划的波次徽标按 `pos * zoom + offset` 定位，恒等于 `pos * 1 + 0` —— 一缩放/平移就整片错位。改读框架自带的 `useViewport()`（x/y/zoom 三标量浅比较），不另写订阅。

**删旧（P1）**：`canvasZoom` / `canvasOffset` / `setCanvasTransform` / `setCanvasZoom` 连同 `store/canvasStoreTypes.ts`、`events/canvasWriteBoundary.ts` 的登记、`project/releaseWorkbenchProjectSession.ts` 的重置一起删。单测 `reactFlow/canvasViewportScale.test.ts` 里有一条门岗：这两个字段不许回来。

**订阅粒度**：只选 `transform[2]` 这一个标量 —— 平移不改它，所以拖画布时这些节点一帧都不重渲（`docs/plan/2026-09-01-canvas-drag-perf-eval-v2.md` 的细粒度 selector 原则）。分镜表订阅的是**档位**不是缩放值，穿过一档才重渲一次。

**画布外的宿主**：设计实验室里独立挂载的节点样张不在 React Flow 里，也就没有画布缩放。
`ShotTableNode` 的非 Flow 分支按 `shotTableDensityForZoom(1)` 走；`devlab/designLab/shotTable/ShotTableStage.tsx` 改成直接把密度钉在文档字段 `table.view.density` 上（那也是用户手动钉密度时走的同一条路），渲染结果与改前逐像素相同。
`nodes/useNodeDragResize.ts` 的四个 handler 在 React Flow 宿主里第一行就 `return`（拖/缩放归 RF 与 `NodeResizer` 管），只有画布外宿主才真的执行——那里屏幕像素即画布像素，两处 `effectiveZoom` 因此直接删掉。

### 行 4 · 媒体预览打开时收起画布 chrome

| | 位置 |
|---|---|
| OLD | `src/workbench/generationCanvas/styles/generationCanvas.css:24-31` + `nodes/NodeMediaPreviewDialog.tsx:30-42`（在 `.workbench-generation` 上写 `data-media-preview-open`） |
| NEW（坏） | CSS 与 setter 双双被 `903d992f6`「fix(agent-panel): restore folding…」连带删除 |
| 现在 | 对话框在画布宿主 `.workbench-generation__canvas` 上挂/摘旗子；规则写在 `reactFlow/generationCanvasReactFlow.css` 末尾，按**当前**类名收起 |

收起的六件（当前类名）：

`.generation-canvas-v2-toolbar`（左缘工具条）、`.generation-canvas-v2__navigation-stack`（右下导航栈）、`.generation-canvas-v2__selection-toolbar`（多选浮条）、`.generation-canvas-v2-node__composer`（节点提示词面板）、`[data-node-floating-toolbar]`（节点浮条，OLD 是 `.generation-canvas-v2-node [role='toolbar']`）、`.workbench-generation__timeline-handle`（时间轴把手）。

**与 OLD 的唯一有意差别**：OLD 还收 `.workbench-generation__ai`。该类名今天已不存在；且灯箱只覆盖画布区，对话框里明写着不 inert「uncovered Agent/sidebar region」——Agent 面板不在收起之列。

用 `visibility` 不用 `display`：不卸载、不触发重排，按钮忙态与滚动位置原样回来。也正因为如此，走查断言查的是 `getComputedStyle().visibility`，查「在不在 DOM 里」会永远绿。

### 行 7 · 边标签反缩放

| | 位置 |
|---|---|
| OLD | 旧自绘边层 `components/CanvasEdgeLayer.tsx:63,176`（`tagScale = 1/zoom`，`transform: translate(-50%,-50%) scale(tagScale)`） |
| NEW（坏） | `EdgeLabelRenderer` + `reactFlow/generationCanvasReactFlow.css:237` 固定 `font-size: 12px`。`.react-flow__edgelabel-renderer` 在 `.react-flow__viewport` **里面**，跟着视口一起缩放 |
| 现在 | `reactFlow/GenerationCanvasReactFlowNodes.tsx` 新增 `EdgeModeLabelLayer`，用 `edgeLabelTransform(labelX, labelY, zoom)` 反缩放 |

**为什么不是复制多选浮条那套**：`reactFlow/selectionToolbarPlacement.ts` 走的是「把画布坐标换算成屏幕坐标、渲染在视口**外**」，天生恒定尺寸；边标签渲染在视口**内**，必须显式反缩放。两条路各自只有一份实现，共同的判据（「chrome 保持屏幕尺寸」）写在 `canvasViewportScale.ts` 的头注释里。

**订阅收在 `EdgeModeLabelLayer` 这一层**（而不是提到 `GenerationFlowEdgeView`）：胶囊只给「选中节点的边」画，缩放时因此只重渲这几条，不惊动整张图的边。

### 行 8 / 行 11（纯注释裁决，无行为改动）

- **行 8 · 磁吸带只在单选时出现** → `reactFlow/generationCanvasReactFlowVisualContract.ts` 头注释：有意保留新行为（多选时十条色带首尾相接，用户看不清自己选了什么；多选那一刻做的是搬/删/批量生成，不是起线）。代价：多选后想从其中某一张起线要先点回单选。
- **行 11 · 边菜单弹在贝塞尔中点而非点击处** → `EdgeModeLabelLayer` 的注释：中点是这条边的身份位置，同一条边从哪儿点开都在同一处，多条边同时亮起也不会挤成一堆。代价：点长边的一端时菜单弹在边中间。

## 验收

红先行，三条都**先证明会红**再证明修好（同一份走查，临时把三处改回 bug 态跑了一遍）：

| 条 | bug 态实测 | 修后实测 |
|---|---|---|
| ① 50% 缩放拖片段 | 应走 88.7 帧、实走 43 帧，比值 **0.485** | 实走 89 帧，比值 **1.003** |
| ② 灯箱打开 | 工具条/导航栈/节点浮条 = **visible** | 三件 **hidden**，关闭后三件 **visible** |
| ③ 边标签高度 | 0.35× → **9.00px**，2.55× → **66.27px**（差 57.27px） | 两档都 **26.00px**（差 **0.00px**） |

- 真机走查：`tests/ux/canvas-migration-backfill.walk.mjs`（隔离 profile、一个窗口、全真手势：滚轮缩放、按住拖、双击、点选；缩放值从 `.react-flow__viewport` 的 transform 里读，不注入）。
- 单测：`src/workbench/generationCanvas/reactFlow/canvasViewportScale.test.ts`（含「两个死字段不许回来」的门岗）。
- 截图：`docs/plan/2026-09-11-triage-board-evidence/backfill-b-*.png`。

## 与 backfill-a 车道的分工与合流点

backfill-a 改 `reactFlow/GenerationCanvasReactFlowViewport.tsx` 的 props、`reactFlow/useGenerationCanvasReactFlowPointer.ts`、拖拽平移走查，并删旧手势内核那 7 个文件（审计行 9 `zoomOnDoubleClick`、行 10 `data-panning`、结构行 12）。本 PR **一个字都没碰**这些文件。

唯一可能撞车的地方：`components/canvasControlsStructure.test.ts`。它断言了 backfill-a 要删的那几个文件，backfill-a 必然要改它；本 PR 没改它。其中 `:250` 那条 `expect(generationCanvas).not.toContain('setCanvasTransform(zoom, offset)')` 在本 PR 之后变成恒真（符号已不存在）——**留给 backfill-a 合并时顺手删**，本 PR 不动，免得两边改同一处。
