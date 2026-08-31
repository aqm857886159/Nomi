// 视频 → 音轨（单声道 16k mp3）→ 项目缓存 nomi-local:// URL。
//
// 为什么需要它：转写（whisper-1）本身在 Nomi 里**早就接好了**（audioTaskRunner.runTranscribe，
// 已请求 verbose_json 且把整个 json 存进 raw，带时间戳的 segments 没被丢），但全仓**没有任何
// 「从视频里取音轨」的代码路径**（grep extractAudio / -vn 零命中）。这就是视频拆解链路上唯一
// 缺的那一段——补上它，「视频 → 口播文字 + 时间戳」就通了。
//
// 参数为什么是 单声道/16kHz/64kbps：whisper 内部就重采样到 16k 单声道，给更高的没用只是变大；
// 64kbps 实测 82 秒视频出 644 KB（whisper 侧上限 25MB），语音清晰度绰绰有余。
//
// 落 `.nomi/cache/audio-track/` **不进素材库**：可再生的中间产物，写进素材库会把用户的库刷屏
// （胶片条栽过这条，见 projectCacheFile.ts）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { probeMediaMetadata } from "../export/mediaProbe";
import { writeProjectCacheFile } from "../assets/projectCacheFile";
import { resolveVideoLocalPath } from "./extractVideoFrame";

/** 音频编码参数（同时是 buildAudioTrackArgs 的真相源，单测钉住）。 */
export const AUDIO_TRACK_SAMPLE_RATE = 16_000;
export const AUDIO_TRACK_CHANNELS = 1;
export const AUDIO_TRACK_BITRATE = "64k";

/** whisper 侧硬上限 25MB；64kbps ≈ 8KB/s → 约 52 分钟。超了先说人话，别让用户等到 API 报错。 */
export const AUDIO_TRACK_MAX_SECONDS = 3000;

export type ExtractAudioTrackPayload = {
  videoUrl: string;
  projectId: string;
  forceRerun?: boolean;
};

export type ExtractAudioTrackResult = {
  /** 无音轨时为空串——调用方据此跳过转写，**不是错误**。 */
  url: string;
  hasAudio: boolean;
  durationSeconds: number;
};

export class AudioTrackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioTrackError";
  }
}

const trackCache = new Map<string, ExtractAudioTrackResult>();
const cacheKey = (p: ExtractAudioTrackPayload) => `${p.projectId}::${p.videoUrl}`;

/** 纯函数，便于单测钉住编码参数不被随手改坏。 */
export function buildAudioTrackArgs(inputPath: string, outPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vn",
    "-ac", String(AUDIO_TRACK_CHANNELS),
    "-ar", String(AUDIO_TRACK_SAMPLE_RATE),
    "-b:a", AUDIO_TRACK_BITRATE,
    outPath,
  ];
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new AudioTrackError(`ffmpeg 取音轨失败（code ${code}）：${stderr.trim().slice(-300) || "(无 stderr)"}`));
    });
  });
}

/**
 * 取音轨。**没有音轨不是错误**——广告片常是纯画面或只有背景音乐，
 * 这时返回 `hasAudio:false`，让拆解继续跑（对白列留空），而不是把整条链炸掉。
 */
export async function extractAudioTrack(payload: ExtractAudioTrackPayload): Promise<ExtractAudioTrackResult> {
  const { videoUrl, projectId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new AudioTrackError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new AudioTrackError("缺少 projectId");

  if (!payload.forceRerun) {
    const cached = trackCache.get(cacheKey(payload));
    if (cached) return cached;
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new AudioTrackError("找不到 ffmpeg 可执行文件");

  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  const outPath = path.join(os.tmpdir(), `nomi-audio-${crypto.randomUUID()}.mp3`);
  try {
    const meta = await probeMediaMetadata(filePath);
    const durationSeconds = typeof meta.durationSeconds === "number" && Number.isFinite(meta.durationSeconds)
      ? meta.durationSeconds
      : 0;

    if (!meta.hasAudio) {
      const silent: ExtractAudioTrackResult = { url: "", hasAudio: false, durationSeconds };
      trackCache.set(cacheKey(payload), silent);
      return silent;
    }
    if (durationSeconds > AUDIO_TRACK_MAX_SECONDS) {
      throw new AudioTrackError(
        `视频太长（${Math.round(durationSeconds / 60)} 分钟），转写单次最多约 ${Math.round(AUDIO_TRACK_MAX_SECONDS / 60)} 分钟。先剪短再拆。`,
      );
    }

    await runFfmpeg(ffmpegPath, buildAudioTrackArgs(filePath, outPath));
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new AudioTrackError("ffmpeg 未产出有效音轨");
    }
    const bytes = fs.readFileSync(outPath);
    const written = writeProjectCacheFile(projectId, bytes, "audio-track", ".mp3");
    const result: ExtractAudioTrackResult = { url: written.url, hasAudio: true, durationSeconds };
    trackCache.set(cacheKey(payload), result);
    return result;
  } finally {
    cleanup();
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* non-fatal */ }
  }
}

/** 测试用：清缓存。 */
export function resetAudioTrackCacheForTests(): void {
  trackCache.clear();
}
