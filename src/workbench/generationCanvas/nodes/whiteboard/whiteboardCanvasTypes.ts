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
/** What the scene renderer draws with: the Leafer classes and the group it fills. It never needs the App. */
export type LeaferSceneContext = Pick<
  LeaferUiModule,
  'Box' | 'Group' | 'Image' | 'Path' | 'PathCommandMap' | 'PathConvert' | 'PathNumberCommandLengthMap' | 'Rect' | 'Text'
> & {
  rootGroup: LeaferGroup
}
export type LeaferRenderContext = LeaferSceneContext & {
  app: LeaferApp
}
export type CanvasObjectKind = 'asset' | 'stroke' | 'group' | 'text'
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

/** Serializable document transforms; imperative Leafer maps never own persisted state. */
export type SceneTransforms = {
  offsets: Record<string, CanvasObjectOffset>
  assetTransforms: Record<string, CanvasAssetTransform>
  flips: Record<string, CanvasObjectFlipState>
}

export function captureSceneTransforms(
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>,
  flips: Map<string, CanvasObjectFlipState>,
): SceneTransforms {
  return {
    offsets: Object.fromEntries([...offsets].map(([key, value]) => [key, { ...value }])),
    assetTransforms: Object.fromEntries([...assetTransforms].map(([key, value]) => [key, { ...value }])),
    flips: Object.fromEntries([...flips].map(([key, value]) => [key, { ...value }])),
  }
}

export function restoreSceneTransforms(value?: SceneTransforms): {
  offsets: Map<string, CanvasObjectOffset>
  assetTransforms: Map<string, CanvasAssetTransform>
  flips: Map<string, CanvasObjectFlipState>
} {
  const clone = <T extends object>(record?: Record<string, T>) =>
    new Map(Object.entries(record ?? {}).map(([key, entry]) => [key, { ...entry }]))
  return { offsets: clone(value?.offsets), assetTransforms: clone(value?.assetTransforms), flips: clone(value?.flips) }
}
