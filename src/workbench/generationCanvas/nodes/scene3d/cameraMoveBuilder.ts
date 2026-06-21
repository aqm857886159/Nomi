// 运镜 builder：语义 spec（人话运镜）→ Scene3DState（主体假人 + 跟拍相机 + 轨迹 + 绑定）。
// 纯函数，配单测 cameraMoveBuilder.test.ts。相机绑到轨迹随时间走，注视固定的胸口点(静态 target，
// 主体在运镜里不动，故不设 followTargetId——见 buildCamera 注释/P0-A)。
// 见 docs/plan/2026-06-22-ai-camera-move-tool.md。
import {
  createDefaultScene3DState,
  createScene3DObjectId,
  createScene3DCameraId,
  createScene3DTrajectoryId,
  createScene3DTrajectoryPointId,
  createScene3DTrajectoryBindingId,
} from './scene3dSerializer'
import { cameraLookAtRotation } from './scene3dMath'
import {
  MANNEQUIN_DEFAULT_SCALE,
  MANNEQUIN_POSE_PRESETS,
  ROLE_COLOR_SEQUENCE,
} from './scene3dConstants'
import type {
  Scene3DState,
  Scene3DObject,
  Scene3DCamera,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from './scene3dTypes'
import {
  CAMERA_MOVE_FRAMING,
  CAMERA_SPEED_DURATION,
  CAMERA_MOVE_LABEL,
  type CameraMove,
  type CameraSpeed,
  type StagingShot,
} from './cameraMoveVocab'
import { ENV_PRESET } from './stagingVocab'

const DEG = Math.PI / 180
const FEET_Y = MANNEQUIN_DEFAULT_SCALE[1] * 0.5
// 相机眼高与注视点高度（主体约 2.5 高，眼/胸口区间）。
const EYE_Y = 1.45
const SUBJECT_TARGET_Y = 1.35

export type CameraMoveSpec = {
  move: CameraMove
  speed?: CameraSpeed
  shot?: StagingShot
  subjectPose?: string
}

// 各运镜的相机路径点（世界坐标位置）。相机靠静态 target 注视主体胸口，故只需定义位置。
// 主体在原点；d = 该景别水平距离，h = 眼高。
function cameraPathPoints(move: CameraMove, d: number, h: number): Scene3DVector3[] {
  switch (move) {
    case 'push_in':
      return [
        [0, h, d * 1.8],
        [0, h, d],
      ]
    case 'pull_out':
      return [
        [0, h, d],
        [0, h, d * 1.8],
      ]
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
      return [
        [d * 0.9, h, d],
        [d * 0.45, h, d],
        [0, h, d],
        [-d * 0.45, h, d],
        [-d * 0.9, h, d],
      ]
    case 'track_right':
      return [
        [-d * 0.9, h, d],
        [-d * 0.45, h, d],
        [0, h, d],
        [d * 0.45, h, d],
        [d * 0.9, h, d],
      ]
    default:
      return [
        [0, h, d],
        [0, h, d],
      ]
  }
}

// 绕原点的圆弧：从方位角 0（即 [0,h,d]）扫到 ±sweepDeg。sign +1 = 逆时针（azimuth 增）。
function orbitPoints(d: number, h: number, count: number, sweepDeg: number, sign: number): Scene3DVector3[] {
  return Array.from({ length: count }, (_, i) => {
    const az = sign * (i / (count - 1)) * sweepDeg * DEG
    return [Math.sin(az) * d, h, Math.cos(az) * d] as Scene3DVector3
  })
}

// 升降镜：在主体前方（距离 d）沿 Y 上升/下降，静态 target 让相机自动俯/仰看主体胸口。
function cranePoints(d: number, h: number, sign: number): Scene3DVector3[] {
  const lowY = h * 0.5
  const highY = h * 3.0
  const yStart = sign > 0 ? lowY : highY
  const yEnd = sign > 0 ? highY : lowY
  const count = 5
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return [0, yStart + (yEnd - yStart) * t, d] as Scene3DVector3
  })
}

function buildSubject(spec: CameraMoveSpec): Scene3DObject {
  const preset = spec.subjectPose
    ? MANNEQUIN_POSE_PRESETS.find((item) => item.id === spec.subjectPose)
    : undefined
  return {
    id: createScene3DObjectId(),
    name: '主体',
    type: 'mannequin',
    visible: true,
    position: [0, FEET_Y, 0],
    rotation: [0, 0, 0],
    scale: [...MANNEQUIN_DEFAULT_SCALE] as Scene3DVector3,
    color: ROLE_COLOR_SEQUENCE[0],
    pose: preset?.pose,
  }
}

function buildTrajectory(move: CameraMove, points: Scene3DVector3[]): Scene3DTrajectory {
  const trajectoryPoints: Scene3DTrajectoryPoint[] = points.map((position) => ({
    id: createScene3DTrajectoryPointId(),
    position: [...position] as Scene3DVector3,
  }))
  return {
    id: createScene3DTrajectoryId(),
    name: CAMERA_MOVE_LABEL[move],
    points: trajectoryPoints,
    tension: 0.5,
    closed: false,
    color: ROLE_COLOR_SEQUENCE[2],
  }
}

function buildCamera(shot: StagingShot, startPosition: Scene3DVector3): Scene3DCamera {
  const framing = CAMERA_MOVE_FRAMING[shot]
  const target: Scene3DVector3 = [0, SUBJECT_TARGET_Y, 0]
  return {
    id: createScene3DCameraId(),
    name: '运镜机位',
    visible: true,
    position: [...startPosition] as Scene3DVector3,
    rotation: cameraLookAtRotation(startPosition, target),
    target,
    // 注意:**不设 followTargetId**。主体在运镜里是静止的(只有相机绑轨迹动),
    // 若 followTargetId=主体,播放时注视点会被加上主体半身高 → 落到头顶(Y≈2.5)而非授权的胸口
    // [0,1.35,0],把全身裁出框(P0-A 根因)。留空 → cameraWithPlaybackPosition 回落到静态 target。
    followTargetId: undefined,
    fov: framing.fov,
    aspectRatio: '16:9',
    lensDepth: 0,
    near: 0.1,
    far: 200,
  }
}

function buildBinding(cameraId: string, trajectoryId: string, duration: number): Scene3DTrajectoryBinding {
  return {
    id: createScene3DTrajectoryBindingId(),
    trajectoryId,
    objects: [{ objectId: cameraId, offsetRatio: 0 }],
    startTime: 0,
    endTime: duration,
    direction: 'forward',
  }
}

export function buildCameraMoveScene(spec: CameraMoveSpec): Scene3DState {
  const base = createDefaultScene3DState()
  const shot: StagingShot = spec.shot ?? 'medium'
  const duration = CAMERA_SPEED_DURATION[spec.speed ?? 'medium']
  const framing = CAMERA_MOVE_FRAMING[shot]

  const subject = buildSubject(spec)
  const points = cameraPathPoints(spec.move, framing.distance, EYE_Y)
  const trajectory = buildTrajectory(spec.move, points)
  const camera = buildCamera(shot, points[0])
  const binding = buildBinding(camera.id, trajectory.id, duration)
  const env = ENV_PRESET.studio

  return {
    ...base,
    objects: [subject],
    cameras: [camera],
    trajectories: [trajectory],
    trajectoryBindings: [binding],
    trajectoryGroups: [],
    sceneTimeline: { totalDuration: duration },
    environment: {
      ...base.environment,
      backgroundColor: env.backgroundColor,
      showSky: env.showSky,
      darkMode: env.darkMode,
      showGrid: false,
      showAxes: false,
    },
    editorCamera: {
      position: camera.position,
      target: camera.target ?? [0, SUBJECT_TARGET_Y, 0],
      rotation: camera.rotation,
      mode: 'edit',
    },
  }
}
