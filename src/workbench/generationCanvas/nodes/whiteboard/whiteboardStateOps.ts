import type { CanvasAsset, LayerItem } from './lib/canvas'
import type { CanvasObjectTarget } from './WhiteboardLeaferCanvas'
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
    ...targets.filter((target) => target.kind === 'asset' || target.kind === 'stroke'),
    ...state.canvasAssets
      .filter((asset) => groupLayerIds.has(asset.layerId))
      .map((asset): CanvasObjectTarget => ({ kind: 'asset', id: asset.id })),
    ...state.strokes
      .filter((stroke) => groupLayerIds.has(stroke.layerId) && stroke.tool !== 'eraser')
      .map((stroke): CanvasObjectTarget => ({ kind: 'stroke', id: stroke.id })),
  ].map((target) => [`${target.kind}:${target.id}`, target])).values())
  if (uniqueTargets.length < 2) return state

  const assetIds = new Set(uniqueTargets.filter((target) => target.kind === 'asset').map((target) => target.id))
  const strokeIds = new Set(uniqueTargets.filter((target) => target.kind === 'stroke').map((target) => target.id))
  const sourceLayerIds = new Set<string>()
  for (const asset of state.canvasAssets) if (assetIds.has(asset.id)) sourceLayerIds.add(asset.layerId)
  for (const stroke of state.strokes) if (strokeIds.has(stroke.id)) sourceLayerIds.add(stroke.layerId)
  for (const groupLayerId of groupLayerIds) sourceLayerIds.add(groupLayerId)
  if (sourceLayerIds.size === 0) return state

  const groupLayerId = createWhiteboardId('group-layer')
  const nextAssets = state.canvasAssets.map((asset) => (
    assetIds.has(asset.id) ? { ...asset, layerId: groupLayerId } : asset
  ))
  const nextStrokes = state.strokes.map((stroke) => (
    strokeIds.has(stroke.id) || (stroke.tool === 'eraser' && sourceLayerIds.has(stroke.layerId))
      ? { ...stroke, layerId: groupLayerId }
      : stroke
  ))
  const layerHasElement = (layerId: string) =>
    nextAssets.some((asset) => asset.layerId === layerId) ||
    nextStrokes.some((stroke) => stroke.layerId === layerId && stroke.tool !== 'eraser')
  const nextLayers: LayerItem[] = [
    ...state.layers.filter((layer) =>
      !sourceLayerIds.has(layer.id) ||
      layer.id === 'drawing-layer-1' ||
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
    canvasAssets: nextAssets,
    strokes: nextStrokes,
    layers: nextLayers,
    activeLayerId: groupLayerId,
  }
}

export function deleteTargetFromState(state: WhiteboardState, target: CanvasObjectTarget): WhiteboardState {
  const targetLayerId =
    target.kind === 'group'
      ? target.id
      : target.kind === 'asset'
        ? state.canvasAssets.find((asset) => asset.id === target.id)?.layerId
        : state.strokes.find((stroke) => stroke.id === target.id)?.layerId
  if (!targetLayerId) return state
  const layer = state.layers.find((item) => item.id === targetLayerId)
  if (!layer || layer.kind === 'background' || layer.locked) return state

  const nextAssets = state.canvasAssets.filter((asset) =>
    !(target.kind === 'asset' && asset.id === target.id) &&
    !(target.kind === 'group' && asset.layerId === target.id),
  )
  const nextStrokes = state.strokes.filter((stroke) =>
    !(target.kind === 'stroke' && stroke.id === target.id) &&
    !(target.kind === 'group' && stroke.layerId === target.id),
  )
  const layerStillHasElement =
    nextAssets.some((asset) => asset.layerId === targetLayerId) ||
    nextStrokes.some((stroke) => stroke.layerId === targetLayerId && stroke.tool !== 'eraser')
  const removeLayer = targetLayerId !== 'drawing-layer-1' && !layerStillHasElement
  return {
    ...state,
    canvasAssets: nextAssets,
    strokes: removeLayer ? nextStrokes.filter((stroke) => stroke.layerId !== targetLayerId) : nextStrokes,
    layers: removeLayer ? state.layers.filter((item) => item.id !== targetLayerId) : state.layers,
    activeLayerId: 'drawing-layer-1',
  }
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
