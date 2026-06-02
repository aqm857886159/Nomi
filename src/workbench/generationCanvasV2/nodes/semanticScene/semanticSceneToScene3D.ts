import {
  createScene3DCameraId,
  createScene3DObjectId,
  normalizeScene3DState,
} from '../scene3d/scene3dSerializer'
import type {
  Scene3DCamera,
  Scene3DObject,
  Scene3DState,
  Scene3DVector3,
} from '../scene3d/scene3dTypes'
import type {
  SemanticScene,
  SemanticSceneBoundary,
  SemanticSceneObject,
  SemanticSceneSpace,
  SemanticSceneSurface,
  SemanticSceneVector2,
  SemanticSceneVector3,
} from './semanticSceneTypes'

type Bounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const DEFAULT_BOUNDS: Bounds = { minX: -3, maxX: 3, minZ: -2.2, maxZ: 2.2 }
const MANNEQUIN_DEFAULT_SCALE: Scene3DVector3 = [2.5, 2.5, 2.5]
const ROLE_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e'] as const

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function midpoint(a: SemanticSceneVector2, b: SemanticSceneVector2): SemanticSceneVector2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

function distance2(a: SemanticSceneVector2, b: SemanticSceneVector2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function colorOr(value: string | undefined, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback
}

function roleColorForIndex(index: number): string {
  return ROLE_COLOR_SEQUENCE[index % ROLE_COLOR_SEQUENCE.length]
}

function includePoint(bounds: Bounds, point: SemanticSceneVector2): Bounds {
  return {
    minX: Math.min(bounds.minX, point[0]),
    maxX: Math.max(bounds.maxX, point[0]),
    minZ: Math.min(bounds.minZ, point[1]),
    maxZ: Math.max(bounds.maxZ, point[1]),
  }
}

function sceneBounds(scene: SemanticScene): Bounds {
  let bounds = { ...DEFAULT_BOUNDS }
  for (const space of scene.graph.spaces) {
    space.floorPolygon?.forEach((point) => { bounds = includePoint(bounds, point) })
    if (space.approximateSize) {
      const width = Math.max(1, space.approximateSize[0])
      const depth = Math.max(1, space.approximateSize[1])
      bounds = includePoint(bounds, [-width / 2, -depth / 2])
      bounds = includePoint(bounds, [width / 2, depth / 2])
    }
  }
  for (const boundary of scene.graph.boundaries) {
    if (boundary.start) bounds = includePoint(bounds, boundary.start)
    if (boundary.end) bounds = includePoint(bounds, boundary.end)
  }
  for (const surface of scene.graph.surfaces) {
    surface.polygon?.forEach((point) => { bounds = includePoint(bounds, point) })
  }
  for (const object of scene.graph.objects) {
    if (object.position) bounds = includePoint(bounds, [object.position[0], object.position[2]])
  }
  return bounds
}

function boundsSize(bounds: Bounds): { width: number; depth: number; centerX: number; centerZ: number } {
  const width = Math.max(2, bounds.maxX - bounds.minX)
  const depth = Math.max(2, bounds.maxZ - bounds.minZ)
  return {
    width,
    depth,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerZ: (bounds.minZ + bounds.maxZ) / 2,
  }
}

function makeMesh(input: {
  name: string
  geometry?: Scene3DObject['geometry']
  position: Scene3DVector3
  rotation?: Scene3DVector3
  scale: Scene3DVector3
  color: string
}): Scene3DObject {
  return {
    id: createScene3DObjectId(),
    name: input.name,
    type: 'mesh',
    visible: true,
    position: input.position,
    rotation: input.rotation || [0, 0, 0],
    scale: input.scale,
    geometry: input.geometry || 'box',
    color: input.color,
  }
}

function makeLight(input: {
  name: string
  position: Scene3DVector3
  type?: Scene3DObject['lightType']
  color?: string
  intensity?: number
}): Scene3DObject {
  return {
    id: createScene3DObjectId(),
    name: input.name,
    type: 'light',
    visible: true,
    position: input.position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    lightType: input.type || 'directional',
    lightColor: colorOr(input.color, '#ffffff'),
    lightIntensity: input.intensity ?? 2.6,
  }
}

function wallObject(boundary: SemanticSceneBoundary): Scene3DObject | null {
  if (!boundary.start || !boundary.end) return null
  const center = midpoint(boundary.start, boundary.end)
  const length = Math.max(0.05, distance2(boundary.start, boundary.end))
  const height = finite(boundary.height ?? 2.8, 2.8)
  const thickness = Math.max(0.04, finite(boundary.thickness ?? 0.14, 0.14))
  const angle = Math.atan2(boundary.end[1] - boundary.start[1], boundary.end[0] - boundary.start[0])
  return makeMesh({
    name: boundary.name || '墙体',
    position: [center[0], height / 2, center[1]],
    rotation: [0, -angle, 0],
    scale: [length, height, thickness],
    color: colorOr(boundary.color, boundary.kind === 'facade' ? '#b6a28b' : '#d8d4cb'),
  })
}

function shellWallsForSpace(space: SemanticSceneSpace): Scene3DObject[] {
  const points = space.floorPolygon
  if (points && points.length >= 3) {
    return points.map((point, index) => wallObject({
      id: `${space.id}-boundary-${index}`,
      name: `${space.name} 墙 ${index + 1}`,
      kind: 'wall',
      start: point,
      end: points[(index + 1) % points.length],
      height: 2.8,
      thickness: 0.12,
      color: '#d8d4cb',
    })).filter((object): object is Scene3DObject => object !== null)
  }
  if (!space.approximateSize) return []
  const width = Math.max(1, space.approximateSize[0])
  const depth = Math.max(1, space.approximateSize[1])
  const x = width / 2
  const z = depth / 2
  const edges: Array<[SemanticSceneVector2, SemanticSceneVector2]> = [
    [[-x, -z], [x, -z]],
    [[x, -z], [x, z]],
    [[x, z], [-x, z]],
    [[-x, z], [-x, -z]],
  ]
  return edges.map(([start, end], index) => wallObject({
    id: `${space.id}-boundary-${index}`,
    name: `${space.name} 墙 ${index + 1}`,
    kind: 'wall',
    start,
    end,
    height: 2.8,
    thickness: 0.12,
    color: '#d8d4cb',
  })).filter((object): object is Scene3DObject => object !== null)
}

function floorObject(name: string, bounds: Bounds, color: string): Scene3DObject {
  const size = boundsSize(bounds)
  return makeMesh({
    name,
    geometry: 'plane',
    position: [size.centerX, 0, size.centerZ],
    rotation: [-Math.PI / 2, 0, 0],
    scale: [size.width, size.depth, 1],
    color,
  })
}

function hintedPosition(hint: string | undefined, bounds: Bounds, fallbackIndex: number): Scene3DVector3 {
  const size = boundsSize(bounds)
  const text = (hint || '').toLowerCase()
  const left = bounds.minX + size.width * 0.22
  const right = bounds.maxX - size.width * 0.22
  const front = bounds.minZ + size.depth * 0.22
  const back = bounds.maxZ - size.depth * 0.22
  const x = text.includes('left') || text.includes('左')
    ? left
    : text.includes('right') || text.includes('右')
      ? right
      : size.centerX + ((fallbackIndex % 3) - 1) * Math.min(1.2, size.width * 0.18)
  const z = text.includes('front') || text.includes('前')
    ? front
    : text.includes('back') || text.includes('后')
      ? back
      : size.centerZ + (Math.floor(fallbackIndex / 3) - 0.5) * Math.min(1.2, size.depth * 0.18)
  return [x, 0.5, z]
}

function objectDefaults(object: SemanticSceneObject): { geometry: Scene3DObject['geometry']; color: string; size: Scene3DVector3 } {
  if (object.kind === 'person') return { geometry: 'box', color: '#8b929c', size: [0.5, 1.7, 0.35] }
  if (object.kind === 'vegetation') return { geometry: 'cylinder', color: '#5d8c55', size: [0.7, 2.4, 0.7] }
  if (object.kind === 'vehicle') return { geometry: 'box', color: '#7c8797', size: [3.8, 1.35, 1.8] }
  if (object.kind === 'building') return { geometry: 'box', color: '#a59a8f', size: [3, 3, 0.5] }
  if (object.kind === 'light') return { geometry: 'sphere', color: '#f8e7a6', size: [0.25, 0.25, 0.25] }
  if (object.kind === 'landform') return { geometry: 'box', color: '#7f9368', size: [2.2, 0.5, 1.4] }
  return { geometry: 'box', color: '#7c8ea0', size: [1, 0.75, 1] }
}

function sceneObject(object: SemanticSceneObject, bounds: Bounds, index: number, roleIndex = 0): Scene3DObject {
  if (object.kind === 'person') {
    const position = object.position || hintedPosition(object.positionHint, bounds, index)
    const scale = object.size || [...MANNEQUIN_DEFAULT_SCALE]
    return {
      id: createScene3DObjectId(),
      name: object.name,
      type: 'mannequin',
      visible: true,
      position: [position[0], Math.max(0, Math.abs(scale[1]) * 0.5), position[2]],
      rotation: [0, object.rotationY || 0, 0],
      scale,
      color: roleColorForIndex(roleIndex),
    }
  }
  if (object.kind === 'light') {
    const position = object.position || [0, 2.6, 0]
    return makeLight({
      name: object.name,
      position,
      type: 'point',
      color: object.color,
      intensity: 2,
    })
  }
  const defaults = objectDefaults(object)
  const position = object.position || hintedPosition(object.positionHint, bounds, index)
  const size = object.size || defaults.size
  return makeMesh({
    name: object.name,
    geometry: defaults.geometry,
    position: [position[0], Math.max(0.05, position[1] || size[1] / 2), position[2]],
    rotation: [0, object.rotationY || 0, 0],
    scale: [
      Math.max(0.05, size[0]),
      Math.max(0.05, size[1]),
      Math.max(0.05, size[2]),
    ],
    color: colorOr(object.color, defaults.color),
  })
}

function openingObjects(scene: SemanticScene): Scene3DObject[] {
  return scene.graph.openings.flatMap((opening) => {
    if (!opening.position) return []
    const width = Math.max(0.25, opening.width || (opening.kind === 'door' ? 0.9 : 1.1))
    const height = Math.max(0.25, opening.height || (opening.kind === 'door' ? 2.05 : 1.1))
    const y = opening.kind === 'door'
      ? height / 2
      : Math.max(0.4, opening.sillHeight || 0.9) + height / 2
    return [makeMesh({
      name: opening.name,
      geometry: 'box',
      position: [opening.position[0], y, opening.position[1]],
      scale: [width, height, 0.045],
      color: opening.kind === 'window' ? '#91b6d7' : '#6f5b45',
    })]
  })
}

function semanticCamera(camera: SemanticScene['graph']['cameras'][number], bounds: Bounds, index: number): Scene3DCamera {
  const size = boundsSize(bounds)
  const position = camera.position || [size.centerX + size.width * 0.7, 2.4, size.centerZ + size.depth * 0.9]
  const target = camera.target || [size.centerX, 0.8, size.centerZ]
  return {
    id: createScene3DCameraId(),
    name: camera.name || `相机 ${index + 1}`,
    visible: true,
    position,
    rotation: [0, 0, 0],
    target,
    fov: camera.fov || 45,
    aspectRatio: camera.aspectRatio || '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 300,
  }
}

function defaultCamera(bounds: Bounds): Scene3DCamera {
  const size = boundsSize(bounds)
  return {
    id: createScene3DCameraId(),
    name: '语义场景相机',
    visible: true,
    position: [size.centerX + Math.max(3, size.width * 0.55), 2.8, size.centerZ + Math.max(4, size.depth * 0.9)],
    rotation: [-0.35, 0.65, 0],
    target: [size.centerX, 0.8, size.centerZ],
    fov: 45,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 300,
  }
}

function surfaceFloorColor(scene: SemanticScene): string {
  const surface = scene.graph.surfaces.find((item) => item.kind === 'floor' || item.kind === 'ground' || item.kind === 'water')
  if (surface?.kind === 'water') return colorOr(surface.color, '#5f8ea8')
  if (scene.sceneClass === 'outdoor_open') return colorOr(surface?.color, '#7d8a67')
  return colorOr(surface?.color, '#7f756a')
}

export function semanticSceneToScene3D(scene: SemanticScene): Scene3DState {
  const bounds = sceneBounds(scene)
  const size = boundsSize(bounds)
  const objects: Scene3DObject[] = [
    floorObject(scene.sceneClass === 'outdoor_open' ? '开放场景地面' : '语义场景地面', bounds, surfaceFloorColor(scene)),
  ]

  for (const space of scene.graph.spaces) {
    if (space.type === 'room' || scene.sceneClass === 'indoor_architecture') {
      objects.push(...shellWallsForSpace(space))
    }
  }

  for (const boundary of scene.graph.boundaries) {
    const wall = wallObject(boundary)
    if (wall) objects.push(wall)
  }

  objects.push(...openingObjects(scene))
  let roleIndex = 0
  scene.graph.objects.forEach((object, index) => {
    objects.push(sceneObject(object, bounds, index, roleIndex))
    if (object.kind === 'person') roleIndex += 1
  })

  objects.push(makeLight({
    name: scene.graph.lighting.mood ? `主光源 - ${scene.graph.lighting.mood}` : '语义场景主光源',
    position: [size.centerX + size.width * 0.4, 5.5, size.centerZ + size.depth * 0.35],
    type: 'directional',
    color: scene.graph.lighting.color,
    intensity: scene.sceneClass === 'outdoor_open' ? 3.2 : 2.6,
  }))

  const cameras = scene.graph.cameras.length
    ? scene.graph.cameras.map((camera, index) => semanticCamera(camera, bounds, index))
    : [defaultCamera(bounds)]

  return normalizeScene3DState({
    objects,
    cameras,
    environment: {
      preset: scene.sceneClass === 'outdoor_open' ? 'city' : 'apartment',
      showGrid: true,
      showAxes: false,
      showSky: scene.sceneClass === 'outdoor_open' || scene.sceneClass === 'mixed',
      backgroundColor: scene.sceneClass === 'outdoor_open' ? '#dbe7ef' : '#f6f3ee',
    },
    editorCamera: {
      position: [size.centerX + Math.max(4, size.width * 0.75), 3.4, size.centerZ + Math.max(5, size.depth)],
      target: [size.centerX, 0.8, size.centerZ],
      rotation: [0, 0, 0],
      mode: 'edit',
    },
  })
}
