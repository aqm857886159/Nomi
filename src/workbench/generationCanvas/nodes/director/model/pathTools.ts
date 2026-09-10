/**
 * [INPUT]: 依赖 ./directorTypes 的 Vec3、./vec3 的 distance、./timeGrid 的 quantizeToFrame
 * [OUTPUT]: 对外提供 MIN_BRUSH_PATH_LENGTH、pathLength、resamplePathByArcLength、distributeTimesByArcLength
 * [POS]: director/model 的手绘路径工具（清单 §2 T3 画笔）：把鼠标在地面上画出的密集点按弧长重采样成 ≤200 个路标，
 *        再按弧长把片段时长分配给每个路标——走得快的段时间短、慢的段时间长。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Vec3 } from './directorTypes'
import { quantizeToFrame } from './timeGrid'
import { distance } from './vec3'

// 画得比这短就不生成路标（米）
export const MIN_BRUSH_PATH_LENGTH = 1
export const MAX_BRUSH_WAYPOINTS = 200

export function pathLength(points: Vec3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i])
  return total
}

function pointAtArcLength(points: Vec3[], cumulative: number[], total: number, s: number): Vec3 {
  if (s <= 0) return { ...points[0] }
  if (s >= total) return { ...points[points.length - 1] }
  let index = 0
  while (index < cumulative.length - 1 && cumulative[index + 1] < s) index += 1
  const segStart = cumulative[index]
  const segLength = cumulative[index + 1] - segStart
  const t = segLength > 0 ? (s - segStart) / segLength : 0
  const a = points[index]
  const b = points[index + 1]
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) }
}

// 按弧长重采样：步长 = max(minSpacing, 总长/max(10, maxPoints))；总长 < minSpacing 返回空
export function resamplePathByArcLength(
  points: Vec3[],
  minSpacing: number = MIN_BRUSH_PATH_LENGTH,
  maxPoints: number = MAX_BRUSH_WAYPOINTS,
): Vec3[] {
  if (points.length < 2 || minSpacing <= 0) return []
  const total = pathLength(points)
  if (total < minSpacing) return []
  const step = Math.max(minSpacing, total / Math.max(10, maxPoints))
  const cumulative = [0]
  for (let i = 1; i < points.length; i += 1) cumulative.push(cumulative[i - 1] + distance(points[i - 1], points[i]))
  const result: Vec3[] = [pointAtArcLength(points, cumulative, total, 0)]
  let s = step
  while (s < total - 0.05 && result.length < maxPoints) {
    result.push(pointAtArcLength(points, cumulative, total, s))
    s += step
  }
  const end = pointAtArcLength(points, cumulative, total, total)
  if (distance(result[result.length - 1], end) > 0.05) result.push(end)
  return result.length >= 2 ? result : []
}

// 按弧长把 [startTime, endTime] 分配给各路标（量化到帧格）
export function distributeTimesByArcLength(points: Vec3[], startTime: number, endTime: number): number[] {
  if (points.length === 0) return []
  if (points.length === 1) return [quantizeToFrame(startTime)]
  const total = pathLength(points)
  const span = endTime - startTime
  if (total <= 0 || span <= 0) {
    return points.map((_, index) => quantizeToFrame(startTime + (index / (points.length - 1)) * span))
  }
  const times = [quantizeToFrame(startTime)]
  let walked = 0
  for (let i = 1; i < points.length; i += 1) {
    walked += distance(points[i - 1], points[i])
    times.push(quantizeToFrame(startTime + (walked / total) * span))
  }
  return times
}
