import type { ModelOption } from './models'
import i18n from '../i18n'

function normalizeModelId(value: string): string {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export { normalizeModelId }

export function trimModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function trimVendorIdentifier(value: string | null | undefined): string {
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

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
): ModelOption | null {
  const identifier = trimModelIdentifier(value)
  const normalizedIdentifier = normalizeModelId(identifier)
  if (!identifier) return null
  return (
    options.find((option) => {
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
    }) || null
  )
}

export function getModelOptionRequestAlias(options: readonly ModelOption[], value: string | null | undefined): string {
  const identifier = trimModelIdentifier(value)
  const matched = findModelOptionByIdentifier(options, identifier)
  const alias = trimModelIdentifier(matched?.modelAlias)
  if (alias) return alias
  const modelKey = trimModelIdentifier(matched?.modelKey)
  if (modelKey) return modelKey
  const fallbackValue = trimModelIdentifier(matched?.value)
  if (fallbackValue) return fallbackValue
  return identifier
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
  const requestedOption = findModelOptionByIdentifier(options, requestedValue)

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
