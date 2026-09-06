import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
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

export type ModelCatalogHealthDto = {
  ok: boolean
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
  published: boolean
  publishedModes: ProfileKind[]
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
    const contextWindow = modelContextWindow(row.meta)
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
