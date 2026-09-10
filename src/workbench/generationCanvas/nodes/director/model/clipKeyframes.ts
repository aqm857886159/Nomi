/**
 * [INPUT]: 依赖 directorTypes、clips、timeGrid、trajectoryEval、poseBlend、directorIds。
 * [OUTPUT]: resizeClipKeyframes、cutClipKeyframes、samplePoseAt：片段变时/剪切与所属关键帧的一致性边界。
 * [POS]: 纯 model；拖边按比例重排，剪切采样切点并保留两侧独立边界帧，零 React / THREE。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import { waypointsOfClip, type ClipLike } from './clips'
import { createKeyframeId, createWaypointId } from './directorIds'
import type { ActionClip, BoneKeyframe, TimelineEntity, TrajectoryClip, Vec3, Waypoint } from './directorTypes'
import { resolvePoseKeyframes } from './poseBlend'
import { FRAME_EPSILON, quantizeToFrame, secondsToFrame } from './timeGrid'
import { sampleWaypoints } from './trajectoryEval'

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }
const progressAt = (time: number, clip: ClipLike) => Math.max(0, Math.min(1, (time - clip.startTime) / (clip.endTime - clip.startTime)))
const inClip = (time: number, clip: ClipLike) => time >= clip.startTime - FRAME_EPSILON && time <= clip.endTime + FRAME_EPSILON

// XYZ Euler ↔ quaternion + shortest-arc slerp, matching the renderer's THREE XYZ convention.
function quaternion(rotation: Vec3): number[] {
  const [x, y, z] = [rotation.x, rotation.y, rotation.z].map((angle) => angle * Math.PI / 360)
  const [a, b, c, d, e, f] = [Math.cos(x), Math.cos(y), Math.cos(z), Math.sin(x), Math.sin(y), Math.sin(z)]
  return [d * b * c + a * e * f, a * e * c - d * b * f, a * b * f + d * e * c, a * b * c - d * e * f]
}

function interpolateRotation(from: Vec3, to: Vec3, alpha: number): Vec3 {
  const a = quaternion(from)
  let b = quaternion(to)
  let dot = a.reduce((sum, value, index) => sum + value * b[index], 0)
  if (dot < 0) { b = b.map((value) => -value); dot = -dot }
  const angle = Math.acos(Math.min(1, dot))
  const sine = Math.sin(angle)
  const wa = sine > 1e-8 ? Math.sin((1 - alpha) * angle) / sine : 1 - alpha
  const wb = sine > 1e-8 ? Math.sin(alpha * angle) / sine : alpha
  const q = a.map((value, index) => wa * value + wb * b[index])
  const length = Math.hypot(...q)
  const [x, y, z, w] = q.map((value) => value / length)
  const m13 = 2 * (x * z + y * w)
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)))
  const ex = Math.abs(m13) < 0.9999999 ? Math.atan2(2 * (x * w - y * z), 1 - 2 * (x * x + y * y)) : Math.atan2(2 * (x * w + y * z), 1 - 2 * (x * x + z * z))
  const ez = Math.abs(m13) < 0.9999999 ? Math.atan2(2 * (z * w - x * y), 1 - 2 * (y * y + z * z)) : 0
  return { x: ex * 180 / Math.PI, y: ey * 180 / Math.PI, z: ez * 180 / Math.PI }
}

export function samplePoseAt(clip: ActionClip, time: number): Pick<BoneKeyframe, 'boneRotations' | 'hipsOffset'> {
  const { a, b, alpha } = resolvePoseKeyframes(clip, time)
  if (!a) return { boneRotations: {} }
  if (!b) return structuredClone({ boneRotations: a.boneRotations, hipsOffset: a.hipsOffset })
  const boneRotations: Record<string, Vec3> = {}
  for (const key of new Set([...Object.keys(a.boneRotations), ...Object.keys(b.boneRotations)])) {
    boneRotations[key] = interpolateRotation(a.boneRotations[key] ?? ZERO, b.boneRotations[key] ?? ZERO, alpha)
  }
  const from = a.hipsOffset ?? ZERO
  const to = b.hipsOffset ?? ZERO
  const hipsOffset = a.hipsOffset || b.hipsOffset ? { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha, z: from.z + (to.z - from.z) * alpha } : undefined
  return { boneRotations, hipsOffset }
}

export function resizeClipKeyframes(entity: TimelineEntity, family: string, clip: TrajectoryClip, start: number, end: number): void {
  const mapTime = (time: number) => quantizeToFrame(start + progressAt(time, clip) * (end - start))
  if (family === 'trajectory') {
    for (const key of waypointsOfClip(entity.motionTrajectory ?? [], clip, entity.trajectoryClips)) {
      key.progress = key.progress ?? progressAt(key.time, clip)
      key.time = quantizeToFrame(start + key.progress * (end - start))
      key.frameIndex = secondsToFrame(key.time)
      key.clipId = clip.id
    }
    entity.motionTrajectory?.sort((a, b) => a.time - b.time)
  } else if (family === 'action') {
    for (const key of (clip as ActionClip).keyframes ?? []) {
      key.time = mapTime(key.time)
      key.frame = secondsToFrame(key.time)
    }
  }
}

// source retains pre-cut geometry; retained pieces already hold their new bounds.
export function cutClipKeyframes(entity: TimelineEntity, family: string, source: TrajectoryClip, pieces: TrajectoryClip[], time: number): void {
  if (family === 'trajectory') {
    const owned = waypointsOfClip(entity.motionTrajectory ?? [], source, entity.trajectoryClips)
    const ownedIds = new Set(owned.map((key) => key.id))
    const existing = owned.find((key) => Math.abs(key.time - time) <= FRAME_EPSILON)
    const sample = sampleWaypoints(owned, time, source)
    const rest = 'rotation' in entity ? entity.rotation : { x: entity.pitch, y: entity.yaw, z: entity.roll }
    const point: Waypoint = existing ? { ...existing } : {
      id: '', time, frameIndex: secondsToFrame(time),
      ...(sample?.position ?? entity.position),
      yaw: sample?.rotation.y ?? rest.y, pitch: sample?.rotation.x ?? rest.x, roll: sample?.rotation.z ?? rest.z,
      ...(sample?.fov === undefined ? {} : { fov: sample.fov }),
    }
    const keys = pieces.flatMap((piece) => {
      const kept = owned.filter((key) => inClip(key.time, piece) && Math.abs(key.time - time) > FRAME_EPSILON)
      return [...kept, { ...point, id: pieces.length === 1 && existing ? existing.id : createWaypointId(), time, frameIndex: secondsToFrame(time) }]
        .map((key) => ({ ...key, clipId: piece.id, progress: progressAt(key.time, piece) }))
    })
    entity.motionTrajectory = [...(entity.motionTrajectory ?? []).filter((key) => !ownedIds.has(key.id)), ...keys].sort((a, b) => a.time - b.time)
  } else if (family === 'action' && (source as ActionClip).clipType === 'custom_pose') {
    const keys = (source as ActionClip).keyframes ?? []
    const existing = keys.find((key) => Math.abs(key.time - time) <= FRAME_EPSILON)
    const sample = samplePoseAt(source as ActionClip, time)
    pieces.forEach((piece, index) => {
      const kept = keys.filter((key) => inClip(key.time, piece) && Math.abs(key.time - time) > FRAME_EPSILON)
      const boundary = { id: index === 0 && existing ? existing.id : createKeyframeId(), time, frame: secondsToFrame(time), ...sample }
      ;(piece as ActionClip).keyframes = structuredClone([...kept, boundary]).sort((a, b) => a.time - b.time)
    })
  }
}
