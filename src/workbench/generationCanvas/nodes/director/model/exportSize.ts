/**
 * [INPUT]: 依赖 ./directorTypes（DirectorExportRatio / DirectorExportResolution）、./cameraLens 的 exportAspectRatio
 * [OUTPUT]: 对外提供 exportDimensions(ratio, resolution, viewportAspect?) → { width, height }、DIRECTOR_EXPORT_FPS、DIRECTOR_EXPORT_MAX_FRAMES、exportFrameCount
 * [POS]: director/model 的出片尺寸与帧数单一真相（清单 §4.7）：分辨率档位给短边像素（1080 / 1440 / 2160），画幅比给宽高比（free = 当前视口比），
 *        宽高都取偶数（ffmpeg yuv420p 要求）；MP4 30fps、总帧 = 内容末 × 30、上限 1800（60s）。截图与录像共用。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { exportAspectRatio } from './cameraLens'
import type { DirectorExportRatio, DirectorExportResolution } from './directorTypes'

export const DIRECTOR_EXPORT_FPS = 30
export const DIRECTOR_EXPORT_MAX_FRAMES = 1800

const SHORT_SIDE: Record<DirectorExportResolution, number> = { '1080': 1080, '1440': 1440, '4k': 2160 }

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function exportDimensions(ratio: DirectorExportRatio, resolution: DirectorExportResolution, viewportAspect: number = 16 / 9): { width: number; height: number } {
  const aspect = ratio === 'free' ? Math.max(0.1, viewportAspect) : (exportAspectRatio(ratio) ?? 16 / 9)
  const short = SHORT_SIDE[resolution] ?? 1080
  return aspect >= 1 ? { width: even(short * aspect), height: even(short) } : { width: even(short), height: even(short / aspect) }
}

// 内容末（秒）→ 帧数：至少 1 帧，封顶 1800
export function exportFrameCount(contentEndSeconds: number): number {
  return Math.min(DIRECTOR_EXPORT_MAX_FRAMES, Math.max(1, Math.ceil(contentEndSeconds * DIRECTOR_EXPORT_FPS)))
}
