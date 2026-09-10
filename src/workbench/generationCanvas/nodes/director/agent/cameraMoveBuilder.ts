/**
 * [INPUT]: 依赖 ../model/posePresets 的 MANNEQUIN_POSE_PRESETS、./cameraMoveVocab、./cameraMoveFovMath（dollyZoomDistanceScale / zoomFovRamp）、
 *          ./stagingVocab 的 ENV_PRESET、../migration/legacyScene3dTypes、../migration/legacySceneBuilders（createLegacyState / id 工厂 / lookAt / 道具 / 模板）
 * [OUTPUT]: 对外提供 CameraMoveSpec、buildCameraMoveScene
 * [POS]: director/agent 的运镜 builder（原 V1 cameraMoveBuilder，切换门入籍）：语义 spec（人话运镜）→ V1 形状场景（主体假人 + 跟拍相机 + 轨迹 + 绑定，
 *        变焦族带 fov 渐变），由 createCameraMoveReferenceNode 经迁移器落成 director 工程（绑定烘成带 fov 的路标）。
 *        相机注视固定的胸口点（静态 target，不设跟随：主体在运镜里不动）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { MANNEQUIN_POSE_PRESETS } from '../model/posePresets'
import type { LegacyBinding, LegacyCamera, LegacyObject, LegacyScene3DState, LegacyTrajectory, LegacyVec3 } from '../migration/legacyScene3dTypes'
import { LEGACY_MANNEQUIN_SCALE } from '../migration/legacyScene3dTypes'
import {
  buildPlacedProps, buildSceneTemplateObjects, createLegacyBindingId, createLegacyCameraId, createLegacyObjectId, createLegacyPointId, createLegacyState,
  createLegacyTrajectoryId, legacyCameraLookAtRotation, type LegacySceneTemplate, type ScenePropPlacement,
} from '../migration/legacySceneBuilders'
import { dollyZoomDistanceScale, zoomFovRamp } from './cameraMoveFovMath'
import { CAMERA_MOVE_FRAMING, CAMERA_MOVE_LABEL, CAMERA_SPEED_DURATION, type CameraMove, type CameraSpeed, type StagingShot } from './cameraMoveVocab'
import { ENV_PRESET } from './stagingVocab'

const DEG = Math.PI / 180
const FEET_Y = LEGACY_MANNEQUIN_SCALE * 0.5
// 相机眼高与注视点高度（主体约 2.5 高，眼 / 胸口区间）
const EYE_Y = 1.45
const SUBJECT_TARGET_Y = 1.35

export type CameraMoveSpec = {
  move: CameraMove
  speed?: CameraSpeed
  shot?: StagingShot
  subjectPose?: string
  sceneTemplate?: LegacySceneTemplate
  props?: ScenePropPlacement[]
}

// 绕原点的圆弧：从方位角 0（即 [0,h,d]）扫到 ±sweepDeg。sign +1 = 逆时针
function orbitPoints(d: number, h: number, count: number, sweepDeg: number, sign: number): LegacyVec3[] {
  return Array.from({ length: count }, (_, i) => {
    const az = sign * (i / (count - 1)) * sweepDeg * DEG
    return [Math.sin(az) * d, h, Math.cos(az) * d] as LegacyVec3
  })
}

// 升降镜：在主体前方（距离 d）沿 Y 上升 / 下降，静态 target 让相机自动俯 / 仰看主体胸口
function cranePoints(d: number, h: number, sign: number): LegacyVec3[] {
  const lowY = h * 0.5
  const highY = h * 3.0
  const yStart = sign > 0 ? lowY : highY
  const yEnd = sign > 0 ? highY : lowY
  return Array.from({ length: 5 }, (_, i) => [0, yStart + (yEnd - yStart) * (i / 4), d] as LegacyVec3)
}

// 各运镜的相机路径点（世界坐标）。主体在原点；d = 该景别水平距离，h = 眼高
function cameraPathPoints(move: CameraMove, d: number, h: number): LegacyVec3[] {
  switch (move) {
    case 'push_in':
      return [[0, h, d * 1.8], [0, h, d]]
    case 'pull_out':
      return [[0, h, d], [0, h, d * 1.8]]
    case 'orbit_left':
      return orbitPoints(d, h, 9, 300, +1)
    case 'orbit_right':
      return orbitPoints(d, h, 9, 300, -1)
    case 'arc_left':
      return orbitPoints(d, h, 5, 90, +1)
    case 'arc_right':
      return orbitPoints(d, h, 5, 90, -1)
    case 'crane_up':
      return cranePoints(d, h, +1)
    case 'crane_down':
      return cranePoints(d, h, -1)
    case 'track_left':
      return [[d * 0.9, h, d], [d * 0.45, h, d], [0, h, d], [-d * 0.45, h, d], [-d * 0.9, h, d]]
    case 'track_right':
      return [[-d * 0.9, h, d], [-d * 0.45, h, d], [0, h, d], [d * 0.45, h, d], [d * 0.9, h, d]]
    case 'zoom_in':
    case 'zoom_out':
      // 机位不动（变焦靠 fov 渐变）；第二点 2mm epsilon 避免零长曲线
      return [[0, h, d], [0, h, d + 0.002]]
    case 'dolly_zoom':
      return [[0, h, d], [0, h, d * dollyZoomDistanceScale(1)]]
    default:
      return [[0, h, d], [0, h, d + 0.002]]
  }
}

function buildSubject(spec: CameraMoveSpec): LegacyObject {
  const preset = spec.subjectPose ? MANNEQUIN_POSE_PRESETS.find((item) => item.id === spec.subjectPose) : undefined
  return {
    id: createLegacyObjectId(), name: '主体', type: 'mannequin', visible: true,
    position: [0, FEET_Y, 0], rotation: [0, 0, 0], scale: [LEGACY_MANNEQUIN_SCALE, LEGACY_MANNEQUIN_SCALE, LEGACY_MANNEQUIN_SCALE],
    color: '#ef4444', pose: preset?.pose,
  }
}

function buildTrajectory(move: CameraMove, points: LegacyVec3[]): LegacyTrajectory {
  return { id: createLegacyTrajectoryId(), name: CAMERA_MOVE_LABEL[move], points: points.map((position) => ({ id: createLegacyPointId(), position: [...position] as LegacyVec3 })), tension: 0.5, closed: false }
}

function buildCamera(shot: StagingShot, startPosition: LegacyVec3): LegacyCamera {
  const framing = CAMERA_MOVE_FRAMING[shot]
  const target: LegacyVec3 = [0, SUBJECT_TARGET_Y, 0]
  return { id: createLegacyCameraId(), name: '运镜机位', visible: true, position: [...startPosition] as LegacyVec3, rotation: legacyCameraLookAtRotation(startPosition, target), target, fov: framing.fov, aspectRatio: '16:9', lensDepth: 0 }
}

function buildBinding(cameraId: string, trajectoryId: string, duration: number, fovRamp: { fovFrom: number; fovTo: number } | null): LegacyBinding {
  return { id: createLegacyBindingId(), trajectoryId, objects: [{ objectId: cameraId, offsetRatio: 0 }], startTime: 0, endTime: duration, direction: 'forward', ...(fovRamp ? { fovFrom: fovRamp.fovFrom, fovTo: fovRamp.fovTo } : {}) }
}

export function buildCameraMoveScene(spec: CameraMoveSpec): LegacyScene3DState {
  const base = createLegacyState()
  const shot: StagingShot = spec.shot ?? 'medium'
  const duration = CAMERA_SPEED_DURATION[spec.speed ?? 'medium']
  const framing = CAMERA_MOVE_FRAMING[shot]
  const subject = buildSubject(spec)
  const points = cameraPathPoints(spec.move, framing.distance, EYE_Y)
  const trajectory = buildTrajectory(spec.move, points)
  const camera = buildCamera(shot, points[0])
  const binding = buildBinding(camera.id, trajectory.id, duration, zoomFovRamp(spec.move, framing.fov, 1))
  const templateObjects = spec.sceneTemplate ? buildSceneTemplateObjects(spec.sceneTemplate) : []
  const propObjects = buildPlacedProps(spec.props)
  return {
    ...base,
    objects: [...templateObjects, ...propObjects, subject],
    cameras: [camera],
    trajectories: [trajectory],
    trajectoryBindings: [binding],
    environment: { ...base.environment, backgroundColor: ENV_PRESET.studio.backgroundColor, showGrid: false },
  }
}
