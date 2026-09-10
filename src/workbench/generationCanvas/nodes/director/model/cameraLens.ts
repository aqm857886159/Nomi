/**
 * [INPUT]: 依赖 ./directorTypes 的 DirectorCamera
 * [OUTPUT]: 对外提供 FRAME_GUIDE_PADDING / frameGuideSize、 SENSOR_HEIGHT_MM / FOCAL_MM_MIN / FOCAL_MM_MAX / DEFAULT_FOV_DEG、focalMmToFov、fovToFocalMm、
 *           syncFocalLength、LENS_PRESETS
 * [POS]: director/model 的镜头换算单一真相：竖直 FOV ↔ 焦段 mm（35mm 全幅等效、片高 24mm，与 V1 scene3dMath 同公式；
 *        V1 上限 200mm，V2 放宽到 300mm 且不改 V1）。fov 是存储真相，focalLengthMm 只是派生缓存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorCamera } from './directorTypes'

export const SENSOR_HEIGHT_MM = 24
export const FOCAL_MM_MIN = 12
export const FOCAL_MM_MAX = 300
export const DEFAULT_FOCAL_MM = 50
export const DEFAULT_FOV_DEG = 50

const DEG = 180 / Math.PI

export function clampFocalMm(mm: number): number {
  return Math.min(FOCAL_MM_MAX, Math.max(FOCAL_MM_MIN, mm))
}

// 焦段 mm → 竖直 FOV（度，保留 2 位；长焦端 1° 内差好几档 mm，1 位小数会让往返漂档）
export function focalMmToFov(mm: number): number {
  const clamped = clampFocalMm(mm)
  return Number((2 * Math.atan(SENSOR_HEIGHT_MM / (2 * clamped)) * DEG).toFixed(2))
}

// 竖直 FOV → 焦段 mm（保留 1 位）
export function fovToFocalMm(fov: number): number {
  if (fov <= 0) return DEFAULT_FOCAL_MM
  const mm = SENSOR_HEIGHT_MM / (2 * Math.tan((fov / DEG) / 2))
  return Number(clampFocalMm(mm).toFixed(1))
}

// 以 fov 为真相刷新派生的 focalLengthMm（缺 fov 时按默认 50° 补），返回同一对象
// 导出画幅字符串 → 宽高比；free 返回 null（不裁、不补偿）
export function exportAspectRatio(ratio: string): number | null {
  if (ratio === 'free') return null
  const [w, h] = ratio.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : null
}

/** 取景框内边距（px），主视口与 FOV 补偿共用 */
export const FRAME_GUIDE_PADDING = 80

/**
 * 视口里减去四周 pad 后，按导出画幅装进去的取景框尺寸（free 画幅 = 无框）。
 */
export function frameGuideSize(viewportWidth: number, viewportHeight: number, exportAspect: number | null, padding: number = FRAME_GUIDE_PADDING): { width: number; height: number } {
  const innerW = Math.max(0, viewportWidth - padding * 2)
  const innerH = Math.max(0, viewportHeight - padding * 2)
  if (!exportAspect || innerW === 0 || innerH === 0) return { width: 0, height: 0 }
  let width = innerW
  let height = innerW / exportAspect
  if (height > innerH) {
    height = innerH
    width = height * exportAspect
  }
  return { width, height }
}

// POV 下的 FOV 补偿：取景框比视口矮，主相机的竖直 FOV 要放大到 fov'，
// 让框内那一段刚好等于机位自己的 fov：fov' = 2·atan(tan(fov/2) · H / guideH)
export function povVerticalFov(cameraFov: number, exportAspect: number | null, viewportWidth: number, viewportHeight: number): number {
  const guide = frameGuideSize(viewportWidth, viewportHeight, exportAspect)
  if (guide.height <= 0 || viewportHeight <= guide.height) return cameraFov
  const scale = viewportHeight / guide.height
  return Math.min(170, (Math.atan(Math.tan((cameraFov * Math.PI) / 360) * scale) * 360) / Math.PI)
}

export function syncFocalLength<T extends Pick<DirectorCamera, 'fov' | 'focalLengthMm'>>(camera: T): T {
  const fov = Number.isFinite(camera.fov) && camera.fov > 0 ? camera.fov : DEFAULT_FOV_DEG
  camera.fov = fov
  camera.focalLengthMm = fovToFocalMm(fov)
  return camera
}

// 常用焦段（清单 §4.2：超广角 16 / 广角 24 / 人文 35 / 标准 50 / 人像 85 / 微距 100 / 特写 135 / 远摄 200）
export const LENS_PRESETS = [
  { id: 'ultra_wide', mm: 16 },
  { id: 'wide', mm: 24 },
  { id: 'humanist', mm: 35 },
  { id: 'standard', mm: 50 },
  { id: 'portrait', mm: 85 },
  { id: 'macro', mm: 100 },
  { id: 'closeup', mm: 135 },
  { id: 'tele', mm: 200 },
] as const
export type LensPresetId = (typeof LENS_PRESETS)[number]['id']
