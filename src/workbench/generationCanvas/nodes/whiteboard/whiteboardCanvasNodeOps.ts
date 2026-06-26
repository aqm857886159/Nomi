import type { CanvasAsset } from './lib/canvas'
import type { PointerPoint } from './lib/stroke'
import type {
  CanvasNodeInteractionState,
  CanvasObjectBounds,
  CanvasObjectFlipState,
  CanvasObjectKind,
  CanvasObjectOffset,
  CanvasObjectTarget,
  CanvasPoint,
  CanvasStroke,
  LeaferBox,
  LeaferBoxChild,
  LeaferGroup,
  LeaferPathCommandData,
  LeaferPathTools,
  LeaferUiModule,
} from './whiteboardCanvasTypes'

export function getObjectKey(kind: CanvasObjectKind, id: string): string {
  return `${kind}:${id}`
}

export function getObjectFlipState(
  flips: Map<string, CanvasObjectFlipState>,
  target: CanvasObjectTarget
): CanvasObjectFlipState {
  return flips.get(getObjectKey(target.kind, target.id)) ?? { x: false, y: false }
}

export function getFlippedContentGroupProps(
  bounds: CanvasObjectBounds,
  flipState: CanvasObjectFlipState
): Record<string, unknown> {
  return {
    x: flipState.x ? bounds.width : 0,
    y: flipState.y ? bounds.height : 0,
    scaleX: flipState.x ? -1 : 1,
    scaleY: flipState.y ? -1 : 1,
    editable: false,
    draggable: false,
    hittable: false
  }
}

export function getObjectOffset(
  offsets: Map<string, CanvasObjectOffset>,
  kind: CanvasObjectKind,
  id: string
): CanvasObjectOffset {
  return offsets.get(getObjectKey(kind, id)) ?? { x: 0, y: 0 }
}

export function getCanvasNodeBounds(target: unknown): Partial<CanvasObjectBounds> {
  return {
    x: getCanvasNodeNumber(target, 'x'),
    y: getCanvasNodeNumber(target, 'y'),
    width: getCanvasNodeNumber(target, 'width'),
    height: getCanvasNodeNumber(target, 'height')
  }
}

export function getCanvasNodeInteractionState(target: unknown): CanvasNodeInteractionState {
  return {
    editable: getCanvasNodeProperty(target, 'editable'),
    draggable: getCanvasNodeProperty(target, 'draggable'),
    hittable: getCanvasNodeProperty(target, 'hittable'),
    hitFill: getCanvasNodeProperty(target, 'hitFill')
  }
}

export function setCanvasNodeInteractionState(target: unknown, state: CanvasNodeInteractionState): void {
  if (!target || typeof target !== 'object') {
    return
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null

  for (const [key, value] of Object.entries(state)) {
    targetRecord[key] = value
    if (propsRecord) {
      propsRecord[key] = value
    }
  }
}

export function getCanvasNodeProperty(target: unknown, key: string): unknown {
  if (!target || typeof target !== 'object') {
    return undefined
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null

  return targetRecord[key] ?? propsRecord?.[key]
}

export function getCanvasNodeNumber(target: unknown, key: keyof CanvasObjectBounds): number | undefined {
  if (!target || typeof target !== 'object') {
    return undefined
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null
  const value = targetRecord[key] ?? propsRecord?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function getFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function addCanvasObjectGroup(
  layerGroup: LeaferGroup,
  objectGroup: LeaferBox,
  object: {
    kind: CanvasObjectKind
    id: string
    bounds: CanvasObjectBounds
  },
  baseNode: LeaferBoxChild,
  eraserStrokes: CanvasStroke[],
  Group: LeaferUiModule['Group'],
  Path: LeaferUiModule['Path'],
  flipState: CanvasObjectFlipState,
  offsets: Map<string, CanvasObjectOffset>,
  pathTools: LeaferPathTools
): void {
  const contentGroup = new Group(getFlippedContentGroupProps(object.bounds, flipState))

  contentGroup.add(baseNode)

  for (const eraserStroke of eraserStrokes) {
    if (!eraserStroke.path) {
      continue
    }

    const eraserOffset = getObjectOffset(offsets, 'stroke', eraserStroke.id)
    contentGroup.add(
      new Path({
        x: eraserOffset.x,
        y: eraserOffset.y,
        path: translatePathToLocal(eraserStroke.path, object.bounds, pathTools),
        fill: '#000000',
        eraser: 'path',
        editable: false,
        draggable: false,
        hittable: false,
        hitFill: 'none',
        canvasObjectKind: 'stroke',
        canvasObjectId: eraserStroke.id,
        canvasEraserTargetKind: object.kind,
        canvasEraserTargetId: object.id
      })
    )
  }

  objectGroup.add(contentGroup)
  layerGroup.add(objectGroup)
}

export function setCircleGeometry(circle: SVGCircleElement | null, point: PointerPoint, radius: number): void {
  if (!circle) {
    return
  }

  circle.setAttribute('cx', String(point[0]))
  circle.setAttribute('cy', String(point[1]))
  circle.setAttribute('r', String(radius))
}

export function shouldAppendPoint(points: PointerPoint[], point: PointerPoint, brushSize: number): boolean {
  const previousPoint = points.at(-1)
  if (!previousPoint) {
    return true
  }

  const minimumDistance = Math.max(0.75, brushSize * 0.012)
  const deltaX = point[0] - previousPoint[0]
  const deltaY = point[1] - previousPoint[1]

  return deltaX * deltaX + deltaY * deltaY >= minimumDistance * minimumDistance
}

export function shouldBlockErasedSelection(
  target: unknown,
  selectionPoint: CanvasPoint | null,
  strokes: CanvasStroke[],
  assets: CanvasAsset[],
  offsets: Map<string, CanvasObjectOffset>
): boolean {
  if (!selectionPoint) {
    return false
  }

  if (Array.isArray(target)) {
    return target.some((item) => shouldBlockErasedSelection(item, selectionPoint, strokes, assets, offsets))
  }

  const objectTarget = getCanvasObjectTarget(target)
  if (!objectTarget) {
    return false
  }

  if (objectTarget.kind === 'asset') {
    const asset = assets.find((item) => item.id === objectTarget.id)
    if (!asset) {
      return false
    }

    const assetOffset = getObjectOffset(offsets, 'asset', asset.id)
    return strokes.some(
      (stroke) =>
        stroke.layerId === asset.layerId &&
        stroke.tool === 'eraser' &&
        isPointInsideEraserStroke(selectionPoint, stroke, offsets, assetOffset)
    )
  }

  const targetStrokeIndex = strokes.findIndex((stroke) => stroke.id === objectTarget.id)
  const targetStroke = strokes[targetStrokeIndex]
  if (!targetStroke) {
    return false
  }

  if (targetStroke.tool === 'eraser') {
    return true
  }

  const targetOffset = getObjectOffset(offsets, 'stroke', targetStroke.id)
  return strokes
    .slice(targetStrokeIndex + 1)
    .some(
      (stroke) =>
        stroke.layerId === targetStroke.layerId &&
        stroke.tool === 'eraser' &&
        isPointInsideEraserStroke(selectionPoint, stroke, offsets, targetOffset)
    )
}

export function getCanvasObjectTarget(target: unknown): CanvasObjectTarget | null {
  if (!target || typeof target !== 'object') {
    return null
  }

  const targetRecord = target as Record<string, unknown>
  const propsRecord =
    targetRecord.props && typeof targetRecord.props === 'object'
      ? (targetRecord.props as Record<string, unknown>)
      : null
  const kind = (targetRecord.canvasObjectKind ?? propsRecord?.canvasObjectKind ?? targetRecord.kind ?? propsRecord?.kind) as
    | CanvasObjectKind
    | undefined
  const id = (targetRecord.canvasObjectId ?? propsRecord?.canvasObjectId ?? targetRecord.id ?? propsRecord?.id) as
    | string
    | undefined

  if ((kind === 'asset' || kind === 'stroke' || kind === 'group') && id) {
    return { kind, id }
  }

  return null
}

export function isPointInsideEraserStroke(
  point: CanvasPoint,
  stroke: CanvasStroke,
  offsets: Map<string, CanvasObjectOffset>,
  targetOffset: CanvasObjectOffset
): boolean {
  const eraserOffset = getObjectOffset(offsets, 'stroke', stroke.id)
  const localPoint = {
    x: point.x - targetOffset.x - eraserOffset.x,
    y: point.y - targetOffset.y - eraserOffset.y
  }

  if (stroke.points && stroke.points.length > 0) {
    return isPointNearPointerTrack(localPoint, stroke.points, stroke.size)
  }

  const pathBounds = getSvgPathBounds(stroke.path)
  return pathBounds ? isPointInsideBounds(localPoint, pathBounds) : false
}

export function isPointNearPointerTrack(point: CanvasPoint, points: PointerPoint[], size: number): boolean {
  const hitRadius = Math.max(2, size / 2)

  if (points.length === 1) {
    return getDistanceSquared(point, points[0]) <= hitRadius * hitRadius
  }

  for (let index = 1; index < points.length; index += 1) {
    if (getDistanceToSegmentSquared(point, points[index - 1], points[index]) <= hitRadius * hitRadius) {
      return true
    }
  }

  return false
}

export function getDistanceSquared(point: CanvasPoint, target: PointerPoint): number {
  const deltaX = point.x - target[0]
  const deltaY = point.y - target[1]

  return deltaX * deltaX + deltaY * deltaY
}

export function getDistanceToSegmentSquared(point: CanvasPoint, start: PointerPoint, end: PointerPoint): number {
  const segmentX = end[0] - start[0]
  const segmentY = end[1] - start[1]
  const lengthSquared = segmentX * segmentX + segmentY * segmentY

  if (lengthSquared === 0) {
    return getDistanceSquared(point, start)
  }

  const rawT = ((point.x - start[0]) * segmentX + (point.y - start[1]) * segmentY) / lengthSquared
  const t = Math.min(1, Math.max(0, rawT))
  const projection: PointerPoint = [start[0] + t * segmentX, start[1] + t * segmentY, 0.5]

  return getDistanceSquared(point, projection)
}

export function getSvgPathBounds(path: string): { x: number; y: number; width: number; height: number } | null {
  const values = path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  if (values.length < 2) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < values.length - 1; index += 2) {
    const x = values[index]
    const y = values[index + 1]

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }

    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

export function translatePathToLocal(
  path: string,
  origin: Pick<CanvasObjectBounds, 'x' | 'y'>,
  tools: LeaferPathTools
): LeaferPathCommandData {
  const data = [...tools.PathConvert.parse(path)]
  translatePathCommandData(data, -origin.x, -origin.y, tools)

  return data
}

export function translatePathCommandData(data: LeaferPathCommandData, deltaX: number, deltaY: number, tools: LeaferPathTools) {
  const { PathCommandMap, PathNumberCommandLengthMap } = tools
  const translatePair = (index: number) => {
    data[index] += deltaX
    data[index + 1] += deltaY
  }

  for (let index = 0; index < data.length; ) {
    const command = data[index]

    switch (command) {
      case PathCommandMap.M:
      case PathCommandMap.L:
        translatePair(index + 1)
        break
      case PathCommandMap.C:
        translatePair(index + 1)
        translatePair(index + 3)
        translatePair(index + 5)
        break
      case PathCommandMap.Q:
        translatePair(index + 1)
        translatePair(index + 3)
        break
      default:
        break
    }

    const commandLength = PathNumberCommandLengthMap[command]
    if (!commandLength) {
      break
    }

    index += commandLength
  }
}

export function isPointInsideBounds(
  point: CanvasPoint,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  )
}
