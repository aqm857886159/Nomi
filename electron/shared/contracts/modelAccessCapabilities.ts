/**
 * Enumerable production contract for every model-access capability that must
 * remain usable through a visible user journey. Runtime/domain types derive from
 * these constants so the journey gate cannot drift behind a handwritten union.
 *
 * Single-ownership note (R14.1): the reference-slot vocabulary is *owned* by
 * `electron/shared/videoCapabilities/types.ts` (`ArchetypeReferenceSlotKind`).
 * We do not re-define it here — we mirror it into an iterable const that
 * `satisfies readonly ArchetypeReferenceSlotKind[]`, so any drift is a compile
 * error rather than a second source of truth.
 */

import type { ArchetypeReferenceSlotKind } from '../videoCapabilities/types'

export const BILLING_MODEL_KINDS = ['text', 'image', 'video', 'audio', 'model3d'] as const

export const PROFILE_KINDS = [
  'chat',
  'prompt_refine',
  'text_to_image',
  'image_to_prompt',
  'image_to_video',
  'text_to_video',
  'image_edit',
  'text_to_audio',
  'image_to_audio',
  'transcribe',
  'text_to_3d',
  'image_to_3d',
] as const

export type ProfileKindName = (typeof PROFILE_KINDS)[number]

/**
 * 「输入媒体怎么进模型」——`PROFILE_KINDS` 的**完全划分**（每个 kind 必须归一类）。
 *
 * 为什么住在这里而不是使用方（providerAdapter/validator.ts）：它划分的是上面那张 enum，
 * 手抄一份放在远处 = 第二真相源。2026-09-03 之前正是那样：validator 手写了一个四元 Set，
 * 漏掉了 image_to_prompt / transcribe，且新增第 13 个 kind 时没有任何东西会喊。
 *
 * 三态而不是布尔——因为「吃不吃输入媒体」和「媒体是不是靠说明卡声明的 referenceParam 进去的」
 * 是**两件事**，早先那个布尔 Set 把它们混成了一件：
 *
 * - `'declared'`：媒体经**说明卡声明**的 `referenceParam`/`referenceShape` 进入。说明卡校验
 *   因此强制这两个字段；认证探针再据声明注入一张参考媒体（providerAdapter/verifier.ts:149-152）。
 *   漏声明 = 探针验错东西（自建中转改图通道被判死那次就是这么来的）。
 * - `'runtime-fixed'`：同样吃输入媒体，但走的是**按 kind 写死的运行期通道**，与说明卡声明无关，
 *   因此**不能**强制 referenceParam（强制它等于要求编一个无人读取的声明）。
 * - `'none'`：纯文本输入。
 */
export type ProfileKindReferenceChannel = 'declared' | 'runtime-fixed' | 'none'

export const PROFILE_KIND_REFERENCE_CHANNEL = {
  // —— 经说明卡声明的参考通道（校验强制 referenceParam/referenceShape）——
  /** 参考图即被编辑的原图；改图整条通道都靠它。 */
  image_edit: 'declared',
  /** 首帧/参考图驱动的视频生成。 */
  image_to_video: 'declared',
  /** 图片配音：图片经参考通道进模型。 */
  image_to_audio: 'declared',
  /** 参考图生成 3D 网格。 */
  image_to_3d: 'declared',

  // —— 吃输入媒体，但通道按 kind 写死在运行期（故不强制声明）——
  /** 图片经 `allReferenceImages()` 进多模态入参，**按 kind 分支**取、不读 referenceParam：
   *  electron/textTaskRunner.ts:29-31。探针也已按 kind 无条件注图：providerAdapter/verifier.ts:221-223。
   *  产出侧证据：electron/video/deconstructVideo.ts:244-249、electron/capabilityCore/shotVerifyDeps.ts:6。 */
  image_to_prompt: 'runtime-fixed',
  /** 音频由 `resolveAudioSource()` 取自参考族键并**强制非空**（缺则抛）：electron/audioTaskRunner.ts:141-142、
   *  190-198；随后 `resolveFile` 直接喂字节（:167），声明的 multipart.fileSource 在此路径上被绕过。 */
  transcribe: 'runtime-fixed',

  // —— 纯文本输入，不吃参考媒体 ——
  chat: 'none',
  prompt_refine: 'none',
  text_to_image: 'none',
  text_to_video: 'none',
  text_to_audio: 'none',
  text_to_3d: 'none',
} as const satisfies Readonly<Record<ProfileKindName, ProfileKindReferenceChannel>>

/**
 * 穷尽闸（R17）：新增第 13 个 `PROFILE_KIND` 而没在上面分类时，**tsc 当场红**。
 *
 * 机制全在上面那句 `as const satisfies Readonly<Record<ProfileKindName, ...>>`——
 * 少一个键报 missing property，多一个键报 excess property，写错档位报 union 不匹配。
 * 用 `satisfies` 而不是类型标注，是为了**保住每个值的字面量类型**（标注会把它们拓宽成整个
 * union，下面 DeclaredReferenceProfileKind 就会塌成 never，闸门看着在、实际全空）。
 * **不许**改回标注式，也不许放宽成 `Partial<>` 或索引签名。
 */

/**
 * 必须在说明卡里声明参考入参的 taskKind——**类型层**也由划分 derive（不是 ProfileKindName 全集）。
 * 于是「按参考类 kind 建表」的下游（如 validator.test.ts 的最小外壳表）少一档会被 tsc 抓到。
 */
export type DeclaredReferenceProfileKind = {
  [K in ProfileKindName]: (typeof PROFILE_KIND_REFERENCE_CHANNEL)[K] extends 'declared' ? K : never
}[ProfileKindName]

export const REFERENCE_TASK_KINDS: readonly DeclaredReferenceProfileKind[] = PROFILE_KINDS.filter(
  (kind) => PROFILE_KIND_REFERENCE_CHANNEL[kind] === 'declared',
) as readonly DeclaredReferenceProfileKind[]

export const AI_SDK_PROVIDER_KINDS = ['openai-compatible', 'anthropic', 'openai-responses'] as const
export const VENDOR_AUTH_TYPES = ['none', 'bearer', 'x-api-key', 'query'] as const
export const ASSET_MEDIA_KINDS = ['image', 'video', 'audio'] as const

// Mirrors every `AssetIngestion.strategy` in electron/catalog/types.ts. Kept in
// sync by the catalog type (a strategy added there without one here is caught by
// the manifest test's non-empty/coverage checks and by review). 2026-09-01: the
// two-step vendor-owned uploads (upload-presigned / upload-initiate-put /
// upload-initiate-multipart) are on main and must be listed here.
export const ASSET_INGESTION_STRATEGIES = [
  'inline-base64',
  'none',
  'upload-presigned',
  'upload-stream',
  'upload-url',
  'upload-multipart',
  'upload-initiate-put',
  'upload-initiate-multipart',
  'comfyui-upload',
  'anon-chain',
] as const

// Iterable mirror of the owning union in videoCapabilities/types.ts. The
// `satisfies` clause makes divergence a type error, so this stays a mirror and
// not a competing owner.
export const ARCHETYPE_REFERENCE_SLOT_KINDS = [
  'first_frame',
  'last_frame',
  'image_ref',
  'video_ref',
  'audio_ref',
  'source_video',
] as const satisfies readonly ArchetypeReferenceSlotKind[]

export const MODEL_ACCESS_ENTRY = {
  knownSingleKey: 'known-single-key',
  knownMultiCredential: 'known-multi-credential',
  relayModelDiscovery: 'relay-model-discovery',
  officialProviderPreset: 'official-provider-preset',
  providerAdapter: 'provider-adapter',
  customCallScript: 'custom-call-script',
  comfyuiPreset: 'comfyui-preset',
  comfyuiWorkflowImport: 'comfyui-workflow-import',
  comfyuiMultiInstance: 'comfyui-multi-instance',
  dreaminaOauth: 'dreamina-oauth',
  codexLocal: 'codex-local',
  // Local OpenAI-compatible text runtimes (Ollama / LM Studio / LocalAI): probe
  // common ports → connect → list models → capability precheck (agent vs
  // chat-only) → seed a `local-text` vendor. Same discovery-and-connect shape as
  // codexLocal / comfyuiPreset, so it is one more entry surface, not a protocol.
  localTextConnect: 'local-text-connect',
  manualModelRetype: 'manual-model-retype',
  failureRecovery: 'failure-recovery',
  minimalMaterialProbe: 'minimal-material-probe',
} as const

export const MODEL_ACCESS_ENTRY_IDS = Object.values(MODEL_ACCESS_ENTRY)

// Pre-composed anchor for the onboarding wizard shell, which is a single entry
// surface for three model-access flows. Kept here (not inlined in the wizard) so
// the capped OnboardingWizard file stays at its size budget and the composition
// lives with the rest of the model-access contract.
export const MODEL_ACCESS_ENTRY_ONBOARDING =
  `${MODEL_ACCESS_ENTRY.relayModelDiscovery} ${MODEL_ACCESS_ENTRY.officialProviderPreset} ${MODEL_ACCESS_ENTRY.minimalMaterialProbe}` as const

export const MODEL_ACCESS_AUTH_CAPABILITIES = [
  ...VENDOR_AUTH_TYPES,
  'custom-header',
  'multi-credential',
  'oauth-session',
] as const

export const MODEL_ACCESS_PROVIDER_CAPABILITIES = [
  ...AI_SDK_PROVIDER_KINDS,
  'declarative-http',
  'custom-script',
  'comfyui',
  'process',
] as const

export const MODEL_ACCESS_LIFECYCLES = [
  'sync-json',
  'sse',
  'create-poll',
  'create-status-result',
  'multipart',
  'binary',
  'ndjson',
  'process',
  'http-websocket',
] as const

export const MODEL_ACCESS_INGESTION_CAPABILITIES = [
  ...ASSET_INGESTION_STRATEGIES,
  'public-url',
  'process-local-file',
] as const

export const MODEL_ACCESS_SLOT_CAPABILITIES = [...ARCHETYPE_REFERENCE_SLOT_KINDS, 'mask'] as const
export const MODEL_ACCESS_OUTPUT_CAPABILITIES = ['text', 'url', 'base64', 'binary', 'local-file', 'async-asset'] as const
export const MODEL_ACCESS_RECOVERY_CAPABILITIES = [
  'auth',
  'url',
  'model-kind',
  'request-shape',
  'rate-limit',
  'server',
  'timeout',
  'invalid-response',
  'empty-output',
] as const

export const MODEL_ACCESS_MODE_SHAPE_CAPABILITIES = [
  'input-key',
  'single-value',
  'array-value',
  'character-indexed',
  'vendor-params',
  'model-enum',
  'combine-role-array',
  'combine-flat-array',
  'fixed-params',
  'variant',
] as const

export const MODEL_ACCESS_RESULT_PROOFS = [
  'image-pixels',
  'video-frame',
  'audio-decodable',
  'visible-text',
  'model3d-pixels',
  'same-node-retried',
  'ordered-wire-and-video-frame',
  'honest-actionable-stop',
] as const

export const MODEL_ACCESS_CAPABILITIES = {
  entries: MODEL_ACCESS_ENTRY_IDS,
  billingKinds: BILLING_MODEL_KINDS,
  taskKinds: PROFILE_KINDS,
  auth: MODEL_ACCESS_AUTH_CAPABILITIES,
  providers: MODEL_ACCESS_PROVIDER_CAPABILITIES,
  lifecycles: MODEL_ACCESS_LIFECYCLES,
  ingestion: MODEL_ACCESS_INGESTION_CAPABILITIES,
  slots: MODEL_ACCESS_SLOT_CAPABILITIES,
  outputs: MODEL_ACCESS_OUTPUT_CAPABILITIES,
  recoveries: MODEL_ACCESS_RECOVERY_CAPABILITIES,
  modeShapes: MODEL_ACCESS_MODE_SHAPE_CAPABILITIES,
} as const

export type ModelAccessCapabilityDimension = keyof typeof MODEL_ACCESS_CAPABILITIES

export type ModelAccessRequiredProfile = {
  id: string
  requires: Partial<Record<ModelAccessCapabilityDimension, readonly string[]>>
  resultProof: (typeof MODEL_ACCESS_RESULT_PROOFS)[number]
}

export const MODEL_ACCESS_REQUIRED_PROFILES = [
  { id: 'relay-sync-image', requires: { entries: ['relay-model-discovery'], auth: ['bearer'], providers: ['openai-compatible'], taskKinds: ['text_to_image'], lifecycles: ['sync-json'], outputs: ['url'] }, resultProof: 'image-pixels' },
  { id: 'relay-async-video', requires: { entries: ['provider-adapter'], auth: ['bearer'], taskKinds: ['image_to_video'], lifecycles: ['create-poll'], slots: ['first_frame'], outputs: ['async-asset'] }, resultProof: 'video-frame' },
  { id: 'known-key-image', requires: { entries: ['known-single-key'], auth: ['x-api-key'], taskKinds: ['text_to_image'], ingestion: ['upload-multipart'], outputs: ['base64'] }, resultProof: 'image-pixels' },
  { id: 'multi-credential-ndjson-audio', requires: { entries: ['known-multi-credential'], auth: ['multi-credential'], taskKinds: ['text_to_audio'], lifecycles: ['ndjson'], outputs: ['binary'] }, resultProof: 'audio-decodable' },
  { id: 'openai-sse-text', requires: { entries: ['official-provider-preset'], providers: ['openai-compatible'], auth: ['bearer'], taskKinds: ['prompt_refine'], lifecycles: ['sse'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'responses-json-text', requires: { entries: ['official-provider-preset'], providers: ['openai-responses'], taskKinds: ['chat'], lifecycles: ['sync-json'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'anthropic-image-to-prompt', requires: { entries: ['official-provider-preset'], providers: ['anthropic'], auth: ['x-api-key'], taskKinds: ['image_to_prompt'], slots: ['image_ref'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'adapter-mode-repair', requires: { entries: ['provider-adapter'], taskKinds: ['image_to_video'], lifecycles: ['create-poll'], recoveries: ['request-shape'] }, resultProof: 'video-frame' },
  { id: 'fal-like-custom-queue', requires: { entries: ['custom-call-script'], auth: ['custom-header'], providers: ['custom-script'], taskKinds: ['image_to_video'], lifecycles: ['create-status-result'], ingestion: ['upload-url'], slots: ['first_frame', 'last_frame'], outputs: ['async-asset'] }, resultProof: 'video-frame' },
  { id: 'custom-call-repair', requires: { entries: ['custom-call-script', 'failure-recovery'], providers: ['custom-script'], recoveries: ['request-shape', 'invalid-response', 'empty-output'] }, resultProof: 'same-node-retried' },
  { id: 'comfyui-workflow-video', requires: { entries: ['comfyui-workflow-import', 'comfyui-multi-instance'], auth: ['none'], providers: ['comfyui'], lifecycles: ['http-websocket'], ingestion: ['comfyui-upload'], taskKinds: ['image_to_video'] }, resultProof: 'video-frame' },
  { id: 'dreamina-reference-process', requires: { entries: ['dreamina-oauth'], auth: ['oauth-session'], providers: ['process'], lifecycles: ['process'], ingestion: ['process-local-file'], slots: ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref'], outputs: ['local-file'] }, resultProof: 'video-frame' },
  { id: 'codex-local-process', requires: { entries: ['codex-local'], auth: ['none'], providers: ['process'], lifecycles: ['process'], taskKinds: ['text_to_image'], outputs: ['local-file'] }, resultProof: 'image-pixels' },
  // Local text runtime: the seed is authType:'none' + OpenAI-compatible, the card
  // lists models via /v1/models and the capability precheck fires one /v1/chat/completions
  // (sync-json) tool-call probe to split agent vs chat-only. Derived from
  // localTextVendorSeed.ts + localTextCapabilityProbe.ts, not invented here.
  { id: 'local-text-connect-agent-precheck', requires: { entries: ['local-text-connect'], auth: ['none'], providers: ['openai-compatible'], billingKinds: ['text'], taskKinds: ['chat'], lifecycles: ['sync-json'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'manual-kind-repair', requires: { entries: ['manual-model-retype'], recoveries: ['model-kind'], taskKinds: ['text_to_3d'], outputs: ['url'] }, resultProof: 'model3d-pixels' },
  { id: 'auth-url-timeout-repair', requires: { entries: ['failure-recovery'], recoveries: ['auth', 'url', 'rate-limit', 'server', 'timeout', 'invalid-response', 'empty-output'] }, resultProof: 'same-node-retried' },
  { id: 'ordered-multimodal-wire', requires: { entries: ['custom-call-script'], taskKinds: ['image_to_video'], lifecycles: ['multipart'], ingestion: ['upload-stream'], slots: ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref', 'source_video', 'mask'], modeShapes: ['input-key', 'single-value', 'array-value', 'character-indexed', 'vendor-params', 'model-enum', 'combine-role-array', 'combine-flat-array', 'fixed-params', 'variant'] }, resultProof: 'ordered-wire-and-video-frame' },
  { id: 'transcribe-multipart-text', requires: { billingKinds: ['audio'], taskKinds: ['transcribe'], lifecycles: ['multipart'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'async-image-to-3d', requires: { billingKinds: ['model3d'], taskKinds: ['image_to_3d'], lifecycles: ['create-poll'], slots: ['first_frame'], outputs: ['async-asset'] }, resultProof: 'model3d-pixels' },
  { id: 'minimal-material-honest-stop', requires: { entries: ['minimal-material-probe'], recoveries: ['invalid-response'] }, resultProof: 'honest-actionable-stop' },
] as const satisfies readonly ModelAccessRequiredProfile[]
