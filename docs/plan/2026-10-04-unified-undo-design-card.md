# 统一撤销设计卡

改动名：3D-BOX 段 U 统一撤销　线/负责人：`feat/agent-canvas-undo`　类别：其他

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 写入画布或时间轴后，我可以把结果里的 `changeId` 交给 `undo`；⌘Z 与它共用画布会话日志。真实任务是「创建一个画布节点后说撤销」「改镜头提示词后说撤销」「时间轴剪辑后说撤销」；不撤销花钱/导出；同一对象之后被改过时拒绝并说明。 | `docs/plan/2026-10-04-director-3dbox-phase3.md` §5/§10 U；真实 Agent 回合待运行 |
| ★2 谁说了算 | `changeId` 由 `electron/shared/agentCapabilities/changeId.ts` 统一定义；画布撤销历史唯一 owner 是 `src/workbench/generationCanvas/events/canvasUndoJournal.ts`；时间轴状态 owner 仍是 `timelineCapabilityTarget`。消费者是 Agent `undo`、⌘Z、已有画布撤销按钮。 | `node scripts/door-map.mjs undo`；canvas write target / timeline write target |
| ★3 一致与复用 | 复用现有 proposal receipt、画布会话日志和时间轴 undo 栈；不新建第二本画布历史。共享 changeId 只做身份协议。 | `git grep -n "canvasUndoJournal\|timelineUndoStack\|undoToken" src electron` |
| ★4 全状态 | 空：没有可撤 changeId；加载：沿用现有写入回执；成功：返回 `changeId` 且显示已撤销；失败：返回可读 `undo_conflict` / `undo_change_not_found`；部分/取消/过期：保留现有写入错误并不产生 changeId。zh/en 文案沿用能力错误面。 | 现有能力结果 schema、`surfacePortBinding` |
| ★9 验收与回滚 | 先跑 focused red/green、重算模型面基线、`check:root-cause-contracts` 与相关 gates；回滚为 revert 本分支提交，旧 `undoToken` MCP 兼容映射保留。 | `pnpm exec tsx scripts/check-model-face-frozen.mjs --update-baseline`；`pnpm run check:model-face-frozen`；`pnpm run check:root-cause-contracts` |
