import type { ProviderKind } from './providerKind'
import type { AntigravityConnectionStatus, AntigravityTestRequest } from '../../electron/shared/antigravity'
import type { ModelListFailureKind } from '../../electron/ai/onboarding/modelListResponse'
import type { AdapterRunStage } from '../../electron/shared/providerAdapterContract'
import type { CertificationSubmissionState } from '../../electron/integrationCertification/types'
export type { AntigravityConnectionStatus } from '../../electron/shared/antigravity'

/** 集成握手 DTO（integrationHandoffList/subscribe 的投影形状；跨凭据/连接/工作流/验证四类目标）。 */
export type IntegrationHandoff = {
  requestId: string
  target: 'credential' | 'connection' | 'workflow' | 'verification'
  sessionId: string
  revision: number
  ownerClientId: string
  display?: { name?: string; origin?: string; authType?: string; runId?: string; challengeId?: string }
}

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
  /**
   * stage === 'compile' 时的结构化细分原因（'no_generic_contract' | 'docs_not_understood'）。
   * 「这个 kind 没有通用协议」与「我们没读懂这家文档」给用户的话不一样，由主进程带过来，
   * **别在 UI 里从 error 文案猜**。
   */
  compileFailureReason?: string
  httpStatus?: number
  verifiedAt?: string
}

export type DesktopProviderAdapterRun = {
  id: string
  vendorKey: string
  lineageRootVendorKey?: string
  vendorName: string
  selectedModelKeys: string[]
  stage: AdapterRunStage
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
  recovery?: {
    reasonCode: 'submission_unknown' | 'submission_reconcile_unavailable' | 'promotion_commit_unknown' | 'certification_start_rolled_back'
    userAction: 'reconcile_or_contact_provider' | 'restart_certification'
  }
  certificationOperations?: Record<string, {
    operationKey: string
    submissionState: CertificationSubmissionState
    settledResult?: unknown
  }>
  createdAt: string
  updatedAt: string
}

export type DesktopHttpCertificationRun = DesktopProviderAdapterRun & {
  schemaVersion: 1
  kind: 'http-api-provider'
  childRunRef: { runId: string; revisionDigest: string }
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

type AdapterResponse = Promise<
  | { ok: true; run: DesktopHttpCertificationRun }
  | { ok: false; code: ExistingConnectionErrorCode; error?: string }
>
type AdapterListResponse = Promise<{ ok: boolean; runs?: DesktopHttpCertificationRun[]; error?: string }>
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

export type ExistingConnectionErrorCode =
  | 'CONNECTION_NOT_FOUND'
  | 'BASE_URL_MISSING'
  | 'CREDENTIAL_MISSING'
  | 'MODEL_LIST_UNAVAILABLE'
  | 'NO_MODELS_SELECTED'
  | 'RUN_NOT_FOUND'
  | 'RUN_ACTIVE'
  | 'RUN_MODELS_MISSING'
  | 'START_FAILED'

type ExistingConnectionFailure = {
  ok: false
  code: ExistingConnectionErrorCode
  error: string
  status?: number
  failureKind?: ModelListFailureKind
  connection?: DesktopExistingConnectionSummary
}

export type DesktopOnboardingBridge = {
  integrationHandoffList?: () => Promise<Array<{
    requestId: string
    target: 'credential' | 'connection' | 'workflow' | 'verification'
    sessionId: string
    revision: number
    ownerClientId: string
    createdAt: string
    display?: { name?: string; origin?: string; authType?: string; runId?: string; challengeId?: string }
  }>>
  integrationHandoffSubscribe?: (callback: (entry: unknown) => void) => () => void
  integrationHandoffAck?: (requestId: string) => Promise<{ ok: boolean }>
  integrationSessionSaveCredential?: (payload: { sessionId: string; expectedRevision: number; apiKey: string }) => Promise<unknown>
  integrationSessionPrepareComfy?: (payload: {
    vendorKey: string
    name: string
    workflow: string
    binding: unknown
    modelKey?: string
    enumOptions?: unknown
    uiWorkflow?: string
  }) => Promise<unknown>
  integrationSessionConfirm?: (payload: { sessionId: string; expectedRevision: number; challengeId: string }) => Promise<unknown>
  integrationSessionGet?: (sessionId: string) => Promise<unknown>
  antigravityStatus: () => Promise<AntigravityConnectionStatus>
  antigravityTest: (request?: AntigravityTestRequest) => Promise<AntigravityConnectionStatus>
  antigravityCancel: () => Promise<AntigravityConnectionStatus | undefined>
  httpConnectionConfigure: (payload: {
    vendorName: string
    baseUrl: string
    apiKey: string
    authType?: 'none' | 'bearer' | 'x-api-key' | 'query'
    providerKind?: ProviderKind
    headers?: Record<string, string>
    proxyUrl?: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => AdapterRegistrationResponse
  httpCertificationStart: (payload: {
    entryPoint: 'manual-ui'
    idempotencyKey: string
    vendorName: string
    baseUrl: string
    apiKey: string
    authType?: 'none' | 'bearer' | 'x-api-key' | 'query'
    providerKind?: ProviderKind
    headers?: Record<string, string>
    proxyUrl?: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => AdapterResponse
  certificationGet: (payload: { runId: string }) => AdapterResponse
  certificationCancel: (payload: { runId: string }) => AdapterResponse
  certificationList: (payload?: { vendorKey?: string; activeOnly?: boolean; limit?: number }) => AdapterListResponse
  httpConnectionListModels: (payload: { vendorKey: string }) => Promise<
    | { ok: true; connection: DesktopExistingConnectionSummary; models: string[]; partial?: boolean }
    | ExistingConnectionFailure
  >
  httpCertificationStartExisting: (payload: {
    entryPoint: 'manual-ui'
    idempotencyKey: string
    vendorKey: string
    models: Array<{ modelKey: string; labelZh?: string; kind: 'text' | 'image' | 'video' | 'audio' | 'model3d' }>
  }) => Promise<{ ok: true; run: DesktopHttpCertificationRun } | ExistingConnectionFailure>
  httpCertificationRetry: (payload: { runId: string; modelKey?: string; idempotencyKey: string }) => Promise<
    { ok: true; run: DesktopHttpCertificationRun } | ExistingConnectionFailure
  >
  testConnection: (payload: {
    baseUrl: string
    apiKey: string
    modelId?: string
    providerKind?: ProviderKind
    autoProbe?: boolean
    probe?: 'reachability'
    headers?: Record<string, string>
    proxyUrl?: string
  }) => Promise<{
    ok: boolean
    status?: number
    error?: string
    detectedKind?: ProviderKind
    reachabilityOnly?: boolean
    failureKind?: ModelListFailureKind
  }>
  listModels: (payload: {
    baseUrl: string
    apiKey: string
    providerKind?: ProviderKind
    headers?: Record<string, string>
    proxyUrl?: string
  }) => Promise<{ ok: boolean; models?: string[]; status?: number; error?: string; failureKind?: ModelListFailureKind; partial?: boolean }>
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
