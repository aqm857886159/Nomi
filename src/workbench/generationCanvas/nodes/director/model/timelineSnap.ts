/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorScene、./timeGrid 的 entityClips
 * [OUTPUT]: 对外提供 SnapKind / SnapCandidate / SnapExclusion、SNAP_PIXEL_TOLERANCE、collectSnapCandidates、snapToleranceSeconds、snapTime
 * [POS]: director/model 的时间轴吸附（清单 §5.2 L4）：候选 = 片段边缘 + 路标 + 播放头，容差按缩放（像素 → 秒）换算；
 *        帧格量化不在这里（store 写入时统一 quantizeToFrame）。被拖的片段/路标自己不参与候选。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorScene } from './directorTypes'
import { entityClips } from './timeGrid'

export type SnapKind = 'clipEdge' | 'keyframe' | 'playhead'
export type SnapCandidate = { time: number; kind: SnapKind }
export type SnapExclusion = { clipId?: string; waypointIds?: string[] }

export const SNAP_PIXEL_TOLERANCE = 6

export function collectSnapCandidates(scene: Pick<DirectorScene, 'objects' | 'cameras'>, playhead: number, exclude: SnapExclusion = {}): SnapCandidate[] {
  const candidates: SnapCandidate[] = [{ time: playhead, kind: 'playhead' }]
  const excludedWaypoints = new Set(exclude.waypointIds ?? [])
  for (const entity of [...scene.objects, ...scene.cameras]) {
    if (!entity.inTimeline) continue
    for (const clip of entityClips(entity)) {
      if (clip.id === exclude.clipId) continue
      candidates.push({ time: clip.startTime, kind: 'clipEdge' }, { time: clip.endTime, kind: 'clipEdge' })
    }
    for (const waypoint of entity.motionTrajectory ?? []) {
      if (excludedWaypoints.has(waypoint.id)) continue
      candidates.push({ time: waypoint.time, kind: 'keyframe' })
    }
  }
  return candidates
}

export function snapToleranceSeconds(pxPerSecond: number, tolerancePx: number = SNAP_PIXEL_TOLERANCE): number {
  return pxPerSecond > 0 ? tolerancePx / pxPerSecond : 0
}

// 最近的候选在容差内就吸过去；同距离时先到先得（候选顺序：播放头 → 片段边缘 → 路标）
export function snapTime(time: number, candidates: SnapCandidate[], tolerance: number): { time: number; snapped: SnapCandidate | null } {
  let best: SnapCandidate | null = null
  let bestDistance = tolerance
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.time - time)
    if (distance < bestDistance || (best === null && distance <= bestDistance)) {
      best = candidate
      bestDistance = distance
    }
  }
  return best ? { time: best.time, snapped: best } : { time, snapped: null }
}
