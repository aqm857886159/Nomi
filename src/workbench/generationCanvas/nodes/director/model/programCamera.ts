/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorCamera、./timeGrid 的 FRAME_EPSILON
 * [OUTPUT]: 对外提供 orderedCameraIds、cameraHasCoverageAt、programCameraIdAt
 * [POS]: director/model 的「节目机位」选择器（清单 §6 C5）：多机位剪辑的切换规则 —— 按轨道顺序优先，取第一台在时刻 t
 *        有路径/特写片段覆盖的机位；没有则黑场（null）。画中画、录像逐帧、PiP 头部读数都只认它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorCamera } from './directorTypes'
import { FRAME_EPSILON } from './timeGrid'

// 轨道顺序 → 机位 id 序列：在顺序表里的按表序，不在表里的按机位数组顺序追加
export function orderedCameraIds(cameras: DirectorCamera[], trackOrder: string[]): string[] {
  const cameraIds = new Set(cameras.map((camera) => camera.id))
  const ordered = trackOrder.filter((id) => cameraIds.has(id))
  const seen = new Set(ordered)
  for (const camera of cameras) {
    if (!seen.has(camera.id)) ordered.push(camera.id)
  }
  return ordered
}

export function cameraHasCoverageAt(camera: DirectorCamera, time: number, epsilon: number = FRAME_EPSILON): boolean {
  const clips = [...(camera.trajectoryClips ?? []), ...(camera.closeupClips ?? [])]
  return clips.some((clip) => time >= clip.startTime - epsilon && time <= clip.endTime + epsilon)
}

// 时刻 t 的节目机位 id；无覆盖 → null（黑场）
export function programCameraIdAt(time: number, cameras: DirectorCamera[], trackOrder: string[]): string | null {
  if (cameras.length === 0) return null
  const byId = new Map(cameras.map((camera) => [camera.id, camera]))
  for (const id of orderedCameraIds(cameras, trackOrder)) {
    const camera = byId.get(id)
    if (camera && cameraHasCoverageAt(camera, time)) return id
  }
  return null
}
