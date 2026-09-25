# Core canvas ownership

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Repair K4/K6 on the current owner, without authoring format migration or new Agent write routes.

Prior art: `docs/research/2026-09-10-node-composer-placement/prior-art.md` and `docs/research/2026-09-18-storyboard-single-ledger/prior-art.md`. Retain existing React Flow placement and the project save queue; use existing canvas lifecycle identity to reject late writes.

1. Reuse only committed composer lifecycle delta 93ff9c20a, after behavior red tests against main. Preserve both parameter component hosts.
2. Capture document, explicit plan and loaded canvas before model lookup. Reject replaced content or projects; focus changes do not retarget pending writes.
3. Inspect creation launch separately from persisted Run-to-creation ownership. Do not patch the visibility gap by writing a second editable plan.
4. Make explicit deletion one existing journal operation, with project-scoped related content. Undo is session-only; reopening validates persisted state, not persistent undo history.

Validation: behavioral red-green tests, root cause/door contracts, type checks, real Electron click/hit/input and save/reopen fixtures. No paid calls or real projects. Rollback reverts scoped commits; no storage migration.

## 先查别人

本节补齐已有调查引用，不扩展作者态迁移或节点架构。

- [单一账本 prior art](../research/2026-09-18-storyboard-single-ledger/prior-art.md) 记录现有 Run 和派生分镜表；这里采用同一写入 owner，不能把 Run 再复制为可写 legacy 方案。
- [参数条定位 prior art](../research/2026-09-10-node-composer-placement/prior-art.md) 说明 NodeToolbar 与现有 clamp/flip 的能力差异；本轮保留定位适配器，仅做生命周期恢复。
- [Run 投影读取](../../src/workbench/creation/storyboard/useCreationRunPlans.ts) 以 projectId/sourceDocumentId 过滤、再按 runId 选中；无来源 Run 不归入当前文稿，界面焦点不成为异步写目标。
- [既有画布落地宿主](../../electron/productionRun/canvasLandingHost.ts) 通过持久 shot bindings 连接 Run 与节点；继续使用该边界，避免第二条节点生成流水线。

结论：修在已存在的目标身份和落地 owner，不另建账本或执行器。本轮未新增网络或自媒体检索。
