# Nomi 统一创作运行时与 AI 剪辑工作台实施方案

> 状态：实施基线（2026-08-22）。用户已确认推进；本文件是中文架构与阶段入口，具体逐文件执行步骤见 `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`。本次只先落 P0–P3，后续阶段必须以 PhaseEvidence、六角色评审和对抗评审通过为前提。Codex/Pi 研究只作为 `External E0/E1` 适配附录，不产生第二执行计划或第二事实源。

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
→ 提交一个现有 `ProductionJob`（产品语言 GenerationJob）
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
→ RuntimeTask / 现有 ProductionJob（产品语言 GenerationJob）
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
| 现有 Asset/transport store | Asset identity、local materialization、lease/privacy | contract 输入版本和 provenance binding |
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
  cardinality: { providerJobs: number; artifacts: number }
  destination: 'project_asset' | 'canvas' | 'timeline' | 'export'
  providerRecoveryCapabilities: Array<'submitIdempotency' | 'queryByTaskId' | 'reconcile' | 'cancel'>
}
```

这是通用 ModuleManifest 的声明范围；P3 `generation.single-shot` validator
再收窄为 `cardinality: { providerJobs: 1; artifacts: 1 }`、
`destination: 'project_asset'`。通用 registry 不能把 P3 的收窄规则省略，其他
任务以后才可使用不同 cardinality/destination。

`allowedTools` 是宿主注册表的上限，不是 Skill 文本中提到工具名的结果。`contentHash` 必须是规范化 manifest（不含 hash 字段）的 SHA-256；`executorRef`、`validatorRefs`、`allowedTools` 和 `allowedCommands` 必须来自闭集注册表。模块缺失、hash 不一致、能力不满足或工具不存在时，编译失败且不得产生候选产物。首片内置模块的 `cachePolicy` 为 `bypass`，旧进程内 fingerprint cache 不能制造没有 Run receipt 的 cache hit。
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

// Resolver-issued closed form; host input never supplies this object. Conditional
// fields are required by state/stage (loaded/applied/materialize), not optional
// implementation hints.
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

`outputArtifactIds` is required when `stage:'materialize'`; all state/stage
requirements are validator rules, not optional host input. Unknown keys and
unbounded byte ranges are rejected.
```

`ExecutionContract` 必须记录解析后的模块、Skill/body hash、能力快照、输入资产版本、provider 参数映射、丢弃字段和警告。运行中更新 Skill、模型目录或模块版本不会改变已经冻结的合同。纯 prompt 的首片合同使用稳定 synthetic source `{kind:'generation_context', artifactId:runId, version:1, hash:contextHash}`；有参考图时使用服务端解析的 asset/storyboard source，host 不能自报 source hash。候选只允许提交 user-level prompt、语义 asset role、可选观测版本和参数；`stateId/contentHash/materializationStatus/final required` 必须由 Nomi Asset resolver 派生并写入合同。host 提交的 `system` 或策略性 `instruction` 不得进入 stage system prompt，只能拒绝或降级为 user-level 字段并记入 ledger。

`contractHash` 先对完整、校验后的 immutable pre-submit domain 做规范化 SHA-256，再挂回合同；domain 包含 `shotId`、解析后的 `skillEvidence` hash，排除 gate/approval/runtime/provider ID、status、receipt 和 opaque grant。`shotId` 必须来自候选的稳定镜头 ID，缺失时编译失败，不能由每次重试随机生成。编译器先生成合同里的 envelope binding 描述；完整持久化 `RuntimeTaskEnvelope` 只在真人 receipt + reservation 之后由本地 `prepare` 写入，保存 `preparedTaskRequest`、`providerId/accountId/profileId/tenantScope/endpoint/model`、provider request fingerprint/idempotency key、providerTaskId、recoveryAdapterId 和状态；`dispatchTaskRequest` 只是在 `runTask` 前临时注入主进程 grantId，不落盘、不参与 hash。`submit/query/reconcile/cancel` 必须全程携带同一 provider/account/profile/tenant/endpoint namespace、requestFingerprint 和 fencingEpoch；provider key 不能只用 `H(projectId,contractHash,shotId,moduleRef)`。没有 `submitIdempotency + queryByTaskId + reconcile` 能力的 provider 模块直接 `blocked`，不能靠 fallback 静默再发一次。P3 operation kind 只允许 `image_generation→image`、`text_to_video→video`、`image_to_video→video`；`text`、`custom`、multipart、process/script executor 或未审 executor 一律 blocked。

`ResolvedTaskRequestV1` 是 server-derived 的闭集 discriminated union（仅
`image_generation`、`text_to_video`、`image_to_video`，含有界 prompt、asset
refs、尺寸/时长/fps/steps/seed），`additionalProperties:false`；没有
`TaskRequest.extras`、自定义 headers、script/process/multipart 或 host 任意
provider 字段。`PreparedProviderRequestV1` 的闭集字段是
`{immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,moduleRef,
runtimeTaskId,providerId,accountId,profileId,tenantScope,endpoint,model,
requestFingerprint,providerIdempotencyKey,attempt,fencingEpoch,resolvedTaskRequest}`；
submit、query、reconcile、cancel、callback verify 和 provider result verification
都必须携带同一 identity。旧 active-project fallback、403/404/405 hidden resubmit
和进程内 TTL cache 在 P3 sealed boundary 一律拒绝。
`ProviderIdempotencyKeyV1` 唯一派生为
`base64url(sha256('nomi.provider-idempotency.v1\\0' + canonicalUtf8(tuple)))`，
其中 tuple 是 NFC/长度前缀规范化的
`{immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,
moduleRef,providerId,accountId,profileId,tenantScope,endpoint,model}`；旧的
`H(projectId,contractHash,shotId,moduleRef)` 只能作为被拒绝的 legacy 形状。
`ProviderTaskState` 是闭集
`'queued'|'submitted'|'running'|'succeeded'|'failed'|'cancelled'|'unknown'`，
同一 attempt 只能单调推进；`unknown` 不能被解释为成功或自动重提。
provider callback 先由 `verifyCallback(ProviderCallbackEnvelopeV1)` 验证 provider
签名/key、时间戳/nonce、完整 sealed namespace 和 canonical payload，再以
`providerTaskId/requestFingerprint/payloadHash/resultFingerprint/attempt/fencingEpoch`
做 CAS；同 key 不同 payload/result 返回 `callback_conflict`，foreign task 在查表前拒绝。
`ProviderCallbackEnvelopeV1` 至少固定
`{version,audience:'nomi-provider-callback',auth:{kind,algorithm,keyId,issuer,mac|signature},providerId,accountId,profileId,
tenantScope,endpoint,model,immutableProjectUuid,projectGeneration,projectId,runId,
contractHash,shotId,moduleRef,runtimeTaskId,providerTaskId,attempt,fencingEpoch,state,
requestFingerprint,payloadHash,resultFingerprint?,issuedAt,expiresAt,nonce}`；
不允许实现者用仅 `providerTaskId/state` 的弱回调契约。
签名/MAC 覆盖固定 canonical UTF-8 域
`nomi.provider-callback.v1\0` + version 至 nonce 的排序、长度前缀字段，且包含
`auth.kind/algorithm/keyId/issuer`，只排除 `auth.mac|auth.signature` 值本身；
auth.keyId 是唯一 key identity，验证先做 audience/issuer/时间窗、
nonce replay CAS，再按完整 project/run/account/provider namespace 查任务。

合同的 immutable domain 还包含捕获的 module-catalog hash 与
`policySnapshotHash`；任一目录或策略变化都必须创建新 draft，不能重新解释
已批准合同。

Run event revision 与 project document revision 是两个字段：现有
`electron/workspace/workspaceRepository.ts` 是 project document revision 的
递增/持久化 owner，`projects/repository.ts` 只提供带 CAS 的 wrapper；合同、
draft、gate、Proposal 都同时保存并做 project CAS。项目保存或时间轴/画布修改
后，旧合同/receipt 即使 Run revision 没变也必须 stale。

资产引用来自现有 Asset store 的 immutable content hash/stateId（首片强制
`stateId === contentHash`，binding 同时保存两者）。MCP lease 由主进程
`projectLease.ts` 唯一签发；`ProjectSelectionHandleV1` 固定包含
`version/keyId/algorithm:'HMAC-SHA256'/issuer:'nomi-main'/handleId/immutableProjectUuid/projectGeneration/canonicalRootDigest/
manifestDigest/audience/sessionNonce/issuedAt/expiresAt/revocationEpoch/scopeSet/mac`，
密钥只在 app-owned keyring/app data，host、项目文件和 renderer 不能成为 issuer。
`ProjectLeaseV1` 固定为 `{version,keyId,algorithm,issuer,projectId,
immutableProjectUuid,projectGeneration,canonicalRootDigest,manifestDigest,
audience:'nomi-mcp',leasePrincipal,sessionId,connectionNonce,issuedAt,expiresAt,
nonce,scopeSet,scopeHash,revocationEpoch,mac}`，不接受含义
不明的 `signatureOrHandle` 二选一字段；每次 dispatch 都做 no-follow realpath、manifest
digest 与 generation CAS；project picker 只能从主进程 registry UUID 取得已打开的
root identity/fd（或等价 no-follow openat 边界），不能从 bearer 加任意路径 bootstrap，
校验与写入必须共享同一 inode/generation CAS。删除重建、symlink/rename、撤销或 scope 不匹配返回
`project_scope_changed`。`.nomi/leases/<projectId>/<sessionId>.jsonl`
只是带 MAC 的审计记录；issue/revoke/replay 受共享 per-project lock/CAS、fencing
epoch、目录 fsync 和 appData revocation epoch 保护，不能用无锁 atomic replace。
appData/OS-keychain 中的 key ring、project generation 与 revocation epoch 是唯一
权威；项目 `.nomi/leases` 只作带 MAC 的镜像/审计，删除、恢复或复制项目文件不能
让旧 lease 复活。
stdio、GUI 和重启后的主进程都从该 store 验证，host 参数不能自报或扩大 scope。
项目 revision 的真正递增 owner 是
`electron/workspace/workspaceRepository.ts`，projects wrapper 只提供带 CAS 的
读取/写入接口。

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

每个 DecisionRecord 必须绑定 `projectId + immutableProjectUuid + projectGeneration + runId + gateKind + targetHash + projectRevision + costScope + pricingSnapshotHash + humanActor + receiptNonce + expiresAt`；请求侧另记录 `leasePrincipal`，两者不可互换。P3 的 `generation_submit` 使用现有 `scope: 'budget_envelope'`，并要求 `targetHash === contractHash`；reducer 在旧 gate-id hook 之前强制校验这些字段。重复相同决议返回原 receipt；不同项目代际、run、hash、nonce 或过期 receipt 一律拒绝。

P3 只启用一个组合门 `generation_submit`（计划审阅 + 预算 + provider submit）；`artifact_adopt` 仍是后续剪辑区门。新门走统一 `gate.decide` 持久命令，不能触发旧 `productionRunDriverOps` 的 arrange/export。

`nomi_request_generation_gate` 是请求/编排入口：读取已封存合同并创建闭集
`HumanApprovalChallengeV1{version,challengeId,nonce,gateId,contractHash,
projectRevision,costScope,pricingSnapshotHash,reservationPreview,issuedAt,expiresAt,
immutableProjectUuid,projectGeneration,audience,mac}`；字段完整签名，但只有
脱敏的 `reservationPreview` 展示给真人。MCP `elicitation/create` 只负责展示/传输 challenge，
永远不能单独铸造 receipt。默认由预登记且可验证的 attested client 响应触发主进程
`approvalReceipt.ts` 签发一次性 receipt；客户端无法提供该证明时，才由 Nomi
GUI/main-process user gesture 通过同一 challenge 兜底。两条路径都必须经过主进程
验证，才允许签发一次性 `HumanApprovalReceipt`；随后
`nomi_decide_generation_gate({receiptId})` 只负责消费
并核验该 receipt，不能反过来签发或代替真人决定。给真人看的 challenge projection 只展示
`reservationPreview`（金额、币种、有效期）；完整 `HumanApprovalChallengeV1` 仍签名保存
gate/合同/项目代际等内部绑定字段，不提前创建 live reservationId；
reducer/repository 原子消费并拒绝 replay、错 challenge、过期或跨项目 receipt。
GUI 接受可来自不同 renderer/session，但必须携带主进程签发的 project-scoped handoff
handle 与 user-gesture attestation；最终 receipt 的 `humanActor`/nonce/target 仍由
主进程验证。lease 只提供 scope/session，不提供人审身份；工具参数中的 `approved`
和旧 `spendConfirmed` 不能替代真人决定。
外部 MCP 返回的 `elicitation/create` accept/confirm 只是 transport 结果，不是人审凭证；**已登记且可验证的 attested client 是默认确认面**，主进程验证通过后直接铸造 receipt；缺少 attestation 时才返回 `human_approval_required` 和 project-scoped handoff/deep link，由 Nomi GUI 使用同一 challenge 兜底，不得要求第二次确认。连接动作只建立客户端身份；只读 session lease 可从主进程验证的当前活动项目静默签发，第一次 `generation_submit` 将项目范围升级和生成审批合成一次确认。新 semantic 路径绝不回退到裸 `confirm`/`approved`/`spendConfirmed`。

Challenge 在 transport 发起前由 Run-owned intent log 持久化：记录
`generation.gate.challenge` 的 challengeId、nonce、contractHash、project/run、
expiry、payloadHash 与 prepare/commit/abort 状态。主进程重启时按该记录恢复同一
未过期 challenge，绝不生成第二个 nonce；接受前崩溃可继续 elicitation，接受后崩溃
按一次性 receipt 消费记录重放。GUI/stdio 只是 challenge 的展示与回答面，不是状态
所有者。

人审决定校验 challenge/handoff 的有效性，不会因为原 Host lease 在等待期间
过期而拒绝合法 receipt；新的 context/submit/start/adopt 仍需 fresh lease。
WAL/envelope 只保存按项目 ACL 保护的 prompt/asset refs 和 redacted request，
禁止 credentials、headers、opaque grant 或 provider secret 写入持久层。

`HumanApprovalReceiptV1` 固定绑定
`{version,keyId,algorithm,issuer,receiptId,challengeId,handoffId,immutableProjectUuid,projectGeneration,
revocationEpoch,projectId,runId,gateId,contractHash,targetHash,projectRevision,
costScope,pricingSnapshotHash,humanActor,gestureAttestation,receiptNonce,audience,
issuedAt,expiresAt,mac}`；
key 只存 app-owned keyring，旧 key 只能验历史 receipt；一次性 consume 由
gate/WAL owner 以 `(receiptId,receiptNonce)` CAS 完成。它由主进程签发/消费，不能由 MCP/GUI
transport 直接构造。跨 renderer/Host 的 handoff 也必须是闭集
`HumanApprovalHandoffV1{version,keyId,algorithm,issuer,handoffId,recipientBinding,
recipientProof,challengeId,contractHash,targetHash,projectRevision,
immutableProjectUuid,projectGeneration,revocationEpoch,audience,issuedAt,expiresAt,
oneTimeNonce,mac}`；`recipientBinding` 只能是
`{kind:'web_contents',webContentsId,frameId,origin}` 或
`{kind:'attested_client',clientId,keyId}`，`recipientProof` 固定为
`{channelNonce,challengeHash,issuedAt,expiresAt,macOrSignature}`。`receiptId` 只是不可猜的短句柄，只有该 handoff recipient
在主进程 connection/channel proof 下可以消费；同一 receipt 的并发消费只有一个
CAS 成功，其余返回原结果而不改变预算。challenge 只展示
`reservationPreview`，不提前创建 live reservationId。审批写入、预算
reservation、spendGrant binding 和 Run event 采用可回放 intent/WAL，最小顺序
是 `generation.submit.intent → approval.consume → reservation.bind →
envelope.prepare → grant.consume → provider.submit → materialize.commit →
artifact.add`；每个 intent 有 durable key/checksum，重放幂等，崩溃恢复不会
重复授权或铸令牌。
`GestureAttestationV1` 是闭集且由主进程验证：
`{kind:'main_process_gesture',issuer:'nomi-main',keyId,challengeId,
decision:'accept'|'reject',webContentsId,frameId,origin,gestureNonce,issuedAt,expiresAt,mac}` 或
`{kind:'registered_client_signature',issuer:'attested-client-registry',keyId,
clientId,challengeId,decision:'accept'|'reject',audience:'nomi-mcp',gestureNonce,issuedAt,expiresAt,signature}`。
`decision` 必须被签名/MAC 覆盖，reject/timeout 永远不能铸 receipt。
`humanActor` 由登记的窗口/客户端或主进程 user session 派生；host 自报 actor、
boolean、renderer id、过期 nonce 和未知 attestation kind 一律在铸 receipt 前拒绝。
具体 owner 是 `electron/productionRun/productionRunIntentLog.ts`，路径为
`path.join(productionRunPaths(projectDir, runId).dir, 'intents.ndjson')`（即
`.nomi/runs/<runId>/intents.ndjson`）；记录
`{intentId,runId,kind,key,payloadHash,status:'prepared'|'committed'|'aborted',
createdAt,committedAt?,seq,prevHash,fencingEpoch,keyId,mac}`。MAC key 由 app-owned
keyring 管理，旧 key 只能验历史记录；普通 SHA/checksum 不能作为信任根。
恢复先严格校验 MAC/链序/fencing，再 replay 未提交 intent，最后开放 projection；
半写、篡改、重复 commit 或旧 writer 一律 `migration_parse_error`/`needs_attention`，
不得静默截断、备份或改写原件。approval→event、reservation→
grant、provider accepted→response、materialize rename→receipt 和 artifact.add
→projection 的 crash fixture 都必须覆盖。`submissionOutbox` 的 P3 claim 不再
依赖进程内 `inflight`：它作为同一 intents.ndjson 中的 `provider.submit`
prepare/commit 记录，由 Run intent replay 恢复。Asset store 的 materialization
receipt 写入同一 Run 目录的
`path.join(productionRunPaths(projectDir, runId).dir, 'materializations.ndjson')`，
以 `(immutableProjectUuid,projectGeneration,runId,contractHash,shotId,contentHash)` deterministic key、contentHash、
assetId、status、payloadHash、checksum 去重；receipt 还必须携带同一
`intentId/fencingEpoch/seq/keyId/mac/commitMarker`，不能依赖随机 runtimeTaskId。
envelope/outbox/materialization 只作 sidecar evidence，必须携带同一 intentId、
fencingEpoch、payloadHash 和 commit marker，Run reducer/WAL event 才是 status、
providerTaskId、asset identity 的唯一事实源；sidecar 冲突只能 quarantine，不能
推断成功。

### 3.4 Host planning 与 Skill provenance

当 Claude/Codex/WorkBuddy 等外部 Host 已经提供模型时，Nomi 先通过只读
`nomi_get_generation_context` 返回 schema、能力目录、已选资产摘要和限制，由
Host 生成 `PlanCandidate`；随后必须显式调用唯一写入口
`nomi_operation_create`，再调用 `nomi_submit_generation_plan`。context/read
本身不创建或复用 Run，也不接受 `createDraft` 模式。Host 不能提交批准、provider
task 或质量通过结果；断线时只保留已由 operation/create 创建的 draft，不会静默
切换到另一模型。

Skill 证据必须区分 `discovered`、`loaded`、`applied` 三态，严格使用同一份
`SkillEvidenceV1`（`registryRef/version/bodyHash/registrySnapshotHash/issuer/
keyId/hashAlgorithm/sourceKind/selectedSections/stage`，并按状态补齐
`inputHash/promptAssemblyHash/outputArtifactIds`）。`stage` 只能是
`context|plan|provider|materialize`；source、section 数量/长度、body hash 和
prompt assembly hash 都是闭集/有上限字段。缺失 Skill 不得写
`version: "declared"` 伪装成功，host 不能提交 path、source、version 或 evidence。
P3 只从 hash-pinned built-in Skill registry 读取正文；现有 user-root/markdown
fallback loader 不能成为 P3 authority。`skillEvidenceResolver` 必须截获实际
stage prompt，证明 loaded/applied body hash、selected sections 与最终 prompt
assembly hash 一致；恶意 Skill、网页或资产文本不能扩张 module/tool allowlist。
`SkillEvidenceV1` 的 hash 算法固定为 `sha256`（canonical UTF-8 正文），每个
`registryRef` 必须来自不可变 built-in registry snapshot（含
`registrySnapshotHash/issuer/keyId`），selected section 同时记录有界 byte range
与 hash；`loaded|applied` 必须有 `inputHash`，`applied` 必须有
`promptAssemblyHash`，`materialize` 必须有 `outputArtifactIds`。env/cwd/user-root、
symlink、路径穿越、缺正文或未知字段全部 fail-closed，legacy loader 不得降级写入
`version:'declared'`。最终 stage system/policy prompt 只能由 hash-pinned
module/Nomi resolver 组装；host 只能提供 user-level intent，host 的
`system`/`instruction` 文本永不进入最终 prompt。

已获批准且已有 reservation/provider attempt 的 Run 在外部 lease 过期或
Host 断线后，由 pinned `productionRunResume` 使用 Run-owned internal
authority 继续 poll/reconcile/materialize；新的 context/submit/start/adopt
仍必须重新取得有效 lease。这样不会因 Host 断线遗失合法任务，也不会让
过期 lease 发起新的付费或项目写入命令。Resume capability 不是可序列化 bearer：
主进程 scheduler 只在内存 `Symbol`/closure + `WeakMap` 中签发它，校验闭集
`ResumeCapabilityV1{version,issuer:'productionRunResume',immutableProjectUuid,
projectGeneration,canonicalRootDigest,manifestDigest,runId,playbook,adapterDigest,
fencingEpoch,audience:'main-recovery-worker',nonce,expiresAt,mac}`；root/generation
变化只返回 `needs_attention`，不得继续 materialize，renderer/stdio/host 无法构造。
每次恢复尝试只签发一个 capability；scheduler 先以
`(immutableProjectUuid,projectGeneration,runId,fencingEpoch,nonce)` 做原子 CAS，
再推进 fencing epoch，旧/重复/过期 capability 立即 retire。恢复副作用完成后
再次提交同一 CAS；任何重放或迟到 worker 只能得到 `needs_attention`，不能再次
poll、reconcile 或 materialize。

所有语义工具共用 `McpGenerationError { ok:false, errorCode, summary,
evidenceRefs, nextAction, retryScope, costImpact }`；错误码由主进程注册表
维护，不能在 MCP、GUI、Agent 各自发明 `forbidden`/`needs_user_action` 形状。
Context/compile/preview/gate 在 P3 必须是本地零网络、零上传、零 provider
调用；任何 model-assisted resolver 或远程素材分析都要成为显式 capability
并进入同一成本门。

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
```

`nomi_get_artifact` 与 `nomi_propose_adopt_artifact` 只保留为 P5 后置的
静态兼容名称；本切片通过 `nomi_operation_read` 暴露 Artifact/proposal-ready
provenance，不实现第二个 artifact/adopt owner。

唯一 P3 wire alias registry（名称→owner）如下：

| wire name | owner | 兼容名（P3 一律拒绝） |
|---|---|---|
| `nomi_get_generation_context` | 只读 context/read | — |
| `nomi_session_open` | session/lease binder | — |
| `nomi_operation_create` | deterministic draft | — |
| `nomi_submit_generation_plan` | contract/job/gate | — |
| `nomi_preview_execution` | local preview | — |
| `nomi_operation_read` | Run/Artifact projection | `nomi_get_generation`、`nomi_get_run` |
| `nomi_subscribe_run` | RunEvent projection | `production.events` |
| `nomi_request_generation_gate` / `nomi_decide_generation_gate` | gate/receipt | `nomi_decide_gate`、`production.decide-gate` |
| `nomi_start_generation` | P3 runtime adapter | `nomi_start_playbook`、`production.start` |
| `nomi_cancel_generation` | `operation/interrupt` / cancel | `nomi_control_run`、`production.control` |
| `nomi_reconcile_generation` | `operation/reconcile` / reconcile | `nomi_control_run`、`production.control` |
| `nomi_steer_generation` | pre-seal CAS | `nomi_generate` |
| `nomi_get_artifact` / `nomi_propose_adopt_artifact` | existing Artifact/Proposal | — |

兼容名只可进入隔离的 legacy namespace，不能因 alias miss、payload 相似或裸
`projectId/runId/gateId` 回退到 generic dispatcher。该表与 English plan、design
spec、ADR 共用；GUI、stdio、MCP 与 direct IPC 必须使用同一 resolver。

`nomi_generate` 在迁移期只作为 `legacy` 兼容入口，不能另有一套 provider、预算或资产写入逻辑；未来是否移除旧写语义必须另案通过迁移、回滚和真实任务评审，本切片不删除、不改写旧入口。
dispatcher 先用服务端 session/lease 上的闭集 `playbookNamespace`（唯一的
`generation.single-shot` 或明确的 legacy namespace）分流，再解释方法名；该
字段不由 host 传入。旧 MCP/renderer/stdio 方法若携带任何 P3 binding、operation
correlation、contractHash 或 generation gate 形状，统一返回 `legacy_path_forbidden`；
旧 namespace 不能调用 P3 owner，P3 也不能回退到旧 generic dispatcher。不能从裸
`projectId`、`runId`、`gateId` 或 payload 相似性推断 namespace。

### 4.2 工具曝光策略

P3 的 `tools/list` 保持静态兼容广告，客户端可能提前看到 start schema；实际按 Run/Stage 的动态子集是后置能力。主进程 stage authorization 才是真正安全边界，未通过 gate 的直接调用返回结构化拒绝。flag 关闭时新语义工具返回 `feature_disabled`，旧 `nomi_generate` 的付费/写 Canvas 语义不变；不能把尚未实现的 `tools/list_changed` 写成已完成能力。

`generation.single-shot` 不进入旧 `nomi_start_playbook` 的 playbook enum，
也不接受 generic `production.start/createDraft`、`production.control`（含
resume/cancel）、`production.decide-gate`、`nomi_start_playbook` 或
`nomi_generate` 的 P3 伪装调用；这些旧入口统一返回
`legacy_path_forbidden`，只有 `nomi_operation_create` 能创建 P3 draft；
`nomi_get_generation_context` 仅提供只读 context。
dispatcher 先读取服务端 session/lease 上的闭集 `playbookNamespace`（唯一的
`generation.single-shot` 或明确 legacy namespace），再解释方法名；该 discriminator
不进入 host schema。旧方法若携带 P3 binding、operation correlation、contractHash 或
generation gate 形状统一拒绝，旧 namespace 不得进入 P3 owner，也不得由 alias miss
回退到 `nomi_generate`/generic dispatcher；裸 projectId/runId/gateId 不是路由依据。

下面的生命周期表只是静态产品提示，不是权限或实际工具可见性；真正授权只
取 `ExternalSessionProjectionV1.effectiveScope`。在 schema_only 阶段，表中
任何 write-like 项都返回 `phase_not_ready`/`feature_disabled`：

| 状态 | 可见能力 |
|---|---|
| 静态目录广告（不代表授权） | context、能力查询、计划提交、preview、gate/read schema |
| `schema_only` / P0-P2 未过 | 只读 context/read/events；所有写调用返回 phase_not_ready/feature_disabled |
| `e0_zero_credit`（P0/P2 已过） | create、plan、preview、read、events；不含 start/cancel/steer |
| `e1_paid`（P3 已过且 gate 满足） | E0 全集 + start/cancel/reconcile/steer（按 lease/Run CAS） |
| `closed`（lease 过期/撤销/代际变化） | `effectiveScope:[]`，必须重新握手 |

`ExternalSessionProjectionV1` 的 `closed` 是正式 discriminated variant：
`{phase:'closed',closeReason:'lease_invalid'|'project_scope_changed'|'expired',
effectiveScope:[]}`；不能把空 scope 塞回 `schema_only/e0_zero_credit/e1_paid`，
也不能把缓存的 paid scope 当作授权。

MCP `tools/list_changed` 或模块目录刷新不能改变已冻结 Run 的合同；最多影响下一次 Run。

### 4.3 单镜生命周期

第一片只支持 `generation.single-shot`：一个已审合同、一个 shot、一个 provider job、一个本地 Artifact。支持单参考图或无参考图；首尾帧、音频、多镜头和复杂连续性作为能力条件，缺失时明确 `blocked` 或拆成后续模块，不能填空字符串伪装支持。

生成完成后只登记 Artifact、预览和 proposal-ready provenance，不自动插入剪辑区。
`propose_adopt_artifact` 是 P5 后置命令，本切片不生成 AdoptProposal，也不接入
Canvas/Timeline 写入路径。

### 4.4 外部 Agent 控制面适配（External E0/E1）

PR 中的 Codex/Pi 源码研究见
`docs/audit/2026-08-22-agent-runtime-source-review.md`（研究提交
`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`）。它只提供协议语义，不授权新增
Session、Operation、Event 或 Task 数据库；实现时必须先把该提交固定到本地
research/audit 记录，不能跟随 `main` 漂移。

**E0（P3 前，零额度）**只提供以下协议形状；在 P0/P2 checkpoint 通过前，
所有 write-like 调用（包括 `operation/create`）仍只返回 `phase_not_ready`，
不创建 Run/job/gate：

这些别名只通过现有 MCP `tools/call` 与 Capability Core（GUI/headless 同一
dispatcher）路由，不新增未协商的 JSON-RPC 协议；`tools/list` 的静态广告不等于
授权，stage/lease 服务端拒绝仍是硬边界。
斜杠名称只是生命周期概念，wire catalog 使用合法 typed 名称：
`nomi_session_open`、`nomi_operation_create`、`nomi_submit_generation_plan`、
`nomi_preview_execution`、`nomi_request_generation_gate`、
`nomi_decide_generation_gate`、`nomi_operation_read`、`nomi_subscribe_run`、
`nomi_start_generation`、`nomi_cancel_generation`、
`nomi_reconcile_generation`、`nomi_steer_generation`；它们都走同一 dispatcher
和版本化 schema，不能另起协议。E0 只静态广告 gate 工具并返回 disabled，E1
通过 P3 后才开放 gate request/decision。

MCP `initialize` 仍是唯一协议握手；成功后 `nomi_session_open` 才绑定项目会话，
不是第二个 initialize 扩展。其响应固定为
`{protocolVersion:1, sessionId, leaseHandle, immutableProjectUuid,
projectGeneration, projectId, expiresAt, audience, phase, effectiveScope, serverNonce}`；
`sessionId/projectId/immutableProjectUuid/projectGeneration` 从签名
`projectSelectionHandle` 派生，
host 不得自报。连接一旦绑定 session/lease，重复 initialize、换 handle、降级版本
或未知字段均拒绝。headless 只能通过主进程/GUI 或预登记本地 challenge-response
取得 handle；bearer 只做传输鉴权，不能签发 lease。

`ExternalSessionProjectionV1` 是与 English execution plan 同一份闭集：
`schema_only → effectiveScope:['context','read','events']`；
`e0_zero_credit → ['context','create','plan','preview','read','events']`；
`e1_paid → ['context','create','plan','preview','read','events','gate_request',
'gate_decide','start','cancel','reconcile','steer']`；关闭或撤销后的终态是
`phase:'closed', closeReason:'lease_invalid'|'project_scope_changed'|'expired',
effectiveScope:[]`，不能继续调用 alias。P0/P2 尚未通过时仍投影 `schema_only`，开启 flag 的
写请求返回 `phase_not_ready`，关闭 flag 返回 `feature_disabled`；因此
`operation/create` 在 checkpoint 前也不能创建 Run。

主进程为每条连接生成新的 256-bit `serverNonce`，并在不可导出的
`NonceBindingV1` 中 MAC 绑定 `projectSelectionHandle.sessionNonce`、lease nonce
和 transport connection id；所有 post-open alias 必须回带该连接证明。lease 过期、
撤销、项目代际变化时，resolver 先返回 `lease_invalid`/`project_scope_changed`，
关闭 session 并发布 `effectiveScope:[]`；缓存的旧 projection 不是权限。恢复必须
重新完成 initialize/session-open，不得复制 leaseHandle 跨 transport。

阶段策略也要写死：P0/P2 checkpoint 通过前，任何会写入的 E0 调用（包括
`operation/plan`）都返回 `phase_not_ready`，不追加 Run/job/gate；P0/P2 通过后，
E0 才允许在零额度模式持久化封存合同、authorization-required job 和 pending gate，
但仍不能 reservation、铸 grant、提交 provider 或写 Asset。E1 直到 P3 checkpoint
通过才开启。

策略不是单一 boolean，而是 `schema_only(off 或 checkpoint 未通过)`、
`e0_zero_credit(on 且 P0/P2 已通过)`、`e1_paid(on 且 P3 已通过)` 三态；flag 关闭优先返回 `feature_disabled`，flag 开启但阶段未到
返回 `phase_not_ready`，E1 在 P3 前返回 `not_ready`，之后才做 lease/contract/gate
校验。这样 P0/P2 后可以只开放零额度 `operation/plan`，不会误开付费 E1。

| 外部别名 | Nomi 唯一入口 | 约束 |
|---|---|---|
| `session/open` | initialize + 主进程签发/验证 `ProjectLease` | 收签名 `projectSelectionHandle`，或由已登记客户端走 server-owned `bootstrap:'current_project'`；`projectId`、路径、`trust` 不由请求自报；无花费权限 |
| `context/read` | `nomi_get_generation_context`（read adapter） | 只读、无网络/上传/provider call；服务端固定 `createDraft=false`，host 不能传 mode |
| `operation/create` | `nomi_operation_create` → `createGenerationSingleShotDraft`（仅 P0/P2 通过后） | 创建/复用 deterministic draft Run；不创建 job/gate/provider；与 read adapter 分开 |
| `operation/plan` | `nomi_submit_generation_plan` | 封存合同并原子创建现有 authorization-required ProductionJob + `generation_submit` gate；仍无 provider/spend |
| `plan/preview` | `nomi_preview_execution` | 成本/模型由 Nomi 派生 |
| `operation/read` | `nomi_operation_read`（内部复用现有 Run/Artifact read service） | 脱敏投影；Artifact 详情仍由同一 read owner 提供，不新增事实源 |
| `operation/events` | `nomi_subscribe_run(afterCursor)` | 复用 per-Run `RunEvent.cursor` |

`context/read` 与 `operation/create` 可以共享纯解析器，但不是同一个可写请求
分支：前者只能调用 `readGenerationContext`，即使没有 `runId` 也不创建 Run；后者
才调用 `createGenerationSingleShotDraft`，由服务端计算 selectionHash 并以
deterministic draftKey 原子创建/复用 draft Run。`createDraft`/mode 不进入 host
schema，避免只读请求误触发持久化。
`context/read` 的响应 `mode:'read'` 在没有既有 `runId` 时只给
`nextAction:'create_operation'`；只有 `operation/create` 返回
`mode:'draft_created' + runId + nextAction:'submit_plan'`，因此 submit 永远不会
从只读 context 直接调用。

E0 的 `operationId` 只是外部 correlation；规范化后写入现有 Run intent/command 的
typed `operationRef`，并与 `RunEvent.correlationId` 对齐；ProductionRun repository
维护唯一索引 `(immutableProjectUuid, projectGeneration, operationId) → runId`，并保存 owner 的
`leasePrincipal/sessionId/audience` 及 read/control scope；同项目不同 session
不能仅凭猜到 operationId 就读/控，必须有一次性签名 handoff。它必须持久绑定到现有
`{immutableProjectUuid, projectGeneration, projectId, runId, contractHash?, shotId?, runtimeTaskId?, attempt?}`，且一对一对应
一个 `generation.single-shot` Run；同一 operationId 指向不同 Run/hash 时拒绝，重放
返回原 projection，不允许一个 operation 包含多个 Run。snapshot
与 events 必须由同一读边界返回
`{snapshot, snapshotCursor, events, nextCursor}`；事件在 Run 事实提交后才广播，
`submission_unknown`/`needs_attention` 不能伪装成 `operation/completed`。不得新建
EventStore、Operation DB 或全局 operation lane。跨 session 的读/控只能使用主进程
签发的闭集 `OperationHandoffV1{version,keyId,algorithm,issuer,handoffId,
recipientBinding,recipientProof,operationId,immutableProjectUuid,projectGeneration,
runId,scopes:'read'|'control',audience,issuedAt,expiresAt,oneTimeNonce,mac}`；
其中 `recipientBinding` 只能是已登记 WebContents/frame/origin 或 attested-client
公钥，`recipientProof` 固定包含 `channelNonce/operationId/challengeHash/issuedAt/expiresAt/
macOrSignature`，canonical bytes 覆盖这些字段；没有当前 channel proof/revocation 校验的 copied leaseHandle
一律拒绝。owner session 可在服务端上下文中省略 handoff，跨 session 必须显式
提交它，不能由 host 自造 owner/session 字段。
外部 cursor 是绑定 Run 的 opaque/signed 编码（可以包内部 numeric cursor），不能
猜全局整数或把别的 Run cursor 复用。
其唯一 codec 为 `CursorV1{keyId,projectId,immutableProjectUuid,projectGeneration,
runId,snapshotGeneration,numericCursor,expiresAt,mac}`；serverNonce/session binding
在 alias 边界校验。裸整数、foreign run、错误 key/epoch、过期或超出安全范围的
cursor 都返回 typed error，不得回退到旧 `production.events` endpoint。

`ProjectSelectionHandleV1` 由主进程/GUI picker 唯一签发，结构固定为
`{version,keyId,algorithm:'HMAC-SHA256',issuer:'nomi-main',handleId,immutableProjectUuid,projectGeneration,
canonicalRootDigest,manifestDigest,audience:'nomi-mcp',sessionNonce,issuedAt,
expiresAt,revocationEpoch,scopeSet,mac}`；签名密钥只存 app-owned keychain/app
data，不能由项目目录、stdio bearer 或 renderer 提供。`projectLease.ts` 每次
dispatch 都用 no-follow realpath、manifest digest 和 project generation 做 CAS
复核；删除重建、改名、symlink 替换、manifest 变化或撤销统一返回
`project_scope_changed`。`.nomi/leases/<projectId>/<sessionId>.jsonl`
只是带 MAC 的记录，不是信任根，issue/revoke/replay 必须走共享锁、fencing
epoch 和目录 fsync。`nomi_session_open` 返回的 `serverNonce` 绑定当前连接，后续
alias 必须回带该连接绑定；复制 `leaseHandle` 到另一 transport 不得获得同一
operation 的读/控权限。headless 只能走主进程一次性 challenge 或预登记 client
key 的 challenge-response，不能用环境变量自签 project scope。为降低首次使用
摩擦，`nomi_session_open` 还可接受闭集的
`bootstrap:{mode:'current_project',clientSessionNonce}`：主进程从当前已打开项目
和已登记客户端解析并签发只读 lease；该请求不能指定 projectId/path。第一次
`generation_submit` 再用同一 session challenge 原子升级 scope 并消费 receipt，
不产生第二个可见确认。

别名的最小 typed projection 与 English execution plan 同源：

```ts
ExternalAliasRequest = discriminated union by alias:
  session/open(version:1, projectSelectionHandle? | bootstrap:'current_project') // identity derives in main
  context/read(version:1, leaseHandle, serverNonce, runId?)
  operation/create(version:1, leaseHandle, serverNonce, operationId, runId?, draftNonce?)
  operation/plan(version:1, leaseHandle, serverNonce, operationId, runId, candidate)
  plan/preview(version:1, leaseHandle, serverNonce, operationId, runId, contractHash, handoff?)
  operation/read(version:1, leaseHandle, serverNonce, operationId, runId, contractHash?, handoff?)
  operation/events(version:1, leaseHandle, serverNonce, operationId, runId, afterCursor?, handoff?)
  operation/start(version:1, leaseHandle, serverNonce, operationId, runId, contractHash, actionNonce, handoff?)
  operation/interrupt(version:1, leaseHandle, serverNonce, operationId, runId, contractHash, actionNonce, handoff?)
  operation/steer(version:1, leaseHandle, serverNonce, operationId, runId, baseRevision, candidate, actionNonce, handoff?)
// owner session may omit handoff; another session must supply the main-issued
// OperationHandoffV1 and every control action consumes a server actionNonce with
// the Run fencing CAS.
// Gate calls are canonical typed tools in the same catalog, not slash variants:
nomi_request_generation_gate({version:1, leaseHandle, serverNonce, operationId, runId, contractHash})
nomi_decide_generation_gate({version:1, leaseHandle, serverNonce, operationId, runId, receiptId, handoff: HumanApprovalHandoffV1})
// schema_only/e0_zero_credit returns phase_not_ready or feature_disabled with
// no reservation/receipt; e1_paid additionally requires recipient/channel proof.
ExternalNextAction = 'create_operation' | 'submit_plan' | 'await_human_approval' |
  'start_generation' | 'poll' | 'reconcile' | 'retry_pure_check' | 'new_draft' |
  'adopt_proposal' | 'inspect_artifact' | 'none'
ExternalErrorCode = 'feature_disabled' | 'phase_not_ready' | 'not_ready' |
  'lease_invalid' | 'project_scope_changed' | 'contract_invalid' | 'catalog_snapshot_stale' |
  'gate_required' | 'human_approval_required' | 'approval_invalid' | 'stale_preview' |
  'cost_unknown' | 'provider_unavailable' | 'submission_unknown' | 'stale_revision' |
  'asset_missing' | 'materialization_failed' | 'migration_parse_error' |
  'legacy_path_forbidden' | 'contract_sealed' | 'operation_not_steerable' |
  'new_draft_required' | 'internal_error'
ExternalOperationProjection = {
  operationId: string; immutableProjectUuid: string; projectGeneration: number;
  projectId: string; runId: string; contractHash?: string;
  shotId?: string; runtimeTaskId?: string; attempt?: number; projectRevision: number;
  status: 'draft' | 'awaiting_contract' | 'awaiting_gate' | 'running' |
    'submission_unknown' | 'needs_attention' | 'artifact_ready' | 'adopt_proposed' |
    'completed' | 'failed' | 'cancelled' | 'interrupted'; nextAction?: ExternalNextAction
}

这里的 `ExternalOperationProjection`、`ExternalEventProjection`、
`ExternalErrorCode`、`ExternalEventBase` 都是共享
`ExternalOperationProjectionV1`、`ExternalEventProjectionV1`、
`ExternalErrorCodeV1`、`ExternalEventBaseV1` codec 的本地简称；版本、边界、错误注册表和
type→data discriminated validator 只有一份，不能按文档各自生成未版本化 wire schema。

ExternalEventBase = { eventId: string; cursor: string; runRevision: number; correlationId: string }
ExternalEventProjection =
  | (ExternalEventBase & { type: 'operation.started'; data: { kind: 'started'; stageId: string } })
  | (ExternalEventBase & { type: 'operation.progress'; data: { kind: 'progress'; stageId: string; completed: number; total?: number } })
  | (ExternalEventBase & { type: 'operation.completed'; data: { kind: 'status'; status: 'completed' } })
  | (ExternalEventBase & { type: 'operation.failed'; data: { kind: 'error'; errorCode: ExternalErrorCode; nextAction: ExternalNextAction } })
  | (ExternalEventBase & { type: 'operation.interrupted'; data: { kind: 'status'; status: 'interrupted' | 'cancelled' } })
  | (ExternalEventBase & { type: 'run.status.changed'; data: { kind: 'status'; status: ExternalOperationProjection['status']; nextAction?: ExternalNextAction } })
  | (ExternalEventBase & { type: 'artifact.ready'; data: { kind: 'artifact'; artifactId: string } })
  | (ExternalEventBase & { type: 'needs_attention'; data: { kind: 'error'; errorCode: ExternalErrorCode; nextAction: ExternalNextAction } })
// `data` is not a separately accepted bag: each variant above fixes its
// matching `data.kind`, and cross-product combinations reject.
```

`data` 只能来自脱敏 RunEvent projection；不得让 host 直接提交 status、cursor、
providerTaskId、cost 或 grant。没有 operation binding 的 RunEvent 不向外部投影；
alias discriminator 会拒绝 E0 请求夹带 E1 字段。
外部 status 只是投影：Run 的 draft/awaiting_contract/awaiting_gate/running 直接映射；
materialization + `artifact.add` 后才是 `artifact_ready`，随后才可发
`operation.completed`；明确 provider 终错才映射 `failed`，确认取消才映射
`cancelled/interrupted`，`submission_unknown` 永远保持 unknown/needs_attention。
未知内部状态直接拒绝，不另造第二状态机。
事件只把现有 `MEANINGFUL_EVENT_TYPES` 的真实名称映射到闭集 alias：
`run.created`→`operation.started`；`run.status.changed`、`run.stage.changed`、
`stage.updated`、`job.ready`→`operation.progress`/状态；`gate.*`→等待门状态；
`artifact.ready`→`artifact.ready`；`job.submission_unknown`、
`job.needs_attention`→`needs_attention`。`artifact.add` 是 command，reducer
只会产出 `artifact.ready`，不能作为外部 raw event 名。未绑定、未知或含 secret
的原始事件全部过滤。

**E1（P3 checkpoint 通过后）**才开放提交别名：

- `operation/start` 只能映射 `nomi_start_generation({runId, contractHash})`；必须有 fresh lease、已消费的 `HumanApprovalReceipt`、`generation_submit` target match、reservation、prepared envelope、单次 bound grant、Run-owned outbox claim，并且只能进入 `generationRuntimeAdapter`，不能调用 legacy driver。
- `operation/interrupt` 只能映射显式 `nomi_cancel_generation`：提交前释放 reservation；提交后 cancel/reconcile；`submission_unknown` 保持 unknown/needs_attention，不能标成成功取消。
- `operation/steer` 只允许 seal 前的候选修订（CAS/new draft）；创建真人 challenge 即封存候选。gate pending、receipt consumed、sealed、provider submitted、unknown 和重启恢复中均拒绝修改合同、模型、成本、idempotency 或 providerTaskId，用户必须改走新的 draft/gate。

E0/E1 都复用 `productionRunIntentLog`、`productionRunRuntimeEnvelope`、
`submissionOutbox`、materialization receipt、`productionRunResume` 和 per-run
lock/CAS。Pi `AgentLoopPort` 仍是 P4/P6 的内部适配，不是 P3 provider 路径；右侧
Agent parity 也属于 P4。用户一句话的默认体验仍是“一次预览→一次真人确认→后台生成”，
上述别名是 Host 编排接口，不要求用户学习内部阶段名。

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

**交付：** 上述 MCP 工具、一次 typed gate、单镜真实 Job、Artifact/preview；P3 先验收外部 MCP，Nomi 右侧 Agent parity 作为 P4 适配同一 semantic dispatcher，不复制 provider/gate。

首片新增的是 `generation.single-shot` 最小 playbook（不是复用
`brand.promo` 的 direction gate）；`operation/create` 并发调用通过 deterministic
draftKey、持久化 draft-key 索引和 per-run lock 复用同一个 Run。同一
`(runId, contractHash, shotId)` 即使 commandId 不同也返回原 receipt，不能
只依赖现有 commandId 去重。provider 调用前由主进程从
`generation_submit` receipt 铸造既有 spendGrant，重启/unknown 只允许
reconcile。

`generation.single-shot` 只认固定 stage：
`context(draft) → plan.submit(plan_submitted) → human receipt(ready_to_submit)
→ dispatch(running) → settle(artifact_ready|submission_unknown|needs_attention)
→ proposal(adopt_proposed)`；不继承 `brand.promo` 的 direction/assemble/export
hook。相同 `(runId, contractHash, shotId)` 即使 commandId 不同也返回原
receipt；同一 draft 已 sealed 后提交不同 hash 必须返回
`new_draft_required`，不得在一个 Run 再造第二 Job/Gate。

这些语义 stage 投影到现有状态，不新造第二套 status：

| stage | Run | Stage | Job |
|---|---|---|---|
| context | `draft` | `pending` | 无 |
| plan.submit | `awaiting_contract` | `awaiting_gate` | `authorization_required` |
| human receipt | `ready` | `awaiting_gate` | `authorized` |
| dispatch | `running` | `running` | `submit_intent_persisted → submitting → provider_accepted/polling` |
| settle | `running`/`needs_attention` | `completed`/`needs_attention` | `ready`/`submission_unknown`/`needs_attention` |
| proposal | `running`（P3 保持现有合法转移，P5 采用/关闭后再结束） | `completed` | `ready` |

`stageId/nextAction` 保存 P3 语义标签；`submission_unknown`、
`needs_attention` 绝不能投影为 `completed`；P3 不强行触发当前状态机不允许
的 `running→ready`，legacy stage 也不能进入 P3 adapter。

恢复入口先按 playbook 分流：`generation.single-shot` 完全跳过旧
`resumeUnfinishedRuns` 的扫描和状态改写，交给 pinned
`productionRunResume` reconcile；读取 projection 不能触发任何旧
`driveGeneration`/arrange/export 副作用。

真人 receipt 消费后，主进程先写 reservation，再通过
`mintGenerationSpendGrant({runId, projectId, contractHash, shotId, attempt,
maxAttemptsPerJob: policy.maxAttemptsPerJob, reservationId})` 铸令牌（P3 一个
ProductionJob 对应一个 shot）；`consumeGenerationSpendGrant`
再次校验完整 sealed context，foreign grant、重复 attempt、崩溃后仅凭 approval
重铸都拒绝。provider 成功/失败/cancel/unknown 分别写 settle/release/
unsettled ledger，unknown 只能 reconcile。

**测试与证据：** real Electron stdio + real MCP client、零额度 fake provider、progress、cancel、restart、duplicate callback、submission_unknown、跨项目拒绝。真实 provider smoke 使用独立 `tests/ux/mcp-generation-single-shot.real-provider.mjs`，在 P3 checkpoint 通过后以显式 provider/model/feature flag/cost ceiling/receipt 运行；凭证或成本未知时为 `blocked`。

**退出条件：** 真实外部 MCP host 从 context 到 artifact 完整走通；批准前 providerCalls=0；fake provider raw submit=1；重启不重复扣费；Artifact 可在项目中重开读取。真实 provider smoke 是独立证据附录，不得用 mock 结果冒充媒体完成。

### P4：生产恢复与受控扩展

**交付：** 在 P2/P3 已验证的 `ProductionJob.executionBinding`、reconcile/cancel/lease 基础上扩展有限并发、波次和局部重试；不把 binding/lease 继续当作 P4 的未实现前置。

**测试与证据：** fault injection（503、进程崩溃、断线、迟到回调、provider unknown）、预算 reservation/settlement、依赖波次；不放宽 QA 阈值。

**退出条件：** 所有终态都有结构化 error/nextAction/receipt；retry scope 不会误重跑已提交 provider job。

### P5：剪辑区 Adopt 窄接入

**交付：** Artifact → EditProposal → Apply/Undo 的最小桥；时间轴仍是现有事实源，必要时只做 projection/adapter，不启动全量 EditorDocument v2。

Proposal 的幂等键为 `(runId, contractHash, artifactId, artifactVersion,
baseRevision, destination)`；重复请求返回原 Proposal，revision/asset 变化
返回 stale/needs_attention，不创建竞争提案。P3 只登记 Proposal，不写时间轴。

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

- P0–P3 只新增受 feature flag 控制的语义入口；现有 `nomi_generate` 仍是已存在的付费/Canvas 写入兼容路径，必须显式标为 legacy，不能误称只读，也不能与新路径双写项目事实。
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

1. 本实施基线已由用户确认；中文架构入口是本文件。
2. 已使用 writing-plans skill 生成 `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`；每个步骤都写精确文件、失败测试、命令、预期输出、commit 和回滚点。
3. 实施计划按 P0→P3 先交付第一条闭环；P4–P7 只保留依赖和进入条件，不提前开工。
4. 每批完成后保存 `PhaseEvidence`、六角色 verdict、对抗报告和截图/媒体证据，用户复核后才进入下一批。
5. 最终发布前再做一次综合六角色评审、独立对抗评审、真实 MCP host 矩阵和完整 gates；没有证据的“完成”不成立。

## 10. 外部架构对账

本设计吸收了以下只读审查结论：Claude Code 的 Skill/MCP/Subagent/Workflow/Hook 分层；Codex 的 per-step tool router、Thread/Turn/Item 事件和审批；Hermes 的动态 registry、Skill bundle、SQLite recovery；Pi 的动态 extension 与渐进 Skill（但不复制其无 sandbox 和未完成 durable harness）；DeepSeek Harness 的 pluginized runtime、typed tool layer、approval service 和动态 workflow seam。共同结论是：固定 runtime 不变量，动态能力目录，副作用前冻结合同；不把 Skill 文本当安全边界，也不把会话日志当付费 Job 真相。


## 11. 本轮对旧“大方案”的归一改动

旧版 1726 行方案仍保留产品路径、用户任务、音频、动效、六角色和 J1–J11 验收素材，但它原先把完整 EditorDocument、Timeline 迁移、生成 Job、MCP 和 Renderer 放在同一个大批次，执行顺序过宽，也会复制现有 Runtime/ProductionRun/Asset owner。本版做以下不可混淆的调整：

| 旧方案内容 | 本版处理 |
|---|---|
| 完整 EditorDocument/Timeline v2、剪辑区 Agent | 移到 P7；P3 只生成 Artifact + proposal-ready provenance，不自动改剪辑区 |
| 新建 GenerationJob/AssetRegistry/第二个 Run | 删除；复用现有 ProductionJob、RuntimeTask、Asset store |
| Workflow 预先写死整条做图/做视频流程 | 降为 Recipe/模块建议；每次运行由模块目录 + Skill + 能力 + 用户上下文编译 ExecutionContract |
| HyperFrames/Remotion | P6 独立 Renderer 子项目，不阻塞 MCP 首片 |
| 旧裸 `nomi_generate` | 保留兼容语义；新高层工具必须经过统一 Contract/ProductionRun/generation_submit gate |
| 一次性六镜/30 秒验收 | 先做 `generation.single-shot`，通过后再进入多镜、音频、粗剪和导出 |

本版的硬边界是：**固定 Runtime 不变量，动态模块组合，副作用前冻结合同；不要把模型临场生成的自然语言计划当作可恢复执行真相。**

## 12. 当前第一条可执行路径

```text
nomi_session_open (verified project-selection handle
  or registered-client bootstrap:'current_project')
nomi_get_generation_context
→ nomi_operation_create
→ nomi_submit_generation_plan
→ nomi_preview_execution
→ nomi_request_generation_gate → attested client elicitation (preferred)
  or the same challenge in Nomi GUI (fallback)
→ 主进程铸造 HumanApprovalReceipt → nomi_decide_generation_gate({receiptId}) (generation_submit)
→ nomi_start_generation
→ nomi_operation_read / nomi_subscribe_run / nomi_cancel_generation / nomi_reconcile_generation
```

`gate_request`/`gate_decide` 是 E1/P3 才有效的子 scope，分别对应
`nomi_request_generation_gate` 与 `nomi_decide_generation_gate`；E0 静态广告不授予它们。
`nomi_get_artifact` 与 `nomi_propose_adopt_artifact` 是 P5 后置工具；本切片
只做静态兼容广告，不把它们放进 E0/E1 `effectiveScope` 或真实 P3 journey。
在 Artifact/Proposal checkpoint 前直接调用统一返回 `not_ready`/`feature_disabled`。

约束：

- 计划阶段 `providerCalls = 0`；
- 单次运行 `providerJobs = 1`、`artifacts = 1`、目标为 `project_asset`；
- `ExecutionContract`、`RuntimeTaskEnvelope`、`ProductionJob.executionBinding`、Gate/Approval、Artifact provenance 使用同一 hash/receipt 链；plan.submit 时 binding 为 `envelopeState:'unprepared'` 且没有 `runtimeEnvelopeHash`，真人 receipt+reservation 后才由本地 `prepare` 原子 attach prepared envelope，再进入 grant/submit；
- `contractHash` 只覆盖不可变 pre-submit domain；runtime/provider IDs、status、gate/approval receipt 是 sidecar，不会让已批准合同失效；
- `runtimeTaskId` 由服务端在 prepare 前分配并永远作为 envelope/restart 的 canonical key；`TaskResult.id` 只记录为 upstreamTaskId，providerTaskId 单独保存，不能覆盖 runtimeTaskId；
- prepared envelope 固定写入 `productionRunPaths(projectDir, runId).dir/jobs/<jobId>/envelope.json`，由 `productionRunRuntimeEnvelope.ts` 读回并校验 checksum；不得另造进程缓存路径；
- gate 先绑定一个 authorization-required ProductionJob，再由服务端从 Run/lease 派生 Approval 与 spendGrant；host 不能自带 cost、grant 或 providerTaskId；
- P3 不调用旧 `productionRunDriverOps` 的 arrange/export；
- 进程重启、重复回调、`submission_unknown` 都走持久化 reconcile，不盲目重提；
- 架构目标是外部 host、Nomi 右侧 Agent、GUI/stdio 共用同一 Run/receipt；本切片只验收外部 MCP + GUI/stdio，右侧 Agent parity 后置 P4，审批仍只出现一次；
- P3 完成的是“生成并提出采用”，不是“自动落时间轴”。

## 13. 进入执行前的确认门

在写 P1 代码前，必须完成：

1. P0 基线：干净 sibling worktree、`origin/main` SHA、typecheck/test/gates 结果；
2. Ownership ADR：Runtime/ProductionRun/Asset/Canvas/Timeline 唯一 owner 对账；
3. 六角色 checkpoint：CTO、PM、设计、前端、后端、真实用户各给证据化 verdict；
4. 独立对抗 checkpoint：伪造审批、旧 hash、跨项目、重复扣费、恶意 Skill、旧 driver 旁路；
5. 用户可理解的 P3 预览样例：显示模型/成本/参考图/下一步，但不调用 provider；
6. 任一 P0 未闭合则停在 P0，不得用 mock 绿灯进入付费路径。
