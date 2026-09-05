# 常驻 Agent 面板压窄画布后：走查取点复验 + 自动让位合成

> 状态：✅ 已交付（本分支）· 2026-09-05 · 起因：PR #488 把常驻 Agent 面板默认展开，1600 窗口下画布 stage 从 ~1540px 压到 1200px，Canvas Acceptance 两个 shard 与 Canvas Performance 一起红。
> 教训沉淀：[`docs/lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md`](../lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md)；根因合同：[`docs/fixes/2026-09-05-canvas-walkthrough-stage-width.root-cause.json`](../fixes/2026-09-05-canvas-walkthrough-stage-width.root-cause.json)。

## 范围

**走查层（三条 CI 红的直接原因，全是量具）**

- `tests/ux/_canvasPoints.mjs`（新）：`findBlankCanvasPoint` 扫描 + 真实鼠标到位复验；`clickEdgeHitPath` 沿 path 取样只点最上层；`MARQUEE_STAGE_MARGIN_PX = 40 + 8`（React Flow 框选 autoPan 带）；`CANVAS_BLANK_EXCLUSIONS` 并集（含 `.react-flow__node` 壳）。
- 删掉 7 份私有 `findBlankPoint`（gestures / s5 / shortcuts / context-menu-click / node-context-menu / image-sharpness 脚本）与 clip-node-editing 的内联取点，全部改走共用模块；card-stack 两处连线点击改 `clickEdgeHitPath`。
- `canvas-drag-pan-gestures`：框选起终点避开 autoPan 带；新增断言「新建的节点完整落在 stage 内」。
- `canvas-performance-benchmark` wheel-zoom：DOM 身份基线挪到第一格放大态之后量（视口裁剪 ≠ 整层重建）。**预算未动**。

**产品层（走查顺手挖出的 #488 自身缺陷：新卡落在 Agent 面板底下、视口不动）**

- `useCreatedNodeVisibilityPan`：待执行的露出跨渲染保活（原先挂在 effect cleanup，store 回写 size 一重渲染就取消）。
- `viewportTargetTracker`（新）：视口「正在去的目标」登记处，带过期；`useComposerVisibilityPan` / `useCreatedNodeVisibilityPan` 都从它出发算增量（`composeComposerPanTarget`）。
- `GenerationCanvasReactFlow`：`animateViewportTo` 改走我们自己的 `createViewportAnimationCoordinator`，逐帧 `flow.setViewport(…, { duration: 0 })` 直写——不再用 React Flow 的 d3 过渡（被打断永不结算 promise；extent 缓存 0×0 时插值出 NaN）；拒收非有限目标；store→flow 同步 effect 只在两边真不一致时才写，写前取消在飞动画；`healViewport` 用最后一份好视口恢复。
- `GenerationCanvasReactFlowViewport.onMoveEnd`：`isFiniteFlowViewport` 拒收 NaN 视口（不记、不回写）。
- `GenerationCanvasReactFlowNodes`：懒加载的节点渲染器包在节点自己的 `<Suspense fallback={轻量卡}>` 里——此前第一次建某种节点时整个 stage 被 React 藏 30ms（画布闪黑 + React Flow extent 缓存记成 0×0，走查 ~40% 随机空白的根因）。
- `useGenerationCanvasReactFlowHostEffects`：聚焦跳转也走调度器；还原直写前先取消在飞动画。
- `useCreatedNodeVisibilityPan.shouldRestoreAfterReveal`：露出过的卡被撤销、视口还停在落点 → 回到出发点（撤销对称；否则原卡被留在视口外）。

## 不动项

- `projectAgentDockCollapsed` 默认值（常驻面板默认展开 / 收起）——产品决定，留给用户拍板；本分支两种默认下走查都应绿。
- perf 预算常数、`NON_DARWIN_TIMING_CALIBRATION`。
- benchmark 自己的 `findBlank` 扫描器（perf 仪器，多余的 mouse.move 会扰动计时；CI 证据里它驱动的场景全绿）。

## 验收门

- 本机：`canvas-drag-pan-gestures` / `canvas-card-stack` 在常驻面板展开下绿；探针序列里 video 卡 x 位移到位（`-232`）。
- 单测：`tests/ux/_canvasPoints.test.mjs`、`viewportTargetTracker.test.ts`、`useComposerVisibilityPan.test.ts`、`useCreatedNodeVisibilityPan.test.ts`（含撤销回位规则）、`generationCanvasReactFlowAdapter.test.ts`（`isFiniteFlowViewport`）。
- CI：#488 三条红 job 转绿；`check:root-cause-contracts` 过。

## 回滚

单 PR 整体 revert；无持久化数据变化。`outputs/canvas-card-stack-20260827/` 截图随走查再生成。
