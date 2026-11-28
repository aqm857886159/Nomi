import { captureSceneTransforms, restoreSceneTransforms } from './whiteboardCanvasTypes'
import { getCanvasObjectRenderBounds } from './whiteboardCanvasGeometry'
import type { CanvasAsset, LayerItem } from './lib/canvas'
import type { CanvasObjectTarget } from './WhiteboardLeaferCanvas'
import type { CanvasStroke } from './whiteboardCanvasTypes'
import type { WhiteboardState } from './whiteboardTypes'
import { createWhiteboardId } from './whiteboardState'

export const ASSET_DRAG_MIME = 'application/x-nomi-whiteboard-asset'

export type AssetPanelItem = {
  id: string
  layerId: string
  name: string
  visible: boolean
  locked: boolean
  url: string
  width: number
  height: number
  target: CanvasObjectTarget
}

export type LibraryDragPayload =
  | { source: 'board'; assetId: string }
  | { source: 'result'; itemId: string }

export function groupTargetsIntoLayer(state: WhiteboardState, targets: CanvasObjectTarget[]): WhiteboardState {
  const groupLayerIds = new Set(targets.filter((target) => target.kind === 'group').map((target) => target.id))
  const uniqueTargets = Array.from(new Map([
    ...targets.filter((target) => target.kind === 'asset' || target.kind === 'stroke' || target.kind === 'text'),
    ...state.canvasAssets
      .filter((asset) => groupLayerIds.has(asset.layerId))
      .map((asset): CanvasObjectTarget => ({ kind: 'asset', id: asset.id })),
    ...(state.texts ?? []).filter((text) => groupLayerIds.has(text.layerId)).map((text): CanvasObjectTarget => ({ kind: 'text', id: text.id })),
    ...state.strokes
      .filter((stroke) => groupLayerIds.has(stroke.layerId) && stroke.tool !== 'eraser')
      .map((stroke): CanvasObjectTarget => ({ kind: 'stroke', id: stroke.id })),
  ].map((target) => [`${target.kind}:${target.id}`, target])).values())
  if (uniqueTargets.length < 2) return state

  const assetIds = new Set(uniqueTargets.filter((target) => target.kind === 'asset').map((target) => target.id))
  const strokeIds = new Set(uniqueTargets.filter((target) => target.kind === 'stroke').map((target) => target.id))
  const textIds = new Set(uniqueTargets.filter((target) => target.kind === 'text').map((target) => target.id))
  const sourceLayerIds = new Set<string>()
  for (const text of state.texts ?? []) if (textIds.has(text.id)) sourceLayerIds.add(text.layerId)
  for (const asset of state.canvasAssets) if (assetIds.has(asset.id)) sourceLayerIds.add(asset.layerId)
  for (const stroke of state.strokes) if (strokeIds.has(stroke.id)) sourceLayerIds.add(stroke.layerId)
  for (const groupLayerId of groupLayerIds) sourceLayerIds.add(groupLayerId)
  if (sourceLayerIds.size === 0) return state

  // Flatten existing group placement before assigning children to the new group.
  // A group offset/flip belongs to its container; keeping it under a removed id loses edits on reopen.
  const maps = restoreSceneTransforms(state.sceneTransforms)
  for (const groupId of groupLayerIds) {
    const groupBounds = getCanvasObjectRenderBounds({ kind: 'group', id: groupId }, state.layers, state.canvasAssets, state.strokes, maps.offsets, maps.assetTransforms, state.texts)
    if (!groupBounds) continue
    const groupOffset = maps.offsets.get(`group:${groupId}`) ?? { x: 0, y: 0 }
    const groupFlip = maps.flips.get(`group:${groupId}`) ?? { x: false, y: false }
    for (const target of uniqueTargets) {
      const item = target.kind === 'asset' ? state.canvasAssets.find((entry) => entry.id === target.id)
        : target.kind === 'text' ? state.texts?.find((entry) => entry.id === target.id)
        : state.strokes.find((entry) => entry.id === target.id)
      if (item?.layerId !== groupId) continue
      const bounds = getCanvasObjectRenderBounds(target, state.layers, state.canvasAssets, state.strokes, maps.offsets, maps.assetTransforms, state.texts)
      if (!bounds) continue
      const origin = { x: groupBounds.x - groupOffset.x, y: groupBounds.y - groupOffset.y }
      const nextX = groupBounds.x + (groupFlip.x ? groupBounds.width - (bounds.x - origin.x) - bounds.width : bounds.x - origin.x)
      const nextY = groupBounds.y + (groupFlip.y ? groupBounds.height - (bounds.y - origin.y) - bounds.height : bounds.y - origin.y)
      const key = `${target.kind}:${target.id}`
      const offset = maps.offsets.get(key) ?? { x: 0, y: 0 }
      maps.offsets.set(key, { x: offset.x + nextX - bounds.x, y: offset.y + nextY - bounds.y })
      if (target.kind === 'asset') maps.assetTransforms.set(target.id, { ...bounds, x: nextX, y: nextY })
      const flip = maps.flips.get(key) ?? { x: false, y: false }
      maps.flips.set(key, { x: flip.x !== groupFlip.x, y: flip.y !== groupFlip.y })
    }
    maps.offsets.delete(`group:${groupId}`)
    maps.flips.delete(`group:${groupId}`)
  }
  const groupLayerId = createWhiteboardId('group-layer')
  const nextAssets = state.canvasAssets.map((asset) => (
    assetIds.has(asset.id) ? { ...asset, layerId: groupLayerId } : asset
  ))
  const nextStrokes = state.strokes.map((stroke) => (
    strokeIds.has(stroke.id) || (stroke.tool === 'eraser' && sourceLayerIds.has(stroke.layerId))
      ? { ...stroke, layerId: groupLayerId }
      : stroke
  ))
  const nextTexts = (state.texts ?? []).map((text) => textIds.has(text.id) ? { ...text, layerId: groupLayerId } : text)
  const layerHasElement = (layerId: string) =>
    nextTexts.some((text) => text.layerId === layerId) ||
    nextAssets.some((asset) => asset.layerId === layerId) ||
    nextStrokes.some((stroke) => stroke.layerId === layerId && stroke.tool !== 'eraser')
  const nextLayers: LayerItem[] = [
    ...state.layers.filter((layer) =>
      !sourceLayerIds.has(layer.id) ||
      layer.id === LEGACY_DRAWING_LAYER_ID ||
      layerHasElement(layer.id),
    ),
    {
      id: groupLayerId,
      name: `组合 ${state.layers.filter((layer) => layer.id.startsWith('group-layer')).length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      kind: 'group',
      thumbnail: 'checker',
    },
  ]

  return {
    ...state,
    texts: nextTexts,
    sceneTransforms: captureSceneTransforms(maps.offsets, maps.assetTransforms, maps.flips),
    canvasAssets: nextAssets,
    strokes: nextStrokes,
    layers: nextLayers,
    activeLayerId: groupLayerId,
  }
}

/** 删除可行性判定（单一真相源：deleteTargetFromState 与 UI 提示共用，静默 no-op 根治为明确反馈）。 */
export type DeleteTargetVerdict = 'ok' | 'missing' | 'background' | 'locked'

export function assessDeleteTarget(state: WhiteboardState, target: CanvasObjectTarget): DeleteTargetVerdict {
  const targetLayerId =
    target.kind === 'group'
      ? target.id
      : target.kind === 'asset'
        ? state.canvasAssets.find((asset) => asset.id === target.id)?.layerId
        : target.kind === 'text' ? state.texts?.find((text) => text.id === target.id)?.layerId : state.strokes.find((stroke) => stroke.id === target.id)?.layerId
  if (!targetLayerId) return 'missing'
  const layer = state.layers.find((item) => item.id === targetLayerId)
  if (!layer) return 'missing'
  if (layer.kind === 'background') return 'background'
  if (layer.locked) return 'locked'
  return 'ok'
}

export function deleteTargetFromState(state: WhiteboardState, target: CanvasObjectTarget): WhiteboardState {
  if (assessDeleteTarget(state, target) !== 'ok') return state
  const targetLayerId =
    target.kind === 'group'
      ? target.id
      : target.kind === 'asset'
        ? state.canvasAssets.find((asset) => asset.id === target.id)?.layerId
        : target.kind === 'text' ? state.texts?.find((text) => text.id === target.id)?.layerId : state.strokes.find((stroke) => stroke.id === target.id)?.layerId
  if (!targetLayerId) return state

  const nextAssets = state.canvasAssets.filter((asset) =>
    !(target.kind === 'asset' && asset.id === target.id) &&
    !(target.kind === 'group' && asset.layerId === target.id),
  )
  const nextStrokes = state.strokes.filter((stroke) =>
    !(target.kind === 'stroke' && stroke.id === target.id) &&
    !(target.kind === 'group' && stroke.layerId === target.id),
  )
  const nextTexts = (state.texts ?? []).filter((text) => !(target.kind === 'text' && text.id === target.id) && !(target.kind === 'group' && text.layerId === target.id))
  const layerStillHasElement =
    nextTexts.some((text) => text.layerId === targetLayerId) ||
    nextAssets.some((asset) => asset.layerId === targetLayerId) ||
    nextStrokes.some((stroke) => stroke.layerId === targetLayerId && stroke.tool !== 'eraser')
  const removeLayer = targetLayerId !== LEGACY_DRAWING_LAYER_ID && !layerStillHasElement
  const layers = removeLayer ? state.layers.filter((item) => item.id !== targetLayerId) : state.layers
  return {
    ...state,
    texts: nextTexts,
    canvasAssets: nextAssets,
    strokes: removeLayer ? nextStrokes.filter((stroke) => stroke.layerId !== targetLayerId) : nextStrokes,
    layers,
    activeLayerId: fallbackActiveLayerId(layers),
  }
}

/** 老项目新建画板时预建的那一层（今天的新画板也还有；图层分离的画板没有）。有它就照旧回它。 */
export const LEGACY_DRAWING_LAYER_ID = 'drawing-layer-1'

/**
 * 删掉东西之后当前层落到哪（当前层的唯一回退口径）：老项目还有「图层 1」就回它（与今天一样）；
 * 没有就落到最上面一层没锁的；全锁了（只剩背景）给空串——画笔每一笔自己建层，不靠当前层。
 */
export function fallbackActiveLayerId(layers: readonly LayerItem[]): string {
  if (layers.some((layer) => layer.id === LEGACY_DRAWING_LAYER_ID)) return LEGACY_DRAWING_LAYER_ID
  return [...layers].reverse().find((layer) => !layer.locked && layer.kind !== 'background')?.id ?? ''
}

/**
 * 这一笔能不能落下：画笔每一笔自己新建一层（commitBrushStroke），不看当前层在不在、锁没锁；
 * 橡皮擦落在当前层上，当前层得在、且没锁。
 */
export function canDrawOnLayer(tool: string, activeLayer: LayerItem | undefined): boolean {
  if (tool === 'brush') return true
  if (tool === 'eraser') return Boolean(activeLayer && !activeLayer.locked)
  return false
}

/** 画笔一笔落成新的一层（叠在最上面、成为当前层）；橡皮擦留在它擦的那一层。 */
export function commitStrokeToState(
  state: WhiteboardState,
  stroke: CanvasStroke,
  brushLayerName: (index: number) => string,
  createId: (prefix: string) => string = createWhiteboardId,
): WhiteboardState {
  if (stroke.tool !== 'brush') return { ...state, strokes: [...state.strokes, stroke] }
  const layerId = createId('stroke-layer')
  const strokeIndex = state.layers.filter((layer) => layer.id.startsWith('stroke-layer')).length + 1
  return {
    ...state,
    activeLayerId: layerId,
    strokes: [...state.strokes, { ...stroke, layerId }],
    layers: [
      ...state.layers,
      { id: layerId, name: brushLayerName(strokeIndex), visible: true, locked: false, opacity: 1, kind: 'drawing', thumbnail: 'checker' },
    ],
  }
}

/**
 * 「结果」页签的素材源合并（IA 归位，2026-07-29 拍板 A）：已连线的上游结果在前，
 * 画布全量成图去重补后（同一节点连了线就不再以「来自画布」重复出现）。
 */
export function mergeResultLibraryItems<T extends { nodeId: string }>(
  connected: T[],
  canvas: T[],
): Array<T & { fromCanvas?: boolean }> {
  const connectedNodeIds = new Set(connected.map((item) => item.nodeId))
  return [
    ...connected,
    ...canvas.filter((item) => !connectedNodeIds.has(item.nodeId)).map((item) => ({ ...item, fromCanvas: true })),
  ]
}

export function getAssetPanelItems(layers: LayerItem[], assets: CanvasAsset[]): AssetPanelItem[] {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]))
  return assets.map((asset): AssetPanelItem => {
    const layer = layerMap.get(asset.layerId)
    return {
      id: `asset:${asset.id}`,
      layerId: asset.layerId,
      name: layer?.name ?? stripFileExtension(asset.name),
      visible: layer?.visible ?? true,
      locked: layer?.locked ?? false,
      url: asset.url,
      width: Math.round(asset.width),
      height: Math.round(asset.height),
      target: { kind: 'asset', id: asset.id },
    }
  })
}

export function stripFileExtension(value: string): string {
  return value.replace(/\.[^.]+$/, '') || value
}

export function isWhiteboardAssetDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ASSET_DRAG_MIME)
}

export function parseLibraryDragPayload(dataTransfer: DataTransfer): LibraryDragPayload | null {
  const value = dataTransfer.getData(ASSET_DRAG_MIME)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<LibraryDragPayload>
    if (parsed.source === 'board' && typeof parsed.assetId === 'string' && parsed.assetId) {
      return { source: 'board', assetId: parsed.assetId }
    }
    if (parsed.source === 'result' && typeof parsed.itemId === 'string' && parsed.itemId) {
      return { source: 'result', itemId: parsed.itemId }
    }
  } catch {
    return { source: 'board', assetId: value }
  }
  return null
}

export function clampCanvasPosition(value: number, itemSize: number, canvasSize: number): number {
  return Math.min(Math.max(0, canvasSize - itemSize), Math.max(0, value))
}
