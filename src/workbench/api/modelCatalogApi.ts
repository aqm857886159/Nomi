import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
import type { ModelAvailability } from '../../../electron/shared/modelAvailability'
import { modelContextWindow } from '../../../electron/shared/modelContextWindow'
import type {
  BillingModelKind,
  ModelCatalogVendorCredentialMode,
  ProfileKind,
} from '../../api/desktopClient'

// 单一真相源：复用 desktopClient 的 BillingModelKind（含 'audio'），避免两份定义漂移。
export type { BillingModelKind }
export type { ProfileKind }
export type { ModelCatalogVendorCredentialMode }

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'

export type ModelCatalogHealthIssueCode =
  | 'catalog_empty'
  | 'vendor_disabled'
  | 'vendor_api_key_missing'
  | 'vendor_api_key_locked'
  | 'vendor_api_key_needs_resave'
  | 'model_mapping_missing'

export type ModelCatalogHealthIssueDto = {
  code: ModelCatalogHealthIssueCode
  severity: 'error' | 'warning'
  message: string
  vendorKey?: string
  modelKey?: string
  kind?: BillingModelKind
}

/**
 * 目录为什么只能读不能改。`null` = 一切正常。
 * `newer_on_disk` 是本次事故里那条：盘上的配置由更新版本写入，当前版本读得出来但不许改——
 * 界面必须明说「你的配置没有丢」，而不是渲染成一个空列表。
 */
export type ModelCatalogReadOnlyDto =
  | { reason: 'newer_on_disk'; diskVersion: number; appVersion: number }
  | { reason: 'unreadable_file'; detail: string; quarantinedPath: string | null }

export type ModelCatalogHealthDto = {
  ok: boolean
  readOnly?: ModelCatalogReadOnlyDto | null
  counts: {
    vendors: number
    enabledVendors: number
    models: number
    enabledModels: number
    mappings: number
    enabledMappings: number
    enabledApiKeys: number
  }
  byKind: Array<{
    kind: BillingModelKind
    enabledModels: number
    executableModels: number
  }>
  issues: ModelCatalogHealthIssueDto[]
}

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  credentialMaterialSaved?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  credentialMode?: ModelCatalogVendorCredentialMode
  meta?: unknown
  createdAt: string
  updatedAt: string
}

export type ModelCatalogModelDto = {
  modelKey: string
  vendorKey: string
  modelAlias?: string | null
  labelZh: string
  kind: BillingModelKind
  enabled: boolean
  /**
   * 「最近一次对账时，供应商的清单里没有列出它」——一条**旁注**，不是停用。
   *
   * 2026-09-21 起后台对账不再因为清单里查不到就替用户把模型关掉（主进程侧
   * `modelListReconciliation` 的返回类型已经构造不出 `enabled`）：清单抖动是常态，
   * 鉴权降级、网关抖动、上游改分页形状都会回一份不完整的清单，拿它去标「用户不要它了」
   * 就是把一次抖动写成状态。所以这里带出来的只是**这一句话**，界面如实说，不拦使用。
   */
  unlisted?: boolean
  published: boolean
  publishedModes: ProfileKind[]
  /**
   * 「这个模型现在能不能用」——主进程算好随行下发的**唯一**答案
   * （`electron/shared/modelAvailability.ts`）。设置页计数、首页横幅、助手下拉、画布/分镜选择器
   * 全部读它；谁都不许在渲染层再拼一份 `vendor.enabled && hasApiKey && published`，
   * 那正是 2026-09-12 真实验收里「三个地方给两个答案」的来源（P0-10）。
   */
  availability: ModelAvailability
  meta?: unknown
  /**
   * 这个模型的上下文窗口（token）。目录里它住在 `meta.contextWindow`，`meta` 是
   * `unknown`——渲染层要么各自解析各自校验，要么拿不到。Agent 面板的上下文环需要它当
   * 分母，所以在 `listWorkbenchModelCatalogModels` 这一层用 `modelContextWindow`
   * 解一次（和主进程组装 `NomiModelConfig` 用的是同一个 owner）。
   * 目录没写就是 `undefined`：环画灰、不给百分比，**不编一个默认窗口**。
   */
  contextWindow?: number
  pricing?: {
    cost: number
    enabled: boolean
    createdAt?: string
    updatedAt?: string
    specCosts: Array<{
      specKey: string
      cost: number
      enabled: boolean
      createdAt?: string
      updatedAt?: string
    }>
  }
  createdAt: string
  updatedAt: string
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

export async function listWorkbenchModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listVendors() as ModelCatalogVendorDto[]
}

export async function getWorkbenchModelCatalogHealth(): Promise<ModelCatalogHealthDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.health() as ModelCatalogHealthDto
}

export async function listWorkbenchModelCatalogModels(params?: {
  vendorKey?: string
  kind?: BillingModelKind
  enabled?: boolean
}): Promise<ModelCatalogModelDto[]> {
  const rows = requireDesktopRuntime('model catalog').modelCatalog.listModels(params) as ModelCatalogModelDto[]
  // 目录的 `meta` 过 IPC 时还是 `unknown`。在**进入渲染层的第一处**把窗口解出来，
  // 而不是让每个读它的组件各解一遍（那正是「同一语义几份定义」的起点）。
  return rows.map((row) => {
    const contextWindow = modelContextWindow(row.meta, row.modelKey)
    return contextWindow === undefined ? row : { ...row, contextWindow }
  })
}

/** 启用/更新一个已存在的目录模型（恢复卡「一键启用被禁用的文本大脑」用）。 */
export async function upsertWorkbenchModelCatalogModel(payload: {
  vendorKey: string
  modelKey: string
  labelZh?: string
  kind?: BillingModelKind
  enabled?: boolean
  /** Full model metadata. Omit to preserve the stored value. */
  meta?: unknown
}): Promise<ModelCatalogModelDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertModel(payload) as ModelCatalogModelDto
}
