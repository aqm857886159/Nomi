/**
 * Enumerable production contract for every model-access capability that must
 * remain usable through a visible user journey. Runtime/domain types derive from
 * these constants so the journey gate cannot drift behind a handwritten union.
 */

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

export const AI_SDK_PROVIDER_KINDS = ['openai-compatible', 'anthropic', 'openai-responses'] as const
export const VENDOR_AUTH_TYPES = ['none', 'bearer', 'x-api-key', 'query'] as const
export const ASSET_MEDIA_KINDS = ['image', 'video', 'audio'] as const
export const ASSET_INGESTION_STRATEGIES = [
  'inline-base64',
  'none',
  'upload-stream',
  'upload-url',
  'upload-multipart',
  'comfyui-upload',
  'anon-chain',
] as const

export const ARCHETYPE_REFERENCE_SLOT_KINDS = [
  'first_frame',
  'last_frame',
  'image_ref',
  'video_ref',
  'audio_ref',
  'source_video',
] as const

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
  manualModelRetype: 'manual-model-retype',
  failureRecovery: 'failure-recovery',
  minimalMaterialProbe: 'minimal-material-probe',
} as const

export const MODEL_ACCESS_ENTRY_IDS = Object.values(MODEL_ACCESS_ENTRY)

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
  { id: 'manual-kind-repair', requires: { entries: ['manual-model-retype'], recoveries: ['model-kind'], taskKinds: ['text_to_3d'], outputs: ['url'] }, resultProof: 'model3d-pixels' },
  { id: 'auth-url-timeout-repair', requires: { entries: ['failure-recovery'], recoveries: ['auth', 'url', 'rate-limit', 'server', 'timeout', 'invalid-response', 'empty-output'] }, resultProof: 'same-node-retried' },
  { id: 'ordered-multimodal-wire', requires: { entries: ['custom-call-script'], taskKinds: ['image_to_video'], lifecycles: ['multipart'], ingestion: ['upload-stream'], slots: ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref', 'source_video', 'mask'], modeShapes: ['input-key', 'single-value', 'array-value', 'character-indexed', 'vendor-params', 'model-enum', 'combine-role-array', 'combine-flat-array', 'fixed-params', 'variant'] }, resultProof: 'ordered-wire-and-video-frame' },
  { id: 'transcribe-multipart-text', requires: { billingKinds: ['audio'], taskKinds: ['transcribe'], lifecycles: ['multipart'], outputs: ['text'] }, resultProof: 'visible-text' },
  { id: 'async-image-to-3d', requires: { billingKinds: ['model3d'], taskKinds: ['image_to_3d'], lifecycles: ['create-poll'], slots: ['first_frame'], outputs: ['async-asset'] }, resultProof: 'model3d-pixels' },
  { id: 'minimal-material-honest-stop', requires: { entries: ['minimal-material-probe'], recoveries: ['invalid-response'] }, resultProof: 'honest-actionable-stop' },
] as const satisfies readonly ModelAccessRequiredProfile[]
