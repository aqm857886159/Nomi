/**
 * Depth video node — deterministic ffmpeg pipeline builders (pure).
 *
 * Builds exact ffmpeg argv for the two media steps of the depth job and
 * computes the raw byte budget for integrity checks. Kept free of child_process
 * so every branch is unit-testable; depthVideoJob.ts is the only place that
 * actually spawns ffmpeg (mirroring framesToVideo.ts usage).
 */

export type VideoDepthRawPixelFormat = "gray" | "rgb24";

/** Extract trim-window frames from the source into sequential JPEGs. */
export function buildExtractFramesArgs(opts: {
  sourcePath: string;
  startSeconds: number;
  durationSeconds: number;
  fps: number;
  outWidth: number;
  outHeight: number;
  outDir: string;
  framePattern?: string;
}): string[] {
  const pattern = opts.framePattern ?? "f_%04d.jpg";
  return [
    "-y",
    "-ss",
    String(opts.startSeconds),
    "-t",
    String(opts.durationSeconds),
    "-i",
    opts.sourcePath,
    "-vf",
    `scale=${opts.outWidth}:${opts.outHeight}`,
    "-r",
    String(opts.fps),
    "-q:v",
    "2",
    `${opts.outDir}/${pattern}`,
  ];
}

/** Encode a rawvideo frame stream into an H.264 mp4. */
export function buildRawToMp4Args(opts: {
  outWidth: number;
  outHeight: number;
  fps: number;
  pixFmt: VideoDepthRawPixelFormat;
  rawPath: string;
  outMp4: string;
}): string[] {
  return [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    opts.pixFmt,
    "-s",
    `${opts.outWidth}x${opts.outHeight}`,
    "-r",
    String(opts.fps),
    "-i",
    opts.rawPath,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    opts.outMp4,
  ];
}

/** Bytes per pixel for a raw pixel format. */
export function rawBytesPerPixel(pixFmt: VideoDepthRawPixelFormat): number {
  return pixFmt === "gray" ? 1 : 3;
}

/** Expected total raw bytes for N frames at the given dimensions/pixel format. */
export function computeExpectedRawBytes(
  frameCount: number,
  outWidth: number,
  outHeight: number,
  pixFmt: VideoDepthRawPixelFormat,
): number {
  return frameCount * outWidth * outHeight * rawBytesPerPixel(pixFmt);
}
