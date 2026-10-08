# Pending spend presentation epoch 设计卡

改动名：待决付费卡绑定 durable presentation identity。负责人：Nomi production-run 线。类别：花钱、长跑、可打断。

### 功能分类

- [x] Agent 行为
- [x] 花钱
- [x] 长跑 / 可打断
- [x] 大数据量 / 画布 / 长列表
- [ ] 新界面 / 改交互
- [ ] 生成效果
- [ ] 数据格式

| 格 | 结论 | 对上的实现与测试证据 |
|---|---|---|
| 1 用户怎么用 | 用户让 Agent 规划一次可能收费的生成，在确认前切换审批模式、编辑计划、关闭并重启窗口，回来仍看到同一张待决卡；确认、改价、丢弃和取消只作用于这张卡。 | `tests/ux/agent-spend-card.walk.mjs`、`tests/ux/agent-panel-missing-card.walk.mjs`；桌面卡行为由 `electron/capabilityCore/appIntegrationSpendConfirm.ts` 统一处理。 |
| 2 谁说了算 | production run 的 `GenerationPresentation` 是唯一事实源；创建时写入 `presentationId`、单调 `presentationEpoch` 和 policy snapshot，renderer 只投影它。 | `electron/productionRun/productionGenerationPresentationEdits.ts`、`electron/productionRun/productionPendingSpend.ts`；`productionGenerationPresentation.test.ts` 覆盖 owner 与重启读取。 |
| 3 一致性与复用 | 所有展示计划都走 presentation 写入边界，所有待决卡动作都走同一个 identity guard；不再让进程内 policy bus 重算旧卡。 | `node scripts/door-map.mjs presentGenerationPlan`、`node scripts/door-map.mjs assertPendingSpendIdentity`；旧 `policySpendDecision.ts` 已删除。 |
| 4 全状态 | 空、加载、可确认、确认失败、过期、拒绝、丢弃、取消和能力不可用都有明确结果；过期动作 fail closed，投影异常保留 identity 并显示错误卡。 | `electron/productionRun/productionPendingSpend.test.ts`、`src/workbench/ai/v4/useAgentPanelSpendConfirm.test.ts`、`electron/agentLane/laneDesktopSpend.test.ts`。 |
| 5 中途表 | 关闭窗口、断网、切换审批模式、重复点击和重启都复读持久化 presentation；已经存在的卡不因 live policy 改写，旧 epoch 的延迟动作不扣费。 | 两个真实 Electron walk；`electron/productionRun/productionPendingSpend.test.ts` 的 stale identity 与 legacy normalization 用例。 |
| 6 外部数据与失败 | provider 返回慢、失败或旧数据时，transport 只传递 operation/presentation identity；未知 legacy 数据先确定性 normalize，无法投影时显示可继续处理的错误状态。 | `electron/capabilityCore/generationTransportAdapters.ts`、`electron/capabilityCore/mcpGenerationTools.ts`；focused Vitest 覆盖失败与兼容路径。 |
| 7 性能预算 | 只增加一次持久化 presentation 写入和一次 identity 比对，不引入轮询或新的长循环；33-shot 走查仍完成。 | `tests/ux/agent-spend-card.walk.mjs` 的 33-shot 任务；`productionGenerationOperationStore.ts` 复用已有 run 事件流。 |
| 8 真实条件 | 已在 Windows Electron、中文和英文 UI、最小窗口与重启路径走查；真实 provider 付费调用未启用，记录为 unverified，不以 mock 代替。 | V-pendingspend 报告 `C:/Users/23732/AppData/Local/Temp/claude/C--Users-23732-Nomi--claude-worktrees-nomi-3dbox-handoff-f14c77/9e162ba9-e005-4f70-b2c9-71447802d367/scratchpad/V-pendingspend.md`；walk 输出与 escape ledger。 |
| 9 验收与回滚 | 独立验收线 V-pendingspend 对照本卡逐格复核；根因合同和改过的四个 regression test 必须绿。若需回滚，revert 本次本地提交并保留旧卡行为证据，不切换到另一套 fallback。 | `node scripts/check-root-cause-contracts.mjs`、`pnpm exec vitest run electron/productionRun/productionPendingSpend.test.ts electron/shared/productionGenerationPresentation.test.ts electron/agentLane/laneDesktopSpend.test.ts src/workbench/ai/v4/useAgentPanelSpendConfirm.test.ts`；验收报告见上。 |

### 设计边界

本卡只定义待决付费卡的身份与生命周期，不改变供应商价格、真实扣费额度或 provider 商业规则。没有真实 provider 额度的项目保持 `unverified`，由独立验收线在有条件时复核。
