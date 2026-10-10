// 「直接剪辑」的 ffmpeg 参数（纯函数，单测钉住）。
//
// 默认**精确切 + 重编码**（设计卡：docs/plan/2026-10-10-video-clip-direct.md）：
//   · `-ss` 放在 `-i` 之前、重编码时 ffmpeg 会解码到精确帧再开始输出（帧精确），不是「切在最近的关键帧」；
//   · 流拷贝（`-c copy`）快一两个数量级但只能切在关键帧上，入点出点会偏到最近的关键帧，用户在时间轴上拖到哪就该是哪，所以不用；
//   · 保持源分辨率与帧率（不套导出管线的 1080p 档），画面不缩放不补边；音轨有就带上、没有不报错。
export type TrimVideoArgsInput = {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  /** 保留的时长（秒）。 */
  durationSeconds: number;
};

export function buildTrimVideoArgs(input: TrimVideoArgsInput): string[] {
  const start = Math.max(0, input.startSeconds);
  const duration = Math.max(0.04, input.durationSeconds);
  return [
    "-y",
    "-ss", start.toFixed(3),
    "-i", input.inputPath,
    "-t", duration.toFixed(3),
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    input.outputPath,
  ];
}

/** 把剪辑区间夹进视频时长里：入点不早于 0、出点不晚于时长、至少留 0.1 秒。时长未知（<= 0）不夹出点。 */
export function clampTrimRange(startSeconds: number, endSeconds: number, durationSeconds: number): { start: number; end: number } {
  const known = Number.isFinite(durationSeconds) && durationSeconds > 0;
  const start = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
  const rawEnd = Number.isFinite(endSeconds) ? endSeconds : start + 0.1;
  const end = known ? Math.min(rawEnd, durationSeconds) : rawEnd;
  return end - start < 0.1 ? { start: Math.max(0, Math.min(start, (known ? durationSeconds : start + 0.1) - 0.1)), end: Math.max(start, (known ? durationSeconds : start + 0.1)) } : { start, end };
}
