// 一次图层分离的结果 → 一张白板（设计卡 docs/plan/2026-11-26-layer-split.md ★9 第 3 条）。纯函数，不读盘、不联网。
//
// 摆法照供应商说明（docs.apimart.ai seedream-5-5/generation，2026-11-26 取）：底图铺满；每层「resize each layer to the box's
// w × h and place it at (x, y)」，框是底图像素坐标；叠放按 zIndex 从下到上。说明没写死每层回来的是「裁到框的小图」还是
// 「和底图一样大的整幅透明图」：一层的图和底图一样大就当整幅铺满（缩进框会把整幅压扁），否则缩进框——两种都落对位置，
// 真形状等付费核对定案（设计卡 ★6）。画布按底图原比例、长边 1280（与新建白板同一个长边），
// 不贴最近的标准比例——贴了会留白、各层对不齐。图层面板只有「背景」+「底图」+ 各层：不预建空的「图层 1」（C-E3，第一次落笔时才建）。
import type { TaskResultLayer } from '../../../../../electron/shared/modelArchetypes/layerSplit'
import { getDefaultLayers, type CanvasAsset, type CanvasDimensions, type LayerItem } from './lib/canvas'
import { WHITEBOARD_EXPORT_PIXEL_BUDGET } from './whiteboardCanvasExport'
import { createWhiteboardId, inferWhiteboardAspectRatio } from './whiteboardState'
import type { WhiteboardState } from './whiteboardTypes'

/** 白板画布的长边（与 createDefaultWhiteboardState 的 1280 同一个数）。 */
export const LAYER_SPLIT_BOARD_LONG_EDGE = 1280

export type LayerSplitPiece = {
  url: string
  layer: TaskResultLayer
  /** 这一层图自己的像素（读得到才给）：和底图一样大 = 整幅透明图，铺满；不给 / 不一样大 = 按框摆。 */
  size?: { width: number; height: number } | null
}

/** 这一层的图是不是和底图一样大的整幅图（整幅透明图不缩进框，铺满）。 */
export function isFullCanvasPiece(size: LayerSplitPiece['size'], baseSize: { width: number; height: number }): boolean {
  return Boolean(size && size.width === baseSize.width && size.height === baseSize.height)
}

export type LayerSplitBoardInput = {
  /** 与 layers 按下标平行的每张图（已落进项目的地址）。 */
  pieces: readonly LayerSplitPiece[]
  /** 底图的真实像素（框的坐标系）。 */
  baseSize: { width: number; height: number }
  /** 底图那一行叫什么（「底图」/「Base image」，按创建时的语言存，与「原图」同一个做法）。 */
  baseName: string
  /** 没名字也没识别出字的层叫什么（n 从 1 起，按叠放序）。 */
  fallbackName: (n: number) => string
  createId?: (prefix: string) => string
}

/** 哪一张是底图：第一张没有框的（APIMart 是下标 0、z_index 0）；都有框就取第一张。 */
export function layerSplitBaseIndex(layers: readonly TaskResultLayer[]): number {
  const index = layers.findIndex((layer) => !layer.box)
  return index >= 0 ? index : 0
}

/** 画布尺寸：按底图原比例，长边 LAYER_SPLIT_BOARD_LONG_EDGE。 */
export function layerSplitBoardDimensions(baseSize: { width: number; height: number }): CanvasDimensions {
  const scale = LAYER_SPLIT_BOARD_LONG_EDGE / Math.max(baseSize.width, baseSize.height)
  return { width: Math.max(1, Math.round(baseSize.width * scale)), height: Math.max(1, Math.round(baseSize.height * scale)) }
}

/**
 * 落成节点结果那张合成图的像素比：保住底图原本的清晰度（2K 拆出来的不缩成 1280），再受导出总像素预算约束；
 * 底图比画布还小就按 1。完成那一步自己的导出比不受这里影响。
 */
export function layerSplitCompositePixelRatio(dimensions: CanvasDimensions, baseSize: { width: number; height: number }): number {
  const native = Math.max(baseSize.width, baseSize.height) / Math.max(dimensions.width, dimensions.height)
  const budget = Math.sqrt(WHITEBOARD_EXPORT_PIXEL_BUDGET / Math.max(1, dimensions.width * dimensions.height))
  return Math.max(1, Math.min(native, budget))
}

function layerName(layer: TaskResultLayer, n: number, fallbackName: (n: number) => string): string {
  return layer.name?.trim() || layer.text?.trim() || fallbackName(n)
}

export function buildLayerSplitBoard(input: LayerSplitBoardInput): WhiteboardState {
  const createId = input.createId ?? createWhiteboardId
  const dimensions = layerSplitBoardDimensions(input.baseSize)
  const scale = dimensions.width / input.baseSize.width
  const baseIndex = layerSplitBaseIndex(input.pieces.map((piece) => piece.layer))
  const base = input.pieces[baseIndex]!
  const upper = input.pieces
    .map((piece, index) => ({ piece, index }))
    .filter(({ index }) => index !== baseIndex)
    // 叠放序从下到上；同序按原下标，结果稳定。
    .sort((a, b) => a.piece.layer.zIndex - b.piece.layer.zIndex || a.index - b.index)
  const layers: LayerItem[] = [getDefaultLayers()[0]!]
  const assets: CanvasAsset[] = []
  const place = (piece: LayerSplitPiece, name: string, framed: boolean) => {
    const layerId = createId('asset-layer')
    const box = framed && !isFullCanvasPiece(piece.size, input.baseSize) ? piece.layer.box : undefined
    layers.push({ id: layerId, name, visible: true, locked: false, opacity: 1, kind: 'asset', thumbnail: 'image' })
    assets.push({
      id: createId('asset'),
      layerId,
      name,
      url: piece.url,
      source: 'generated',
      ...(box
        ? {
            x: Math.round(box.left * scale),
            y: Math.round(box.top * scale),
            width: Math.max(1, Math.round((box.right - box.left) * scale)),
            height: Math.max(1, Math.round((box.bottom - box.top) * scale)),
          }
        // 没有框的层（底图、整幅透明图）铺满底图。
        : { x: 0, y: 0, width: dimensions.width, height: dimensions.height }),
    })
  }
  place(base, input.baseName, false)
  upper.forEach(({ piece }, order) => place(piece, layerName(piece.layer, order + 1, input.fallbackName), true))
  return {
    texts: [],
    sceneTransforms: { offsets: {}, assetTransforms: {}, flips: {} },
    canvasDimensions: dimensions,
    strokes: [],
    canvasAssets: assets,
    layers,
    activeLayerId: layers[layers.length - 1]!.id,
    activeRatio: inferWhiteboardAspectRatio(input.baseSize.width, input.baseSize.height),
  }
}
