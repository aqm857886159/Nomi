# Runtime ownership ADR — 2026-08-22

状态：P0 实施前决策；仅约束本次 MCP AI generation single-shot，不改变旧入口语义。

## 决策

| 对象 | 唯一事实源 | 本切片允许的变化 |
|---|---|---|
| `ProductionContract` | Run/job-set 的业务、预算与审批 envelope | 增加与 `ExecutionContract` 的 hash/gate 关联 |
| `ExecutionContract` | 一次操作/一镜的编译执行描述 | 新增纯编译器、能力快照、field ledger、fingerprint |
| `ProductionRun` | durable events、gates、jobs、outbox、reconcile | 增加 typed binding、runtime envelope 与 schema-v2 migration |
| `ProductionJob` / `RuntimeTask` | 现有任务与 provider-neutral 执行边界 | 不新建 `GenerationJob` 表；补 `executionBinding` |
| Asset store | asset identity、bytes、materialization、lease/privacy | 输入 snapshot 记录 version/stateId/contentHash |
| Runtime envelope / materialization | ProductionRun sidecar + existing Asset store deterministic sink | 不允许 adapter 另写随机 UUID asset 或只存进程内 task cache |
| Canvas / Timeline | 用户项目事实与投影 | P3 只登记 proposal-ready provenance，不生成 AdoptProposal 或自动写入 |
| MCP / GUI / Nomi Agent | transport、planning、projection | 共用 service、lease、gate、receipt；不维护第二状态 |

## 强制不变量

1. 付费/外部提交前必须有 hash-pinned `ExecutionContract`、项目 lease、有效 `generation_submit` gate 和预算 reservation。
2. P3 `generation.single-shot` 的 cardinality 固定为一个 provider job、一个 materialized artifact，destination 固定为 `project_asset`。
3. `generationRuntimeAdapter` 是 P3 唯一 provider path；不得进入旧 `productionRunDriverOps` 的 arrange/export 分支。
4. `ExecutionBinding` 在 reducer、repository、IPC 三层验证；不能依赖 TypeScript cast 或 MCP schema 单层保护。
5. providerTaskId/request envelope 必须在 polling 前持久化；`submission_unknown` 只能 reconcile，不能盲目重提。
6. Skill/Recipe/模块文本只能影响计划选择，不授予工具、预算、项目写入或导出权限。
7. 旧 `nomi_generate` 在本切片中仍是付费/Canvas-writing legacy compatibility route；新 feature flag 关闭时只关闭新语义入口，不改旧语义。
8. `generation_submit` 的 `HumanApprovalReceipt`（旧文档中的 `ApprovalReceipt` 别名）只能由主进程 approval-receipt owner 在验证 Nomi GUI/main-process user gesture（或预登记且可验证的 attested client）后铸造；MCP `elicitation/create` 只传输 challenge/结果，永远不能单独铸造 receipt。`leasePrincipal`、模型参数和 `approved: true` 都不是人审凭证。
9. `generation_submit.targetHash === ExecutionContract.contractHash`；旧 `planHash` 仅可作为 legacy projection，不能授权 P3。P3 gate 使用 `scope: 'budget_envelope'` 和不与 `gate-contract-v*` 冲突的 `gate-generation-single-shot-v1:` 前缀。
10. `HumanApprovalReceiptV1` 由主进程 approval-receipt owner 签发，格式绑定 `version/keyId/algorithm/issuer/receiptId/challengeId/handoffId/immutableProjectUuid/projectGeneration/revocationEpoch/projectId/runId/gateId/contractHash/targetHash/projectRevision/costScope/pricingSnapshotHash/humanActor/gestureAttestation/receiptNonce/audience/issuedAt/expiresAt/mac`；key 只在 app-owned keyring，gate/WAL owner 以 `(receiptId,receiptNonce)` CAS 一次消费。给真人看的 challenge projection 只含 `reservationPreview`，完整 challenge 绑定字段仍签名持久化；MCP/GUI 只能请求 challenge，不能提交 boolean spend confirmation。`gestureAttestation` 只能是 `GestureAttestationV1` 的闭集 union：其 signed/MACed bytes 必须包含 `decision:'accept'|'reject'`、`challengeId`、nonce、audience、时间窗和已登记 WebContents/frame/origin 或 client key；reject/timeout 永不铸 receipt。`humanActor` 由主进程派生，不能由 host 传入。
   `receiptId` 映射到带 MAC 的 durable record；消费还必须命中同一
   `HumanApprovalHandoffV1` 的 recipient/channel proof、project generation 与
   revocation epoch。其闭集格式固定为
   `{version,keyId,algorithm,issuer,handoffId,
   recipientBinding:{kind:'web_contents',webContentsId,frameId,origin}|{kind:'attested_client',clientId,keyId},
   recipientProof:{channelNonce,challengeHash,issuedAt,expiresAt,macOrSignature},
   challengeId,contractHash,targetHash,projectRevision,immutableProjectUuid,
   projectGeneration,revocationEpoch,audience,issuedAt,expiresAt,oneTimeNonce,mac}`；
   泄露的短句柄不能跨 transport 抢先消费。
   外部 MCP 的 `elicitation/create` confirm 不是 attestation；无 Nomi GUI/main-process
   user gesture（或登记的可验证 client）只能得到 `human_approval_required` handoff，
   不能消费 gate。
11. `ProjectLeaseV1` 由主进程 `projectLease.ts` 签发并写共享持久化 lease store；其身份包含 `version/keyId/algorithm/issuer/mac`、`projectId/immutableProjectUuid/projectGeneration/canonicalRootDigest/manifestDigest/audience/leasePrincipal/sessionId/connectionNonce/issuedAt/expiresAt/nonce/scopeSet/scopeHash/revocationEpoch`，不使用含义不明的 `signatureOrHandle`。密钥、project generation 与 revocation epoch 的权威记录在 app-owned keyring/app data，项目 `.nomi/leases` 只是带 MAC 的镜像/审计记录；每次 dispatch 做 no-follow realpath + manifest/generation CAS，stdio、GUI 和重启后的主进程从同一权威 store 验证。删除、恢复或复制项目文件不能复活旧 lease。draft key 与 `(immutableProjectUuid,projectGeneration,runId,contractHash,shotId)` 唯一索引由 ProductionRun 持久化并在跨进程锁下校验。`leasePrincipal` 只表示 scope 身份，不能冒充 `HumanApprovalReceipt.humanActor`。
12. P3 provider module 必须支持 `submitIdempotency/queryByTaskId/reconcile`；缺能力即 blocked。Runtime envelope 是 ProductionRun-owned sidecar，plan.submit 时 `envelopeState:'unprepared'`，receipt+reservation 后本地 prepare 原子 attach；submit/query/reconcile/cancel 全程绑定 provider/account/profile/tenant/endpoint/requestFingerprint/fencingEpoch，provider IDs/status/receipts 不进入 contractHash。唯一 `ProviderIdempotencyKeyV1` 必须是
`base64url(sha256('nomi.provider-idempotency.v1\0' + canonicalUtf8(tuple)))`，tuple 为
`{immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,moduleRef,providerId,accountId,profileId,tenantScope,endpoint,model}`；旧 `H(projectId,contractHash,shotId,moduleRef)` 和不含 runId 的 key 均拒绝。`ProviderTaskState` 只允许 `queued|submitted|running|succeeded|failed|cancelled|unknown`；callback 必须使用共享 `ProviderCallbackEnvelopeV1` 的 audience/auth.keyId/canonical-payload/nonce replay CAS，先验证完整 sealed namespace，再以 payload/result fingerprint 做冲突 CAS，不能把 foreign task 或不同结果当重复回调。
13. P3 只允许已审 image/video task kind 映射（`image_generation→image`、`text_to_video→video`、`image_to_video→video`）；`text`/arbitrary custom/multipart/process 不能绕过 spend grant。`generation.single-shot` 的 `creationEntry: 'generation.operation.create'` 只标记唯一 draft 创建命令，generic `production.start/createDraft`、`production.control`（含 resume/cancel）、`production.decide-gate`、`nomi_start_playbook` 和 `nomi_generate` 均返回 `legacy_path_forbidden`，不能创建或驱动 P3；`context/read` 仍是只读。

## External E0/E1 适配边界

Codex/Pi 源码研究只作为只读证据，固定提交与摘要见
`docs/audit/2026-08-22-agent-runtime-source-review.md`（source commit
`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`）。它不引入第二个 Session、Operation、
Event、Task 或 lane owner。

- **E0（P3 前、零额度）：** `session/open` 取得主进程签发的
  `ProjectLease`；`context/read` 通过只读 `nomi_get_generation_context` 获取
  context，绝不创建 Run。P0/P2 checkpoint 前所有 write-like 调用（包括
  `operation/create`）只返回 `phase_not_ready`/`feature_disabled`；checkpoint
  后 `operation/create` 才调用独立的 `createGenerationSingleShotDraft`
  适配器创建/复用 deterministic draft Run；`operation/plan` 调用 `nomi_submit_generation_plan`，封存合同并原子创建现有
  authorization-required `ProductionJob` 与 `generation_submit` gate，但仍不调用
  provider、不花费；`plan/preview`、`operation/read`、`operation/events` 只读。
  `initialize` 是唯一 MCP 握手；`nomi_session_open` 是其后的 typed tool，返回
  `protocolVersion:1,sessionId/leaseHandle/immutableProjectUuid/projectGeneration/projectId/expiresAt/
  audience/phase/effectiveScope/serverNonce`，并把连接
  绑定到一个不可重绑的 lease。`nomi_request_generation_gate` 与
  `nomi_decide_generation_gate` 属于同一 wire catalog，但在 E0 只返回
  `phase_not_ready`/`feature_disabled`，不得落 reservation 或 receipt。
  `serverNonce` 是每连接新生成的 256-bit 值，其不可导出的 `NonceBindingV1`
  MAC 绑定 selection-handle session nonce、lease nonce 与 transport id；lease
  过期/撤销或 project generation 变化时先关闭 session、返回
  `lease_invalid`/`project_scope_changed` 并把刷新 projection 的 scope 置空，
  不能把缓存 scope 当授权。
  `ExternalSessionProjectionV1` uses the shared closed variants
  `schema_only|e0_zero_credit|e1_paid|closed`; the `closed` variant carries
  `closeReason:'lease_invalid'|'project_scope_changed'|'expired'` and
  `effectiveScope:[]`, and is not callable. `effectiveScope` is phase-derived:
  `schema_only` exposes only
  `context/read/events`, `e0_zero_credit` adds `create/plan/preview`, and `e1_paid`
  adds `gate_request/gate_decide/start/cancel/reconcile/steer` to that same E0 set; before P0/P2 the effective phase stays
  `schema_only`, so `operation/create` is also `phase_not_ready` when the flag
  is on (or `feature_disabled` when it is off). `gate_request`/`gate_decide` are
  E1/P3-only effective scopes even though their typed schemas may be statically
  advertised; Artifact read/adopt tools are post-P5 and return `not_ready` before
  that later checkpoint.
- **E0 correlation：** `operationId` 只作为 intent/event correlation，持久绑定
  一个 `{immutableProjectUuid,projectGeneration,projectId,runId,contractHash?,shotId?,runtimeTaskId?,attempt?}`，严格一对一
  对应一个 P3 Run；不允许一个 operation 包含多个 Run，不建 Operation DB/EventStore。
  snapshot+events 必须由同一读边界返回，cursor 复用 per-Run `RunEvent.cursor`。
  这些别名只通过现有 MCP `tools/call`/Capability Core dispatcher 路由，不新增
  未协商的 JSON-RPC 协议；静态 `tools/list` 不授予 stage/lease 权限。
  alias request 必须按 alias 做 discriminated validation；projection 携带
  `projectRevision/status/nextAction`，event 必须带
  `ExternalEventBaseV1{eventId,cursor,runRevision,correlationId}`，并以
  `ExternalErrorCodeV1` 的单一闭集 registry 和 type→data discriminated 脱敏 schema
  输出，未绑定
  `operationRef` 的 RunEvent 不外露。
  The shared wire registry is authoritative: exact `nomi_*` names are normalized
  to semantic aliases only after `version:1` validation; raw slash names and old
  `nomi_get_run`/`nomi_control_run`/`production.*` names are compatibility-only
  and return `legacy_path_forbidden` when P3 fields are present. The registry and
  codecs are the same `ExternalOperationProjectionV1`/
  `ExternalEventProjectionV1`/`ExternalEventBaseV1`/`ExternalErrorCodeV1`
  definitions referenced by the English and Chinese plans; they are not a
  second schema.
  每个 post-open alias 固定 `version:1`、server-issued `leaseHandle` 和
  connection `serverNonce`；`session/open` 才接收 signed
  `projectSelectionHandle`。未知字段、foreign nonce、裸整数 cursor 或 E0
  携带 E1 字段一律拒绝；gate request/decision 是同一 wire catalog 的 typed
  calls，E0 只返回 `phase_not_ready`，不得回退到 legacy gate。
  P0/P2 checkpoint 前 write-like E0 调用返回 `phase_not_ready`；checkpoint 后
  才可在零额度模式写入 sealed contract + authorization-required job/gate，
  仍不得 reservation/grant/provider/Asset。E1 需等待 P3 checkpoint。
  `ResumeCapabilityV1` 只由主进程 scheduler 以 opaque `Symbol`/closure +
  `WeakMap` 持有，绑定 `immutableProjectUuid/projectGeneration/canonicalRootDigest/
  manifestDigest/runId/playbook/adapterDigest/fencingEpoch/audience/nonce/expiresAt/mac`；
  不是可从 IPC/MCP 构造的字符串 token，root/generation 变化只能进入
  `needs_attention`。每次 recovery attempt 只签发一个 capability；scheduler
  先以 `(immutableProjectUuid,projectGeneration,runId,fencingEpoch,nonce)` 做原子
  CAS 并推进 fencing epoch，完成后再次提交同一 CAS 并 retire capability。重复、
  迟到、过期或旧 epoch worker 只能得到 `needs_attention`，不能再次 poll、
  reconcile 或 materialize。
- **E1（P3 checkpoint 通过后）：** `operation/start` 只能 alias 到
  `nomi_start_generation({runId,contractHash})`，并验证 fresh lease、已消费
  `HumanApprovalReceipt`、gate target、reservation、prepared envelope、bound grant
  和 outbox claim；provider path 只能是 `generationRuntimeAdapter`。
  `operation/interrupt` 只能走 cancel/reconcile；`operation/steer` 只允许 seal 前
  candidate CAS；创建 human challenge 即 seal，gate-pending/receipt consumed/
  provider submitted/unknown/recovery 中不得改合同，必须新建 draft/gate。
- E0/E1 均复用 Run intent/WAL、RuntimeEnvelope、outbox、materialization receipt、
  resume 与 per-run lock/CAS；Pi `AgentLoopPort`、右侧 Agent parity、Editor MCP 和
  Timeline Apply 后置到 P4–P6。

## 命名边界

`GenerationJob` 只是产品语言，指现有 `ProductionJob` 与 runtime task 的组合；任何新增持久化 owner、第二 AssetRegistry、第二 Run 或第二 timeline store 都必须先提交新的 ownership ADR 和迁移/回滚证据。

## 迁移边界

`PRODUCTION_RUN_SCHEMA_VERSION` 从 1 升到 2 采用严格旧记录 reader、显式 maintenance migration command 和 fixture；普通 read/list/rebuild/startup 永远不 copy、backup、rewrite 或推进状态。保留原 event bytes 与 snapshot checksum，并写 migration receipt（当前 `RunEvent` 没有独立 hash 字段），半写 JSONL/截断 snapshot 必须产生 `migration_parse_error`，不能静默停在上一行。flag 关闭时 legacy 继续走 v1-compatible projection；旧 reader 不能读 v2 时，flag 不得启用，直到兼容 fixture 或恢复路径通过。已启动的 P3 Run 在 kill switch 后只允许 pinned adapter poll/reconcile/materialize，不允许新 submit。

## Durable intent / replay 顺序

ProductionRun 是跨文件 intent 的 owner；Run JSONL、budget ledger、runtime
envelope/outbox 和 asset materialization receipt 不各自决定业务状态。以下
记录使用 app-keyed MAC、`keyId/seq/prevHash/fencingEpoch/payloadHash` 和
durable key，按顺序回放且每步幂等；普通 checksum 不能作为信任根，文件与
父目录都必须 fsync：

```text
generation.submit.intent → approval.consume → reservation.bind
→ envelope.prepare → grant.consume → provider.submit
→ materialize.commit → artifact.add
```

崩溃恢复先重放 intent，再暴露 projection：provider 已可能受理但回执未
落盘时进入 `submission_unknown` 并 reconcile；只有 provider 明确
`definitely_not_submitted` 才能新 attempt。reservation/grant settle、release
或 unsettled 每个 attempt 只能发生一次；MAC/链序/epoch 不一致返回
`migration_parse_error`/`needs_attention` 且不得在 read 中修复；provider callback 先
按完整 sealed namespace（immutable project UUID/generation, run/contract, provider
account/profile/tenant/endpoint）定位，再以
`providerTaskId + requestFingerprint + state + attempt + fencingEpoch + payloadHash + resultFingerprint`
做 CAS；foreign task 或同 key 不同 payload 返回 `callback_conflict`，状态不得回退。
