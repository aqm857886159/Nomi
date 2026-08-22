# MCP generation phase evidence — 2026-08-22

状态：`blocked`（P0 policy skeleton + docs；未授权任何 provider/paid/runtime code）。

## Baseline

证据工作树：`/Users/aoqimin/Desktop/Nomi-p0-runtime-20260822`（与共享脏工作树隔离）。

```text
code baseline (historical): origin/main @ ae53045bb094ca1db0cb6aefe1fa7a7e0baa6b07
plan/doc baseline before hardening (historical): c98308eb5b1f0c44f94b4673c1bf778416fd6992
pnpm run typecheck: PASS
pnpm run test: PASS — 659 passed, 1 skipped; 5938 passed, 1 skipped
pnpm run check:filesize: PASS
pnpm run check:tokens: PASS
pnpm run check:i18n: PASS
pnpm run lint:ci: PASS — 0 errors, 96 pre-existing warnings (within 98-warning ratchet)
pnpm run build: PASS
```

## P0 implementation snapshot

```text
implementation branch: codex/p0-runtime-foundation-20260822
implementation baseline: origin/main @ ae53045bb094ca1db0cb6aefe1fa7a7e0baa6b07
policy owner: electron/capabilityCore/mcpGenerationPolicy.ts
policy test: pnpm exec vitest run electron/capabilityCore/mcpGenerationPolicy.test.ts — PASS (7 passed)
policy typecheck: pnpm run typecheck — PASS
policy lint: targeted eslint — PASS (Node emitted only the repository's existing module-type warning)
full gates: pnpm run gates — PASS (660 files passed, 1 skipped; 5945 tests passed, 1 skipped; 96 pre-existing lint warnings)
provider calls: 0
paid/runtime writes: 0
```

## Continued P0 boundary hardening — 2026-08-23

The policy-only skeleton was followed by a zero-provider/zero-credit boundary
slice. It does not authorize generation; it makes the unsafe paths observable
and fail closed before they can reach a service, spend grant, renderer
generation call, or provider:

```text
reviewed HEAD: cf9880ed (codex/p0-runtime-foundation-20260822)
implementation commits: 0e6a323a, 4694e88b, 7e2b9359, 484ec38a, cb38bb5e, 567b1fb8, a4417b03, cf9880ed
policy/dispatcher/renderer focused suites: PASS — 123 tests before final recovery-test adjustment
final full gates: PASS — 664 files passed, 1 skipped; 6017 tests passed, 1 skipped
lint: PASS — 0 errors, 96 pre-existing warnings (within 98-warning ratchet)
typecheck: PASS
build: PASS
provider calls: 0
spend grants/materialization: 0
```

The slice now has one shared `generationBindingGuard` marker owner used by the
main dispatcher and renderer bridge. It recursively scans JSON-shaped legacy
payloads with an explicit depth cap and rejects canonical execution/operation
bindings (including nested `params`, runtime-envelope and provider namespace
markers) as `legacy_path_forbidden` before service/grant/provider work. Semantic
route stubs consult the immutable generation policy and return typed
`feature_disabled`/`phase_not_ready`/`not_ready` errors without a write owner.
RPC and MCP stdio preserve the policy error fields (`code`, `nextAction`,
`phase`, `capability`) into the structured tool outcome.
The same policy error envelope is now preserved by the one-shot host/RPC
transport; ordinary untyped errors retain their legacy string wire shape.

`ProductionRunService.readProjection` and the repository read path are now
strictly read-only: corrupt or stale snapshots are rebuilt in memory without
backup, rewrite, or directory mutation. Restart recovery is explicit through
`resumeUnfinishedRuns`; the existing restart test was updated to exercise that
explicit command rather than relying on a read side effect.

The policy and boundary slice is intentionally not a P0 pass by itself. It is
the single flag/phase decision owner plus a fail-closed dispatcher/read seam;
durable receipt/lease/WAL, provider idempotency, provider recovery, runtime
envelope, projection and materialization work remain blocked behind later
checkpoints. No semantic route has a write owner in this slice.

## Continued P0 durable foundation — 2026-08-23

The approved A/A/A safety policy is now represented by zero-provider foundation
modules, still behind the blocked semantic phase and with no default paid-path
wiring:

```text
reviewed HEAD: 6ecb6a82 (codex/p0-runtime-foundation-20260822)
implementation commits added: 099d9649, 6ecb6a82
durable foundation focused suites: PASS — 25 tests
full gates: PASS — 669 files passed, 1 skipped; 6038 tests passed, 1 skipped; 0 lint errors, 96 pre-existing warnings
provider calls: 0
spend grants/materialization: 0
```

`productionRunIntentLog` appends authenticated, checksummed prepare/commit/
abort records with a hash chain, strict parse/MAC failure, fencing epoch and
side-effect-free replay. `productionRunLock` provides an exclusive per-run
lease with persistent monotonically increasing fencing epochs; an expired or
lost owner cannot renew, release or continue a claim. The optional
`submissionOutbox` integration persists a provider-submit claim before dispatch
and makes restart after a lost receipt reconcile-only; only the explicit
`SubmissionNotDispatchedError` disposition opens a same-key retry.

`projectLease`/`projectLeaseStore` now issue and verify signed project-selection
and project-scope leases across restart, expiry, scope mismatch, tampering and
revocation. `approvalReceipt` persists challenge/receipt records, rejects raw
boolean or external elicitation approval, requires a signed main-process
gesture attestation, and makes receipt consumption one-time with replay of the
original result.

At this checkpoint these modules were intentionally not yet connected to the
semantic dispatcher, production gate/reducer, runtime envelope or real provider
adapter. The next slice below records the first safe wiring step; the durable
foundation alone remained blocked until that step and the fake-provider
lifecycle were proven.

The following hashes identify the reviewed docs snapshot for this record (the
evidence file itself is intentionally excluded to avoid a self-referential
hash). They are the current docs-only review input, not an implementation pass:

```text
6da4e8c00361d61e805771286b146d3a1f78a68998f235905e9fe20491ed136d  docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md
8eb633d0d3d79b55c74a357c80e79d30d98cf877d05a9090718a85179d6dce7c  docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md
dfb6903d5c56077b3844f78031a62077066a785e5832bf297850be2be8da138e  docs/superpowers/specs/2026-08-22-unified-runtime-mcp-generation-design.md
955aa4265593008f0413bf0035cb9bcd2fe047c122e2f9c3b1281adc2ef6d916  docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md
d879a43c73c0559b0bc4b09c4f6173659b089b9a50fdd63ad1f89a99790988ed  docs/audit/2026-08-22-agent-runtime-source-review.md
faafc75e5bc8f4cb777961fd1a942fa022c9794a824e89b8c512093df520b7c0  docs/plan/2026-06-11-nomi-harness-master-plan.md
939372aa2a16787caea39a0ef28797eae25b304cbfeca316352804d4937adad2  docs/workflow/2026-06-13-agent-and-eval-primer.md
```

## Continued P0 semantic lease/receipt wiring — 2026-08-23

The approved A/A/A policy is now enforced at the semantic boundary, still with
zero provider and paid-path activity.

Evidence: reviewed HEAD 22e592ce on
codex/p0-runtime-foundation-20260822; focused lease/receipt/service suites
passed 45 tests; full gates passed 669 files (1 skipped) and 6042 tests (1
skipped), with 0 lint errors and 96 pre-existing warnings. Provider calls,
spend grants and materialization remained 0.

nomi_session_open now accepts only a main-process verified
ProjectSelectionHandleV1, resolves current project/session identity through a
server-owned callback, and returns the signed ProjectLeaseV1 projection.
Every post-open semantic route verifies the lease and required scope before its
owner seam; the lease project identity replaces any body-supplied projectId.
Tampering, expiry, revocation, foreign project and insufficient scope return
structured lease errors. RPC, app integration and in-process MCP stdio expose
the same optional authority injection points.

nomi_decide_generation_gate requires a verified, scope-bound receipt and
rejects approved, confirm and spendConfirmed booleans as proof. The dispatcher
only verifies; ProductionRunService consumes the receipt after the durable gate
event, leaving replay semantics with the Run owner. Receipt bindings now resolve
the current project revision through the injected project owner; an unavailable
or stale revision fails closed rather than trusting command-supplied metadata.
New workspace manifests
record an immutable project UUID and generation for future selection-handle
resolution; old manifests remain readable but are not implicitly upgraded by
ordinary reads.

This is still not a P0 pass. The live app has not yet supplied a production
project-selection resolver/keyring, semantic write owners remain not_ready, and
no runtime envelope or real provider adapter is wired. The remaining
zero-provider proof is the fake-provider prepare → submit → providerTaskId
persist → restart/reconcile lifecycle, followed by the explicit P0 checkpoint
review.

## P0 blockers recorded before code

- `runtime.runTask` 的 async cache 进程重启后不可直接恢复。
- legacy driver 仍可能走 `production.generate-node → arrange → export`。
- `submissionOutbox` 尚未自动成为 P3 dispatcher。
- ProductionJob/Gate/Approval/Artifact/DispatchContext 尚未具备本切片所需的完整 binding、target、lease、provenance 字段。
- 旧 `nomi_generate` 是付费且可写 Canvas 的兼容路径，不能被描述成 read-only。
- P0 design review initially found missing human-receipt, provider-reconcile,
  lease/draft-key, recovery-branch and deterministic-materialization seams;
  those blockers were added to the canonical plan before implementation.

## Checkpoint records (authoritative current gate)

| checkpoint | static design verdict | implementation/evidence verdict | status |
|---|---|---|---|
| P0 architecture | ATTENTION | BLOCKED | blocks P1 |
| P2 compiler | ATTENTION | BLOCKED | blocks P3 |
| P3 MCP single-shot | BLOCKED | BLOCKED | blocks P4/P5 |
| final | BLOCKED | BLOCKED | release gate |

## Current P0 gate

`P0` is `blocked`, not `passed`: the policy/dispatcher firewall and pure-read
boundary are implemented and fully gated, but the receipt, lease, WAL,
provider idempotency/reconcile, runtime-envelope, recovery and materialization
owners are not implemented. No paid provider path is authorized by this
evidence. A static `ATTENTION` is never promoted to an implementation pass
without code, adversarial tests and a reproducible reviewed-tree snapshot.

## Evidence rules

每个阶段追加 commit SHA、输入/合同 hash、命令与退出码、真实 MCP 事件、截图/媒体、成本 receipt、已知风险和 rollbackRef。mock-only 结果不能写成媒体完成；任何 P0/P1、重复扣费、跨项目写入、stale approval 接受或无法恢复的 Artifact 都把 verdict 置为 `blocked`。

## Codex/Pi research integration

研究来源已固定为 PR 文档提交
`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`；本地事实摘要为
`docs/audit/2026-08-22-agent-runtime-source-review.md`。该研究被归一为
External E0/E1 薄适配：P0/P2 checkpoint 前 E0 只读/草稿/preview/events；通过后
E0 的 `operation/plan` 可在零额度模式持久化 sealed contract + pending
authorization-required job/gate，但不 reservation/provider/spend；E1 在 P3 checkpoint
通过后才 alias 到已有 typed Nomi tools。研究文档本身不成为第二执行计划，旧 external
control-plane 草案已标为 `superseded`。

## Six-role checkpoint — source integration (docs-only)

本轮由独立子 agent 复核四份 canonical 文档、PR 研究提交和 origin/main 代码。
`ATTENTION` 表示静态设计方向可采纳但证据未闭合；`BLOCKED` 表示不能放行实现。

| 角色 | verdict | 关键证据/放行条件 |
|---|---|---|
| CTO | ATTENTION | 单 Runtime/Run/Asset owner 与 E0/E1 one-to-one 方向成立；alias 请求与事件 type→data 约束已写入 canonical，但仍需把 `operationId`→Run intent/correlation、atomic snapshot/cursor 和 operation index 落到同一 owner。 |
| PM | ATTENTION | “一次预览→一次真人确认→后台生成”路径清楚；尚无用户可见 preview/成本/nextAction 样张和真实零额度旅程证据。 |
| 设计 | BLOCKED | 没有 MCP→Nomi 面板→剪辑区的连续控制面样张，也没有 waiting/unknown/reconnect/stale/proposal 视觉走查。 |
| 前端 | BLOCKED | 当前 MCP 仍是静态 tools/list；wire alias、snapshot+cursor projection、断线状态和真实 Electron 入口测试尚未实现。 |
| 后端 | BLOCKED | 基线仍缺 durable receipt/lease/WAL/provider idempotency/materialization；E0 atomic read service 和 E1 state guards 只有文档。 |
| 真实用户 | BLOCKED | 尚无真实 external MCP host 从 context 到 Artifact、重连、unknown、重开和成本 receipt 的可复核证据。 |

**Checkpoint verdict：`blocked`。** 只允许继续做无副作用的 schema/policy/test
skeleton；禁止 provider submit、Asset materialization、ProductionRun paid write 或
Pi adapter，直到 P0 六角色和对抗证据达到 `passed`。

## Adversarial checkpoint — source integration

| 攻击面 | verdict | 现状与最小闭合测试 |
|---|---|---|
| 伪造/重放 HumanApprovalReceipt | BLOCKED | 基线 `mcpStdioServer.ts:81-89`、`rpcServer.ts:109-142` 仍有 transport `spendConfirmed`/pre-approved 旁路，grant 仍进程内；需主进程 durable issuer、一次性 consume、wrong humanActor/project/expiry/replay/crash tests。 |
| forged/过期/跨项目 ProjectLease | BLOCKED | `rpcServer.ts:94-105`/`host.ts:60-75` 目前只验 machine bearer/origin，DispatchContext 尚无 lease；需 signed project-selection root、共享 lease store、safe-id、revocation、跨 GUI/stdio/restart scope tests。 |
| global bearer + arbitrary project selection | BLOCKED | lease issuer/root-of-trust 尚未实现；必须要求主进程/GUI signed project-selection handle 或 project ACL，不能只信 projectId/path。 |
| leasePrincipal 冒充 humanActor | BLOCKED | receipt/lease 身份边界尚未实跑；需 GUI gesture/renderer attestation、跨 session handoff 和伪造 IPC 测试。 |
| duplicate provider submit / unknown | BLOCKED | outbox/cache 仍有 process-local 行为；需 Run intents WAL、provider idempotency/query/reconcile、crash-after-accept raw-submit=1 test。 |
| legacy driver/enum 旁路 | BLOCKED | 旧 `production.start`/`driveGeneration`/arrange/export 仍存在；需 playbook 分流、legacy enum filter、restart/read spy。 |
| malicious Skill/host system prompt | BLOCKED | 现有缺失 Skill 可写 `version:"declared"`，allowlist 未接 live router；需正文 hash、system/instruction 拦截和恶意文本测试。 |
| WAL/power-loss/materialization | BLOCKED | malformed JSONL 会静默停读，随机 Asset 写入无 receipt；需 checksummed intent replay、crash matrix、deterministic materialization。 |
| operation/snapshot second truth source | BLOCKED | 旧草案曾允许多 Run operation/独立 EventStore；现已 superseded，但 E0 typed projection/cursor race tests 尚无。 |
| internal resume authority exposure | BLOCKED | recovery 必须由主进程 pinned worker 调用；外部 reconcile 仍需 fresh lease/binding，需 direct IPC/stdio bypass test。 |
| steer/interrupt race | BLOCKED | E1 规则已写明，尚无 gate-pending/seal/provider-submit/unknown/restart 状态矩阵和 durable cancel/reconcile tests。 |
| receiptId/handoff/channel proof race | BLOCKED | canonical 已补 ReceiptV1/HandoffV1 字段，但主进程 lookup、recipient proof、一次性 CAS 与同 scope host 并发消费尚无实现/测试。 |
| immutable project generation/key namespace | BLOCKED | 文档已要求 UUID/generation 进入 lease、operation、provider、materialization key；baseline 没有 registry/root-fd/TOCTOU 实现。 |
| direct legacy control/decide-gate bypass | BLOCKED | `production.control`、`production.decide-gate`、旧 MCP/IPC routes 仍可达；需统一 `legacy_path_forbidden` resolver 与 direct tools/call/IPC tests。 |
| provider callback identity/conflict | BLOCKED | canonical 要求 sealed namespace + payload/result fingerprint conflict CAS；baseline 无 provider/account callback verifier。 |
| SkillEvidenceV1 provenance | BLOCKED | canonical 已要求 immutable registry snapshot/body-section/prompt hashes；legacy env/user-root loader 与 `version:"declared"` 仍存在。 |
| read/migration side effects | BLOCKED | canonical 已改为 maintenance-only migration；baseline read/list/recovery 会重写或驱动 legacy，需 pure-read/crash fixtures。 |
| phase/effectiveScope + gate authority | BLOCKED | `gate_request/gate_decide` 现在明确为 E1/P3 scope；Artifact/adopt 明确为 P5 后置，但 resolver/projection 代码和 expiry/reopen tests 尚不存在。 |
| wire/version/legacy normalization | BLOCKED | 四文已要求同一 V1 registry、`nomi_operation_read` canonical、旧 `nomi_get_generation`/direct control 禁止旁路；catalog/dispatcher/IPC 尚未实现同源校验。 |
| provider request/callback namespace | BLOCKED | closed request/callback 已绑定 moduleRef、account/profile/tenant/endpoint/fingerprint；adapter、auth verifier、foreign/callback-conflict tests 尚不存在。 |

**Adversarial verdict：`blocked`。** 以上是实现安全闸，不是可用 mock 或静态文档
声明替代的检查项。

**Scope correction:** Task 5 now verifies only the P3 Artifact projection and
proposal-ready provenance. `nomi_get_artifact` and
`nomi_propose_adopt_artifact` remain P5 static names; no AdoptProposal or
Canvas/Timeline mutation is part of this checkpoint.
