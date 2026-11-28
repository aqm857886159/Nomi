import type { ProviderKind } from './providerKind'
import type { AntigravityConnectionStatus, AntigravityTestRequest } from '../../electron/shared/antigravity'
import type { ModelListFailureKind } from '../../electron/ai/onboarding/modelListResponse'
import type { AdapterRunStage } from '../../electron/shared/contracts/providerAdapterContract'
import type { CertificationSubmissionState } from '../../electron/integrationCertification/types'
export type { AntigravityConnectionStatus } from '../../electron/shared/antigravity'

/** 集成握手 DTO（integrationHandoffList/subscribe 的投影形状；跨凭据/连接/工作流/验证四类目标）。 */
export type IntegrationHandoff = {
  requestId: string
  target: 'credential' | 'connection' | 'workflow' | 'verification'
  sessionId: string
  revision: number
  ownerClientId: string
  display?: { name?: string; origin?: string; authType?: string; runId?: string }
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
  /**
   * 「**我们这边**缺什么」这一维（electron/providerAdapter/selfCheck.ts 的 AdapterSelfCheckReason）。
   * 与 errorCategory（上游怎么拒绝我们）正交：缺一条查询接口、改图模式没声明参考图槽，
   * 都不是用户填错了，界面据此给真正走得通的下一步，而不是甩英文原文 + 「你自己接」。
   */
  selfCheckReason?: string
  httpStatus?: number
  verifiedAt?: string
}

export type DesktopProviderAdapterRun = {
  id: string
  vendorKey: string
  lineageRootVendorKey?: string
  sourceVendorKey?: string
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
    display?: { name?: string; origin?: string; authType?: string; runId?: string }
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
  integrationSessionStartSelfCheck?: (payload: { sessionId: string; expectedRevision: number }) => Promise<unknown>
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
  /** 发送键上的约价：交最终请求，回公开价估出的数（只读、不带凭据）；算不出 = null。 */
  vendorPricePreview: (payload: import("../../electron/shared/contracts/vendorPricePreview").VendorPriceRequest) => Promise<import("../../electron/shared/contracts/vendorPricePreview").VendorPricePreview | null>
  /** 官方供应商账户余额只读查询（与公开约价解耦）；读不到或非官方源 = null。 */
  vendorAccountBalance?: (payload: import("../../electron/shared/contracts/vendorAccountBalance").VendorAccountBalanceRequest) => Promise<import("../../electron/shared/contracts/vendorAccountBalance").VendorAccountBalance | null>
}
