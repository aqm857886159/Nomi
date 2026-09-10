/**
 * [INPUT]: 无依赖
 * [OUTPUT]: 对外提供 frameTimes
 * [POS]: director/agent 的运镜 N 帧采样时刻表（原 V1 cameraMoveSchedule，切换门入籍）：把 [startTime, endTime] 均匀切成 count 个播放头时刻（含两端）；
 *        CameraMoveCaptureHost 据此逐帧 seek 采帧。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function frameTimes(startTime: number, endTime: number, count: number): number[] {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0) return []
  if (n === 1) return [startTime]
  const span = endTime - startTime
  return Array.from({ length: n }, (_, i) => startTime + (i / (n - 1)) * span)
}
