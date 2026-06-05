// 节点参数控件的**纯模型逻辑**（从 NodeParameterControls.tsx 抽出 —— Rule 12/M5：让组件文件净减、
// 关注点分离）。这里只有数据塑形：把 catalog/档案 meta 解析成可渲染的控件 / 参考槽描述，
// 不含 React、不碰 store。组件只负责把这些描述画出来 + 收事件。
import {
  formatVideoOptionLabel,
  parseModelParameterControls,
  parseImageModelCatalogConfig,
  parseVideoModelCatalogConfig,
  type ImageModelCatalogConfig,
  type ImageModelControlBinding,
  type ModelParameterControl,
  type VideoModelCatalogConfig,
  type VideoModelControlBinding,
} from '../../../../config/modelCatalogMeta'
import { normalizeOrientation, type Orientation } from '../../../../utils/orientation'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { WorkbenchAssetDto } from '../../../api/assetUploadApi'

export type SelectOption = string | {
  value: string | number
  label: string
  priceLabel?: string
}

export type DurationOption = string | {
  value: string | number
  label: string
  priceLabel?: string
}

export type DynamicCatalogControl = {
  key: string
  label: string
  binding:
    | ImageModelControlBinding
    | VideoModelControlBinding
    | 'parameter'
  options: SelectOption[]
  defaultValue?: string | number | boolean
}

export type DynamicParameterControl = ModelParameterControl & {
  binding: 'parameter'
}

export type DynamicModelControl = DynamicParameterControl | DynamicCatalogControl

export type ImageUrlGroup = 'first_frame' | 'last_frame' | 'reference'

export type ImageUrlSlot = {
  key: string
  label: string
  group: ImageUrlGroup
}

const FIRST_FRAME_KEY_FRAGMENTS = ['firstframe', 'firstimage', 'startframe', 'startimage', 'initialframe']
const LAST_FRAME_KEY_FRAGMENTS = ['lastframe', 'lastimage', 'endframe', 'endimage', 'finalframe']

function inferImageUrlGroup(key: string): ImageUrlGroup {
  const lower = key.toLowerCase().replace(/[-_]/g, '')
  if (FIRST_FRAME_KEY_FRAGMENTS.some((f) => lower.includes(f))) return 'first_frame'
  if (LAST_FRAME_KEY_FRAGMENTS.some((f) => lower.includes(f))) return 'last_frame'
  return 'reference'
}

// A param is an image-reference input if onboarding tagged it 'image-url',
// OR its key name clearly names an image URL (onboarding sometimes mis-tags
// these as plain text). Both buildImageUrlSlots (top reference boxes) and
// buildDynamicControls (bottom param row) use THIS predicate, so any given
// param lands in exactly one place — and it works for any model, not just the
// ones whose type was tagged correctly during onboarding.
const IMAGE_URL_KEY_FRAGMENTS = [
  'imageurl', 'imgurl', 'imageurls', 'inputurl', 'inputurls', 'inputimage', 'inputimg', 'imageinput',
  'referenceimage', 'refimage', 'initimage', 'sourceimage', 'sourceimg',
  'startimage', 'endimage', 'firstframe', 'lastframe', 'frameurl', 'photourl',
]
export function looksLikeImageUrlControl(control: ModelParameterControl): boolean {
  if (control.type === 'image-url') return true
  // Only ever promote a free-text param; never a select/number/boolean (those
  // are real value pickers, not image inputs).
  if (control.type !== 'text') return false
  const lower = control.key.toLowerCase().replace(/[-_]/g, '')
  return IMAGE_URL_KEY_FRAGMENTS.some((f) => lower.includes(f))
}

export function edgeModeForGroup(group: ImageUrlGroup): GenerationCanvasEdgeMode {
  if (group === 'first_frame') return 'first_frame'
  if (group === 'last_frame') return 'last_frame'
  return 'reference'
}

export function getEdgeSourceForSlot(
  group: ImageUrlGroup,
  edges: GenerationCanvasEdge[],
  targetNodeId: string,
): string {
  const mode = edgeModeForGroup(group)
  return edges.find((e) => e.target === targetNodeId && e.mode === mode)?.source || ''
}

export function buildImageUrlSlots(meta: unknown): ImageUrlSlot[] {
  const controls = parseModelParameterControls(meta)
  return controls
    .filter(looksLikeImageUrlControl)
    .map((c) => ({ key: c.key, label: c.label, group: inferImageUrlGroup(c.key) }))
}

export function imageCatalogReferenceSlot(config: ImageModelCatalogConfig | null): ImageUrlSlot[] {
  return config?.supportsReferenceImages
    ? [{ key: 'referenceImageUrl', label: '参考图', group: 'reference' }]
    : []
}

export function getSlotNodeRef(meta: Record<string, unknown>, paramKey: string): string {
  const direct = readMeta(meta, paramKey + '_nodeRef')
  if (direct) return direct
  if (paramKey === 'firstFrameUrl') return readMeta(meta, 'firstFrameRef')
  if (paramKey === 'lastFrameUrl') return readMeta(meta, 'lastFrameRef')
  if (paramKey === 'referenceImageUrl' || paramKey === 'imageUrl') return readMeta(meta, 'referenceImageRef')
  return ''
}

export function getSlotThumbUrl(meta: Record<string, unknown>, paramKey: string, nodes: GenerationCanvasNode[]): string {
  const direct = readMeta(meta, paramKey)
  if (direct) return direct
  const nodeRef = getSlotNodeRef(meta, paramKey)
  if (!nodeRef) return ''
  return resultPreviewUrl(nodes.find((n) => n.id === nodeRef))
}

const ASPECT_RATIO_ALIASES = ['aspect_ratio', 'aspectRatio', 'aspect', 'size', 'imageSize', 'videoSize', 'ratio', 'video_size', 'image_size']
const DURATION_ALIASES = ['durationSeconds', 'videoDuration', 'duration', 'video_duration', 'length', 'clip_length']
const RESOLUTION_ALIASES = ['resolution', 'videoResolution', 'video_resolution', 'output_resolution', 'outputResolution']
const FORMAT_ALIASES = ['output_format', 'outputFormat', 'format', 'image_format']

function buildAliasMap(groups: string[][]): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const group of groups) {
    for (const key of group) {
      map[key] = group.filter((k) => k !== key)
    }
  }
  return map
}

const PARAMETER_CONTROL_BINDING_KEYS: Record<string, string[]> = buildAliasMap([
  ASPECT_RATIO_ALIASES,
  DURATION_ALIASES,
  RESOLUTION_ALIASES,
  FORMAT_ALIASES,
])

export function readMeta(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function readStringArray(meta: unknown, key: string): string[] {
  if (!meta || typeof meta !== 'object') return []
  const value = (meta as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function readDurationOptions(meta: unknown): DurationOption[] {
  if (!meta || typeof meta !== 'object') return []
  const value = (meta as Record<string, unknown>).durs
  if (!Array.isArray(value)) return []
  return value.flatMap((item): DurationOption[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const value = typeof record.key === 'number' || typeof record.key === 'string' ? String(record.key) : ''
    const label = typeof record.label === 'string' ? record.label : value ? `${value}s` : ''
    return value && label ? [{ value, label }] : []
  })
}

function readDefaultParam(meta: unknown, key: string): string {
  if (!meta || typeof meta !== 'object') return ''
  const defaultParams = (meta as Record<string, unknown>).defaultParams
  if (!defaultParams || typeof defaultParams !== 'object') return ''
  const value = (defaultParams as Record<string, unknown>)[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function resultPreviewUrl(node: GenerationCanvasNode | undefined): string {
  return String(node?.result?.url || node?.result?.thumbnailUrl || node?.history?.[0]?.url || node?.history?.[0]?.thumbnailUrl || '').trim()
}

export function assetUrl(asset: WorkbenchAssetDto): string {
  const data = asset.data && typeof asset.data === 'object' && !Array.isArray(asset.data)
    ? asset.data as Record<string, unknown>
    : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  if (url) return url
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (imageUrl) return imageUrl
  return typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.trim() : ''
}

export function optionKey(option: SelectOption): string {
  return typeof option === 'string' ? option || 'auto' : String(option.value)
}

export function optionValue(option: SelectOption): string {
  return typeof option === 'string' ? option : String(option.value)
}

export function optionLabel(option: SelectOption): string {
  if (typeof option === 'string') return option || '自动'
  return formatVideoOptionLabel(option.label, option.priceLabel)
}

export function controlValueToString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function parseControlInput(control: ModelParameterControl, value: string): string | number | boolean | null {
  if (control.type === 'boolean') return value === 'true'
  if (control.type === 'number') {
    if (!value.trim()) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return value
}

export function controlInitialValue(control: ModelParameterControl, meta: Record<string, unknown>): string {
  const current = meta[control.key]
  if (typeof current !== 'undefined') return controlValueToString(current)
  if (typeof control.defaultValue !== 'undefined') return controlValueToString(control.defaultValue)
  const firstOption = control.options[0]
  return firstOption ? controlValueToString(firstOption.value) : ''
}

export function catalogControlInitialValue(control: DynamicCatalogControl, meta: Record<string, unknown>): string {
  const current = meta[control.key]
  if (typeof current !== 'undefined') return controlValueToString(current)
  if (typeof control.defaultValue !== 'undefined') return controlValueToString(control.defaultValue)
  const firstOption = control.options[0]
  return firstOption ? optionValue(firstOption) : ''
}

export function isParameterControl(control: DynamicModelControl): control is DynamicParameterControl {
  return control.binding === 'parameter'
}

function controlEquivalentKeys(key: string): string[] {
  return [key, ...(PARAMETER_CONTROL_BINDING_KEYS[key] || [])]
}

function controlStoredKeys(control: DynamicModelControl): string[] {
  if (isParameterControl(control)) return controlEquivalentKeys(control.key)
  if (control.binding === 'aspectRatio') return ['aspect_ratio', 'aspectRatio', 'aspect', 'size', 'imageSize']
  if (control.binding === 'imageSize') return ['imageSize', 'size']
  if (control.binding === 'durationSeconds') return ['durationSeconds', 'videoDuration']
  if (control.binding === 'size') return ['aspect_ratio', 'aspectRatio', 'videoSize', 'size', 'aspect']
  if (control.binding === 'resolution') return ['resolution', 'videoResolution']
  return [control.key]
}

function hasControlForAnyKey(existingKeys: Set<string>, keys: readonly string[]): boolean {
  return keys.some((key) => existingKeys.has(key))
}

function optionDefaultValue(options: readonly SelectOption[], preferred: string | number | boolean | undefined): string | number | boolean | undefined {
  if (typeof preferred !== 'undefined' && String(preferred).trim()) return preferred
  const firstOption = options[0]
  return typeof firstOption === 'undefined' ? undefined : optionValue(firstOption)
}

function optionListHasValues(options: readonly SelectOption[]): boolean {
  return options.length > 0
}

function catalogImageOptions(
  config: ImageModelCatalogConfig | null,
  source: 'aspectRatioOptions' | 'imageSizeOptions' | 'resolutionOptions',
): SelectOption[] {
  if (!config) return []
  if (source === 'aspectRatioOptions') return config.aspectRatioOptions
  if (source === 'resolutionOptions') return config.resolutionOptions
  return config.imageSizeOptions
}

function catalogVideoOptions(
  config: VideoModelCatalogConfig | null,
  source: 'durationOptions' | 'sizeOptions' | 'resolutionOptions' | 'orientationOptions',
): SelectOption[] {
  if (!config) return []
  if (source === 'durationOptions') return config.durationOptions
  if (source === 'resolutionOptions') return config.resolutionOptions
  if (source === 'orientationOptions') return config.orientationOptions
  return config.sizeOptions
}

function imageBindingDefaultValue(
  config: ImageModelCatalogConfig,
  binding: ImageModelControlBinding,
): string | undefined {
  if (binding === 'aspectRatio') return config.defaultAspectRatio
  if (binding === 'imageSize') return config.defaultImageSize
  return undefined
}

function videoBindingDefaultValue(
  config: VideoModelCatalogConfig,
  binding: VideoModelControlBinding,
): string | number | undefined {
  if (binding === 'durationSeconds') return config.defaultDurationSeconds
  if (binding === 'size') return config.defaultSize
  if (binding === 'resolution') return config.defaultResolution
  return config.defaultOrientation
}

function defaultImageCatalogControls(config: ImageModelCatalogConfig | null): DynamicCatalogControl[] {
  if (!config) return []
  const controls: DynamicCatalogControl[] = [
    {
      key: 'aspect_ratio',
      label: '比例',
      binding: 'aspectRatio',
      options: config.aspectRatioOptions,
      defaultValue: optionDefaultValue(config.aspectRatioOptions, config.defaultAspectRatio),
    },
    {
      key: 'resolution',
      label: '清晰度',
      binding: 'resolution',
      options: config.resolutionOptions,
      defaultValue: optionDefaultValue(config.resolutionOptions, undefined),
    },
  ]
  return controls.filter((control) => optionListHasValues(control.options))
}

function defaultVideoCatalogControls(config: VideoModelCatalogConfig | null): DynamicCatalogControl[] {
  if (!config) return []
  const controls: DynamicCatalogControl[] = [
    {
      key: 'durationSeconds',
      label: '时长',
      binding: 'durationSeconds',
      options: config.durationOptions,
      defaultValue: optionDefaultValue(config.durationOptions, config.defaultDurationSeconds),
    },
    {
      key: 'aspect_ratio',
      label: '画幅',
      binding: 'size',
      options: config.sizeOptions,
      defaultValue: optionDefaultValue(config.sizeOptions, config.defaultSize),
    },
    {
      key: 'resolution',
      label: '分辨率',
      binding: 'resolution',
      options: config.resolutionOptions,
      defaultValue: optionDefaultValue(config.resolutionOptions, config.defaultResolution),
    },
  ]
  return controls.filter((control) => optionListHasValues(control.options))
}

function explicitImageCatalogControls(config: ImageModelCatalogConfig | null): DynamicCatalogControl[] {
  if (!config) return []
  return config.controls.flatMap((control): DynamicCatalogControl[] => {
    const options = catalogImageOptions(config, control.optionSource)
    if (!options.length) return []
    return [{
      key: control.key,
      label: control.label,
      binding: control.binding,
      options,
      defaultValue: optionDefaultValue(options, imageBindingDefaultValue(config, control.binding)),
    }]
  })
}

function explicitVideoCatalogControls(config: VideoModelCatalogConfig | null): DynamicCatalogControl[] {
  if (!config) return []
  return config.controls.flatMap((control): DynamicCatalogControl[] => {
    const options = catalogVideoOptions(config, control.optionSource)
    if (!options.length) return []
    return [{
      key: control.key,
      label: control.label,
      binding: control.binding,
      options,
      defaultValue: optionDefaultValue(options, videoBindingDefaultValue(config, control.binding)),
    }]
  })
}

// A free-form text/number control with no options, no default, and no
// placeholder renders as an empty input box that carries no information and
// no action value (e.g. kie's `callBackUrl` plumbing param). Drop it from the
// node toolbar — boolean/select controls and anything with a default/options
// stay. (Rule 2: 没有行动价值的信息 = 噪音 = 删)
function isEmptyInputControl(control: ModelParameterControl): boolean {
  if (control.type !== 'text' && control.type !== 'number') return false
  if (control.options.length > 0) return false
  const hasDefault = typeof control.defaultValue !== 'undefined' && String(control.defaultValue).trim() !== ''
  const hasPlaceholder = typeof control.placeholder === 'string' && control.placeholder.trim() !== ''
  return !hasDefault && !hasPlaceholder
}

function dedupeParamControls(controls: ModelParameterControl[]): ModelParameterControl[] {
  const usedKeys = new Set<string>()
  return controls.filter((control) => {
    const keys = controlEquivalentKeys(control.key)
    if (hasControlForAnyKey(usedKeys, keys)) return false
    keys.forEach((k) => usedKeys.add(k))
    return true
  })
}

export function buildDynamicControls(input: {
  parameterControls: ModelParameterControl[]
  imageCatalogConfig: ImageModelCatalogConfig | null
  videoCatalogConfig: VideoModelCatalogConfig | null
  isImageLike: boolean
  isVideoLike: boolean
}): DynamicModelControl[] {
  const paramControls = dedupeParamControls(
    // image-url-like params render as reference boxes at the top (buildImageUrlSlots),
    // so they must NOT also appear in the bottom value row.
    input.parameterControls.filter((c) => !looksLikeImageUrlControl(c) && !isEmptyInputControl(c)),
  )
  const controls: DynamicModelControl[] = paramControls.map((control) => ({
    ...control,
    binding: 'parameter',
  }))
  const usedKeys = new Set(controls.flatMap((control) => controlEquivalentKeys(control.key)))
  const catalogControls = input.isImageLike
    ? [
        ...explicitImageCatalogControls(input.imageCatalogConfig),
        ...defaultImageCatalogControls(input.imageCatalogConfig),
      ]
    : input.isVideoLike
      ? [
          ...explicitVideoCatalogControls(input.videoCatalogConfig),
          ...defaultVideoCatalogControls(input.videoCatalogConfig),
        ]
      : []

  catalogControls.forEach((control) => {
    const keys = controlEquivalentKeys(control.key)
    if (hasControlForAnyKey(usedKeys, keys)) return
    controls.push(control)
    keys.forEach((key) => usedKeys.add(key))
  })
  return controls
}

function defaultPatchForParameterControl(control: ModelParameterControl): Record<string, unknown> {
  if (typeof control.defaultValue === 'undefined') return {}
  return { [control.key]: control.defaultValue }
}

export function defaultPatchForCatalogControl(control: DynamicCatalogControl): Record<string, unknown> {
  const value = optionDefaultValue(control.options, control.defaultValue)
  if (typeof value === 'undefined') return {}
  if (control.binding === 'aspectRatio') {
    return {
      [control.key]: value,
      aspect_ratio: value,
      aspectRatio: value,
      aspect: value,
      size: value,
      imageSize: value,
    }
  }
  if (control.binding === 'imageSize') {
    return {
      [control.key]: value,
      imageSize: value,
      size: value,
    }
  }
  if (control.binding === 'durationSeconds') {
    const durationSeconds = Number(value)
    return Number.isFinite(durationSeconds)
      ? { [control.key]: durationSeconds, durationSeconds, videoDuration: durationSeconds }
      : {}
  }
  if (control.binding === 'size') {
    const nextSize = String(value).trim().replace(/\s+/g, '')
    return {
      [control.key]: nextSize,
      aspect_ratio: nextSize,
      aspectRatio: nextSize,
      videoSize: nextSize,
      size: nextSize,
      aspect: nextSize,
    }
  }
  if (control.binding === 'resolution') {
    return {
      [control.key]: value,
      resolution: value,
      videoResolution: value,
    }
  }
  if (control.binding === 'orientation') {
    return { [control.key]: normalizeOrientation(value as Orientation) }
  }
  return { [control.key]: value }
}

export function defaultPatchForControls(controls: readonly DynamicModelControl[]): Record<string, unknown> {
  return controls.reduce<Record<string, unknown>>((acc, control) => ({
    ...acc,
    ...(isParameterControl(control)
      ? defaultPatchForParameterControl(control)
      : defaultPatchForCatalogControl(control)),
  }), {})
}

export function removePreviousControlParams(
  meta: Record<string, unknown>,
  controls: readonly DynamicModelControl[],
): Record<string, unknown> {
  const removable = new Set(controls.flatMap(controlStoredKeys))
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !removable.has(key)),
  )
}

export function buildEffectiveImageCatalogConfig(meta: unknown): ImageModelCatalogConfig | null {
  const parsed = parseImageModelCatalogConfig(meta)
  if (parsed) return parsed
  const legacySizes = readStringArray(meta, 'sizes')
  if (!legacySizes.length) return null
  const defaultImageSize = readDefaultParam(meta, 'size')
  return {
    ...(defaultImageSize ? { defaultImageSize } : {}),
    aspectRatioOptions: [],
    imageSizeOptions: legacySizes.map((value) => ({ value, label: value })),
    resolutionOptions: [],
    controls: [{ key: 'size', label: '比例', binding: 'aspectRatio', optionSource: 'imageSizeOptions' }],
  }
}

export function buildEffectiveVideoCatalogConfig(meta: unknown): VideoModelCatalogConfig | null {
  const parsed = parseVideoModelCatalogConfig(meta)
  if (parsed) return parsed
  const legacyRatios = readStringArray(meta, 'ratios')
  const legacyDurations = readDurationOptions(meta).flatMap((option) => {
    const rawValue = typeof option === 'string' ? option : String(option.value)
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) return []
    return [{ value: Math.trunc(value), label: typeof option === 'string' ? `${Math.trunc(value)}s` : option.label }]
  })
  const legacyResolutions = readStringArray(meta, 'resolutions')
  if (!legacyRatios.length && !legacyDurations.length && !legacyResolutions.length) return null
  const defaultDuration = Number(readDefaultParam(meta, 'duration'))
  const defaultSize = readDefaultParam(meta, 'ratio')
  const defaultResolution = readDefaultParam(meta, 'resolution')
  return {
    ...(Number.isFinite(defaultDuration) && defaultDuration > 0 ? { defaultDurationSeconds: Math.trunc(defaultDuration) } : {}),
    ...(defaultSize ? { defaultSize } : {}),
    ...(defaultResolution ? { defaultResolution } : {}),
    durationOptions: legacyDurations,
    sizeOptions: legacyRatios.map((value) => ({ value, label: value })),
    resolutionOptions: legacyResolutions.map((value) => ({ value, label: value })),
    orientationOptions: [],
    controls: [
      { key: 'durationSeconds', label: '时长', binding: 'durationSeconds', optionSource: 'durationOptions' },
      { key: 'aspect_ratio', label: '画幅', binding: 'size', optionSource: 'sizeOptions' },
      { key: 'resolution', label: '分辨率', binding: 'resolution', optionSource: 'resolutionOptions' },
    ],
  }
}

/** 设置芯片的摘要：当前标量值串成「16:9 · 720p · 5s · 🔊」（模式不进摘要——它常驻在模式条上）。 */
export function buildSettingsSummary(controls: DynamicModelControl[], meta: Record<string, unknown>): string {
  const parts = controls.flatMap((control) => {
    if (isParameterControl(control)) {
      if (control.type === 'boolean') return controlInitialValue(control, meta) === 'true' ? ['🔊'] : []
      const value = controlInitialValue(control, meta)
      if (!value) return []
      return [control.key === 'duration' || control.key === 'durationSeconds' ? `${value}s` : value]
    }
    const value = catalogControlInitialValue(control, meta)
    return value ? [value] : []
  })
  return parts.join(' · ')
}

export function buildModelControls(meta: unknown, isImageLike: boolean, isVideoLike: boolean): DynamicModelControl[] {
  return buildDynamicControls({
    parameterControls: parseModelParameterControls(meta),
    imageCatalogConfig: buildEffectiveImageCatalogConfig(meta),
    videoCatalogConfig: buildEffectiveVideoCatalogConfig(meta),
    isImageLike,
    isVideoLike,
  })
}
