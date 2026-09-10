/**
 * [INPUT]: 依赖 ./directorTypes 的 TimelineEntity / Waypoint / TrajectoryClip / CloseupClip、./timeGrid、./closeupRig 的 findCloseupClipAt
 * [OUTPUT]: 对外提供 EditLayer 词表、findTrajectoryClipAt、findWaypointAt、resolveEditLayer、describeEditLayer
 * [POS]: director/model 的「编辑层」判定（方案 §5.3）：拖 gizmo / 改检查器数字时，播放头落在哪决定改的是静止位姿(rest)、
 *        关键帧(keyframe) 还是只读(evaluated-readonly)。这是「时间轴上直接操控不毁动画」的关节，所有写回路径先过它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { TimelineEntity, TrajectoryClip, Waypoint } from './directorTypes'
import { findCloseupClipAt } from './closeupRig'
import { FRAME_EPSILON, quantizeToFrame } from './timeGrid'

// 词表 owner：编辑层只有这三态（登记于 scripts/vocabularies-baseline.json）
export type EditLayer = 'rest' | 'keyframe' | 'evaluated-readonly'

export type EditContext = {
  currentTime: number
  activeWaypointId?: string | null
}

export function findTrajectoryClipAt(clips: TrajectoryClip[] | undefined, time: number, epsilon: number = FRAME_EPSILON): TrajectoryClip | undefined {
  return clips?.find((clip) => time >= clip.startTime - epsilon && time <= clip.endTime + epsilon)
}

// 播放头附近（默认半帧）最近的路标；可限定片段
export function findWaypointAt(
  waypoints: Waypoint[] | undefined,
  time: number,
  epsilon: number = FRAME_EPSILON,
  clipId?: string,
): Waypoint | undefined {
  if (!waypoints) return undefined
  const quantized = quantizeToFrame(time)
  let best: Waypoint | undefined
  let bestDelta = Number.POSITIVE_INFINITY
  for (const waypoint of waypoints) {
    if (clipId && waypoint.clipId && waypoint.clipId !== clipId) continue
    const delta = Math.min(Math.abs(waypoint.time - time), Math.abs(quantizeToFrame(waypoint.time) - quantized))
    if (delta <= epsilon && delta < bestDelta) {
      bestDelta = delta
      best = waypoint
    }
  }
  return best
}

// 有选中路标 → keyframe；机位处在特写片段内 → 只读；无片段且无路标 → rest；播放头在路标上 → keyframe；否则只读
export function resolveEditLayer(entity: TimelineEntity, context: EditContext, isCamera: boolean): EditLayer {
  if (context.activeWaypointId) return 'keyframe'
  if (isCamera && 'closeupClips' in entity && findCloseupClipAt(entity.closeupClips, context.currentTime)) {
    return 'evaluated-readonly'
  }
  const waypoints = entity.motionTrajectory ?? []
  const inClip = Boolean(findTrajectoryClipAt(entity.trajectoryClips, context.currentTime))
  if (!inClip && waypoints.length === 0) return 'rest'
  return findWaypointAt(waypoints, context.currentTime) ? 'keyframe' : 'evaluated-readonly'
}

export function describeEditLayer(layer: EditLayer): 'rest' | 'keyframe' | 'readonly' {
  return layer === 'evaluated-readonly' ? 'readonly' : layer
}
