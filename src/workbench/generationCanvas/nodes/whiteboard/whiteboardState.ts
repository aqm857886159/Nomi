import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { WhiteboardState } from './whiteboardTypes'
import { ASPECT_RATIOS, getCanvasDimensions, getDefaultLayers, type AspectRatioKey, type CanvasAsset } from './lib/canvas'

export function createDefaultWhiteboardState(ratio: AspectRatioKey = '16:9'): WhiteboardState {
  return {
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
    strokes: record.strokes,
    canvasAssets: record.canvasAssets,
    layers: record.layers,
    activeLayerId: typeof record.activeLayerId === 'string' && record.activeLayerId ? record.activeLayerId : 'drawing-layer-1',
    activeRatio: isAspectRatioKey(record.activeRatio) ? record.activeRatio : '16:9',
  }
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
  imageSize?: { width: number; height: number } | null
}): { asset: CanvasAsset; layer: ReturnType<typeof getDefaultLayers>[number] } {
  const dimensions = getCanvasDimensions(input.ratio, 1280)
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
