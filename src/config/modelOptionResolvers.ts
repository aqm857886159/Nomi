import type { ModelOption } from './models'
import { pickImplicitVendorMatch } from './modelIdentity'
import i18n from '../i18n'

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export { normalizeModelId }

function trimModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function trimVendorIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function inferImageModelVendor(value: string | null | undefined): string | null {
  const normalized = trimModelIdentifier(value).toLowerCase()
  if (!normalized) return null
  if (
    normalized.includes('gpt') ||
    normalized.includes('openai') ||
    normalized.includes('dall') ||
    normalized.includes('o3-')
  ) {
    return 'openai'
  }
  if (normalized.includes('qwen')) {
    return 'qwen'
  }
  if (normalized.includes('gemini') || normalized.includes('banana') || normalized.includes('imagen')) {
    return 'gemini'
  }
  return null
}

// modelKey 不是全目录唯一的：两个中转站可以各自提供同名模型（如都叫 gpt-image-2）。
// 身份匹配到多条时必须用 vendor 二次寻址，否则永远命中数组首条（=最新接入那家），
// 用户锁定的那家会被静默改写（2026-07-31 群反馈根因）。
export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
  vendor?: string | null | undefined,
  orderedVendorKeys: readonly string[] = [],
): ModelOption | null {
  const identifier = trimModelIdentifier(value)
  const normalizedIdentifier = normalizeModelId(identifier)
  if (!identifier) return null
  const matches = options.filter((option) => {
    const rawValue = trimModelIdentifier(option.value)
    const rawModelKey = trimModelIdentifier(option.modelKey)
    const rawModelAlias = trimModelIdentifier(option.modelAlias)
    const normalizedValue = normalizeModelId(rawValue)
    const normalizedModelKey = normalizeModelId(rawModelKey)
    const normalizedModelAlias = normalizeModelId(rawModelAlias)
    return (
      identifier === rawValue ||
      identifier === rawModelKey ||
      identifier === rawModelAlias ||
      normalizedIdentifier === normalizedValue ||
      normalizedIdentifier === normalizedModelKey ||
      normalizedIdentifier === normalizedModelAlias
    )
  })
  if (matches.length === 0) return null
  const requestedVendor = trimVendorIdentifier(vendor)
  if (requestedVendor) {
    const vendorMatch = matches.find((option) => trimVendorIdentifier(option.vendor) === requestedVendor)
    if (vendorMatch) return vendorMatch
  }
  // 没记供应商（旧数据）/ 记的那家不在了：不再是「数组首条 = 最新接入那家」，
  // 而是与执行侧同一把尺（pickImplicitVendorMatch：用户顺序 > 官方 > 内置中转 > 自接 > 目录序）。
  return pickImplicitVendorMatch(matches, (option) => option.vendor, orderedVendorKeys) ?? null
}

export type ResolvedExecutableImageModel = {
  value: string
  vendor: string | null
  didFallback: false
  shouldWriteBack: boolean
  reason: 'canonicalized' | null
  source: 'requested'
}

function resolveModelOptionVendor(
  option: ModelOption | null,
  explicitVendor: string | null,
  resolvedValue: string,
): string | null {
  const optionVendor = trimVendorIdentifier(option?.vendor)
  if (optionVendor) return optionVendor
  if (explicitVendor) return explicitVendor
  return inferImageModelVendor(resolvedValue)
}

export function resolveExecutableImageModelFromOptions(
  options: readonly ModelOption[],
  params: {
    kind: 'image' | 'imageEdit'
    value: string | null | undefined
    vendor?: string | null | undefined
  },
): ResolvedExecutableImageModel {
  const requestedValue = trimModelIdentifier(params.value)
  const requestedVendor = trimVendorIdentifier(params.vendor)
  const requestedOption = findModelOptionByIdentifier(options, requestedValue, requestedVendor)

  if (requestedOption) {
    const resolvedValue = trimModelIdentifier(requestedOption.value)
    const resolvedVendor = resolveModelOptionVendor(requestedOption, requestedVendor || null, resolvedValue)
    const reason = requestedValue && requestedValue !== resolvedValue ? 'canonicalized' : null
    return {
      value: resolvedValue,
      vendor: resolvedVendor,
      didFallback: false,
      shouldWriteBack: reason !== null || requestedVendor !== trimVendorIdentifier(resolvedVendor),
      reason,
      source: 'requested',
    }
  }

  if (options.length === 0) {
    throw new Error(i18n.t('runtime.modelCatalog.noImageModel'))
  }

  if (!requestedValue) {
    throw new Error(i18n.t('runtime.modelCatalog.imageModelUnselected'))
  }

  throw new Error(i18n.t('runtime.modelCatalog.imageModelUnavailable', { model: requestedValue }))
}
