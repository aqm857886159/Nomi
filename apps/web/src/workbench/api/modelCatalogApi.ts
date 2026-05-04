import { buildApiUrl } from '../../api/httpClient'
import { WORKBENCH_API_BASE, throwWorkbenchApiError, withWorkbenchAuth, workbenchApiFetch } from './http'

export type BillingModelKind = 'text' | 'image' | 'video'

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'

export type ModelCatalogHealthIssueCode =
  | 'catalog_empty'
  | 'vendor_disabled'
  | 'vendor_api_key_missing'
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

export async function listWorkbenchModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  const response = await workbenchApiFetch(`${WORKBENCH_API_BASE}/model-catalog/vendors`, withWorkbenchAuth())
  if (!response.ok) {
    await throwWorkbenchApiError(response, `list model catalog vendors failed: ${response.status}`)
  }
  return response.json() as Promise<ModelCatalogVendorDto[]>
}

export async function getWorkbenchModelCatalogHealth(): Promise<ModelCatalogHealthDto> {
  const response = await workbenchApiFetch(`${WORKBENCH_API_BASE}/model-catalog/health`, withWorkbenchAuth())
  if (!response.ok) {
    await throwWorkbenchApiError(response, `get model catalog health failed: ${response.status}`)
  }
  return response.json() as Promise<ModelCatalogHealthDto>
}

export async function listWorkbenchModelCatalogModels(params?: {
  vendorKey?: string
  kind?: BillingModelKind
  enabled?: boolean
}): Promise<ModelCatalogModelDto[]> {
  const url = new URL(buildApiUrl('/model-catalog/models'), window.location.origin)
  if (params?.vendorKey) url.searchParams.set('vendorKey', params.vendorKey)
  if (params?.kind) url.searchParams.set('kind', params.kind)
  if (typeof params?.enabled === 'boolean') {
    url.searchParams.set('enabled', params.enabled ? 'true' : 'false')
  }
  const response = await workbenchApiFetch(url.toString(), withWorkbenchAuth())
  if (!response.ok) {
    await throwWorkbenchApiError(response, `list model catalog models failed: ${response.status}`)
  }
  return response.json() as Promise<ModelCatalogModelDto[]>
}
