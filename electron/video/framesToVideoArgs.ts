// 纯函数：把「一目录 PNG 帧序列 + fps + 输出路径」翻成 ffmpeg image2 → H.264 mp4 的参数数组。
// 抽成纯 inputs→args 的小 builder，配单测 framesToVideoArgs.test.ts 锁参数（不跑真 ffmpeg）。
// 与 export/ffmpegCommandBuilder.ts 同口径：libx264 + yuv420p + +faststart。
// 供 AI 运镜工具的 N 帧捕获把灰模型运镜拼成参考小片（见 docs/plan/2026-06-22-ai-camera-move-tool.md S2）。

export type FramesToVideoArgsInput = {
  /** 帧序列文件名模板（image2 的 -i pattern），如 /tmp/xxx/frame-%05d.png。 */
  framePattern: string;
  /** 输出 mp4 绝对路径。 */
  outputPath: string;
  /** 帧率（帧/秒）。读取与输出同一帧率 → 时长 = frameCount / fps。 */
  fps: number;
};

export function assertPositiveFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid frames-to-video ${name}: ${value}`);
  }
}

/** image2 序列 → H.264 mp4（yuv420p、+faststart、偶数尺寸兜底）。纯函数，inputs→args。 */
export function buildFramesToVideoArgs(input: FramesToVideoArgsInput): string[] {
  if (!input.framePattern) throw new Error("Invalid frames-to-video framePattern");
  if (!input.outputPath) throw new Error("Invalid frames-to-video outputPath");
  assertPositiveFiniteNumber(input.fps, "fps");

  return [
    "-y",
    "-framerate", String(input.fps),
    "-i", input.framePattern,
    // 宽高补成偶数（libx264 + yuv420p 要求），居中黑边兜异常尺寸。
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-r", String(input.fps),
    "-movflags", "+faststart",
    input.outputPath,
  ];
}
