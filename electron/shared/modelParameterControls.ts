import type { ModelParameterControl, ModelParameterControlOption, ModelParameterControlType } from './videoCapabilities/types';
type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function asPositiveNumber(value: unknown): number | null {
  const num = asFiniteNumber(value)
  return num !== null && num > 0 ? num : null
}

function asControlScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  return undefined
}

function parseExplicitParameterControlType(value: unknown): ModelParameterControlType | null {
  const raw = asTrimmedString(value).toLowerCase()
  if (raw === 'number' || raw === 'integer' || raw === 'float') return 'number'
  if (raw === 'boolean' || raw === 'bool' || raw === 'switch' || raw === 'checkbox') return 'boolean'
  if (raw === 'text' || raw === 'string' || raw === 'input' || raw === 'textarea') return 'text'
  if (
    raw === 'image-url' ||
    raw === 'imageurl' ||
    raw === 'image_url' ||
    raw === 'image-ref' ||
    raw === 'image-reference'
  )
    return 'image-url'
  if (raw === 'select') return 'select'
  return null
}

function parseParameterControlType(value: unknown): ModelParameterControlType {
  return parseExplicitParameterControlType(value) ?? 'select'
}

function parseParameterControlOption(value: unknown): ModelParameterControlOption | null {
  const scalar = asControlScalar(value)
  if (typeof scalar !== 'undefined') return { value: scalar, label: String(scalar) }
  if (!isRecord(value)) return null
  const optionValue = asControlScalar(value.value ?? value.key)
  if (typeof optionValue === 'undefined') return null
  const label = asTrimmedString(value.label) || String(optionValue)
  const priceLabel = asTrimmedString(value.priceLabel ?? value.price)
  return {
    value: optionValue,
    label,
    ...(priceLabel ? { priceLabel } : {}),
  }
}

function parseParameterControl(value: unknown): ModelParameterControl | null {
  if (!isRecord(value)) return null
  const key = asTrimmedString(value.key ?? value.name ?? value.binding ?? value.field)
  if (!key) return null
  const label = asTrimmedString(value.label) || key
  const type = parseParameterControlType(value.type)
  const options = Array.isArray(value.options)
    ? value.options
        .map(parseParameterControlOption)
        .filter((item): item is ModelParameterControlOption => item !== null)
    : []
  const defaultValue = asControlScalar(value.defaultValue ?? value.default)
  // 边界可以是 0 甚至负数（CFG min=0、denoise 0–1、shift 可负），只有步长必须为正。
  // 此前 min/max 也走 asPositiveNumber，把 0 和负值当非法丢掉，控件就失去了下界。
  const min = asFiniteNumber(value.min) ?? undefined
  const max = asFiniteNumber(value.max) ?? undefined
  const step = asPositiveNumber(value.step) ?? undefined
  const placeholder = asTrimmedString(value.placeholder)
  return {
    key,
    label,
    type: type !== 'image-url' && options.length > 0 ? 'select' : type,
    ...((value.mediaKind === 'image' || value.mediaKind === 'video' || value.mediaKind === 'audio')
      ? { mediaKind: value.mediaKind }
      : {}),
    options: dedupeByValue(options),
    ...(typeof defaultValue !== 'undefined' ? { defaultValue } : {}),
    ...(typeof min === 'number' ? { min } : {}),
    ...(typeof max === 'number' ? { max } : {}),
    ...(typeof step === 'number' ? { step } : {}),
    ...(placeholder ? { placeholder } : {}),
  }
}

export function parseModelParameterControls(meta: unknown): ModelParameterControl[] {
  if (!isRecord(meta)) return []
  const source = Array.isArray(meta.parameterControls)
    ? meta.parameterControls
    : Array.isArray(meta.parameters)
      ? meta.parameters
      : []
  return dedupeByValue(
    source
      .map(parseParameterControl)
      .filter((item): item is ModelParameterControl => item !== null)
      .map((item) => ({ ...item, value: item.key })),
  ).map(({ value: _value, ...item }) => item)
}

export function parseModelParameterControlsAtomic(meta: unknown): ModelParameterControl[] | null {
  if (!isRecord(meta)) return null
  const hasParameterControls = Object.prototype.hasOwnProperty.call(meta, 'parameterControls')
  const hasParameters = Object.prototype.hasOwnProperty.call(meta, 'parameters')
  if (hasParameterControls === hasParameters) return null
  const source = hasParameterControls ? meta.parameterControls : meta.parameters
  if (!Array.isArray(source)) return null
  const controls: ModelParameterControl[] = []
  const keys = new Set<string>()
  for (const value of source) {
    if (!isRecord(value)) return null
    if (Object.prototype.hasOwnProperty.call(value, 'type') && parseExplicitParameterControlType(value.type) === null) return null
    if (Object.prototype.hasOwnProperty.call(value, 'mediaKind')
      && value.mediaKind !== 'image' && value.mediaKind !== 'video' && value.mediaKind !== 'audio') return null
    const control = parseParameterControl(value)
    if (!control || keys.has(control.key)) return null
    keys.add(control.key)
    controls.push(control)
  }
  return controls
}

function dedupeByValue<T extends { value: string | number | boolean }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = String(item.value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
