import { resultIdentity } from '../../model/nodeResultLifecycle'
import { captureSceneTransforms, restoreSceneTransforms } from './whiteboardCanvasTypes'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { WhiteboardState } from './whiteboardTypes'
import { ASPECT_RATIOS, getCanvasDimensions, getDefaultLayers, type AspectRatioKey, type CanvasAsset } from './lib/canvas'

export function createDefaultWhiteboardState(ratio: AspectRatioKey = '16:9'): WhiteboardState {
  return {
    texts: [],
    sceneTransforms: { offsets: {}, assetTransforms: {}, flips: {} },
    canvasDimensions: getCanvasDimensions(ratio, 1280),
    strokes: [],
    canvasAssets: [],
    layers: getDefaultLayers(),
    activeLayerId: 'drawing-layer-1',
    activeRatio: ratio,
  }
}

export function isAspectRatioKey(value: unknown): value is AspectRatioKey {
  return typeof value === 'string' && ASPECT_RATIOS.some((ratio) => ratio.label === value)
}

export function readWhiteboardState(node: Pick<GenerationCanvasNode, 'meta'>): WhiteboardState | undefined {
  const value = node.meta?.whiteboardState
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<WhiteboardState>
  if (!Array.isArray(record.strokes) || !Array.isArray(record.canvasAssets) || !Array.isArray(record.layers)) return undefined
  return {
    texts: Array.isArray(record.texts) ? record.texts.map((text) => ({ ...text })) : [],
    sceneTransforms: cloneTransforms(record.sceneTransforms),
    canvasDimensions: validDimensions(record.canvasDimensions) ? { ...record.canvasDimensions } : getCanvasDimensions(isAspectRatioKey(record.activeRatio) ? record.activeRatio : '16:9', 1280),
    strokes: record.strokes,
    canvasAssets: record.canvasAssets,
    layers: record.layers,
    activeLayerId: typeof record.activeLayerId === 'string' && record.activeLayerId ? record.activeLayerId : 'drawing-layer-1',
    activeRatio: isAspectRatioKey(record.activeRatio) ? record.activeRatio : '16:9',
  }
}

/** The result version a saved draft belongs to; a board that has no result yet is keyed by its node. */
export function whiteboardDraftIdentity(node: GenerationCanvasNode): string {
  return node.result ? resultIdentity(node.result) : `board:${node.id}`
}

/** 结果 `raw` 里图层分离的标记键（落地时写，见 runner/landTaskResults）。 */
export const LAYER_SPLIT_RAW_KEY = 'layerSplit'

/** 图层分离落地的结果带的标记：拆成了几层（含底图）。「N 层」状态行、画板悬停提示、打开画板接着编图层都认它。 */
export type LayerSplitResultMark = { layers: number }

export function readLayerSplitMark(result: { raw?: unknown } | null | undefined): LayerSplitResultMark | null {
  const raw = result?.raw
  if (!raw || typeof raw !== 'object') return null
  const mark = (raw as Record<string, unknown>)[LAYER_SPLIT_RAW_KEY]
  const layers = mark && typeof mark === 'object' ? Number((mark as Record<string, unknown>).layers) : NaN
  return Number.isSafeInteger(layers) && layers >= 1 ? { layers } : null
}

function resultWhiteboardState(node: GenerationCanvasNode): WhiteboardState | undefined {
  const raw = node.result?.raw
  return raw && typeof raw === 'object' ? readWhiteboardState({ meta: { whiteboardState: (raw as Record<string, unknown>).whiteboardState } }) : undefined
}

/**
 * 图片节点打开画板时从哪份白板接着编：这一版结果上的草稿（meta，按结果身份认）优先。
 * 没有这一版的草稿时：图层分离落地的结果读它自己带的白板（`raw.whiteboardState`，各层在里面）；其余照旧——
 * 草稿属于别的版本才读结果带的白板，否则 undefined（画板把结果图导入成「原图」）。
 */
export function readWhiteboardEditingState(node: GenerationCanvasNode) {
  if (node.kind === 'whiteboard') return readWhiteboardState(node)
  const identity = node.result ? resultIdentity(node.result) : null
  const draftForThisResult = !identity || !node.meta?.whiteboardResultIdentity || node.meta.whiteboardResultIdentity === identity
  if (!draftForThisResult) return resultWhiteboardState(node)
  return readWhiteboardState(node) ?? (readLayerSplitMark(node.result) ? resultWhiteboardState(node) : undefined)
}

export function inferWhiteboardAspectRatio(width: unknown, height: unknown): AspectRatioKey {
  const w = typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 0
  const h = typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : 0
  if (!w || !h) return '16:9'
  const ratio = w / h
  let best: AspectRatioKey = '16:9'
  let bestDelta = Number.POSITIVE_INFINITY
  for (const option of ASPECT_RATIOS) {
    const delta = Math.abs(ratio - option.width / option.height)
    if (delta < bestDelta) {
      best = option.label
      bestDelta = delta
    }
  }
  return best
}

export async function loadImageSize(url: string): Promise<{ width: number; height: number } | null> {
  if (!url) return null
  return new Promise((resolve) => {
    const image = new Image()
    const timeout = window.setTimeout(() => resolve(null), 1800)
    const finish = (size: { width: number; height: number } | null) => {
      window.clearTimeout(timeout)
      resolve(size && size.width > 0 && size.height > 0 ? size : null)
    }
    image.onload = () => finish({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
    image.onerror = () => finish(null)
    image.src = url
  })
}

export function createImageAssetForCanvas(input: {
  url: string
  name?: string
  ratio: AspectRatioKey
  dimensions?: { width: number; height: number }
  imageSize?: { width: number; height: number } | null
}): { asset: CanvasAsset; layer: ReturnType<typeof getDefaultLayers>[number] } {
  const dimensions = input.dimensions ?? getCanvasDimensions(input.ratio, 1280)
  const sourceWidth = input.imageSize?.width || dimensions.width
  const sourceHeight = input.imageSize?.height || dimensions.height
  const scale = Math.min(dimensions.width / sourceWidth, dimensions.height / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const layerId = createWhiteboardId('asset-layer')
  return {
    layer: {
      id: layerId,
      name: input.name || '导入图片',
      visible: true,
      locked: false,
      opacity: 1,
      kind: 'asset',
      thumbnail: 'image',
    },
    asset: {
      id: createWhiteboardId('asset'),
      layerId,
      name: input.name || '导入图片',
      url: input.url,
      source: 'upload',
      x: Math.round((dimensions.width - width) / 2),
      y: Math.round((dimensions.height - height) / 2),
      width,
      height,
    },
  }
}

export function createWhiteboardId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function serializeWhiteboardState(state: WhiteboardState): WhiteboardState {
  return {
    texts: (state.texts ?? []).map((text) => ({ ...text })),
    sceneTransforms: cloneTransforms(state.sceneTransforms),
    ...(validDimensions(state.canvasDimensions) ? { canvasDimensions: { ...state.canvasDimensions } } : {}),
    strokes: state.strokes.map((stroke) => ({
      ...stroke,
      ...(stroke.points ? { points: stroke.points.map((point) => [...point] as typeof point) } : {}),
    })),
    canvasAssets: state.canvasAssets.map(({ file: _file, ...asset }) => ({ ...asset })),
    layers: state.layers.map((layer) => ({ ...layer })),
    activeLayerId: state.activeLayerId,
    activeRatio: state.activeRatio,
  }
}

function cloneTransforms(value: WhiteboardState['sceneTransforms']) {
  const maps = restoreSceneTransforms(value)
  return captureSceneTransforms(maps.offsets, maps.assetTransforms, maps.flips)
}

function validDimensions(value: WhiteboardState['canvasDimensions']): value is NonNullable<WhiteboardState['canvasDimensions']> {
  return Boolean(value && Number.isFinite(value.width) && Number.isFinite(value.height) && value.width > 0 && value.height > 0)
}

/** Read only source URLs for garbage collection, without cloning a potentially large drawing. */
export function readWhiteboardAssetUrls(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const assets = (value as Record<string, unknown>).canvasAssets
  if (!Array.isArray(assets)) return []
  return assets.flatMap(asset => asset && typeof asset === 'object' && typeof asset.url === 'string' ? [asset.url] : [])
}
