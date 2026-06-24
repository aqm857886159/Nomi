export type AspectRatioKey = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'

export type CanvasDimensions = {
  width: number
  height: number
}

export type ToolKey = 'brush' | 'select' | 'eraser' | 'shape'

export type LayerItem = {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  kind: 'background' | 'drawing' | 'asset' | 'group'
  thumbnail: 'blank' | 'checker' | 'image'
}

export type CanvasAsset = {
  id: string
  layerId: string
  name: string
  url: string
  file?: File
  source?: 'upload' | 'generated'
  x: number
  y: number
  width: number
  height: number
}

export type MaterialItem = {
  id: string
  name: string
  url: string
  file?: File
  source?: 'upload' | 'generated'
  width?: number
  height?: number
}

export const ASPECT_RATIOS: Array<{
  label: AspectRatioKey
  width: number
  height: number
}> = [
  { label: '16:9', width: 16, height: 9 },
  { label: '4:3', width: 4, height: 3 },
  { label: '1:1', width: 1, height: 1 },
  { label: '3:4', width: 3, height: 4 },
  { label: '9:16', width: 9, height: 16 }
]

export const COMMON_COLORS = ['#ffffff', '#111827', '#ef4444', '#2563eb', '#22c55e', '#fb923c']

export function getCanvasDimensions(ratioKey: AspectRatioKey, maxWidth: number): CanvasDimensions {
  const ratio = ASPECT_RATIOS.find((item) => item.label === ratioKey) ?? ASPECT_RATIOS[0]
  const widthToHeight = ratio.width / ratio.height

  if (widthToHeight < 1) {
    const height = Math.round(maxWidth)
    const width = Math.round(height * widthToHeight)

    return { width, height }
  }

  const width = Math.round(maxWidth)
  const height = Math.round(width / widthToHeight)

  return { width, height }
}

export function clampBrushSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 24
  }

  return Math.min(96, Math.max(4, Math.round(value)))
}

export function getDefaultLayers(): LayerItem[] {
  return [
    {
      id: 'background',
      name: '背景',
      visible: true,
      locked: true,
      opacity: 1,
      kind: 'background',
      thumbnail: 'blank'
    },
    {
      id: 'drawing-layer-1',
      name: '图层 1',
      visible: true,
      locked: false,
      opacity: 1,
      kind: 'drawing',
      thumbnail: 'checker'
    }
  ]
}
