/**
 * [INPUT]: 依赖 ./directorTypes 的 CloseupClip / Vec3 / CloseupMotionPreset、./vec3 的 rotateY/wrapDeg/DEG_TO_RAD、
 *          ./timeGrid 的 quantizeToFrame/secondsToFrame
 * [OUTPUT]: 对外提供 ANCHOR_HEIGHTS / AZIMUTH_DEGREES / TURNTABLE_PRESETS、createCloseupClip、motionOffsets、
 *           solveCloseupPose、findCloseupClipAt
 * [POS]: director/model 的「目标相对自动运镜」求解器（清单 §4.7 特写片段）：每帧按跟踪目标的当前位姿重算机位，
 *        8 种运镜预设 + 锚点/方位/朝向模式，
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CloseupAnchor, CloseupAzimuth, CloseupClip, CloseupMotionPreset, Vec3 } from './directorTypes'
import { quantizeToFrame, secondsToFrame } from './timeGrid'
import { DEG_TO_RAD, rotateY, wrapDeg } from './vec3'

// 锚点相对目标根部的高度（米）
export const ANCHOR_HEIGHTS: Record<Exclude<CloseupAnchor, 'custom'>, number> = {
  eye: 1.6,
  face: 1.5,
  chest: 1.2,
  body: 1,
  pelvis: 0.9,
  foot: 0.1,
}

export const AZIMUTH_DEGREES: Record<Exclude<CloseupAzimuth, 'custom'>, number> = {
  front: 0,
  front_left: -45,
  front_right: 45,
  left: -90,
  right: 90,
  back: 180,
}

// 这三种预设绕目标转圈，参考朝向取片段起点时目标的 yaw（否则目标转身会把环绕打乱）
export const TURNTABLE_PRESETS: ReadonlySet<CloseupMotionPreset> = new Set(['orbit', 'half_arc', 'spiral'])

export const DEFAULT_CUSTOM_ANCHOR: Vec3 = { x: 0, y: 1.5, z: 0 }
export const CLOSEUP_MIN_DISTANCE = 0.3

export type CreateCloseupClipInput = {
  id: string
  entityId: string
  targetObjectId: string
  startTime: number
  duration?: number
}

export function createCloseupClip(input: CreateCloseupClipInput): CloseupClip {
  const duration = input.duration ?? 4
  const startTime = quantizeToFrame(input.startTime)
  const endTime = quantizeToFrame(startTime + duration)
  return {
    id: input.id,
    entityId: input.entityId,
    targetObjectId: input.targetObjectId,
    startTime,
    endTime,
    startFrame: secondsToFrame(startTime),
    endFrame: secondsToFrame(endTime),
    anchor: 'face',
    facingMode: 'look_at_target',
    azimuth: 'front',
    horizontalAngle: 0,
    pitchAngle: 0,
    distance: 1.2,
    height: 0,
    motionPreset: 'static',
  }
}

export type MotionOffsets = { angleOffsetDeg: number; distanceScale: number; heightOffset: number; truckOffset: number }

// 运镜预设在进度 p∈[0,1] 时的偏移
export function motionOffsets(preset: CloseupMotionPreset, progress: number): MotionOffsets {
  const p = Math.max(0, Math.min(1, progress))
  switch (preset) {
    case 'orbit':
      return { angleOffsetDeg: p * 360, distanceScale: 1, heightOffset: 0, truckOffset: 0 }
    case 'half_arc':
      return { angleOffsetDeg: p * 180, distanceScale: 1, heightOffset: 0, truckOffset: 0 }
    case 'push_in':
      return { angleOffsetDeg: 0, distanceScale: 1 - p * 0.5, heightOffset: 0, truckOffset: 0 }
    case 'pull_out':
      return { angleOffsetDeg: 0, distanceScale: 1 + p * 0.5, heightOffset: 0, truckOffset: 0 }
    case 'crane':
      return { angleOffsetDeg: 0, distanceScale: 1, heightOffset: p * 1.5, truckOffset: 0 }
    case 'truck':
      return { angleOffsetDeg: 0, distanceScale: 1, heightOffset: 0, truckOffset: p * 1.2 }
    case 'spiral':
      return { angleOffsetDeg: p * 360, distanceScale: 1 - p * 0.3, heightOffset: p * 0.8, truckOffset: 0 }
    default:
      return { angleOffsetDeg: 0, distanceScale: 1, heightOffset: 0, truckOffset: 0 }
  }
}

export function anchorWorldPosition(clip: CloseupClip, targetPosition: Vec3): Vec3 {
  if (clip.anchor === 'custom') {
    const custom = clip.customAnchor ?? DEFAULT_CUSTOM_ANCHOR
    return { x: targetPosition.x + custom.x, y: targetPosition.y + custom.y, z: targetPosition.z + custom.z }
  }
  return { x: targetPosition.x, y: targetPosition.y + ANCHOR_HEIGHTS[clip.anchor], z: targetPosition.z }
}

export function azimuthDegrees(clip: CloseupClip): number {
  return clip.azimuth === 'custom' ? clip.customAzimuthDeg ?? 0 : AZIMUTH_DEGREES[clip.azimuth]
}

export type SolveCloseupInput = {
  clip: CloseupClip
  currentTime: number
  targetPosition: Vec3
  targetRotationY: number
  // 片段起点时目标的 yaw（转圈类预设用它当参考系）
  referenceRotationY?: number
  // manual 朝向模式下机位自己的朝向
  cameraRotation?: Vec3
}

export type SolvedCloseupPose = {
  position: Vec3
  lookAt: Vec3 | null
  rotation?: Vec3 // {x: pitch, y: yaw, z: roll}
}

// 时刻 t 的机位位姿：以锚点为圆心、按方位+水平角+运镜角偏移在目标朝向系里放机位
export function solveCloseupPose(input: SolveCloseupInput): SolvedCloseupPose {
  const { clip, currentTime, targetPosition, targetRotationY } = input
  const duration = Math.max(0.001, clip.endTime - clip.startTime)
  const progress = Math.max(0, Math.min(1, (currentTime - clip.startTime) / duration))
  const offsets = motionOffsets(clip.motionPreset, progress)
  const anchor = anchorWorldPosition(clip, targetPosition)
  const baseYaw = TURNTABLE_PRESETS.has(clip.motionPreset) ? input.referenceRotationY ?? targetRotationY : targetRotationY
  // 目标朝向单位向量（yaw 从 +Z 起）
  const forward = { x: Math.sin(baseYaw * DEG_TO_RAD), y: 0, z: Math.cos(baseYaw * DEG_TO_RAD) }
  const totalAngle = azimuthDegrees(clip) + clip.horizontalAngle + offsets.angleOffsetDeg
  const dir = rotateY(forward, totalAngle)
  const dist = Math.max(CLOSEUP_MIN_DISTANCE, clip.distance * offsets.distanceScale)
  const pitchRad = clip.pitchAngle * DEG_TO_RAD
  const horizontal = dist * Math.cos(pitchRad)
  const position: Vec3 = {
    x: anchor.x + dir.x * horizontal + offsets.truckOffset * dir.z,
    y: anchor.y + clip.height + offsets.heightOffset + dist * Math.sin(pitchRad),
    z: anchor.z + dir.z * horizontal - offsets.truckOffset * dir.x,
  }
  switch (clip.facingMode) {
    case 'follow_subject_yaw':
      return { position, lookAt: null, rotation: { x: clip.pitchAngle, y: wrapDeg(targetRotationY + clip.horizontalAngle), z: 0 } }
    case 'world_locked':
      return { position, lookAt: null, rotation: { x: clip.pitchAngle, y: wrapDeg(clip.horizontalAngle), z: 0 } }
    case 'manual':
      return { position, lookAt: null, rotation: input.cameraRotation ?? { x: clip.pitchAngle, y: clip.horizontalAngle, z: 0 } }
    case 'look_at_target':
    default:
      return { position, lookAt: { ...anchor } }
  }
}

// 时刻 t 命中的特写片段：多段重叠时优先结束点恰好等于 t 的那段，否则取最早开始的
export function findCloseupClipAt(clips: CloseupClip[] | undefined, time: number, epsilon: number = 1 / 60): CloseupClip | undefined {
  if (!clips || clips.length === 0) return undefined
  const hits = [...clips]
    .sort((a, b) => a.startTime - b.startTime)
    .filter((clip) => time >= clip.startTime - epsilon && time <= clip.endTime + epsilon)
  if (hits.length === 0) return undefined
  if (hits.length === 1) return hits[0]
  return hits.find((clip) => Math.abs(quantizeToFrame(clip.endTime) - quantizeToFrame(time)) < epsilon) ?? hits[0]
}
