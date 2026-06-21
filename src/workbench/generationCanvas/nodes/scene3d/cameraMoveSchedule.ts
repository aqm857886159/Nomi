// 运镜 N 帧采样的「时刻表」纯函数：把相机绑定的 [startTime, endTime] 均匀切成 count 个播放头时刻。
// 配单测 cameraMoveSchedule.test.ts 锁取值（端点必含、均匀、count=1 退化）。
// CameraMoveCaptureHost 据此逐帧 cameraWithPlaybackPosition(state, camera, t) 出位姿。

/**
 * 在 [startTime, endTime] 上取 count 个均匀时刻（含两端）。
 * - count <= 1 → [startTime]（单帧退化）。
 * - 否则第 i 个 = startTime + (i/(count-1))*(endTime-startTime)，i ∈ [0, count-1]。
 */
export function frameTimes(startTime: number, endTime: number, count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return [];
  if (n === 1) return [startTime];
  const span = endTime - startTime;
  return Array.from({ length: n }, (_, i) => startTime + (i / (n - 1)) * span);
}
