# Unified Runtime + Dynamic Modules + MCP Generation Design

> 状态：实施基线（2026-08-22）。用户已确认推进；中文架构入口已归一到 `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`，逐文件执行步骤见 `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`。本设计稿不再作为第二执行入口。

## 1. 目标与不做项

### 基线证据

本设计以 `origin/main` commit `ae53045bb094ca1db0cb6aefe1fa7a7e0baa6b07` 为代码基线。干净 sibling worktree 的基线结果为：

```text
pnpm run typecheck  ✅
pnpm run test       ✅ 659 test files / 5938 tests, 1 skipped
```

当前共享工作树的冲突和未跟踪文件不属于本设计的证据；实施时必须重新在自己的 sibling worktree 记录基线。

### 目标

把 Nomi 的 Agent/Production/MCP 接口收敛为一个可恢复的执行内核，并先交付一条真实、可验证的 MCP AI 生成闭环：

```text
MCP initialize
→ 读取项目/能力上下文
→ 动态提出一镜计划
→ 预检与一次审批
→ 提交一个 GenerationJob
→ 进度、取消、断线恢复、幂等对账
→ 本地 Artifact 与真实预览
→ 登记 Artifact + proposal-ready provenance（Adopt Proposal 为 P5 后置）
```

“做图”“做视频”“宣传片”不再是运行时硬编码的唯一流程。它们保留为可选 Recipe，给模型一组默认模块和参数；真正执行的路径由本次 `ExecutionContract` 冻结。

### 当前不做

- 不先迁移全量 `EditorDocument` 或 Timeline v2。
- 不先做完整 `brand.promo`、多镜头短剧、完整 NLE 或本地访谈剪辑。
- 不先接 Remotion/HyperFrames 的生产渲染器。
- 不把所有底层 provider API 暴露成 MCP 工具。
- 不允许 Skill、外部 Agent 或 widget 直接拥有花费、写时间轴、导出权限。
- 不让动态组合执行任意远程代码或未经注册的模块。

## 2. 关键决策

### 2.1 固定骨架，动态模块，冻结合同

固定的是不可跳过的宿主流程：

```text
ContextSnapshot
→ CapabilityCatalog
→ PlanCandidate
→ Preflight
→ TypedGate
→ ExecutionSnapshot
→ RuntimeTask / GenerationJob
→ Verify / Reconcile
→ Artifact
→ Adopt / Export decision
```

动态的是当前任务需要的模块、顺序、并行分支和参数。模型、Skill、用户输入和项目上下文只负责提出选择；在任何付费、外部提交或项目写入前，宿主把选择编译成不可变的 `ExecutionContract`。

因此本方案不是“没有 Workflow”，而是“不预先把每个用户任务写死成一条 Workflow”。每次运行都会产生一张受约束、可审计、可恢复的临时执行图。

### 2.2 五层对象边界

| 层 | 责任 | 明确不负责 |
|---|---|---|
| Runtime | 状态、事件、能力、权限、预算、恢复、幂等 | 具体审美和供应商参数 |
| Module | 一个有输入/输出/能力/副作用合同的语义能力 | 活跃项目状态的独立副本 |
| Skill | 方法、判断规则、Prompt/QA 指导，按需加载 | 权限、计费、写项目 |
| Recipe | 可替换的模块组合和默认参数 | 当前 Run 的事实和凭证 |
| Adapter | provider、资产传输、渲染器或 MCP transport 的翻译 | 第二套时间轴或第二套 Run |

模块 `kind` 使用闭集：`workflow | route | check | renderer | connector | knowledge`。首片只允许 Nomi registry 中已安装、已审核、已 hash 固定的模块。

### 2.3 现有对象不重复造真相源

现有 `ProductionContract` 继续表示一次 Production Run 的业务/预算/用户可审合同；新的 `ExecutionContract` 只表示一次操作或一镜的编译执行描述；Storyboard 只是它的一个 payload adapter，必要时保留 `StoryboardExecutionContract` 兼容别名。

```text
ProductionContract  = run / job-set / budget / approval envelope
ExecutionContract   = one operation/shot compiled execution binding
Storyboard payload  = story-specific input/output portion
ProductionRun       = durable orchestrator and event owner
RuntimeTask         = provider-neutral execution boundary
AssetRecord         = existing asset identity/provenance owner
MCP/UI/Canvas       = transport or projection, not truth source
```

本文中的 `GenerationJob` 是业务概念，不要求新增平行类型；首片优先复用现有 `ProductionJob`/`RuntimeTask`，只补 typed `executionBinding`。不得同时引入新的 `AssetRegistry`、`EditorDocument` 写入源来复制现有 Asset identity 或 Timeline 状态。若未来确实需要新类型，必须先给出 ownership ADR 和迁移测试。

当前 ownership 对账：

| 现有边界 | 继续作为 owner | 本设计只增加 |
|---|---|---|
| `electron/runtime.ts` | provider-neutral `TaskRequest`/`runTask` 执行边界 | module/task envelope、fingerprint、reconcile hook |
| `electron/productionRun/` | durable Run、预算、gate、事件、outbox、恢复 | `executionBinding` 和 contract 关联 |
| `electron/capabilityCore/` | MCP dispatcher、tool projection、host transport | stage-aware tool exposure、typed output |
| `electron/assets/projectAssetStore.ts` + transport store | Asset identity、local materialization、lease/privacy | contract 输入版本和 provenance binding |
| `electron/workspace/workspaceRepository.ts` | project document revision increment and persistence | projects wrapper exposes CAS/read API to contract/gate/proposal |
| Canvas/Timeline | 当前项目事实和用户可见投影 | P5 的 Proposal adapter，不先迁移 owner |

任何新模块都必须引用这些 owner，不能在模块内部保存第二份项目、Run 或资产状态。

## 3. 合同设计

### 3.1 ModuleManifest

```ts
type ModuleManifest = {
  id: string
  kind: 'workflow' | 'route' | 'check' | 'renderer' | 'connector' | 'knowledge'
  version: string
  contentHash: string
  inputs: ArtifactContract[]
  outputs: ArtifactContract[]
  requiredCapabilities: CapabilityExpr[]
  allowedTools: string[]
  allowedCommands: string[]
  validatorRefs: string[]
  executorRef: string
  executorDigest: string
  validatorDigests: string[]
  approvalPolicy: ApprovalPolicy
  sideEffectClass: 'read' | 'propose' | 'paid' | 'project_write' | 'publish'
  retryPolicy: RetryPolicy
  cachePolicy: 'bypass' | 'durable_hit_only'
  cardinality: { providerJobs: 1; artifacts: 1 }
  destination: 'project_asset'
  providerRecoveryCapabilities: Array<'submitIdempotency' | 'queryByTaskId' | 'reconcile' | 'cancel'>
}
```

`allowedTools` 是宿主注册表的上限，不是 Skill 文本中提到工具名的结果。`contentHash` 必须等于规范化 manifest（不含 hash 字段）的 SHA-256；`executorRef`、`validatorRefs`、`allowedTools` 和 `allowedCommands` 必须来自闭集注册表。模块缺失、hash 不一致、能力不满足或工具不存在时，编译失败且不得产生候选产物。
`executorDigest` 与 `validatorDigests` 也纳入 module snapshot；实现字节变化必须
改变 snapshot/contract hash。解析后的 provider profile/account scope 纳入
capability snapshot 与 request fingerprint，账户切换不能复用旧 idempotency key。

### 3.2 ExecutionContractV1

```ts
type ExecutionContractV1 = {
  contractVersion: 1
  contractId: string
  contractHash: string
  source: { kind: 'generation_context' | 'asset' | 'storyboard'; artifactId: string; version: number; hash: string }
  operation: { kind: 'image_generation' | 'text_to_video' | 'image_to_video'; shotId: string; module: { id: string; version: string; contentHash: string } }
  project: { projectId: string; immutableProjectUuid: string; projectGeneration: number; revision: number }
  moduleCatalogSnapshot: { catalogVersion: string; contentHash: string }
  inputs: {
    promptParts: PromptPart[]
    assetRefs: Array<{
      assetId: string
      role: string
      version: number
      stateId: string
      contentHash: string
      materializationStatus: 'available'
      required: boolean
    }>
    params: Record<string, unknown>
  }
  capabilitySnapshot: CapabilitySnapshot
  outputs: {
    artifactKinds: string[]
    destination: 'project_asset' | 'canvas' | 'timeline' | 'export'
    cardinality: { providerJobs: 1; artifacts: 1 }
  }
  policy: { gateKind: string; maxSpend: number; costScope: string; policySnapshotHash: string }
  execution: {
    requestFingerprint: string
    providerIdempotencyKey: string
    providerRecoveryCapabilities: string[]
  }
  skillEvidence: SkillEvidenceV1[]
  ledger: FieldLedgerEntry[]
  warnings: string[]
}
```

```ts
type SkillEvidenceCommonV1 = {
  registryRef: string
  version: string
  bodyHash: string
  registrySnapshotHash: string
  issuer: 'nomi-skill-resolver'
  keyId: string
  hashAlgorithm: 'sha256'
  sourceKind: 'builtin_registry'
  selectedSections: Array<{ startByte: number; endByte: number; hash: string }>
  stage: 'context' | 'plan' | 'provider' | 'materialize'
}
type SkillEvidenceV1 =
  | (SkillEvidenceCommonV1 & { state: 'discovered' })
  | (SkillEvidenceCommonV1 & { state: 'loaded'; inputHash: string })
  | (SkillEvidenceCommonV1 & { state: 'applied'; inputHash: string; promptAssemblyHash: string; outputArtifactIds?: string[] })
```

`ExecutionContract` 必须记录解析后的模块、Skill/body hash、能力快照、输入资产版本、provider 参数映射、丢弃字段和警告。运行中更新 Skill、模型目录或模块版本不会改变已经冻结的合同。首片只允许 `artifactKinds: image | video`，不接受 `model3d` 或任意未注册的 artifact kind。纯 prompt 的 source 是稳定 synthetic `generation_context`（artifactId=runId、version=1、hash=contextHash）；有参考图时由服务端解析 asset/storyboard source，host 不能自报 hash。

编译器先生成合同里的 envelope binding 描述；完整持久化 `RuntimeTaskEnvelope`（prepared request、requestFingerprint、idempotencyKey、providerId/accountId/profileId/tenantScope/endpoint/model、providerTaskId、recoveryAdapterId 和状态）只在真人 receipt + reservation 之后由本地 `prepare` 写入。`submit/query/reconcile/cancel` 必须携带同一 provider/account/profile/tenant/endpoint namespace、requestFingerprint 和 fencingEpoch；provider key 不能只用 project/contract/shot/module。`contractHash` 只覆盖不可变的 pre-submit 字段；gateId、approvalHash、runtimeTaskId、providerTaskId、状态和 receipt 另存为 mutable binding，不能反向改变已批准 hash。计划提交时 binding 的 `envelopeState` 为 `unprepared`、`runtimeEnvelopeHash` 为空。资产引用来自现有 Asset store 的 immutable content hash/stateId；MCP 的 project lease 来自主进程认证上下文，不由 host 参数自报。没有准备好的 envelope、资产 hash 或 lease 的候选不能进入 provider submit。

`RuntimeTaskEnvelope` 中的 `idempotencyKey` 只是旧字段名的兼容投影；P3
canonical 名称是 `providerIdempotencyKey`，两者必须字节相等，不能形成第二个
key domain。四份 canonical 文档共用
`ProviderIdempotencyKeyV1 = base64url(sha256('nomi.provider-idempotency.v1\\0' + canonicalUtf8(tuple)))`；
tuple 为 NFC/长度前缀规范化的
`{immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,
moduleRef,providerId,accountId,profileId,tenantScope,endpoint,model}`。旧
`H(projectId,contractHash,shotId,moduleRef)` 形状必须拒绝。

Any older envelope or WAL example that spells this field `idempotencyKey` is a
read-only compatibility projection and must equal `providerIdempotencyKey` byte
for byte; it is never an input to a new adapter or a second hash domain.

P3 operation kind→TaskRequest/billing 映射闭集为：`image_generation→image`、`text_to_video→video`、`image_to_video→video`。`text`、`custom`、multipart、process/script executor 或未审 executor 一律 blocked，不能借 image/video 名义绕过 grant、idempotency 或 materialization。

`ProviderTaskState` is the closed union
`'queued'|'submitted'|'running'|'succeeded'|'failed'|'cancelled'|'unknown'`;
state transitions are monotonic per attempt and `unknown` is never success.

Provider 的执行边界固定为
`PreparedProviderRequestV1{immutableProjectUuid,projectGeneration,projectId,runId,
contractHash,shotId,moduleRef,runtimeTaskId,providerId,accountId,profileId,tenantScope,endpoint,
model,requestFingerprint,providerIdempotencyKey,attempt,fencingEpoch,resolvedTaskRequest}`；
`resolvedTaskRequest` 是 server-derived `ResolvedTaskRequestV1` 闭集（无
`TaskRequest.extras`、custom/process/multipart/headers）。submit/query/reconcile/
cancel/result verification 必须复用同一 namespace。generic
`TaskRequest.extras`、active-project fallback、custom/process/multipart route、
403/404/405 hidden resubmit 和 process-local TTL cache 不能进入 sealed P3 path。

所有 callback/poll provider response 先经过同一 `verifyCallback` seam。闭式
`ProviderCallbackEnvelopeV1` 至少包含
`{version,audience:'nomi-provider-callback',auth:{kind:'hmac'|'signature',
algorithm,issuer,keyId,mac|signature},providerId,accountId,profileId,tenantScope,endpoint,model,
immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,
moduleRef,runtimeTaskId,providerTaskId,attempt,fencingEpoch,state:ProviderTaskState,
requestFingerprint,payloadHash,resultFingerprint?,issuedAt,expiresAt,nonce}`。
验证 auth、时间窗口、nonce、完整 namespace 和 canonical payload 后才查任务；
同 key 不同 payload/result 是 `callback_conflict`，foreign/stale callback 先拒绝。
The replay namespace includes `moduleRef` together with immutable project
identity, Run/contract/shot, provider/account/profile/tenant/endpoint and
providerTaskId; a callback cannot rely on providerTaskId alone.
auth 覆盖固定 canonical UTF-8 域
`nomi.provider-callback.v1\0` + version 至 nonce 的排序/长度前缀字段，包含
`auth.kind/algorithm/keyId/issuer`，只排除 `auth.mac` 或 `auth.signature` 的值本身；
auth.keyId 是唯一 key identity，nonce replay 先做 durable CAS，再查 providerTaskId。

`contractHash` 的 hash domain 是校验/规范化后的 immutable pre-submit object：source、operation（含 `shotId`）、module snapshot、resolved inputs/capabilities、output/cardinality、policy intent、skill evidence hashes。它排除 gate/approval/runtime/provider IDs、status、budget settlement、receipt 和 opaque grant。`requestFingerprint`/`runtimeEnvelopeHash` 是对同一份 canonical prepared `ResolvedTaskRequestV1` 的第二个 hash；dispatch 时临时注入 grant 的 `DispatchTaskRequestV1 = ResolvedTaskRequestV1 & { grantId: string }` 副本不落盘、不参与 hash。

`ExecutionBinding` 在 `generation.plan.submit` 时为
`envelopeState:'unprepared'`、`runtimeEnvelopeHash?: undefined`；它包含
`contractHash/shotId/moduleRef/inputAssetRefs(contentHash)/requestFingerprint/
providerIdempotencyKey/capabilitySnapshotHash/cardinality/destination`，以及由主进程
prepare 后附加的 `runtimeTaskId/runtimeEnvelopeRef/fencingEpoch`（这些字段不可由
host 提供，也不进入 `contractHash`）。真人 receipt
和 reservation 成功后，主进程本地 `prepare` 原子写入完整 envelope 并 attach
hash，再允许 grant/submit。服务端预分配的 `runtimeTaskId` 永远是 envelope
canonical key；`TaskResult.id`/providerTaskId 是独立 upstream fields。

合同 hash domain 还包含捕获的 module-catalog hash 与 `policySnapshotHash`；
任一目录或策略变化都必须创建新 draft，不能重新解释已批准合同。

prepared envelope 的物理 owner/path 是
`productionRunPaths(projectDir, runId).dir/jobs/<jobId>/envelope.json`；
`productionRunRuntimeEnvelope.ts` 负责 checksum、ACL 与 replay，不能退回
进程内 task cache。

### 3.3 PlanCandidate 与 Gate

外部 Host 或 Nomi 内部 Agent 可生成 `PlanCandidate`，但候选只能包含模块、参数、依赖和验收要求；不能携带 `estimatedCost`、`approved`、`providerTaskId`、`assetId` 或伪造质量 verdict。成本由 Nomi resolver 重新计算。

第一版 Gate 类型：

- `generation_plan_review`：审阅计划、模型、参考图、预估成本；
- `generation_submit`：批准一次付费/外部提交；
- `artifact_adopt`：批准把已验证 Artifact 提案写入项目；
- `export_publish`：后置，首片不实现。

每个 DecisionRecord 必须绑定 `immutableProjectUuid + projectGeneration + projectId + runId + gateKind + targetHash + projectRevision + pricingSnapshotHash + costScope + humanActor + receiptNonce + expiresAt`；请求侧另记录 `leasePrincipal`，两者不可互换。P3 的 `generation_submit` 映射现有 `scope: 'budget_envelope'`，且 reducer 在旧 gate-id hook 之前强制 `targetHash === contractHash`。重复相同决议返回原 receipt；不同项目代际、run、hash、nonce、pricing snapshot 或过期 receipt 一律拒绝。

Receipt 的可执行格式是主进程签发的 `HumanApprovalReceiptV1`：
`{version,keyId,algorithm,issuer,receiptId,challengeId,handoffId,immutableProjectUuid,
projectGeneration,revocationEpoch,projectId,runId,gateId,contractHash,targetHash,
projectRevision,costScope,pricingSnapshotHash,humanActor,gestureAttestation,
receiptNonce,audience,issuedAt,expiresAt,mac}`。签名/MAC key 只在
app-owned keyring；旧 key 只能验证历史 receipt。消费由 gate/WAL owner 以
`(receiptId,receiptNonce)` CAS 一次完成，issuer 不得在 transport 层隐式消费；缺少
handoff/audience、项目代际变化、撤销或重复消费均 fail-closed。

`GestureAttestationV1` is a closed union, not an arbitrary receipt field:
`{kind:'main_process_gesture',issuer:'nomi-main',keyId,challengeId,
decision:'accept'|'reject',webContentsId,frameId,origin,gestureNonce,issuedAt,expiresAt,mac}` or
`{kind:'registered_client_signature',issuer:'attested-client-registry',keyId,
clientId,challengeId,decision:'accept'|'reject',audience:'nomi-mcp',gestureNonce,issuedAt,expiresAt,signature}`.
The decision is covered by the signature/MAC; reject or timeout can never mint a
receipt.
The main process derives `humanActor` from the registered window/client session;
host actor names, booleans, renderer IDs, stale nonces and unknown kinds are
rejected before minting.

P3 只启用一个组合门 `generation_submit`（计划审阅 + 预算 + provider submit）；`artifact_adopt` 仍是后续剪辑区门。新门走统一 `gate.decide` 持久命令，不能触发旧 `productionRunDriverOps` 的 arrange/export。

`nomi_request_generation_gate` 是请求/编排入口：它读取已封存合同并创建
闭集 `HumanApprovalChallengeV1{version,challengeId,nonce,gateId,contractHash,
projectRevision,costScope,pricingSnapshotHash,reservationPreview,issuedAt,expiresAt,
immutableProjectUuid,projectGeneration,audience,mac}`；字段完整签名，只有
脱敏 `reservationPreview` 展示给真人。MCP `elicitation/create` 只负责展示/传输 challenge，
永远不能单独铸造 receipt。只有 Nomi GUI/main-process user gesture，或预登记且
可验证的 attested client 响应，才允许主进程签发 durable
`HumanApprovalReceipt`，随后 `nomi_decide_generation_gate({receiptId})` 只消费它。
主进程 `approvalReceipt.ts` 是唯一 issuer；一次性 consume 在 gate/WAL owner 内完成。
给真人看的 challenge projection 只有 `reservationPreview`（金额、币种、有效期）；完整
`HumanApprovalChallengeV1` 仍签名保存 gate/合同/项目代际等内部绑定字段，不提前创建 live
reservationId。lease 的 `leasePrincipal` 和工具参数中的 `approved` 不能替代真人
决定。GUI 接受可以来自不同 renderer/session，但必须携带主进程签发的 project-scoped
handoff handle 与 user-gesture attestation；最终 receipt 的 `humanActor`、nonce 与
target 仍由主进程验证，不能靠原 MCP session 放宽 scope。
外部 MCP 的 `elicitation/create` accept/confirm 只代表 transport response，不是人审凭证；P3 只有 Nomi GUI/main-process user gesture（或单独登记且可验证的 attested client）可以铸造 receipt。没有 attestation 时返回 `human_approval_required` + project-scoped handoff/deep link，不进入 `gate.decide`。

人审决定校验 challenge/handoff 的有效性，不会因为原 Host lease 在等待期间
过期而拒绝合法 receipt；新的 context/submit/start/adopt 仍需 fresh lease。
WAL/envelope 只保存按项目 ACL 保护的 prompt/asset refs 和 redacted request，
禁止 credentials、headers、opaque grant 或 provider secret 写入持久层。

跨文件一致性由 ProductionRun-owned replayable intent/WAL 负责，最小记录和恢复顺序固定为：

```text
generation.submit.intent   (candidate/contract/job/gate; replay idempotently)
approval.consume            (one-time receipt; replay returns same receipt)
reservation.bind            (budget reservation; duplicate bind is a no-op)
envelope.prepare            (local canonical request; no provider call)
grant.consume               (attempt claim; replay -> unknown until reconcile)
provider.submit             (outbox claim; only definitely_not_submitted may retry)
materialize.commit          (deterministic asset key; duplicate returns same asset)
artifact.add                (requires materialization receipt; late/duplicate callback ignored)
```

Each intent has a durable key, sequence link and app-owned MAC (`keyId`,
`prevHash`, `seq`, `fencingEpoch`, `payloadHash`, `mac`); a plain checksum is
not a trust boundary. The log and its parent directory are fsynced, and a bad
MAC, gap, duplicate commit or stale fencing owner becomes
`migration_parse_error`/`needs_attention` without silent truncation or repair
on a read. The outbox claim is not a process-local `inflight` map:
`provider.submit` is a typed intent in this same log with
`contractHash/requestFingerprint/providerIdempotencyKey/attempt/disposition` and its own
prepare/commit marker. Replay reconstructs the claim before any dispatch, so a
crash cannot turn a lost response into a second submit.
Recovery replays in order before
exposing the Run; a crash after provider acceptance becomes
`submission_unknown`/`needs_attention` and calls reconcile, never a blind
second submit. Reservation/grant settlement is released, settled or marked
unsettled exactly once.
The concrete log reuses `productionRunPaths(projectDir, runId).dir` and is
`path.join(productionRunPaths(projectDir, runId).dir, 'intents.ndjson')` (that
is, `.nomi/runs/<runId>/intents.ndjson`), owned by
`productionRunIntentLog.ts`;
records are prepare/commit/abort with payload hash, chain sequence, fencing
epoch and MAC. Side-file writes are never authoritative until the commit marker
is durable. Runtime envelopes, outbox claims and materialization receipts carry
the same intent/fencing/commit tuple; the Run reducer/WAL event remains the only
authority for status, providerTaskId and asset identity, and a conflicting
sidecar is quarantined rather than promoted.

### 3.4 Host planning 与 Skill provenance

当 Claude/Codex/WorkBuddy 等外部 Host 已经提供模型时，Nomi 先通过只读
`nomi_get_generation_context` 返回 schema、能力目录、已选资产摘要和限制，由
Host 生成 `PlanCandidate`；随后必须显式调用唯一写入口
`nomi_operation_create`，再调用 `nomi_submit_generation_plan`。context/read
本身不创建或复用 Run，也不接受 `createDraft` 模式。Host 不能提交批准、provider
task 或质量通过结果；断线时只保留已由 operation/create 创建的 draft，不会静默
切换到另一模型。P3 先验收外部 MCP；Nomi 右侧 Agent 的 parity adapter 在 P4
接入 `electron/ai/agentChatV2.ts`/同一 semantic dispatcher，禁止复制一套 provider/gate。

Skill 证据必须区分 `discovered`、`loaded`、`applied` 三态，且只能由 resolver
签发同一份闭集 `SkillEvidenceV1`（`registryRef,version,bodyHash,
registrySnapshotHash,issuer,keyId,hashAlgorithm,sourceKind,selectedSections,stage,
inputHash,promptAssemblyHash,outputArtifactIds`）；`stage` 仅允许
`context|plan|provider|materialize`，所有 section/body/字符串有大小上限。
host 不能提交路径、source、version 或 evidence，缺失 Skill 不得写
`version: "declared"`。P3 只允许 hash-pinned built-in Skill registry；
user-root/markdown fallback 不得成为 authority。实际 stage prompt 必须被截获
并与 body/section/prompt assembly hash 对账，恶意 Skill、网页或资产文本不能
扩张 module/tool allowlist。
`SkillEvidenceV1` 的 hash 算法固定为 `sha256` canonical UTF-8 bytes；registryRef
必须命中不可变 registry snapshot（`registrySnapshotHash`、issuer/keyId），每个
selected section 同时有有界 byte range/hash。`inputHash`、`promptAssemblyHash`、
`outputArtifactIds` 按 `loaded|applied|materialize` 阶段条件必填，env/cwd/user-root、
symlink、路径穿越、缺正文或未知字段 fail-closed，legacy loader 不能写
`version:'declared'`。最终 stage system/policy prompt 只能由 hash-pinned
module/Nomi resolver 组装；host 只能提供 user-level intent，host 的
`system`/`instruction` 文本永不进入最终 prompt。

四份 canonical 文档共用同一个 `SkillEvidenceV1`：除上述字段外固定
`bodyHash`、`registrySnapshotHash`、`issuer`、`keyId` 和
`selectedSections:Array<{startByte,endByte,hash}>`；`inputHash` 对 loaded/applied
必填，`promptAssemblyHash` 对 applied 必填，`outputArtifactIds` 对 materialize
必填。`contentHash` 只是旧投影名，不得成为第二 provenance schema。

`ProjectSelectionHandleV1` 由主进程/GUI picker 签发，固定为
`{version,keyId,algorithm:'HMAC-SHA256',issuer:'nomi-main',handleId,
immutableProjectUuid,projectGeneration,canonicalRootDigest,manifestDigest,
audience:'nomi-mcp',sessionNonce,issuedAt,expiresAt,revocationEpoch,scopeSet,mac}`。
`ProjectLease` 由主进程 `projectLease.ts` 签发并写入共享持久化 lease store
（app-owned keyring 中的 `LeaseV1`，含 `version/keyId/algorithm/issuer/mac`、
immutable identity、revocation 与 expiry），`host.ts` 只转发已认证 bootstrap，而
不是信任根。stdio、GUI 和重启后的主进程都通过同一 store 验证
`{version,keyId,algorithm,issuer,projectId,immutableProjectUuid,projectGeneration,
canonicalRootDigest,manifestDigest,audience,leasePrincipal,sessionId,nonce,connectionNonce,
issuedAt,expiresAt,revocationEpoch,scopeSet,scopeHash,mac}`；每次命令还要
no-follow realpath + manifest/generation CAS，过期、撤销、跨项目、路径替换或
scope 不匹配一律 fail-closed。appData/OS-keychain 中的 key ring、project
generation 与 revocation epoch 是唯一权威；`.nomi/leases/...` 只是带 MAC 的
镜像/审计记录，不能成为密钥或项目身份的来源，删除/恢复项目也不能复活旧
lease。项目 document revision 的真正递增 owner
是 `electron/workspace/workspaceRepository.ts`，projects wrapper 只提供
带 CAS 的读取/写入接口。

已获批准且已有 reservation/provider attempt 的 Run 在外部 lease 过期或
host 断线后，由 pinned `productionRunResume` 使用 Run-owned internal
authority 继续 poll/reconcile/materialize；新的 context/submit/start/adopt
仍必须重新取得有效 lease。这样不会因 host 断线遗失合法任务，也不会让
过期 lease 发起新的付费或项目写入命令。`ResumeCapabilityV1` 只存在于主进程
scheduler 的 opaque `Symbol`/closure + `WeakMap` 中，绑定
`immutableProjectUuid/projectGeneration/canonicalRootDigest/manifestDigest/runId/
playbook/adapterDigest/fencingEpoch/audience:'main-recovery-worker'/nonce/expiresAt/mac`；
root 或 generation 变化只进入 `needs_attention`，不能继续 materialize，外部
transport 无法构造该 capability。scheduler 每次 recovery attempt 只签发一个
capability，并先以 `(immutableProjectUuid,projectGeneration,runId,fencingEpoch,nonce)`
做原子 CAS、推进 fencing epoch，再允许副作用；完成后 retire capability。重复、
迟到、过期或旧 epoch 的 capability 只能返回 `needs_attention`，不能再次 poll、
reconcile 或 materialize。

## 4. MCP 第一切片

### 4.1 语义工具面

不继续膨胀现有裸 `nomi_generate`。新增或收口一组高层语义工具，内部统一走现有 `ProductionRun`/`runtime.runTask`：

```text
nomi_session_open
nomi_get_generation_context
nomi_operation_create
nomi_submit_generation_plan
nomi_preview_execution
nomi_request_generation_gate
nomi_decide_generation_gate
nomi_start_generation
nomi_operation_read / nomi_cancel_generation / nomi_reconcile_generation
nomi_subscribe_run
nomi_get_artifact
nomi_propose_adopt_artifact
```

`nomi_get_artifact` 与 `nomi_propose_adopt_artifact` 只作 P5 后置的静态
兼容名称；本切片由 `nomi_operation_read` 返回 Artifact/proposal-ready
provenance，不新增 Artifact 或 AdoptProposal owner。

The shared closed alias registry is the only normalization boundary:

| wireName | semanticAlias | owner | legacyName |
|---|---|---|---|
| `nomi_get_generation_context` | `context/read` | read context | — |
| `nomi_session_open` | `session/open` | session/lease | — |
| `nomi_operation_create` | `operation/create` | draft owner | — |
| `nomi_submit_generation_plan` | `operation/plan` | contract/job/gate | — |
| `nomi_preview_execution` | `plan/preview` | local preview | — |
| `nomi_operation_read` | `operation/read` | Run/Artifact projection | `nomi_get_generation`, `nomi_get_run` |
| `nomi_subscribe_run` | `operation/events` | RunEvent projection | `production.events` |
| `nomi_request_generation_gate` / `nomi_decide_generation_gate` | gate request/decision | receipt owner | `nomi_decide_gate`, `production.decide-gate` |
| `nomi_start_generation` | `operation/start` | P3 runtime adapter | `nomi_start_playbook`, `production.start` |
| `nomi_cancel_generation` | `operation/interrupt` | Run cancel owner | `nomi_control_run`, `production.control` |
| `nomi_reconcile_generation` | `operation/reconcile` | Run reconcile owner | `nomi_control_run`, `production.control` |
| `nomi_steer_generation` | `operation/steer` | pre-seal CAS | `nomi_generate` |
| `nomi_get_artifact` / `nomi_propose_adopt_artifact` | artifact/adopt | existing owner | — |

The server first resolves the exact `wireName` and version, then validates the
normalized semantic alias. Raw slash names are not a second input format;
unknown wire names, legacy names carrying P3 fields, and alias misses all fail
with `legacy_path_forbidden` rather than falling through to a generic dispatcher.

`nomi_generate` 在迁移期只作为 `legacy` 兼容入口，不能另有一套 provider、预算或资产写入逻辑；未来是否移除旧写语义必须另案通过迁移、回滚和真实任务评审，本切片不删除、不改写旧入口。
所有 dispatcher 先依据服务端绑定的闭集 `playbookNamespace` 分流，再解释方法名；
该 namespace 不能由 host 参数或 payload 相似性自报。`generation.single-shot` 上下文
触达任何旧 MCP、renderer、stdio 或 `production.*` 方法都返回
`legacy_path_forbidden`；旧 namespace 不能进入 P3 owner，alias miss 也不能回退到
`nomi_generate`/generic dispatcher。裸 `projectId`、`runId`、`gateId` 永远不是
P3 路由判据。

### 4.2 工具曝光策略

P3 的 `tools/list` 保持静态兼容广告，客户端可能提前看到 start schema；真正安全边界是主进程 stage authorization。未通过 gate 的直接调用必须被拒绝并返回结构化错误。按 Run/Stage 的动态子集和 `tools/list_changed` 是后置能力，不能把静态广告写成动态隐藏已完成。

`generation.single-shot` 不进入旧 `nomi_start_playbook` 的 playbook enum，
也不接受 generic `production.start/createDraft`、`production.control`（含
resume/cancel）或 `production.decide-gate`；`nomi_start_playbook`、`nomi_generate`
及这些旧 dispatcher/IPC 名称统一返回 `legacy_path_forbidden`。`context/read` 的 `nomi_get_generation_context` 永远
只读；只有 `nomi_operation_create` 能创建 P3 draft。

工具目录是静态 schema 广告，不是权限；真实 effectiveScope 按
`ExternalSessionProjectionV1` phase 派生：schema_only 仅 context/read/events，
e0_zero_credit 加 create/plan/preview，e1_paid 才加 paid controls，closed 为空。
下面的生命周期表只是静态产品提示，不是权限或实际工具可见性；真正授权只
取 `ExternalSessionProjectionV1.effectiveScope`。在 schema_only 阶段，表中
任何 write-like 项都返回 `phase_not_ready`/`feature_disabled`：

| 状态 | 可见能力 |
|---|---|
| 未预检 | context、能力查询（计划提交仅作静态提示） |
| 计划待审 | preview、修改候选、读取 gate |
| 已批准未提交 | start（仅当前 contractHash） |
| provider 处理中 | get/subscribe/cancel/reconcile |
| Artifact 已验证（P5 后置，不在本切片 scope） | get_artifact、propose_adopt（当前只作静态广告，调用返回 `not_ready`） |
| Adopt 已批准（P5 后置） | 项目写入由唯一 Command/Production 入口执行 |

MCP `tools/list_changed` 或模块目录刷新不能改变已冻结 Run 的合同；最多影响下一次 Run。

### 4.3 单镜生命周期

第一片只支持 `generation.single-shot`：一个已审合同、一个 shot、一个 provider job、一个本地 Artifact。支持单参考图或无参考图；首尾帧、音频、多镜头和复杂连续性作为能力条件，缺失时明确 `blocked` 或拆成后续模块，不能填空字符串伪装支持。

生成完成后只登记 Artifact、预览和 proposal-ready provenance，不自动插入剪辑区。
`propose_adopt_artifact` 是 P5 后置命令；本切片不生成 AdoptProposal，也不接入
Canvas/Timeline 写入路径。

P3 semantic stages project onto the existing status machine (no parallel enum):

| stage | Run | Stage | Job |
|---|---|---|---|
| context | `draft` | `pending` | none |
| plan.submit | `awaiting_contract` | `awaiting_gate` | `authorization_required` |
| human receipt | `ready` | `awaiting_gate` | `authorized` |
| dispatch | `running` | `running` | `submit_intent_persisted → submitting → provider_accepted/polling` |
| settle | `running`/`needs_attention` | `completed`/`needs_attention` | `ready`/`submission_unknown`/`needs_attention` |
| proposal | `running` (P3 avoids the existing illegal `running→ready` transition) | `completed` | `ready` |

`stageId`/`nextAction` carries the semantic label; `submission_unknown` and
`needs_attention` never become `completed`, and legacy recovery never enters
the single-shot adapter.

### 4.4 External Agent control-plane adaptation (E0/E1)

Codex/Pi research is recorded in
`docs/audit/2026-08-22-agent-runtime-source-review.md`, sourced from the fixed
commit `5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`. It is a research appendix, not
a second execution entry.

E0 (before the P3 checkpoint, zero credit) exposes only typed alias shapes for
`session/open`, `context/read`, `operation/create`, `operation/plan`,
`plan/preview`, `operation/read` and `operation/events`. Before P0/P2
checkpoints, write-like calls—including `operation/create`—return
`phase_not_ready` (or `feature_disabled` when the flag is off) and append no
Run/job/gate. After P0/P2, `operation/create` creates/reuses the deterministic
draft Run; `operation/plan` compiles and
seals the contract, then atomically creates the existing
`authorization-required` ProductionJob and `generation_submit` gate, but still
performs no provider call or spend. `session/open` obtains a
main-process-issued `ProjectLease`; host input cannot assert `projectId`,
`trust`, cost or spend authority. `operationId` is correlation only and must
bind one-to-one to the existing
`{immutableProjectUuid, projectGeneration, projectId, runId, contractHash?,
shotId?, runtimeTaskId?, attempt?}`. It is not
a second Operation database, EventStore or global lane. Cross-session read/control
requires a main-process `OperationHandoffV1` bound to operationId, immutable
project identity, recipient/channel proof, explicit `read|control` scope, expiry,
one-time nonce and revocation epoch; a copied leaseHandle alone is insufficient.
The exact shared shape is
`{version,keyId,algorithm,issuer,handoffId,recipientBinding,recipientProof,
operationId,immutableProjectUuid,projectGeneration,runId,scopes:'read'|'control',
audience,issuedAt,expiresAt,oneTimeNonce,mac}`. The same lease/session resolver
consumes it for every canonical tool; it is not an untyped bearer.

These aliases are versioned names routed through the existing MCP `tools/call`
and Capability Core dispatcher (with the same GUI/headless path), not a new
unnegotiated JSON-RPC protocol. Static `tools/list` advertisement never grants
stage or lease authority.
The slash labels are conceptual only; the wire catalog uses
`nomi_session_open`, `nomi_operation_create`, `nomi_submit_generation_plan`,
`nomi_preview_execution`, `nomi_request_generation_gate`,
`nomi_decide_generation_gate`, `nomi_operation_read`, `nomi_subscribe_run`,
`nomi_start_generation`, `nomi_cancel_generation`, `nomi_reconcile_generation`
and `nomi_steer_generation`. Gate request/decision are disabled until E1/P3.
Their strict schemas are
`nomi_request_generation_gate({version:1,leaseHandle,serverNonce,operationId,runId,contractHash})`
and `nomi_decide_generation_gate({version:1,leaseHandle,serverNonce,operationId,runId,
receiptId,handoff:HumanApprovalHandoffV1})`; E0 returns phase/feature errors with
no reservation or receipt, while E1 verifies the handoff recipient/channel proof.

Normalization is exact and one-way: only the listed `wireName` plus
`version:1` is accepted, then it is mapped to the semantic slash label for
closed validation. Raw slash names, unknown versions and compatibility names are
not alternate input formats. `operation/read/events` carry an optional
`OperationHandoffV1` for cross-session access; `operation/start/interrupt/steer`
carry the same optional handoff plus a server-issued `actionNonce` consumed with
the Run fencing CAS. `recipientBinding` is either a registered
WebContents/frame/origin or an attested-client key, and
`recipientProof={channelNonce,operationId,challengeHash,issuedAt,expiresAt,macOrSignature}`;
the canonical proof bytes cover every listed field and the handoff recipient.

Every post-open alias has `version: 1`, the server-issued `leaseHandle` and
connection `serverNonce`; `session/open` alone accepts the signed
`projectSelectionHandle`. The validator rejects unknown keys, missing/foreign
nonces, bare integer cursors and E1 fields on E0 variants. Gate request/decision
are canonical typed calls in this same catalog (not a fallback to legacy
`production.decide-gate`), and their E0 response is `phase_not_ready` without
reservation/receipt side effects.

MCP `initialize` remains the only protocol handshake. `nomi_session_open` is a
typed post-initialize tool that returns `{protocolVersion:1, sessionId,
leaseHandle, immutableProjectUuid, projectGeneration, projectId, expiresAt,
audience, phase, effectiveScope, serverNonce}`; `effectiveScope` is the
server-derived set of currently allowed operations: `schema_only` is
`['context','read','events']`, `e0_zero_credit` is
`['context','create','plan','preview','read','events']`, and `e1_paid` adds
`['gate_request','gate_decide','start','cancel','reconcile','steer']` to that same E0 set. Before P0/P2 checkpoints the
effective phase remains `schema_only` and write calls return `phase_not_ready`
(or `feature_disabled` when the flag is off). Only after P0/P2 may `create` and
`plan` be enabled. All project identity fields are derived from
the signed project-selection handle. A
connection cannot initialize twice, rebind to another handle or downgrade its
version, and a bearer token is never a lease issuer.
The main process creates a fresh 256-bit `serverNonce` per connection and stores
only a MACed `NonceBindingV1` over `handle.sessionNonce`, lease nonce and the
transport connection id. Every post-open alias must present that binding. On
expiry/revocation or project-generation change, all aliases fail with
`lease_invalid`/`project_scope_changed`, the session closes and the refreshed
projection has `effectiveScope:[]`; cached scope is never authority and reopen
requires a new handshake. The shared `ExternalSessionProjectionV1` has a terminal
`{phase:'closed', closeReason:'lease_invalid'|'project_scope_changed'|'expired',
effectiveScope:[]}` variant; a closed session is not an active E0/E1 phase and
cannot be used for an alias call.

`gate_request`/`gate_decide` are the only effective-scope names for the two
canonical gate tools and appear only in `e1_paid`; E0 may advertise their
schemas but must return `phase_not_ready`/`feature_disabled`. Artifact read and
adopt names are reserved for P5 and are not part of this slice's effective
scope; early direct calls return `not_ready`.

The alias request is a discriminated union (not a bag of optional fields):
`session/open` takes only a signed project-selection handle; `context/read` takes
a lease and optional existing `runId` but is always read-only; `operation/create`
takes the lease/operation correlation and is the only alias that calls
`createGenerationSingleShotDraft`; the host cannot pass a `createDraft` or mode
flag. `operation/plan` takes a candidate; `plan/preview`/`operation/read` take a
sealed reference; events take `afterCursor`; E1 controls additionally require
`runId` and `contractHash`.
The projection includes `projectRevision`, `status` and `nextAction`; the shared
wire registry is `ExternalErrorCodeV1` with the closed values
`feature_disabled|phase_not_ready|not_ready|lease_invalid|project_scope_changed|
contract_invalid|catalog_snapshot_stale|gate_required|human_approval_required|
approval_invalid|stale_preview|cost_unknown|provider_unavailable|submission_unknown|
stale_revision|asset_missing|materialization_failed|migration_parse_error|
legacy_path_forbidden|contract_sealed|operation_not_steerable|new_draft_required|internal_error`.
Every event carries the same
`ExternalEventBaseV1{eventId,cursor,runRevision,correlationId}`. Event type and
data are a closed, sanitized discriminated union; an event without a matching operation
binding is not exposed. The mapping is one-way: Run stage statuses project to
draft/awaiting/running; materialization + `artifact.add` produces
`artifact_ready` and then `operation.completed`; terminal provider errors become
`failed`, confirmed cancellation becomes `cancelled`/`interrupted`, and
`submission_unknown` never becomes a terminal success.
Raw events are filtered through the existing `MEANINGFUL_EVENT_TYPES` mapping;
`run.created` becomes `operation.started`, status/stage/job-ready events become
progress/status, `gate.*` becomes awaiting-gate status, `artifact.ready` becomes
`artifact.ready`, and `job.submission_unknown`/`job.needs_attention` become
`needs_attention`. `artifact.add` is a command, not an event. Unbound, unknown
or secret-bearing records are dropped.

Before the P0/P2 checkpoints, write-like E0 calls return `phase_not_ready` and
perform no Run/job/gate append. After those checkpoints, E0 may persist the
sealed contract, authorization-required job and pending gate in zero-credit mode,
but may not reserve budget, mint a grant, submit a provider request or
materialize an Asset. E1 remains disabled until the P3 checkpoint.
The feature policy is a three-state machine (`schema_only`, `e0_zero_credit`,
`e1_paid`): flag-off returns `feature_disabled` first; an unopened phase returns
`phase_not_ready`; E1 calls before P3 return `not_ready` before any lease/gate
check. This precedence is part of the typed error contract.

The E0 read boundary returns
`{snapshot, snapshotCursor, events, nextCursor}` atomically and reuses the
per-Run `RunEvent.cursor`. Facts are broadcast only after durable commit;
`submission_unknown` and `needs_attention` cannot become completed.
The shared cursor codec is `CursorV1{keyId,immutableProjectUuid,projectGeneration,
projectId,runId,snapshotGeneration,numericCursor,expiresAt,mac}`; `projectId` is
server-derived display data, while UUID/generation are the authority. A bare integer, foreign
run, stale generation or expired cursor is rejected before any legacy events call.

E1 is available only after the P3 checkpoint. `operation/start` maps exclusively
to `nomi_start_generation({runId, contractHash})` and the shared dispatcher must
verify a fresh lease, consumed `HumanApprovalReceipt`, matching
`generation_submit` target, reservation, prepared envelope, bound grant and
Run-owned outbox claim. Its provider path is only `generationRuntimeAdapter`.
`operation/interrupt` maps to explicit cancel/reconcile; `operation/steer` is
limited to pre-seal candidate CAS. Creating the human challenge seals the
candidate; gate-pending, receipt-consumed, provider-submitted, unknown and
recovery states reject contract edits and require a new draft/gate. No in-flight
challenge is patched.

Pi `AgentLoopPort`, right-side Agent parity, Editor MCP and Timeline Apply are
P4/P5/P6 work, not P3. All aliases reuse the existing Run intent/WAL,
RuntimeEnvelope, outbox, materialization receipt, resume and per-run lock/CAS.

## 5. 分阶段路线与退出条件

### P0：基线与 ownership ADR

**交付：** 当前 `origin/main` 基线报告、对象 ownership 矩阵、旧方案迁移表、模块/合同命名 ADR。

**测试与证据：** typecheck、全量单测、现有 MCP zero-credit journey、重复真相源扫描。

**退出条件：** 能列出每个字段由谁写、谁投影、谁恢复；没有新的第二 Run/第二 Asset owner。

### P1：Runtime + Module + Asset boundary

**交付：** 给现有 `electron/runtime.ts`、Capability Core、资产传输策略和 ProductionRun 加 typed module/task envelope；不重写 provider。

**测试与证据：** fake module registry、schema/能力/工具 allowlist、资产 lease/expiry/privacy、模块原子替换、未知模块 fail-closed。

**退出条件：** 一个现有 image 或 video adapter 能通过统一 `RuntimeTask` 执行，重复命令返回同一 receipt，且没有付费调用前的隐藏网络请求。

### P2：ExecutionContract compiler

**交付：** PlanCandidate → ExecutionContract 的纯编译器；接入现有 storyboard/plan.attach binding，补 canonical hash、field ledger、module/capability/asset-state/fingerprint。

**测试与证据：** plan→node→runtime request→ProductionJob 字段守恒；未知字段、失效 asset version、能力降级、旧 contract migration fixture；contract hash 稳定性。

**退出条件：** 同一输入和同一 registry snapshot 生成相同 contract；任何 warning/dropped field 都可在 preview 中解释；无合同不得进入 provider submit。

### P3：MCP AI generation single-shot

**交付：** 上述 MCP 工具、一次 typed gate、单镜真实 Job、Artifact/preview；P3 外部 MCP 走通，右侧 Agent parity 作为 P4 的同合同适配，不复制执行器。

首片新增的是 `generation.single-shot` 最小 playbook（不是复用
`brand.promo` 的 direction gate）；`operation/create` 并发调用通过 deterministic
draftKey + per-run lock 复用同一个 Run。provider 调用前由主进程从
`generation_submit` receipt 铸造既有 spendGrant，重启/unknown 只允许
reconcile。

**测试与证据：** real Electron stdio + real MCP client、零额度 fake provider、progress、cancel、restart、duplicate callback、submission_unknown、跨项目拒绝。真实 provider smoke 单独使用 `tests/ux/mcp-generation-single-shot.real-provider.mjs`，必须在 P3 checkpoint 通过后、以显式 provider/model/feature flag/cost ceiling/receipt 运行；凭证或成本未知时 verdict 为 `blocked`，不能用 mock 代替。

**退出条件：** 真实外部 MCP host 从 context 到 artifact 完整走通；批准前 providerCalls=0；fake provider 成功路径 raw submit=1；重启不重复扣费；Artifact 可在项目中重开读取。真实 provider smoke 作为独立证据附录，不得伪装成零额度通过。

### P4：生产恢复与受控扩展

**交付：** 在 P2/P3 已验证的 `ProductionJob.executionBinding`、reconcile/cancel/lease 基础上扩展有限并发、波次和局部重试；不把 binding/lease 继续当作 P4 的未实现前置。

**测试与证据：** fault injection（503、进程崩溃、断线、迟到回调、provider unknown）、预算 reservation/settlement、依赖波次；不放宽 QA 阈值。

**退出条件：** 所有终态都有结构化 error/nextAction/receipt；retry scope 不会误重跑已提交 provider job。

### P5：剪辑区 Adopt 窄接入

**交付：** Artifact → EditProposal → Apply/Undo 的最小桥；时间轴仍是现有事实源，必要时只做 projection/adapter，不启动全量 EditorDocument v2。

**测试与证据：** stale revision、伪造 asset/job lineage、原子 apply/compensation、重开恢复、截图走查；Apply 前后真实预览对账。

**退出条件：** 用户能在剪辑区看到、批准、撤销一个生成结果；生成模块不能绕过 Proposal 直接落轴。

### P6：动态模块与 Renderer 子项目

音频、审片、参考图选择、Remotion/HyperFrames 分别作为独立 module/renderer 子项目；各自重新经过 sandbox、静态检查、真实预览/导出 parity 和六角色评审，不阻塞 P3。

### P7：完整 Editor/Workflow 产品化

全量 EditorDocument/Timeline v2、本地访谈剪辑、完整 Agent Workbench、`brand.promo`/drama Recipe、多宿主 lease 和大规模 QA 只能在 P3–P5 证明内核成立后启动。它们不再是 MCP 首片的前置依赖。

## 6. 每阶段统一验收合同

每个阶段必须产出 `PhaseEvidence`：

```ts
type PhaseEvidence = {
  phaseId: string
  commitSha: string
  inputSnapshotHash: string
  testCommands: Array<{ command: string; exitCode: number; summary: string }>
  journeyArtifacts: string[]
  screenshotsOrMediaEvidence: string[]
  sixRoleReviews: RoleReview[]
  adversarialReview: AdversarialVerdict
  knownRisks: string[]
  rollbackRef: string
  verdict: 'passed' | 'blocked' | 'needs_attention'
}
```

### 六角色评审硬问题

- **CTO：** 是否仍只有一个 Runtime/Run/Asset 写真相？是否有未经合同冻结的 provider 或时间轴写入？
- **PM：** 用户是否能用一句话完成目标？是否少了不必要的确认？成本/下一步是否可理解？
- **设计：** MCP 对话、Nomi 面板和剪辑区是否形成一个连续控制面，而不是三个重复卡片？失败/等待/恢复是否清楚？
- **前端：** loading、needs attention、cancelled、unknown、stale、reconnect 是否都有可操作状态？是否通过真实入口走查？
- **后端：** schema、权限、预算、幂等、lease、outbox、reconcile 是否由主进程强制？
- **真实用户：** 不看内部术语，能否完成任务、知道花了什么、失败后能否只重做坏的一步？

### 对抗评审最小矩阵

1. Skill 文本提及未授权工具，调用必须被拒。
2. Host 伪造 `approved`、`providerTaskId`、`assetId` 或 quality pass，schema 必须拒绝。
3. 旧 `planHash`、旧 project revision、外国 projectId、过期 receipt 必须拒绝。
4. 同一 `idempotencyKey`、重复回调、断线重连不得产生第二次 provider submit 或第二个资产。
5. provider 返回 unknown/503/无法取消时，系统必须停在可恢复状态，不能自动盲重提。
6. 恶意 Skill/网页/资产文本不能改变 tool allowlist、预算或审批策略。
7. 缺失字体、素材、renderer、音频或能力时必须 blocked/needs_attention，不能伪造完成。
8. 人工模拟器不能通过直接 IPC、文件系统或 provider SDK 伪造通过结果。

## 7. 回滚与停止规则

- P0–P3 只新增受 feature flag 控制的语义入口；现有 `nomi_generate` 仍是付费/Canvas 写入兼容路径，必须显式标为 legacy，不能误称只读，也不能与新路径双写项目事实。
- 每次 provider submit 前保存 contract、input fingerprint、预算 reservation 和备份；提交未知时只 reconcile，不自动再扣费。
- 每次项目写入使用 Proposal/command receipt；apply 中断时全量 compensation，无法补偿则 `needs_recovery`，保留旧状态。
- 任何阶段出现 P0/P1、重复扣费、跨项目写入、无法恢复的 artifact 丢失或 preview/export 不一致，立即关闭 flag，回到上一阶段，不继续扩模块。
- 旧项目迁移、删除旧字段、切换唯一写 owner、安装/升级 renderer 都属于不可逆闸，必须有 copy-on-write、恢复命令和用户可见 receipt。

## 8. 旧方案的处理方式

### 保留为决策来源

- `docs/superpowers/specs/2026-08-08-agentic-production-experience-design.md`：Nomi-authoritative、CAS、预算 ledger、outbox、submission_unknown、诚实进度和安全投影。
- `docs/superpowers/plans/2026-08-20-storyboard-execution-contract-v2.md`：Storyboard IR、canonical hash、field ledger、reference roles、continuity checkpoint；改为通用 envelope 的 payload。
- `docs/plan/2026-08-09-production-mcp-finalization.md` 与 MCP 对话原生计划：真实 stdio、GUI gate、progress、artifact、restart 和 zero-credit journey。

### 明确后置或拆分

- `2026-08-21-agent-editor-workbench` 的全量 EditorDocument/Timeline migration：移到 P7。
- 本地访谈 Agent、完整 Agent Editor UI：独立子项目，P5 后再评估。
- Remotion/HyperFrames：P6 renderer 子项目。
- `brand.promo`/`drama.short`：Recipe/Workflow registry 子项目，不阻塞单镜生成。
- Electron 大版本升级、多宿主 lease、完整 Run Center：独立风险批次，不混入 P0–P3。

## 9. 评审与交付流程

1. 本设计稿已由用户确认；中文执行入口是 `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`。
2. 已使用 writing-plans skill 生成 `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`，每个步骤都写精确文件、失败测试、命令、预期输出、commit 和回滚点。
3. 实施计划按 P0→P3 先交付第一条闭环；P4–P7 只保留依赖和进入条件，不提前开工。
4. 每批完成后保存 `PhaseEvidence`、六角色 verdict、对抗报告和截图/媒体证据，用户复核后才进入下一批。
5. 最终发布前再做一次综合六角色评审、独立对抗评审、真实 MCP host 矩阵和完整 gates；没有证据的“完成”不成立。

## 10. 外部架构对账

本设计吸收了以下只读审查结论：Claude Code 的 Skill/MCP/Subagent/Workflow/Hook 分层；Codex 的 per-step tool router、Thread/Turn/Item 事件和审批；Hermes 的动态 registry、Skill bundle、SQLite recovery；Pi 的动态 extension 与渐进 Skill（但不复制其无 sandbox 和未完成 durable harness）；DeepSeek Harness 的 pluginized runtime、typed tool layer、approval service 和动态 workflow seam。共同结论是：固定 runtime 不变量，动态能力目录，副作用前冻结合同；不把 Skill 文本当安全边界，也不把会话日志当付费 Job 真相。
