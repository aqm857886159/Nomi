import type {
  Scene3DAspectRatio,
  Scene3DCamera,
  Scene3DControlMode,
  Scene3DGeometry,
  Scene3DLightType,
  Scene3DObject,
  Scene3DState,
  Scene3DVector3,
} from './scene3dTypes'

const GEOMETRIES = new Set<Scene3DGeometry>(['box', 'sphere', 'cylinder', 'plane'])
const LIGHT_TYPES = new Set<Scene3DLightType>(['point', 'directional', 'spot'])
const ASPECT_RATIOS = new Set<Scene3DAspectRatio>(['16:9', '9:16', '4:3', '3:4', '1:1'])
const CONTROL_MODES = new Set<Scene3DControlMode>(['edit', 'fly'])
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const MANNEQUIN_DEFAULT_SCALE: Scene3DVector3 = [2.5, 2.5, 2.5]
const ROLE_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e'] as const
const CROWD_MAX_AXIS = 10

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? value as number : fallback
}

function finiteVector(value: unknown, fallback: Scene3DVector3): Scene3DVector3 {
  if (!Array.isArray(value) || value.length < 3) return [...fallback]
  return [
    finiteNumber(value[0], fallback[0]),
    finiteNumber(value[1], fallback[1]),
    finiteNumber(value[2], fallback[2]),
  ]
}

function colorValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : fallback
}

function poseValue(value: unknown): Record<string, Scene3DVector3> | undefined {
  const raw = asRecord(value)
  const pose = Object.entries(raw).reduce<Record<string, Scene3DVector3>>((next, [boneName, rotation]) => {
    if (!boneName.trim()) return next
    const normalizedBoneName = boneName.replace(/^mixamorig:/, 'mixamorig')
    next[normalizedBoneName] = finiteVector(rotation, [0, 0, 0])
    return next
  }, {})
  return Object.keys(pose).length > 0 ? pose : undefined
}

function createScene3DId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createScene3DObjectId(): string {
  return createScene3DId('scene3d-object')
}

export function createScene3DCameraId(): string {
  return createScene3DId('scene3d-camera')
}

export function createDefaultScene3DState(): Scene3DState {
  return {
    objects: [
      {
        id: createScene3DObjectId(),
        name: '假人',
        type: 'mannequin',
        visible: true,
        position: [0, MANNEQUIN_DEFAULT_SCALE[1] * 0.5, 0],
        rotation: [0, 0, 0],
        scale: [...MANNEQUIN_DEFAULT_SCALE],
        color: ROLE_COLOR_SEQUENCE[0],
      },
    ],
    cameras: [
      {
        id: createScene3DCameraId(),
        name: '相机1',
        visible: true,
        position: [4, 2.4, 5],
        rotation: [-0.36, 0.68, 0],
        target: [0, 0.75, 0],
        fov: 45,
        aspectRatio: '16:9',
        lensDepth: 0,
        near: 0.1,
        far: 200,
      },
    ],
    environment: {
      preset: 'city',
      showGrid: true,
      showAxes: true,
      showSky: false,
      darkMode: false,
      backgroundColor: '#f6f3ee',
    },
    editorCamera: {
      position: [-5, 3.2, 6],
      target: [0, 0.75, 0],
      rotation: [0, 0, 0],
      mode: 'edit',
    },
  }
}

function normalizeObject(value: unknown, index: number): Scene3DObject | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const type = raw.type === 'mannequin' || raw.type === 'mannequinCrowd' || raw.type === 'model' || raw.type === 'light' || raw.type === 'group'
    ? raw.type
    : 'mesh'
  const geometry = GEOMETRIES.has(raw.geometry as Scene3DGeometry) ? raw.geometry as Scene3DGeometry : 'box'
  const lightType = LIGHT_TYPES.has(raw.lightType as Scene3DLightType) ? raw.lightType as Scene3DLightType : 'point'
  return {
    id,
    name: stringValue(raw.name, `${type === 'light' ? '灯光' : '对象'}${index + 1}`),
    type,
    visible: raw.visible !== false,
    position: finiteVector(raw.position, [0, type === 'mesh' ? 0.5 : (type === 'mannequin' || type === 'mannequinCrowd') ? MANNEQUIN_DEFAULT_SCALE[1] * 0.5 : 0, 0]),
    rotation: finiteVector(raw.rotation, [0, 0, 0]),
    scale: finiteVector(raw.scale, (type === 'mannequin' || type === 'mannequinCrowd') ? MANNEQUIN_DEFAULT_SCALE : [1, 1, 1]),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    color: colorValue(raw.color, '#808080'),
    geometry,
    modelUrl: typeof raw.modelUrl === 'string' ? raw.modelUrl : undefined,
    lightType,
    lightColor: colorValue(raw.lightColor, '#ffffff'),
    lightIntensity: Math.max(0, finiteNumber(raw.lightIntensity, 2)),
    crowdRows: Math.min(CROWD_MAX_AXIS, Math.max(1, finiteInteger(raw.crowdRows, 1))),
    crowdColumns: Math.min(CROWD_MAX_AXIS, Math.max(1, finiteInteger(raw.crowdColumns, 1))),
    crowdSpacing: Math.min(10, Math.max(0.2, finiteNumber(raw.crowdSpacing, 1.2))),
    pose: poseValue(raw.pose),
    children: Array.isArray(raw.children) ? raw.children.filter((id): id is string => typeof id === 'string') : undefined,
  }
}

function normalizeCamera(value: unknown, index: number): Scene3DCamera | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  return {
    id,
    name: stringValue(raw.name, `相机${index + 1}`),
    visible: raw.visible !== false,
    position: finiteVector(raw.position, [4, 2.4, 5]),
    rotation: finiteVector(raw.rotation, [-0.35, 0.65, 0]),
    target: finiteVector(raw.target, [0, 0.75, 0]),
    fov: Math.min(120, Math.max(12, finiteNumber(raw.fov, 45))),
    aspectRatio: ASPECT_RATIOS.has(raw.aspectRatio as Scene3DAspectRatio) ? raw.aspectRatio as Scene3DAspectRatio : '16:9',
    lensDepth: Math.min(100, Math.max(-100, finiteNumber(raw.lensDepth, 0))),
    near: Math.max(0.01, finiteNumber(raw.near, 0.1)),
    far: Math.max(1, finiteNumber(raw.far, 200)),
  }
}

export function normalizeScene3DState(value: unknown): Scene3DState {
  const fallback = createDefaultScene3DState()
  const raw = asRecord(value)
  const environment = asRecord(raw.environment)
  const editorCamera = asRecord(raw.editorCamera)
  const objects = Array.isArray(raw.objects)
    ? raw.objects.flatMap((item, index) => {
      const object = normalizeObject(item, index)
      return object ? [object] : []
    })
    : fallback.objects
  const cameras = Array.isArray(raw.cameras)
    ? raw.cameras.flatMap((item, index) => {
      const camera = normalizeCamera(item, index)
      return camera ? [camera] : []
    })
    : fallback.cameras

  return {
    objects,
    cameras,
    environment: {
      preset: stringValue(environment.preset, fallback.environment.preset),
      showGrid: environment.showGrid !== false,
      showAxes: environment.showAxes !== false,
      showSky: environment.showSky === true,
      darkMode: environment.darkMode === true,
      backgroundColor: colorValue(environment.backgroundColor, fallback.environment.backgroundColor),
    },
    editorCamera: {
      position: finiteVector(editorCamera.position, fallback.editorCamera.position),
      target: finiteVector(editorCamera.target, fallback.editorCamera.target),
      rotation: finiteVector(editorCamera.rotation, fallback.editorCamera.rotation),
      mode: CONTROL_MODES.has(editorCamera.mode as Scene3DControlMode) ? editorCamera.mode as Scene3DControlMode : 'edit',
    },
    lastThumbnail: typeof raw.lastThumbnail === 'string' && raw.lastThumbnail ? raw.lastThumbnail : undefined,
  }
}

export function cloneScene3DState(state: Scene3DState): Scene3DState {
  return {
    objects: state.objects.map((object) => ({
      ...object,
      position: [...object.position],
      rotation: [...object.rotation],
      scale: [...object.scale],
      pose: object.pose ? Object.fromEntries(Object.entries(object.pose).map(([boneName, rotation]) => [boneName, [...rotation] as Scene3DVector3])) : undefined,
      children: object.children ? [...object.children] : undefined,
    })),
    cameras: state.cameras.map((camera) => ({
      ...camera,
      position: [...camera.position],
      rotation: [...camera.rotation],
      target: [...(camera.target || [0, 0.75, 0] as Scene3DVector3)],
    })),
    environment: { ...state.environment },
    editorCamera: {
      position: [...state.editorCamera.position],
      target: [...state.editorCamera.target],
      rotation: [...state.editorCamera.rotation],
      mode: state.editorCamera.mode,
    },
    lastThumbnail: state.lastThumbnail,
  }
}
