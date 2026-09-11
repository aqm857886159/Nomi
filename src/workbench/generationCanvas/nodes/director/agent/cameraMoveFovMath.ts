/**
 * [INPUT]: 依赖 ./cameraMoveVocab 的 CameraMove
 * [OUTPUT]: 对外提供 dollyZoomCompensatedFov、dollyZoomDistanceScale、zoomFovRamp
 * [POS]: director/agent 的变焦族 FOV 数学（原 V1 cameraMovePreset 的唯一有厚度的部分，切换门入籍）：
 *        zoom_in / zoom_out 给 fov 渐变端点，dolly_zoom 按机位后拉倍率反解「主体成像高度不变」的 fov。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CameraMove } from './cameraMoveVocab'

const DEG = Math.PI / 180
const FOV_MIN = 6
const FOV_MAX = 120

function clampFov(value: number): number {
  return Math.min(FOV_MAX, Math.max(FOV_MIN, Number(value.toFixed(2))))
}

/** 希区柯克补偿：机位距离乘 distanceScale 后，保持主体成像高度不变所需的 fov */
export function dollyZoomCompensatedFov(baseFov: number, distanceScale: number): number {
  const half = Math.tan((baseFov / 2) * DEG) / Math.max(0.01, distanceScale)
  return clampFov((Math.atan(half) * 2) / DEG)
}

/** 希区柯克的机位后拉倍率（随幅度） */
export function dollyZoomDistanceScale(amplitude: number): number {
  return 1 + 0.8 * amplitude
}

/** 变焦族的 fov 渐变端点。非变焦运镜返回 null（不碰 fov） */
export function zoomFovRamp(move: CameraMove, baseFov: number, amplitude: number): { fovFrom: number; fovTo: number } | null {
  switch (move) {
    case 'zoom_in':
      return { fovFrom: clampFov(baseFov), fovTo: clampFov(baseFov * (1 - 0.55 * amplitude)) }
    case 'zoom_out':
      return { fovFrom: clampFov(baseFov), fovTo: clampFov(baseFov * (1 + 1.0 * amplitude)) }
    case 'dolly_zoom':
      return { fovFrom: clampFov(baseFov), fovTo: dollyZoomCompensatedFov(baseFov, dollyZoomDistanceScale(amplitude)) }
    default:
      return null
  }
}
