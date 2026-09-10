/**
 * [INPUT]: 依赖 ./directorTypes 的 TimelineEntity / TrajectoryClip / Waypoint / Vec3、./clips 的 waypointsOfClip / lastClipEndedBefore、
 *          ./editLayer 的 findTrajectoryClipAt、./timeGrid 的 FRAME_EPSILON、./vec3 的 RAD_TO_DEG
 * [OUTPUT]: 对外提供 lerpAngleDeg、sampleWaypoints（片段内插值，≥3 点 Catmull-Rom、2 点线性）、evaluateEntityTransform
 *           （sample / hold / rest 三态）、EvaluatedTransform
 * [POS]: director/model 的路径求值单一真相（方案 §5.2）：时间轴播放、gizmo 写回、离屏出片都问它「实体在 t 时刻在哪、朝哪」。
 *        hold 语义 = 片段结束后停在最后一个路标。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TimelineEntity, TrajectoryClip, Vec3, Waypoint } from './directorTypes'
import { lastClipEndedBefore, waypointsOfClip } from './clips'
import { findTrajectoryClipAt } from './editLayer'
import { FRAME_EPSILON } from './timeGrid'
import { RAD_TO_DEG } from './vec3'

// 角度插值走最短弧
export function lerpAngleDeg(from: number, to: number, alpha: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return from + delta * Math.max(0, Math.min(1, alpha))
}

type Segment = { prev: Waypoint; next: Waypoint; alpha: number; prevIdx: number; nextIdx: number }

// 找 t 落在哪两个路标之间：有 progress 的按片段进度，否则按时间
function locateSegment(sorted: Waypoint[], time: number, clip?: TrajectoryClip): Segment {
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const lastIdx = sorted.length - 1
  if (sorted.length === 1) return { prev: first, next: first, alpha: 0, prevIdx: 0, nextIdx: 0 }
  if (clip && clip.endTime > clip.startTime && sorted.every((waypoint) => waypoint.progress !== undefined)) {
    const progress = Math.max(0, Math.min(1, (time - clip.startTime) / (clip.endTime - clip.startTime)))
    if (progress <= (first.progress ?? 0)) return { prev: first, next: first, alpha: 0, prevIdx: 0, nextIdx: 0 }
    if (progress >= (last.progress ?? 1)) return { prev: last, next: last, alpha: 0, prevIdx: lastIdx, nextIdx: lastIdx }
    const nextIdx = sorted.findIndex((waypoint) => (waypoint.progress ?? 0) > progress)
    if (nextIdx <= 0) return nextIdx === 0
      ? { prev: first, next: first, alpha: 0, prevIdx: 0, nextIdx: 0 }
      : { prev: last, next: last, alpha: 0, prevIdx: lastIdx, nextIdx: lastIdx }
    const prev = sorted[nextIdx - 1]
    const next = sorted[nextIdx]
    const span = (next.progress ?? 1) - (prev.progress ?? 0)
    const alpha = span > 1e-6 ? Math.max(0, Math.min(1, (progress - (prev.progress ?? 0)) / span)) : 0
    return { prev, next, alpha, prevIdx: nextIdx - 1, nextIdx }
  }
  if (time <= first.time) return { prev: first, next: first, alpha: 0, prevIdx: 0, nextIdx: 0 }
  if (time >= last.time) return { prev: last, next: last, alpha: 0, prevIdx: lastIdx, nextIdx: lastIdx }
  const nextIdx = sorted.findIndex((waypoint) => waypoint.time > time)
  const prev = sorted[nextIdx - 1]
  const next = sorted[nextIdx]
  const span = next.time - prev.time
  const alpha = span > 1e-6 ? (time - prev.time) / span : 0
  return { prev, next, alpha, prevIdx: nextIdx - 1, nextIdx }
}

// Catmull-Rom（张力 0.5）位置 + 切线
function catmullRom(points: Waypoint[], prevIdx: number, nextIdx: number, alpha: number): { position: Vec3; tangent: Vec3 } {
  const p0 = points[Math.max(0, prevIdx - 1)]
  const p1 = points[prevIdx]
  const p2 = points[nextIdx]
  const p3 = points[Math.min(points.length - 1, nextIdx + 1)]
  const m1 = { x: 0.5 * (p2.x - p0.x), y: 0.5 * (p2.y - p0.y), z: 0.5 * (p2.z - p0.z) }
  const m2 = { x: 0.5 * (p3.x - p1.x), y: 0.5 * (p3.y - p1.y), z: 0.5 * (p3.z - p1.z) }
  const t = Math.max(0, Math.min(1, alpha))
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  const position = {
    x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x,
    y: h00 * p1.y + h10 * m1.y + h01 * p2.y + h11 * m2.y,
    z: h00 * p1.z + h10 * m1.z + h01 * p2.z + h11 * m2.z,
  }
  const d00 = 6 * t2 - 6 * t
  const d10 = 3 * t2 - 4 * t + 1
  const d01 = -6 * t2 + 6 * t
  const d11 = 3 * t2 - 2 * t
  const tangent = {
    x: d00 * p1.x + d10 * m1.x + d01 * p2.x + d11 * m2.x,
    y: d00 * p1.y + d10 * m1.y + d01 * p2.y + d11 * m2.y,
    z: d00 * p1.z + d10 * m1.z + d01 * p2.z + d11 * m2.z,
  }
  const len = Math.hypot(tangent.x, tangent.y, tangent.z)
  return { position, tangent: len > 1e-4 ? { x: tangent.x / len, y: tangent.y / len, z: tangent.z / len } : { x: 0, y: 0, z: 1 } }
}

export type WaypointSample = { position: Vec3; tangent: Vec3; rotation: Vec3; fov?: number } // rotation = {x: pitch, y: yaw, z: roll}

// 路标上的 fov 线性插值：两端都有才插，只有一端就用那一端，都没有 = 机位静态 fov
function lerpFov(prev: Waypoint, next: Waypoint, alpha: number): number | undefined {
  if (prev.fov !== undefined && next.fov !== undefined) return prev.fov + (next.fov - prev.fov) * Math.max(0, Math.min(1, alpha))
  return prev.fov ?? next.fov
}

// 片段内按路标插值：位置走曲线/线性，yaw/pitch/roll 走最短弧插值；朝向缺省跟切线
export function sampleWaypoints(waypoints: Waypoint[], time: number, clip?: TrajectoryClip): WaypointSample | null {
  if (waypoints.length === 0) return null
  const sorted = [...waypoints].sort((a, b) =>
    a.progress !== undefined && b.progress !== undefined ? a.progress - b.progress : a.time - b.time,
  )
  const { prev, next, alpha, prevIdx, nextIdx } = locateSegment(sorted, time, clip)
  let position: Vec3
  let tangent: Vec3
  if (sorted.length >= 3) {
    const curve = catmullRom(sorted, prevIdx, nextIdx, alpha)
    position = curve.position
    tangent = curve.tangent
  } else {
    position = { x: prev.x + alpha * (next.x - prev.x), y: prev.y + alpha * (next.y - prev.y), z: prev.z + alpha * (next.z - prev.z) }
    const d = { x: next.x - prev.x, y: next.y - prev.y, z: next.z - prev.z }
    const len = Math.hypot(d.x, d.y, d.z)
    tangent = len > 1e-4 ? { x: d.x / len, y: d.y / len, z: d.z / len } : { x: 0, y: 0, z: 1 }
  }
  const yaw = lerpAngleDeg(prev.yaw, next.yaw, alpha)
  const pitch = lerpAngleDeg(prev.pitch, next.pitch, alpha)
  const roll = lerpAngleDeg(prev.roll, next.roll, alpha)
  const fov = lerpFov(prev, next, alpha)
  return { position, tangent, rotation: { x: pitch, y: yaw, z: roll }, ...(fov !== undefined ? { fov } : {}) }
}

export type EvaluatedTransform = {
  position: Vec3
  rotation: Vec3 // {x: pitch, y: yaw, z: roll}（度）
  // 机位路标带 fov 时的插值结果；缺省 = 用静态 fov
  fov?: number
  source: 'sample' | 'hold' | 'rest'
  sourceClipId?: string
  sourceKeyframeId?: string
}

function restRotation(entity: TimelineEntity): Vec3 {
  return 'rotation' in entity && entity.rotation
    ? { ...entity.rotation }
    : { x: (entity as { pitch?: number }).pitch ?? 0, y: (entity as { yaw?: number }).yaw ?? 0, z: (entity as { roll?: number }).roll ?? 0 }
}

// 时刻 t 的实体位姿：片段内采样 → 片段结束后停在最后路标（hold）→ 否则静止位姿
export function evaluateEntityTransform(entity: TimelineEntity, time: number): EvaluatedTransform {
  const clips = entity.trajectoryClips ?? []
  const waypoints = entity.motionTrajectory ?? []
  const rest = restRotation(entity)
  const active = findTrajectoryClipAt(clips, time, FRAME_EPSILON)
  if (active && waypoints.length > 0) {
    const inClip = waypointsOfClip(waypoints, active, clips)
    const sample = sampleWaypoints(inClip, time, active)
    if (sample) {
      return { position: sample.position, rotation: sample.rotation, ...(sample.fov !== undefined ? { fov: sample.fov } : {}), source: 'sample', sourceClipId: active.id }
    }
  }
  const ended = lastClipEndedBefore(clips, time)
  if (ended && waypoints.length > 0) {
    const inClip = waypointsOfClip(waypoints, ended, clips).sort((a, b) => a.time - b.time)
    const last = inClip[inClip.length - 1]
    if (last) {
      return {
        position: { x: last.x, y: last.y, z: last.z },
        rotation: { x: last.pitch ?? rest.x, y: last.yaw ?? rest.y, z: last.roll ?? rest.z },
        ...(last.fov !== undefined ? { fov: last.fov } : {}),
        source: 'hold',
        sourceClipId: ended.id,
        sourceKeyframeId: last.id,
      }
    }
  }
  return { position: { ...entity.position }, rotation: rest, source: 'rest' }
}

// 切线朝向（度）：给「朝向跟路」的角色用
export function headingFromTangent(tangent: Vec3): { yaw: number; pitch: number } {
  return {
    yaw: Math.atan2(tangent.x, tangent.z) * RAD_TO_DEG,
    pitch: Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z)) * RAD_TO_DEG,
  }
}
