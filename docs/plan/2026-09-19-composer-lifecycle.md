# T7 composer lifecycle repair

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Baseline: 883f6904b; branch codex/reliability-composer-20260919.

Keep the approved canvas summary and panel parameter chips, original write-access providers, React Flow renderer and anchored placement. Prior art: docs/research/2026-09-10-node-composer-placement/prior-art.md; locked NodeToolbar 12.11.5 lacks measured flip/clamp.

1. Parent controls history open; node identity/type/selection/result availability invalidate it.
2. Existing WeakMap holds unique gesture tokens per exact stage. Begin returns idempotent release; all producers release/cancel on lost capture, cancel, blur, readonly, hidden, deletion and unmount. Commit remains a separate permission-checked operation.
3. Existing placement recovers from zero dimensions and clamps full-stage anchors into usable viewport.
4. Existing lazy boundary gains opt-in local retry plus visible composer pending/error state; route reload behavior remains unchanged.

Red before production: lease stage isolation/late release, history lifecycle, readonly/cancel cleanup, zero geometry and failed import local retry. Focused tests through with-gates-lock; root owns two-host live Electron acceptance. No paid calls, real projects, lane/diagnostic/shell edits, NodeToolbar replacement, timers that clear state or z-index patches.

Rollback: revert scoped commit; transient changes require no data migration. Contract: docs/fixes/2026-09-19-composer-lifecycle.root-cause.json.

## Parent-owned follow-up: reference isolation

Read-only inspection found that the existing panel drop/@ paths bypass NodeWriteAccess: useNodeAssetDrop calls addAssetUrlToNode; useNodeMentionSource calls store.connectNodes/updateNode. Parent explicitly assigned the reference contract fix to root after T7. Do not disable reference capability as a fix. The intended owner must inject card-local media-reference writes while canvas retains graph connection behavior.

Machine door map: docs/fixes/2026-09-19-composer-panel-reference-doors.json. Reproduction: `python3 scripts/with-gates-lock.py --command 'node tests/ux/composer-panel-reference-isolation.red.mjs'`. This is a deliberately failing standalone probe, excluded from automatic test suites. Its browser store is synthetic, every canvas writer is an observation counter, and no project/provider call is performed. T7 must not be described as proving all panel editing isolation.

## 先查别人

本节于集成收口时补齐已有调查的可核查索引，不声称重新完成外部研究。

- 既有定位调查：[2026-09-10 prior art](../research/2026-09-10-node-composer-placement/prior-art.md) 已比较 React Flow NodeToolbar 与 Floating UI；本轮只复用锚点定位和恢复生命周期，不替换定位框架。
- 既有单一账本调查：[2026-09-18 prior art](../research/2026-09-18-storyboard-single-ledger/prior-art.md) 支持视图从唯一 owner 派生；参数面板临时状态不成为方案或执行数据的第二个 owner。
- 仓库共享手势 owner：[canvasDraggingFlag.ts](../../src/workbench/generationCanvas/components/canvasDraggingFlag.ts) 以原始 stage 和独立 token 管理 lease，统一释放 blur、pointercancel、lostpointercapture，不新增计时清理器。
- 仓库共享加载边界：[chunkBoundary.tsx](../../src/ui/chunkBoundary.tsx) 提供显式 local recovery；保留路由原有 reload 行为，由 composer 宿主选择局部重试。

结论：沿用共享 owner 和现有依赖。新网络、自媒体研究未执行；完整 Electron 两宿主交互证据仍由集成验收提供。
