# Agent Runtime 源码研究对账 — 2026-08-22

状态：`research-only`。本文件是对 PR 文档的事实摘要，不是新的执行计划，也不授予任何运行时权限。

## 证据来源

- PR 文档：外部提交 `5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb:docs/guide/agent-runtime-source-reading-and-adaptation.md`（本 worktree 不复制为执行入口）
- 固定提交：`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`
- 研究范围：Codex 外部控制面、Pi Agent loop、Pi Harness 设计/实现边界。
- 规则：实现阶段只能引用固定提交和具体 file/line；不可跟随 `main`、分支或未审的 Harness 文档。
- 研究文档中的上游 Codex/Pi 链接若仍指向 `main`，只算未验证线索；在实现前必须补上游 immutable SHA/file:line，或明确不作为实现依据。

当前可用的 immutable source anchors（仅支撑研究事实，不是 Nomi 代码依赖）：

| 项目 | 固定提交 | 文件/范围 |
|---|---|---|
| Pi Agent loop | `f4585b8bec581d005cbb1edfc07edfcce723d0ae` | `packages/agent/src/agent-loop.ts` L155–275, L411–425, L600–668 |
| Pi tool/extension contract | `f4585b8bec581d005cbb1edfc07edfcce723d0ae` | `packages/agent/src/types.ts` L385–409; `packages/coding-agent/src/core/extensions/types.ts` L446–498 |
| Codex turn loop | `ab8768306ffdc06f7abf83e76070aaa17dd06bcc` | `codex-rs/core/src/session/turn.rs` L139–588 |
| Codex tool router/dynamic tools | `ab8768306ffdc06f7abf83e76070aaa17dd06bcc` | `codex-rs/core/src/tools/router.rs` L68–; `codex-rs/core/src/tools/handlers/dynamic.rs` L32–248 |

若某一链接无法在固定提交解析，相关结论降级为 `unverified`，不得进入
P3 implementation gate。

特别说明：PR 原文引用的 Pi `harness-v2.md` / `harness-v2-state-machine.md`
在固定 Pi 提交中不是可解析路径；可解析的文档是
`packages/agent/docs/harness.md`，但尚未完成逐行审计。因此 Harness 的
durability/phase-order 结论暂记 `unverified`，不能用来提前实现
`operation/start`。同理，未附 immutable commit/file:line 的 Claude Code、
Hermes、DeepSeek 结论只保留为背景线索，不参与 P3 放行。

PR 原文的 Phase 1 顺序仍把 `operation/start/read/events` 放在 durability
之前，并省略 `operation/create → operation/plan → request_generation_gate →
HumanApprovalReceipt → decide(receipt)`；这与本文件的 E0/E1 约束相反。该图和
所有 `blob/main` 上游链接均为 non-normative research，不能被 worker 当作施工
入口或权限依据。

## 可吸收的事实

| 来源语义 | Nomi 适配层 | 所有权边界 |
|---|---|---|
| Codex 的 Session/Turn/Item、snapshot + event stream | External E0/E1 的 session、operation、event **投影** | `ProjectLease`、`ProductionRun`、RunEvent/WAL 仍是唯一事实源 |
| Pi loop 的 tool batch、before/after hook、steering、错误结束事件 | 未来 `AgentLoopPort`（P4/P6） | 不得直接写 Run、Asset、Timeline 或预算 |
| Pi Harness 的 accepted→intent→effect→settlement、checkpoint、recovery | 复用现有 intent log、RuntimeEnvelope、outbox、materialization receipt、resume | 不新建 Operation DB、EventStore、lane store |
| Codex 的 interrupt/steer 生命周期 | E1 的 typed `nomi_cancel_generation` / seal 前 candidate revision | 不得杀进程、改 sealed contract 或把 unknown 伪装成 cancelled |

## 明确不吸收

1. 不把 `ExternalAgentSession`、`NomiOperation`、`NomiEvent` 做成第二持久化事实源。
2. 不允许 `operation/start` 绕过 `request_gate → human receipt → decide(receipt) → reservation → envelope → grant → outbox`。
3. 不接受 host 提交 `estimatedCost`、providerTaskId、grant、approved 或 `trust:'trusted'`。
4. 不把 Pi Harness 的文档/脚手架当成已交付 durability；必须先通过 shipped code/test audit。
5. 不在 P3 引入 Editor MCP/Timeline Apply；这属于 P5，内部 Pi adapter 属于 P4/P6。

## E0/E1 约束

### E0（P3 前，零额度）

别名只通过现有 MCP `tools/call`/Capability Core dispatcher（GUI/headless 同一路径）
路由，不新增未协商的 JSON-RPC 协议；静态 `tools/list` 不授予 stage/lease 权限。
P0/P2 checkpoint 前 write-like E0 调用统一返回 `phase_not_ready`；checkpoint 后
才可在零额度模式写 sealed contract + authorization-required job/gate，仍不得
reservation、grant、provider 或 Asset materialization；E1 等待 P3 checkpoint。

`session/open` 只建立经主进程验证的 ProjectLease；`context/read` 只调用
read-only context resolver（即使没有 runId 也不写 Run），`operation/create`
才创建/复用 deterministic draft Run，
`operation/plan` 则封存合同并原子创建现有 authorization-required
ProductionJob 与 `generation_submit` gate（仍不调用 provider、不花费）。
`plan/preview`、`operation/read`、`operation/events` 仍是只读投影。
`operationId` 是 correlation，必须一对一
绑定一个 `generation.single-shot` Run/shot/ProductionJob/RuntimeTask；不支持一个
operation 包含多个 Run，也不新建全局 lane。

snapshot 和 events 必须由同一 read boundary 返回
`{snapshot, snapshotCursor, events, nextCursor}`，cursor 复用 per-Run RunEvent；
事实提交前不能广播，`submission_unknown`/`needs_attention` 不能完成 operation。

### E1（P3 checkpoint 通过后）

`operation/start` 只能是 canonical `nomi_start_generation({runId, contractHash})`，
并验证 fresh lease、已消费 HumanApprovalReceipt、gate target、reservation、
prepared envelope、一次 bound grant 和 Run-owned outbox claim；provider path 只能是
`generationRuntimeAdapter`。

`operation/interrupt` 只能映射显式 cancel/reconcile；`operation/steer` 只允许
seal 前 candidate CAS。创建 human challenge 即 seal；gate pending、receipt
consumed、provider submitted、unknown 或恢复中均拒绝改合同，必须新建
draft/gate，不能修改 in-flight challenge。

## 进入实现前的证据门

- [ ] 研究提交和 source URL/file:line 已固定到 PhaseEvidence。
- [ ] PR 文档引用的上游 Codex/Pi 文件已逐一换成 immutable commit/file:line，未完成时不得作为实现依据。
- [ ] E0 alias schema、operation correlation、snapshot+cursor 原子读取测试存在。
- [ ] E1 receipt/lease/start/steer/interrupt/reconcile 对抗测试存在。
- [ ] 真实 zero-credit MCP journey、重连、unknown、重开 Artifact 有日志/截图/输入 hash。
- [ ] 六角色与对抗 verdict 写入同一 PhaseEvidence；任一 P0 为 blocked/needs_attention 时不放行 provider/Pi 代码。
