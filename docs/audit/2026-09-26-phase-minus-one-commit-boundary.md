# Phase -1 提交边界与恢复账本

> 状态：✅ 审计产物完成；耐久提交尚未实现（迁移放行：**PARTIAL/BLOCKED**）
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。

## 当前真实写序列

`productionRunRepository.executeUnlocked` 当前大致按以下顺序工作：

1. 读取 event journal，按 `commandId` 做幂等回读，并按 `expectedRevision` 做 CAS。
2. `approval.record` 追加 approval；`budget.entry` 读取并追加 budget ledger。
3. reducer 计算下一份 `ProductionRun` 和 event。
4. 追加 event journal。
5. 追加 command index。
6. 原子写 snapshot。

Run lock、event journal、snapshot checksum、command idempotency 和 revision conflict 已存在；但 approval、budget、event、command index、snapshot 之间没有一个共同的 `commitId`/commit marker 来表达“这一条 command 的所有副作用已齐”。这不是本阶段直接修复的生产 bug，而是 Phase 1 的阻断前置。

## 已存在的可复用 primitive

| primitive | 代码 | 已证明的语义 | 还缺什么 |
|---|---|---|---|
| intent log | `electron/productionRun/productionRunIntentLog.ts` | `prepared/committed/aborted`、`seq/prevHash/fencingEpoch/MAC`、key/payload hash | 把 Run command、approval/budget/artifact side-ledger 绑定到同一 commit marker |
| submission outbox | `electron/productionRun/submissionOutbox.ts` | intent claim、provider dispatch、`submission_unknown`、reconcile-only、provider-safe release | 证明 direct canvas paid path 不再绕过这条语义 |
| runtime envelope | `electron/productionRun/productionRunRuntimeEnvelope.ts` | sealed、provider accepted、submitted unknown、materialized、provider task id/raw receipt | 与 direct canvas task identity 的迁移绑定 |
| event/rebuild | `productionRunRepository.ts` | journal replay、snapshot rebuild、command replay | approval/budget side-ledger 的 commit 级重放关系 |
| artifact replay | `productionGenerationSubmission.ts`、`generationOutputMaterializer.ts`、`productionRunReducer.ts` | receipt → asset → `artifact.add` → ready，按 job/contentHash 幂等 | 证明文件已落盘但 artifact event 缺失时的 repair 证据 |

## Phase 1 选定的提交协议（设计提案，尚未由故障注入证明）

```text
prepare intent(commitId, commandId, expectedRevision, payloadHash, fencingEpoch)
  → append domain event(commitId)
  → append approval/budget/artifact side-ledger entries(commitId)
  → append command index(commitId)
  → write snapshot(snapshotCursor, commitId, checksum)
  → re-read/hash/revision verify
  → commit intent
```

派发 provider 的 remote/paid write 必须在这个协议之外再经过 submission outbox；provider 回执不能由“函数返回”代替。下面的恢复动作是 Phase 1 的目标协议，不是本阶段已经完成的 crash-injection 证明：

| 故障点 | 只能得出的事实 | 恢复结果 |
|---|---|---|
| intent prepared，无 event、无出站证据 | 本地 command 未提交 | abort；provider-safe reservation 可释放 |
| event 有，side-ledger/index/snapshot 缺 | domain fact 已存在，副本不完整 | 按 commitId 补副本；补不上进入 repair |
| provider 可能已收到，回执缺失 | submission unknown | 只 reconcile，不自动重提 |
| artifact 文件有，`artifact.add` 缺 | 文件存在但产品事实不完整 | 按 receipt/contentHash 进行 repair；无法匹配则隔离 |
| snapshot 损坏，journal 完整 | snapshot 非真相源 | 丢弃 snapshot，journal rebuild |

## Phase -1 结论

提交边界的现状已核实，已有 primitive 足够支持后续实现；当前不能宣称 durable commit 已经完成，恢复表仍是设计提案。Phase 1 的第一条实现任务必须把上述 commit marker 和 side-ledger replay 落成代码，并用 crash injection、冷重启和 repair probe 证明，再允许迁移直画布 remote/paid candidate。
