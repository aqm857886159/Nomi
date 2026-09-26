# Core payment and task identity repair

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Baseline: dfca9990b. Scope: K1-K3 of Core A. No paid calls, real projects, authoring migration, push or merge.

Reuse reviewed payment-only deltas b39333729 and 883f6904b. Existing prior art: docs/research/2026-09-18-storyboard-single-ledger/prior-art.md and docs/plan/2026-09-18-tool-layer-prior-art-verdict.md. Keep ProductionRun CAS, immutable events and submission outbox as owners.

Red baseline: real generation adapter selected 3 but projected 33; all four invalid scopes resolved; dismissal persisted cancelled. Six failures, no missing APIs, 2026-09-19 20:57 local. Command: python3 scripts/with-gates-lock.py -- pnpm exec vitest run electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts -t 'reliability: scoped'.

Next: displayed quote CAS for close and subset confirmation; typed domain task references and trusted absence; safe errors; candidate reference host isolation. Focused red/green tests, typecheck and root-cause contracts before scoped commits. Integration owns final gates and candidate package. Rollback uses scoped commits; no stored data migration.

## Payment verification

## Task identity verification

K3 baseline: three focused tests failed on actual cancellation preparation and provider-code assertions. The fix removes all cross-domain probing: callers copy domain/jobId from taskRef; raw legacy IDs return task_reference_required with refresh instructions and zero writes. Creation, generation reads, export creation/reads and canvas projections produce taskRef. Explicit domain routing tests include colliding raw IDs and export permission failure. Owners issue typed absence; unknown provider errors expose stable codes without raw text, and generation failures instruct reconciliation before repayment. A draft reports not_started.

Six affected identity/schema/advice/export suites: 67 tests initially passed plus one fixture used an invalid legacy tool name; after correcting the fixture to the existing get_production_run API its four tests passed. Four owner/projection adjacent suites passed 57 tests. Latest focused generation failure/payment regression slice passed five tests; error-surface and typecheck passed. No live provider, package or GUI screenshots were used for these assertions.

2026-09-19: C09 red slice added to the reused implementation. Old close returned discarded for a stale quote; subset confirm returned spend_confirmed after an unseen prompt change during present. Both tests executed and failed on their target assertion (exit 1, 49 ms test duration). Following the fix, the four core payment suites passed 50 tests (exit 0, 25.95 s), including both C09 tests, 33-to-3, later batches, unknown submission and confirmation races. Eighteen adjacent suites passed 183 tests (exit 0, 2.36 s). typecheck and check:root-cause-contracts passed (48 checker tests).

Tests used only temporary projects and controlled loopback HTTP; no provider billing proof. The first sandboxed broad run was stopped after the loopback tests stalled; the focused rerun outside the sandbox completed. C08 full renderer reopen, C19 explicit delete/Undo, final installed package and live supplier tests remain for integration acceptance.

## 先查别人

本节是已复用设计与源码边界的补充索引，不将支付回归扩大为重建执行系统。

- [单一账本 prior art](../research/2026-09-18-storyboard-single-ledger/prior-art.md) 已整理 Run 单一 owner 与幂等修改的依据；付款草稿继续引用原 Run，不另存可写方案。
- [ProductionRun repository](../../electron/productionRun/productionRunRepository.ts) 在共享执行边界做 revision CAS；关闭和确认必须绑定已展示的报价版本，不能由当前 UI 状态替换。
- [桌面 production bridge](../../src/desktop/productionRunBridgeTypes.ts) 已把 pendingSpend 定义为只读价格投影，confirmSpend/discardSpend 显式携带 quoteId，确认还传 shotIds。
- [productionActionIpc](../../electron/productionRun/productionActionIpc.ts) 将 project/operation/quote/scope 传给原能力 owner；沿用现有命令通路，不增第二个扣费授权入口。

结论：沿用 Run、共享报价契约和既有执行通路，修复作用域、CAS 和任务身份。不新增外部调研，不以受控测试声称真实供应商扣费已验证。
