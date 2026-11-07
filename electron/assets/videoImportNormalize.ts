// 导入视频「可播放归一化」（2026-07-28 群反馈根治：上传参考视频灰壳/0:00/播放键失灵）。
//
// 根因：导入链路只按 MIME 前缀放行，落盘零 codec 探测——手机 HEVC/H.265、AVI/MPEG 容器等
// Chromium 解不了的视频进了画布，原生 <video> 静默解码失败（loadedmetadata 永不触发）。
// ffprobe/ffmpeg 本就打包随附（导出/抽帧在用），导入却一次没碰。此处补上：落盘前探测，
// Chromium 播不了的转成 H.264+AAC MP4（顺带提升 vendor 参考上传兼容性——HEVC mov 不少供应商也拒收）。
//
// 与导出域的 transcodeWebmToMp4 不是并行版：那是「时间轴产物 → 交付 MP4」（导出 profile、强制无声、
// 进度回调）；这里是「任意外来视频 → 可预览资产」（保留音轨、无 profile、失败必须回退原样不挡导入）。
//
// 进程的主人是共享的有界运行器 runBoundedProcess（2026-10-27）：取消 / 窗口没了 / 退出都杀整个进程组、
// 删半成品；取消不是失败，不回退原样、不发布半成品。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { progressFromOutTime } from "../export/ffmpegProgress";
import {
  BoundedProcessError,
  isFfmpegProgressLine,
  probeMediaMetadata,
  runBoundedProcess,
  type MediaProbeMetadata,
} from "../export/mediaProbe";
import { registerInflightProbe } from "../inflightProbe";
import { logWarn } from "../logging/logger";
import { removeScratchAfterUse, removeScratchAfterUseSync } from "./scratchCleanup";
import { playableVideoCodecs } from "./videoPlaybackSupport";

// 容器与音频仍按 Chromium 跨平台稳解的安全集判。**视频 codec 不再是常量**：
// 2026-09-14 起问本机（videoPlaybackSupport，渲染层 MediaSource.isTypeSupported 探测结果）——
// 原来的 hardcode 白名单刻意排除 HEVC「按最差平台归一」，代价是本机 55–110ms 就能播的片子
// 要白等十几分钟的整段转码。无音轨视为可播。
const PLAYABLE_CONTAINER_EXTS = new Set(["mp4", "m4v", "mov", "webm", "ogg", "ogv"]);
const PLAYABLE_AUDIO_CODECS = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

// 只换容器时，哪些流能原样进 MP4、进去以后 Chromium 还放得了（2026-10-27，打包 ffmpeg 的 MP4 封装器实测 + 源码）：
// · 视频：VP8 进不了 MP4（封装器直接拒）；H.264 / HEVC / VP9 / AV1 能进，前提是本机能放这个 codec。
// · 音频：FLAC 进 MP4 要 `-strict -2`；Vorbis 换得进，但 Chromium 的 MP4 路径不保证认；
//   Opus 在 macOS arm64 包（ffmpeg 4.4）里放行，在 Windows / Linux / Intel Mac 包（ffmpeg 4.1，movenc.c 的 mov_init）
//   里同样要 `-strict -2`——Windows 恰是最常需要转码的平台，所以按保守的转 AAC（音频转码只花几秒）。
// 不在集合里的：视频走整段重编码，音频转 AAC。不加 profile / 像素格式判据。
const MP4_COPY_VIDEO_CODECS = new Set(["h264", "hevc", "vp9", "av1"]);
const MP4_COPY_AUDIO_CODECS = new Set(["aac", "mp3"]);

/** 该视频要不要归一化。返回原因串（记进资产 meta / 日志），null = 本就可播。 */
export function videoNeedsPlayabilityTranscode(
  fileName: string,
  probe: MediaProbeMetadata,
  playableCodecs: ReadonlySet<string> = playableVideoCodecs(),
): string | null {
  const ext = path.extname(String(fileName || "")).replace(/^\./, "").toLowerCase();
  const videoCodec = (probe.videoCodec || "").toLowerCase();
  if (!playableCodecs.has(videoCodec)) return `codec:${videoCodec || "unknown"}`;
  if (!PLAYABLE_CONTAINER_EXTS.has(ext)) return `container:${ext || "unknown"}`;
  if (probe.hasAudio) {
    const audioCodec = (probe.audioCodec || "").toLowerCase();
    if (!PLAYABLE_AUDIO_CODECS.has(audioCodec)) return `audio:${audioCodec || "unknown"}`;
  }
  return null;
}

/** 归一化怎么做：`copy` = 原样换进 MP4；`encode` = libx264 整段重编码；`aac` = 音轨转 AAC。 */
export type PlayableMp4Plan = { video: "copy" | "encode"; audio: "copy" | "aac" };

/**
 * 要归一化（reason 非 null）时怎么换。视频 codec 本机能放、且能原样进 MP4 → 只换容器；
 * 音轨不在可原样拷贝的集合 → 只把音频转 AAC。其余整段重编码（音频一并转 AAC）。
 */
export function playableMp4Plan(
  reason: string,
  probe: MediaProbeMetadata,
  playableCodecs: ReadonlySet<string> = playableVideoCodecs(),
): PlayableMp4Plan {
  const videoCodec = (probe.videoCodec || "").toLowerCase();
  const videoCopy = !reason.startsWith("codec:")
    && reason !== "probe_failed"
    && playableCodecs.has(videoCodec)
    && MP4_COPY_VIDEO_CODECS.has(videoCodec);
  if (!videoCopy) return { video: "encode", audio: "aac" };
  const audioCopy = !probe.hasAudio || MP4_COPY_AUDIO_CODECS.has((probe.audioCodec || "").toLowerCase());
  return { video: "copy", audio: audioCopy ? "copy" : "aac" };
}

export function maxTranscodeThreads(cpuCount = os.cpus().length): number {
  return Math.max(1, Math.floor(cpuCount) - 2);
}

const MIN_TRANSCODE_TIMEOUT_MS = 30 * 60 * 1000;
const TRANSCODE_TIMEOUT_MS_PER_SOURCE_SECOND = 10 * 1000;
const UNKNOWN_DURATION_TRANSCODE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * 一次归一化最多跑多久。慢机器软编 4K 只有 0.2–0.3 倍速，写死 30 分钟会把 9 分钟的片子按超时杀掉、
 * 退回放不了的原片；所以按片长给 10 倍余量，不低于 30 分钟；探不到片长给 2 小时。
 * 用户随时可以放弃（切项目 / 关窗口 / 退出），那条信号会停掉它，这里只兜「卡死」。
 */
export function transcodeTimeoutMs(durationSeconds: number | undefined): number {
  if (!(typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0)) {
    return UNKNOWN_DURATION_TRANSCODE_TIMEOUT_MS;
  }
  return Math.max(MIN_TRANSCODE_TIMEOUT_MS, Math.ceil(durationSeconds * TRANSCODE_TIMEOUT_MS_PER_SOURCE_SECOND));
}

/** 整段重编码参数（H.264+AAC MP4，faststart 便于流式预览；奇数边夹到偶数满足 libx264）。纯函数，可单测。 */
export function transcodeArgsForPlayableMp4(inputPath: string, outputPath: string, threads = maxTranscodeThreads()): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-threads", String(Math.max(1, Math.floor(threads))),
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

/**
 * 只换容器的参数：视频流原样拷；音轨只取第一条（探测判的就是它，多条音轨各判各的会让 copy 拷进进不了 MP4 的那条），
 * 拷不了就转 AAC。纯函数，可单测。
 */
export function remuxArgsForPlayableMp4(inputPath: string, outputPath: string, audioCopy: boolean): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
    "-c:v", "copy",
    "-c:a", audioCopy ? "copy" : "aac",
    "-movflags", "+faststart",
    outputPath,
  ];
}

export function playableMp4FileName(fileName: string): string {
  const base = path.basename(String(fileName || "video"), path.extname(String(fileName || "")));
  return `${base || "video"}.mp4`;
}

type VideoNormalizeOptions = {
  signal?: AbortSignal;
  /**
   * 转换进度（0..1）。一开始报一次 0（= 开始转换）；之后只有探到片长才报比例、跑完报 1。
   * 片长未知时只有开头那个 0——不编一个比例，界面据此显示不带百分比的「转换格式」。
   */
  onProgress?: (ratio: number) => void;
  playableCodecs?: ReadonlySet<string>;
};

export function isVideoNormalizationCancelled(error: unknown): boolean {
  return error instanceof BoundedProcessError && error.code === "cancelled";
}

// 在途的导入转码（连同它用的临时目录），不管从哪扇门进来：界面导入、拷贝文件、懒自愈、Agent 的 asset.import。
// 退出排空按这张表停进程、等收尾——调用方传没传信号、那个信号接没接到退出，都不影响它被停掉
// （Agent 那扇门的请求信号过不了回环 RPC 的 JSON，到这里就没了）。
const inflightTranscodes = new Map<AbortController, Promise<void>>();
let acceptingTranscodes = true;

async function abortInflightTranscodes(): Promise<number> {
  const pending = [...inflightTranscodes.entries()];
  for (const [controller] of pending) controller.abort();
  await Promise.all(pending.map(([, settled]) => settled));
  return pending.length;
}

registerInflightProbe("video-import-transcodes", {
  count: () => inflightTranscodes.size,
  settle: async () => { await abortInflightTranscodes(); },
});

/**
 * 应用退出：此后不再起新的导入转码；在途的全部中止（杀进程组、删半成品和临时目录）并等它们落定。返回停了几件。
 * 幂等：退出排空会先「立刻停」、再在收尾链里「等落定」，各调一次。
 */
export async function stopVideoImportTranscodes(): Promise<number> {
  acceptingTranscodes = false;
  return abortInflightTranscodes();
}

/** Vitest 隔离用：把退出排空关上的门重新打开（生产里退出了就不再开）。 */
export function resetVideoImportTranscodesForTests(): void {
  acceptingTranscodes = true;
}

/** 一段导入转码登记进在途表：中止信号 = 调用方的 + 退出排空的；连收尾都做完才出表。 */
async function trackImportTranscode<T>(callerSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (!acceptingTranscodes) throw new BoundedProcessError("cancelled");
  const owner = new AbortController();
  let settle: () => void = () => undefined;
  inflightTranscodes.set(owner, new Promise<void>((resolve) => { settle = resolve; }));
  try {
    return await work(callerSignal ? AbortSignal.any([callerSignal, owner.signal]) : owner.signal);
  } finally {
    inflightTranscodes.delete(owner);
    settle();
  }
}

/**
 * 导入转码用的系统临时目录：建、用、删整段登记在在途表里，退出排空等它连目录一起删完才算落定。
 * 产物还要拿去落进项目（读字节 / 拷进项目）的调用方用它，不要自己 mkdtemp——自己建的目录退出时没人等。
 */
export function withVideoImportScratchDir<T>(
  prefix: string,
  signal: AbortSignal | undefined,
  work: (scratchDir: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return trackImportTranscode(signal, async (scoped) => {
    const scratchDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
    try {
      return await work(scratchDir, scoped);
    } finally {
      await removeScratchAfterUse(scratchDir);
    }
  });
}

/** ffmpeg 非 0 退出时给日志的一句话：stderr 里混着进度记录，挑最后几行真正的错误。 */
function ffmpegFailureMessage(stderr: string, code: number | null): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !isFfmpegProgressLine(line));
  return lines.slice(-3).join(" ") || `ffmpeg exited with code ${code}`;
}

/**
 * 磁盘上的视频文件 → 可播放判定 + 需要则只换容器或整段重编码。返回产物路径与原因；本就可播 → null。
 * 探测失败按「未知即转」处理（转不动再由调用方回退）：探测挂掉的文件多半 <video> 也解不了。
 * 这是导入 ffmpeg 的唯一启动口；每一次都登记在在途表里，退出时不论从哪扇门来都停得掉。
 */
export function transcodeFileToPlayableMp4IfNeeded(
  inputPath: string,
  fileName: string,
  outputDir = path.dirname(inputPath),
  options: VideoNormalizeOptions = {},
): Promise<{ outputPath: string; reason: string } | null> {
  return trackImportTranscode(options.signal, (signal) => normalizeToPlayableMp4(inputPath, fileName, outputDir, { ...options, signal }));
}

async function normalizeToPlayableMp4(
  inputPath: string,
  fileName: string,
  outputDir: string,
  options: VideoNormalizeOptions & { signal: AbortSignal },
): Promise<{ outputPath: string; reason: string } | null> {
  const { signal } = options;
  const playableCodecs = options.playableCodecs ?? playableVideoCodecs();
  let reason: string | null;
  let probe: MediaProbeMetadata;
  try {
    probe = await probeMediaMetadata(inputPath, { signal });
    reason = videoNeedsPlayabilityTranscode(fileName, probe, playableCodecs);
  } catch {
    // 探测被同一个信号截断 = 这次导入被放弃，不是「探测失败」。
    if (signal.aborted) throw new BoundedProcessError("cancelled");
    reason = "probe_failed";
    probe = { kind: "video", hasAudio: false };
  }
  if (!reason) return null;

  const outputPath = path.join(
    outputDir,
    `${path.basename(inputPath, path.extname(inputPath))}-playable.mp4`,
  );
  const plan = playableMp4Plan(reason, probe, playableCodecs);
  const args = plan.video === "encode"
    ? transcodeArgsForPlayableMp4(inputPath, outputPath)
    : remuxArgsForPlayableMp4(inputPath, outputPath, plan.audio === "copy");
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg executable could not be resolved");
  const durationMs = typeof probe.durationSeconds === "number" && probe.durationSeconds > 0 ? probe.durationSeconds * 1000 : undefined;

  try {
    options.onProgress?.(0);
    // -loglevel error：只留真正的错误，警告刷屏不再挤占 stderr；进度走 -progress，tail 模式不因量杀进程。
    const result = await runBoundedProcess(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:2", ...args], {
      timeoutMs: transcodeTimeoutMs(probe.durationSeconds),
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 128 * 1024,
      stderrMode: "tail",
      lowPriority: plan.video === "encode",
      signal,
      ...(options.onProgress && durationMs !== undefined
        ? { onProgress: (progress: { outTimeMs?: number }) => {
          if (progress.outTimeMs !== undefined) options.onProgress?.(progressFromOutTime(progress.outTimeMs, durationMs));
        } }
        : {}),
    });
    if (signal.aborted) throw new BoundedProcessError("cancelled");
    if (result.code !== 0) throw new Error(ffmpegFailureMessage(result.stderr, result.code));
    const stat = fs.statSync(outputPath);
    if (!stat.isFile() || stat.size <= 0) throw new Error("transcoded mp4 is empty");
    if (durationMs !== undefined) options.onProgress?.(1);
    return { outputPath, reason };
  } catch (error) {
    // 失败和取消都不留半成品；取消时 runBoundedProcess 已经杀掉整个进程组（拒成 cancelled）。
    // 清理失败（Windows 上被杀毒 / 同步盘短暂占用）只记日志，不改写上面那个错误。
    removeScratchAfterUseSync(outputPath);
    throw error;
  }
}

export type NormalizedVideoImport = {
  bytes: Buffer;
  fileName: string;
  contentType: string;
  /** 非 null = 已归一化，值为原因（codec:hevc / container:mkv / audio:ac3 / probe_failed）。 */
  playbackNormalizedFrom: string | null;
};

/**
 * 导入字节流的归一化入口（importLocalFile 调）。任何一步失败都回退原字节——绝不挡导入；
 * 真播不了时由渲染侧播放守卫（NodeVideoPlaybackGuard）诚实报错 + 懒自愈兜底。
 * 取消不是失败：沿信号抛出，临时目录照删（退出排空等它删完）。
 */
export async function ensurePlayableVideoBytes(
  bytes: Buffer,
  fileName: string,
  contentType: string,
  options: VideoNormalizeOptions = {},
): Promise<NormalizedVideoImport> {
  const passthrough: NormalizedVideoImport = { bytes, fileName, contentType, playbackNormalizedFrom: null };
  try {
    return await withVideoImportScratchDir("nomi-video-import-", options.signal, async (tempDir, signal) => {
      const ext = path.extname(String(fileName || "")) || ".bin";
      const inputPath = path.join(tempDir, `source${ext}`);
      fs.writeFileSync(inputPath, bytes);
      const transcoded = await transcodeFileToPlayableMp4IfNeeded(inputPath, fileName, tempDir, { ...options, signal });
      if (!transcoded) return passthrough;
      return {
        bytes: fs.readFileSync(transcoded.outputPath),
        fileName: playableMp4FileName(fileName),
        contentType: "video/mp4",
        playbackNormalizedFrom: transcoded.reason,
      };
    });
  } catch (error) {
    if (options.signal?.aborted || isVideoNormalizationCancelled(error)) throw error;
    logWarn("assets", "video-normalize-failed-import-original-bytes", undefined, error);
    return passthrough;
  }
}
