# 走查取点只信「真实光标到位后的那一次」，stage 一变窄假绿假红一起来

> 📎 教训 · 首次记录 2026-09-05 · 状态：✅ 已固化（取点/复验/连线点击收口在 `tests/ux/_canvasPoints.mjs`；框选边距 `MARQUEE_STAGE_MARGIN_PX`；benchmark wheel-zoom 身份基线改在放大态量）
> **触发场景**：画布走查在 CI 或本机随机翻红，报的是「点空白没取消选中」「等了 5s 仍未视觉安定」「subtree intercepts pointer events」；或者你刚让画布 stage 变窄/变宽（侧栏、常驻面板、窗口尺寸）。

**结论**：走查里所有「找个点去点/去拖」的地方，**扫描那一刻的 `elementFromPoint` 只是候选，真实鼠标移到那里之后必须再查一次**，不空白就换下一个；框选起终点离 stage 边至少 48px（React Flow 框选 autoPan 带 40px + 8px）；点连线命中层沿 path 取样、只点最上层真是这条 path 的点。这三件事以前散在 7 个文件里各抄一份，现在只许走 `tests/ux/_canvasPoints.mjs`。

**为什么会踩**（PR #488 把常驻 Agent 面板默认展开，1600 窗口下 stage 从 ~1540 压到 1200px，三条 CI 一起红，全都不是产品回归）：

- **点空白被磁性「+」吃掉**：扫描时用 `hit.closest('.generation-canvas-v2-node, …')` 判空白，但磁性连接句柄的 hit-area（`generation-canvas-v2-node__magnetic-handle`，`pointer-events-auto absolute`）挂在 **React Flow 节点壳** `.react-flow__node` 上、伸到卡片外面。stage 一窄，行列扫描落点正好落在两张卡之间的句柄带上：`{x:900,y:213}` 扫描时"空白"，鼠标一到就是蓝色「+」，点击被它吃掉，选中态不清。本机 2/2 确定性复现，`tests/ux/shots/canvas-drag-pan-gestures/99-failure.png` 里那个「+」就压在点上。
- **框选截图永远等不到安定**：`findMarqueeGesture` 只要求起终点在 stage 内 8px；stage 变窄后 fitView 把节点包围盒贴到左边，终点落到离 stage 左边 20px 处。React Flow `Pane` 在框选时对离容器边 40px 内的指针**持续 autoPan**（`@xyflow/system` `calcAutoPan(pos, bounds, speed, distance = 40)`），鼠标按着不动、画布每帧都在走，`screenshotSettled` 的几何指纹永远不稳 → 「等了 5017ms 仍未视觉安定」。CI 上死在这一步，本机死在上一步——同一根因两种死法。
- **连线点击被节点卡拦截**：`clickOrFail(path)` 让 Playwright 点 path 包围盒中心；收起编组后那条聚合线是从 (414,250) 往回弯到 (179,592) 的贝塞尔，包围盒中心压在节点卡上 → 「subtree intercepts pointer events」15s 超时。stage 宽时纯属运气好。
- **perf 门岗的 DOM 身份守卫把视口裁剪当成整层重建**：wheel-zoom 场景 60 格 ±100 交替，`onlyRenderVisibleElements` 在放大态把贴边节点卸载、回原态再挂回来；stage 变窄贴边节点变多，`commonIdentityPreserved=false`（9 个共有、6 个保住）→ 「warmup 失败 1 次，结果不可靠」。**不是预算红**（p95 23.8 / 53），也不是回归。修法是把身份基线挪到第一格放大态之后量：此后一直挂着的节点才是「该保住身份」的那批。
- **顺手挖出的产品 bug（#488 自己的）**：`useCreatedNodeVisibilityPan` 把 60ms 定时器挂在 effect cleanup 上，建卡后 store 回写 size 一重渲染就把露出取消了；修掉这个之后又撞上第二层——composer 让位与新建露出共用 `flow.setViewport({duration})`，后来者打断先来者，x 位移刚起步 1px 就被抹掉。再修掉这层还有第三层——store 记住的分类视口一变，`GenerationCanvasReactFlow` 就用 `duration: 0` 直接写回 React Flow，而每次 onMoveEnd（包括动画被打断时 React Flow 补发的那次）都会改 store：这记零时长写入把正在飞的露出动画掐断，而 **React Flow 对被打断的 `setViewport` 永不结算 promise**，composer 的让位请求闩也跟着卡死。收口在 `viewportTargetTracker`（每个自动让位从「正在去的目标」出发算增量）+ 同步 effect 只在 React Flow 与 store 真不一致时才写。
- **走查 ~40% 随机「两个节点建了却不显示」——最深的一层，靠三道陷阱才抓到**（fiber 拿到 React Flow 的 zustand store → `subscribe` 里记第一笔非有限 transform 的调用栈 → 再用 ResizeObserver 盯整条祖先链）：① 节点渲染器按种类 `React.lazy`（`renderRegistry`），第一次建某种节点时 chunk 没到、最近的 Suspense 边界是 `NomiStudioApp` 包住整个画布的那个，React 把**整个 stage** `display:none` 约 30ms（用户看到画布闪黑一帧）；② React Flow 的 `XYPanZoom` 用 ResizeObserver 缓存 d3 的 extent，那一帧被记成 **0×0**，之后任何一次 `setViewport({ duration })` 过渡走 `interpolateZoom` 除以 0 → transform `[NaN,NaN,NaN]`，`onlyRenderVisibleElements` 把所有节点判不可见；③ `onMoveEnd` 把 NaN 记进分类视口，同步 effect 再写回去，画布永久空白。三层各修各的：节点就地 `<Suspense fallback={轻量卡}>`；自动让位改走我们自己的 rAF 调度器逐帧 `duration: 0` 直写（不经插值、不看缓存、被打断也会结算）；`onMoveEnd` 用 `isFiniteFlowViewport` 拒收并用最后一份好视口恢复。露出真的生效后又冒出一条：复制变体→露出平移→撤销，视口留在原地、原卡跑到视口外——撤销要对称，`shouldRestoreAfterReveal` 在视口仍停在露出落点时回到出发点。

**怎么用**：

- 新写/修画布走查，取点一律 `findBlankCanvasPoint(win, …)`、点连线一律 `clickEdgeHitPath(win, locator, label)`、框选边距用 `MARQUEE_STAGE_MARGIN_PX`；别再 copy 一份 `findBlankPoint`。`tests/ux/_canvasPoints.test.mjs` 钉着「复验发生在 mouse.move 之后」。
- 排除清单要含 `.react-flow__node`（壳）不只 `.generation-canvas-v2-node`（卡）：hover 才冒出来的东西大多挂在壳上。
- CI 报「未视觉安定 + 没有未结束的动画」且当时鼠标按着 → 先查指针离 stage 边多远，别去调 timeout。
- 画布整片空白但节点还在 store：先看 React Flow store 的 `transform` 是不是 NaN（走查失败时 DIAG 会打），再查那一帧谁把 stage 藏了（Suspense 最常见）；别去调 timeout。
- perf 门岗红先看 `warmupFailures[].failures` 是什么：`identity changed` 类是正确性守卫不是预算，先问「这一步会不会让视口裁剪卸载节点」。
- 三份证据都在 #488 CI run 33947462331 的三个 job 与本机 `docs/fixes/2026-09-05-canvas-walkthrough-stage-width.root-cause.json`。

**相关**：[dead-selector-lies-both-ways](dead-selector-lies-both-ways.md)、[expect-absent-passes-too-early](expect-absent-passes-too-early.md)、[canvas-perf-budget-calibrated-on-macos-fails-on-linux](canvas-perf-budget-calibrated-on-macos-fails-on-linux.md)、[walkthrough-repair-probe-first](walkthrough-repair-probe-first.md)
