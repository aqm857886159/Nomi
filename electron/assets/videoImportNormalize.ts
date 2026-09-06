// 导入视频「可播放归一化」（2026-07-28 群反馈根治：上传参考视频灰壳/0:00/播放键失灵）。
//
// 根因：导入链路只按 MIME 前缀放行，落盘零 codec 探测——手机 HEVC/H.265、AVI/MPEG 容器等
// Chromium 解不了的视频进了画布，原生 <video> 静默解码失败（loadedmetadata 永不触发）。
// ffprobe/ffmpeg 本就打包随附（导出/抽帧在用），导入却一次没碰。此处补上：落盘前探测，
// Chromium 播不了的转成 H.264+AAC MP4（顺带提升 vendor 参考上传兼容性——HEVC mov 不少供应商也拒收）。
//
// 与导出域的 transcodeWebmToMp4 不是并行版：那是「时间轴产物 → 交付 MP4」（导出 profile、强制无声、
// 进度回调）；这里是「任意外来视频 → 可预览资产」（保留音轨、无 profile、失败必须回退原样不挡导入）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { probeMediaMetadata, type MediaProbeMetadata } from "../export/mediaProbe";
import { logWarn } from "../logging/logger";

// Chromium 跨平台稳解的安全集（HEVC 刻意排除：macOS 部分硬解、Windows 默认不行——按最差平台归一，
// 行为跨平台一致）。音频宽松列常见可播集；无音轨视为可播。
const PLAYABLE_CONTAINER_EXTS = new Set(["mp4", "m4v", "mov", "webm", "ogg", "ogv"]);
const PLAYABLE_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PLAYABLE_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/** 该视频要不要转码。返回原因串（记进资产 meta / 日志），null = 本就可播。纯函数，可单测。 */
export function videoNeedsPlayabilityTranscode(fileName: string, probe: MediaProbeMetadata): string | null {
  const ext = path.extname(String(fileName || "")).replace(/^\./, "").toLowerCase();
  if (!PLAYABLE_CONTAINER_EXTS.has(ext)) return `container:${ext || "unknown"}`;
  const videoCodec = (probe.videoCodec || "").toLowerCase();
  if (!PLAYABLE_VIDEO_CODECS.has(videoCodec)) return `codec:${videoCodec || "unknown"}`;
  if (probe.hasAudio) {
    const audioCodec = (probe.audioCodec || "").toLowerCase();
    if (!PLAYABLE_AUDIO_CODECS.has(audioCodec)) return `audio:${audioCodec || "unknown"}`;
  }
  return null;
}

/** 转码参数（H.264+AAC MP4，faststart 便于流式预览；奇数边夹到偶数满足 libx264）。纯函数，可单测。 */
export function transcodeArgsForPlayableMp4(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    outputPath,
  ];
}

function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return Promise.reject(new Error("ffmpeg executable could not be resolved"));
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || `ffmpeg exited with code ${code}`));
    });
  });
}

export function playableMp4FileName(fileName: string): string {
  const base = path.basename(String(fileName || "video"), path.extname(String(fileName || "")));
  return `${base || "video"}.mp4`;
}

/**
 * 磁盘上的视频文件 → 可播放判定 + 需要则转码。返回转码产物路径与原因；本就可播 → null。
 * 探测失败按「未知即转」处理（转不动再由调用方回退）：探测挂掉的文件多半 <video> 也解不了。
 */
export async function transcodeFileToPlayableMp4IfNeeded(
  inputPath: string,
  fileName: string,
  outputDir = path.dirname(inputPath),
): Promise<{ outputPath: string; reason: string } | null> {
  let reason: string | null;
  try {
    reason = videoNeedsPlayabilityTranscode(fileName, await probeMediaMetadata(inputPath));
  } catch {
    reason = "probe_failed";
  }
  if (!reason) return null;
  const outputPath = path.join(
    outputDir,
    `${path.basename(inputPath, path.extname(inputPath))}-playable.mp4`,
  );
  await runFfmpeg(transcodeArgsForPlayableMp4(inputPath, outputPath));
  const stat = fs.statSync(outputPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("transcoded mp4 is empty");
  return { outputPath, reason };
}

export type NormalizedVideoImport = {
  bytes: Buffer;
  fileName: string;
  contentType: string;
  /** 非 null = 已转码，值为原因（codec:hevc / container:avi / audio:ac3 / probe_failed）。 */
  playbackNormalizedFrom: string | null;
};

/**
 * 导入字节流的归一化入口（importLocalFile 调）。任何一步失败都回退原字节——绝不挡导入；
 * 真播不了时由渲染侧播放守卫（NodeVideoPlaybackGuard）诚实报错 + 懒自愈兜底。
 */
export async function ensurePlayableVideoBytes(
  bytes: Buffer,
  fileName: string,
  contentType: string,
): Promise<NormalizedVideoImport> {
  const passthrough: NormalizedVideoImport = { bytes, fileName, contentType, playbackNormalizedFrom: null };
  let tempDir = "";
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-video-import-"));
    const ext = path.extname(String(fileName || "")) || ".bin";
    const inputPath = path.join(tempDir, `source${ext}`);
    fs.writeFileSync(inputPath, bytes);
    const transcoded = await transcodeFileToPlayableMp4IfNeeded(inputPath, fileName);
    if (!transcoded) return passthrough;
    return {
      bytes: fs.readFileSync(transcoded.outputPath),
      fileName: playableMp4FileName(fileName),
      contentType: "video/mp4",
      playbackNormalizedFrom: transcoded.reason,
    };
  } catch (error) {
    logWarn("assets", "video-normalize-failed-import-original-bytes", undefined, error);
    return passthrough;
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
