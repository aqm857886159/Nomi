/**
 * [INPUT]: 依赖 ./directorTypes 的 TrajectoryClip / Waypoint / Vec3、./timeGrid 的 quantizeToFrame / secondsToFrame / FRAME_EPSILON / FRAME_SECONDS / sameFrameTime
 * [OUTPUT]: 对外提供 clipsOverlap、findFreeStart、clipBounds、lastClipEndedBefore、firstClipStartingAfter、extendClipTo、
 *           waypointBelongsToClip、waypointsOfClip、upsertWaypointAt、patchWaypoint、createTrajectoryClip、
 *           trimClipToPlayhead、splitClipAt、duplicateClipAfter
 * [POS]: director/model 的片段几何：放置（找空位）、重叠检测、裁剪/分割、路标与片段的归属；纯函数，时间轴 UI 与
 *        store action 都调这里而不各自算重叠。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TrajectoryClip, Vec3, Waypoint } from './directorTypes'
import { FRAME_EPSILON, FRAME_SECONDS, quantizeToFrame, sameFrameTime, secondsToFrame } from './timeGrid'

export type ClipLike = { id: string; startTime: number; endTime: number }

// 区间 [start, end) 是否与其它片段重叠（可排除自身）
export function clipsOverlap(clips: ClipLike[], start: number, end: number, excludeId?: string): boolean {
  return clips.some((clip) => (excludeId && clip.id === excludeId ? false : start < clip.endTime && end > clip.startTime))
}

// 从 preferredStart 起找能放下 duration 的最早起点；放不进 maxEnd 之前返回 null
export function findFreeStart(clips: ClipLike[], preferredStart: number, duration: number, maxEnd: number): number | null {
  let start = Math.max(0, preferredStart)
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
  for (const clip of sorted) {
    if (start + duration > clip.startTime && start < clip.endTime) start = clip.endTime
  }
  return start + duration > maxEnd ? null : start
}

// 「点哪儿落哪儿」的放置：首选位置整段塞得下就落；塞不下但首选位置到下一段头之间的空档 ≥ MIN_PLACED_CLIP_SECONDS
// 就缩短到空档（用户在空档里右键加片段，片段被甩到轨道末尾比缩短一点更反直觉，2026-09-02 走查栽过）；
// 首选位置落在别的片段里 / 空档太小，才退到下一个空位
export const MIN_PLACED_CLIP_SECONDS = 0.5
export function fitClipAt(clips: ClipLike[], preferredStart: number, duration: number, maxEnd: number): { start: number; duration: number } | null {
  const at = Math.max(0, preferredStart)
  const free = findFreeStart(clips, at, duration, maxEnd)
  if (free !== null && Math.abs(free - at) < FRAME_EPSILON) return { start: free, duration }
  const inside = clips.some((clip) => clip.startTime < at + FRAME_EPSILON && at < clip.endTime - FRAME_EPSILON)
  if (!inside) {
    const next = firstClipStartingAfter(clips, at)
    const gap = Math.min(next ? next.startTime : maxEnd, maxEnd) - at
    if (gap >= MIN_PLACED_CLIP_SECONDS) return { start: at, duration: Math.min(duration, gap) }
  }
  return free === null ? null : { start: free, duration }
}

// 某片段左右能拖到的极限（前一片段末 / 后一片段头）
export function clipBounds(clips: ClipLike[], clipId: string, maxEnd: number): { minBound: number; maxBound: number } {
  const target = clips.find((clip) => clip.id === clipId)
  const others = clips.filter((clip) => clip.id !== clipId).sort((a, b) => a.startTime - b.startTime)
  const start = target?.startTime ?? 0
  const end = target?.endTime ?? 0
  const before = others.filter((clip) => clip.endTime <= start + FRAME_EPSILON)
  const prev = before[before.length - 1]
  const next = others.find((clip) => clip.startTime >= end - FRAME_EPSILON)
  return { minBound: prev ? prev.endTime : 0, maxBound: next ? next.startTime : maxEnd }
}

// 在 t 之前（含 t）结束的最近片段（hold 语义用）
export function lastClipEndedBefore<T extends ClipLike>(clips: T[], time: number): T | undefined {
  return [...clips].filter((clip) => clip.endTime <= time + FRAME_EPSILON).sort((a, b) => b.endTime - a.endTime)[0]
}

export function firstClipStartingAfter<T extends ClipLike>(clips: T[], time: number): T | undefined {
  return [...clips].filter((clip) => clip.startTime >= time - FRAME_EPSILON).sort((a, b) => a.startTime - b.startTime)[0]
}

// 把片段扩到包含 time；与他片段冲突则不动并返回 false
export function extendClipTo(clip: TrajectoryClip, time: number, siblings: ClipLike[]): boolean {
  const start = Math.min(clip.startTime, time)
  const end = Math.max(clip.endTime, time)
  if (clipsOverlap(siblings, start, end, clip.id)) return false
  clip.startTime = start
  clip.endTime = end
  clip.startFrame = secondsToFrame(start)
  clip.endFrame = secondsToFrame(end)
  return true
}

// 路标归属：有 clipId 按 id；否则按时间落在片段内（与前一片段共享边界时归前者）
export function waypointBelongsToClip(waypoint: Waypoint, clip: TrajectoryClip, siblings: ClipLike[], epsilon: number = FRAME_EPSILON): boolean {
  if (waypoint.clipId) return waypoint.clipId === clip.id
  const time = waypoint.time
  if (time < clip.startTime - epsilon || time > clip.endTime + epsilon) return false
  const sharesBoundary = siblings.some((other) => other.id !== clip.id && sameFrameTime(other.endTime, clip.startTime))
  return !(sharesBoundary && sameFrameTime(time, clip.startTime))
}

export function waypointsOfClip(waypoints: Waypoint[], clip: TrajectoryClip, siblings?: ClipLike[]): Waypoint[] {
  return waypoints.filter((waypoint) => waypointBelongsToClip(waypoint, clip, siblings ?? [clip]))
}

export type WaypointPatch = Partial<Pick<Waypoint, 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'roll'>>

function applyPatch(waypoint: Waypoint, patch: WaypointPatch): Waypoint {
  if (patch.x !== undefined) waypoint.x = patch.x
  if (patch.y !== undefined) waypoint.y = patch.y
  if (patch.z !== undefined) waypoint.z = patch.z
  if (patch.yaw !== undefined) waypoint.yaw = patch.yaw
  if (patch.pitch !== undefined) waypoint.pitch = patch.pitch
  if (patch.roll !== undefined) waypoint.roll = patch.roll
  return waypoint
}

// 在时刻 t（量化到帧）写入路标：帧内已有则改它，否则新建并保持按时间排序
export function upsertWaypointAt(
  waypoints: Waypoint[],
  time: number,
  values: WaypointPatch,
  makeId: () => string,
  clipId?: string,
): { point: Waypoint; created: boolean } {
  const quantized = quantizeToFrame(time)
  const existing = waypoints.find((waypoint) => {
    if (clipId && waypoint.clipId && waypoint.clipId !== clipId) return false
    return Math.abs(waypoint.time - quantized) <= FRAME_EPSILON
  })
  if (existing) {
    applyPatch(existing, values)
    if (clipId && !existing.clipId) existing.clipId = clipId
    return { point: existing, created: false }
  }
  const point: Waypoint = {
    id: makeId(),
    x: values.x ?? 0,
    y: values.y ?? 0,
    z: values.z ?? 0,
    yaw: values.yaw ?? 0,
    pitch: values.pitch ?? 0,
    roll: values.roll ?? 0,
    time: quantized,
    frameIndex: secondsToFrame(quantized),
    clipId,
  }
  waypoints.push(point)
  waypoints.sort((a, b) => a.time - b.time)
  return { point, created: true }
}

export function patchWaypoint(waypoints: Waypoint[] | undefined, id: string, patch: WaypointPatch): Waypoint | null {
  const waypoint = waypoints?.find((item) => item.id === id)
  return waypoint ? applyPatch(waypoint, patch) : null
}

export function createTrajectoryClip(id: string, startTime: number, endTime: number): TrajectoryClip {
  const start = quantizeToFrame(startTime)
  const end = quantizeToFrame(endTime)
  return { id, startTime: start, endTime: end, startFrame: secondsToFrame(start), endFrame: secondsToFrame(end) }
}

// 裁前/裁后到播放头：播放头必须落在片段内部（离两端 ≥ 半帧）
export function trimClipToPlayhead<T extends ClipLike & { startFrame: number; endFrame: number }>(clip: T, playhead: number, side: 'left' | 'right'): boolean {
  const time = quantizeToFrame(playhead)
  if (time <= clip.startTime + FRAME_EPSILON || time >= clip.endTime - FRAME_EPSILON) return false
  if (side === 'left') {
    clip.startTime = time
    clip.startFrame = secondsToFrame(time)
  } else {
    clip.endTime = time
    clip.endFrame = secondsToFrame(time)
  }
  return true
}

// 在播放头处一分为二：原片段截到播放头，返回新的右半段（浅拷贝其它字段）
export function splitClipAt<T extends ClipLike & { startFrame: number; endFrame: number }>(clip: T, playhead: number, newId: string): T | null {
  const time = quantizeToFrame(playhead)
  if (time <= clip.startTime + FRAME_EPSILON || time >= clip.endTime - FRAME_EPSILON) return null
  const right: T = { ...clip, id: newId, startTime: time, endTime: clip.endTime, startFrame: secondsToFrame(time), endFrame: clip.endFrame }
  clip.endTime = time
  clip.endFrame = secondsToFrame(time)
  return right
}

// 「紧贴最后连续复制」：把片段复制到轨道上最后一段之后
export function duplicateClipAfter<T extends ClipLike & { startFrame: number; endFrame: number }>(clip: T, siblings: ClipLike[], newId: string, maxEnd: number): T | null {
  const duration = clip.endTime - clip.startTime
  const tail = siblings.reduce((max, item) => Math.max(max, item.endTime), 0)
  const start = findFreeStart(siblings, tail, duration, maxEnd)
  if (start === null) return null
  const end = quantizeToFrame(start + duration)
  return { ...clip, id: newId, startTime: quantizeToFrame(start), endTime: end, startFrame: secondsToFrame(start), endFrame: secondsToFrame(end) }
}

// 相邻路标的最小时间间隔（帧）——拖路标时的夹紧
export function waypointTimeBounds(waypoints: Waypoint[], clip: TrajectoryClip, waypointId: string, time: number): { minTime: number; maxTime: number } {
  const others = waypointsOfClip(waypoints, clip).filter((waypoint) => waypoint.id !== waypointId).sort((a, b) => a.time - b.time)
  const prev = [...others].reverse().find((waypoint) => waypoint.time < time - 1e-6)
  const next = others.find((waypoint) => waypoint.time > time + 1e-6)
  let minTime = prev ? prev.time + FRAME_SECONDS : clip.startTime
  let maxTime = next ? next.time - FRAME_SECONDS : clip.endTime
  if (minTime > maxTime) {
    const mid = (minTime + maxTime) / 2
    minTime = mid
    maxTime = mid
  }
  return { minTime, maxTime }
}

export function vec3FromWaypoint(waypoint: Waypoint): Vec3 {
  return { x: waypoint.x, y: waypoint.y, z: waypoint.z }
}
