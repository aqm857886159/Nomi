import { parseImageModelCatalogConfig, parseVideoModelCatalogConfig } from '../../../config/modelCatalogMeta'
import {
  getModelOptionRequestAlias,
  deriveModelCatalogStatus,
  findModelOptionByIdentifier as findCatalogModelOptionByIdentifier,
  useModelOptions,
  useModelOptionsState,
  type ModelOptionsState,
} from '../../../config/useModelOptions'
import { normalizeOrientation, type Orientation } from '../../../utils/orientation'
import i18n from '../../../i18n'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import type { ModelOption, NodeKind } from '../../../config/models'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeCatalogKind, isVideoLikeGenerationNodeKind } from '../model/generationNodeKinds'

export function findModelOptionByIdentifier(
  options: readonly ModelOption[],
  value: string | null | undefined,
): ModelOption | null {
  return findCatalogModelOptionByIdentifier(options, value)
}

export type GenerationModelSelection = {
  modelValue: string
  modelAlias: string
  vendor: string | null
  modelLabel: string
  meta: unknown
}

export function useGenerationModelOptions(kind: GenerationNodeKind): ModelOption[] {
  return useModelOptions(toCatalogNodeKind(kind))
}

export function useGenerationModelOptionsState(kind: GenerationNodeKind): ModelOptionsState {
  return useModelOptionsState(toCatalogNodeKind(kind))
}

export function deriveGenerationModelCatalogStatus(kind: GenerationNodeKind, state: ModelOptionsState) {
  return deriveModelCatalogStatus({
    kind: toCatalogNodeKind(kind),
    options: state.options,
    health: state.health,
    error: state.error,
    healthError: state.healthError,
    loading: state.loading,
  })
}

function toCatalogNodeKind(kind: GenerationNodeKind): NodeKind {
  return getGenerationNodeCatalogKind(kind)
}

export function resolveGenerationModelSelection(
  options: readonly ModelOption[],
  value: string | null | undefined,
): GenerationModelSelection {
  const matched = findModelOptionByIdentifier(options, value)
  const fallbackValue = String(value || '').trim()
  const modelValue = matched?.value || fallbackValue
  const modelAlias = getModelOptionRequestAlias(options, modelValue)
  const vendor = matched?.vendor || null
  const modelLabel = matched?.label || modelValue || modelAlias
  return {
    modelValue,
    modelAlias,
    vendor,
    modelLabel,
    meta: matched?.meta,
  }
}

export function readImageCatalogConfig(option: ModelOption | null | undefined) {
  return parseImageModelCatalogConfig(option?.meta)
}

export function readVideoCatalogConfig(option: ModelOption | null | undefined) {
  return parseVideoModelCatalogConfig(option?.meta)
}

export function getNodeSelectedModelValue(node: GenerationCanvasNode): string {
  return String(
    node.meta?.modelKey || node.meta?.modelAlias || node.meta?.imageModel || node.meta?.videoModel || '',
  ).trim()
}

export function updateNodeModelMeta(
  node: GenerationCanvasNode,
  selection: GenerationModelSelection,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    modelKey: selection.modelValue || null,
    modelAlias: selection.modelAlias || null,
    modelVendor: selection.vendor || null,
    vendor: selection.vendor || null,
    modelLabel: selection.modelLabel,
    ...(isVideoLikeGenerationNodeKind(node.kind)
      ? { videoModel: selection.modelValue || null, videoModelVendor: selection.vendor || null }
      : { imageModel: selection.modelValue || null, imageModelVendor: selection.vendor || null }),
  }
  return base
}

export function updateNodeModelParams(
  node: GenerationCanvasNode,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(node.meta || {}),
    ...patch,
  }
}

export function normalizeImageAspect(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
}

export function normalizeImageSize(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
}

export function normalizeVideoDuration(value: string | number): number | null {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null
}

export function normalizeVideoOrientation(value: Orientation | string): Orientation {
  return normalizeOrientation(value)
}

export function getImageModelControlLabels(option: ModelOption | null | undefined) {
  const config = parseImageModelCatalogConfig(option?.meta)
  return {
    config,
    aspectLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'aspectRatio')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.frame'),
    sizeLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'imageSize')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.size'),
    resolutionLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'resolution')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.resolution'),
  }
}

export function getVideoModelControlLabels(option: ModelOption | null | undefined) {
  const config = parseVideoModelCatalogConfig(option?.meta)
  return {
    config,
    durationLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'durationSeconds')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.duration'),
    sizeLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'size')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.frame'),
    resolutionLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'resolution')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.resolution'),
    orientationLabel:
      translateModelDisplayText(config?.controls.find((control) => control.binding === 'orientation')?.label || '') ||
      i18n.t('runtime.modelCatalog.control.orientation'),
  }
}

export function useGenerationModelSelection(kind: GenerationNodeKind, value: string | null | undefined) {
  const options = useGenerationModelOptions(kind)
  return resolveGenerationModelSelection(options, value)
}
