# 画布性能优化 · 迁移前→现状(RF 单内核) 逐条对账

> 只读审计 · worktree `/Users/aoqimin/Desktop/nomi-s3-offcanvas-20260901` @ `777c9be0`(+S3 已合)
> 2026-09-02 · 老优化对账班（S6 前置）
>
> **关键上下文**：本 worktree = origin/main(777c9be0) + **S3 已合**(`cc338341`，画布外订阅细粒度化=旧 suspect #1/#4/#5)。
> **S4 未合**（`9d41e9ba/77e02f8a` 拖动内核下放在别的分支 `9f20c8b0`，S4 班在途）——故本盘上「拖动 tick 每帧 moveNode 写 store」= suspect #2 **仍在**，是 S4 正在修的东西，不是「老优化丢了」。
>
> 判定图例：
> - **[等价]** 已迁移等价存在（代码搬了/改写了，行为在）
> - **[RF原生]** React Flow 框架原生解决（比老实现更彻底）
> - **[S3/S4取代]** 已被 S3(cc338341) 或 S4(draft 层) 取代
> - **[丢·适用]** 真丢了·仍适用·值得补
> - **[丢·不适用]** 真丢了·但换框架后不再适用

---

## 一、8/09 benchmark 的 12 项 before/after（本轮主角，`2026-08-09-canvas-performance-benchmark.md`）

这 12 项的「保留的实现优化」原文只有三条根因（其余是这三条在各场景的表现）：
①未选中节点不订阅全局多选布尔 ②生成引用解析按 nodes/edges 引用缓存索引 ③节点关系查询缓存帧来源/镜头序号索引。

| # | 优化项 | ① 当年机制 | ② 现状核查(file:line) | ③ 判定 | ⑤ 证据 |
|---|---|---|---|---|---|
| 1 | 未选中节点不订阅全局多选布尔 | L 档连续选择 82.8→53.2ms 的主因之一：未选中节点订阅 `isMultiSelectActive` → 每次多选变化 N 个节点全重渲 | RF 节点 `useStore((state) => state.multiSelectionActive && data.primarySelection)` —— 只有 primary 选中节点才对多选敏感；`GenerationCanvasReactFlowNodes.tsx:131` | **[等价]** | 765bd534；现 `:131` |
| 2 | 生成引用解析按 nodes/edges 引用缓存索引 | 每 tick 重建 nodesById/sortedEdges/edgesByTarget/assetKindByUrl = O(n) 全表扫 → WeakMap keyed on 数组引用，immer 稳定引用→高命中 | 4 个 WeakMap 缓存原样在：`generationReferenceResolver.ts:44-47`（nodesByIdCache/sortedEdgesCache/edgesByTargetCache/assetKindByUrlCache） | **[等价]** | 765bd534；现 `:44-47` |
| 3 | 节点关系查询缓存帧来源/镜头序号索引 | 每张卡 O(n) filter「被多少分镜引用」→ n×O(n)=O(n²)；改 WeakMap keyed on edges，每卡 O(1) | `useNodeRelationships.ts`：usageCache/mountedCache/frameSourceCache 三个 WeakMap 全在（`:22/:75/:109`），注释仍标 v0.7.2 perf | **[等价]** | 765bd534；现 `hooks/useNodeRelationships.ts:8-11,22,109` |
| 4 | L 连续选择 fps 60.2→73.2 | = #1+#2+#3 合力 | 同上三项，均在 | **[等价]**（但见注） | — |
| 5 | 连续选择 frame gap p95 82.8→53.2ms | 同 #4 | 同上 | **[等价]**（但见注） | — |
| 6 | 连续选择 max frame gap 432.6→93ms | 同 #4 | 同上 | **[等价]** | — |
| 7 | 连续选择 long task 325→60ms | 同 #4 | 同上 | **[等价]** | — |
| 8 | 连续选择脚本时长 466.2→376.1ms | 同 #4 | 同上 | **[等价]** | — |
| 9 | 视频节点拖拽 frame gap 43.6→33.3ms | = 拖动路径整体（memo/rAF/ref/store 推迟） | 拖动路径仍在但**当年是自研内核**；RF 内核下拖动=每 mousemove `moveNode` 写 store（`GenerationCanvasReactFlow.tsx:449-451`）——**这条数字对不上历史**，是 S4 要重建的部分 | **[S3/S4取代]**（拖动路径整体换内核） | 现 `:448-451`；S4 在 `9d41e9ba` |
| 10 | 媒体切入 max frame gap 331.7→56.3ms | DeferredNodeMedia 视口挂载队列 + 激活上限(image4/video1) | 队列引擎原样：`deferredNodeMediaQueue.ts`（DEFAULT_MEDIA_LIMITS image:4/video:1 `:18-21`、IntersectionObserver 挂载 `:184`、`scheduleAfterCanvasShellPaint` 冷启动让路 `:136`）；card 渲染器全接（Character/Scene/Prop/Base） | **[等价]** | 0e1be560；现 `nodes/deferredNodeMediaQueue.ts` |
| 11 | 逐边 memo（当年验证后**撤回**，仅 +1.3%） | — | 当年就没保留 | **[丢·不适用]**（当年主动撤回；RF 边现由 `onlyRenderVisibleElements` + 视口裁剪管，逐边 memo 无意义） | 8/09 plan L106 |
| 12 | 延迟批量工具条（当年验证后**撤回**，反造 long task） | — | 当年就没保留 | **[丢·不适用]**（当年主动撤回） | 8/09 plan L106 |

> **注（#4/#5 连续选择的真相）**：三条根因缓存都在，但**选择的代码路径整个换了**（自研 selection → RF 内部 selection store + `handleSelectionEnd`/`handleNodesChange` 的 selection change 合并）。迁移验收日志自述 `click-select` 残留 frameGapP95 36.1ms(预算33) + max 117.7ms、`marquee-select` max 128.2ms(预算100) 的软预算 miss（migration doc L161-163）。8/09 当年就把「连续选择」列为后续回归热点，迁移后它**仍是最靠近预算线的场景**。→ eval v2 已把 `multi-node-drag` 纳入 S 档新场景，但**纯连续 click-select 的摊销指标（每次 select 的 script/layout）eval v2 未单列**——见「值得补」清单。

---

## 二、8/08 拖即平移 + 平移不重绘（`2026-08-08-canvas-drag-pan-and-quiet-render.md`）

| # | 优化项 | ① 当年机制 | ② 现状核查 | ③ 判定 | ⑤ 证据 |
|---|---|---|---|---|---|
| 13 | 变换层升合成层 `will-change:transform` | 平移只搬像素零重绘 | `.react-flow__viewport { will-change: transform }`：`generationCanvasReactFlow.css:66` —— RF viewport 层接管变换，就是这条 | **[RF原生]**（RF 自持 d3-zoom transform 层，will-change 显式补在 viewport） | 8/08；现 css `:66` |
| 14 | 平移期间不每帧写 store 变换（节流 store 同步 100ms） | `useCanvasTransformStoreSync`：zoom 即时、纯平移节流 100ms+收尾，避免每帧 fan-out 到订阅 offset 的节点选择器/composer | **RF 不用它**：RF 平移中 viewport 只活在 RF 内部态，`onMoveEnd` 才 `rememberCategoryViewport` 落库（`GenerationCanvasReactFlowViewport.tsx:159-166`）=平移期间对 Zustand **零写**（比 100ms 节流更彻底）。旧文件 `useCanvasTransformStoreSync.ts` 现**仅 ENTRY.md 引用+自引用=孤儿死码** | **[RF原生]**（机制被更强的取代；死文件是卫生欠账） | 8/08；现 viewport `:159-166`；孤儿 `components/useCanvasTransformStoreSync.ts` |
| 15 | 边标签仅选中节点/激活边才渲染（删密度折叠+hover 揭示两补丁） | 标签门从「有类型就显示+密度折叠+hover」改成「关联选中/被激活」 | RF 边 `showLabel = !readOnly && (menuOpen || (mode!=='reference' && (incident||selected)))`：`GenerationCanvasReactFlowNodes.tsx:267`；`incident/selected` 由 adapter 按「单选节点触及该边」算：`generationCanvasReactFlowAdapter.ts:175-196` | **[等价]** | 8/08+8/08-edge-label-focus；现 `:267`,adapter `:175-196` |
| 16 | 拖动收起浮层 `data-dragging`（四条拖动路径统一置位，imperative DOM 不进 React） | 单节点/选区框/组框/平移四路径升 stage `data-dragging`；浮层 `group-data-[dragging]/canvas:invisible` | `canvasDraggingFlag.ts` 全在；四路径全接：RF 节点拖（`GenerationCanvasReactFlow.tsx:500/516`）、平移（`GenerationCanvasReactFlowViewport.tsx:157/161`）、选区/组框拖（`useCanvasSelectionDrag.ts`）、`useNodeDragResize.ts`；浮层各自声明（NodeFloatingToolbar/NodeGenerationComposer） | **[等价]** | 8/08 补丁三；现 `canvasDraggingFlag.ts`+四调用点 |
| 17 | 点空白不刷新（光标 grab→CSS `:active`，clearSelection 幂等守卫） | 光标反馈从 React state 改纯 CSS；clearSelection 空选区直接返回 | 光标 CSS 在 RF css；`clearSelection` 幂等守卫在 store（S3 前已在，与迁移无关） | **[等价]**（光标走 CSS，RF pane 自持） | 8/08 补丁二 |
| 18 | 平移中缩放不抖（增量式基准 `offsetRef+这一步位移`） | 绝对式基准一滚一抹→改增量式 | **[RF原生]**：平移+锚点缩放几何全由 RF d3-zoom 统一算，旧「绝对式基准抖动」bug 结构上不存在 | **[RF原生]** | 8/08 补丁一 |

---

## 三、6/22 全链路 P0（`2026-06-22-performance-overhaul.md` + `docs/audit/perf/03-canvas.md`）

| # | 优化项 | ① 当年机制 | ② 现状核查 | ③ 判定 | ⑤ 证据 |
|---|---|---|---|---|---|
| 19 | P0-D 画布 viewport 走 transform 直写(不经 React) | 老 `GenerationCanvas` 744行壳 pan/zoom 走 useState→整壳重渲；改 transform 直写、React 只 pointerup 同步 | **[RF原生]**：这正是 RF 的 d3-zoom+transform-only 内核模型（当年审计原文就写「参考 xyflow」）。老 god-component 已整体删除 | **[RF原生]** | 03-canvas.md L27,L43,L61 |
| 20 | P0-D `CanvasEdgeLayer` React.memo + 只渲可见边 | 老边层裸函数无 memo，每 pan 帧重算所有 bezier | **[丢·不适用]**：`CanvasEdgeLayer.tsx` **已删**（迁移 doc L184 确认无生产引用）。RF 边=每边一个 memo 组件 + `onlyRenderVisibleElements` 视口裁剪（`GenerationCanvasReactFlowViewport.tsx:137`），比老边层强 | **[丢·不适用]**（组件不存在了，能力被 RF 边+可见裁剪覆盖） | 6/22 §3.5;迁移 doc |
| 21 | P0-D `CanvasMinimap` React.memo + bbox/跳转 memo | 老 minimap 无 memo 每 pan 帧重算方块 | `CanvasMinimap.tsx` **仍在自研**（RF minimap 未用），`React.memo`+nodeBbox/geometry useMemo（`:25/:38/:54`）；S3 又加「拖动中冻结」（`useStableCategoryNodes.ts:57-59`，minimapNodes 拖动期锁 pre-drag 引用） | **[等价]**+**[S3增强]** | 6/22 §3.5;现 `CanvasMinimap.tsx`+`useStableCategoryNodes.ts:55-61` |
| 22 | P0-D 边裁剪阈值放宽(不再仅>50节点) | 老 `visibleEdgeNodeIds` ≤50节点传 null=渲全部边，毛线球无裁剪 | **[丢·不适用]**：RF `onlyRenderVisibleElements` 对边一视同仁按视口裁，无「50 节点门槛」概念 | **[丢·不适用]**（门槛概念随老代码消失，RF 无条件视口裁剪） | 03-canvas.md L30 |
| 23 | P0-A 3D frameloop=demand + 交互处 invalidate | 全屏编辑器 Canvas 静止也每帧渲 GPU→demand，四处交互补 invalidate | 全在：`Scene3DFullscreen.tsx:582`(`frameloop={... ? 'always':'demand'}`)、`scene3dViewControllers.tsx:212/348/497`(free-look/键盘飞行/聚焦 invalidate)、小相机预览 `scene3dCameraPreview.tsx:218` demand | **[等价]** | 6/22 §3.5;现 `scene3d/*` |
| 24 | P0-B 时间轴 playhead 拆 store | playhead 每帧换整 timeline identity→拆独立字段 | **[范围外]**：时间轴不是画布(`generationCanvas/`)；`ddedd7cc` 改 TimelineClip/Track，与 RF 画布无关 | **[范围外·非画布]** | ddedd7cc |
| 25 | P0-C 流式两 memo | NomiMarkdown/AssistantMessageView memo | **[范围外]**：AI 流式，非画布 | **[范围外·非画布]** | 6/22 §3.5 C |

---

## 四、6/14 丝滑 ABC（`2026-06-14-canvas-smoothness-ABC.md`，当年"改自研不迁 RF"）

| # | 优化项 | ① 当年机制 | ② 现状核查 | ③ 判定 | ⑤ 证据 |
|---|---|---|---|---|---|
| 26 | A 滚轮/触控板缩放 rAF 批处理 | 快滚多次 setState 抖动→rAF 合帧 | **[RF原生]**：wheel/pinch 缩放由 RF d3-zoom 内部合帧 | **[RF原生]** | 6/14 §2 |
| 27 | B1 缩放/适应/重置 rAF 插值动画(140ms) | 离散跳转加缓动 | 现由 `viewportAnimationCoordinator.ts`+RF `setViewport({duration})` 提供 fitView/reset 动画（`components/viewportAnimationCoordinator.ts` 在） | **[等价]** | 6/14 §3;现 `viewportAnimationCoordinator.ts` |
| 28 | B3 pendingCursorPos rAF 节流 | 连线拖拽每 pointermove setState→rAF | 连线走 `useGenerationCanvasReactFlowPointer.ts:47` `requestFrame:(cb)=>requestAnimationFrame(cb)` | **[等价]** | 6/14 §3;现 pointer `:47` |
| 29 | B3 边层视口裁剪 | 只渲两端任一在可视区的边 | **[RF原生]** `onlyRenderVisibleElements`（见 #22） | **[RF原生]** | 同 #22 |
| 30 | C2 清 4000×3000 死常量 | 老 css 固定尺寸→删 | **[丢·不适用]**：老 `.generation-canvas-v2__nodes/__edges` 固定尺寸随老壳删除；RF viewport 无此常量 | **[丢·不适用]** | 6/14 §4 |

---

## 五、其余 perf commit（题目点名 + git 搜全）

| # | commit | ① 内容 | ② 现状 | ③ 判定 |
|---|---|---|---|---|
| 31 | `0164bf5b` 卡顿专项三处根治 | = 6/22 A/C/D 的落地 commit | 见 #19-25 | 同 6/22 |
| 32 | `83d8b9c2` low-zoom lightweight | 断言 low-zoom benchmark 进 lightweight 模式（LOD 阈值 80） | LOD 全在且 RF 接：`canvasNodeLevelOfDetail.ts`(阈值80 `:3`、zoom<0.55 `:4`)、RF 节点 `GenerationCanvasReactFlowNodes.tsx:135-146` 用 `useViewport().zoom`+nodeCount 决策、渲 `LightweightGenerationNode` | **[等价]** |
| 33 | `0e1be560` canvas memory | LOD 新增 + DeferredNodeMedia 建立 + clientIdRegistry 拆模块(会话清理不拉全量工具执行器) + useCanvasViewport 内存 | LOD/DeferredNodeMedia 见 #10/#32；`agent/clientIdRegistry.ts` 原样在（LLM clientId→节点 id 小模块，会话清理不拉全量工具执行器=省内存）；`useCanvasViewport.ts` RF 主平移不用它（RF 自持视口）但**仍活**于折叠组卡堆(`useCollapsedCanvasViewport.ts`) | **[等价]**(LOD/Deferred/clientIdRegistry 全在；主平移视口 RF 原生取代但 useCanvasViewport 仍服务折叠视图) |
| 34 | `839f61c0` 取景 recorder 脏判断 | scene3d 录制器加脏判断消静止 12Hz 全场景重渲 | scene3d 录制/采样脏判断逻辑在 `Scene3DTakeSampler.tsx:37`+frameloop 门；属画布内 3D 子系统 | **[等价]** |
| 35 | `f65a3276` 冷启动+流式贴底 | E 窗口不被代理探测/能力核阻塞（主进程）；流式贴底（AI 区） | **[范围外]**：主进程冷启动 + AI 流式，非画布渲染。（DeferredNodeMedia 的 `scheduleAfterCanvasShellPaint` 冷启动让路是画布侧、已在 #10） | **[范围外]** |
| 36 | `1d161a55` 图层落地主进程(白板秒开) | 拆解白板图层落地挪主进程，不逐张走代理下载 | 拆解白板(`decompose/`)子系统；`extractDeconstructionShotsToNodes` 等在。属画布内但独立子域，与拖动/平移无关 | **[等价·独立子域]** |
| 37 | `080bb790` repository mutex 轻量 | 主进程仓库互斥锁轻量化 | **[范围外]**：主进程持久化，非画布 | **[范围外]** |
| 38 | `ddedd7cc` 时间轴播放重渲收窄 | TimelineClip/Track memo | **[范围外·非画布]**（见 #24） | **[范围外]** |

---

## 六、6/08 地基（`2026-06-08-performance-foundation.md`，框架无关）

| # | 优化项 | ② 现状 | ③ 判定 |
|---|---|---|---|
| 39 | `<img>` lazy/decode/缩略图优先(NomiImage) | card 渲染器经 DeferredNodeMedia/NomiImage 走 lazy+decode+缩略图优先（thumbnailUrl 优先 `canvasNodeLevelOfDetail.ts:19-24`） | **[等价]** |
| 40 | 节点 React.memo + 比较器 | RF 下等价物=adapter `toGenerationFlowNodes` 引用复用（`generationCanvasReactFlowAdapter.ts:100-108`：generationNode 同引用+selected/readOnly/primary/appear/focus 全等则复用旧 flow node）→ RF 内部据引用等价跳过重渲 | **[等价]**（memo 语义搬进 adapter 引用复用） |
| 41 | 节点不订阅 canvasZoom(改下发) | RF 节点用 `useViewport().zoom`（RF context）不订阅 store canvasZoom：`GenerationCanvasReactFlowNodes.tsx:132`；BaseGenerationNode 已无 canvasZoom 订阅 | **[等价/RF原生]** |
| 42 | 素材库/项目库/文件树虚拟化 | 框架无关，与画布渲染内核解耦，不受迁移影响 | **[等价·非画布内核]** |

---

## 七、S3 已合项（本 worktree 已含 `cc338341`，登记以免与"丢了"混淆）

| 项 | 机制 | file:line |
|---|---|---|
| 画布外 8 消费者细粒度化(旧 suspect #1) | CategoryTree/useAssetPool/TaskCenterButton/TaskCenterPanel/TimelinePreview/PreviewSourcePanel/OnboardingChecklist/timelinePlaybackUrl 改「不含 position 的派生 selector」——如 CategoryTree 用 `selectStableCanvasNodes`(`CategoryTree.tsx:45`)，拖动时 position 广播不再打醒它们 | cc338341 全量 |
| filter 引用稳定(旧 suspect #4) | `filterNodesStable`(`store/canvasNodeProjection.ts:195`)→`useStableCategoryNodes.ts:45-53`：同类别成员/序不变则返旧数组引用，投影链 bail | `useStableCategoryNodes.ts:44-53` |
| minimap 拖动冻结(旧 suspect #5) | 拖动期 minimapNodes 锁 pre-drag 引用，O(n)/tick 画笔不每帧重画 | `useStableCategoryNodes.ts:55-61`+`GenerationCanvasReactFlow.tsx:499/515` |

## 八、S4 在途项（**未在本 worktree**，`9f20c8b0` 别的分支）

旧 suspect #2「拖动 tick 无 rAF 合帧 / 每 mousemove 同步 moveNode 写 store + 全量 commit + 投影链全跑」——本盘 `GenerationCanvasReactFlow.tsx:448-451` 仍是每 change 直写 `moveNode`。S4(B 案)把拖动几何下放 RF/draft 层、`onNodeDragStop` 才写回 Zustand。**这不是"老优化丢了"**，是迁移后新引入的重量，S4 正在按 eval v2 的 B 案修。审计不重复计入"值得补"。

---

# 结论

## 五类判定计数（去掉范围外/重复登记后的 42 项优化本体）

- **[等价] 已迁移等价存在**：#1,2,3,4,5,6,7,8,10,15,16,17,21,23,27,28,32,33,34,36,39,40,41,42 ≈ **24 条**
- **[RF原生] 框架原生解决**：#13,14,18,19,26,29 ≈ **6 条**（+#41 兼算）
- **[S3/S4取代]**：#9（拖动路径整体换内核，S4 在途）；另 S3 三项(七节)已合 = **1 条主 + 3 条已合登记**
- **[丢·不适用] 真丢了但换框架后不再适用**：#11,12,20,22,30 ≈ **5 条**
- **[丢·适用] 真丢了·仍适用·值得补**：见下（**0 条硬缺失 + 2 条软欠账**）
- **[范围外·非画布]**：#24,25,35,37,38 = 5 条（时间轴/AI 流式/主进程冷启动/仓库锁，本就不属画布渲染）

## 「真丢了·仍适用值得补」完整清单

**没有一条画布性能优化是"真丢了、仍适用、硬缺失"的**——迁移把每条要么等价搬了、要么被 RF 原生更强地覆盖、要么当年就撤回了。只有 **2 条卫生/量具欠账**（不阻塞，advisory 级）：

1. **孤儿死码 `useCanvasTransformStoreSync.ts`**（已核实为真孤儿：`grep` 全 src 仅 ENTRY.md+自引用，无生产/测试引用。注：`useCanvasViewport.ts` **仍存活**——被 `useCollapsedCanvasViewport.ts:5,33` 用于折叠组卡堆视口，不是死码。）
   - 预期收益：0 运行时收益（RF 已用更强的 onMoveEnd 零写取代 8/08 的 100ms 节流）；**收益是卫生**——留着会误导"平移 store 同步还在用它"。eval v2 §五已把它列进 S6 卫生欠账。
   - 量它的场景：无需 benchmark；`grep` 证死引用即可（现仅 ENTRY.md+自引用）。
   - 补法：P1 删文件 + ENTRY.md 引用（S6 顺手）。风险：极低（无生产引用）。

2. **「纯连续 click-select 摊销指标」eval v2 未单列**
   - 预期收益：不是补优化，是**补量具**——8/09 三条 selection 缓存(#1/#2/#3)都在，但迁移后 click-select 残留 frameGapP95 36.1ms(预算33)/max117.7ms，是最靠预算线的场景；eval v2 新场景加了 `multi-node-drag` 却没加「连续 click-select 的每次 select script/layout 摊销」——这正是 8/09 点名的"后续回归热点"，现在没有细粒度指纹盯它。
   - 量它的场景：在 `canvas-performance-benchmark.e2e.mjs` 现有 `click-select` 场景上加「每次 select 的 scriptDur/LayoutCount 摊销」advisory 指标（与 eval v2 给拖动加的 `scriptDur/moves`/`LayoutCount/moves` 同模式）。
   - 补法：eval v2 S6 评估新指标时，把 click-select 摊销一并纳入 advisory。风险：advisory 起步、不 gate，零回归面。

> 两条都属 eval v2 已规划的 S6 收尾范围，非"迁移丢失需紧急补"。**核心结论：换框架没丢任何仍适用的画布性能优化**。
