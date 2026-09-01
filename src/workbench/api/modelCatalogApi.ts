import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'
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
  return requireDesktopRuntime('model catalog').modelCatalog.listModels(params) as ModelCatalogModelDto[]
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
