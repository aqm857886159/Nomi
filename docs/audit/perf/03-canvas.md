# 画布性能审计 — 生成画布 / 节点系统

> 审计范围：`src/workbench/generationCanvas/` 的平移/缩放/拖拽/多节点渲染。只读不改源码。
> 审计日期：2026-06-22。审计对象提交：main @ 733a16b。

---

## 顶部结论（卡顿根因，按影响排序）

**根因 1（P0 — 平移/缩放走 React state，每帧整画布壳重渲染）。**
Pan/zoom 的 `offset`/`zoom` 是 `useCanvasViewport` 里的 **React `useState`**（`useCanvasViewport.ts:26`）。每次平移/缩放 `scheduleOffset`/`setViewportTransform`→`setViewport(...)`（`useCanvasViewportGestures.ts:89/102/129`），触发 **`GenerationCanvas` 这个 744 行 god-component 整体 re-render**。虽然有 rAF 节流（每帧最多一次 setState，做得对），但每帧这次 re-render 仍要：重算 `visibleNodesForRender` 的 AABB 裁剪（`useCanvasViewport.ts:52-69`，O(节点数)）、重走 `visibleNodesForRender.map()`（`GenerationCanvas.tsx:605`）、重建一堆 `useMemo`/`useCallback`、re-render `CanvasEdgeLayer`（**未 memo**）与 `CanvasMinimap`（**未 memo**）。节点经 `React.memo` 拦得住（见下），但**边层和 minimap 拦不住**——它们每个 pan 帧都重算所有边的 bezier 与所有 minimap 方块。这是平移/缩放越卡、节点+边越多越卡的主因。

**根因 2（P1 — 边层 + minimap 每个 pan 帧全量重算，无 memo、无裁剪到位）。**
`CanvasEdgeLayer`（`CanvasEdgeLayer.tsx:35`，裸 `export default function`，无 `React.memo`）和 `CanvasMinimap`（`CanvasMinimap.tsx:24`，无 memo）都是 `GenerationCanvas` 的直接子组件。根因 1 每帧重渲染父组件 → 这两个子组件每帧都重渲染。边层在 `edges.map()` 里逐条重算 bezier path 字符串（`CanvasEdgeLayer.tsx:63-154`）；200 条边 = 每帧 200 次字符串拼接 + 200 个 `<g>`/`<path>`/`<circle>` 的 React diff。minimap 在 `nodes.map()` 里逐节点重算坐标（`CanvasMinimap.tsx:107`）。**边层裁剪只在节点数 > 50 时生效**（`useCanvasViewport.ts:72-73` 的 `visibleEdgeNodeIds` 在 ≤50 时传 `null` = 渲染全部边），50 节点以下的密集连线图（"毛线球"）拿不到裁剪保护。

**根因 3（P2 — 边层 SVG 用 `foreignObject` 装标签，重排开销大）。**
有类型的边（非 reference）每条插一个 `<foreignObject>` 包 HTML `<div>`/`<span>` 当标签（`CanvasEdgeLayer.tsx:96-104`）。`foreignObject` 在 SVG 里触发浏览器在 SVG↔HTML 两套布局引擎间切换，是公认的重排热点；边多 + 平移时每帧重渲染会放大这个成本。

**好消息（已做对的，别动）**：① 节点 `BaseGenerationNode` 有正确的 `React.memo` + 自定义比较器（`BaseGenerationNode.tsx:897-905`，只比 `node`/`selected`/`readOnly`/`focusFlash`/`appear`），且 zustand immer 保证未改节点的引用稳定 → **平移时节点不重渲染**。② 节点拖拽/缩放走 rAF + ref，最终落 store（`useNodeDragResize.ts`），没有每帧对全树 setState。③ `canvasZoom` 拆出 store 后渲染层不订阅它，缩放不再触发全节点重渲（`BaseGenerationNode.tsx:136` 注释 + 改用 `getState()`）。④ 视口虚拟化（节点 > 50 时 AABB 裁剪）已实现，「离屏节点被剔除」的旧坑这里没有回归。

---

## 发现表

| 发现 | file:line | 机制 | 用户可见症状 | 严重度 | 修复方向 | 实测验证法 |
|---|---|---|---|---|---|---|
| **平移/缩放走 React state** | `useCanvasViewport.ts:26`；`GenerationCanvas.tsx:583-585` | `offset`/`zoom` 是 `useState`，每个 pan/zoom 帧 `setViewport` → 744 行壳组件整体 re-render（含重算虚拟化 + 重渲所有未 memo 子组件） | 平移卡、缩放卡，节点/边越多越卡 | **P0** | 把 viewport 移出 React state：`transform` 直接写 DOM（`stageRef`/canvas 层 `el.style.transform`）+ ref，rAF 节流，**不走 setState**。React 只在 pan 结束（pointerup）时同步一次最终值给虚拟化用。参考 xyflow 的 `d3-zoom` + transform-only 模型 | 放 100 节点 + 200 边，开 Performance 录制平移 3 秒，看 `GenerationCanvas` re-render 次数与每帧 scripting 时长；目标平移期间 0 次 React commit |
| **CanvasEdgeLayer 未 memo** | `CanvasEdgeLayer.tsx:35` | 裸函数组件，父每帧 re-render 就跟着 re-render，`edges.map()` 逐条重算 bezier path | 边多时平移更卡 | **P1** | `React.memo` 包裹；props 里 `nodeById`/`edges`/`zoom`/`focusedNodeId` 等需稳定引用（已是 useMemo）。配合根因 1 修好后，平移不再传新 `zoom` → memo 命中 | 同上录制，看 EdgeLayer 在平移期 commit 次数 |
| **CanvasMinimap 未 memo** | `CanvasMinimap.tsx:24` | 同上，每 pan 帧重算所有 minimap 方块坐标 | 节点多时平移更卡 | **P1** | `React.memo`；注意它**故意**订阅 `offset`/`zoom` 画取景框，所以即便 memo，根因 1 不修它仍每帧重渲。需配合根因 1：取景框用 transform 直写而非 React | 录制看 Minimap commit |
| **边层裁剪仅 >50 节点生效** | `useCanvasViewport.ts:72-73` | ≤50 节点时 `visibleEdgeNodeIds=null` = 渲染全部边，密集连线小图无裁剪 | 节点少但连线密（毛线球）时平移卡 | **P2** | 边裁剪阈值与节点裁剪解耦：按**边数**判定（如 edges > 80 就裁），或始终裁 | 放 30 节点 + 150 边（密集），测平移 FPS |
| **边标签用 foreignObject** | `CanvasEdgeLayer.tsx:96-104,127` | SVG 内嵌 HTML，触发双布局引擎重排 | 有类型边多时整体更顿 | **P2** | 标签改纯 SVG `<text>` + `<rect>` 背景；剪刀按钮同理或仅在 active 时挂（剪刀已是 active-only，标签不是） | DevTools 看 Layout/Recalc Style 时长 |
| **拖拽期 commit 走 immer + 全 store** | `useNodeDragResize.ts:88-94`；store `moveSelectedNodes`/`moveNode` | 拖拽 rAF 内每帧 `moveNode(persist:false)` → immer 产新 `nodes` 数组 → `GenerationCanvas` re-render（但被拖节点之外靠 memo 拦住） | 多选拖大量节点时略顿 | **P3**（已 rAF 节流，可接受；仅多选海量节点时才显） | 多选拖拽时同样可用 transform 直写被拖节点，pointerup 才落 store；当前 rAF + memo 方案在常规规模够用 | 多选 50 节点拖动测 FPS |
| **每个 pan 帧同步 store.canvasTransform** | `GenerationCanvas.tsx:253-255` | effect 在 `offset`/`zoom` 变化时 `setCanvasTransform` 写 store；订阅者 `NodeGenerationComposer`/`NodeFloatingToolbar` 仅在选中单节点时挂载，影响面小 | 选中节点时平移略增开销 | **P3** | 订阅者只在选中时存在，影响有限；若根因 1 改 transform 直写，这里可改为节流/pointerup 同步 | 选中 1 节点平移，看 Composer commit 次数 |

---

## 特别标注：平移/缩放/拖拽是否走 React state

- **平移（pan）→ 走 React state**：`scheduleOffset` → rAF → `setViewport((c)=>({...c, offset}))`（`useCanvasViewportGestures.ts:80-91`）。**P0**。有 rAF 节流（合格），但终点是 `setState` → 整画布壳重渲染。
- **缩放（zoom）→ 走 React state**：`setViewportTransform`/`zoomAtStagePoint` → `setViewport({zoom,offset})`（`useCanvasViewportGestures.ts:93-103,135-143`）；「适应视图/聚焦」动画 `animateViewportTo` 每个 rAF 步都 `setViewport`（`useCanvasViewportGestures.ts:118-132`）。**P0**。
- **节点拖拽 → 不走"全画布"React state，走 rAF + store**：`useNodeDragResize` 用 ref + rAF，每帧 `moveNode(persist:false)` 落 store，靠节点 `React.memo` 把重渲染限制在被拖节点。**这一块做得对**，不是 P0。

> 核心判断：viewport 是唯一一处「连续高频输入直接喂 React setState」的地方。pan/zoom 的实际 DOM 变化只是一个 `transform: translate(...) scale(...)`（`GenerationCanvas.tsx:585`），完全可以绕开 React 直写 `style.transform`。当前架构让一个 744 行组件 + 未 memo 的边层/minimap 陪着每帧重渲染，这是「平移卡 / 节点多就卡」的结构性根因。

---

## 建议真机实测项（按优先级）

1. **平移 FPS 基线（最关键）**：用 `nomi_*` MCP 或手动放 **100 节点 + 200 边**到一个画布分类，DevTools Performance 录制连续平移 3 秒。看：① `GenerationCanvas`/`CanvasEdgeLayer`/`CanvasMinimap` 各 commit 多少次；② 每帧 scripting 时长是否 > 8ms（掉帧线）；③ 是否稳 60fps。这是验证根因 1/2 的主指标。
2. **密集连线小图**：30 节点 + 150 条交叉边（毛线球），测平移 FPS —— 验证根因「边裁剪仅 >50 节点生效」(P2)。
3. **缩放跟手度**：⌘+滚轮连续缩放，看 zoom 期间帧率与 input-to-paint 延迟。
4. **多选拖拽**：框选 50 节点拖动，测 FPS —— 验证 P3 拖拽路径在大规模下是否需要 transform 直写。
5. **大图节点**：放 20 个有大图结果的图片节点，平移时看 decode/paint（`NomiImage` 已上 `loading=lazy`+`decoding=async`+ 缩略图优先，`media.tsx:31-40`，预期良好，做对账确认即可）。

> 注：实测前先清场（清掉 stale electron 僵尸进程 + 重建后 stale chunk，见 memory `r13-walkthrough-gotchas`），否则伪装成产品卡顿。

---

## 一句话给用户

画布卡顿的**结构性根因是平移/缩放走 React state**：每拖一下/缩一下，整个 744 行画布组件 + 没做 memo 的连线层和 minimap 都陪着重渲染一遍（节点本身靠 memo 拦住了，是好的）。修复方向是把视口变换改成「直接写 DOM 的 transform，不经过 React」（xyflow/tldraw 的标准做法），React 只在松手时同步一次。这一改能同时根治「平移卡」和「节点/边一多就卡」。
