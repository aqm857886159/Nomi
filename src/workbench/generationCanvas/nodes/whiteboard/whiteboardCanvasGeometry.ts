import type { CanvasAsset, CanvasDimensions, LayerItem } from './lib/canvas'
import type {
  CanvasAssetTransform,
  CanvasObjectBounds,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  SnapGuide,
} from './whiteboardCanvasTypes'
import { EDITOR_RESIZE_HANDLE_HIT_RADIUS_PX, MIN_ASSET_SIZE, SNAP_DISTANCE } from './whiteboardCanvasTypes'
import {
  getCanvasObjectTarget,
  getFiniteNumber,
  getObjectOffset,
  getSvgPathBounds,
  isPointInsideBounds,
  shouldBlockErasedSelection,
} from './whiteboardCanvasNodeOps'

export function groupItemsByLayer<TItem extends { layerId: string }>(items: TItem[]): Map<string, TItem[]> {
  const groupedItems = new Map<string, TItem[]>()

  for (const item of items) {
    const layerItems = groupedItems.get(item.layerId)
    if (layerItems) {
      layerItems.push(item)
    } else {
      groupedItems.set(item.layerId, [item])
    }
  }

  return groupedItems
}

export function getKeyboardMoveDelta(key: string, step: number): CanvasPoint | null {
  switch (key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
    default:
      return null
  }
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function isCanvasContextMenuEvent(event?: PointerEvent): boolean {
  if (!event) {
    return false
  }

  for (const target of event.composedPath()) {
    if (target instanceof HTMLElement && target.dataset.canvasContextMenu === 'true') {
      return true
    }
  }

  return false
}

export function getLayerIdForCanvasObject(
  target: CanvasObjectTarget,
  assets: CanvasAsset[],
  strokes: CanvasStroke[]
): string | null {
  if (target.kind === 'asset') {
    return assets.find((asset) => asset.id === target.id)?.layerId ?? null
  }

  if (target.kind === 'group') {
    return target.id
  }

  return strokes.find((stroke) => stroke.id === target.id)?.layerId ?? null
}

export function getAssetRenderBounds(
  asset: CanvasAsset,
  offsets: Map<string, CanvasObjectOffset>,
  transforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds {
  const transformedBounds = transforms.get(asset.id)

  if (transformedBounds) {
    return normalizeAssetBounds(transformedBounds)
  }

  const offset = getObjectOffset(offsets, 'asset', asset.id)

  return normalizeAssetBounds({
    x: asset.x + offset.x,
    y: asset.y + offset.y,
    width: asset.width,
    height: asset.height
  })
}

export function normalizeAssetBounds(bounds: CanvasObjectBounds): CanvasObjectBounds {
  return {
    x: getFiniteNumber(bounds.x, 0),
    y: getFiniteNumber(bounds.y, 0),
    width: Math.max(MIN_ASSET_SIZE, getFiniteNumber(bounds.width, MIN_ASSET_SIZE)),
    height: Math.max(MIN_ASSET_SIZE, getFiniteNumber(bounds.height, MIN_ASSET_SIZE))
  }
}

export function getSnappedCanvasMove({
  target,
  x,
  y,
  dimensions,
  layers,
  assets,
  strokes,
  offsets,
  assetTransforms,
  onSnapGuides
}: {
  target?: unknown
  x: number
  y: number
  dimensions: CanvasDimensions
  layers: LayerItem[]
  assets: CanvasAsset[]
  strokes: CanvasStroke[]
  offsets: Map<string, CanvasObjectOffset>
  assetTransforms: Map<string, CanvasAssetTransform>
  onSnapGuides?: (guides: SnapGuide[]) => void
}): CanvasPoint | true {
  const objectTarget = getCanvasObjectTarget(target)

  if (!objectTarget || (objectTarget.kind !== 'asset' && objectTarget.kind !== 'group') || !Number.isFinite(x) || !Number.isFinite(y)) {
    onSnapGuides?.([])
    return true
  }

  const bounds = getCanvasObjectRenderBounds(objectTarget, layers, assets, strokes, offsets, assetTransforms)
  if (!bounds) {
    onSnapGuides?.([])
    return true
  }

  const guides = getSnapGuides(objectTarget, dimensions, layers, assets, strokes, offsets, assetTransforms)
  const snapX = getNearestSnapDelta(getBoundsVerticalLines({ ...bounds, x: bounds.x + x }), guides.vertical)
  const snapY = getNearestSnapDelta(getBoundsHorizontalLines({ ...bounds, y: bounds.y + y }), guides.horizontal)
  const activeGuides: SnapGuide[] = []

  if (snapX.matched) {
    activeGuides.push({ axis: 'x', position: snapX.guide })
  }

  if (snapY.matched) {
    activeGuides.push({ axis: 'y', position: snapY.guide })
  }

  onSnapGuides?.(activeGuides)

  return {
    x: x + snapX.delta,
    y: y + snapY.delta
  }
}

export function getMinimumAssetScale(
  target: unknown,
  scaleX = 1,
  scaleY = scaleX,
  transforms: Map<string, CanvasAssetTransform>,
  assets: CanvasAsset[]
): { scaleX: number; scaleY: number } | true {
  const objectTarget = getCanvasObjectTarget(target)

  if (objectTarget?.kind !== 'asset') {
    return true
  }

  const asset = assets.find((item) => item.id === objectTarget.id)
  if (!asset) {
    return true
  }

  const bounds = transforms.get(asset.id) ?? { x: asset.x, y: asset.y, width: asset.width, height: asset.height }
  const nextWidth = bounds.width * Math.abs(scaleX)
  const nextHeight = bounds.height * Math.abs(scaleY)

  if (nextWidth >= MIN_ASSET_SIZE && nextHeight >= MIN_ASSET_SIZE) {
    return true
  }

  const scale = Math.max(MIN_ASSET_SIZE / bounds.width, MIN_ASSET_SIZE / bounds.height)

  return {
    scaleX: scaleX < 0 ? -scale : scale,
    scaleY: scaleY < 0 ? -scale : scale
  }
}

export function getCanvasObjectRenderBounds(
  target: CanvasObjectTarget,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  if (target.kind === 'asset') {
    const asset = assets.find((item) => item.id === target.id)
    return asset ? getAssetRenderBounds(asset, offsets, assetTransforms) : null
  }

  if (target.kind === 'stroke') {
    const stroke = strokes.find((item) => item.id === target.id && item.tool !== 'eraser')
    const bounds = stroke ? getSvgPathBounds(stroke.path) : null
    if (!stroke || !bounds) {
      return null
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    return {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    }
  }

  const layer = layers.find((item) => item.id === target.id)
  if (!layer) {
    return null
  }

  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)
  const baseBounds = getLayerBaseBounds(target.id, assetsByLayer, strokesByLayer, offsets, assetTransforms)
  if (!baseBounds) {
    return null
  }

  const groupOffset = getObjectOffset(offsets, 'group', target.id)
  return {
    ...baseBounds,
    x: baseBounds.x + groupOffset.x,
    y: baseBounds.y + groupOffset.y
  }
}

export function getLayerBaseBounds(
  layerId: string,
  assetsByLayer: Map<string, CanvasAsset[]>,
  strokesByLayer: Map<string, CanvasStroke[]>,
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  const childBounds: CanvasObjectBounds[] = []

  for (const asset of assetsByLayer.get(layerId) ?? []) {
    childBounds.push(getAssetRenderBounds(asset, offsets, assetTransforms))
  }

  for (const stroke of strokesByLayer.get(layerId) ?? []) {
    if (stroke.tool === 'eraser') {
      continue
    }

    const bounds = getSvgPathBounds(stroke.path)
    if (!bounds) {
      continue
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    childBounds.push({
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    })
  }

  return getUnionBounds(childBounds)
}

export function getCanvasTargetsUnionBounds(
  targets: CanvasObjectTarget[],
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectBounds | null {
  return getUnionBounds(
    targets
      .map((target) => getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms))
      .filter((bounds): bounds is CanvasObjectBounds => Boolean(bounds))
  )
}

export function getCanvasHitRadiusFromStageBounds(dimensions: CanvasDimensions, stageBounds: DOMRect): number {
  const scaleX = stageBounds.width > 0 ? stageBounds.width / dimensions.width : 1
  const scaleY = stageBounds.height > 0 ? stageBounds.height / dimensions.height : 1
  const canvasScale = Math.min(scaleX || 1, scaleY || 1)

  return EDITOR_RESIZE_HANDLE_HIT_RADIUS_PX / canvasScale
}

export function isPointNearSingleAssetResizeHandle(
  point: CanvasPoint,
  selectedTargets: CanvasObjectTarget[],
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>,
  hitRadius: number
): boolean {
  const selectedTarget = selectedTargets[0]
  if (selectedTargets.length !== 1 || selectedTarget?.kind !== 'asset') {
    return false
  }

  const bounds = getCanvasTargetsUnionBounds([selectedTarget], layers, assets, strokes, offsets, assetTransforms)
  if (!bounds) {
    return false
  }

  const handlePoints = getResizeHandlePoints(bounds)
  const hitRadiusSquared = hitRadius * hitRadius

  return handlePoints.some((handlePoint) => getCanvasPointDistanceSquared(point, handlePoint) <= hitRadiusSquared)
}

export function getResizeHandlePoints(bounds: CanvasObjectBounds): CanvasPoint[] {
  const left = bounds.x
  const centerX = bounds.x + bounds.width / 2
  const right = bounds.x + bounds.width
  const top = bounds.y
  const centerY = bounds.y + bounds.height / 2
  const bottom = bounds.y + bounds.height

  return [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: right, y: centerY },
    { x: right, y: bottom },
    { x: centerX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: centerY }
  ]
}

export function getCanvasPointDistanceSquared(first: CanvasPoint, second: CanvasPoint): number {
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y

  return deltaX * deltaX + deltaY * deltaY
}

export function getSelectableCanvasObjectsInBounds(
  bounds: CanvasObjectBounds,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): CanvasObjectTarget[] {
  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)
  const selectedTargets: CanvasObjectTarget[] = []

  for (const layer of layers) {
    if (layer.kind === 'background' || !layer.visible || layer.locked) {
      continue
    }

    const layerAssets = assetsByLayer.get(layer.id) ?? []
    const layerStrokes = strokesByLayer.get(layer.id) ?? []

    if (isCanvasGroupLayer(layer)) {
      const target = { kind: 'group', id: layer.id } as CanvasObjectTarget
      const groupBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (groupBounds && doBoundsIntersect(bounds, groupBounds)) {
        selectedTargets.push(target)
      }
      continue
    }

    for (const asset of layerAssets) {
      const target = { kind: 'asset', id: asset.id } as CanvasObjectTarget
      const targetBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (targetBounds && doBoundsIntersect(bounds, targetBounds)) {
        selectedTargets.push(target)
      }
    }

    for (const stroke of layerStrokes) {
      if (stroke.tool === 'eraser') {
        continue
      }

      const target = { kind: 'stroke', id: stroke.id } as CanvasObjectTarget
      const targetBounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)
      if (targetBounds && doBoundsIntersect(bounds, targetBounds)) {
        selectedTargets.push(target)
      }
    }
  }

  return selectedTargets
}

export function getSnapGuides(
  target: CanvasObjectTarget,
  dimensions: CanvasDimensions,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): { vertical: number[]; horizontal: number[] } {
  const vertical = [0, dimensions.width / 2, dimensions.width]
  const horizontal = [0, dimensions.height / 2, dimensions.height]
  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id))

  for (const asset of assets) {
    if (target.kind === 'asset' && target.id === asset.id) {
      continue
    }

    if (target.kind === 'group' && asset.layerId === target.id) {
      continue
    }

    if (!visibleLayerIds.has(asset.layerId)) {
      continue
    }

    const bounds = getAssetRenderBounds(asset, offsets, assetTransforms)
    vertical.push(...getBoundsVerticalLines(bounds))
    horizontal.push(...getBoundsHorizontalLines(bounds))
  }

  for (const stroke of strokes) {
    if (stroke.tool === 'eraser' || !visibleLayerIds.has(stroke.layerId)) {
      continue
    }

    if (target.kind === 'group' && stroke.layerId === target.id) {
      continue
    }

    const bounds = getSvgPathBounds(stroke.path)
    if (!bounds) {
      continue
    }

    const offset = getObjectOffset(offsets, 'stroke', stroke.id)
    const transformedBounds = {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    }

    vertical.push(...getBoundsVerticalLines(transformedBounds))
    horizontal.push(...getBoundsHorizontalLines(transformedBounds))
  }

  return { vertical, horizontal }
}

export function getTopmostEditableCanvasObjectAtPoint(
  point: CanvasPoint,
  layers: LayerItem[],
  assets: CanvasAsset[],
  strokes: CanvasStroke[],
  offsets: Map<string, CanvasObjectOffset>,
  assetTransforms: Map<string, CanvasAssetTransform>
): { target: CanvasObjectTarget; layerId: string } | null {
  const assetsByLayer = groupItemsByLayer(assets)
  const strokesByLayer = groupItemsByLayer(strokes)

  for (const layer of [...layers].reverse()) {
    if (layer.kind === 'background' || !layer.visible || layer.locked) {
      continue
    }

    const layerStrokes = strokesByLayer.get(layer.id) ?? []
    const layerAssets = assetsByLayer.get(layer.id) ?? []

    if (isCanvasGroupLayer(layer)) {
      const target: CanvasObjectTarget = { kind: 'group', id: layer.id }
      const bounds = getCanvasObjectRenderBounds(target, layers, assets, strokes, offsets, assetTransforms)

      if (bounds && isPointInsideBounds(point, bounds)) {
        return { target, layerId: layer.id }
      }

      continue
    }

    for (const stroke of [...layerStrokes].reverse()) {
      if (stroke.tool === 'eraser') {
        continue
      }

      const bounds = getSvgPathBounds(stroke.path)
      if (!bounds) {
        continue
      }

      const offset = getObjectOffset(offsets, 'stroke', stroke.id)
      const target: CanvasObjectTarget = { kind: 'stroke', id: stroke.id }
      const transformedBounds = {
        ...bounds,
        x: bounds.x + offset.x,
        y: bounds.y + offset.y
      }
      const isErasedAtPoint = shouldBlockErasedSelection(
        { canvasObjectKind: 'stroke', canvasObjectId: stroke.id },
        point,
        strokes,
        assets,
        offsets
      )

      if (isPointInsideBounds(point, transformedBounds) && !isErasedAtPoint) {
        return { target, layerId: layer.id }
      }
    }

    for (const asset of [...layerAssets].reverse()) {
      const bounds = getAssetRenderBounds(asset, offsets, assetTransforms)
      const target: CanvasObjectTarget = { kind: 'asset', id: asset.id }
      const isErasedAtPoint = shouldBlockErasedSelection(
        { canvasObjectKind: 'asset', canvasObjectId: asset.id },
        point,
        strokes,
        assets,
        offsets
      )

      if (isPointInsideBounds(point, bounds) && !isErasedAtPoint) {
        return { target, layerId: layer.id }
      }
    }
  }

  return null
}

export function getBoundsVerticalLines(bounds: CanvasObjectBounds): number[] {
  return [bounds.x, bounds.x + bounds.width / 2, bounds.x + bounds.width]
}

export function getUnionBounds(boundsList: CanvasObjectBounds[]): CanvasObjectBounds | null {
  if (boundsList.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  }
}

export function normalizeCanvasBounds(start: CanvasPoint, current: CanvasPoint): CanvasObjectBounds {
  const x = Math.min(start.x, current.x)
  const y = Math.min(start.y, current.y)

  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  }
}

export function getSvgRectAttributes(bounds: CanvasObjectBounds): Pick<CanvasObjectBounds, 'x' | 'y' | 'width' | 'height'> {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height)
  }
}

export function isCanvasGroupLayer(layer: LayerItem): boolean {
  return layer.kind === 'group'
}

export function doBoundsIntersect(first: CanvasObjectBounds, second: CanvasObjectBounds): boolean {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  )
}

export function areCanvasTargetsEqual(first: CanvasObjectTarget, second: CanvasObjectTarget): boolean {
  return first.kind === second.kind && first.id === second.id
}

export function areCanvasTargetArraysEqual(first: CanvasObjectTarget[], second: CanvasObjectTarget[]): boolean {
  if (first.length !== second.length) {
    return false
  }

  return first.every((target, index) => areCanvasTargetsEqual(target, second[index]))
}

export function getActiveMultiSelectionTargets(
  selectedTargets: CanvasObjectTarget[],
  fallbackTargets: CanvasObjectTarget[]
): CanvasObjectTarget[] {
  return selectedTargets.length > 1 ? selectedTargets : fallbackTargets
}

export function shouldBlockEditorTargetInteraction(
  target: unknown,
  selectedTargets: CanvasObjectTarget[],
  isBoxSelecting: boolean,
  isMultiSelectionDragging: boolean,
  shouldBlockSelection: (target: unknown) => boolean
): boolean {
  if (isBoxSelecting || isMultiSelectionDragging) {
    return true
  }

  const objectTarget = getCanvasObjectTarget(target)
  if (
    objectTarget &&
    selectedTargets.length > 1 &&
    selectedTargets.some((selectedTarget) => areCanvasTargetsEqual(selectedTarget, objectTarget))
  ) {
    return true
  }

  return shouldBlockSelection(target)
}

export function getBoundsHorizontalLines(bounds: CanvasObjectBounds): number[] {
  return [bounds.y, bounds.y + bounds.height / 2, bounds.y + bounds.height]
}

export function getNearestSnapDelta(lines: number[], guides: number[]): { delta: number; guide: number; matched: boolean } {
  let closestDelta = 0
  let closestGuide = 0
  let closestDistance = SNAP_DISTANCE + 1
  let matched = false

  for (const line of lines) {
    for (const guide of guides) {
      const delta = guide - line
      const distance = Math.abs(delta)

      if (distance <= SNAP_DISTANCE && distance < closestDistance) {
        closestDelta = delta
        closestGuide = guide
        closestDistance = distance
        matched = true
      }
    }
  }

  return {
    delta: closestDelta,
    guide: closestGuide,
    matched
  }
}
