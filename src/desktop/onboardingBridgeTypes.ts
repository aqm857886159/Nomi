import type { ProviderKind } from './providerKind'

export type DesktopAdapterModeResult = {
  taskKind: string
  state: 'queued' | 'testing' | 'repairing' | 'verified' | 'failed'
  attempts: number
  stage?: string
  error?: string
  /**
   * 失败归类，抛出点查表得来（vendorHttp：401/403→auth、402→balance、429→quota、400/422→input、5xx→server）。
   * 渲染层据它说人话（adapterFailureAdvice）；**别在 UI 里用关键词猜 error 字符串**——同型 bug 已反复 5 轮。
   */
  errorCategory?: string
  httpStatus?: number
  verifiedAt?: string
}

export type DesktopProviderAdapterRun = {
  id: string
  vendorKey: string
  vendorName: string
  selectedModelKeys: string[]
  stage: 'queued' | 'discovering_docs' | 'compiling' | 'testing' | 'repairing' | 'completed' | 'partial' | 'failed' | 'needs_ai' | 'cancelled' | 'timed_out' | 'stale'
  currentModelKey?: string
  completedCount?: number
  totalCount?: number
  lastProgressAt?: string
  stageStartedAt?: string
  deadlineAt?: string
  repairAttempt: number
  models: Array<{ modelKey: string; labelZh: string; kind: string; modes: DesktopAdapterModeResult[] }>
  sourceUrls: string[]
  activeRevision?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export type DesktopProviderRegistration = {
  vendorKey: string
  vendorName: string
  state: 'configured'
  selectedModelKeys: string[]
  models: Array<{
    modelKey: string
    labelZh?: string
    kind: 'text' | 'image' | 'video' | 'audio' | 'model3d'
    state: 'unverified'
  }>
  savedAt: string
}

type AdapterResponse = Promise<{ ok: boolean; run?: DesktopProviderAdapterRun; error?: string }>
type AdapterListResponse = Promise<{ ok: boolean; runs?: DesktopProviderAdapterRun[]; error?: string }>
type AdapterRegistrationResponse = Promise<{
  ok: boolean
  registration?: DesktopProviderRegistration
  error?: string
}>

export type DesktopExistingConnectionSummary = {
  vendorKey: string
  vendorName: string
  baseUrl: string
  existingModels: Array<{
    modelKey: string
    labelZh: string
    kind: 'text' | 'image' | 'video' | 'audio' | 'model3d'
  }>
}

type ExistingConnectionErrorCode =
  | 'CONNECTION_NOT_FOUND'
  | 'BASE_URL_MISSING'
  | 'CREDENTIAL_MISSING'
  | 'MODEL_LIST_UNAVAILABLE'
  | 'NO_NEW_MODELS'
  | 'NO_MODELS_SELECTED'
  | 'RUN_NOT_FOUND'
  | 'RUN_ACTIVE'
  | 'RUN_MODELS_MISSING'
  | 'START_FAILED'
  | 'REGISTER_FAILED'

type ExistingConnectionFailure = {
  ok: false
  code: ExistingConnectionErrorCode
  error: string
  connection?: DesktopExistingConnectionSummary
}

export type DesktopOnboardingBridge = {
  adapterRegister: (payload: {
    vendorName: string
    baseUrl: string
    apiKey: string
    authType?: 'none' | 'bearer' | 'x-api-key' | 'query'
    providerKind?: ProviderKind
    headers?: Record<string, string>
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => AdapterRegistrationResponse
  adapterStart: (payload: {
    vendorName: string
    baseUrl: string
    apiKey: string
    authType?: 'none' | 'bearer' | 'x-api-key' | 'query'
    providerKind?: ProviderKind
    headers?: Record<string, string>
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => AdapterResponse
  adapterGet: (payload: { runId: string }) => AdapterResponse
  adapterLatest: (payload: { vendorKey: string }) => AdapterResponse
  adapterCancel: (payload: { runId: string }) => AdapterResponse
  adapterList: (payload?: { vendorKey?: string; activeOnly?: boolean; limit?: number }) => AdapterListResponse
  existingConnectionListModels: (payload: { vendorKey: string }) => Promise<
    | { ok: true; connection: DesktopExistingConnectionSummary; models: string[] }
    | ExistingConnectionFailure
  >
  adapterRegisterExisting: (payload: {
    vendorKey: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => Promise<{ ok: true; registration: DesktopProviderRegistration } | ExistingConnectionFailure>
  adapterStartExisting: (payload: {
    vendorKey: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => Promise<{ ok: true; run: DesktopProviderAdapterRun } | ExistingConnectionFailure>
  adapterAdaptExisting: (payload: {
    vendorKey: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => Promise<{ ok: true; run: DesktopProviderAdapterRun } | ExistingConnectionFailure>
  adapterRetry: (payload: { runId: string; modelKey?: string }) => Promise<
    { ok: true; run: DesktopProviderAdapterRun } | ExistingConnectionFailure
  >
  manualCommit: (payload: {
    vendorName: string
    baseUrl: string
    apiKey: string
    providerKind?: ProviderKind
    headers?: Record<string, string>
    models: Array<{ id: string; displayName?: string; kind?: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => Promise<{
    ok: boolean
    vendorKey?: string
    committed?: Array<{ modelKey: string; displayName: string }>
    error?: string
  }>
  testConnection: (payload: {
    baseUrl: string
    apiKey: string
    modelId?: string
    providerKind?: ProviderKind
    autoProbe?: boolean
    probe?: 'reachability'
    headers?: Record<string, string>
  }) => Promise<{
    ok: boolean
    status?: number
    error?: string
    detectedKind?: ProviderKind
    reachabilityOnly?: boolean
  }>
  listModels: (payload: {
    baseUrl: string
    apiKey: string
    providerKind?: ProviderKind
    headers?: Record<string, string>
  }) => Promise<{ ok: boolean; models?: string[]; status?: number; error?: string }>
  guessKinds: (payload: { ids: string[] }) => Promise<{
    kinds: Record<string, 'text' | 'image' | 'video' | 'audio' | 'model3d'>
  }>
  /**
   * 这家现在能不能用。凭证由主进程自取（renderer 只有 hasApiKey 布尔），所以自动检查
   * 必须走这条而不是 testConnection——后者要调用方手上有明文 key。
   * force = 用户点了「重新检查」，跳过新鲜期缓存。
   */
  vendorHealth: (payload: { vendorKey: string; force?: boolean }) => Promise<VendorHealth>
}

export type VendorHealthState = 'reachable' | 'unreachable' | 'unsupported'

export type VendorHealth = {
  vendorKey: string
  state: VendorHealthState
  /** 非 reachable 时的人话原因（上游那句话 / 网络错描述）。 */
  reason?: string
  checkedAt: number
}
