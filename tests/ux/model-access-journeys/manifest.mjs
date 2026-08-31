const journey = (value) => Object.freeze(value)

export const JOURNEY_PHASES = Object.freeze(['entry', 'persisted', 'observed', 'executed', 'rendered', 'recovered'])

export const MODEL_ACCESS_JOURNEYS = Object.freeze([
  journey({
    id: 'J01', title: '中转发现后生成图片和视频', requirement: 'deterministic',
    script: 'relay-roundtrip.walk.mjs', profiles: ['relay-sync-image', 'relay-async-video'],
    ownsEntryComponents: ['OnboardingWizard'],
    covers: { billingKinds: ['image', 'video'], taskKinds: ['text_to_image', 'image_edit', 'text_to_video', 'image_to_video'], providers: ['openai-compatible'], auth: ['bearer'], ingestion: ['inline-base64'], slots: ['first_frame'], outputs: ['image', 'video'], modeShapes: [] },
  }),
  journey({
    id: 'J02', title: '已知平台单 Key 生成图片', requirement: 'deterministic',
    script: 'known-provider-roundtrip.walk.mjs', profiles: ['known-key-image'],
    ownsEntryComponents: ['VendorOnboardCard'],
    covers: { billingKinds: ['image'], taskKinds: ['text_to_image'], providers: [], auth: ['x-api-key'], ingestion: ['upload-multipart'], slots: [], outputs: ['image'], modeShapes: [] },
  }),
  journey({
    id: 'J03', title: '复合凭证生成可播放音频', requirement: 'deterministic',
    script: 'known-provider-roundtrip.walk.mjs', profiles: ['multi-credential-ndjson-audio'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['audio'], taskKinds: ['text_to_audio', 'image_to_audio'], providers: [], auth: [], ingestion: [], slots: ['audio_ref'], outputs: ['audio'], modeShapes: [] },
  }),
  journey({
    id: 'J04', title: '三种文本协议返回可见文本', requirement: 'deterministic',
    script: 'known-provider-roundtrip.walk.mjs', profiles: ['openai-sse-text', 'responses-text', 'anthropic-vision-text'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['text'], taskKinds: ['chat', 'prompt_refine', 'image_to_prompt'], providers: ['openai-compatible', 'openai-responses', 'anthropic'], auth: ['bearer', 'x-api-key', 'query'], ingestion: ['inline-base64'], slots: ['image_ref'], outputs: ['text'], modeShapes: [] },
  }),
  journey({
    id: 'J05', title: '自动适配逐模式失败后继续', requirement: 'deterministic',
    script: 'relay-roundtrip.walk.mjs', profiles: ['adapter-mode-repair'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['image', 'video'], taskKinds: ['image_edit', 'image_to_video'], providers: [], auth: [], ingestion: ['upload-url'], slots: ['first_frame'], outputs: ['video'], modeShapes: [] },
  }),
  journey({
    id: 'J06', title: '只有 curl 时接三段队列 API', requirement: 'deterministic',
    script: 'custom-call-roundtrip.walk.mjs', profiles: ['custom-three-stage-queue'],
    ownsEntryComponents: ['CustomCallEditor'],
    covers: { billingKinds: ['image', 'video'], taskKinds: ['image_edit', 'image_to_video'], providers: [], auth: [], ingestion: ['upload-url'], slots: ['first_frame', 'last_frame'], outputs: ['image', 'video'], modeShapes: [] },
  }),
  journey({
    id: 'J07', title: '自定义调用现场修字段', requirement: 'deterministic',
    script: 'custom-call-roundtrip.walk.mjs', profiles: ['custom-call-repair'],
    ownsEntryComponents: ['CustomVendorCard'],
    covers: { billingKinds: ['video'], taskKinds: ['image_to_video'], providers: [], auth: [], ingestion: [], slots: ['first_frame'], outputs: ['video'], modeShapes: [] },
  }),
  journey({
    id: 'J08', title: 'ComfyUI 预设、导入和多实例', requirement: 'environmental',
    script: 'local-runtime-roundtrip.walk.mjs', profiles: ['comfyui-workflow-video'],
    ownsEntryComponents: ['ComfyuiLocalCard', 'AddComfyuiInstanceButton'],
    covers: { billingKinds: ['image', 'video', 'model3d'], taskKinds: ['text_to_image', 'image_edit', 'text_to_video', 'image_to_video', 'text_to_3d', 'image_to_3d'], providers: [], auth: ['none'], ingestion: ['comfyui-upload'], slots: ['first_frame', 'video_ref'], outputs: ['image', 'video', 'model3d'], modeShapes: [] },
  }),
  journey({
    id: 'J09', title: '登录态 CLI 的多参考模式', requirement: 'environmental',
    script: 'local-runtime-roundtrip.walk.mjs', profiles: ['dreamina-reference-process'],
    ownsEntryComponents: ['DreaminaMemberCard'],
    covers: { billingKinds: ['image', 'video'], taskKinds: ['text_to_image', 'image_edit', 'text_to_video', 'image_to_video'], providers: [], auth: [], ingestion: [], slots: ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref'], outputs: ['image', 'video'], modeShapes: ['character-indexed', 'fixed-params', 'variant'] },
  }),
  journey({
    id: 'J10', title: '本地进程生图', requirement: 'environmental',
    script: 'local-runtime-roundtrip.walk.mjs', profiles: ['codex-local-process'],
    ownsEntryComponents: ['CodexLocalImageCard'],
    covers: { billingKinds: ['image'], taskKinds: ['text_to_image'], providers: [], auth: ['none'], ingestion: [], slots: [], outputs: ['image'], modeShapes: [] },
  }),
  journey({
    id: 'J11', title: '模型分类纠错后生成', requirement: 'deterministic',
    script: 'relay-roundtrip.walk.mjs', profiles: ['manual-kind-repair'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['image', 'video', 'audio', 'model3d'], taskKinds: ['text_to_3d'], providers: [], auth: [], ingestion: [], slots: [], outputs: ['model3d'], modeShapes: [] },
  }),
  journey({
    id: 'J12', title: 'URL、Key 和任务错误回诊', requirement: 'deterministic',
    script: 'recovery-roundtrip.walk.mjs', profiles: ['auth-url-timeout-repair'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['image'], taskKinds: ['text_to_image'], providers: [], auth: ['bearer'], ingestion: [], slots: [], outputs: ['image'], modeShapes: [] },
  }),
  journey({
    id: 'J13', title: '模型声明的全部参考槽和 wire 形状', requirement: 'deterministic',
    script: 'reference-modes-roundtrip.walk.mjs', profiles: ['ordered-multimodal-wire'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['image', 'video', 'audio'], taskKinds: ['image_edit', 'image_to_video', 'image_to_audio'], providers: [], auth: [], ingestion: ['upload-stream', 'anon-chain'], slots: ['first_frame', 'last_frame', 'image_ref', 'video_ref', 'audio_ref', 'source_video'], outputs: ['video'], modeShapes: ['input-key', 'single-value', 'array-value', 'character-indexed', 'vendor-params', 'model-enum', 'combine-role-array', 'combine-flat-array', 'fixed-params', 'variant'] },
  }),
  journey({
    id: 'J14', title: '配音、转录和 3D 产物', requirement: 'deterministic',
    script: 'media-output-roundtrip.walk.mjs', profiles: ['binary-audio', 'transcribe-text', 'async-image-to-3d'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['audio', 'model3d'], taskKinds: ['text_to_audio', 'transcribe', 'text_to_3d', 'image_to_3d'], providers: [], auth: [], ingestion: ['upload-stream'], slots: ['first_frame', 'audio_ref'], outputs: ['text', 'audio', 'model3d'], modeShapes: [] },
  }),
  journey({
    id: 'J15', title: '无文档最小材料诚实推进', requirement: 'deterministic',
    script: 'recovery-roundtrip.walk.mjs', profiles: ['minimal-material-honest-stop'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['image'], taskKinds: ['text_to_image'], providers: [], auth: ['bearer'], ingestion: [], slots: [], outputs: [], modeShapes: [] },
  }),
  journey({
    id: 'J16', title: '同 host 新增模型不改已有模型', requirement: 'deterministic',
    script: 'relay-roundtrip.walk.mjs', profiles: ['existing-model-preservation'],
    ownsEntryComponents: [],
    covers: { billingKinds: ['text', 'image', 'video', 'audio', 'model3d'], taskKinds: [], providers: [], auth: [], ingestion: ['none'], slots: [], outputs: [], modeShapes: [] },
  }),
])

export const IGNORED_DRAWER_COMPONENTS = Object.freeze({
  AvailableGroup: 'layout container, not an access method',
  ConnectAssistantCard: 'MCP lets assistants call Nomi; it is not a model execution provider',
  NetworkSection: 'network settings shared by all providers, not an access method',
})

export const REQUIRED_TEST_CAPABILITIES = Object.freeze({
  lifecycles: ['sync-json', 'sse', 'create-poll', 'create-status-result', 'multipart', 'binary', 'ndjson', 'process', 'http-websocket'],
  recoveries: ['auth', 'url', 'model-kind', 'request-shape', 'rate-limit', 'server', 'timeout', 'invalid-response', 'empty-output'],
  resultProofs: ['image-pixels', 'video-frame', 'audio-decodable', 'visible-text', 'model3d-pixels', 'same-node-retried', 'ordered-wire', 'honest-actionable-stop', 'existing-models-unchanged'],
})

export const REQUIRED_PROFILES = Object.freeze([
  { id: 'relay-sync-image', lifecycle: 'sync-json', proof: 'image-pixels' },
  { id: 'relay-async-video', lifecycle: 'create-poll', proof: 'video-frame' },
  { id: 'known-key-image', lifecycle: 'multipart', proof: 'image-pixels' },
  { id: 'multi-credential-ndjson-audio', lifecycle: 'ndjson', proof: 'audio-decodable' },
  { id: 'openai-sse-text', lifecycle: 'sse', proof: 'visible-text' },
  { id: 'responses-text', lifecycle: 'sync-json', proof: 'visible-text' },
  { id: 'anthropic-vision-text', lifecycle: 'sync-json', proof: 'visible-text' },
  { id: 'adapter-mode-repair', lifecycle: 'create-poll', proof: 'same-node-retried' },
  { id: 'custom-three-stage-queue', lifecycle: 'create-status-result', proof: 'video-frame' },
  { id: 'custom-call-repair', lifecycle: 'create-status-result', proof: 'same-node-retried' },
  { id: 'comfyui-workflow-video', lifecycle: 'http-websocket', proof: 'video-frame' },
  { id: 'dreamina-reference-process', lifecycle: 'process', proof: 'ordered-wire' },
  { id: 'codex-local-process', lifecycle: 'process', proof: 'image-pixels' },
  { id: 'manual-kind-repair', lifecycle: 'sync-json', proof: 'model3d-pixels' },
  { id: 'auth-url-timeout-repair', lifecycle: 'sync-json', proof: 'same-node-retried' },
  { id: 'ordered-multimodal-wire', lifecycle: 'multipart', proof: 'ordered-wire' },
  { id: 'binary-audio', lifecycle: 'binary', proof: 'audio-decodable' },
  { id: 'transcribe-text', lifecycle: 'multipart', proof: 'visible-text' },
  { id: 'async-image-to-3d', lifecycle: 'create-poll', proof: 'model3d-pixels' },
  { id: 'minimal-material-honest-stop', lifecycle: 'sync-json', proof: 'honest-actionable-stop' },
  { id: 'existing-model-preservation', lifecycle: 'sync-json', proof: 'existing-models-unchanged' },
])
