// 运镜预设「应用到现有相机」：按当前机位/拍摄目标就地生成一段轨迹 + 时间轴绑定，
// 追加到场景时间线末尾（连点即串联多段）。与 cameraMoveBuilder.ts（AI 从零建标准场景）
// 是同一词表的两个锚定方式：builder 锚「原点主体的标准景别」，本模块锚「用户摆好的当前机位」
// ——路径形状极小、锚点语义不同，唯一有厚度的 FOV 数学（变焦族）收口在本文件供两边共用。
// 纯函数，配单测 cameraMovePreset.test.ts。见 docs/plan/2026-07-03-scene3d-director-upgrade.md。
import {
  createScene3DTrajectoryId,
  createScene3DTrajectoryPointId,
  createScene3DTrajectoryBindingId,
} from './scene3dSerializer'
import { ROLE_COLOR_SEQUENCE } from './scene3dConstants'
import { CAMERA_MOVE_LABEL, type CameraMove } from './cameraMoveVocab'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DVector3,
} from './scene3dTypes'

const DEG = Math.PI / 180

export type CameraMovePresetSpec = {
  move: CameraMove
  /** 秒，clamp 到 1-12（Seedance 甜区外仍可预演） */
  duration: number
  /** 0.1-1，1 = 词表满幅（环绕 300°、推近到 0.56 倍距离…） */
  amplitude: number
}

export type CameraMovePresetResult = {
  state: Scene3DState
  trajectoryId: string
  bindingId: string
  startTime: number
  endTime: number
}

export const CAMERA_MOVE_DURATION_MIN = 1
export const CAMERA_MOVE_DURATION_MAX = 12
export const CAMERA_MOVE_AMPLITUDE_MIN = 0.1
export const CAMERA_MOVE_AMPLITUDE_MAX = 1

// ── FOV 数学（变焦族唯一真相源，builder 也从这里取）─────────────────────────

const FOV_MIN = 12
const FOV_MAX = 120

function clampFov(value: number): number {
  return Math.min(FOV_MAX, Math.max(FOV_MIN, Number(value.toFixed(2))))
}

/** 希区柯克补偿：机位距离乘 distanceScale 后，保持主体成像高度不变所需的 fov。 */
export function dollyZoomCompensatedFov(baseFov: number, distanceScale: number): number {
  const half = Math.tan((baseFov / 2) * DEG) / Math.max(0.01, distanceScale)
  return clampFov((Math.atan(half) * 2) / DEG)
}

/** 希区柯克的机位后拉倍率（随幅度）。 */
export function dollyZoomDistanceScale(amplitude: number): number {
  return 1 + 0.8 * amplitude
}

/** 变焦族的 fov 渐变端点。非变焦运镜返回 null（不碰 fov）。 */
export function zoomFovRamp(
  move: CameraMove,
  baseFov: number,
  amplitude: number,
): { fovFrom: number; fovTo: number } | null {
  switch (move) {
    case 'zoom_in':
      return { fovFrom: clampFov(baseFov), fovTo: clampFov(baseFov * (1 - 0.55 * amplitude)) }
    case 'zoom_out':
      return { fovFrom: clampFov(baseFov), fovTo: clampFov(baseFov * (1 + 1.0 * amplitude)) }
    case 'dolly_zoom':
      return {
        fovFrom: clampFov(baseFov),
        fovTo: dollyZoomCompensatedFov(baseFov, dollyZoomDistanceScale(amplitude)),
      }
    default:
      return null
  }
}

// ── 路径几何（世界坐标，起点恒为当前机位——应用预设绝不跳机位）──────────────

type MoveBasis = {
  position: Scene3DVector3
  target: Scene3DVector3
  /** 机位相对目标的水平距离（下限 0.1，正上方俯拍时退化为小半径） */
  horizontalDistance: number
  /** 机位相对目标的水平方位角（atan2(dx, dz)，与 builder 的 orbit 参数化同向） */
  azimuth: number
}

function moveBasis(position: Scene3DVector3, target: Scene3DVector3): MoveBasis {
  const dx = position[0] - target[0]
  const dz = position[2] - target[2]
  return {
    position,
    target,
    horizontalDistance: Math.max(0.1, Math.hypot(dx, dz)),
    azimuth: Math.atan2(dx, dz),
  }
}

function orbitPoint(basis: MoveBasis, azimuth: number): Scene3DVector3 {
  return [
    basis.target[0] + Math.sin(azimuth) * basis.horizontalDistance,
    basis.position[1],
    basis.target[2] + Math.cos(azimuth) * basis.horizontalDistance,
  ]
}

function orbitArcPoints(basis: MoveBasis, sweepDeg: number, sign: number, count: number): Scene3DVector3[] {
  return Array.from({ length: count }, (_, index) => (
    orbitPoint(basis, basis.azimuth + sign * (index / (count - 1)) * sweepDeg * DEG)
  ))
}

/** 沿「机位→目标」全 3D 视线缩放距离（推近/拉远/希区柯克的机位路径）。 */
function scaledDistancePoint(basis: MoveBasis, scale: number): Scene3DVector3 {
  return [
    basis.target[0] + (basis.position[0] - basis.target[0]) * scale,
    basis.target[1] + (basis.position[1] - basis.target[1]) * scale,
    basis.target[2] + (basis.position[2] - basis.target[2]) * scale,
  ]
}

/** 相机自身屏幕右方向（水平面内，up=+Y）。 */
function screenRight(basis: MoveBasis): Scene3DVector3 {
  // forward（水平）= target - position 归一；right = forward × up。
  const fx = -Math.sin(basis.azimuth)
  const fz = -Math.cos(basis.azimuth)
  return [-fz, 0, fx]
}

function translatedPoints(basis: MoveBasis, direction: Scene3DVector3, travel: number, count: number): Scene3DVector3[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index / (count - 1)) * travel
    return [
      basis.position[0] + direction[0] * t,
      basis.position[1] + direction[1] * t,
      basis.position[2] + direction[2] * t,
    ] as Scene3DVector3
  })
}

/** 变焦族机位不动：第二个点给 2mm epsilon，避免零长曲线的退化采样。 */
function staticPoints(basis: MoveBasis): Scene3DVector3[] {
  const fx = -Math.sin(basis.azimuth) * 0.002
  const fz = -Math.cos(basis.azimuth) * 0.002
  return [
    [...basis.position] as Scene3DVector3,
    [basis.position[0] + fx, basis.position[1], basis.position[2] + fz],
  ]
}

export function cameraMovePresetPathPoints(
  move: CameraMove,
  position: Scene3DVector3,
  target: Scene3DVector3,
  amplitude: number,
): Scene3DVector3[] {
  const basis = moveBasis(position, target)
  switch (move) {
    case 'push_in':
      // a=1 时推到 0.556 倍距离（与 builder 1.8d→d 的比例一致），下限 0.15 防穿目标。
      return [
        [...position] as Scene3DVector3,
        scaledDistancePoint(basis, Math.max(0.15, 1 - 0.444 * amplitude)),
      ]
    case 'pull_out':
      return [
        [...position] as Scene3DVector3,
        scaledDistancePoint(basis, 1 + 0.8 * amplitude),
      ]
    case 'orbit_left':
      return orbitArcPoints(basis, Math.max(20, 300 * amplitude), +1, 9)
    case 'orbit_right':
      return orbitArcPoints(basis, Math.max(20, 300 * amplitude), -1, 9)
    case 'arc_left':
      return orbitArcPoints(basis, Math.max(15, 90 * amplitude), +1, 5)
    case 'arc_right':
      return orbitArcPoints(basis, Math.max(15, 90 * amplitude), -1, 5)
    case 'crane_up': {
      const rise = 2.0 * Math.max(basis.position[1], 1.0) * amplitude
      return translatedPoints(basis, [0, 1, 0], rise, 2)
    }
    case 'crane_down': {
      // 末端先钳到 0.25 地板，再保证最小 1mm 行程避免零长曲线（已贴地时近似原地）。
      const yEnd = Math.min(
        basis.position[1] - 0.001,
        Math.max(0.25, basis.position[1] - 0.75 * Math.max(basis.position[1], 1.0) * amplitude),
      )
      return translatedPoints(basis, [0, -1, 0], basis.position[1] - yEnd, 2)
    }
    case 'track_left': {
      const right = screenRight(basis)
      return translatedPoints(basis, [-right[0], 0, -right[2]], 1.2 * basis.horizontalDistance * amplitude, 3)
    }
    case 'track_right':
      return translatedPoints(basis, screenRight(basis), 1.2 * basis.horizontalDistance * amplitude, 3)
    case 'zoom_in':
    case 'zoom_out':
      return staticPoints(basis)
    case 'dolly_zoom':
      return [
        [...position] as Scene3DVector3,
        scaledDistancePoint(basis, dollyZoomDistanceScale(amplitude)),
      ]
    default:
      return staticPoints(basis)
  }
}

// ── 应用：轨迹 + 绑定追加到时间轴末尾 ─────────────────────────────────────

function roundedPoint(point: Scene3DVector3): Scene3DVector3 {
  return [Number(point[0].toFixed(4)), Number(point[1].toFixed(4)), Number(point[2].toFixed(4))]
}

export function nextCameraMoveStartTime(state: Pick<Scene3DState, 'trajectoryBindings'>): number {
  return state.trajectoryBindings.reduce((latest, binding) => Math.max(latest, binding.endTime), 0)
}

export function applyCameraMovePreset(
  state: Scene3DState,
  cameraId: string,
  spec: CameraMovePresetSpec,
): CameraMovePresetResult | null {
  const camera = state.cameras.find((candidate) => candidate.id === cameraId)
  if (!camera) return null

  const duration = Math.min(CAMERA_MOVE_DURATION_MAX, Math.max(CAMERA_MOVE_DURATION_MIN, spec.duration))
  const amplitude = Math.min(CAMERA_MOVE_AMPLITUDE_MAX, Math.max(CAMERA_MOVE_AMPLITUDE_MIN, spec.amplitude))
  const points = cameraMovePresetPathPoints(spec.move, camera.position, camera.target, amplitude)
  if (points.length < 2) return null

  const trajectory: Scene3DTrajectory = {
    id: createScene3DTrajectoryId(),
    name: CAMERA_MOVE_LABEL[spec.move],
    points: points.map((position) => ({
      id: createScene3DTrajectoryPointId(),
      position: roundedPoint(position),
    })),
    tension: 0.5,
    closed: false,
    color: ROLE_COLOR_SEQUENCE[2],
  }

  const startTime = nextCameraMoveStartTime(state)
  const endTime = startTime + duration
  const ramp = zoomFovRamp(spec.move, camera.fov, amplitude)
  const binding: Scene3DTrajectoryBinding = {
    id: createScene3DTrajectoryBindingId(),
    trajectoryId: trajectory.id,
    objects: [{ objectId: cameraId, offsetRatio: 0 }],
    startTime,
    endTime,
    direction: 'forward',
    ...(ramp ? { fovFrom: ramp.fovFrom, fovTo: ramp.fovTo } : {}),
  }

  return {
    state: {
      ...state,
      trajectories: [...state.trajectories, trajectory],
      trajectoryBindings: [...state.trajectoryBindings, binding],
      sceneTimeline: {
        ...state.sceneTimeline,
        totalDuration: Math.max(state.sceneTimeline.totalDuration, endTime),
      },
    },
    trajectoryId: trajectory.id,
    bindingId: binding.id,
    startTime,
    endTime,
  }
}
