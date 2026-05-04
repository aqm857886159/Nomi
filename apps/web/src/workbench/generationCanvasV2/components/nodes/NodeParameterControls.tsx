import React from 'react'
import { deriveGenerationModelCatalogStatus, findModelOptionByIdentifier, useGenerationModelOptionsState } from '../../adapters/modelOptionsAdapter'
import {
  formatVideoOptionLabel,
  parseModelParameterControls,
  parseImageModelCatalogConfig,
  parseVideoModelCatalogConfig,
  type ImageModelCatalogConfig,
  type ImageModelControlBinding,
  type ModelParameterControl,
  type ModelParameterControlOption,
  type VideoModelCatalogConfig,
  type VideoModelControlBinding,
} from '../../../../config/modelCatalogMeta'
import { normalizeOrientation, type Orientation } from '../../../../utils/orientation'
import type { ModelOption } from '../../../../config/models'
import { WorkbenchButton } from '../../../../design'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { uploadWorkbenchServerAssetFile, type ServerAssetDto } from '../../../api/assetUploadApi'

type SelectOption = string | {
  value: string | number
  label: string
  priceLabel?: string
}

type DurationOption = string | {
  value: string | number
  label: string
  priceLabel?: string
}

type NodeParameterControlsProps = {
  node: GenerationCanvasNode
  section?: 'all' | 'references' | 'parameters' | 'model' | 'controls'
  valueOnly?: boolean
}

type DynamicCatalogControl = {
  key: string
  label: string
  binding:
    | ImageModelControlBinding
    | VideoModelControlBinding
    | 'parameter'
  options: SelectOption[]
  defaultValue?: string | number | boolean
}

type DynamicParameterControl = ModelParameterControl & {
  binding: 'parameter'
}

type DynamicModelControl = DynamicParameterControl | DynamicCatalogControl

type ImageUrlGroup = 'first_frame' | 'last_frame' | 'reference'

type ImageUrlSlot = {
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

function edgeModeForGroup(group: ImageUrlGroup): GenerationCanvasEdgeMode {
  if (group === 'first_frame') return 'first_frame'
  if (group === 'last_frame') return 'last_frame'
  return 'reference'
}

function getEdgeSourceForSlot(
  group: ImageUrlGroup,
  edges: GenerationCanvasEdge[],
  targetNodeId: string,
): string {
  const mode = edgeModeForGroup(group)
  return edges.find((e) => e.target === targetNodeId && e.mode === mode)?.source || ''
}

function buildImageUrlSlots(meta: unknown): ImageUrlSlot[] {
  const controls = parseModelParameterControls(meta)
  return controls
    .filter((c) => c.type === 'image-url')
    .map((c) => ({ key: c.key, label: c.label, group: inferImageUrlGroup(c.key) }))
}

function imageCatalogReferenceSlot(config: ImageModelCatalogConfig | null): ImageUrlSlot[] {
  return config?.supportsReferenceImages
    ? [{ key: 'referenceImageUrl', label: '参考图', group: 'reference' }]
    : []
}

function getSlotNodeRef(meta: Record<string, unknown>, paramKey: string): string {
  const direct = readMeta(meta, paramKey + '_nodeRef')
  if (direct) return direct
  if (paramKey === 'firstFrameUrl') return readMeta(meta, 'firstFrameRef')
  if (paramKey === 'lastFrameUrl') return readMeta(meta, 'lastFrameRef')
  if (paramKey === 'referenceImageUrl' || paramKey === 'imageUrl') return readMeta(meta, 'referenceImageRef')
  return ''
}

function getSlotThumbUrl(meta: Record<string, unknown>, paramKey: string, nodes: GenerationCanvasNode[]): string {
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

function readMeta(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function readMetaNumber(meta: Record<string, unknown> | undefined, key: string): number {
  const value = meta?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : 0
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

function resultPreviewUrl(node: GenerationCanvasNode | undefined): string {
  return String(node?.result?.url || node?.result?.thumbnailUrl || node?.history?.[0]?.url || node?.history?.[0]?.thumbnailUrl || '').trim()
}

function assetUrl(asset: ServerAssetDto): string {
  const data = asset.data && typeof asset.data === 'object' && !Array.isArray(asset.data)
    ? asset.data as Record<string, unknown>
    : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  if (url) return url
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (imageUrl) return imageUrl
  return typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.trim() : ''
}

function optionKey(option: SelectOption): string {
  return typeof option === 'string' ? option || 'auto' : String(option.value)
}

function optionValue(option: SelectOption): string {
  return typeof option === 'string' ? option : String(option.value)
}

function optionLabel(option: SelectOption): string {
  if (typeof option === 'string') return option || '自动'
  return formatVideoOptionLabel(option.label, option.priceLabel)
}

function controlValueToString(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function parseControlInput(control: ModelParameterControl, value: string): string | number | boolean | null {
  if (control.type === 'boolean') return value === 'true'
  if (control.type === 'number') {
    if (!value.trim()) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return value
}

function controlInitialValue(control: ModelParameterControl, meta: Record<string, unknown>): string {
  const current = meta[control.key]
  if (typeof current !== 'undefined') return controlValueToString(current)
  if (typeof control.defaultValue !== 'undefined') return controlValueToString(control.defaultValue)
  const firstOption = control.options[0]
  return firstOption ? controlValueToString(firstOption.value) : ''
}

function catalogControlInitialValue(control: DynamicCatalogControl, meta: Record<string, unknown>): string {
  const current = meta[control.key]
  if (typeof current !== 'undefined') return controlValueToString(current)
  if (typeof control.defaultValue !== 'undefined') return controlValueToString(control.defaultValue)
  const firstOption = control.options[0]
  return firstOption ? optionValue(firstOption) : ''
}

function isParameterControl(control: DynamicModelControl): control is DynamicParameterControl {
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

function dedupeParamControls(controls: ModelParameterControl[]): ModelParameterControl[] {
  const usedKeys = new Set<string>()
  return controls.filter((control) => {
    const keys = controlEquivalentKeys(control.key)
    if (hasControlForAnyKey(usedKeys, keys)) return false
    keys.forEach((k) => usedKeys.add(k))
    return true
  })
}

function buildDynamicControls(input: {
  parameterControls: ModelParameterControl[]
  imageCatalogConfig: ImageModelCatalogConfig | null
  videoCatalogConfig: VideoModelCatalogConfig | null
  isImageLike: boolean
  isVideoLike: boolean
}): DynamicModelControl[] {
  const paramControls = dedupeParamControls(
    input.parameterControls.filter((c) => c.type !== 'image-url'),
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

function defaultPatchForCatalogControl(control: DynamicCatalogControl): Record<string, unknown> {
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

function defaultPatchForControls(controls: readonly DynamicModelControl[]): Record<string, unknown> {
  return controls.reduce<Record<string, unknown>>((acc, control) => ({
    ...acc,
    ...(isParameterControl(control)
      ? defaultPatchForParameterControl(control)
      : defaultPatchForCatalogControl(control)),
  }), {})
}

function removePreviousControlParams(
  meta: Record<string, unknown>,
  controls: readonly DynamicModelControl[],
): Record<string, unknown> {
  const removable = new Set(controls.flatMap(controlStoredKeys))
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !removable.has(key)),
  )
}

function buildEffectiveImageCatalogConfig(meta: unknown): ImageModelCatalogConfig | null {
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

function buildEffectiveVideoCatalogConfig(meta: unknown): VideoModelCatalogConfig | null {
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

function buildModelControls(meta: unknown, isImageLike: boolean, isVideoLike: boolean): DynamicModelControl[] {
  return buildDynamicControls({
    parameterControls: parseModelParameterControls(meta),
    imageCatalogConfig: buildEffectiveImageCatalogConfig(meta),
    videoCatalogConfig: buildEffectiveVideoCatalogConfig(meta),
    isImageLike,
    isVideoLike,
  })
}

function hasConfigurableControls(meta: unknown, isImageLike: boolean, isVideoLike: boolean): boolean {
  return buildModelControls(meta, isImageLike, isVideoLike).length > 0
}

function chooseDefaultModelOption(
  options: readonly ModelOption[],
  isImageLike: boolean,
  isVideoLike: boolean,
): ModelOption | undefined {
  void isImageLike
  void isVideoLike
  return options[0]
}

export default function NodeParameterControls({
  node,
  section = 'all',
  valueOnly = false,
}: NodeParameterControlsProps): JSX.Element | null {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
  const storeConnectNodes = useGenerationCanvasStore((state) => state.connectNodes)
  const storeDisconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const modelOptionsState = useGenerationModelOptionsState(node.kind)
  const modelOptions = modelOptionsState.options
  const modelCatalogStatus = deriveGenerationModelCatalogStatus(node.kind, modelOptionsState)
  const meta = node.meta || {}
  const [uploadingSlotKey, setUploadingSlotKey] = React.useState('')
  const [uploadError, setUploadError] = React.useState('')
  const [openSlotKey, setOpenSlotKey] = React.useState('')
  const isImageLike = node.kind === 'image' || node.kind === 'keyframe' || node.kind === 'character' || node.kind === 'scene'
  const isVideoLike = node.kind === 'video'
  const isGenerationNode = isImageLike || isVideoLike
  if (!isGenerationNode) return null

  const selectedModelValue = readMeta(meta, 'modelKey') || readMeta(meta, 'modelAlias') || readMeta(meta, 'imageModel') || readMeta(meta, 'videoModel')
  const selectedModelOption = findModelOptionByIdentifier(modelOptions, selectedModelValue) || null
  const imageCatalogConfig = buildEffectiveImageCatalogConfig(selectedModelOption?.meta)
  const renderedControls = buildDynamicControls({
    parameterControls: parseModelParameterControls(selectedModelOption?.meta),
    imageCatalogConfig,
    videoCatalogConfig: buildEffectiveVideoCatalogConfig(selectedModelOption?.meta),
    isImageLike,
    isVideoLike,
  })

  const updateMeta = (patch: Record<string, unknown>) => {
    updateNode(node.id, {
      meta: { ...(node.meta || {}), ...patch },
    })
  }

  const handleModelChange = (value: string) => {
    const nextOption = findModelOptionByIdentifier(modelOptions, value)
    const controls = buildModelControls(nextOption?.meta, isImageLike, isVideoLike)
    const defaultPatch = defaultPatchForControls(controls)
    updateNode(node.id, {
      meta: {
        ...removePreviousControlParams(node.meta || {}, renderedControls),
        modelKey: nextOption?.modelKey || nextOption?.value || value || null,
        modelAlias: nextOption?.modelAlias || nextOption?.value || value || null,
        modelVendor: nextOption?.vendor || null,
        vendor: nextOption?.vendor || null,
        modelLabel: nextOption?.label || value || null,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: nextOption?.value || value || null, videoModelVendor: nextOption?.vendor || null }
          : { imageModel: nextOption?.value || value || null, imageModelVendor: nextOption?.vendor || null }),
      },
    })
  }

  React.useEffect(() => {
    if (!isGenerationNode) return
    if (selectedModelValue) return
    const firstOption = chooseDefaultModelOption(modelOptions, isImageLike, isVideoLike)
    if (!firstOption?.value) return
    const defaultPatch = defaultPatchForControls(buildModelControls(firstOption.meta, isImageLike, isVideoLike))
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: firstOption.modelKey || firstOption.value,
        modelAlias: firstOption.modelAlias || firstOption.value,
        modelVendor: firstOption.vendor || null,
        vendor: firstOption.vendor || null,
        modelLabel: firstOption.label,
        ...defaultPatch,
        ...(isVideoLike
          ? { videoModel: firstOption.value, videoModelVendor: firstOption.vendor || null }
          : { imageModel: firstOption.value, imageModelVendor: firstOption.vendor || null }),
      },
    })
  }, [isGenerationNode, isVideoLike, modelOptions, node.id, node.meta, selectedModelValue, updateNode])

  React.useEffect(() => {
    if (!isGenerationNode || !selectedModelOption) return
    const optionVendor = typeof selectedModelOption.vendor === 'string' ? selectedModelOption.vendor.trim() : ''
    const currentVendor =
      readMeta(meta, 'modelVendor') ||
      readMeta(meta, 'vendor') ||
      readMeta(meta, isVideoLike ? 'videoModelVendor' : 'imageModelVendor')
    if (!optionVendor || currentVendor === optionVendor) return
    updateNode(node.id, {
      meta: {
        ...(node.meta || {}),
        modelKey: selectedModelOption.modelKey || selectedModelOption.value,
        modelAlias: selectedModelOption.modelAlias || selectedModelOption.value,
        modelVendor: optionVendor,
        vendor: optionVendor,
        modelLabel: selectedModelOption.label,
        ...(isVideoLike
          ? { videoModel: selectedModelOption.value, videoModelVendor: optionVendor }
          : { imageModel: selectedModelOption.value, imageModelVendor: optionVendor }),
      },
    })
  }, [isGenerationNode, isVideoLike, meta, node.id, node.meta, selectedModelOption, updateNode])
  const handleParameterControlChange = (control: ModelParameterControl, value: string) => {
    updateMeta({ [control.key]: parseControlInput(control, value) })
  }

  const handleCatalogControlChange = (control: DynamicCatalogControl, value: string) => {
    updateMeta(defaultPatchForCatalogControl({ ...control, defaultValue: value }))
  }
  const handleSlotAssignment = (slot: ImageUrlSlot, newSourceNodeId: string) => {
    const targetMode = edgeModeForGroup(slot.group)
    if (!newSourceNodeId) {
      const existingEdge = edges.find((e) => e.target === node.id && e.mode === targetMode)
      if (existingEdge) storeDisconnectEdge(existingEdge.id)
      const clearPatch: Record<string, unknown> = { [slot.key]: null, [slot.key + '_nodeRef']: null }
      if (slot.group === 'first_frame') { clearPatch.firstFrameUrl = null; clearPatch.firstFrameRef = null }
      if (slot.group === 'last_frame') { clearPatch.lastFrameUrl = null; clearPatch.lastFrameRef = null }
      if (slot.group === 'reference') { clearPatch.referenceImages = []; clearPatch.referenceImageUrl = null; clearPatch.referenceImageRef = null }
      updateNode(node.id, { meta: { ...meta, ...clearPatch } })
      setOpenSlotKey('')
      return
    }
    const existingFromSource = edges.find((e) => e.source === newSourceNodeId && e.target === node.id)
    if (existingFromSource) {
      if (existingFromSource.mode !== targetMode) updateEdgeMode(existingFromSource.id, targetMode)
    } else {
      storeConnectNodes(newSourceNodeId, node.id, targetMode)
    }
    const conflictEdge = edges.find((e) => e.target === node.id && e.mode === targetMode && e.source !== newSourceNodeId)
    if (conflictEdge) storeDisconnectEdge(conflictEdge.id)
    const sourceNode = nodes.find((n) => n.id === newSourceNodeId)
    const url = resultPreviewUrl(sourceNode)
    const patch: Record<string, unknown> = { [slot.key]: url || null, [slot.key + '_nodeRef']: newSourceNodeId }
    if (slot.group === 'first_frame') { patch.firstFrameUrl = url || null; patch.firstFrameRef = newSourceNodeId }
    if (slot.group === 'last_frame') { patch.lastFrameUrl = url || null; patch.lastFrameRef = newSourceNodeId }
    if (slot.group === 'reference') { patch.referenceImages = url ? [url] : []; patch.referenceImageUrl = url || null; patch.referenceImageRef = newSourceNodeId }
    updateNode(node.id, { meta: { ...meta, ...patch } })
    setOpenSlotKey('')
  }
  const handleSlotUpload = async (slot: ImageUrlSlot, file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('只能选择图片文件')
      return
    }
    setUploadingSlotKey(slot.key)
    setUploadError('')
    try {
      const uploaded = await uploadWorkbenchServerAssetFile(file, file.name || slot.label, {
        ownerNodeId: node.id,
        taskKind: 'image_edit',
      })
      const url = assetUrl(uploaded)
      if (!url) throw new Error('服务器没有返回图片 URL')
      const patch: Record<string, unknown> = {
        [slot.key]: url,
        [slot.key + '_nodeRef']: null,
      }
      if (slot.group === 'first_frame') { patch.firstFrameUrl = url; patch.firstFrameRef = null }
      if (slot.group === 'last_frame') { patch.lastFrameUrl = url; patch.lastFrameRef = null }
      if (slot.group === 'reference') { patch.referenceImages = [url]; patch.referenceImageUrl = url; patch.referenceImageRef = null }
      updateNode(node.id, { meta: { ...(useGenerationCanvasStore.getState().nodes.find((n) => n.id === node.id)?.meta || meta), ...patch } })
      setOpenSlotKey('')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadingSlotKey('')
    }
  }

  const modelImageUrlSlots = [
    ...buildImageUrlSlots(selectedModelOption?.meta),
    ...imageCatalogReferenceSlot(imageCatalogConfig),
  ].filter((slot, index, slots) => slots.findIndex((item) => item.key === slot.key && item.group === slot.group) === index)
  const imageUrlSlots: ImageUrlSlot[] = isVideoLike && modelImageUrlSlots.length === 0
    ? [
        { key: 'firstFrameUrl', label: '首帧', group: 'first_frame' },
        { key: 'lastFrameUrl', label: '尾帧', group: 'last_frame' },
      ]
    : modelImageUrlSlots
  const activeSlots = imageUrlSlots
  const IMAGE_LIKE_KINDS = new Set(['image', 'keyframe', 'character', 'scene'])
  const candidateImageNodes = nodes.filter((item) => item.id !== node.id && IMAGE_LIKE_KINDS.has(item.kind))
  const showReferences = section === 'all' || section === 'references'
  const showModel = section === 'all' || section === 'parameters' || section === 'model'
  const showControls = section === 'all' || section === 'parameters' || section === 'controls'

  if (section === 'references' && imageUrlSlots.length === 0) return null

  const rootClassName = section === 'references'
    ? 'generation-canvas-v2-node__ref-section'
    : [
        'generation-canvas-v2-node__params',
        valueOnly ? 'generation-canvas-v2-node__params--value-only' : '',
        section === 'parameters' || section === 'model' ? 'generation-canvas-v2-node__params--parameters' : '',
        section === 'controls' ? 'generation-canvas-v2-node__params--controls' : '',
      ].filter(Boolean).join(' ')

  return (
    <div className={rootClassName} aria-label={section === 'references' ? '参考素材' : '节点参数'}>
      {showModel ? (
        <label className="generation-canvas-v2-node__param">
          <span>模型</span>
          <select
            aria-label="模型"
            value={modelOptions.length > 0 ? selectedModelOption?.value || '' : ''}
            disabled={modelOptions.length === 0}
            onChange={(event) => handleModelChange(event.target.value)}
          >
            <option value="">{modelOptions.length === 0 ? modelCatalogStatus.message : '选择模型'}</option>
            {modelOptions.length > 0
              ? modelOptions.map((option) => (
                <option key={option.value || 'auto'} value={option.value}>{option.label}</option>
              ))
              : null}
          </select>
        </label>
      ) : null}

      {showControls ? renderedControls.map((control) => (
        <label key={control.key} className="generation-canvas-v2-node__param">
          <span>{control.label}</span>
          {!isParameterControl(control) ? (
            <select
              aria-label={control.label}
              value={catalogControlInitialValue(control, meta)}
              onChange={(event) => handleCatalogControlChange(control, event.target.value)}
            >
              {control.options.map((option) => (
                <option key={optionKey(option)} value={optionValue(option)}>{optionLabel(option)}</option>
              ))}
            </select>
          ) : control.type === 'boolean' ? (
            <select
              aria-label={control.label}
              value={controlInitialValue(control, meta)}
              onChange={(event) => handleParameterControlChange(control, event.target.value)}
            >
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </select>
          ) : control.options.length > 0 ? (
            <select
              aria-label={control.label}
              value={controlInitialValue(control, meta)}
              onChange={(event) => handleParameterControlChange(control, event.target.value)}
            >
              {control.options.map((option) => (
                <option key={controlValueToString(option.value)} value={controlValueToString(option.value)}>
                  {formatVideoOptionLabel(option.label, option.priceLabel)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="generation-canvas-v2-node__param-input"
              aria-label={control.label}
              type={control.type === 'number' ? 'number' : 'text'}
              value={controlInitialValue(control, meta)}
              min={control.min}
              max={control.max}
              step={control.step}
              placeholder={control.placeholder}
              onChange={(event) => handleParameterControlChange(control, event.target.value)}
            />
          )}
        </label>
      )) : null}

      {showReferences && imageUrlSlots.length > 0 ? (
        <div className="generation-canvas-v2-node__ref-pickers">
          {activeSlots.map((slot) => {
            const edgeSource = getEdgeSourceForSlot(slot.group, edges, node.id)
            const metaRef = getSlotNodeRef(meta, slot.key)
            const nodeRef = edgeSource || metaRef
            const thumbNode = nodeRef ? nodes.find((n) => n.id === nodeRef) : undefined
            const thumbUrl = (thumbNode ? resultPreviewUrl(thumbNode) : null) || getSlotThumbUrl(meta, slot.key, nodes)
            const isEdgeConnected = Boolean(edgeSource)
            const isOpen = openSlotKey === slot.key
            return (
              <div key={slot.key} className="generation-canvas-v2-node__ref-picker">
                <WorkbenchButton
                  className="generation-canvas-v2-node__ref-thumb"
                  aria-label={slot.label}
                  data-filled={thumbUrl ? 'true' : 'false'}
                  data-edge={isEdgeConnected ? 'true' : 'false'}
                  title={slot.label}
                  onClick={() => setOpenSlotKey(isOpen ? '' : slot.key)}
                >
                  {thumbUrl ? (
                    <img className="generation-canvas-v2-node__ref-thumb-image" src={thumbUrl} alt={slot.label} />
                  ) : (
                    <span className="generation-canvas-v2-node__ref-thumb-icon">+</span>
                  )}
                </WorkbenchButton>
                {isOpen ? (
                  <div className="generation-canvas-v2-node__ref-menu" role="menu" aria-label={`${slot.label}来源`}>
                    <label className="generation-canvas-v2-node__ref-menu-item generation-canvas-v2-node__ref-menu-item--upload">
                      <span className="generation-canvas-v2-node__ref-thumb-icon">{uploadingSlotKey === slot.key ? '…' : '+'}</span>
                      <input
                        className="generation-canvas-v2-node__ref-file-input"
                        aria-label={`${slot.label}本地图像`}
                        type="file"
                        accept="image/*"
                        disabled={Boolean(uploadingSlotKey)}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] || null
                          void handleSlotUpload(slot, file)
                          event.currentTarget.value = ''
                        }}
                      />
                    </label>
                    {candidateImageNodes.map((item) => {
                      const itemUrl = resultPreviewUrl(item)
                      if (!itemUrl) return null
                      return (
                        <WorkbenchButton
                          key={item.id}
                          className="generation-canvas-v2-node__ref-menu-item"
                          aria-label={item.title}
                          onClick={() => handleSlotAssignment(slot, item.id)}
                        >
                          <img className="generation-canvas-v2-node__ref-menu-image" src={itemUrl} alt={item.title} />
                        </WorkbenchButton>
                      )
                    })}
                    {nodeRef ? (
                      <WorkbenchButton
                        className="generation-canvas-v2-node__ref-menu-item generation-canvas-v2-node__ref-menu-item--clear"
                        aria-label="清除参考图"
                        onClick={() => handleSlotAssignment(slot, '')}
                      >
                        ×
                      </WorkbenchButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {uploadError ? (
            <div className="generation-canvas-v2-node__ref-error" role="alert">{uploadError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
