import {
  SCENE3D_ASPECT_OPTIONS,
  type Scene3DAspectRatio,
  type Scene3DCamera,
  type Scene3DControlMode,
  type Scene3DEnvironmentMode,
  type Scene3DGeometry,
  type Scene3DLightType,
  type Scene3DObject,
  type Scene3DPoseKeyframe,
  type Scene3DPropKind,
  type Scene3DState,
  type Scene3DTrajectory,
  type Scene3DTrajectoryBinding,
  type Scene3DTrajectoryCurveControl,
  type Scene3DTrajectoryDirection,
  type Scene3DTrajectoryGroup,
  type Scene3DTrajectoryPoint,
  type Scene3DVector3,
} from './scene3dTypes'
import { buildPoseTrack } from './scene3dPoseTrack'
import { cameraAimBindingId } from './scene3dBindingIds'
import { fitEditorCameraToScene } from './scene3dFitView'

const GEOMETRIES = new Set<Scene3DGeometry>(['box', 'sphere', 'cylinder', 'plane'])
// 道具 kind 白名单（与 scene3dProps 的 spec 表同域；这里手列避免 serializer 拖进 React/three 依赖）。
const PROP_KIND_SET = new Set<Scene3DPropKind>(['car', 'building', 'tree', 'streetlamp', 'wall'])
const LIGHT_TYPES = new Set<Scene3DLightType>(['point', 'directional', 'spot'])
// 从比值表派生，不再手写第二份清单（新增画幅只改 SCENE3D_ASPECT_RATIOS 一处）。
const ASPECT_RATIOS = new Set<Scene3DAspectRatio>(SCENE3D_ASPECT_OPTIONS)
const CONTROL_MODES = new Set<Scene3DControlMode>(['edit', 'fly'])
const ENVIRONMENT_MODES = new Set<Scene3DEnvironmentMode>(['panorama', 'sphere'])
const TRAJECTORY_DIRECTIONS = new Set<Scene3DTrajectoryDirection>(['forward', 'reverse'])
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const SCENE3D_LOCAL_ASSET_URL_PATTERN = /^(nomi-local:\/\/|data:image\/|https?:\/\/)/i
const MANNEQUIN_DEFAULT_SCALE: Scene3DVector3 = [2.5, 2.5, 2.5]
const ROLE_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e'] as const
const CROWD_MAX_AXIS = 10
const DEFAULT_SCENE_TIMELINE_DURATION = 10

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

function assetUrlValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return SCENE3D_LOCAL_ASSET_URL_PATTERN.test(trimmed) ? trimmed : undefined
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

function poseTrackValue(value: unknown): Scene3DPoseKeyframe[] | undefined {
  if (!Array.isArray(value)) return undefined
  const events = value.flatMap((raw) => {
    const record = asRecord(raw)
    const time = finiteNumber(record.time, Number.NaN)
    if (!Number.isFinite(time) || time < 0) return []
    return [{
      time,
      presetId: typeof record.presetId === 'string' ? record.presetId : undefined,
      pose: poseValue(record.pose),
    }]
  })
  if (events.length === 0) return undefined
  // 经 buildPoseTrack 归一（排序 + 塌合 + clone），坏/乱序持久数据也收敛成 canonical form。
  const track = buildPoseTrack(events)
  return track.length > 0 ? track : undefined
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

export function createScene3DTrajectoryId(): string {
  return createScene3DId('scene3d-trajectory')
}

export function createScene3DTrajectoryPointId(): string {
  return createScene3DId('scene3d-trajectory-point')
}

export function createScene3DTrajectoryBindingId(): string {
  return createScene3DId('scene3d-trajectory-binding')
}

export function createScene3DTrajectoryGroupId(): string {
  return createScene3DId('scene3d-trajectory-group')
}

export function createDefaultScene3DState(): Scene3DState {
  const objects: Scene3DState['objects'] = [
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
  ]
  const cameras: Scene3DState['cameras'] = [
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
  ]
  return {
    objects,
    cameras,
    trajectories: [],
    trajectoryBindings: [],
    trajectoryGroups: [],
    sceneTimeline: {
      totalDuration: DEFAULT_SCENE_TIMELINE_DURATION,
    },
    environment: {
      preset: 'city',
      showGrid: true,
      showAxes: true,
      showSky: false,
      darkMode: false,
      backgroundColor: '#f6f3ee',
      panoramaRotation: 0,
      environmentMode: 'panorama',
      sphereRadius: 50,
    },
    editorCamera: {
      // 出厂机位 = 看全场取景（相机1 也要在画面里，见 scene3dFitView 与用户 2026-07-20 反馈）
      ...fitEditorCameraToScene(objects, cameras),
      rotation: [0, 0, 0],
      mode: 'edit',
    },
  }
}

function normalizeObject(value: unknown, index: number): Scene3DObject | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const rawPropKind = PROP_KIND_SET.has(raw.propKind as Scene3DPropKind) ? raw.propKind as Scene3DPropKind : undefined
  // prop 但 kind 不认识 → 降级 mesh 盒（渲染器有得渲，不整对象丢弃）。
  const type = raw.type === 'mannequin' || raw.type === 'mannequinCrowd' || raw.type === 'model' || raw.type === 'light' || raw.type === 'group' || (raw.type === 'prop' && rawPropKind)
    ? raw.type as Scene3DObject['type']
    : 'mesh'
  const geometry = GEOMETRIES.has(raw.geometry as Scene3DGeometry) ? raw.geometry as Scene3DGeometry : 'box'
  const lightType = LIGHT_TYPES.has(raw.lightType as Scene3DLightType) ? raw.lightType as Scene3DLightType : 'point'
  return {
    id,
    name: stringValue(raw.name, `${type === 'light' ? '灯光' : '对象'}${index + 1}`),
    type,
    visible: raw.visible !== false,
    // prop 的 origin 在地面中心 → 默认落 y=0 贴地。
    position: finiteVector(raw.position, [0, type === 'mesh' ? 0.5 : (type === 'mannequin' || type === 'mannequinCrowd') ? MANNEQUIN_DEFAULT_SCALE[1] * 0.5 : 0, 0]),
    rotation: finiteVector(raw.rotation, [0, 0, 0]),
    scale: finiteVector(raw.scale, (type === 'mannequin' || type === 'mannequinCrowd') ? MANNEQUIN_DEFAULT_SCALE : [1, 1, 1]),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : undefined,
    color: colorValue(raw.color, '#808080'),
    geometry,
    propKind: type === 'prop' ? rawPropKind : undefined,
    modelUrl: typeof raw.modelUrl === 'string' ? raw.modelUrl : undefined,
    lightType,
    lightColor: colorValue(raw.lightColor, '#ffffff'),
    lightIntensity: Math.max(0, finiteNumber(raw.lightIntensity, 2)),
    crowdRows: Math.min(CROWD_MAX_AXIS, Math.max(1, finiteInteger(raw.crowdRows, 1))),
    crowdColumns: Math.min(CROWD_MAX_AXIS, Math.max(1, finiteInteger(raw.crowdColumns, 1))),
    crowdSpacing: Math.min(10, Math.max(0.2, finiteNumber(raw.crowdSpacing, 1.2))),
    pose: poseValue(raw.pose),
    poseTrack: poseTrackValue(raw.poseTrack),
    locomotionClip: typeof raw.locomotionClip === 'string' ? raw.locomotionClip : undefined,
    children: Array.isArray(raw.children) ? raw.children.filter((id): id is string => typeof id === 'string') : undefined,
  }
}

function normalizeCamera(value: unknown, index: number): Scene3DCamera | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const followTargetId = stringValue(raw.followTargetId, '')
  return {
    id,
    name: stringValue(raw.name, `相机${index + 1}`),
    visible: raw.visible !== false,
    position: finiteVector(raw.position, [4, 2.4, 5]),
    rotation: finiteVector(raw.rotation, [-0.35, 0.65, 0]),
    target: finiteVector(raw.target, [0, 0.75, 0]),
    followTargetId: followTargetId || undefined,
    // fov 下限 6：焦段 200mm 长焦 ↔ 竖直 fov≈6.9°（scene3dMath 焦段换算）。
    fov: Math.min(120, Math.max(6, finiteNumber(raw.fov, 45))),
    aspectRatio: ASPECT_RATIOS.has(raw.aspectRatio as Scene3DAspectRatio) ? raw.aspectRatio as Scene3DAspectRatio : '16:9',
    lensDepth: Math.min(100, Math.max(-100, finiteNumber(raw.lensDepth, 0))),
    near: Math.max(0.01, finiteNumber(raw.near, 0.1)),
    far: Math.max(1, finiteNumber(raw.far, 200)),
    // 相机运镜 take 的「瞄准轨迹」标志：原样保留，是否指向真实轨迹在下方 normalizeScene3DState
    // 统一校验（与 followTargetId 同批处理——那时 trajectoryIds 才算出）。缺省不落字段。
    ...(stringValue(raw.aimTrajectoryId, '') ? { aimTrajectoryId: stringValue(raw.aimTrajectoryId, '') } : {}),
    // 手持抖动 0-100；0/缺省不落字段（老快照字节不变）。
    ...(finiteNumber(raw.shakeAmplitude, 0) > 0
      ? { shakeAmplitude: Math.min(100, Math.max(0, finiteNumber(raw.shakeAmplitude, 0))) }
      : {}),
  }
}

function normalizeTrajectoryPoint(value: unknown): Scene3DTrajectoryPoint | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const timeRatio = finiteNumber(raw.timeRatio, Number.NaN)
  return {
    id,
    position: finiteVector(raw.position, [0, 0, 0]),
    timeRatio: Number.isFinite(timeRatio) ? Math.min(1, Math.max(0, timeRatio)) : undefined,
  }
}

function normalizeTrajectoryCurveControl(value: unknown, pointIds: Set<string>): Scene3DTrajectoryCurveControl | null {
  const raw = asRecord(value)
  const segmentStartPointId = stringValue(raw.segmentStartPointId, '')
  if (!pointIds.has(segmentStartPointId)) return null
  return {
    segmentStartPointId,
    position: finiteVector(raw.position, [0, 0, 0]),
  }
}

function normalizeTrajectory(value: unknown, index: number): Scene3DTrajectory | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const points = Array.isArray(raw.points)
    ? raw.points.flatMap((item) => {
      const point = normalizeTrajectoryPoint(item)
      return point ? [point] : []
    })
    : []
  const pointIds = new Set(points.map((point) => point.id))
  const curveControls = Array.isArray(raw.curveControls)
    ? raw.curveControls.flatMap((item) => {
      const control = normalizeTrajectoryCurveControl(item, pointIds)
      return control ? [control] : []
    })
    : []
  return {
    id,
    name: stringValue(raw.name, `轨迹${index + 1}`),
    points,
    curveControls,
    tension: Math.min(1, Math.max(0, finiteNumber(raw.tension, 0.5))),
    closed: raw.closed === true,
    color: colorValue(raw.color, ROLE_COLOR_SEQUENCE[index % ROLE_COLOR_SEQUENCE.length]),
  }
}

function normalizeTrajectoryBinding(
  value: unknown,
  trajectoryIds: Set<string>,
  bindableNodeIds: Set<string>,
): Scene3DTrajectoryBinding | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  const trajectoryId = stringValue(raw.trajectoryId, '')
  if (!id || !trajectoryIds.has(trajectoryId)) return null
  const objects = Array.isArray(raw.objects)
    ? raw.objects.flatMap((item) => {
      const boundObject = asRecord(item)
      const objectId = stringValue(boundObject.objectId, '')
      if (!bindableNodeIds.has(objectId)) return []
      return [{
        objectId,
        offsetRatio: Math.min(0.999, Math.max(-0.999, finiteNumber(boundObject.offsetRatio, 0))),
      }]
    })
    : []
  const startTime = Math.max(0, finiteNumber(raw.startTime, 0))
  const binding: Scene3DTrajectoryBinding = {
    id,
    trajectoryId,
    objects,
    startTime,
    endTime: Math.max(startTime + 0.001, finiteNumber(raw.endTime, startTime + 3)),
    direction: TRAJECTORY_DIRECTIONS.has(raw.direction as Scene3DTrajectoryDirection)
      ? raw.direction as Scene3DTrajectoryDirection
      : 'forward',
  }
  // FOV 渐变端点：可选，clamp 与相机 fov 同域（6-120）；非有限值当缺省（老数据零迁移）。
  if (Number.isFinite(raw.fovFrom as number)) binding.fovFrom = Math.min(120, Math.max(6, raw.fovFrom as number))
  if (Number.isFinite(raw.fovTo as number)) binding.fovTo = Math.min(120, Math.max(6, raw.fovTo as number))
  return binding
}

function normalizeTrajectoryGroup(value: unknown, index: number, trajectoryIds: Set<string>, usedTrajectoryIds: Set<string>): Scene3DTrajectoryGroup | null {
  const raw = asRecord(value)
  const id = stringValue(raw.id, '')
  if (!id) return null
  const groupTrajectoryIds = Array.isArray(raw.trajectoryIds)
    ? raw.trajectoryIds.filter((trajectoryId): trajectoryId is string => {
      if (typeof trajectoryId !== 'string' || !trajectoryIds.has(trajectoryId) || usedTrajectoryIds.has(trajectoryId)) return false
      usedTrajectoryIds.add(trajectoryId)
      return true
    })
    : []
  return {
    id,
    name: stringValue(raw.name, `组${index + 1}`),
    trajectoryIds: groupTrajectoryIds,
  }
}

export function normalizeScene3DState(value: unknown): Scene3DState {
  const fallback = createDefaultScene3DState()
  const raw = asRecord(value)
  const environment = asRecord(raw.environment)
  const editorCamera = asRecord(raw.editorCamera)
  const sceneTimeline = asRecord(raw.sceneTimeline)
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
  const trajectories = Array.isArray(raw.trajectories)
    ? raw.trajectories.flatMap((item, index) => {
      const trajectory = normalizeTrajectory(item, index)
      return trajectory ? [trajectory] : []
    })
    : []
  const trajectoryIds = new Set(trajectories.map((trajectory) => trajectory.id))
  const objectIds = new Set(objects.map((object) => object.id))
  // followTargetId 指向已删物体、aimTrajectoryId 指向已删轨迹 → 清掉（悬空引用不留）。
  const camerasWithValidRefs = cameras.map((camera) => {
    let next = camera
    if (camera.followTargetId && !objectIds.has(camera.followTargetId)) next = { ...next, followTargetId: undefined }
    if (camera.aimTrajectoryId && !trajectoryIds.has(camera.aimTrajectoryId)) next = { ...next, aimTrajectoryId: undefined }
    return next
  })
  const cameraIdList = camerasWithValidRefs.map((camera) => camera.id)
  const cameraIds = new Set(cameraIdList)
  // 相机运镜 take 的 aim 绑定用合成 objectId `${camId}:aim`（非真实节点）——把它们一并列入
  // 可绑 id，否则 normalizeTrajectoryBinding 会把 aim 绑定的对象过滤空，回放时相机朝向退化到静态 target。
  const bindableNodeIds = new Set([...objectIds, ...cameraIds, ...cameraIdList.map((id) => cameraAimBindingId(id))])
  const normalizedTrajectoryBindings = Array.isArray(raw.trajectoryBindings)
    ? raw.trajectoryBindings.flatMap((item) => {
      const binding = normalizeTrajectoryBinding(item, trajectoryIds, bindableNodeIds)
      return binding ? [binding] : []
    })
    : []
  const usedTrajectoryObjectIds = new Set<string>()
  const trajectoryBindings = normalizedTrajectoryBindings.map((binding) => {
    const objects = binding.objects.filter((boundObject) => {
      if (usedTrajectoryObjectIds.has(boundObject.objectId)) return false
      usedTrajectoryObjectIds.add(boundObject.objectId)
      return true
    })
    return objects.length === binding.objects.length ? binding : { ...binding, objects }
  })
  const usedGroupedTrajectoryIds = new Set<string>()
  const trajectoryGroups = Array.isArray(raw.trajectoryGroups)
    ? raw.trajectoryGroups.flatMap((item, index) => {
      const group = normalizeTrajectoryGroup(item, index, trajectoryIds, usedGroupedTrajectoryIds)
      return group ? [group] : []
    })
    : []
  const totalDuration = finiteNumber(sceneTimeline.totalDuration, DEFAULT_SCENE_TIMELINE_DURATION)

  return {
    objects,
    cameras: camerasWithValidRefs,
    trajectories,
    trajectoryBindings,
    trajectoryGroups,
    sceneTimeline: {
      totalDuration: totalDuration > 0 ? totalDuration : DEFAULT_SCENE_TIMELINE_DURATION,
    },
    environment: {
      preset: stringValue(environment.preset, fallback.environment.preset),
      showGrid: environment.showGrid !== false,
      showAxes: environment.showAxes !== false,
      showSky: environment.showSky === true,
      darkMode: environment.darkMode === true,
      backgroundColor: colorValue(environment.backgroundColor, fallback.environment.backgroundColor),
      panoramaUrl: assetUrlValue(environment.panoramaUrl),
      panoramaFileName: typeof environment.panoramaFileName === 'string' && environment.panoramaFileName.trim()
        ? environment.panoramaFileName.trim()
        : undefined,
      panoramaRotation: finiteNumber(environment.panoramaRotation, fallback.environment.panoramaRotation),
      environmentMode: ENVIRONMENT_MODES.has(environment.environmentMode as Scene3DEnvironmentMode)
        ? environment.environmentMode as Scene3DEnvironmentMode
        : fallback.environment.environmentMode,
      sphereRadius: Math.min(200, Math.max(10, finiteNumber(environment.sphereRadius, fallback.environment.sphereRadius))),
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
      poseTrack: object.poseTrack ? object.poseTrack.map((keyframe) => ({
        time: keyframe.time,
        presetId: keyframe.presetId,
        pose: keyframe.pose ? Object.fromEntries(Object.entries(keyframe.pose).map(([boneName, rotation]) => [boneName, [...rotation] as Scene3DVector3])) : undefined,
      })) : undefined,
      children: object.children ? [...object.children] : undefined,
    })),
    cameras: state.cameras.map((camera) => ({
      ...camera,
      position: [...camera.position],
      rotation: [...camera.rotation],
      target: [...(camera.target || [0, 0.75, 0] as Scene3DVector3)],
    })),
    trajectories: state.trajectories.map((trajectory) => ({
      ...trajectory,
      points: trajectory.points.map((point) => ({
        ...point,
        position: [...point.position],
        timeRatio: point.timeRatio,
      })),
      curveControls: trajectory.curveControls?.map((control) => ({
        ...control,
        position: [...control.position],
      })),
    })),
    trajectoryBindings: state.trajectoryBindings.map((binding) => ({
      ...binding,
      objects: binding.objects.map((object) => ({ ...object })),
    })),
    trajectoryGroups: state.trajectoryGroups.map((group) => ({
      ...group,
      trajectoryIds: [...group.trajectoryIds],
    })),
    sceneTimeline: { ...state.sceneTimeline },
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
