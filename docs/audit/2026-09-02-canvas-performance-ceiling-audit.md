# Canvas Perf — Ceiling Audit (S6 前置天花板地图)

调研日期 2026-09-02 · 纯调研，未改任何文件 · 参考代码只读：`/Users/aoqimin/Desktop/nomi-s3-offcanvas-20260901`
基线：`@xyflow/react@12.11.5` 单内核（R23，不重开内核选型）+ React 18 + Zustand + Electron。
与前腿的关系：leg-c-external.md 已把**拖动专项**（store-grain / sync-cadence / node-weight / render-cull 四嫌疑 + 官方 #4983/#4391 + chaiNNer/Langflow + 测量法）挖透。本篇**不复述它**，往两个方向走：① 官方/RF 生态的**非拖动**完整清单（大图/边/缩放/选择/LOD）；② tldraw / Excalidraw / 平台层（Chromium 合成器、React 18/19、React Compiler）/ 媒体重节点四条**新战线**，逐条判「能不能搬进 RF-DOM 世界」。

---

## TL;DR — 一句话判断

**Nomi 现在离「RF-DOM 世界的天花板」已经很近**：culling（`onlyRenderVisibleElements`）✓、LOD 降级（>80 节点且 zoom<0.55 → 缩略图占位）✓、媒体懒挂载 + 并发上限 + 优先级队列 + IntersectionObserver ✓、video 元素释放 ✓、`will-change:transform` 只钉在 viewport（**没有** layer 爆炸）✓、节点已 memo ✓、rAF 探针 harness ✓。业界（tldraw/Excalidraw）在 DOM 层做的大动作，Nomi 已经做了七八成。**真正还差的天花板集中在三处**：(B) 拖动 tick 的 rAF 合帧 + 画布外订阅细粒度化（leg-c 已点名，这是最大且最确定的一块）；(C) **把静态层（边/网格/minimap）搬到一张 `<canvas>`**——这是 tldraw SDK 4.4「指标 SVG→canvas 换来 up-to-25× 提速」和 Excalidraw 双 canvas 的同一招，是 Nomi 唯一还没碰的结构级杠杆；(B) **媒体分级分辨率 LOD**（tldraw 的 power-of-two screen-scale），Nomi 现在只有「全图 vs 缩略图」二档、无 srcset、无按屏幕缩放选分辨率。**结论：不是「追平过去」，是已进入业界第一梯队的做法，剩下的是 2-3 个明确的上限动作，不是无底洞。**

---

## A 层 — 我们已做（对照 S3/S4 + 现代码，确认打钩）

| 战术 | 现状证据（file:line, nomi-s3-offcanvas worktree） | 对应业界做法 |
|---|---|---|
| **视口 culling** | `GenerationCanvasReactFlowViewport.tsx:137` `onlyRenderVisibleElements` 已开 | = tldraw「spatial index + display:none」、Excalidraw「isElementInViewport」、RF 官方 `useVisibleNodeIds` |
| **LOD 降级（远景/超载出缩略图占位）** | `canvasNodeLevelOfDetail.ts:3-4` 阈值 `>80 节点 && zoom<0.55` → `LightweightGenerationNode`（只挂结果缩略图，不挂 body/工具条）；`GenerationCanvasReactFlowNodes.tsx:141,222` | = tldraw text-shadow LOD(0.35) / 简化档；Excalidraw 视口外不画 |
| **媒体懒挂载 + 并发上限 + 优先级队列** | `deferredNodeMediaQueue.ts`：`mediaLimits[kind]` 并发闸(:63)、priority 排序(:56)、`IntersectionObserver` + `rootMargin`(:194-200) 只在进视口才请求 slot | 比多数 RF 应用**更进一步**（chaiNNer 只做「card 里不放全分辨率」，没有并发池） |
| **video 元素释放（防解码堆积）** | `DeferredNodeMedia.tsx:131-145` `releaseVideoElement`（真卸载才清 src，避开 StrictMode 假卸载坑）；`maxActiveVideos` 探针盯着 | = 池化/降采样思路的一部分 |
| **`will-change` 只钉 viewport（避免 layer 爆炸）** | `generationCanvasReactFlow.css:65-67` `.react-flow__viewport { will-change: transform }`——**只在唯一移动的元素上**，节点本体 `transform:none`(:84) | ✓ **正是** Chromium 现役指导：will-change 只给真动的元素，滥用→GPU 内存膨胀+tile eviction（见 D 层平台警示） |
| **节点 memo + 稳定 edgeTypes/nodeTypes** | `BaseGenerationNode.tsx:703` `React.memo`；`edgeTypes`/`nodeTypes` 定义在 `GenerationCanvasReactFlowNodes.tsx` 模块级(:388)，非渲染内联 | = RF 官方 perf 页第一条 + Synergy「memo 让 10→60fps」 |
| **持久化/事件/撤销不挂拖动 tick** | leg-b 已证：`persist:false`+`emit:false`，仅 dragStop 落一次 | ✓ 正确 |
| **rAF 探针测量 harness** | `tests/ux/canvas-performance-benchmark.e2e.mjs`（frameGapP95 / longTask / LayoutCount / mutations.stage / 媒体激活） | = xyflow 维护者在 #4391 亲口要的「Chrome performance profile」的等价物 |
| **投影层引用等价复用** | leg-b 证：`toGenerationFlowNodes` 未动节点返回 previous 引用（adapter.ts:98-113），未踩 #4983「immer 重建整数组」的坑 | ✓ 正是 #4983 结论要的「RF 面向的 node 对象保持引用稳定」 |

**小结**：A 层覆盖度很高。业界 DOM 白板（tldraw）核心四件套——culling / 反应式细粒度更新 / 批量更新 / LOD——Nomi 已有前三件的等价物，LOD 有但档位粗（见 B4）。

---

## B 层 — RF-DOM 世界内还能上的（主菜，按性价比排序）

> 判据：不换内核、不加 WebGL，纯在 RF+React+Zustand+CSS 里能落地。每条给「机制 / 出处+日期 / 收益量级 / 成本 / eval v2 哪个场景量得到」。

### B1. 拖动 tick 的 rAF 合帧（coalesce mousemove → 一帧一次 commit）★最高
- **机制**：现在一个原生 `mousemove` = 一次完整 React commit（leg-b 实测拖图 `LayoutCount=144`、拖视频 `214`，纯平移只有 3）。用 `throttleRAF`/rAF 把一串 mousemove 的位置写合并到**每帧至多一次** store 写 + 投影重算。
- **出处**：Excalidraw `renderNewElementSceneThrottled`/`throttleRAF`「同步到刷新率、16ms 上限」（DeepWiki Canvas Rendering Pipeline，2025-10）；tldraw「batched store updates：多次改只发一次通知」（tldraw perf 文档，2026-01-31）。
- **收益量级**：高。把 per-move commit 数从「原生事件频率（120Hz 触控板可到 120+/s）」压到「≤显示器刷新率」，直接砍掉 leg-b 那 2.4–3.6×/move 的 forced reflow 放大。
- **成本**：中。要在 adapter 层引 rAF 缓冲 + dragStop flush；注意别破坏 RF 内核自己的 XYDrag（只合并**回写 store** 这一段，RF 内部拖动几何 S4 已下放，不动）。
- **eval v2 场景**：`node-drag-image`/`node-drag-video` 的 `LayoutCount` / `frameGapP95Ms` / `mutations.stage`，A/B 对同机 main。

### B2. 画布外订阅细粒度化（8+ 组件别再订整个 `s.nodes` 数组）★最高
- **机制**：leg-b 点名 `CategoryTree`/`useAssetPool`/`TaskCenterButton`/`TimelinePreview`/`PreviewSourcePanel`/`TaskCenterPanel`/`OnboardingChecklist`/minimap 订 `s.nodes` 整个数组；immer 每 tick 换数组顶层引用 → 拖一个节点，这些侧栏**全部重渲 + 重建 Map/派生视图**，尽管视觉没动。改为：订 `s.nodes.length`/派生 id 集合/用 `useShallow` 选投影，或把「拖动中易变位置」与「侧栏关心的稳定元数据」分成两个 store 字段。
- **出处**：RF 官方 perf 页「不要在组件里直接读整个 nodes/edges 数组」；Synergy「把 selected/volatile 放独立 store 字段，别依赖 nodes 数组」（2025-01-23）；Zustand `useShallow`/`createWithEqualityFn(shallow)`（Synergy state 章 + pmndrs #2862）。
- **收益量级**：高。这是「拖一个节点半个 App 跟着重渲」的直接根因，砍掉的是**纯浪费**的画布外 commit。
- **成本**：中低。逐组件把选择器收窄；S3 已经在画布外订阅做过一轮细粒度化，这是同一条路的收尾。
- **eval v2 场景**：给探针加「画布外组件 render 计数」或看整页 `RecalcStyleCount`/`ScriptDurationMs` delta；配 React `<Profiler>` 一次性证明侧栏不再随拖动重渲。

### B3. 拖动/选择用 CSS 类而非 store 写传递易变态 ★中高
- **机制**：hover/selection/dragging 这类高频易变 UI 态，别写进 Zustand（每次写= 触发订阅链），用 RF 内置 `.react-flow__node.selected` CSS 类 + 内置 `onNodesChange` 选择。Nomi 的 `data-dragging` 已经这么做（leg-b 证，CSS 驱动浮层隐身、不进 React），把 selection/hover 也照此收。
- **出处**：xyflow 团队 `bcakmakoglu` Discussion #4975（2025-01-23）「用 CSS `.selected` 而非 state 更新做选中样式」；tldraw 反应式信号「只有 props 变的那个 shape 重渲」。
- **收益量级**：中高（尤其框选多个节点时）。
- **成本**：中。要审计 selection 状态目前有多少下游依赖 store 里的 `selected`。
- **eval v2 场景**：新增「框选 20 节点」场景，量 `mutations.stage` 与 longTask。

### B4. 媒体分级分辨率 LOD（stepped screen-scale，不只是「全图 vs 缩略图」）★中高
- **机制**：Nomi 现在 LOD 是**二值**——正常挂原图、超载/远景挂 `thumbnailUrl`（`canvasNodeLevelOfDetail.ts:resolveLightweightNodePreview`），且 `NomiImage` **无 srcset、不按屏幕缩放选分辨率**。tldraw 的做法是**按当前屏幕缩放把资源分辨率量化到最近的 2 的幂**（`steppedScreenScale`），远景永远只解码小图、近景才要大图；文字阴影按 LOD 阈值(0.35)关。对「重媒体卡片」这正是解码/纹理内存的大头。
- **出处**：tldraw performance 文档「Level of Detail：steppedScreenScale 量化到最近 2 的幂」+「textShadowLod 默认 0.35」（2026-01-31）。
- **收益量级**：中高（**内存/解码**维度，非帧时维度）——直接压 `maxLoadingImages`/GPU working set，缓解「几十上百张卡片同时解码」。
- **成本**：中。要生成/挑多档缩略图（若 artifact 已有 thumbnailUrl，先用「按尺寸在 原图/缩略图 之间选」的近似版，零新资产）。
- **eval v2 场景**：`gpuWorkingSetMB`/`JSHeapUsedMB`/`maxLoadingImages`，在 S/M/XL 三档缩放到不同 zoom 采样。

### B5. 缩放去抖（大图时 zoom 值在相机移动中锁稳）★中
- **机制**：tldraw `getEfficientZoomLevel()`：文档 >500 shapes 时，相机移动过程中返回**稳定的 zoom 值**（阈值 `debouncedZoomThreshold` 可配），避免每一帧微小 zoom 变化触发全量 LOD/尺寸重算。Nomi 的 LOD 直接读实时 zoom，快速缩放时会在阈值(0.55)边界抖动切换 full/lightweight。
- **出处**：tldraw performance 文档 `getEfficientZoomLevel` / `debouncedZoomThreshold`（2026-01-31）。
- **收益量级**：中（只在「大图 + 快速缩放」尾部抖动时兑现）。
- **成本**：低。给 LOD 判定的 zoom 输入加去抖/滞回（hysteresis）即可。
- **eval v2 场景**：新增「XL 图上快速 zoom in/out」场景，量 full↔lightweight 切换抖动次数 + `frameGapP95`。

### B6. 边渲染降本（simplebezier + 边态不写 store）★中
- **机制**：Nomi 用自定义 `generation` 边（`GenerationCanvasReactFlowNodes.tsx:388`）。大量边时官方给 `SimpleBezierEdge`（减计算）；边的 hover/selected 用 `useReactFlow()` 读、不写边 state。（注：这条在 Nomi 边数=节点×2、当前几十~低百量级下收益有限，先量再动。）
- **出处**：Context7 `SimpleBezierEdge`「为大量边做的性能优化」；Discussion #4975。
- **收益量级**：中低（边多才明显）。
- **成本**：低。
- **eval v2 场景**：XL 档 `mutations.edges` + 平移时 `frameGapP95`。

### B7. React 18 `useDeferredValue` 给「非拖动重活」让路 ★中低（**慎用**）
- **机制**：拖动/框选时，把**下游派生的重计算**（如实时刷新的 minimap 位图、侧栏统计）用 `useDeferredValue` 标记为可延迟，让紧急的拖动帧先出、重活落后一两帧补。**不是**用来包拖动本身（拖动要即时反馈）。
- **出处**：React 官方 `useDeferredValue`「延迟由 props/外部源来的值、先出紧急更新」（React 18 concurrent，Curiosum/DeveloperWay 2024-2025）。适用条件：你**不**直接持有那个 state 的更新代码（正好是「拖动触发、侧栏被动跟」的形状）。
- **收益量级**：中低，且**要实测**——DeveloperWay 明确警告 `useTransition`/deferred 用错反而更慢。
- **成本**：中。容易误用（把该即时的东西也延迟了）。**先做 B1/B2 消掉浪费，再考虑这条兜尾部**。
- **eval v2 场景**：拖动中 minimap 刷新是否掉出主帧路径，看 `frameGapP95` 尾部。

### B8. React Compiler（自动 memo，覆盖手写 memo 的漏网）★中低（战略项）
- **机制**：React Compiler 1.0（2025-10，**stable，production-ready**）**兼容 React 17/18**，React 18 下加 `react-compiler-runtime` + 设 `target:'18'` 即可用；自动为组件做记忆化，堵住「忘了 memo/依赖数组不稳导致 memo 失效」这类静默回归。
- **出处**：react.dev「React Compiler v1.0」（2025-10-07）+ InfoQ（2025-12）「兼容 17+，Meta 生产实战」。
- **收益量级**：中低的即时帧收益（手写 memo 已铺开），但**长期防回归价值高**——leg-c 的 #4983 类坑（memo 被绕过）它能自动兜。
- **成本**：中（编译链改造 + 全量回归验证 + 与现有手写 memo 共存验证）。属**战略基建**，不是拖动急救。
- **eval v2 场景**：开/关 compiler 跑全套 benchmark A/B，看有无回退 + 是否消掉某些非拖动重渲。

---

## C 层 — 架构外挂可选项（不换内核，但动渲染结构）

### C1. **静态层 canvas 化：把边 + 网格 +（可选）minimap 从 DOM/SVG 搬到一张 `<canvas>`** ★★这是唯一还没碰的结构级天花板
- **机制**：DOM/SVG 每根边、每格网格都是一个受合成器管理的元素；平移/缩放/拖动时它们全体参与 layer 更新与重绘。业界顶尖 DOM 白板的共识做法是**分层**：交互元素（可拖、带控件的节点）留 DOM，**静态、只读、量大**的部分（边、网格、指标、minimap）画到一张 canvas 上，一次 `clearRect`+重画代替 N 个 DOM 元素的重排。
- **出处（强证据）**：
  - **tldraw SDK 4.4（2026-02-19）：把 shape indicators 从 SVG 换成 2D canvas，「up to 25× faster rendering in some cases」**（tldraw blog 4.4）；Issue #8314「把 overlay 全面转 canvas 渲染」是其明确路线。
  - **Excalidraw 双 canvas**：static layer（元素/网格，`React.memo` + scene-nonce memo，低频重画）与 interactive layer（选择/光标，高频）分开；static scene 用 `throttleRAF` 限到 ~16ms（DeepWiki Canvas Rendering Pipeline，2025-10）。
- **值不值得开一项？** **值得，作为 S 系列之后的一个独立中型项（不是 S6 急救）。** 判据：① 它是 Nomi 唯一还没做的**结构级**杠杆，性价比在「大图 + 平移/缩放」这类 leg-b 已知的重场景最高（#4711「pan/zoom 重绘所有可见重节点」正是这类）；② 与 R23 不冲突——**边/网格不是交互内核，RF 仍是节点交互/变换唯一内核**，canvas 只接管「静态只读渲染」，节点、拖动、选择全留 RF；③ 成本可控地起步：先只 canvas 化 **minimap**（它每 tick 重画所有 rect，leg-b 点名，且完全只读），验证收益与工程量，再决定要不要吃边层（边层要处理 hover/点击命中测试，复杂度高一档）。
- **收益量级**：高（大图 pan/zoom），但**兑现依赖图规模**——Nomi 现在几十~低百节点时，B1/B2 的收益先到；这条是「往上再要一个数量级图规模」时的天花板。
- **成本**：中→高（minimap 低、边层高：命中测试/hover/动画边都要在 canvas 上重造）。
- **eval v2 场景**：XL/2XL 档「平移 + 快速缩放」的 `frameGapP95`/`RecalcStyleCount`/`LayoutCount`；minimap 单独量「拖动中 minimap 重画」的 mutations。

### C2. 节点内容 `content-visibility:auto`（视口外节点跳过内部 layout/paint）★中（与 culling 部分重叠，需实测）
- **机制**：`content-visibility:auto` 让浏览器**跳过视口外元素的内部 layout+paint**（自动加 layout/style/paint containment），只算尺寸。理论上给「已挂载但滚出视口的重节点内部」再省一层。**但**：Nomi 已开 `onlyRenderVisibleElements`（视口外节点根本不进 DOM），二者**大面积重叠**；`content-visibility` 的价值在「RF 判定为可见、但节点自身内容很重」的边缘，或作为 culling 的补充在「刚滚入/滚出的缓冲带」省重绘。**反模式警告**：任何对该子树的强制 DOM 读（getBoundingClientRect 等）会破坏跳过——Nomi 拖动路径本就有 forced reflow（leg-b），要先确认不打架。
- **出处**：web.dev content-visibility（**Baseline newly available 2025-09-15**，三引擎齐了）+ MDN Containment；实测「chunked 内容初次渲染 7× 提速」但仅在有大量视口外内容时。
- **收益量级**：中（且与 culling 重叠后边际递减）——更多是**兜底**而非主攻。
- **成本**：低（一行 CSS + `contain-intrinsic-size` 占位尺寸），但**必须 A/B 实测**别和 `onlyRenderVisibleElements` 抵消或与 forced reflow 打架。
- **eval v2 场景**：关掉 `onlyRenderVisibleElements`、只用 `content-visibility` vs 现状，对比 `LayoutCount`/`RecalcStyleCount`——判断哪个 culling 策略更省（可能得出「二选一」而非「叠加」）。

### C3. `contain: layout paint` 钉在节点卡片（隔离节点内部 reflow 外溢）★中低
- **机制**：给每张节点卡片加 `contain: layout paint`（或 `content`），让节点内部的尺寸/绘制变化**不外溢**触发画布级 reflow。leg-b 实测拖动有 144–214 次 forced layout，部分来自「节点内容变化 × 画布读尺寸」交替；containment 能把节点内部的读写围起来。
- **出处**：MDN CSS Containment（Using containment，2025）；Chromium「squashing 防 layer 爆炸」同族思路。
- **收益量级**：中低（要看 forced reflow 里有多少来自节点内部外溢 vs 投影链——leg-b 判断主因是投影链无合帧，那 B1 才是主攻，这条是补刀）。
- **成本**：低（CSS），但 `contain` 用错会截断 sticky/overflow 定位，要逐卡验视觉。
- **eval v2 场景**：拖动 `LayoutCount` 前后对比。

---

## D 层 — 地平线（超出 RF，只记不动）

| 项 | 谁在用 | 为何不搬 |
|---|---|---|
| **WebGL/WASM 渲染整块画布** | Figma（C++→WASM+WebGL）、Miro（分层 + WebGL 加速）、tldraw 长期也在往「更多 canvas/GPU」走 | 与 R23「RF 单交互内核」根本冲突；重写渲染管线是另一个产品级项目，非性能优化。**只作为「地平线」记录**：说明 DOM 天花板之上还有一层，但那需要换赛道。 |
| **OffscreenCanvas + Worker 渲染** | Figma/部分白板把光栅化搬进 worker | 需要先有 canvas 渲染层（C1）才谈得上；且 Electron 里主线程通信/纹理上传是新复杂度。C1 落地并吃到边层后再评估。 |
| **Electron GPU 光栅化 flag 调优**（`--enable-gpu-rasterization` / `--enable-zero-copy` / `backgroundThrottling`） | Electron 应用通用 | 有效但**是环境级旋钮不是画布优化**，且平台脆弱（NVIDIA 后台限帧坑、packaged 下 flag 常失效——electron#50469/#40208）。可作为**一次性环境核查**（确认 GPU 光栅已开、前台没被限帧），但不进「画布战术」清单。 |
| **React 19 升级换取更强 concurrent + 原生 compiler** | — | React 19 的并发/compiler 更顺，但**升级是独立大迁移**（Electron+大量三方件），不在本战役范围；React Compiler 已可在 18 上单独用（B8），先走那条。 |

---

## 出处清单（每条现役 + 日期）

- React Flow 官方 Performance 页（v12 current）：https://reactflow.dev/learn/advanced-use/performance
- Context7 `/xyflow/xyflow`：`onlyRenderVisibleElements`/`useVisibleNodeIds`/`SimpleBezierEdge`/lazy nodeTypes（v12 autodocs，2026 抓取）
- xyflow Discussion #4975（大图性能，`bcakmakoglu` 2025-01-23）：https://github.com/xyflow/xyflow/discussions/4975
- Synergy Codes「ultimate guide to optimize React Flow」（**2025-01-23**，含 100 节点 drag FPS 基准：inline fn 60→10/2、memo 10→60、heavy-inner memo 2→35-40→60、数组依赖 12/2）：https://www.synergycodes.com/blog/guide-to-optimize-react-flow-project-performance
- tldraw Performance 文档（**last edited 2026-01-31**）：culling(display:none+spatial index)、reactive signals(只重渲变的 shape)、batched updates、debounced zoom(>500 shapes, `getEfficientZoomLevel`/`debouncedZoomThreshold`)、geometry cache、LOD(steppedScreenScale→最近 2 幂)、textShadowLod(0.35)：https://tldraw.dev/sdk-features/performance
- tldraw Culling 文档：display:none + spatial index(R-tree)，选中/编辑中的 shape 不 cull：https://tldraw.dev/sdk-features/culling
- tldraw SDK 4.4 blog（**2026-02-19**）：**indicators SVG→2D canvas「up to 25× faster」** + R-tree 空间索引加速框选/擦除：https://tldraw.dev/blog/tldraw-sdk-4.4
- tldraw Issue #8314「Fully convert overlays to canvas rendering」（路线）：https://github.com/tldraw/tldraw/issues/8314
- Excalidraw 渲染管线（DeepWiki，含 **2025-10-04** #10063 pipeline 优化 issue）：双 canvas(static+interactive)、`renderStaticSceneThrottled`(~16ms/60fps)、scene-nonce memo、视口 culling：https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline
- content-visibility（**Baseline newly available 2025-09-15**）：https://web.dev/articles/content-visibility ；MDN Using containment：https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Using
- Chromium 合成器 / will-change layer 爆炸：https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/ ；「will-change 滥用→GPU 内存膨胀+tile eviction」MSPK substack（2024-2025）
- React 18 `useDeferredValue`/`useTransition`：https://react.dev/reference/react/useDeferredValue ；「用错反而更慢」DeveloperWay：https://www.developerway.com/posts/use-transition
- React Compiler v1.0（**2025-10-07 stable，兼容 17/18**）：https://react.dev/blog/2025/10/07/react-compiler-1 ；InfoQ（2025-12）：https://www.infoq.com/news/2025/12/react-compiler-meta/
- Electron GPU/背景限帧坑：electron#50469、#40208、#9567（backgroundThrottling 现状）

---

## 与 leg-c 的分工备忘（防重复）

leg-c 已覆盖：拖动四嫌疑、#4983/#4391/#4711、chaiNNer/Langflow 真代码、3 级 memo、measurement Option A/B/C。本篇**新增**：官方非拖动清单（culling 阈值/LOD/边/缩放去抖）、tldraw/Excalidraw 结构级做法（canvas 化静态层 = C1 天花板）、平台层（content-visibility Baseline/containment/will-change 爆炸/Electron flag）、媒体分辨率 LOD（B4）、React 18 deferred + React Compiler（B7/B8）。两篇合起来 = 拖动急救（leg-c 主）+ 天花板地图（本篇主）。
