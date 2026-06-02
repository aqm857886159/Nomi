import type {
  SemanticScene,
  SemanticSceneBoundary,
  SemanticSceneCamera,
  SemanticSceneClass,
  SemanticSceneCoordinateSystem,
  SemanticSceneGraph,
  SemanticSceneObject,
  SemanticSceneOpening,
  SemanticSceneSourceType,
  SemanticSceneSpace,
  SemanticSceneSummary,
  SemanticSceneSurface,
  SemanticSceneVector2,
  SemanticSceneVector3,
} from './semanticSceneTypes'

const SOURCE_TYPES = new Set<SemanticSceneSourceType>(['panorama', 'image', 'multi_view', 'manual'])
const SCENE_CLASSES = new Set<SemanticSceneClass>(['indoor_architecture', 'outdoor_open', 'mixed', 'unknown'])
const COORDINATE_SYSTEMS = new Set<SemanticSceneCoordinateSystem>(['relative', 'meters_estimated'])
const SPACE_TYPES = new Set<SemanticSceneSpace['type']>(['room', 'area', 'path', 'plaza', 'terrain', 'unknown'])
const BOUNDARY_KINDS = new Set<SemanticSceneBoundary['kind']>(['wall', 'facade', 'fence', 'edge', 'terrain_edge', 'unknown'])
const OPENING_KINDS = new Set<SemanticSceneOpening['kind']>(['door', 'window', 'archway', 'unknown'])
const SURFACE_KINDS = new Set<SemanticSceneSurface['kind']>(['floor', 'ceiling', 'wall', 'ground', 'sky', 'water', 'unknown'])
const OBJECT_KINDS = new Set<SemanticSceneObject['kind']>([
  'furniture',
  'prop',
  'vegetation',
  'vehicle',
  'person',
  'light',
  'building',
  'landform',
  'unknown',
])
const ASPECT_RATIOS = new Set<NonNullable<SemanticSceneCamera['aspectRatio']>>(['16:9', '9:16', '4:3', '3:4', '1:1'])
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const MAX_ITEMS = 160

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text || undefined
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalFiniteNumber(value: unknown, min = -Infinity, max = Infinity): number | undefined {
  const parsed = finiteNumber(value, NaN)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, parsed))
}

function confidenceValue(value: unknown, fallback = 0): number {
  return Math.min(1, Math.max(0, finiteNumber(value, fallback)))
}

function colorValue(value: unknown): string | undefined {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : undefined
}

function idValue(value: unknown, prefix: string, index: number): string {
  return stringValue(value, `${prefix}-${index + 1}`)
}

function vector2(value: unknown): SemanticSceneVector2 | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const x = finiteNumber(value[0], NaN)
  const z = finiteNumber(value[1], NaN)
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : undefined
}

function vector3(value: unknown): SemanticSceneVector3 | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined
  const x = finiteNumber(value[0], NaN)
  const y = finiteNumber(value[1], NaN)
  const z = finiteNumber(value[2], NaN)
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [x, y, z] : undefined
}

function vector2List(value: unknown): SemanticSceneVector2[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((item) => {
    const point = vector2(item)
    return point ? [point] : []
  }).slice(0, MAX_ITEMS)
  return items.length ? items : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => stringValue(item)).filter(Boolean))).slice(0, MAX_ITEMS)
}

function normalizeSpace(value: unknown, index: number): SemanticSceneSpace {
  const raw = asRecord(value)
  const approximateSize = vector2(raw.approximateSize)
  return {
    id: idValue(raw.id, 'space', index),
    name: stringValue(raw.name, `空间 ${index + 1}`),
    type: SPACE_TYPES.has(raw.type as SemanticSceneSpace['type']) ? raw.type as SemanticSceneSpace['type'] : 'unknown',
    floorPolygon: vector2List(raw.floorPolygon ?? raw.polygon),
    approximateSize: approximateSize && approximateSize[0] > 0 && approximateSize[1] > 0 ? approximateSize : undefined,
    confidence: optionalFiniteNumber(raw.confidence, 0, 1),
  }
}

function normalizeBoundary(value: unknown, index: number): SemanticSceneBoundary {
  const raw = asRecord(value)
  return {
    id: idValue(raw.id, 'boundary', index),
    name: stringValue(raw.name, `边界 ${index + 1}`),
    kind: BOUNDARY_KINDS.has(raw.kind as SemanticSceneBoundary['kind']) ? raw.kind as SemanticSceneBoundary['kind'] : 'unknown',
    start: vector2(raw.start),
    end: vector2(raw.end),
    positionHint: optionalString(raw.positionHint),
    height: optionalFiniteNumber(raw.height, 0.05, 80),
    thickness: optionalFiniteNumber(raw.thickness, 0.01, 10),
    material: optionalString(raw.material),
    color: colorValue(raw.color),
    confidence: optionalFiniteNumber(raw.confidence, 0, 1),
  }
}

function normalizeOpening(value: unknown, index: number): SemanticSceneOpening {
  const raw = asRecord(value)
  return {
    id: idValue(raw.id, 'opening', index),
    name: stringValue(raw.name, `开口 ${index + 1}`),
    kind: OPENING_KINDS.has(raw.kind as SemanticSceneOpening['kind']) ? raw.kind as SemanticSceneOpening['kind'] : 'unknown',
    boundaryId: optionalString(raw.boundaryId),
    position: vector2(raw.position),
    positionHint: optionalString(raw.positionHint),
    width: optionalFiniteNumber(raw.width, 0.01, 80),
    height: optionalFiniteNumber(raw.height, 0.01, 80),
    sillHeight: optionalFiniteNumber(raw.sillHeight, 0, 20),
    confidence: optionalFiniteNumber(raw.confidence, 0, 1),
  }
}

function normalizeSurface(value: unknown, index: number): SemanticSceneSurface {
  const raw = asRecord(value)
  return {
    id: idValue(raw.id, 'surface', index),
    name: stringValue(raw.name, `表面 ${index + 1}`),
    kind: SURFACE_KINDS.has(raw.kind as SemanticSceneSurface['kind']) ? raw.kind as SemanticSceneSurface['kind'] : 'unknown',
    polygon: vector2List(raw.polygon),
    material: optionalString(raw.material),
    color: colorValue(raw.color),
    confidence: optionalFiniteNumber(raw.confidence, 0, 1),
  }
}

function normalizeObject(value: unknown, index: number): SemanticSceneObject {
  const raw = asRecord(value)
  return {
    id: idValue(raw.id, 'object', index),
    name: stringValue(raw.name, `对象 ${index + 1}`),
    kind: OBJECT_KINDS.has(raw.kind as SemanticSceneObject['kind']) ? raw.kind as SemanticSceneObject['kind'] : 'unknown',
    position: vector3(raw.position),
    positionHint: optionalString(raw.positionHint),
    size: vector3(raw.size),
    rotationY: optionalFiniteNumber(raw.rotationY, -Math.PI * 8, Math.PI * 8),
    material: optionalString(raw.material),
    color: colorValue(raw.color),
    confidence: optionalFiniteNumber(raw.confidence, 0, 1),
  }
}

function normalizeCamera(value: unknown, index: number): SemanticSceneCamera {
  const raw = asRecord(value)
  return {
    id: idValue(raw.id, 'camera', index),
    name: stringValue(raw.name, `相机 ${index + 1}`),
    position: vector3(raw.position),
    target: vector3(raw.target),
    fov: optionalFiniteNumber(raw.fov, 12, 120),
    aspectRatio: ASPECT_RATIOS.has(raw.aspectRatio as NonNullable<SemanticSceneCamera['aspectRatio']>)
      ? raw.aspectRatio as NonNullable<SemanticSceneCamera['aspectRatio']>
      : undefined,
  }
}

function normalizeGraph(value: unknown): SemanticSceneGraph {
  const raw = asRecord(value)
  const lighting = asRecord(raw.lighting)
  const softness = lighting.softness === 'hard' || lighting.softness === 'medium' || lighting.softness === 'soft'
    ? lighting.softness
    : lighting.softness === 'unknown'
      ? 'unknown'
      : undefined
  return {
    spaces: Array.isArray(raw.spaces) ? raw.spaces.slice(0, MAX_ITEMS).map(normalizeSpace) : [],
    boundaries: Array.isArray(raw.boundaries) ? raw.boundaries.slice(0, MAX_ITEMS).map(normalizeBoundary) : [],
    openings: Array.isArray(raw.openings) ? raw.openings.slice(0, MAX_ITEMS).map(normalizeOpening) : [],
    surfaces: Array.isArray(raw.surfaces) ? raw.surfaces.slice(0, MAX_ITEMS).map(normalizeSurface) : [],
    objects: Array.isArray(raw.objects) ? raw.objects.slice(0, MAX_ITEMS).map(normalizeObject) : [],
    lighting: {
      timeOfDay: optionalString(lighting.timeOfDay),
      mood: optionalString(lighting.mood),
      mainDirection: optionalString(lighting.mainDirection),
      softness,
      color: colorValue(lighting.color),
    },
    cameras: Array.isArray(raw.cameras) ? raw.cameras.slice(0, 24).map(normalizeCamera) : [],
    uncertainties: stringList(raw.uncertainties),
  }
}

export function createEmptySemanticScene(input: {
  sourceType?: SemanticSceneSourceType
  sceneClass?: SemanticSceneClass
  sourceNodeId?: string
  sourceImageUrls?: string[]
  scaleHint?: string
} = {}): SemanticScene {
  const now = Date.now()
  return {
    version: '1.0',
    sourceType: input.sourceType || 'manual',
    sceneClass: input.sceneClass || 'unknown',
    confidence: 0,
    coordinateSystem: 'relative',
    sourceNodeId: input.sourceNodeId,
    sourceImageUrls: input.sourceImageUrls || [],
    scaleHint: input.scaleHint,
    graph: {
      spaces: [],
      boundaries: [],
      openings: [],
      surfaces: [],
      objects: [],
      lighting: {},
      cameras: [],
      uncertainties: ['等待 AI 分析或粘贴语义场景 JSON。'],
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeSemanticScene(value: unknown): SemanticScene {
  const fallback = createEmptySemanticScene()
  const raw = asRecord(value)
  return {
    version: '1.0',
    sourceType: SOURCE_TYPES.has(raw.sourceType as SemanticSceneSourceType) ? raw.sourceType as SemanticSceneSourceType : fallback.sourceType,
    sceneClass: SCENE_CLASSES.has(raw.sceneClass as SemanticSceneClass) ? raw.sceneClass as SemanticSceneClass : fallback.sceneClass,
    confidence: confidenceValue(raw.confidence, fallback.confidence),
    coordinateSystem: COORDINATE_SYSTEMS.has(raw.coordinateSystem as SemanticSceneCoordinateSystem)
      ? raw.coordinateSystem as SemanticSceneCoordinateSystem
      : fallback.coordinateSystem,
    sourceNodeId: optionalString(raw.sourceNodeId),
    sourceImageUrls: stringList(raw.sourceImageUrls),
    scaleHint: optionalString(raw.scaleHint),
    graph: normalizeGraph(raw.graph),
    createdAt: finiteNumber(raw.createdAt, fallback.createdAt),
    updatedAt: finiteNumber(raw.updatedAt, fallback.updatedAt),
  }
}

export function summarizeSemanticScene(scene: SemanticScene): SemanticSceneSummary {
  return {
    spaces: scene.graph.spaces.length,
    boundaries: scene.graph.boundaries.length,
    openings: scene.graph.openings.length,
    surfaces: scene.graph.surfaces.length,
    objects: scene.graph.objects.length,
    cameras: scene.graph.cameras.length,
    uncertainties: scene.graph.uncertainties.length,
  }
}
