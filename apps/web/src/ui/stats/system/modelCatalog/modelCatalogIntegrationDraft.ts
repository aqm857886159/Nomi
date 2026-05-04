import type {
  BillingModelKind,
  ModelCatalogImportPackageDto,
  ModelCatalogIntegrationChannelKind,
  ModelCatalogVendorAuthType,
  ProfileKind,
} from './deps'

export type { ModelCatalogIntegrationChannelKind }

type IntegrationDraftInput = {
  pastedText: string
  vendorKey: string
  vendorName: string
  channelKind?: ModelCatalogIntegrationChannelKind
  baseUrlHint?: string | null
  authType?: ModelCatalogVendorAuthType
  models: Array<{
    modelKey: string
    modelAlias?: string | null
    labelZh: string
    kind: BillingModelKind
  }>
  taskKinds: ProfileKind[]
}

export const MODEL_CATALOG_INTEGRATION_CHANNEL_LABEL: Record<ModelCatalogIntegrationChannelKind, string> = {
  official_provider: '官方供应商 API',
  aggregator_gateway: '聚合商 / 中间商网关',
  private_proxy: '私有代理 / 企业网关',
  local_runtime: '本地模型服务',
  custom_endpoint: '自定义端点',
}

function trimRequired(value: string, fieldName: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) throw new Error(`${fieldName} 不能为空`)
  return trimmed
}

function normalizeVendorKey(value: string): string {
  const normalized = trimRequired(value, 'vendorKey').toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    throw new Error('vendorKey 只能包含小写字母、数字、下划线和短横线，并且必须以字母或数字开头')
  }
  return normalized
}

function normalizeBaseUrlHint(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return `${url.protocol}//${url.host}`
  } catch {
    throw new Error('baseUrlHint 必须是有效 URL')
  }
}

function defaultPricingCost(kind: BillingModelKind): number {
  if (kind === 'image') return 1
  if (kind === 'video') return 10
  return 0
}

function defaultRequestProfile(taskKind: ProfileKind): Record<string, unknown> {
  return {
    enabled: true,
    version: 'v2',
    status_mapping: {},
    create: {
      default: {
        method: 'POST',
        path: '',
        headers: { 'Content-Type': 'application/json' },
        query: {},
        body: {
          model: '{{model.model_key}}',
          prompt: '{{request.prompt}}',
        },
        response_mapping: {},
        provider_meta_mapping: {},
      },
    },
    query: { default: {} },
    draftSource: {
      taskKind,
      requiresAdapterReview: true,
    },
  }
}

export function buildModelCatalogIntegrationDraft(input: IntegrationDraftInput): ModelCatalogImportPackageDto {
  const pastedText = trimRequired(input.pastedText, '接口文档内容')
  const vendorKey = normalizeVendorKey(input.vendorKey)
  const vendorName = trimRequired(input.vendorName, 'vendorName')
  const channelKind = input.channelKind || 'custom_endpoint'
  const models = input.models.map((model) => ({
    modelKey: trimRequired(model.modelKey, 'modelKey'),
    modelAlias: typeof model.modelAlias === 'string' && model.modelAlias.trim() ? model.modelAlias.trim() : null,
    labelZh: trimRequired(model.labelZh, 'labelZh'),
    kind: model.kind,
    enabled: true,
    pricing: {
      cost: defaultPricingCost(model.kind),
      enabled: true,
      specCosts: [],
    },
  }))
  if (!models.length) throw new Error('至少需要一个模型')
  if (!input.taskKinds.length) throw new Error('至少需要一个任务映射')

  return {
    version: 'v2',
    exportedAt: new Date(0).toISOString(),
    vendors: [{
      vendor: {
        key: vendorKey,
        name: vendorName,
        enabled: true,
        baseUrlHint: normalizeBaseUrlHint(input.baseUrlHint),
        authType: input.authType || 'bearer',
        meta: {
          integrationDraft: {
            source: 'pasted-endpoint-docs',
            channelKind,
            channelLabel: MODEL_CATALOG_INTEGRATION_CHANNEL_LABEL[channelKind],
            sourceLength: pastedText.length,
            requiresAiAdapterCompletion: true,
            adapterContract: 'requestProfile.v2',
          },
        },
      },
      models,
      mappings: input.taskKinds.map((taskKind) => ({
        taskKind,
        name: `${vendorName} 默认映射`,
        enabled: false,
        requestProfile: defaultRequestProfile(taskKind),
      })),
    }],
  }
}
