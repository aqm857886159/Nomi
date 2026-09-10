/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 V1（scene3d）工程数据的类型子集 Legacy* 与容错读取器 normalizeLegacyScene3D
 * [POS]: director/migration 的 V1 数据形状（只读、只为迁移与 AI 来导的旧 builder 存在）：老工程 `meta.scene3dState` 与
 *        V1 词表 builder 的产物都长这样。V1 代码已删，这里是它的化石——字段含义见 docs/plan/2026-09-03-director-cutover-gate.md §7 C2。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type LegacyVec3 = [number, number, number]

export type LegacyObjectType = 'mesh' | 'model' | 'light' | 'group' | 'mannequin' | 'mannequinCrowd' | 'prop'
export type LegacyPropKind =
  | 'car' | 'building' | 'tree' | 'streetlamp' | 'wall' | 'suv' | 'bus' | 'bicycle' | 'scooter'
  | 'sofa' | 'diningTable' | 'fridge' | 'washingMachine' | 'trashBins' | 'atm' | 'backpack'
export type LegacyGeometry = 'box' | 'sphere' | 'cylinder' | 'plane'
export type LegacyLightType = 'point' | 'directional' | 'spot'
export type LegacyAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1'

export type LegacyPoseKeyframe = { time: number; presetId?: string; pose?: Record<string, LegacyVec3> }

export type LegacyObject = {
  id: string
  name: string
  type: LegacyObjectType
  visible: boolean
  position: LegacyVec3
  rotation: LegacyVec3
  scale: LegacyVec3
  parentId?: string
  color?: string
  geometry?: LegacyGeometry
  propKind?: LegacyPropKind
  modelUrl?: string
  lightType?: LegacyLightType
  lightColor?: string
  lightIntensity?: number
  crowdRows?: number
  crowdColumns?: number
  crowdSpacing?: number
  pose?: Record<string, LegacyVec3>
  poseTrack?: LegacyPoseKeyframe[]
  locomotionClip?: string
  templateGroup?: string
}

export type LegacyCamera = {
  id: string
  name: string
  visible: boolean
  position: LegacyVec3
  rotation: LegacyVec3
  target: LegacyVec3
  followTargetId?: string
  aimTrajectoryId?: string
  fov: number
  aspectRatio: LegacyAspectRatio
  lensDepth: number
  shakeAmplitude?: number
}

export type LegacyTrajectoryPoint = { id: string; position: LegacyVec3; timeRatio?: number }
export type LegacyCurveControl = { segmentStartPointId: string; position: LegacyVec3 }
export type LegacyTrajectory = {
  id: string
  name: string
  points: LegacyTrajectoryPoint[]
  curveControls?: LegacyCurveControl[]
  tension: number
  closed: boolean
}
export type LegacyBinding = {
  id: string
  trajectoryId: string
  objects: Array<{ objectId: string; offsetRatio: number }>
  startTime: number
  endTime: number
  direction: 'forward' | 'reverse'
  fovFrom?: number
  fovTo?: number
}

export type LegacyScene3DState = {
  objects: LegacyObject[]
  cameras: LegacyCamera[]
  trajectories: LegacyTrajectory[]
  trajectoryBindings: LegacyBinding[]
  environment: {
    showGrid: boolean
    backgroundColor: string
    panoramaUrl?: string
    panoramaRotation: number
    sphereRadius: number
  }
  hasEditorCamera: boolean
  hasTrajectoryGroups: boolean
}

/** V1 默认：假人 scale 2.5、颜色序列、群众上限 */
export const LEGACY_MANNEQUIN_SCALE = 2.5
export const LEGACY_ASPECT_RATIOS: LegacyAspectRatio[] = ['16:9', '9:16', '4:3', '3:4', '1:1', '2.39:1']

const OBJECT_TYPES = new Set<LegacyObjectType>(['mesh', 'model', 'light', 'group', 'mannequin', 'mannequinCrowd', 'prop'])
const GEOMETRIES = new Set<LegacyGeometry>(['box', 'sphere', 'cylinder', 'plane'])
const LIGHT_TYPES = new Set<LegacyLightType>(['point', 'directional', 'spot'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function vec(value: unknown, fallback: LegacyVec3): LegacyVec3 {
  if (!Array.isArray(value)) return [...fallback]
  return [num(value[0], fallback[0]), num(value[1], fallback[1]), num(value[2], fallback[2])]
}

function pose(value: unknown): Record<string, LegacyVec3> | undefined {
  const record = asRecord(value)
  const entries = Object.entries(record).filter(([, rotation]) => Array.isArray(rotation))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries.map(([bone, rotation]) => [bone, vec(rotation, [0, 0, 0])]))
}

/** 老工程 meta.scene3dState → 合法的 V1 形状（逐字段容错；非法对象整条丢弃）。 */
export function normalizeLegacyScene3D(raw: unknown): LegacyScene3DState {
  const state = asRecord(raw)
  const environment = asRecord(state.environment)
  const objects: LegacyObject[] = (Array.isArray(state.objects) ? state.objects : []).flatMap((item): LegacyObject[] => {
    const record = asRecord(item)
    const id = str(record.id).trim()
    const type = record.type as LegacyObjectType
    if (!id || !OBJECT_TYPES.has(type)) return []
    const geometry = GEOMETRIES.has(record.geometry as LegacyGeometry) ? (record.geometry as LegacyGeometry) : undefined
    const lightType = LIGHT_TYPES.has(record.lightType as LegacyLightType) ? (record.lightType as LegacyLightType) : undefined
    const poseTrack = Array.isArray(record.poseTrack)
      ? record.poseTrack.flatMap((keyframe): LegacyPoseKeyframe[] => {
          const entry = asRecord(keyframe)
          const time = num(entry.time, Number.NaN)
          if (!Number.isFinite(time) || time < 0) return []
          return [{ time, presetId: str(entry.presetId) || undefined, pose: pose(entry.pose) }]
        })
      : undefined
    return [{
      id,
      name: str(record.name, id),
      type,
      visible: record.visible !== false,
      position: vec(record.position, [0, 0, 0]),
      rotation: vec(record.rotation, [0, 0, 0]),
      scale: vec(record.scale, [1, 1, 1]),
      parentId: str(record.parentId) || undefined,
      color: str(record.color) || undefined,
      geometry,
      propKind: str(record.propKind) ? (record.propKind as LegacyPropKind) : undefined,
      modelUrl: str(record.modelUrl) || undefined,
      lightType,
      lightColor: str(record.lightColor) || undefined,
      lightIntensity: typeof record.lightIntensity === 'number' ? num(record.lightIntensity, 1) : undefined,
      crowdRows: typeof record.crowdRows === 'number' ? Math.max(1, Math.round(record.crowdRows)) : undefined,
      crowdColumns: typeof record.crowdColumns === 'number' ? Math.max(1, Math.round(record.crowdColumns)) : undefined,
      crowdSpacing: typeof record.crowdSpacing === 'number' ? num(record.crowdSpacing, 0.4) : undefined,
      pose: pose(record.pose),
      poseTrack: poseTrack && poseTrack.length ? poseTrack : undefined,
      locomotionClip: str(record.locomotionClip) || undefined,
      templateGroup: str(record.templateGroup) || undefined,
    }]
  })
  const cameras: LegacyCamera[] = (Array.isArray(state.cameras) ? state.cameras : []).flatMap((item): LegacyCamera[] => {
    const record = asRecord(item)
    const id = str(record.id).trim()
    if (!id) return []
    const aspect = record.aspectRatio as LegacyAspectRatio
    return [{
      id,
      name: str(record.name, id),
      visible: record.visible !== false,
      position: vec(record.position, [0, 1.5, 5]),
      rotation: vec(record.rotation, [0, 0, 0]),
      target: vec(record.target, [0, 0.75, 0]),
      followTargetId: str(record.followTargetId) || undefined,
      aimTrajectoryId: str(record.aimTrajectoryId) || undefined,
      fov: num(record.fov, 45),
      aspectRatio: LEGACY_ASPECT_RATIOS.includes(aspect) ? aspect : '16:9',
      lensDepth: num(record.lensDepth, 0),
      shakeAmplitude: typeof record.shakeAmplitude === 'number' ? num(record.shakeAmplitude, 0) : undefined,
    }]
  })
  const trajectories: LegacyTrajectory[] = (Array.isArray(state.trajectories) ? state.trajectories : []).flatMap((item): LegacyTrajectory[] => {
    const record = asRecord(item)
    const id = str(record.id).trim()
    if (!id) return []
    const points = (Array.isArray(record.points) ? record.points : []).flatMap((point): LegacyTrajectoryPoint[] => {
      const entry = asRecord(point)
      const pointId = str(entry.id).trim()
      if (!pointId) return []
      return [{ id: pointId, position: vec(entry.position, [0, 0, 0]), timeRatio: typeof entry.timeRatio === 'number' ? num(entry.timeRatio, 0) : undefined }]
    })
    const curveControls = (Array.isArray(record.curveControls) ? record.curveControls : []).flatMap((control): LegacyCurveControl[] => {
      const entry = asRecord(control)
      const segmentStartPointId = str(entry.segmentStartPointId).trim()
      return segmentStartPointId ? [{ segmentStartPointId, position: vec(entry.position, [0, 0, 0]) }] : []
    })
    return [{ id, name: str(record.name, id), points, curveControls: curveControls.length ? curveControls : undefined, tension: num(record.tension, 0.5), closed: record.closed === true }]
  })
  const trajectoryBindings: LegacyBinding[] = (Array.isArray(state.trajectoryBindings) ? state.trajectoryBindings : []).flatMap((item): LegacyBinding[] => {
    const record = asRecord(item)
    const id = str(record.id).trim()
    const trajectoryId = str(record.trajectoryId).trim()
    if (!id || !trajectoryId) return []
    const boundObjects = (Array.isArray(record.objects) ? record.objects : []).flatMap((bound): Array<{ objectId: string; offsetRatio: number }> => {
      const entry = asRecord(bound)
      const objectId = str(entry.objectId).trim()
      return objectId ? [{ objectId, offsetRatio: num(entry.offsetRatio, 0) }] : []
    })
    return [{
      id,
      trajectoryId,
      objects: boundObjects,
      startTime: Math.max(0, num(record.startTime, 0)),
      endTime: Math.max(0, num(record.endTime, 0)),
      direction: record.direction === 'reverse' ? 'reverse' : 'forward',
      fovFrom: typeof record.fovFrom === 'number' ? num(record.fovFrom, 45) : undefined,
      fovTo: typeof record.fovTo === 'number' ? num(record.fovTo, 45) : undefined,
    }]
  })
  return {
    objects,
    cameras,
    trajectories,
    trajectoryBindings,
    environment: {
      showGrid: environment.showGrid !== false,
      backgroundColor: str(environment.backgroundColor),
      panoramaUrl: str(environment.panoramaUrl) || undefined,
      panoramaRotation: num(environment.panoramaRotation, 0),
      sphereRadius: num(environment.sphereRadius, 50),
    },
    hasEditorCamera: Boolean(state.editorCamera),
    hasTrajectoryGroups: Array.isArray(state.trajectoryGroups) && state.trajectoryGroups.length > 0,
  }
}
