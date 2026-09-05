/**
 * 时码格式化的单一 owner（合同 §2.8：用户读秒和时码，帧是工程单位）。
 *
 * 之前这段逻辑有两份手抄（属性面板一份 `MM:SS`、计划摘要一份 `M:SS.ss`），
 * 于是同一条片段在两个地方读出两个数。任何要给**用户**看的时间都从这里取。
 */

/** 帧 → `0:04`。给 chip、标尺这类只需要「大概在哪」的地方。 */
export function timelineTimecode(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const total = Math.max(0, Math.round(frame)) / safeFps
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(Math.floor(total - minutes * 60)).padStart(2, '0')}`
}

/** 帧 → `0:03.00`。给属性面板的「起点」这类要精确对齐的读数。 */
export function timelineTimecodePrecise(frame: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30
  const total = Math.max(0, frame) / safeFps
  const minutes = Math.floor(total / 60)
  return `${minutes}:${(total - minutes * 60).toFixed(2).padStart(5, '0')}`
}

/** 帧长 → 秒数字符串（不带单位，调用方自己拼 i18n 的「秒」）。 */
export function timelineSeconds(frames: number, fps: number, digits = 2): string {
  const safeFps = fps > 0 ? fps : 30
  return (Math.abs(frames) / safeFps).toFixed(digits)
}
