# 模型接入“无死路”架构与全集验证执行总方案

日期：2026-08-15

状态：执行方案 v1；后端、产品与设计终审无剩余 P0/P1。供后续分阶段执行，本文不代表代码已经实现。

基线：origin/main@92865f10（已确认无文档公网网关不再直接失败，ComfyUI 真实用户旅途已合入）。

本文是模型接入改造的单一执行真相源。此前的“模型接入全集用户旅途测试”已经并入本文，不再单独维护第二份架构或验收标准。

## 1. 一句话方案

用户可以从自己已经拥有的材料直接开始：Key、Base URL、Model ID、curl、OpenAPI、请求/响应样例、现成脚本、SDK 示例、ComfyUI workflow 或本地程序都可以成为入口，彼此没有前置关系。

所有入口最终都写入同一份“接入草稿”。草稿分别描述：

1. 模型需要用户提供什么；
2. Nomi 怎样调用它；
3. Nomi 应该得到什么结果；
4. 当前哪里失败、证据是什么、下一步能做什么。

系统内部使用三种执行方式：

- 声明式调用：普通请求模板、上传、轮询和响应映射；
- 自定义脚本：用户直接控制一次模型调用的 HTTP 行为；
- 已安装兼容插件：处理 SDK、网页登录、WebSocket、回调、常驻进程和第三方依赖。

入口并列，执行能力分层。用户不需要先让自动接入失败，才能进入脚本或插件。

## 2. 我们真正承诺什么

### 2.1 可以承诺

- 对当前版本支持的 executor，或已经安装且兼容的插件，只要上游可调用且用户拥有必要权限和材料，就必须有一条能够真实试跑、保存、生成和修复的闭环。
- Nomi 已经支持的输入、协议、生命周期和输出，都有可复跑的真实界面旅途证明。
- 任何执行失败都会保留草稿、凭证引用、素材、请求证据和错误；如果本地持久化本身失败，则明确显示失败并允许导出脱敏现场，不能假装已保存。
- 内部可修复状态至少有一个能够改变状态、减少阻断或把未知错误分类为具体修复动作的真实命令；外部阻断和当前不支持的运行时会给出诚实终态、恢复条件和可保存/导出的现场。
- 新发现一种接法时，先把它固化成失败用例，再扩能力，之后永久回归。

### 2.2 不能承诺

- 不能承诺一个完全未知、没有文档、没有样例、没有可观察请求的模型自动接通。
- 不能替用户解决账号无权限、余额不足、供应商宕机或供应商根本不开放 API。
- 不能把“已保存”“已猜测”“试连成功”说成“真实生成可用”。
- 不能宣称“世界上任意模型都已支持”。全集只指当前版本已经登记的入口、材料、执行能力、错误状态和有效组合。
- 不能因为“未来可以开发插件”就承诺当前能够接入。没有兼容插件时，SDK、登录态、长连接、进程或公网 callback 可以诚实结束为 unsupported_runtime。

外部条件暂时不具备时，用户可以保存、补材料、安装已存在的兼容插件、导出诊断、等待后重试或切换模型，但状态必须诚实显示为不可用或等待外部条件，不能显示绿色成功。“无死路”保证用户不会丢现场、不会陷入假进度和循环按钮，不等于技术上不可能的接法也会被 Nomi 自动变成成功。

## 3. 为什么必须这样拆

一次模型接入包含三个不同问题：

~~~text
用户提供什么              怎么调用上游                Nomi 得到什么
模式、参数、图片、Mask  -> 地址、鉴权、请求、轮询  -> 图片、视频、音频、文本、3D
     Input Contract            Executor                 Output Contract
~~~

当前自定义脚本主要解决中间一段。即使脚本可以改请求字段，如果界面没有收集 Mask，脚本也拿不到 Mask；如果上游必须打开网页登录、安装 Python SDK 或等待公网回调，一次脚本运行也无法完成。

因此不能继续把“模型档案”“调用 mapping”“自定义脚本”和“专属平台实现”分开生长。它们必须归一成同一个按模式执行的契约。

## 4. 最新 main 的真实基线

### 4.1 已经完成

- 无文档的公网媒体网关会使用 OpenAI-compatible 候选草稿继续真实验证，不再把文档当准入证。
- 新模型自检失败时仍能保留候选 mapping，用户可以改地址、重试或选择“我自己接”。
- 连接测试失败后可以二次确认继续保存。
- 无 Key 的自定义网关可以贯穿拉模型、测试和保存。
- 自定义脚本已经可以接管图片、视频、3D 和文本的请求构造、轮询和响应解析，并复用素材本地化、付费确认、资产落地和 provenance。
- ComfyUI 已有从错误地址恢复、导入普通 workflow、真实项目生成、重启恢复和定向取消的生产构建旅途；后续统一 harness 应认证并复用这条证据，不重复造一条较弱脚本。

### 4.2 仍未完成

| 缺口 | 用户后果 |
|---|---|
| 脚本只能附着在已经入库的部分自定义模型上 | 只有一段 curl 或脚本的用户不能从第一步直接开始 |
| 模型模式和输入槽仍主要来自代码内置 archetype | 新模型需要 Mask、Pose、任意角色槽时，用户不能自己表达 |
| references 仍固定投影 firstFrame、lastFrame、images、videos、audios | 未知输入角色会被挤进错误字段或彻底丢失 |
| 自定义脚本按整个模型存一份，不按模式存 | 同一模型文生、图生、全能参考可能需要不同调用却无法独立验证 |
| 编辑器试跑使用固定苹果 prompt，不带真实模式和参考素材 | 试跑成功不等于画布真实调用成功 |
| 试跑不读取编辑器里尚未保存的自定义配置 | 用户刚填的第二密钥或区域在试跑中无效 |
| audio 分支早于 custom-call 派发 | 音频脚本可能试跑成功，但真实画布绕过脚本 |
| 第二密钥等 customConfig 存在普通 metadata 中 | 未得到和主 API Key 相同的加密与全链路脱敏 |
| 脚本 HTTP helper 主要面向 JSON 和 multipart POST | 原始字节 PUT、流式响应、可靠取消等没有稳定契约 |
| 脚本必须在一次运行中等到最终结果 | 关闭应用后不能从 checkpoint 恢复长任务 |
| Provider Adapter 仍有 failed、needs_ai 等终态 | 系统没有全局证明每个失败都存在可执行下一步 |
| WebSocket、SDK、OAuth、callback、CLI 没有统一插件入口 | 只能靠 ComfyUI、Dreamina、Codex 等特定实现 |

### 4.3 当前工作分支处理原则

当前 task/api-onboarding-journey-matrix 分支落后 origin/main，并包含未提交的 capability registry、selector 和测试实验。后续执行不得把这些实验整体提交或据此声称完成：

1. 从执行时最新的 origin/main 创建新的任务分支；
2. 先落本文定义的契约红灯测试；
3. 只选择性复用经过评审的实验代码；
4. 每个 PR 只提交该切片拥有的文件；
5. 禁止直接推送 main，禁止自动合并 PR。

### 4.4 现役开源代码反证

以下源码在 2026-08-15 按固定 commit 复核。它们用于验证架构边界，不作为要引入的运行依赖：

| 项目与版本 | 真实代码说明什么 | Nomi 借什么 | Nomi 不照搬什么 |
|---|---|---|---|
| Dify Plugin SDK `3345471`（2026-08-09） | provider schema 把 predefined/customizable model、表单、credential schema 分开；见 [provider.py#L17-L24](https://github.com/langgenius/dify-plugin-sdks/blob/3345471536c6a438884ac4942a2425b6627567f9/src/dify_plugin/entities/model/provider.py#L17-L24)、[provider.py#L74-L121](https://github.com/langgenius/dify-plugin-sdks/blob/3345471536c6a438884ac4942a2425b6627567f9/src/dify_plugin/entities/model/provider.py#L74-L121)、[provider.py#L193-L212](https://github.com/langgenius/dify-plugin-sdks/blob/3345471536c6a438884ac4942a2425b6627567f9/src/dify_plugin/entities/model/provider.py#L193-L212) | 模型定义、连接凭证和执行实现分层，schema 生成普通 UI | 其 ModelType 仍是固定枚举，不能拿来证明 Nomi 的媒体模式/槽已通用 |
| n8n `0408757`（2026-08-14） | versioned node description 同时声明 inputs、outputs、properties、credentials、poll/webhook；见 [interfaces.ts#L2940-L2963](https://github.com/n8n-io/n8n/blob/040875746dd21a8d678045831fe0f96588e33c05/packages/workflow/src/interfaces.ts#L2940-L2963)。credential 还能限制只给特定 node 解密；见 [interfaces.ts#L379-L414](https://github.com/n8n-io/n8n/blob/040875746dd21a8d678045831fe0f96588e33c05/packages/workflow/src/interfaces.ts#L379-L414) | versioned descriptor、动态表单、凭证最小授权和插件节点 | 大量平台 node 不能变成 Nomi 通用 runtime 的 vendor 分支 |
| ComfyUI `1c6d8d4`（2026-08-14） | V3 IO 允许 extension 定义 custom type，并把 input ID/展示/可选性与 output/list metadata 分开；见 [_io.py#L92-L138](https://github.com/Comfy-Org/ComfyUI/blob/1c6d8d45b3693bfbb32385b410d813a7fd6be216/comfy_api/latest/_io.py#L92-L138)、[_io.py#L160-L190](https://github.com/Comfy-Org/ComfyUI/blob/1c6d8d45b3693bfbb32385b410d813a7fd6be216/comfy_api/latest/_io.py#L160-L190)、[_io.py#L216-L234](https://github.com/Comfy-Org/ComfyUI/blob/1c6d8d45b3693bfbb32385b410d813a7fd6be216/comfy_api/latest/_io.py#L216-L234) | 普通媒体槽由 schema 生成，复杂对象由插件声明和处理 | tensor/conditioning 等进程内对象不能硬塞进 HTTP RuntimeInput |
| Temporal TypeScript SDK `76c3ae4`（2026-08-14） | workflow ID 用于幂等启动，update ID 去重，replay 会检测历史与代码不确定性；见 [workflow-options.ts#L22-L47](https://github.com/temporalio/sdk-typescript/blob/76c3ae4d236a4d91f3d56d4a97d3eb2b66f77363/packages/client/src/workflow-options.ts#L22-L47)、[workflow-options.ts#L98-L107](https://github.com/temporalio/sdk-typescript/blob/76c3ae4d236a4d91f3d56d4a97d3eb2b66f77363/packages/client/src/workflow-options.ts#L98-L107)、[replay.ts#L17-L44](https://github.com/temporalio/sdk-typescript/blob/76c3ae4d236a4d91f3d56d4a97d3eb2b66f77363/packages/worker/src/replay.ts#L17-L44) | SubmissionIntent、幂等 business ID、不可变 ExecutionSpec 和恢复版本校验 | 本方案不因此引入 Temporal；桌面本地任务先实现所需最小语义 |

n8n 的 task runner 还提供了直接的安全反例：它把代码放入独立 runner、做 module allowlist 和 prototype hardening，但核心仍使用 Node `vm`；见 [js-task-runner.ts#L22-L45](https://github.com/n8n-io/n8n/blob/040875746dd21a8d678045831fe0f96588e33c05/packages/%40n8n/task-runner/src/js-task-runner/js-task-runner.ts#L22-L45)、[js-task-runner.ts#L128-L160](https://github.com/n8n-io/n8n/blob/040875746dd21a8d678045831fe0f96588e33c05/packages/%40n8n/task-runner/src/js-task-runner/js-task-runner.ts#L128-L160)。因此 Nomi 的 T05a 验收写能力隔离和逃逸测试，不先把某个 JS context 宣传成强沙箱；具体受限 runtime 选型必须在该 PR 开始时按最新官方文档做 spike，再以本方案的无 ambient capability 合约验收。

## 5. 用户入口：并列直达，不是线性降级

“添加模型”第一层按用户手里的材料组织：

| 入口 | 用户手里有什么 | 系统首先做什么 |
|---|---|---|
| 填写 API 地址 | 平台名，或 Base URL + 按平台要求填写的 Key/Model ID | 协议探测、拉模型；无鉴权时不要求 Key，拉不到时明确还缺什么并允许补材料 |
| 粘贴文档、curl 或请求样例 | curl、OpenAPI、文档片段、请求/响应样例 | 本地结构化解析，生成可编辑候选 |
| 我已经有调用脚本 | 现成脚本，或用户准备自己写 | 创建最小模型草稿，直接进入模式、输入和脚本编辑 |
| 导入 ComfyUI 等工作流 | ComfyUI 等 workflow 文件 | 解析节点/依赖/地址，进入工作流验证 |
| 连接本地程序或插件 | SDK 示例、CLI、已安装插件、网页登录能力 | 检查兼容插件；没有时诚实显示不支持边界 |

此外保留两个上下文入口：

- 已有模型行的“自定义调用”：已知供应商和自定义供应商同等可用；
- 画布失败节点的“修改调用方式”：自动带入原节点模式、参数、素材、请求、响应和错误，保存后回原节点重试。

用户切换入口时只改变编辑方式，不创建第二份草稿，也不丢失已填内容。

## 6. 接入草稿、验证现场与证据模型

所有入口先写同一份草稿，但原始材料不能直接写盘。持久层使用引用关系，避免连接、模型能力、供应商 binding 和验证尝试互相覆盖。

~~~ts
type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

type BoundedBlobRef = {
  id: string
  mime: string
  sizeBytes: number
  sha256: string
  storageClass: "draft-private" | "transcript-redacted" | "output"
  sensitivity: "private" | "secret-redacted"
  encrypted: true
  maxBytesPolicyId: string
}

type SensitiveLocatorRef = {
  redacted: string
  encryptedValueRef?: string
  contentHash: string
}

type IntegrationDraft = {
  schemaVersion: 2
  id: string
  modelDefinitionIds: string[]
  providerConnectionIds: string[]
  modelBindingIds: string[]
  materialIds: string[]
  evidenceIds: string[]
  verificationCaseIds: string[]
  outcomeIds: string[]
  retryTarget?: RetryTarget
  createdAt: string
  updatedAt: string
}

// 只存在于导入事务的内存中，禁止进入 draft store、日志和 AI prompt。
type TransientAccessMaterial =
  | { kind: "connection"; baseUrl?: string; modelIds?: string[] }
  | { kind: "curl" | "openapi" | "docs" | "script"; text: string }
  | { kind: "request-sample"; format: "json-body" | "raw-http" | "har" | "postman"; value: JsonValue | string }
  | {
      kind: "response-sample"
      format: "json-body" | "raw-http" | "har" | "postman" | "text-response"
      value: JsonValue | string
    }
  | { kind: "sdk-sample"; language: string; text: string }
  | { kind: "workflow"; fileName: string; mime: string; bytes: Uint8Array }
  | { kind: "local-program"; locator: string }
  | { kind: "plugin-package"; fileName: string; bytes: Uint8Array }
  | { kind: "plugin-reference"; pluginId: string; requestedVersion?: string }

type StoredAccessMaterial = {
  id: string
  kind: TransientAccessMaterial["kind"]
  redactedText?: string
  redactedJson?: JsonValue
  blobRef?: BoundedBlobRef
  sourceUrlRef?: SensitiveLocatorRef
  locatorRef?: SensitiveLocatorRef
  binaryFingerprint?: { sha256: string; version?: string }
  dependencyEvidenceRefs?: string[]
  pluginMatchEvidenceRefs?: string[]
  contentHash: string
  sizeBytes: number
  createdAt: string
}

type EvidencePayload =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "redacted-json"; value: JsonValue }
  | { kind: "blob-ref"; value: BoundedBlobRef }
  | { kind: "transcript-ref"; transcriptId: string }

type Evidence = {
  id: string
  source: "observed" | "imported" | "inferred" | "user-confirmed"
  subject: string
  payload: EvidencePayload
  confidence: "certain" | "likely" | "unknown"
  sensitivity: "public" | "private" | "secret-redacted"
  contentHash: string
  sizeBytes: number
  createdAt: string
}

type AssetRef = {
  id: string
  origin: "upload" | "library" | "url" | "node"
  locatorRef:
    | { kind: "managed-blob"; blobRef: BoundedBlobRef }
    | { kind: "library-asset"; assetId: string }
    | { kind: "project-artifact"; projectId: string; nodeId: string; nodeRevision: string; artifactId: string }
    | { kind: "external-url"; url: SensitiveLocatorRef; materializedBlobRef?: BoundedBlobRef }
  version: string
  owner: { scope: "verification-workspace" | "project" | "library" | "external"; id: string }
  sourceEvidenceRef?: string
  ledgerEntryId: string
  mime?: string
  sha256?: string
  sourceNodeId?: string
}

type AssetLease = {
  id: string
  ledgerEntryId: string
  holder:
    | { kind: "integration-draft"; id: string }
    | { kind: "verification-case"; id: string }
    | { kind: "execution-attempt"; id: string }
    | { kind: "project-import"; id: string }
  state: "active" | "released"
  expiresAt?: string
  version: number
  createdAt: string
  releasedAt?: string
}

type AssetLedgerEntry = {
  id: string
  resourceKey: string
  managedBlobRef?: BoundedBlobRef
  state: "active" | "pending-delete" | "deleting" | "deleted"
  leaseIds: string[]
  version: number
  updatedAt: string
}

type RetryTarget = {
  projectId: string
  nodeId: string
  nodeRevision: string
}

type ExecutionDestination =
  | { kind: "verification-workspace"; workspaceId: string }
  | { kind: "project"; projectId: string; targetNodeId?: string; targetNodeRevision?: string }

type ExecutionInputSnapshot = {
  schemaVersion: 1
  id: string
  modeBindingId: string
  prompt: string
  parameterSnapshot: JsonObject
  variantId?: string
  orderedInputs: Record<string, AssetRef[]>
  destination: ExecutionDestination
  hash: string
  createdAt: string
}

type VerificationCase = {
  id: string
  modeBindingId: string
  executionInputSnapshotId: string
  executionInputSnapshotHash: string
  executionSpecRevisionId: string
  executionSpecHash: string
  inputLeaseIds: string[]
  transcriptRefs: string[]
  evidenceRefs: string[]
  retryTarget?: RetryTarget
  workspaceId: string
  createdAt: string
}
~~~

安全导入必须是一个事务：

~~~text
raw input（仅内存）
  -> 结构化解析与大小检查
  -> 提取 Key、Token、Cookie、AK/SK 等秘密
  -> 原子写 secret store
  -> 生成已脱敏正文或有界 blob ref + hash
  -> 最后提交草稿
~~~

规则：

- curl、OpenAPI、raw HTTP、HAR、Postman 和 JSON/YAML 样例使用对应结构化解析器，保留可用的 method、URL、headers、status 和 body；解析失败时保留有界、已脱敏文本并让用户手动标注“这是请求/响应”，不能用字符串猜测后静默保存。
- workflow 和插件包先做大小、文件类型与 zip/path traversal 检查，再保存为加密 bounded blob、hash 和依赖证据；导入不等于执行，用户授权和兼容检查前不得加载代码。local-program 只持久化 SensitiveLocatorRef、binary hash、版本与插件匹配证据，不把绝对路径写进普通日志。原文件移动后必须允许重新定位并保留其他配置。
- Evidence 不允许持久化 unknown、任意二进制或无限响应；正文、JSON、transcript 和 blob 分别设置大小上限，二进制只保留 MIME、大小、hash 和受控 blob ref。
- 材料冲突优先级固定为：用户已确认 > 真实请求观察 > 导入材料 > 系统推测。再次导入只生成 diff candidate，不覆盖手工修改。
- 没有文档、没有文本模型或解析失败，都不阻止用户保存、手动定义模式、直接写脚本或选择已安装插件。
- VerificationCase 通过不可变 ExecutionInputSnapshot 保存 prompt、参数、variant、有序 AssetRef/version 和输出目的地；上传到某个供应商后得到的临时 URL 只是单次执行派生值，不是持久化真相。画布调用即使没有 VerificationCase，也必须先创建同样的 input snapshot。
- upload 和 URL 输入进入 VerificationCase 前必须物化为 verification workspace 的 managed-blob locator；原 URL 只作为 SensitiveLocatorRef 和已脱敏 source evidence。library/node 资产也必须建立 ledger entry 与 lease，不能靠手写 refCount 判断删除。
- 创建/重试 attempt 时，在同一事务为全部有序 AssetRef 创建 execution-attempt lease；attempt 到达终态并完成结果落地后才释放。删除 case/workspace 只把自己的 lease 标为 released；仍有 active lease 时底层资源保持 active。
- AssetLedgerEntry.resourceKey 对 canonical managed blob/library/project artifact 唯一，acquire 以 holder + ledgerEntryId 作为幂等键并用 version CAS；同一物理 blob 不得创建两个可独立删除的 ledger 真相源。导入项目必须在同一事务先取得 project-import lease，再释放 workspace lease，失败时保持原 workspace lease。
- GC 只处理“零 active lease”的 pending-delete entry，并用 version compare-and-swap 抢占 deleting；删除 blob 成功后写 deleted，崩溃恢复时按 blob 是否存在幂等收敛。共享资产、pending attempt 与项目导入因此不能被误删。
- 草稿与画布项目分开；从失败节点进入时必须保存 nodeRevision，避免修复完成后把结果重试到已经变化的节点。

## 7. 模型、连接、binding、模式、输入和输出契约

### 7.1 核心实体与不可变修订

~~~ts
type ModelDefinition = {
  id: string
  family: string
  label: string
  billingKind: "text" | "image" | "video" | "audio" | "model3d" | "file"
  modes: ModeDefinition[]
  defaultModeId: string
  variants?: ModelVariant[]
  defaultVariantId?: string
}

type ModelVariant = {
  id: string
  label: string
  parameterDefaults?: JsonObject
}

type ModeDefinition = {
  id: string
  label: string
  taskIntentId: string
  prompt: { required: boolean }
  inputs: InputSlotDefinition[]
  params: ParameterDefinition[]
  output: OutputContract
}

type ResolvedModeContract = {
  schemaVersion: 2
  modeId: string
  taskIntentId: string
  prompt: ModeDefinition["prompt"]
  inputs: InputSlotDefinition[]
  params: ParameterDefinition[]
  output: OutputContract
}

type ProviderConnection = {
  id: string
  providerKind: string
  activeRevisionId?: string // ConnectionRevision ID
  candidateRevisionId?: string // ConnectionRevision ID
}

type SecretVersion = {
  id: string
  secretRefId: string
  encryptedValueRef: string
  createdAt: string
}

type SecretVersionLifecycle = {
  secretVersionId: string
  secretRefId: string
  state: "active" | "retired" | "revoked"
  version: number
  changedAt: string
  reason?: string
  retiredAt?: string
  revokedAt?: string
}

type ConnectionRevision = {
  id: string
  providerConnectionId: string
  baseUrl?: string
  auth: AuthContract
  credentialVersionRefs: Record<string, { secretRefId: string; versionId: string }>
  config: JsonObject
  fingerprint: string
  createdAt: string
}

type ModelBinding = {
  id: string
  modelDefinitionId: string
  providerConnectionId: string
  upstreamModelId: string
  variantBindings: Record<string, { upstreamModelId: string; overrides?: JsonObject }>
  modeBindingIds: string[]
}

type ModeBinding = {
  id: string
  modelBindingId: string
  modeDefinitionId: string
  defaultRevisionId?: string // ExecutionSpecRevision ID
  activeRevisionId?: string // verified ExecutionSpecRevision ID
  candidateRevisionId?: string // unverified/experimental/rejected ExecutionSpecRevision ID
}

type ExecutorRevision = {
  id: string
  modeBindingId: string
  executor: ExecutorDefinition
  configHash: string
  createdAt: string
}

type ExecutionSpecRevision = {
  id: string
  modeBindingId: string
  supersedesRevisionId?: string
  status: "candidate" | "verified" | "experimental" | "rejected" | "migrated" | "default"
  resolvedModeContract: ResolvedModeContract
  upstreamModelId: string
  variantId?: string
  variantBindingSnapshot?: { upstreamModelId: string; overrides?: JsonObject }
  executorRevisionId: string
  connectionRevisionId: string
  verificationCaseId?: string
  verificationEvidenceRefs: string[]
  hash: string
  createdAt: string
}
~~~

SecretVersion 的密文 payload、ConnectionRevision、ExecutorRevision 和 ExecutionSpecRevision 创建后全部字段不可变。SecretVersionLifecycle 是单独的 CAS 投影，只允许 active -> retired/revoked 或 retired -> revoked；每次变化写 append-only audit event，同一 secretRef 同时至多一个 active version。ExecutionSpecRevision 是一次试跑/生成/恢复的完整配置快照，通过不可变 ConnectionRevision 唯一固定当时的 credential versions，不再重复保存第二份 credential refs；它同时固定 resolved mode contract、upstream model/variant 和 executor。指纹只用于校验，快照本身才负责按旧配置恢复。

SecretVersion 轮换时旧版本进入 retired；被非终态 attempt/checkpoint、active spec 或迁移任务引用时不得 GC。retired 版本只允许被已固定的旧 spec 继续使用，不能用于新 spec；revoked 版本任何情况下都不能再解密执行，恢复时必须进入 needs_input 并要求用户显式创建新 spec，不能静默换成最新 Key 后继续旧请求。

用户每次导入、编辑或 AI 建议在组件变化时创建新的 ExecutorRevision/ConnectionRevision，并总是组合成 candidate ExecutionSpecRevision。试跑结果再创建一条 supersedes 原 candidate 的 verified 或 rejected spec，不原地改 status。验证成功后用户点击“保存并启用”，ModeBinding 才原子把 activeRevisionId 指向 verified spec 并清理 candidate 指针。失败 spec 保留证据但不得替换 active；experimental spec 仍由 candidateRevisionId 指向，不成为默认、不显示绿色，并且画布每次真实调用前都要明确确认。验证对象因此是完整执行组合，而不只是“脚本看起来没问题”。模式级输出只存在于 ModeDefinition.output，禁止模型级 outputKind 再形成第二真相源。

模式 ID 和名称允许用户定义。“全能参考”“多参考图”“首尾帧”只是具体模型的模式，不是系统封闭枚举。variant 与 mode 正交；标准版、快速版不复制整套模式，具体供应商的 upstream model ID 只在 ModelBinding 中。

taskIntentId 来自 Nomi 生产 registry 或已安装插件命名空间，用于计费、调度和结果节点；用户可自由定义 upstream mode ID 和 label，但不能伪造系统不认识的 task intent。新输出种类需要插件提供处理和预览能力。

### 7.2 可扩展媒体输入槽

~~~ts
type InputSlotDefinition = {
  id: string
  label: string
  assetKind: "image" | "video" | "audio" | "file"
  semantic?: string
  min: number
  max: number
  ordered: boolean
  accepts?: string[]
  sources: Array<"node" | "upload" | "library" | "url">
}

type RuntimeInput = {
  kind: InputSlotDefinition["assetKind"]
  semantic?: string
  values: AssetRef[]
}

type BindingMerge = {
  order: number
  strategy: "replace" | "append" | "error-on-existing"
  groupId?: string
}

type InputBinding =
  | { kind: "json-field"; slotId: string; target: string; shape: "single" | "array"; merge: BindingMerge }
  | {
      kind: "role-array"
      slotId: string
      target: string
      roleField: string
      role: string
      valueField: string
      merge: BindingMerge
    }
  | { kind: "flat-array"; slotId: string; target: string; position: number; merge: BindingMerge }
  | { kind: "multipart"; slotId: string; field: string; shape: "single" | "array"; merge: BindingMerge }
  | { kind: "process"; slotId: string; argument: string; merge: BindingMerge } // 仅迁移 adapter
  | { kind: "plugin"; slotId: string; bindingId: string; merge: BindingMerge }
~~~

关键规则：

- first-frame、last-frame、mask、source-video、character 等只是可选 semantic，用于默认控件和旧项目迁移，不是固定顶层结构。
- slot ID 可以是 character_images、style_board、depth_map 或任意合法字符串；当前通用值域仍是 image、video、audio、file。
- tensor、复杂结构化对象和新的媒体类型不在“可扩展媒体槽”承诺内，需要插件定义输入处理器，不能宣传为任意输入都已支持。
- 槽只描述用户要提供什么，API 字段名、单值/数组、角色对象、multipart 和上传方式属于 executor binding。
- binding 按 merge.order、slot 内 AssetRef 原始顺序和 flat-array.position 确定性展开；多个 binding 写同一 target 时必须共享 groupId 并明确 append/replace，否则编译时报冲突。禁止依赖对象遍历顺序或静默 last-write-wins。
- 声明式 executor 使用 InputBinding；脚本和插件直接读取 Record<slotId, RuntimeInput>。旧 references 只由 inputs 单向生成兼容视图。

### 7.3 参数和鉴权

ParameterDefinition 复用当前 ModelParameterControl 的能力，但把可持久化范围写死：

~~~ts
type VisibilityCondition = {
  parameterId: string
  operator: "equals" | "not-equals" | "in"
  value: JsonValue
}

type ParameterDefinition =
  | {
      id: string
      label: string
      control: "text"
      required: boolean
      default?: string
      minLength?: number
      maxLength?: number
      visibleWhen?: VisibilityCondition[]
    }
  | {
      id: string
      label: string
      control: "number"
      required: boolean
      default?: number
      min?: number
      max?: number
      step?: number
      visibleWhen?: VisibilityCondition[]
    }
  | {
      id: string
      label: string
      control: "boolean"
      required: boolean
      default?: boolean
      visibleWhen?: VisibilityCondition[]
    }
  | {
      id: string
      label: string
      control: "select"
      required: boolean
      default?: JsonPrimitive
      options: Array<{ label: string; value: JsonPrimitive }>
      visibleWhen?: VisibilityCondition[]
    }

type AuthContract =
  | { kind: "none" }
  | { kind: "bearer"; secretName: string }
  | { kind: "header"; header: string; secretName: string }
  | { kind: "query"; parameter: string; secretName: string }
  | { kind: "multi-secret"; bindings: CredentialBinding[] }
  | { kind: "oauth"; brokerPluginId: string; flow: "browser" | "device-code" | "loopback" }

type ParameterBinding = {
  source: "prompt" | "parameter" | "variant"
  sourceId?: string
  target: string
  encoding: "native" | "string" | "json"
  omitWhenEmpty?: boolean
}

type CredentialBinding = {
  secretName: string
  target: "header" | "query" | "body" | "signature"
  name: string
  transform: "raw" | "bearer" | "template" | "plugin"
}
~~~

可见条件只执行上述有界比较，不执行任意表达式。参数定义不承载供应商字段名。只有 AuthContract 当前要求的 secret 缺失时才阻断；kind:none 的无鉴权网关不能被通用“缺 Key”校验误杀；oauth 只有对应 broker 插件已安装并授权时才是可执行鉴权。connection fingerprint 使用 base URL、auth schema、非秘密 config hash 和 credential version ID 计算，永不包含 secret 明文。

### 7.4 输出

~~~ts
type OutputContract = {
  artifacts: Array<{
    kind: "text" | "image" | "video" | "audio" | "model3d" | "file"
    min: number
    max?: number
    accepts?: string[]
    role?: string
    rendererId?: string
  }>
}

type OutputArtifact =
  | { kind: "text"; text: string; role?: string; metadata?: JsonObject }
  | {
      kind: "image" | "video" | "audio" | "model3d" | "file"
      source: { kind: "url"; url: string } | { kind: "blob"; blobRef: BoundedBlobRef }
      mime?: string
      name?: string
      role?: string
      metadata?: JsonObject
    }

type ExecutionResult =
  | {
      state: "succeeded"
      outputs: [OutputArtifact, ...OutputArtifact[]]
      transcriptRef: string
      evidenceRefs: string[]
    }
  | { state: "pending"; checkpoint: CheckpointEnvelope; progress?: number }
  | { state: "failed"; error: ExecutionError; transcriptRef?: string }
  | { state: "cancelled"; checkpoint?: CheckpointEnvelope }
  | { state: "unknown_submission"; submissionIntentId: string; nextActions: NextAction[] }
~~~

succeeded 必须至少包含一个符合 OutputContract 的产物，并完成下载与解码/渲染证据。旧 URL、数组、image_url、video_url、b64_json 和 text 简写只由兼容归一器读取；raw unknown 不得进入结果或持久层。

## 8. 三种执行器与完整 wire 契约

~~~ts
type NetworkRequestPurpose = "upload" | "create" | "query" | "poll" | "status" | "result" | "cancel"

type OperationRiskEvidence = {
  id: string
  executionSpecRevisionId: string
  executionSpecHash: string
  operationId: string
  source: "observed" | "user-confirmed"
  assertion: "nonbillable"
  evidenceRef: string
  createdAt: string
}

type NetworkOperationPolicy = {
  operationId: string
  allowedMethods: string[]
  allowedUrlPatterns: string[]
  minimumSideEffect: "safe-read" | "write-nonbillable" | "write-paid-or-unknown"
  idempotencyBinding?: { kind: "header" | "query"; name: string }
  riskEvidenceId?: string
}

type ExecutorDefinition =
  | { kind: "declarative-http"; config: DeclarativeHttpExecutor }
  | { kind: "custom-script"; config: CustomScriptExecutor }
  | { kind: "plugin"; pluginId: string; handlerId: string }
  | {
      kind: "builtin-adapter"
      adapterId: "legacy-process" | "legacy-comfyui" | "legacy-dreamina" | "legacy-codex"
    } // 仅迁移生成，UI 禁止新建
~~~

### 8.1 声明式调用

~~~ts
type UploadStep = {
  id: string
  slotId: string
  strategy: "multipart" | "signed-put" | "direct-bytes" | "registered"
  createOperationId?: string
  uploadOperationId: string
  resultUrlPath?: string
  bindResultAs: string
}

type Lifecycle =
  | { kind: "sync"; createOperationId: string }
  | {
      kind: "create-poll"
      createOperationId: string
      operationIdPath: string
      pollOperationId: string
      statusPath: string
      pendingValues: JsonPrimitive[]
      succeededValues: JsonPrimitive[]
      failedValues: JsonPrimitive[]
    }
  | {
      kind: "create-status-result"
      createOperationId: string
      operationIdPath: string
      statusOperationId: string
      statusPath: string
      pendingValues: JsonPrimitive[]
      succeededValues: JsonPrimitive[]
      failedValues: JsonPrimitive[]
      resultOperationId: string
    }

type OutputExtraction = {
  operationId: string
  source: "json" | "text" | "bytes" | "header"
  path?: string
  itemPath?: string
  outputKind: OutputArtifact["kind"]
  encoding: "url" | "base64" | "text" | "bytes"
  localization: "none" | "download"
  preview: "text" | "image" | "video" | "audio" | "model3d" | "download"
}

type HttpOperationTemplate = {
  id: string
  purposeHint: NetworkRequestPurpose
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  urlTemplate: string
  headers?: Record<string, string>
  query?: JsonObject
  body:
    | { kind: "none" }
    | { kind: "json"; template: JsonValue }
    | { kind: "multipart" }
    | { kind: "bytes"; slotId: string }
  responseType: "json" | "text" | "bytes"
}

type RetryPolicy = {
  maxQueryAttempts: number
  retryableStatusCodes: number[]
  retryNetworkErrors: boolean
  respectRetryAfter: boolean
  createRetry: "never" | "idempotency-key-only"
  baseDelayMs: number
  maxDelayMs: number
}

type TimeoutPolicy = {
  connectMs: number
  requestMs: number
  pollIntervalMs: number
  totalMs: number
}

type IdempotencyPolicy =
  | { kind: "none"; onUnknownSubmission: "stop-and-confirm" }
  | {
      kind: "header" | "query"
      name: string
      scope: "verification-case" | "execution-attempt"
      onUnknownSubmission: "query-before-retry" | "stop-and-confirm"
    }

type ExecutionError = {
  code: string
  phase: "auth" | "asset" | "upload" | "create" | "poll" | "result" | "download" | "decode" | "persist"
  retryClass: "never" | "safe-query" | "idempotent-create" | "external-recovery" | "unknown-submission"
  messageKey: string
  evidenceRefs: string[]
}

type DeclarativeHttpExecutor = {
  operations: Record<string, HttpOperationTemplate>
  operationPolicies: NetworkOperationPolicy[]
  inputBindings: InputBinding[]
  parameterBindings: ParameterBinding[]
  credentialBindings: CredentialBinding[]
  uploads: UploadStep[]
  lifecycle: Lifecycle
  outputExtractions: OutputExtraction[]
  retry: RetryPolicy
  timeout: TimeoutPolicy
  idempotency: IdempotencyPolicy
}
~~~

它覆盖 JSON、multipart、原始 bytes、同步、create/poll、create/status/result 和受限路径提取，并复用现有 Mapping、HttpOperation、assetIngestion 和 provider adapter。retry 必须区分只读查询和付费 create；timeout 明确 connect/request/poll/total；idempotency 明确 header/key 生成、供应商不支持时的处理以及 unknown_submission 策略。

声明式编译器拒绝在 headers、query、URL 或 body template 中持久化 credential-like 字面值，鉴权必须来自 ConnectionRevision + CredentialBinding；网络 broker 与 script host 使用同一 NetworkOperationPolicy、method 风险下限、redirect/DNS/域名权限和 write intent 规则。声明式优先只是内部维护偏好，用户仍可直接从脚本开始。这些定义的实际持久化 envelope 都带 schemaVersion；禁止函数、任意表达式和平台名分支。

### 8.2 自定义脚本

脚本是受统一代理约束的 HTTP 类模型完整高级路径，按 ModeBinding 保存为不可变修订。

~~~ts
type CustomScriptExecutor = {
  schemaVersion: 2
  language: "javascript"
  source: string
  declaredSecretNames: string[]
  allowedHosts: string[]
  operationPolicies: NetworkOperationPolicy[]
  timeoutPolicy: TimeoutPolicy
  outputContractVersion: number
}

type ScriptAssetHandle = {
  assetRefId: string
  name?: string
  mime?: string
  sizeBytes?: number
}

type ScriptRequestBody =
  | { kind: "none" }
  | { kind: "json"; value: JsonValue }
  | { kind: "bytes"; value: Uint8Array | ScriptAssetHandle }
  | {
      kind: "multipart"
      parts: Array<
        | { name: string; kind: "text"; value: string }
        | { name: string; kind: "json"; value: JsonValue }
        | { name: string; kind: "bytes"; value: Uint8Array; fileName: string; mime: string }
        | { name: string; kind: "asset"; value: ScriptAssetHandle; fileName?: string; mime?: string }
      >
    }

type ScriptHttpResponse = {
  status: number
  headers: Record<string, string>
  body: JsonValue | string | Uint8Array
  transcriptRef: string
}

type ScriptResumeContext = {
  stateSchemaVersion: number
  upstreamOperationId?: string
  state: JsonObject
  previousResponse?: {
    status: number
    headers: Record<string, string>
    transcriptRef: string
  }
  resumedAt: string
}

type ScriptContext = {
  mode: { id: string; taskIntentId: string }
  prompt: string
  params: JsonObject
  inputs: Record<string, RuntimeInput>
  model: { definitionId: string; upstreamId: string }
  connection: { baseUrl?: string; config: JsonObject }
  secrets: { get: (declaredName: string) => string }
  assets: {
    open: (ref: AssetRef) => Promise<ScriptAssetHandle>
    readBytes: (handle: ScriptAssetHandle, maxBytes: number) => Promise<Uint8Array>
  }
  http: {
    request: (request: {
      operationId: string
      purposeHint: NetworkRequestPurpose
      method: string
      url: string
      headers?: Record<string, string>
      query?: JsonObject
      body: ScriptRequestBody
      responseType?: "json" | "text" | "bytes"
    }) => Promise<ScriptHttpResponse>
  }
  poll: (operation: () => Promise<ScriptHttpResponse>, policy: RetryPolicy) => Promise<ScriptHttpResponse>
  sleep: (milliseconds: number) => Promise<void>
  saveFile: (input: Uint8Array, metadata: { name: string; mime: string }) => Promise<BoundedBlobRef>
  pending: {
    create: (input: {
      stateSchemaVersion: number
      state: JsonObject
      upstreamOperationId?: string
      pollAfterMs: number
    }) => Promise<{ state: "pending"; checkpoint: CheckpointEnvelope }>
  }
  signal: AbortSignal
  resume?: ScriptResumeContext
}
~~~

script host 是独立安全边界：脚本在无 Node/Electron ambient capability 的受限 JS runtime 中运行，不提供 fetch、XMLHttpRequest、WebSocket、require、import、process、fs、环境变量或 Electron bridge；只能通过上述注入 API 联网、读资产、取 secret 和保存产物。host 运行在 renderer/main 之外，设置 CPU、内存、响应大小和 wall-clock 上限，并能被主进程硬终止。网络 broker 对初始 URL、DNS 解析结果和每次 redirect 重新检查 scheme/allowedHosts/本地网段权限；poll helper 只允许 broker 最终分类为 safe-read 的 operation，拒绝任何 write，不信任 purposeHint。不得把 Node vm context 单独当安全沙箱。

必须补齐任意 HTTP method、bytes PUT/响应、JSON、text、结构化 multipart、AssetRef 读取、轮询、sleep、saveFile 和 pending 返回。每个请求必须声明稳定 operationId 和 purposeHint，但它只是脚本提供的语义提示，不能降低 host 判定的风险。broker 用 method + 不可变 NetworkOperationPolicy 得到最终 side-effect class：GET/HEAD/OPTIONS 才可能是 safe-read；其余 method 至少是 write；没有可信 non-billable 证据的 write 一律提升为 write-paid-or-unknown。write-nonbillable 必须引用 OperationRiskEvidence，且其 spec/hash、operationId、source 和 assertion 全部匹配；缺失、过期或材料冲突时自动升为 paid-or-unknown。purposeHint 只能把风险提高，不能把 POST/create 伪装成 query 逃过授权。

所有 write 请求，不只 upload/create，都必须在 socket 写出前持久化 SubmissionIntent；write-paid-or-unknown 还必须消费绑定本次请求的 ConsumptionGrant。idempotencyBinding 属于 host 持有的 operation policy，broker 原子生成并注入 key；脚本在 headers/query 中手填 policy 保留字段时直接拒绝，不能自造 key 或 purpose 绕开记录。全部网络经过统一代理、allowedHosts、权限、超时、取消、transcript、错误分类和秘密脱敏；脚本只能读取 declaredSecretNames 中用户已授权的名字，不能拿到整个 secret store。

pending.create 的 state 由 host 校验为有界 JsonObject、加密落盘并生成 opaqueStateRef；恢复前 host 校验 spec/hash、连接、凭证和独占 lease，再把解密后的 state 作为只读 ScriptResumeContext 交给脚本。脚本既拿不到 BoundedBlobRef 读取能力，也不能自行构造 CheckpointEnvelope 或 resume lease。

试跑和画布使用同一个 executor、素材本地化和结果落地路径；audio 也必须先选 executor；当前编辑态（包括尚在自动保存队列中的 config/secret）先原子固化再参与试跑。HTTP MVP 允许脚本在本次会话内通过 poll 等到结果；返回 pending 并跨重启恢复由完整版 script-host checkpoint adapter 提供。远程材料或 AI 生成脚本必须可见，用户明确试跑或启用前不得执行。

### 8.3 插件

SDK、OAuth、WebSocket、gRPC、复杂流、callback、常驻进程、CLI、共享平台逻辑、新输入/输出类型和专属预览属于插件边界，但插件只有“已经存在且兼容”时才是接入出口。

~~~ts
type PluginEffectPolicy =
  | { kind: "host-brokered"; operations: NetworkOperationPolicy[] }
  | {
      kind: "opaque-logical-intent"
      minimumSideEffect: "write-paid-or-unknown"
      queryHandlerId?: string
      idempotencyBinding?: { kind: "argument" | "environment"; name: string }
    }
~~~

插件不能绕过统一副作用账本直接把“handler 返回了 ExecutionResult”当作安全证明。可完全代理的 SDK/网络/进程操作使用 host effect broker：每个 effect 都执行相同的 operation policy、SubmissionIntent、ConsumptionReservation、dispatch lease 和 AcknowledgementEnvelope。无法代理内部副作用的 SDK/CLI/child process 必须采用 opaque-logical-intent：host 在启动整个 handler 前把它作为 write-paid-or-unknown intent 持久化并取得授权；dispatch 后插件崩溃或失联一律进入 unknown_submission，绝不自动重新调用 handler。只有插件提供的 query/idempotency 证据能恢复，用户强制再跑必须创建 replacement intent。

插件只有在隔离和逃逸测试证明全部 effect 都经过 broker 时才能声明 host-brokered；否则默认 opaque。插件返回的 checkpoint、continuation 或 result 仍由 host 与 acknowledgement 原子提交，插件不能自行改 intent/grant/lease。这样即使 v1 不把第三方进程宣传成强沙箱，也不会因重启或崩溃静默重复付费调用。

插件 v1 必须同时具备以下能力后才能计入生产闭环：

- 本地安装、卸载、版本和兼容性检查；
- manifest 声明模型、模式、槽、输出、网络、密钥、文件、进程和登录权限；
- manifest 为每个 handler 声明 PluginEffectPolicy；未声明或证据不足默认 opaque paid-or-unknown；
- 逐项授权、独立 utility/child process 执行、崩溃隔离和可见诊断；
- 固定版本的 starter SDK、脚手架、示例插件和兼容测试工具；
- 依赖随插件打包，不静默 npm/pip install；
- 至少一个仓库外插件通过真实安装、授权、运行、失败修复和产物验证 canary。

桌面 v1 只承诺受控登录窗口、device code、loopback callback 和明确的 broker。必须接收公网 callback 的平台仍是 unsupported_runtime，除非插件自带并声明可用的外部伴随服务。独立进程不宣传为强安全沙箱；远程市场和自动更新不在 v1。

ComfyUI、Dreamina、Codex 在插件 host 完成前使用只读可迁移的 builtin-adapter，之后逐个迁入内置插件；每迁一个才删除对应旧派发。

### 8.4 决策表

| 情况 | 当前结果 | 原因 |
|---|---|---|
| 标准或可模板化 HTTP | 声明式 | 易检查、迁移、脱敏和生成 UI |
| 特殊签名、字段、上传或轮询，但仍是受支持 HTTP | 脚本 | 用户完整控制 HTTP 行为 |
| 普通 HTTP，用户已有脚本 | 脚本直达 | 不强迫先自动识别 |
| SDK、登录、长连接、回调或进程，且有兼容插件 | 安装/选择插件 | 由已验证扩展承载生命周期 |
| 同上，但没有兼容插件 | unsupported_runtime | 保存现场并诚实结束，不能把未来开发算成功 |
| 材料不足，暂时无法判断 | draft 或 needs_input | 列出缺口，仍可手写模式或脚本 |

## 9. 统一运行链路与持久执行

~~~text
画布或 verification workspace 输入
  -> 按 ModeDefinition 校验参数和媒体槽
  -> 固化 ExecutionInputSnapshot；试跑同时固化 VerificationCase
  -> 获取全部 AssetLease 并创建 ExecutionAttempt
  -> 选择 ModeBinding.activeRevision 或明确确认的 candidateRevision
  -> 按 executor 派生供应商临时 URL 或上传
  -> 每个非安全 write 请求前持久化 SubmissionIntent
  -> executeMode(declarative | script | plugin | migration adapter)
  -> 归一并验证非空 OutputArtifact
  -> 下载/落项目或 verification workspace/写 provenance
  -> 解码或渲染验证
  -> 原子更新 acknowledgement/checkpoint 或 result、attempt、revision verification 和 outcome
~~~

~~~ts
type CheckpointEnvelope = {
  schemaVersion: 1
  attemptId: string
  submissionIntentId: string
  upstreamOperationId?: string
  executionSpecRevisionId: string
  executionSpecHash: string
  executionInputSnapshotId: string
  executionInputSnapshotHash: string
  executorRevisionId: string
  connectionFingerprint: string
  credentialVersionFingerprint: string
  idempotencyKey?: string
  opaqueStateRef?: BoundedBlobRef
  resumeLease: { ownerId: string; expiresAt: string; version: number }
  pollAfterMs: number
}

type AcknowledgementEnvelope = {
  schemaVersion: 1
  submissionIntentId: string
  operationId: string
  operationInstanceId: string
  receivedAt: string
  httpStatus?: number
  responseFingerprint: string
  responseTranscriptRef: string
  upstreamOperationId?: string
  durableOutcome:
    | {
        kind: "continuation"
        completedOperationId: string
        completedOperationInstanceId: string
        stepStateRef: BoundedBlobRef
        stepStateHash: string
        nextOperationId: string
        nextOperationInstanceId: string
      }
    | { kind: "checkpoint"; checkpoint: CheckpointEnvelope }
    | { kind: "result"; resultRef: BoundedBlobRef; resultHash: string }
    | { kind: "terminal"; state: "cancelled"; evidenceRef: string }
}

type SubmissionIntent = {
  id: string
  attemptId: string
  operationId: string
  operationInstanceId: string
  purposeHint: NetworkRequestPurpose
  sideEffectClass: "write-nonbillable" | "write-paid-or-unknown"
  executionSpecRevisionId: string
  executionSpecHash: string
  executionInputSnapshotId: string
  executionInputSnapshotHash: string
  executorRevisionId: string
  connectionFingerprint: string
  credentialVersionFingerprint: string
  requestSnapshotRef: BoundedBlobRef
  requestFingerprint: string
  idempotencyKey?: string
  state: "prepared" | "dispatching" | "sent" | "acknowledged" | "unknown_submission"
  dispatchLease?: { ownerId: string; expiresAt: string; version: number }
  acknowledgement?: AcknowledgementEnvelope
  consumptionReservationId?: string
  replacesIntentId?: string
  createdAt: string
}

type Money = { currency: string; value: number }

type ConsumptionGrantScope = {
  id: string
  verificationCaseId?: string
  modeBindingId: string
  executionSpecRevisionId: string
  executionSpecHash: string
  executionInputSnapshotId: string
  executionInputSnapshotHash: string
  executorRevisionId: string
  connectionRevisionId: string
  accountFingerprint: string
  variantId?: string
  parameterSnapshotHash: string
  orderedInputFingerprint: string
  requestFingerprint: string
  expiresAt: string
  reservationIds: string[]
}

type ConsumptionGrant = ConsumptionGrantScope &
  (
    | {
        priceDisclosure: "known-upper-bound"
        pricingEvidenceRef: string
        maxSubmissions: number
        maxTotalAmount: Money
      }
    | {
        priceDisclosure: "estimate"
        pricingEvidenceRef: string
        maxSubmissions: number
        estimatedTotalAmount: Money
        maxTotalAmount?: never
      }
    | {
        priceDisclosure: "unknown"
        pricingEvidenceRef?: string
        maxSubmissions: 1
        maxTotalAmount?: never
      }
  )

type ConsumptionReservationBase = {
  id: string
  grantId: string
  submissionIntentId: string
  state: "reserved" | "committed" | "released" | "unknown"
  createdAt: string
  settledAt?: string
}

type ConsumptionReservation = ConsumptionReservationBase &
  (
    | { priceDisclosure: "known-upper-bound"; reservedUpperBound: Money; settledAmount?: Money }
    | { priceDisclosure: "estimate"; estimatedAmount: Money; settledAmount?: Money }
    | { priceDisclosure: "unknown" }
  )

type ExecutionAttempt = {
  id: string
  verificationCaseId?: string
  retryTarget?: RetryTarget
  executionSpecRevisionId: string
  executionSpecHash: string
  executionInputSnapshotId: string
  executionInputSnapshotHash: string
  executorRevisionId: string
  connectionFingerprint: string
  credentialVersionFingerprint: string
  state: "prepared" | "running" | "pending" | "succeeded" | "failed" | "cancelled" | "unknown_submission"
  submissionIntentIds: string[]
  inputLeaseIds: string[]
  checkpoint?: CheckpointEnvelope
  evidenceRefs: string[]
  createdAt: string
  updatedAt: string
}
~~~

硬规则：

- 试跑和画布只有消费确认、资产归属和展示位置不同，执行核心不得分叉；executor 选择早于媒体类型专用分支。
- 每个非安全 write 请求先写 prepared intent，再获取 dispatch lease 并持久化 dispatching，之后才允许 socket 写出。风险由 broker 按 method + operation policy 保守计算；脚本的 purposeHint 不能降级。恢复时 prepared 且从未获得发送租约才可安全发送；dispatching/sent 一律视为“可能已发送”并进入 unknown_submission，除非幂等键或查询接口证明结果。这样覆盖进程被杀、落盘失败和响应已到但 ack 未写入的窗口。
- 只有供应商 idempotency key 或查询接口的真实证据能证明旧 write 可安全恢复/去重；用户确认永远不能证明旧请求未提交。人工确认只能授权创建新的 replacement intent。safe-read query/poll 可按 RetryPolicy 重试，unsafe method 即使 purposeHint 是 query 也仍走 write 账本。
- 每次 operation 模板调用都有稳定 operationInstanceId。声明式 executor 由 operationId + step ordinal + slot/value ordinal 确定性生成；脚本 host 按同一 spec/input/state 下的 operationId 调用序号持久化分配。相同素材重复出现仍因 ordinal 不同而得到不同 instance；同一 instance 绑定不同 request fingerprint 时直接拒绝。恢复和去重只按 instance，不按模板 operationId 粗略跳过。
- broker 收到 write 响应后，必须在一个持久化事务中同时写 AcknowledgementEnvelope、upstreamOperationId、response transcript，以及 continuation/checkpoint/result/terminal 之一，最后才把 intent 标成 acknowledged。中间 write（signed PUT、registered upload、cancel 前置步骤等）的 continuation 必须固化恢复后需要的派生 binding/step state、completed/next operationInstanceId；恢复时只跳过已完成的 instance，禁止重复上传，也不能误跳过同模板后续素材。blob 使用 content-addressed 方式先落盘、事务只提交引用；任何一步失败都保持 sent/unknown_submission，不允许出现“已 ack 但无法继续”的中间态。
- 每个 write-paid-or-unknown 请求在 intent 提交前原子 reserve 一个 ConsumptionGrant；grant 绑定完整 ExecutionSpec、账号、variant、参数、有序素材和 canonical request fingerprint，而不是供应商临时 URL。任何时长、分辨率、数量、variant、账号、素材或 request 变化都使旧 grant 失效。确认框显示平台、账号、模型、模式、关键参数、提交次数、已知金额上限/估算；价格未知时明确写“金额未知”且 maxSubmissions 必须为 1。用户取消确认不创建 intent/reservation，重复点击只能 reserve 一次。
- reservation 在确认未发送时 release、供应商明确接受/完成时 commit、unknown_submission 时保持 unknown；只有查询证据证明未提交才可 release。known-upper-bound 必须 reserve 明确上限并持续占用金额与次数；estimate 只提供非上限估算并占用次数；unknown 只能授权一次并占用该次数。maxTotalAmount 只在上游提供可信上限时出现，不能把估算冒充消费硬上限，也不能靠 intent ID 数组猜测。
- 人工强制重提 unknown_submission 必须创建带 replacesIntentId 的新 intent，重新消费 grant，并明确显示可能重复扣费；不得把旧 intent 改回 prepared。
- checkpoint 恢复必须加载同一 ExecutionSpecRevision/hash 和 ExecutionInputSnapshot/hash，并校验全部 AssetLease、upstream ID、executor revision、connection/credential revision、idempotency key 和独占 resume lease；不匹配时给出迁移/放弃/按旧 spec 恢复动作，不能套用新配置或当前画布瞬时输入。
- cancelled、failed、pending、succeeded 和 unknown_submission 都是持久状态；关闭应用不等于取消，上游任务可恢复时必须保留 checkpoint。
- 每个模式独立验证、启用和回滚；输出 URL 存活不等于成功，必须有下载、解码或渲染证据。

## 10. “无死路”状态和动作契约

### 10.1 数据结构

~~~ts
type AccessOutcome = {
  id: string
  scope: "draft" | "connection" | "model-binding" | "mode-binding" | "verification" | "execution"
  subjectRef: string
  state:
    | "draft"
    | "needs_input"
    | "ready_to_test"
    | "testing"
    | "usable"
    | "partially_usable"
    | "waiting_external"
    | "unsupported_runtime"
    | "unknown_submission"
    | "attempt_failed"
  evidenceRefs: string[]
  blockingConditions: Requirement[]
  nextActions: NextAction[]
  terminalReason?: string
}

type Requirement = {
  id: string
  kind: "field" | "credential" | "permission" | "asset" | "plugin" | "external-condition"
  scope: AccessOutcome["scope"]
  subjectRef: string
  fieldId?: string
  reasonCode: string
}

type StatePredicate =
  | { kind: "outcome-state"; outcomeId: string; equals: AccessOutcome["state"] }
  | { kind: "revision-exists"; revisionId: string }
  | { kind: "credential-version"; connectionId: string; fingerprint: string }
  | { kind: "node-revision"; projectId: string; nodeId: string; equals: string }
  | { kind: "external-evidence"; evidenceKind: string; present: boolean }

type NextAction = {
  id: string
  scope: AccessOutcome["scope"]
  subjectRef: string
  actionKind: "progress" | "navigate" | "external" | "preserve" | "escape"
  commandId: string
  actor: "user" | "system" | "external-service"
  labelKey: string
  preconditions: StatePredicate[]
  expectedOutcome:
    | { kind: "state-transition"; to: AccessOutcome["state"] }
    | { kind: "blocking-change"; removeRequirementIds: [string, ...string[]] }
    | { kind: "error-classified"; errorCode: string; followUpCommandId: string }
    | { kind: "external-condition"; conditionId: string; recheckCommandId: string }
    | { kind: "preserved"; artifact: "draft" | "diagnostic" | "export" }
    | { kind: "terminal"; terminalReason: string }
  expectedUiEffect?: { viewId: string; focusFieldId?: string }
  idempotencyKey: string
  enabled: boolean
  reasonDisabled?: string
}
~~~

partially_usable 只能由各 ModeBinding outcome 聚合得到，不能手工写成一个模糊的模型状态。NextAction 不携带任意 route/payload；commandId 必须来自生产 command registry，handler 重新校验 scope、subject、actor 和 preconditions。

### 10.2 架构不变量

- 内部可修复的 needs_input、ready_to_test 和 attempt_failed 至少有一个 enabled progress action；如果当前必须先由用户填字段，可先提供 navigate action，但必须同时注册填写后可满足 preconditions 的 submit progress command，Electron 旅途要完成整段“聚焦/填写/提交/状态变化”。
- waiting_external 必须同时有具体外部恢复条件、可执行的 external action 或真实链接，以及恢复后的 recheck progress action。
- 已知兼容插件未安装时属于 needs_input 或 waiting_external，并提供安装后 recheck。没有兼容插件的 unsupported_runtime 必须写 terminalReason，只提供保存/导出/切换模型等 escape；它是诚实终点，不计作“继续接入成功”。
- navigate 只证明用户到达正确控件，不证明问题已解决；preserve、escape、保存和关闭也不能单独证明内部问题无死路。
- progress action 只能声明 state-transition、blocking-change 或 error-classified；其中状态必须进入更接近试跑/可用的状态，blocking-change 必须真实减少或替换阻断条件，error-classified 必须从未知错误变成带具体 follow-up command 的已知错误。新增日志/证据、导出、保存和跳页一律不算 progress。
- 测试必须真实点击 action 并证明上述后置条件；只有按钮、无关新证据或回到同一 failure fingerprint 均不算推进。
- 同一 commandId + subjectRef + failure fingerprint 连续回到原状态时，循环检测必须阻止再次伪推进并升级诊断。
- attempt_failed 是一次尝试证据，失败 candidate 不得覆盖 active revision；实验性启用不改变 verified 状态。
- failed、needs_ai 等旧状态只允许出现在迁移边界；存储失败至少能导出脱敏草稿与诊断。

### 10.3 失败到动作矩阵

| 失败或缺失 | 首个可执行动作 | 诚实备用结果 |
|---|---|---|
| 缺 Base URL、Model ID，或当前 auth 要求的凭证 | navigate 聚焦字段；填写后 submit 才是 progress | 导入 curl/OpenAPI；auth:none 不要求 Key |
| /models 为空但用户知道 Model ID | 手填 Model ID 并试跑 | 更换协议或地址 |
| 只有 URL + Key，/models 不可用且用户不知道 Model ID | 明确显示“还缺模型 ID”，提供已识别平台的真实模型页或粘贴文档/curl | 保留地址和 Key 草稿，换入口继续；不得暗示现有信息已足够 |
| 401/403 | 修改当前 AuthContract 凭证并原地重试 | 展示账号开通条件，waiting_external + recheck |
| 402/余额不足 | 打开明确充值/权限入口 | waiting_external，恢复后按原 case 重试 |
| 404 | 修改 Base URL/endpoint | 带实际 URL 进入调用编辑器 |
| 400/422 | 修改 parameter/input binding | 保留响应，切换 per-mode 脚本 |
| 429 | 按 Retry-After 安全重试 | 保存现场，稍后 recheck |
| 5xx | 重试 query 或切换模型 | 保存并导出诊断 |
| 网络/TLS/代理 | 修改代理或地址并运行连接检测 | waiting_external + recheck |
| 找不到文档或没有文本模型 | 粘贴材料或手写模式/脚本 | 保存草稿，不得失败终止 |
| 模型类型识别错误 | 修改 taskIntent/output contract candidate | 不重接供应商 |
| 素材槽不匹配 | 修改模式或补素材 | 进入槽编辑器 |
| 本地素材不可达 | 选择已支持上传策略/公网 URL | 有兼容插件才显示插件上传 |
| 轮询超时 | 安全继续 query 或从 checkpoint 恢复 | 不确定提交进入 unknown_submission |
| 响应为空/形状未知 | 修改 OutputExtraction candidate | 切换 per-mode 脚本 |
| SDK/依赖且已有兼容插件 | 安装、授权并重新检测 | 插件失败保留诊断和 case |
| SDK/依赖且无兼容插件 | 无伪 progress | unsupported_runtime，导出 starter 包只是 escape |
| OAuth/session 过期 | 通过已安装 broker 重新登录 | 无 broker 时 unsupported_runtime |
| CLI/ComfyUI 不可用 | 选择路径、改地址、检查版本后复检 | 未安装时 waiting_external |
| callback-only | 使用已声明外部伴随服务 | 无可用服务时 unsupported_runtime |
| unknown_submission | 查询 operation/idempotency 状态 | 无法确认时要求用户决定，禁止自动付费重提 |
| 未知错误 | 生成脱敏诊断并进入可编辑 candidate | 记录新兼容案例；不能假绿 |

## 11. 目标界面旅途

### 11.0 设置中心与模型工作区的层级

设置中心不是固定三栏，也不是把“连接列表、模型详情、脚本”做成三个并列设置页面。全局信息架构固定为两层：

```text
设置
├─ 左：全局设置导航
└─ 右：当前设置页
   ├─ 通用：完整单内容页
   ├─ 模型与接入：连接列表 + 当前工作区
   ├─ 网络代理：完整单内容页
   ├─ 文件与保存：完整单内容页
   └─ 关于：完整单内容页
```

桌面端只有“模型与接入”页在右侧内部继续拆成“连接列表 + 当前工作区”；当前工作区再原位切换全部模型、供应商、模型详情、验证、添加流程和调用脚本。其他设置页必须合并模型页的两块内部区域，使用完整内容列，不保留空连接栏，也不显示桌面端多余的“返回设置首页”。帮助与反馈若打开独立帮助窗口，只作为导航动作，不制造空设置页。

从模型与接入切去通用、文件与保存、网络代理或关于时，必须保留当前供应商、模型、标签页、模式、未保存脚本草稿、试跑结果和滚动位置；返回时恢复同一现场。关闭设置与页面内返回是两种不同动作：关闭回到 Nomi 工作区，页面内返回只退一层且不能清空现场。

移动端不展示常驻左栏，使用设置首页承接全局导航。模型路径逐级返回为“调用脚本 → 模型详情 → 供应商详情 → 连接列表 → 设置首页 → 关闭设置”；通用、文件与保存、网络代理和关于只需“当前设置页 → 设置首页 → 关闭设置”。任何返回都不得从脚本直接跳回连接列表。

### 11.1 接入草稿工作区

所有入口进入同一个工作区，但不同时把五套复杂表单摊给普通用户。固定信息架构是：

1. 入口页：填写 API 地址（密钥按平台要求填写）、粘贴文档/curl/请求样例、已有调用脚本、导入工作流、连接本地程序/插件五个并列入口；
2. 左侧进度导航：连接、已有材料、模型怎么用、调用方式、测试，可自由切换且不互相解锁；
3. 顶部只突出一个用户状态：“正在使用”“修改待测试”“测试失败”“已验证”或“当前 Nomi 无法运行这种接法”；
4. 主编辑区只展示当前材料推导出的必要字段；binding、wire、executor、revision ID 和内部枚举只放诊断详情/高级区；
5. 底部每个状态只有一个主动作。导出、诊断和高级动作进入次级菜单；自动保存失败时“保存草稿”是直接可见的恢复动作，不能藏进菜单。

重新导入 curl/OpenAPI/样例时先展示字段差异。用户确认前不得覆盖现有 candidate；切换入口、模式或连接不创建第二份草稿。已知供应商和自定义供应商使用同一工作区，不再把高级能力藏在“自动失败以后”。

工作区对所有脱敏材料、模式、参数、脚本、locator、测试素材选择和 candidate 执行防抖自动保存，并常驻显示“正在保存 / 已自动保存 / 保存失败”。Key、Cookie 等秘密先原子写 SecretVersion，再让草稿引用版本。关闭窗口前 flush 当前版本；失败时明确提示并提供直接保存/导出，不能假装已保存。窗口误关、应用崩溃或重启后恢复最后一次成功持久化的编辑位置和内容；用户点击“测试”时先把当前编辑状态和输入原子固化为 spec/input snapshot，再执行。

E01、E02、E03D、E04Q 和 E05 必须在不展开高级区的情况下完成或清楚知道还缺什么；普通截图不得出现 binding、wire、executor、revision、unsupported_runtime 等内部词。

### 11.2 脚本编辑器

竞品把“模型需要什么”“可用变量”“返回要求”放在脚本左侧，真正作用是把 Nomi 与用户脚本之间的边界持续展示出来，避免脚本写对了 API，却拿错输入或返回 Nomi 不认识的结果。

Nomi 的编辑器采用同一逻辑：

- 左侧分为“输入 / 可用变量 / 返回”三个紧凑区段：输入用缩略图、文件名、顺序和角色显示当前模式的真实测试值，不展示长 URL；返回要求在编辑期间始终可见；
- 右侧编辑脚本和模板；
- 切换模式时左右两侧同步；
- 返回要求来自运行时同一 contract，不在 UI 另抄一份；
- 输入槽不再只列 firstFrame/images 等固定便利变量；
- 左侧显示的是 ModeDefinition 的可扩展媒体槽，不把 tensor 或插件自定义对象伪装为普通槽；
- 新用户只看当前模式需要的内容，高级细节逐层展开。

这不是现有 640px 模态框内的硬塞分栏。实现必须迁到宽工作区或全屏编辑器：桌面双栏时契约区 280-320px，代码区至少 520px，两区独立滚动且返回要求不会被挤出；可用宽度不足时切换为“输入与返回 / 代码”页签或可呼出的契约抽屉，但代码页顶部始终保留一行固定的返回摘要，完整契约从抽屉展开。1024x768、常见桌面窗口、长模式名、10 个输入槽和 20 个变量都必须通过截图与可操作性测试。

### 11.3 真实试跑与测试区

- 使用当前编辑态的 candidate、config 和 secret，先 flush/固化当前版本，不读取旧 catalog 快照；
- 没有活动项目时自动创建隔离的 verification workspace，界面对用户只称“测试区/测试素材”；用户仍可用上传、素材库或 URL 完成真实试跑；
- 从画布进入时，现有节点连线只作为有版本的只读 AssetRef 快照展示。增删或改边必须回画布操作，编辑器不复制一套假连线系统；
- 本地上传会复制到 workspace 的托管资产区，输入顺序、参数、variant 和 revision 固化为 VerificationCase；供应商临时 URL 不写回；
- 试跑输出先留在 workspace，不自动污染项目。用户可预览、删除；有活动项目时显示“导入当前项目”，无项目时显示“选择项目或新建项目后导入”。取消项目选择不会移动或删除 workspace 产物；导入后生成项目 AssetRef 和 provenance；
- 为了支持重启与同输入重试，资产随草稿保留。删除 VerificationCase/草稿时明确列出将删除的托管输入与输出；已导入项目的副本不受影响；
- 与画布共用 executor、上传、付费确认、结果落地和解码链。普通失败页只显示人话原因和下一步；脱敏 method、URL、headers、body、响应、耗时和错误分类默认折叠在“调用详情”高级区；
- 每个 write-paid-or-unknown 请求都需要一次确认，除非用户明确授予有次数、金额和期限边界的 ConsumptionGrant；确认框显示平台/账号、模型、模式、关键参数、素材数量、本次提交次数、已知价格上限/估算或“平台未提供价格”。任何批量授权默认不勾选；价格、账号、模型、spec、variant、参数或素材变化都让旧 grant 失效。重复点击由 action idempotency key 合并，不能提交两次；
- 关闭或超时时不自动取消或重提。界面依据上游能力使用用户语言提供“关闭窗口，任务继续”或“安全停止任务”。进入 unknown_submission 时明确显示“请求可能已经提交，也可能已经扣费”；唯一主动作是“查询任务状态”。“仍要重新提交，可能重复扣费”作为隔离的危险动作，二次确认后创建 replacement intent，绝不把它当普通重试或默认焦点；
- 失败后保留同一 VerificationCase，编辑只生成新 candidate ExecutionSpecRevision；成功生成 verified spec，用户点击“保存并启用”后才原子切换 active；
- 未成功可以保存草稿。实验性启用持续显示警示、不成为默认、不显示绿色，并且不能覆盖最后已验证 active revision。

unsupported_runtime 在界面上呈现为完整终点页：“哪里不能运行、原因、已经保存了什么、还能怎么继续”。主动作只能是“换一种接入方式”或“选择其他模型”；保存材料和导出诊断是次级动作，不能出现会回到同一错误的“继续”按钮。

### 11.4 从原节点修复

从画布进入时：

1. 自动带入 vendor、model、mode、params、inputs、错误和请求证据；
2. 用户修改模式、binding、脚本、凭证或插件；
3. 保存时只创建该 ModeBinding 的 candidate revision；
4. 点击“回原节点重试”前校验 project/node/nodeRevision；节点已变化时先展示差异，禁止静默覆盖；
5. 使用原参数、原有序 AssetRef 和新 candidate 执行；
6. 同一节点版本、同一素材成功并产生可渲染产物后，用户确认保存才提升 active 并算闭环。

## 12. 凭证、安全和诊断

- 主 Key、第二 Key、AK/SK、Cookie、refresh token 全部进入加密 secret store；普通 config 只存非秘密值。
- secret 采用不可变 version；连接轮换只改变 active version。ExecutionSpec 引用的旧 version 在 pending attempt 结束前保留，用户主动撤销后必须明确让旧任务失效，不能偷偷改用新 Key。
- 所有注册 secret 都参与 transcript、错误、AI 输入、截图和诊断包脱敏，不只替换主 apiKey。
- curl/OpenAPI/样例原文仅在 transient ingestion 中存在；先提取秘密并原子写 secret store，之后才允许提交脱敏材料。
- 文档和响应是非可信数据，不能直接控制文件、进程或自动执行代码。
- 脚本需要明确用户动作才能试跑或启用，只能读取声明并授权的 secret；不做远程脚本自动安装。
- transcript 有长度和二进制上限；二进制只记内容类型、大小和摘要。
- HTTP、插件网络和附加上传域名进入权限清单；默认连接域以外的写请求必须显式可见。
- 诊断包包含版本、模式契约、脱敏请求/响应、状态和下一步，不包含密钥或用户原始私密素材。

## 13. 全集测试的定义

测试不穷举供应商名字，而穷举生产代码和真实 UI 已允许的能力等价类：

- 入口和用户材料；
- 空白设置、已有模型和失败节点三种起点；
- output kind 和 taskIntentId；
- 鉴权；
- executor；
- HTTP/stream/process 生命周期；
- 素材来源、上传和可扩展媒体槽形状；
- 输出形状；
- 错误分类和 NextAction；
- 自动保存、重启恢复、unknown submission、pending resume 和 legacy cutover；
- 每个生产 archetype/mode/variant 的归一化形状。

不能由一份中央 registry 或测试 manifest 自我宣布“全集”。harness 必须独立盘点并交叉对账：

- 生产构建中用户可见的 DOM 入口和动作；
- 持久化 schema 的 discriminator/variant；
- executor、output renderer、slot source 和 command handler 注册；
- 生产错误 discriminated union 与实际 runtime error code；
- built-in archetype/mode/variant 的归一化结果。

生产 registry 仍可用于类型反推和稳定 ID，但只是一份被审计来源。Journey manifest 只能声明预期，是否覆盖以本次运行 trace 为准：

~~~ts
type CapabilityProfile = {
  entryId: string
  originContext: "blank-settings" | "existing-model" | "failed-node"
  materialKinds: Array<StoredAccessMaterial["kind"] | "manual">
  taskIntentId: string
  authKind: AuthContract["kind"]
  executorKind: ExecutorDefinition["kind"]
  uploadStrategies: UploadStep["strategy"][]
  lifecycleKind: Lifecycle["kind"] | "plugin-managed"
  sideEffectClasses: Array<"safe-read" | "write-nonbillable" | "write-paid-or-unknown">
  recoveryKind: "none" | "draft-restart" | "pending-resume" | "unknown-submission" | "legacy-cutover"
  slotShapes: Array<{ assetKind: InputSlotDefinition["assetKind"]; bindingKind: InputBinding["kind"]; ordered: boolean }>
  assetSources: Array<AssetRef["origin"]>
  variantId?: string
  outputKinds: OutputArtifact["kind"][]
  errorCode: string | "none"
}

type JourneySpan = {
  runId: string
  verificationCaseId?: string
  attemptId: string
  executionSpecRevisionId: string
  executionInputSnapshotId: string
  submissionIntentIds: string[]
  profile: CapabilityProfile
  injectedErrorCode?: string
  actions: Array<{
    commandId: string
    preState: AccessOutcome["state"]
    postState: AccessOutcome["state"]
    blockingBefore: string[]
    blockingAfter: string[]
  }>
  wireAssertionRefs: string[]
  renderProofRefs: string[]
  persistenceProofRefs: string[]
  terminalState: AccessOutcome["state"]
}

type JourneyTrace = {
  runId: string
  spans: JourneySpan[]
  entryNavigationEvents: Array<{ entryId: string; commandId: string; uiProofRef: string }>
}
~~~

覆盖门岗计算为：

~~~text
mandatory CapabilityProfile set - passed JourneySpan.profile set = 必须为空
~~~

mandatory profile set 由 DOM/schema/registration/error inventory 交叉生成并显式排除生产代码禁止的无效组合，不由 journey 自己声明。passed 只统计同一 run/ExecutionInputSnapshot/attempt/ExecutionSpec 下同时拥有 wire、render、persistence proof 且达到预期 terminalState 的 span；试跑还必须绑定同一 VerificationCase。manifest 声明了但 span 未经过的 profile 计为 uncovered；taskIntent 和 errorCode 也是 profile key，custom-header、signed upload、create/status/result 和有序媒体槽必须出现在同一个 CapabilityProfile 中，不能对多组 ID 数组做集合拼接。

## 14. 测试分层

### 14.1 契约和属性测试

- 任意合法 slot ID、数量、顺序和来源都能从画布保真进入 executor；
- slot semantic 与 wire binding 分离；
- built-in archetype 与用户自定义契约归一成同一 ResolvedModeContract；
- 旧 first/last/reference keys 只通过兼容投影读取；
- active/candidate 不可变修订满足：失败和实验性 candidate 永不覆盖 verified active；
- transient ingestion 在任何异常点都不会把原始 secret 或超限材料写入草稿；
- workflow/plugin package 的 bounded blob、local-program locator/hash/version/plugin evidence 能重启恢复；路径移动只要求重新定位，不丢其余草稿；
- ExecutionInputSnapshot 对 prompt、参数、variant、有序 AssetRef/version 和 destination 做 canonical hash；VerificationCase 与 canvas attempt 都不能绕过；
- AssetLease acquire/release、项目导入 lease 交接和 CAS GC 的并发/崩溃属性测试不误删共享或运行中资产；
- SecretVersion 的 active/retired/revoked、attempt pin 与 GC 规则成立；revoked 旧任务不能静默换 Key；
- 内部可修复 outcome 有 progress action，waiting_external 有恢复条件与 recheck，unsupported_runtime 有 terminal reason；
- 每个 action handler 执行后达到声明的状态/证据后置条件，循环 action 被检测；
- legacy catalog、customCall 和项目节点迁移不丢模型、模式、脚本或素材。

### 14.2 Executor 合约测试

本地忠实 fixture 覆盖：

- 同步 JSON、文本、base64 和原始 bytes；
- auth:none、bearer、header、query、多段凭证和已安装 OAuth broker；
- multipart、signed URL + PUT、上传后 URL；
- create/poll、create/status/result；
- pending checkpoint、关闭和重启后恢复、resume lease 冲突；
- 所有 unsafe method 均建立 write intent；脚本把付费 POST 标成 query、手填幂等 header/query 或使用未注册 operationId 时都无法绕过 broker/grant；
- write 在发送前、dispatching 落盘后、socket 写出后、响应到达后和 acknowledgement 事务提交前崩溃；除明确未发送外均进入 unknown_submission，fixture 断言上游调用次数；
- acknowledgement、upstreamOperationId 和 durableOutcome 必须原子可见；专门在“ack 响应已收、continuation/checkpoint/result 尚未提交”的边界杀进程，不得留下 acknowledged 空壳；
- signed PUT/registered upload acknowledgement 必须原子保存 continuation；在 upload ack 后、create 前杀进程，恢复后 upload 上游调用总数仍为 1；
- 同一 upload 模板处理多张素材、相同素材重复值和中途崩溃时，每个 operationInstanceId 恰好对应一次上游调用，已完成 instance 被重放、后续 instance 不被误跳过；
- ConsumptionReservation 的 reserve/commit/release/unknown 与金额/次数账本可审计，unknown 保持占用；
- script pending state 经 host 持久化后能从 resume.state 读取；schema/spec/lease 不匹配时拒绝恢复；
- host-brokered 插件 effect 与 opaque plugin/CLI logical intent 分别注入崩溃；前者按 continuation 恢复，后者进入 unknown 且 handler 调用总数仍为 1；
- 取消、分阶段超时、幂等 create、429 Retry-After；
- audio、3D 和多输出；
- SDK、OAuth、WebSocket、CLI 插件的假实现，以及“无兼容插件”的 unsupported_runtime。

fixture 必须校验 method、URL、headers、query、body、上传字节、调用次数和 idempotency key，并返回真实可解码媒体字节，不能只返回一个假 URL。

### 14.3 故障注入

对以下阶段逐一失败：

~~~text
材料识别 -> 文档发现 -> AI 辅助 -> 鉴权 -> 素材读取 -> 上传
-> intent/dispatch lease -> 提交 -> acknowledgement -> 轮询/恢复
-> 结果解析 -> 下载 -> 解码/渲染 -> 保存
~~~

每个失败必须验证：

1. 草稿、素材和证据未丢；
2. 页面存在可执行 NextAction；
3. Playwright 真实点击该动作；
4. 能修复的在原节点重试成功；
5. 外部不可修复的进入诚实 waiting_external 或 unsupported_runtime。

预期注入的 401/422/500 本身不让 runner 失败；未预期错误、断言失败、证据缺失、动作循环，或最终没有达到声明后置状态才非零退出。

### 14.4 真实 Electron 用户旅途

| ID | 用户任务 | 必须证明 |
|---|---|---|
| E01 | 空白用户连接带 Key 的标准 API | UI 接入、选模型、真实试跑和画布产物 |
| E01M | 用户只有 URL + Key，/models 不可用且不知道 Model ID | 明确缺项、保存现场、模型页/粘材料/手写三条真实出口，不假装已连接 |
| E02 | 空白用户粘贴 curl | 无前置失败，直接生成可编辑 candidate |
| E03 | 空白用户导入 OpenAPI | 结构化选择 operation、鉴权、schema 和输出 |
| E03D | 只有一段官方文档片段 | 直接生成有来源证据的 candidate 并可手工补齐 |
| E04 | 只有请求样例和响应样例 | 两份材料合并成 candidate，冲突可见 |
| E04Q | 只有请求样例（JSON 与 raw HTTP 各跑一例） | 保留 method、URL、headers、body，诚实 needs_input 指出缺少输出证据 |
| E04S | 只有响应样例（JSON 与 text/raw HTTP 各跑一例） | 保留 status、headers、body 和输出证据，诚实 needs_input 指出缺少请求/鉴权 |
| E05 | 用户已有一段调用脚本 | 直接创建模型/mode/slot 并进入脚本，不先配 mapping |
| E06 | 无文档、无文本模型，手写模式和脚本 | 保存、真实试跑、失败修复和生成均不被阻塞 |
| E07 | 无鉴权公网或本地网关 | auth:none 拉模型/手填 ID、试跑、保存和生成 |
| E08 | 已知供应商与自定义供应商各改一个模型 | 两类模型使用同一 override 入口和 revision 规则 |
| E09 | 从失败画布节点修改调用 | 原 nodeRevision/参数/有序素材回填并原节点成功 |
| E10 | 没有活动项目时接入并试跑 | verification workspace、重启、资产导入/删除闭环 |
| E11 | 导入 ComfyUI workflow | 工作流入口、地址修复、真实生成和恢复 |
| E11N | workflow 缺 custom node | 显示具体依赖与版本，打开真实管理入口，安装后 recheck 原草稿 |
| E11C | workflow 缺 checkpoint/模型文件 | 定位缺失文件、重新选择或外部安装后 recheck，不丢 workflow blob |
| E11V | workflow/runtime 版本不兼容 | 给出兼容范围和升级/换版本动作，无可行版本时诚实终止 |
| E12 | 选择本地 CLI | 路径/版本/权限检查，经已安装插件真实运行 |
| E12G | CLI 存在但没有兼容插件 | locator/hash 保留，诚实 unsupported_runtime，不把“以后开发插件”算进度 |
| E12P | CLI 路径失效或文件移动 | 要求重新定位；匹配 hash/版本后恢复原配置，错误文件不得静默替换 |
| E12A | CLI 权限不足、未登录或 session 失效 | 区分权限与登录，完成外部动作后 recheck 同一草稿 |
| E13 | 选择已安装兼容插件 | 安装状态、授权、handler、诊断和真实产物 |
| E14 | 导入 SDK 示例且存在兼容插件 | 识别插件、用户确认安装/选择后成功 |
| E15 | 导入 SDK 示例但没有兼容插件 | 保留材料，诚实 unsupported_runtime，不出现假 progress |
| M01 | 同模型文生、图生、全能参考多模式 | 切模式后槽、参数和 per-mode revision 正确 |
| M02 | 单图、多图有序、首尾帧 | slot 数量、角色和 wire 顺序一致 |
| M03 | source video + audio + mask + 自定义 slot ID | 当前四类媒体值保真，不回落固定 references |
| M04 | 上传、素材库、URL 三种独立来源 | 进入同一 RuntimeInput/AssetRef 结构 |
| M05 | 已有画布节点连线 | 编辑器显示只读快照，改边回画布且版本正确 |
| M06 | tensor/复杂对象输入 | 要求插件；无插件时诚实 unsupported_runtime |
| X01 | bearer/header/query/多段密钥 | wire 正确、当前编辑态 secret 原子固化并参与试跑、全链路脱敏 |
| X02 | create/status/result + signed PUT | 三段请求、上传字节、幂等键和产物闭环 |
| X03 | 同步和 create/poll 生命周期 | 状态、重试边界和结果一致 |
| X04 | SDK 插件 | SDK 依赖打包、权限、effect policy、intent/ack 和崩溃防重独立报告 |
| X05 | OAuth 插件 | browser/device-code/loopback 登录、刷新和失效恢复 |
| X06 | WebSocket 插件 | 长连接、进度、取消和断线恢复 |
| X07 | CLI/常驻进程插件 | 启停、stdout/stderr 脱敏、opaque intent 和崩溃后不自动重调 |
| X08 | 必须公网 callback 且无伴随服务 | 明确 unsupported_runtime，不承诺桌面端可收回调 |
| X09T | 文本输出 | 文本非空并进入正确结果节点 |
| X09I | 图片输出 | 下载、尺寸、像素和预览通过 |
| X09V | 视频输出 | 下载、帧解码、时长和播放通过 |
| X09A | 音频输出 | 下载、解码、时长和播放通过 |
| X09D | 3D 输出 | 下载、解析和 canvas 非空像素通过 |
| X09F | 通用文件输出 | 下载、MIME、hash 和可访问入口通过 |
| X10 | pending 后关闭并重启 | checkpoint、连接指纹、revision 和 lease 恢复 |
| X11 | 付费 create 响应丢失 | unknown_submission，不自动重提，查询/人工决定有效 |
| X12 | 用户取消或应用关闭 | cancelled/pending 区分准确，无幽灵重提 |
| X13 | 付费确认时点击取消 | 上游零请求、零 intent、零 grant 消耗 |
| X14 | 试跑按钮双击或连点 | 只有一个 create intent 和一次上游调用 |
| X15 | 授予/耗尽 ConsumptionGrant | 次数、金额、期限和 revision 范围均生效，越界重新确认 |
| X16 | pending 时关闭窗口/应用 | 后台保留、安全取消或 unknown_submission 与用户选择一致 |
| X17 | 脚本尝试原生 fetch/require/process/fs 或越域 | 受限 host 拒绝，零旁路请求并给出可修复诊断 |
| X18 | per-mode 脚本发送 multipart 真实媒体 | AssetRef -> multipart bytes、purpose/intent、响应产物全链闭环 |
| X19 | 脚本把付费 POST 标成 query 并手填幂等键 | broker 提升为 write-paid-or-unknown、拒绝保留字段旁路并要求 grant |
| X20 | 收到 create 响应后、checkpoint/result 原子提交前崩溃 | 不出现 acknowledged 空壳；恢复为可查询的 durable ack 或 unknown_submission |
| X21 | 自定义脚本 pending 后重启 | 同 spec/input/state schema 和 lease 恢复，脚本从 resume.state 继续成功 |
| F01 | 401 | 改凭证后同一 case 成功 |
| F02 | 403 | 区分凭证错误与账号权限，外部恢复后 recheck |
| F03 | 404 | 改 base URL/endpoint 后同一 case 成功 |
| F04 | 400/422 | 改 parameter/input binding 或脚本后成功 |
| F05 | 402/余额不足 | 明确消费阻断，不假重试，充值后 recheck |
| F06 | 429 | 遵守 Retry-After，不重复 create |
| F07 | 5xx | 安全重试规则和现场保留 |
| F08 | 网络/TLS/代理错误 | 修改连接并检测，不丢 candidate |
| F09 | connect/request/poll/total 超时 | 分类、取消、checkpoint 或 unknown_submission 正确 |
| F10 | 空响应 | 修改 OutputExtraction 后成功 |
| F11 | 响应 shape 错误 | 脱敏响应、candidate diff 和重试成功 |
| F12 | URL 存活但媒体损坏 | 解码失败不假绿，修复 mapping 后成功 |
| F13 | curl/OpenAPI 解析失败或无文档 | 原始 secret 不落盘，用户仍能手写继续 |
| F14 | 当前运行时不支持 | terminal reason、保存/导出有效且无循环按钮 |
| P01 | 编辑脚本/参数时关闭或崩溃并重启 | 自动保存状态可见，恢复最后成功版本与编辑位置，不冒充丢失内容已保存 |
| P01F | 草稿/SecretVersion/关闭 flush 写盘失败 | 不显示“已自动保存”；直接保存/导出可见，关闭前明确拦截，重启只恢复最后真实成功版本 |
| P02 | 保存多模式、多密钥模型并重启 | mode、slot、revision、secret 和启用态恢复 |
| P03 | 重启后回原项目生成 | 同一 nodeRevision 和 AssetRef 产物成功 |
| P04 | 删除 override | tombstone 指向 declarative default，不复活 legacy customCall |
| P05 | active 可用时试验失败 candidate | active 仍可用，candidate/证据保留且不变绿 |
| P06 | 手改后重复导入材料 | 只产生 diff candidate，遵守材料优先级 |
| P07 | workspace 资产保留、导入和删除 | 重启可重试、项目副本独立、删除范围明确 |
| P08 | 共享资产或 pending attempt 时删除 case | ledger 只释放本引用；运行中必须先保留或安全取消 |
| P09 | workflow/CLI 选择后重启并移动原文件 | workflow 由加密 blob 恢复；CLI 可重新定位且其他配置/证据不丢 |
| P10 | 项目导入、case 删除和 GC 各阶段崩溃 | 项目 lease 先取得，CAS GC 幂等恢复，无共享/运行中素材误删 |
| P11 | V2 cutover 时存在 legacy prepared/sent/pending/unknown 任务 | 未发送可迁移、已发送不重提、有 operation ID 由旧 adapter drain，零 orphan |

执行约束：

- 使用生产构建和 tests/ux/_launchApp.mjs；
- 接入、配置、上传、连接、修复和重试必须走 DOM；
- bridge 只允许事后只读取证，不能预埋 catalog 或直接执行任务；
- locator 唯一，点击失败不得吞错，等待明确状态而不是固定 sleep；
- 每条旅途隔离 userData/settings/projects；持久性旅途复用同一组目录；
- runner 必须记录实际 entry/mode/slot/executor/error/command trace，声明但未观察到不计覆盖；
- 失败自动保存全窗截图、节点截图、脱敏 wire、DOM 文本、console/page error；
- 图片检查尺寸和非空像素；视频检查可解码帧；音频检查可解码和时长；3D 检查 canvas 非空像素。
- UI 证据覆盖 1024x768 与常用桌面尺寸、长模式名、10 个输入槽、20 个变量和长错误响应；断言无文本/按钮溢出、无内部枚举泄漏、每状态主动作唯一、自动保存关闭可恢复、付费危险动作不默认聚焦。

### 14.5 真实平台 canary

稳定 fixture 和真实平台分开报告，但真实平台不是可以无限跳过的装饰。平台按协议形状选择，不为平台写生产特例：

- 一个 OpenAI-compatible 文本/图片服务；
- 一个 fal-like 非 bearer、上传、create/status/result 服务；
- 一个本地 ComfyUI HTTP/WebSocket；
- 一个音频二进制或 NDJSON 服务；
- 一个异步 3D 服务；
- 一个 SDK/OAuth/CLI 类接法。

其中 ComfyUI 旅途在基线 92865f10 已真实通过，统一 harness 应先对现有脚本做“可判失败认证”并在当前生产构建复跑，而不是重写。T03/T04a/T05a/T07 触碰统一输入和执行路径后，T09-http 必须复跑现役 E11 基础 ComfyUI 真实旅途，以及基线中 Dreamina/Codex/CLI 已存在的 smoke；这只是旧能力非回归门，不冒充插件 host 已完成。fal 等平台只允许出现在研究文档、fixture、canary 配置和测试名中；通用 runtime 模块不得出现平台名分支。

HTTP MVP 至少要求两个不同真实平台、两组独立凭证通过真实 UI canary：一个走声明式、一个走 per-mode 自定义脚本，并真实消费媒体输入和渲染产物。缺凭证时可以发布“fixture 验证构建”，但不得宣称“真实平台可用”或达到 MVP 完成线。完整版对插件、ComfyUI 和新输出类型的每项产品承诺也必须各有对应真实 canary；not-run 永远不计 passed。

两个 HTTP 平台合计至少覆盖三个真实 model/mode 组合，其中至少一个平台在 T00 基线生产代码中从未被硬编码支持，用来反证通用能力。每个 canary 在执行时固定官方 API 文档 URL/版本/抓取日期并逐项对账；官方文档不可得时，可以改用用户提供的 curl/样例或真实可观察 transcript 作为 evidence。既无文档又无任何可观察请求证据时，系统仍允许保存和手写推进，但该模型不能计为 canary passed，禁止凭猜测补字段。

## 15. TDD 实施任务和依赖

### 15.1 依赖图

~~~text
T00 -> T01

T01 -> T02
T01 -> T03
T01 -> T09a（harness 骨架和独立盘点器）

T02 + T03 -> T04a（统一 router、ExecutionSpec、intent 安全）
T04a -> T05a（受限 script host、会话内 HTTP）
T02 + T03 -> T06
T02 + T04a + T05a + T06 -> T07
T07 + T09a -> T09-http（HTTP mandatory journeys + 两个 canary）

T04a -> T04b（durable checkpoint/resume lease）
T04b -> T05b（script pending 跨重启适配）
T02 + T04b + T06 -> T08
T02..T08 + T09a + T09-http -> T09-full
T09-full -> T10
~~~

T02、T03 和 T09a 在 T01 后并行；T06 必须同时消费草稿/动作与媒体输入契约。T04a/T05a/T07/T09-http 形成 HTTP MVP，不等待 durable checkpoint 或插件。T04b/T05b/T08/T09-full 构成完整版，防止跨重启长任务拖住第一条用户价值。

### 15.2 T00：刷新基线并建立红灯

目标：从最新 origin/main 复现所有已知缺口，不携带当前实验分支的未经评审实现。

拥有文件：

- 新增聚焦测试文件；
- 只读生产文件；
- 本文执行结果区。

要求：

- 新建任务分支；
- 写出 audio 绕过脚本、试跑无参考、未保存 config 不生效、无 NextAction、固定 references 的失败测试；
- 写出 workflow/CLI 材料重启丢失、脚本自动保存关闭丢失、canvas attempt 无输入快照、POST 伪装 query、ack/checkpoint 崩溃空洞、upload ack 后 create 前崩溃重复上传、插件/CLI handler 崩溃后重复付费调用、共享素材误删、pending state 无法恢复和 legacy 在途任务 cutover 的独立红灯；
- 保存当前 main 已通过的无文档网关和 ComfyUI 真实旅途证据，防止后续回归。

验收：红灯原因分别指向真实缺口，不能用一条笼统失败代替。

不做：不在 T00 修产品代码。

### 15.3 T01：统一可序列化契约

目标：建立 ModelDefinition、ProviderConnection/ConnectionRevision/SecretVersion、ModelBinding、ModeBinding、不可变 ExecutorRevision/ExecutionSpecRevision、ExecutionInputSnapshot、InputSlot、Executor、Output 和 ResolvedModeContract 单一真相源。

建议拥有：

- electron/modelIntegration/contracts/*
- electron/modelIntegration/normalization/*
- electron/catalog/types.ts 的最小桥接
- src/config/modelArchetypes 的归一出口

接口：

- built-in archetype、provider adapter draft、catalog mapping 和用户草稿都转换为 ResolvedModeContract；
- 渲染层只消费 DTO，不导入 Electron 类型。

验收：

- 所有生产 archetype/mode/variant 均可归一；
- 任意合法媒体槽 ID 可序列化，复杂对象被明确拒绝或路由插件；
- active/candidate revision 原子提升与失败保留属性测试通过；
- spec/input/request/ack 四层快照边界明确，canvas 与 verification 都不能绕过 input snapshot；
- ConnectionRevision 唯一持有 credential version refs，spec 不复制第二份真相；
- schema version 和迁移测试通过；
- 类型从 registry 反推，不维护第二份 union。

不做：不改 UI，不改网络执行。

### 15.4 T02：草稿、证据、秘密和无死路状态

目标：实现 transient ingestion、IntegrationDraft/VerificationCase store、Evidence、AssetLedger/Lease、Requirement、AccessOutcome 和 command registry。

建议拥有：

- electron/modelIntegration/drafts/*
- electron/modelIntegration/outcomes/*
- electron/catalog/secrets.ts 的命名 secret 扩展
- 对应 IPC/bridge 类型

接口：原始材料先脱敏再提交；向 UI 返回有 scope、subject、pre/postcondition 和 idempotency 的 NextAction DTO；handler 只通过统一 command registry 调用。

验收：

- 原始 curl/OpenAPI/JSON/raw HTTP/HAR/Postman/text response 在解析、secret 写入或草稿提交任一点失败都不泄密、不半写，并保真 method/URL/headers/status/body；
- workflow/plugin package 加密有界落盘，local-program locator/hash/version/plugin evidence 可恢复和重新定位；
- 内部可修复状态有 progress action，外部等待可 recheck，不支持状态有 terminal reason；
- 每个 action 的真实 handler 达到后置状态，循环 action 测试失败；
- 多段秘密加密存储并全链路脱敏；
- 防抖自动保存有可见状态，关闭/崩溃后恢复最后成功版本；保存失败时直接保存/导出可用；
- 应用重启后草稿、VerificationCase、ExecutionInputSnapshot、AssetRef/ledger/lease、证据和含 nodeRevision 的 retryTarget 恢复；共享/pending/项目导入下的 acquire/release/CAS GC 属性测试通过；
- 存储失败可导出脱敏草稿。

不做：不渲染最终 UI。

### 15.5 T03：可扩展媒体输入管线

目标：让画布、文件上传、节点连线和 headless 调用都产出同一 RuntimeInput map。

建议拥有：

- src/workbench/generationCanvas/runner/*
- src/workbench/generationCanvas/nodes/controls/*
- electron/catalog/assetLocalization.ts
- electron/catalog/taskParams.ts 的兼容边界

接口：输入为 ResolvedModeContract + 节点状态；输出为 modeId、params 和 Record<slotId, RuntimeInput>。

验收：

- 单图、多图有序、首尾帧、角色、视频、音频、mask 和未知槽全部保真；
- 模式切换不误删其他模式的素材草稿；
- built-in 旧项目视觉和 wire 不回归；
- references 只从 inputs 派生，不再反向成为真相源。

不做：不决定具体 HTTP 字段。

### 15.6 T04a / T04b：统一 executor router、输出与持久执行

目标：在一个 executeMode 入口派发声明式、脚本、插件和迁移 adapter，并统一 TaskResult/ExecutionAttempt。

建议拥有：

- electron/modelIntegration/executors/*
- electron/runtime.ts 的薄接线
- electron/tasks/audioTaskRunner.ts 等旧分支适配
- output normalization、ExecutionSpecRevision、SubmissionIntent 和 durable checkpoint

接口：executeMode 只接收不可变 ExecutionSpecRevision + ExecutionInputSnapshot 和 execution policy，不再接收无法恢复的瞬时 RuntimeInput；VerificationCase、attempt、intent、ack、checkpoint 引用同一 spec/input hash。

T04a（HTTP MVP）验收：

- executor 选择早于媒体类型分支，audio 自定义脚本红灯转绿；
- 试跑和画布能调用同一个入口；
- broker 保守分类 method/operation policy；每个非安全 write 的 prepared -> dispatching lease -> sent/ack 状态可恢复，purposeHint 不能降级；
- acknowledgement、upstream ID、continuation/checkpoint/result 原子落盘；全部崩溃窗口不会形成 ack 空壳、重复上传或重复付费 create；
- unknown_submission 不自动重提，强制重提创建新 intent 和消费 grant；
- ConsumptionReservation 的金额/次数 reserve/commit/release/unknown 可审计；
- 输出类型不再把 audio 当 image；
- 付费、缓存、provenance、取消和 trace 语义不回归。

T04b（完整版）验收：

- pending checkpoint 带 ExecutionSpec/InputSnapshot hash、upstream ID、idempotency、credential fingerprint 和 resume lease 并可重启恢复；
- 旧 spec 所需 credential version 仍可安全读取或给出明确失效动作；
- 关闭、并发恢复、lease 过期和连接/revision 变化不会产生双 worker。

不做：不实现脚本编辑器和插件市场。

### 15.7 T05a / T05b：受限自定义脚本 host v2

目标：把脚本升级为受限、可硬终止的 HTTP 类 per-mode executor，所有副作用只能经过 host broker。

建议拥有：

- electron/catalog/customCallContract.ts
- electron/catalog/customCallRunner.ts
- electron/catalog/customCallDispatch.ts
- electron/modelIntegration/scripts/*
- 受限 JS runtime、script executor adapter 和合约/逃逸测试

接口：以 inputs、mode 和结构化 output 为主；旧变量由兼容适配器提供。

T05a（HTTP MVP）验收：

- arbitrary method、status/headers、bytes PUT/response、结构化 multipart、JSON、text、AssetRef、poll/sleep/saveFile；
- fetch/XMLHttpRequest/WebSocket/require/import/process/fs/env/Electron bridge 均不可用，allowedHosts 绕过测试必须失败；
- 每个请求声明 operationId/purposeHint，method + host-owned operation policy 决定最终风险；所有 unsafe write 有 intent，脚本不能覆盖 broker 的 credential/idempotency 字段；
- 所有请求进入统一 transcript、取消、大小限制和脱敏，CPU/内存/超时可硬终止；
- 每模式脚本形成不可变 candidate，独立验证、提升和回滚；
- 旧 model.customCall 脚本继续工作；
- 不允许远程材料自动执行代码。

T05b（完整版）验收：脚本通过 host pending API 返回 checkpoint，T04b 能按原 ExecutionSpec/InputSnapshot 跨重启恢复；host 校验并加载 bounded JsonObject 到 resume.state，脚本不能自行伪造 envelope、state ref 或 lease。

不做：不处理 SDK、OAuth 或 WebSocket。

### 15.8 T06：UX 样张与并列入口

目标：先基于真实设置页和编辑器截图完成可交互样张并获得用户确认，再实现入口和草稿工作区。

建议拥有：

- docs/design/mockups/*
- src/ui/onboarding/*
- src/workbench/settings/*
- i18n 对应模块

接口：只消费 IntegrationDraft、ResolvedModeContract、AccessOutcome、VerificationCase 和 command registry。

验收：

- 五个入口可直接到达，不互相解锁；
- 切入口材料不丢，重复导入只生成 diff candidate；
- 已知和自定义模型都能打开 override；
- 模式、可扩展媒体槽、参数能用统一控件编辑；
- 左侧常驻当前模式输入、变量和返回要求；
- 脚本使用宽/全屏工作区，280-320px 契约区 + 至少 520px 代码区；窄窗切页签/抽屉；
- 自动保存状态、普通用户状态、左侧导航、单一主动作和折叠高级区符合 11.1；
- 注入草稿、SecretVersion 和关闭 flush 失败时，不假报保存成功；直接保存/导出和关闭拦截按 P01F 工作；
- 1024x768 和常见桌面尺寸下，浅/深色、长模式名、10 槽、20 变量和长错误均无溢出，真实截图人工读取；
- 普通旅途不展开高级区完成，界面不泄漏 binding/revision/unsupported_runtime 等内部枚举。

不做：不在 React 内猜协议或错误类别。

### 15.9 T07：真实试跑和原节点修复

目标：删除 canned test 的证明资格，让试跑成为真实画布执行的前置闭环。

建议拥有：

- custom-call test IPC 的替代接口
- CustomCallEditor/接入草稿验证区
- NodeErrorReport 和 retry intent
- execution transcript UI

接口：调用 T04a executeMode，把当前 editor state flush 后，为真实输入创建不可变 ExecutionSpecRevision + ExecutionInputSnapshot。

验收：

- 自动保存队列中的 config/secret 在试跑前原子固化并参与执行；
- 独立接入可上传/素材库/URL；从节点进入只读现有连线，改边回画布；
- 无项目时使用 verification workspace，成功产物可预览、导入项目或删除；
- 付费确认、重复点击幂等、关闭/超时/unknown_submission 行为有 UI 证明；
- unknown_submission 主动作只查询；危险重提隔离、二次确认且不默认聚焦；授权详情完整、批量授权默认不勾选；
- 失败保留输入，修改后同输入重试；
- 从节点进入、校验 nodeRevision、回到原节点成功；
- 失败 candidate 不替换 active，实验性 candidate 持续警示且不变绿。

不做：不建立第二套测试网络栈。

### 15.10 T08：插件 host

目标：给 SDK、OAuth、WebSocket、CLI 和常驻能力一个统一、诚实的扩展边界。

建议拥有：

- electron/modelIntegration/plugins/*
- plugin manifest schema
- utility/child process host
- permission、secret、progress、checkpoint broker
- 内置 ComfyUI/Dreamina/Codex adapter

接口：插件向 T04b 注册 handler 和 PluginEffectPolicy，输出同一 ExecutionResult；host-brokered effect 使用统一 broker，opaque handler 调用本身使用一个 durable logical intent。

验收：

- 安装/卸载/兼容检查、固定版本 starter SDK、脚手架和示例插件可用；
- SDK、OAuth 续期、WebSocket、CLI、权限拒绝和崩溃隔离合约测试独立通过；
- brokered 插件的每个外部 effect 都有 intent/grant/ack；opaque 插件 dispatch 后崩溃进入 unknown，绝不自动重启 handler；query/replacement 路径通过付费防重测试；
- 依赖随插件打包，不运行时安装；无插件时诚实 unsupported_runtime；
- browser/device-code/loopback 可用；公网 callback 无伴随服务时明确不支持；
- 至少一个仓外插件完成真实安装、授权、执行、失败诊断和产物 canary；
- ComfyUI/Dreamina/Codex 逐个迁入，迁一个才删除一个旧分支；
- 明确记录 v1 不是远程插件强沙箱。

不做：不做公共插件市场、自动更新或任意 React 注入。

### 15.11 T09a / T09-http / T09-full：全集 journey harness

T09a 目标：在实现前建立独立 inventory scanner、协议 fixture、Electron runner 和 span 证据格式。T09-http 在 T07 后执行 HTTP MVP 的 mandatory CapabilityProfile 和两个真实 canary。T09-full 在 T08 后接入插件及 durable registration，执行完整版旅途。

T09-http 还承担现役能力非回归门：复跑已认证的 E11 基础 ComfyUI 生产旅途和基线已有 Dreamina/Codex/CLI smoke。它们在这里仅证明统一 router/input 改造没有破坏旧用户，不计入插件 host 完成率；增强版 workflow/CLI 依赖修复、重定位和插件安装仍由 T09-full 验收。

建议拥有：

- 独立 DOM/schema/executor/error/action inventory scanner
- electron/shared/modelAccessCapabilities.ts（被审计来源，不是唯一全集）
- tests/ux/model-access-journeys/*
- scripts/run-model-access-journeys.mjs
- package scripts

接口：manifest 声明预期 profile；每个 JourneySpan 绑定同一 run/input snapshot/attempt/spec/intent（试跑再绑定 case）和完整 CapabilityProfile，并链接 action、wire、render、persistence proof。

验收：

- mandatory CapabilityProfile set - passed JourneySpan.profile set 为空；T09-http/T09-full 分别出报告；
- 每个 journey 同时产出 UI、wire 和可渲染结果证据；
- 未预期错误、断言/证据/后置状态失败才非零；预期故障注入必须被观测并成功恢复；
- 旧 walkthrough 只有通过“可判失败”认证后才能纳入。

不做：不让 manifest、registry 或插件 manifest 单独自证全集。

### 15.12 T10：迁移、清理、canary 和发布

目标：完成旧数据迁移、删除并行实现、运行全集和真实平台反证。

拥有文件：由前序任务列出待删除清单后独占处理，避免多人同时清理热点。

验收：

- built-in archetype、Mapping、customCall、ComfyUI/Dreamina/Codex 只有一个运行入口；
- cutover barrier 已盘点并冻结 legacy 在途任务：未发送迁移，可能已发送隔离为 unknown，有 operation ID 的由 pinned old adapter drain；在途集合未清空前旧 runtime 不删除；
- 旧 catalog 和项目打开后无需重配；
- E/M/X/F/P 全部 mandatory 稳定旅途通过；
- canary 报告明确区分 passed、failed、not-run；
- HTTP MVP 的声明式和脚本两个真实 canary 已通过；完整版每项插件/输出承诺有对应 canary；
- 五门、生产构建、真实 Electron 截图和像素/解码检查全过；
- 不存在平台名 hardcode 的通用 runtime 分支。

## 16. 迁移策略

1. 读取现有 ModelArchetype 时立即归一成 ResolvedModeContract；运行层不再同时理解两套模式结构。
2. 现有 Mapping 编译成 declarative-http executor；不复制请求引擎。
3. 迁移期 process、ComfyUI、Dreamina、Codex 使用不可由 UI 新建的 builtin-adapter，使 executeMode 不需要保留第二条旧派发总线。
4. 编辑/试跑解析优先级固定为“用户明确选择的 candidate > active V2 > migrated legacy revision > declarative default”；普通画布默认只用 active，candidate 只有明确实验确认后才能执行。
5. 第一次 V2 写入时，在同一事务为所有受旧 model.customCall 影响的模式生成不可变 migrated legacy revision，并写 migration tombstone。之后删除某模式 override 必须指向 declarative default，禁止重新读取并复活 legacy customCall。
6. 旧 references 由新的 inputs 单向派生，供旧脚本读取；新代码禁止写 references 真相源。
7. 现有 customConfig 值按秘密处理迁入 secret store，避免猜错导致泄漏；用户可以随后把明确非秘密项改为普通 config。
8. 旧项目首尾帧、参考数组和节点边通过 stable vendor/model/mode/slot alias 映射，不批量改坏项目 JSON；找不到 alias 时生成 orphan diagnostic 和修复动作，不静默丢素材。
9. V2 single-write cutover 前保留只读兼容投影或导出恢复工具；cutover 后每个切换 PR 同时删除已被替代的派发/UI 路径，不长期双写。
10. cutover 前建立持久化 barrier，盘点并冻结所有 legacy prepared、dispatching/sent、pending 和 unknown 任务；短暂 quiesce 期间禁止新任务进入旧 runtime，并记录明确 cursor/boundary。
11. 明确从未发送的 legacy prepared 可事务迁移到新 attempt/intent；任何可能已发送但无可验证 operation ID 的任务一律迁成 legacy unknown_submission，禁止自动重提。
12. 有 upstream operation ID 和完整旧配置的 pending 任务由 pinned legacy adapter 只读 drain 到终态；只有能证明 checkpoint/state/spec 等价时才迁到新 runtime。旧 adapter 不再接新任务，但在途集合未清空前不能删除。
13. 每个 legacy task 都必须在迁移账本中落到 migrated、legacy-draining、legacy-unknown 或 terminal 之一；cutover 崩溃后按同一 boundary 幂等恢复，P11 必须证明零 orphan、零重复提交。

## 17. PR 与交付纪律

建议拆为十一个可审计 PR：

1. T00/T01：红灯、五实体契约、revision 和迁移读取；
2. T02：安全材料导入、草稿、VerificationCase、secret 和 command registry；
3. T03/T04a：可扩展媒体输入、统一 executor、ExecutionSpec 和提交安全；
4. T05a：受限 per-mode script host v2；
5. T06/T07：并列入口、工作区、真实试跑和原节点修复，形成 HTTP MVP 候选；
6. T09a + HTTP journeys/canary：独立盘点器、MVP 全集证据；
7. T04b：durable execution、ack/continuation/checkpoint 原子性、resume lease 和 legacy pending bridge；
8. T05b：script pending state adapter 与跨重启恢复；
9. T08：插件 host、外部插件 canary 和三个内置能力逐项迁移；
10. T09-full：完整版 mandatory journeys、插件/持久恢复 canary 与证据报告；
11. T10：cutover barrier、旧路径清理、最终迁移副本验证和发布。

每个 PR：

- 执行前 fetch 远端，从当时最新 origin/main 创建 task-specific branch；
- 只提交 owned files；
- 报告 branch、commit、PR URL、测试与真实走查证据；
- 不直接推 main，不自动 merge/squash/close；
- 依赖 PR 未合并时使用明确 stacked base，不能把所有改动塞进一个超大分支。

## 18. 两条完成线与发布门

### 18.1 HTTP MVP 完成线

以下全部满足才可以说“常见 HTTP 模型接入已解决”：

1. API 地址（密钥按平台要求）、curl、OpenAPI、文档片段、请求/响应样例和现成/手写脚本均可从第一屏直接开始；request-only/response-only 会明确缺口，无文档、无文本模型、auth:none 都不会卡死；只有 URL + Key 且不知道 Model ID 时能保存并换材料/手写继续，不假成功。
2. 当前 image/video/audio/file 的可扩展媒体槽、用户自定义 mode ID/label、参数和 variant 能从真实界面配置并保真进入 wire。
3. 自定义脚本按 ModeBinding 保存为不可变 revision，并在受限 script host 中运行；无 ambient 网络/Node/Electron 能力，真实 multipart/bytes/素材读取经过统一 broker；失败 candidate 不覆盖 active，references 只作兼容视图。
4. 有/无活动项目都能使用真实参数和素材试跑；verification workspace、bounded ConsumptionGrant、确认取消、幂等双击、关闭，以及产物预览/选择项目导入/ledger 安全删除行为完整。
5. 主 Key、多段密钥和当前编辑态 secret 在试跑前进入统一加密/脱敏链；原始导入材料从不先于 secret extraction 落盘。
6. 401/403/404/422、余额、限流、网络、超时、空/错响应和坏媒体都保留现场，并通过真实 NextAction 达到后置状态或诚实外部终态。
7. 从原节点进入时保存 nodeRevision；每次执行冻结 prompt、参数、variant、有序 AssetRef/version 和 destination。修改后同一节点成功；重启后自动保存草稿、case、spec/input snapshot、mode、slot、secret version、asset ledger/lease 和 retry target 仍可用。
8. broker 保守识别所有非安全 write，请求先持久化 request snapshot、intent 和 dispatch lease；ack、upstream ID、continuation/checkpoint/result 原子落盘。所有崩溃窗口、purpose 误标、响应不确定和人工强制重提均不会静默重复上传或收费；reservation 金额/次数可审计。跨重启继续长任务不属于 MVP 承诺。
9. mandatory Electron journeys 明确为 E01/E01M/E02/E03/E03D/E04/E04Q/E04S/E05-E10、M01-M05、X01-X03、X09T/X09I/X09V/X09A/X09D/X09F、X11-X20、F01-F14、P01/P01F/P02-P08/P10；不得以“适用”人工跳过。F14 至少使用一个“SDK/CLI 无兼容插件”fixture 打开真实终点页，证明原因、已保存内容、单一切换主动作、次级导出、无裸内部枚举和无循环按钮。每条 JourneySpan 绑定同一 profile/spec/input snapshot/attempt/intent，并有 wire、render 和 persistence 证据。E11-E15、X04-X08/X10/X21 和 P09/P11 按插件/durable 完成线统计。
10. 至少一个真实声明式平台和一个真实 per-mode 脚本平台经生产 Electron UI 生成并渲染成功，合计不少于三个 model/mode 组合，且至少一个平台在 T00 基线中从未硬编码支持；not-run 只能报告 fixture 验证。
11. 现役 E11 基础 ComfyUI 真实旅途与基线已有 Dreamina/Codex/CLI smoke 通过非回归门；这里只证明旧能力未坏，不冒充插件完整版完成。
12. pnpm gates、生产 build、截图/像素/帧/音频解码检查通过；通用 runtime 没有 fal、Replicate 或其他 canary 平台特供分支。

MVP 中 SDK、OAuth、WebSocket、CLI、复杂对象输入、新媒体类型和公网 callback 必须显示为“选择已安装兼容插件”或诚实 unsupported_runtime，不能用未来插件冒充已经解决。

### 18.2 完整版完成线

在 HTTP MVP 之上还必须全部满足：

1. 插件 host 具备安装、卸载、兼容检查、逐项授权、进程隔离、诊断、starter SDK、脚手架和示例插件；所有插件副作用要么走 host broker，要么把 handler 包成 opaque logical intent，崩溃后不自动重调。
2. SDK、OAuth、WebSocket、CLI/常驻进程分别通过独立 fixture、Electron journey 和真实 canary；至少一个仓外插件完整成功。
3. pending、cancelled、failed、succeeded、unknown_submission 的 T04b/T05b durable checkpoint、resume lease、ExecutionSpec/credential revision 校验和跨重启恢复通过。
4. 新输入或输出 kind 只有插件同时提供处理器、结果节点和预览后才可启用，并有真实 render proof。
5. ComfyUI、Dreamina、Codex 已逐个迁入统一接口；Mapping、customCall 和媒体专用 runner 不再形成并行派发。
6. E/M/X/F/P 全部 mandatory 旅途和对应真实 canary 通过，mandatory CapabilityProfile set - passed JourneySpan.profile set 为空。
7. 数据迁移、tombstone、删除 override、orphan alias、forward recovery/export 和带在途任务 barrier/drain 的 single-write cutover 通过真实旧数据副本验证，P11 零 orphan、零重复提交。

### 18.3 报告语义

- fixture 全绿但真实 canary 未跑：只能报告“协议 fixture 验证通过”。
- 某插件或运行时不存在：报告 unsupported_runtime，不计接入成功，也不阻碍 HTTP MVP 的准确范围发布。
- 只有 scoped PR 进入目标分支，且对应完成线所有证据归档后，才能报告该范围“已解决”；不得把 branch 上的实验或测试声明当产品完成。

## 19. 回滚

- schema 和存储先做 versioned additive migration，旧数据原文件保留到新写入成功；
- 代码 revert 不等于数据 downgrade。V2 single-write 前保留兼容投影或导出工具；cutover 后只承诺 forward recovery/export，不承诺旧二进制能读懂新编辑；
- 每个 executor 切换有独立 PR，运行时可把 ModeBinding.activeRevisionId 指回最后一个已验证 ExecutionSpecRevision；
- 模式发布按 mode 粒度，失败候选不能覆盖已验证版本；
- migration tombstone 随数据保留，回滚/删除 override 都不能复活 legacy customCall；
- 插件迁移一个内置能力一次，合约测试通过后同 PR 删除旧分支；
- journey 基础设施为新增目录和 package 入口，可独立回滚，不与产品修复绑成一个提交。

## 20. 执行结果

方案已收口，生产代码待执行。T00 可启动；T01 必须在 T00 红灯建立并确认后启动。每个 PR 完成后回填：

- branch / commit / PR；
- 通过和失败的测试；
- 真实 UI 截图与产物证据；
- canary 平台、协议形状和额度；
- 仍处于 waiting_external 或 unsupported_runtime 的边界。
