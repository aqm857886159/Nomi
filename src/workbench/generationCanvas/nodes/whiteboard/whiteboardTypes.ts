import type { CanvasStroke } from './WhiteboardLeaferCanvas'
import type { AspectRatioKey, CanvasAsset, LayerItem } from './lib/canvas'

export type WhiteboardState = {
  strokes: CanvasStroke[]
  canvasAssets: CanvasAsset[]
  layers: LayerItem[]
  activeLayerId: string
  activeRatio: AspectRatioKey
}

export type WhiteboardInitialImage = {
  url: string
  aspectRatio: AspectRatioKey
}
