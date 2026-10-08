import type { ProviderKind } from '../desktop/providerKind'
import { getDesktopBridge } from '../desktop/bridge'
import type {
  AgentChatAttachment,
  AgentChatRequest,
  AgentChatResponse,
  AgentChatUsage,
} from '../../electron/harness/agentChatContracts'

export type AgentAttachmentPayload = AgentChatAttachment
export type AgentsChatRequestDto = AgentChatRequest
export type AgentsChatResponseDto = AgentChatResponse
export type AgentUsage = AgentChatUsage

function requireDesktopRuntime(feature: string) {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`Desktop runtime is required for ${feature}`)
  return desktop
}

export type BillingModelKind = 'text' | 'image' | 'video' | 'audio' | 'model3d'

export type ProfileKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'
  | 'text_to_audio'
  | 'image_to_audio'
  | 'transcribe'
  | 'text_to_3d'
  | 'image_to_3d'

export type ModelCatalogVendorAuthType = 'none' | 'bearer' | 'x-api-key' | 'query'
/** Renderer projection of the code-owned credential flow. Custom vendors omit it. */
export type ModelCatalogVendorCredentialMode = 'direct-key' | 'certification'
export type ModelCatalogVendorProviderKind = ProviderKind

export type ModelCatalogIntegrationChannelKind =
  | 'official_provider'
  | 'aggregator_gateway'
  | 'private_proxy'
  | 'local_runtime'
  | 'custom_endpoint'

export type ModelCatalogVendorDto = {
  key: string
  name: string
  enabled: boolean
  hasApiKey?: boolean
  credentialMaterialSaved?: boolean
  credentialVerificationPending?: boolean
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  authHeader?: string | null
  authQueryParam?: string | null
  credentialMode?: ModelCatalogVendorCredentialMode
  providerKind?: ModelCatalogVendorProviderKind
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

export type HttpOperationDto = {
  method: string
  path: string
  headers?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
  response_mapping?: Record<string, unknown>
  provider_meta_mapping?: Record<string, unknown>
}

export type ModelCatalogMappingDto = {
  id: string
  vendorKey: string
  taskKind: ProfileKind
  name: string
  enabled: boolean
  create: HttpOperationDto
  query?: HttpOperationDto
  statusMapping?: Record<string, string[]>
  createdAt: string
  updatedAt: string
}

export type ModelCatalogVendorApiKeyStatusDto = {
  verificationPending?: boolean
  vendorKey: string
  hasApiKey: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ModelCatalogImportPackageDto = {
  version: string
  exportedAt?: string
  vendors: Array<{
    vendor: {
      key: string
      name: string
      enabled?: boolean
      baseUrlHint?: string | null
      authType?: ModelCatalogVendorAuthType
      authHeader?: string | null
      authQueryParam?: string | null
      meta?: unknown
    }
    apiKey?: {
      apiKey?: string
      enabled?: boolean
    }
    models?: Array<{
      modelKey: string
      vendorKey?: string
      modelAlias?: string | null
      labelZh: string
      kind: BillingModelKind
      enabled?: boolean
      meta?: unknown
      pricing?: ModelCatalogModelDto['pricing']
    }>
    mappings?: Array<{
      id?: string
      vendorKey?: string
      taskKind: ProfileKind
      name: string
      enabled?: boolean
      requestProfile?: unknown
      requestMapping?: unknown
      responseMapping?: unknown
    }>
  }>
}

export type ModelCatalogImportConflictDto = {
  kind: 'vendor' | 'model' | 'mapping'
  vendorKey: string
  modelKey?: string
  mappingId?: string
}

export type ModelCatalogImportResultDto = {
  imported: {
    vendors: number
    models: number
    mappings: number
  }
  /** 本机已经有同一条、因此**没有被动过**的数量。导入是合并不是覆盖。 */
  kept: {
    vendors: number
    models: number
    mappings: number
  }
  /** 冲突清单：界面据此告诉用户「这几条我保留了你现在的，没有替换」。 */
  conflicts: ModelCatalogImportConflictDto[]
  errors: string[]
}

export type ModelCatalogDocsFetchResultDto = {
  url: string
  finalUrl: string
  status: number
  contentType: string
  title: string | null
  text: string
  truncated: boolean
  diagnostics: string[]
}

export type ModelCatalogMappingTestRequestDto = {
  modelKey?: string
  prompt?: string
  stage?: 'create' | 'query' | 'result' | string
  execute?: boolean
}

export type ModelCatalogMappingTestResultDto = {
  mappingId: string
  vendorKey: string
  taskKind: ProfileKind
  stage: string
  executed: boolean
  ok: boolean
  diagnostics: string[]
  request: unknown
  response?: unknown
}

export async function listModelCatalogVendors(): Promise<ModelCatalogVendorDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listVendors() as ModelCatalogVendorDto[]
}

export async function listModelCatalogModels(params?: {
  vendorKey?: string
  kind?: BillingModelKind
  enabled?: boolean
}): Promise<ModelCatalogModelDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listModels(params) as ModelCatalogModelDto[]
}

export async function listModelCatalogMappings(params?: {
  vendorKey?: string
  taskKind?: ProfileKind
  enabled?: boolean
}): Promise<ModelCatalogMappingDto[]> {
  return requireDesktopRuntime('model catalog').modelCatalog.listMappings(params) as ModelCatalogMappingDto[]
}

export async function upsertModelCatalogVendor(
  payload: Partial<ModelCatalogVendorDto> & Pick<ModelCatalogVendorDto, 'key' | 'name'>,
): Promise<ModelCatalogVendorDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertVendor(payload) as ModelCatalogVendorDto
}

export async function deleteModelCatalogVendor(key: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteVendor(key)
}

export async function upsertModelCatalogVendorApiKey(
  vendorKey: string,
  payload: { apiKey: string; enabled?: boolean },
): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return await requireDesktopRuntime('model catalog').modelCatalog.upsertVendorApiKey(vendorKey, payload) as ModelCatalogVendorApiKeyStatusDto
}

export async function clearModelCatalogVendorApiKey(vendorKey: string): Promise<ModelCatalogVendorApiKeyStatusDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.clearVendorApiKey(vendorKey) as ModelCatalogVendorApiKeyStatusDto
}

export async function upsertModelCatalogModel(
  payload: Partial<ModelCatalogModelDto> & Pick<ModelCatalogModelDto, 'modelKey' | 'vendorKey' | 'labelZh' | 'kind'>,
): Promise<ModelCatalogModelDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertModel(payload) as ModelCatalogModelDto
}

export async function deleteModelCatalogModel(vendorKey: string, modelKey: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteModel(vendorKey, modelKey)
}

export async function upsertModelCatalogMapping(
  payload: Partial<ModelCatalogMappingDto> & Pick<ModelCatalogMappingDto, 'vendorKey' | 'taskKind' | 'name'>,
): Promise<ModelCatalogMappingDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.upsertMapping(payload) as ModelCatalogMappingDto
}

export async function deleteModelCatalogMapping(id: string): Promise<void> {
  requireDesktopRuntime('model catalog').modelCatalog.deleteMapping(id)
}

/**
 * 导出一份可搬走的配置包。**不带参数 = 永不含密钥材料**（明文与 safeStorage 密文都不含，
 * 理由与实现都在 `electron/catalog/catalogPackageFormat.ts`）。
 * 密钥不跟着包走是刻意的：包会被发群里、贴进对话、留在下载目录，而密钥一旦出门就收不回来。
 * 导入方在自己机器上逐条补 key，那一步只花十秒。
 */
export async function exportModelCatalogPackage(): Promise<ModelCatalogImportPackageDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.exportPackage() as ModelCatalogImportPackageDto
}

/**
 * 导入一份配置包。**默认合并、不覆盖**：同名条目保留本机已有的，冲突照实列出来交给用户。
 * 只有他明说「用包里的覆盖」才传 `conflictPolicy: 'replace'`。
 */
export async function importModelCatalogPackage(
  payload: ModelCatalogImportPackageDto,
  options?: { conflictPolicy?: 'keep' | 'replace' },
): Promise<ModelCatalogImportResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.importPackage(payload, options) as ModelCatalogImportResultDto
}

export async function fetchModelCatalogDocs(payload: { url: string }): Promise<ModelCatalogDocsFetchResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.fetchDocs(payload) as Promise<ModelCatalogDocsFetchResultDto>
}

export async function testModelCatalogMapping(
  id: string,
  payload: ModelCatalogMappingTestRequestDto,
): Promise<ModelCatalogMappingTestResultDto> {
  return requireDesktopRuntime('model catalog').modelCatalog.testMapping(id, payload) as Promise<ModelCatalogMappingTestResultDto>
}
