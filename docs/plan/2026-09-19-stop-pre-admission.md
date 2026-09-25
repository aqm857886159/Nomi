# Stop covers pending input admission

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现，验证中。

The user presses Stop to end this conversation's work. Inputs already waiting for catalog, configuration, readiness or skill preparation must not restart it afterwards.

Scope: renderer existing admission token; IPC configuration wait; workspace readiness; host input/skill/unlock preparation and pi acceptance. Keep pi 0.85.1, its queues/abort, existing session identity, current T5/T6 authority fixes and normal initialization/model-reopen waiting. No new reducer or execution queue.

Prior art: installed pi-agent-core 0.85.1 `harness/context.d.ts:1–6` exposes `withCancel`, `withAbortSignal`, `awaitWithContext`; chord `dist/context/index.js:54–98` combines native AbortSignals and cancels only a waiter. pi `harness/runtime/lane.js:313` accept and `:1086` steer/followUp already take Context. Reuse these public facilities. Do not race-cancel the actual acceptance acknowledgement: once pi commits it, pi owns recovery.

Workspace owns the main pre-admission cancellation scope. IPC captures its signal before existing configuration serialization; workspace execute inherits it across awaitReady; host combines it with its own scope for native direct callers. Stop cancels synchronously before awaiting and creates a new scope for subsequent inputs. Close cancels without admitting further work. Renderer owns only unsent input through existing admissionId and issuing address.

Evidence before implementation: `/tmp/nomi-recovery-stop-independent.log` (live hook fails), `/tmp/nomi-stop-preparation-native-review.log` (two real pi/local HTTP failures). Repository tests additionally exercise configuring and waiting IPC inputs, same-session model readiness, Stop then new input, stale visible Stop/new token safety.

Rollback: revert only the F12 incremental commit after the temporary T5/T6 baseline. Acceptance: original three failures become green; cancelled inputs preserve draft; new inputs after Stop succeed; existing IPC/client/workspace/native suites remain green. Tests run under with-gates-lock. Real Electron/paid model are outside this isolated implementation proof.

## 先查别人

本节补齐已有源码调查索引；不新建模型运行队列或取消协议。

- [已有单一账本调查](../research/2026-09-18-storyboard-single-ledger/prior-art.md) 支持派生视图与唯一执行 owner 分离；本轮同样不让 renderer admission 成为第二份已接受任务队列。
- [laneInputAdmission.mts](../../electron/agentLane/laneInputAdmission.mts) 直接复用已安装 pi 的 withCancel/withAbortSignal；cancel 终止准备期 context 并创建下一份输入的 context，已接受执行仍归 pi。
- [Stop 根因合同](../fixes/2026-09-19-stop-pre-admission.root-cause.json) 已列 workspace、host、IPC 和 renderer 入口及 regression tests，区分取消未准入等待与已分派 ACK 的归属。
- [已有输入重放合同](../fixes/2026-09-19-original-input-replay.root-cause.json) 规定从原始 branch input 解析技能和附件，不从可见文本重建；Stop 的草稿恢复沿用同一输入身份。

结论：复用 SDK cancellation context 与现有 admission token，不重复实现 pi 队列。无新增网络研究；真实 Electron 与平台验收单独报告。
