/**
 * [INPUT]: 依赖 ./directorTypes（LookAtClip / LookAtBodyPart / Vec3）、./closeupRig 的 ANCHOR_HEIGHTS、./vec3（lookAtAngles / signedDeg）、./timeGrid 的 FRAME_EPSILON
 * [OUTPUT]: 对外提供 LOOK_AT_PITCH_LIMIT / LOOK_AT_SHARES、lookAtWeightAt、bodyPartAnchor、HeadAim、solveHeadAim、distributeHeadAim
 * [POS]: director/model 的视线纯数学：片段权重（缓入缓出 × weight）、头部相对身体的 yaw/pitch（限幅 + 超限 smoothstep 衰减）、
 *        分配到 颈 0.15 / 脊 0.3 / 头 0.55。骨骼旋转在 scene 层按分配结果叠加。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { ANCHOR_HEIGHTS } from './closeupRig'
import type { LookAtBodyPart, LookAtClip, Vec3 } from './directorTypes'
import { FRAME_EPSILON } from './timeGrid'
import { lookAtAngles, signedDeg } from './vec3'

export const LOOK_AT_PITCH_LIMIT = 60
// 超过限幅角后再 40° 内平滑衰减到 0（不要硬切）
export const LOOK_AT_FALLOFF_DEG = 40
export const LOOK_AT_SHARES = { neck: 0.15, spine: 0.3, head: 0.55 } as const

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0))
  return t * t * (3 - 2 * t)
}

// 片段在 t 的总权重：片段外 0；头尾 blendIn/blendOut 线性缓入缓出；× 片段 weight
export function lookAtWeightAt(clip: LookAtClip, time: number): number {
  if (time < clip.startTime - FRAME_EPSILON || time > clip.endTime + FRAME_EPSILON) return 0
  const fadeIn = clip.blendInDuration > 0 ? clamp01((time - clip.startTime) / clip.blendInDuration) : 1
  const fadeOut = clip.blendOutDuration > 0 ? clamp01((clip.endTime - time) / clip.blendOutDuration) : 1
  return clamp01(Math.min(fadeIn, fadeOut) * clamp01(clip.weight))
}

// 目标身体部位的世界锚点（目标脚底位置 + 部位高度 + 片段高度偏移）
export function bodyPartAnchor(targetPosition: Vec3, part: LookAtBodyPart, heightOffset: number): Vec3 {
  const height = part === 'custom' ? 0 : ANCHOR_HEIGHTS[part]
  return { x: targetPosition.x, y: targetPosition.y + height + heightOffset, z: targetPosition.z }
}

export type HeadAim = { yaw: number; pitch: number; weight: number }

// 头部相对身体朝向的转角：|yaw| 超过 clampingAngle 就夹住，并在其后 40° 内 smoothstep 衰减权重；pitch ±60°，关掉 enablePitch 时归 0
export function solveHeadAim(input: { headPosition: Vec3; targetPosition: Vec3; bodyYaw: number; clampingAngle: number; enablePitch: boolean; weight: number }): HeadAim {
  const angles = lookAtAngles(input.headPosition, input.targetPosition)
  const relativeYaw = signedDeg(angles.yaw - input.bodyYaw)
  const clamp = Math.max(0, input.clampingAngle)
  const excess = Math.abs(relativeYaw) - clamp
  const falloff = excess <= 0 ? 1 : 1 - smoothstep(0, LOOK_AT_FALLOFF_DEG, excess)
  const yaw = Math.max(-clamp, Math.min(clamp, relativeYaw))
  const pitch = input.enablePitch ? Math.max(-LOOK_AT_PITCH_LIMIT, Math.min(LOOK_AT_PITCH_LIMIT, angles.pitch)) : 0
  return { yaw, pitch, weight: clamp01(input.weight) * falloff }
}

export type DistributedAim = { head: { yaw: number; pitch: number }; neck: { yaw: number; pitch: number }; spine: { yaw: number; pitch: number } }

export function distributeHeadAim(aim: HeadAim): DistributedAim {
  const yaw = aim.yaw * aim.weight
  const pitch = aim.pitch * aim.weight
  return {
    head: { yaw: yaw * LOOK_AT_SHARES.head, pitch: pitch * LOOK_AT_SHARES.head },
    neck: { yaw: yaw * LOOK_AT_SHARES.neck, pitch: pitch * LOOK_AT_SHARES.neck },
    spine: { yaw: yaw * LOOK_AT_SHARES.spine, pitch: pitch * LOOK_AT_SHARES.spine },
  }
}
