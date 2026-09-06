# 常驻 Agent 面板压窄画布后：走查取点复验 + 自动让位合成

> 状态：✅ 已交付（本分支）· 2026-09-05 · 起因：PR #488 把常驻 Agent 面板默认展开，1600 窗口下画布 stage 从 ~1540px 压到 1200px，Canvas Acceptance 两个 shard 与 Canvas Performance 一起红。
> 教训沉淀：[`docs/lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md`](../lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md)；根因合同：[`docs/fixes/2026-09-05-canvas-walkthrough-stage-width.root-cause.json`](../fixes/2026-09-05-canvas-walkthrough-stage-width.root-cause.json)。

## 范围

**走查层（三条 CI 红的直接原因，全是量具）** —— 由同分支的 commit ec7e493f9 / a4daf5642 完成（`tests/ux/_canvasHit.mjs` 单一 owner：空白 = 最顶层元素就是 React Flow pane；`findEdgeHitPoint` 沿 path 取样；框选避开 autoPan 带并先缩小；benchmark 只对全程挂着的节点做身份守卫）。本分支起初也做了一份等价实现，合并时删掉、只留他们那份（P1）。本分支保留在走查层的只有：gestures 走查新增断言「新建的节点完整落在 stage 内」+ 节点没渲染出来时的 React Flow 状态转储。

**产品层（走查顺手挖出的 #488 自身缺陷：新卡落在 Agent 面板底下、视口不动）**

- `useCreatedNodeVisibilityPan`：待执行的露出跨渲染保活（原先挂在 effect cleanup，store 回写 size 一重渲染就取消）。
- `viewportTargetTracker`（新）：视口「正在去的目标」登记处，带过期；`useComposerVisibilityPan` / `useCreatedNodeVisibilityPan` 都从它出发算增量（`composeComposerPanTarget`）。
- `GenerationCanvasReactFlow`：`animateViewportTo` 改走我们自己的 `createViewportAnimationCoordinator`，逐帧 `flow.setViewport(…, { duration: 0 })` 直写——不再用 React Flow 的 d3 过渡（被打断永不结算 promise；extent 缓存 0×0 时插值出 NaN）；拒收非有限目标；store→flow 同步 effect 只在两边真不一致时才写，写前取消在飞动画；`healViewport` 用最后一份好视口恢复。
- `GenerationCanvasReactFlowViewport.onMoveEnd`：`isFiniteFlowViewport` 拒收 NaN 视口（不记、不回写）。
- `GenerationCanvasReactFlowNodes`：懒加载的节点渲染器包在节点自己的 `<Suspense fallback={轻量卡}>` 里——此前第一次建某种节点时整个 stage 被 React 藏 30ms（画布闪黑 + React Flow extent 缓存记成 0×0，走查 ~40% 随机空白的根因）。
- `useGenerationCanvasReactFlowHostEffects`：聚焦跳转也走调度器；还原直写前先取消在飞动画。
- `useCreatedNodeVisibilityPan.shouldRestoreAfterReveal`：露出过的卡被撤销、视口还停在落点 → 回到出发点（撤销对称；否则原卡被留在视口外）。
- `projectAgentDockCollapsed`（2026-09-06 用户拍板：**默认展开 + 记住上次开合**）：默认值本来就是展开，缺的是「记住」。
  这个开合的真相住在随项目落盘的 `editingPanelLayout.visibility.assistant`（`projectAgentDockCollapsed` 是它的投影），
  但落盘只由 `persistRevision` 变化触发，而布局的几个 action 一个都没 bump——用户收起的栏、拖出来的栏宽，
  下次开项目全复原，除非碰巧有别的改动顺手把它捎带存了。修在最早的共享边界：**凡真改到这份布局的 set 都同时 bump**
  （`editingPanelLayoutSlice` 的 `bumpPersist` + `setProjectAgentDockCollapsed`），不新造存储。

## 不动项

- perf 预算常数、`NON_DARWIN_TIMING_CALIBRATION`。
- benchmark 自己的 `findBlank` 扫描器（perf 仪器，多余的 mouse.move 会扰动计时；CI 证据里它驱动的场景全绿）。

## 验收门

- 本机：`canvas-drag-pan-gestures` 连续多次 48/48、`canvas-card-stack` 绿（常驻面板展开）；探针序列里 video 卡 x 位移到位（`-232`）；建卡后不再出现整片空白。
- 单测：`agentDockPersistence.test.ts`（默认展开 / 切换写进落盘物并 bump / 无改动不 bump / 回读还原）、`viewportTargetTracker.test.ts`、`useComposerVisibilityPan.test.ts`、`useCreatedNodeVisibilityPan.test.ts`（含撤销回位规则）、`generationCanvasReactFlowAdapter.test.ts`（`isFiniteFlowViewport`）。
- CI：#488 三条红 job 转绿；`check:root-cause-contracts` 过。

## 回滚

单 PR 整体 revert；持久化 schema 不变（`editingPanelLayout` 早已在 projectRecord 里），只是改动它的 action 现在会触发既有的防抖回存。`outputs/canvas-card-stack-20260827/` 截图随走查再生成。
