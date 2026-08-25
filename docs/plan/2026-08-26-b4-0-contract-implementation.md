# B4-0 契约期实现记录（2026-08-26）

本期只落 domain contract，不接 runtime，不改变任何生产写入或读取行为。

## 真相源与边界

- `electron/harness/domain/contracts.ts` 是 Nomi 自有 `Thread` / `Turn` / `Item`、`ApprovalDecision`、`PolicyDecision`、最新事件 envelope 与关联键的唯一类型/校验源。
- `electron/harness/domain/upcast.ts` 是纯内存 `v1 -> v2` adapter。它保留 `id`/`ts` 兼容字段，同时提供 `eventId`/`occurredAt`；旧 JSONL、sidecar、ProductionRun、intent log 均不回写。
- `runId` 兼容当前 ProductionRun 的 `run-*` / `op-*` 标识；`txnId` 由事务协调器以 `txn-*` 或 `txn_*` 形式铸造，`proposalId` 保留既有短标识。`causeId` 只能引用父事件 `evt_*`，不能由 UI 自行生成。
- 新 correlation record 的落点仍按计划默认留给旁路 sidecar；B4-0 不扩展 Run metadata。

## 旧事件 fixture 的 runId 结论

| 旧事件类型 | 结论 |
| --- | --- |
| `vendor.call.requested`, `vendor.call.cached`, `vendor.call.completed` | 可从 payload.runId 无歧义提取；缺失或格式非法分别报告 `runId.missing` / `runId.invalid`。 |
| `agent.turn.started`, `agent.turn.finished`, `agent.tool.proposed`, `agent.tool.completed`, `agent.proposal.approved`, `agent.proposal.rejected`, `agent.turn.error`, `agent.gate.denied`, `agent.txn.committed`, `agent.txn.aborted`, `agent.txn.reverted` | 旧 payload 没有登记的结构化 runId，保持空；不猜，并报告 `runId.unavailable`。 |
| `context.capped`, `memory.fact.added`, `memory.fact.corrected`, `memory.fact.removed`, `memory.fact.user-added`, `review.technical.completed` | 旧 payload 没有登记的结构化 runId，保持空；不猜，并报告 `runId.unavailable`。 |
| 未知类型（fixture: `future.event`） | 即使 payload 带 `runId` 也不提取，保留为 `opaque` Item，并报告 `runId.unregistered`。 |

## 自动化证据

- 先红后绿：实现文件不存在时 targeted Vitest 两个 suite 均因模块缺失失败；补实现后 `contracts.test.ts` + `upcast.test.ts` 共 27 条通过。
- 契约测试覆盖 union 分支、非法状态运行时拒绝、审批/策略判决字段、四键铸造规则、未知事件保留、sidecarRef payload 保持、重复 upcast 幂等和坏输入 fail-closed。
- `pnpm run check:test-types` 通过；contract 目录无 Electron、React、AI SDK、MCP、ProductionRun、capabilityCore 或 fs import。
