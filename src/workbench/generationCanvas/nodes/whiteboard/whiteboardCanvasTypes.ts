import type { PointerPoint } from './lib/stroke'

export type CanvasStroke = {
  id: string
  layerId: string
  color: string
  size: number
  path: string
  tool: 'brush' | 'eraser'
  points?: PointerPoint[]
}

export type LeaferEditorOverlayState = {
  visible?: unknown
}

export type LeaferEditorOverlay = {
  visible?: unknown
}

export type LeaferUiModule = typeof import('leafer-ui')
export type LeaferApp = InstanceType<LeaferUiModule['App']>
export type LeaferBox = InstanceType<LeaferUiModule['Box']>
export type LeaferBoxChild = Parameters<LeaferBox['add']>[0]
export type LeaferGroup = InstanceType<LeaferUiModule['Group']>
export type LeaferPath = InstanceType<LeaferUiModule['Path']>
export type LeaferPathCommandData = ReturnType<LeaferUiModule['PathConvert']['parse']>
export type LeaferPathTools = Pick<LeaferUiModule, 'PathCommandMap' | 'PathConvert' | 'PathNumberCommandLengthMap'>
export type LeaferRenderContext = Pick<
  LeaferUiModule,
  'Box' | 'Group' | 'Image' | 'Path' | 'PathCommandMap' | 'PathConvert' | 'PathNumberCommandLengthMap' | 'Rect'
> & {
  app: LeaferApp
  rootGroup: LeaferGroup
}
export type CanvasObjectKind = 'asset' | 'stroke' | 'group'
export type CanvasObjectOffset = {
  x: number
  y: number
}
export type CanvasAssetTransform = CanvasObjectBounds
export type CanvasObjectFlipState = {
  x: boolean
  y: boolean
}
export type CanvasPoint = {
  x: number
  y: number
}
export type CanvasObjectTarget = {
  kind: CanvasObjectKind
  id: string
}
export type CanvasObjectBounds = {
  x: number
  y: number
  width: number
  height: number
}
export type CanvasNodeInteractionState = {
  editable?: unknown
  draggable?: unknown
  hittable?: unknown
  hitFill?: unknown
}
export type MutableDraftEraserPath = LeaferPath & {
  path?: string
  visible?: boolean
  remove?: () => void
}
export type SnapGuide = {
  axis: 'x' | 'y'
  position: number
}

export const SNAP_DISTANCE = 18
export const MIN_ASSET_SIZE = 24
export const EDITOR_RESIZE_HANDLE_HIT_RADIUS_PX = 16
