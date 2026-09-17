/**
 * 本地转写 —— 一次任务的编排：装引擎 → 切片 → 逐段推理 → 折回全局时间轴。
 *
 * 出口形状**与云端 whisper 的 `verbose_json` 完全一致**（`{ text, segments:[{start,end,text}], language }`），
 * 所以拆解那边读 `raw.segments` 的那段代码一个字都不用改，也不存在第二个「转写结果」概念（P1）。
 * 多出来的只有 `detected_language` 一项——硬约束②要求把「引擎听出来是什么语言」摆到结果里。
 *
 * 失败语义：每段失败重试一次；再失败就带着**段号**抛 `LocalSpeechError`，由上层翻成
 * 「第 N 段失败，原因 X，可以重试或改用云端」。**不在这里自动切云端**——那是静默兜底（P1），
 * 而且会让用户在不知情的情况下花钱。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { probeMediaMetadata } from "../export/mediaProbe";
import { logInfo } from "../logging/logger";
import { localSpeechFailure, LocalSpeechError } from "./localSpeechErrors";
import { ensureLocalSpeechReady } from "./localSpeechInstall";
import { LocalSpeechServer } from "./localSpeechServer";
import {
  acceptChunkSegments,
  countChunks,
  joinSegmentText,
  planNextChunk,
  type LocalSpeechSegment,
} from "./localSpeechSegments";
import { WINDOW_SECONDS } from "./localSpeechSegments";
import { localSpeechEngineForPlatform, type LocalSpeechTier } from "../shared/localSpeech/localSpeechAssets";

export type LocalSpeechProgress =
  /**
   * 开跑前报一次。`gpuAccelerated=false` 时这条是**必须说出来的话**：同一段 120 秒音频
   * 在 mac 的 Metal 构建上 10 秒出结果，在 Windows 的 CPU 构建上要 115 秒（2026-09-17 真机实测）。
   * 差一个数量级，不先说清楚，用户只会以为卡死了。
   */
  | { phase: "starting"; estimatedMinutes: number; gpuAccelerated: boolean }
  | { phase: "downloading"; doneBytes: number; totalBytes: number }
  | { phase: "transcribing"; chunkIndex: number; chunkCount: number; doneSeconds: number; totalSeconds: number };

export type LocalSpeechTranscribeInput = {
  /** 音轨的本地绝对路径（`extractAudioTrack` 产出的那份单声道 16k mp3）。 */
  audioFilePath: string;
  tier: LocalSpeechTier;
  onProgress?: (progress: LocalSpeechProgress) => void;
  signal?: AbortSignal;
};

/** 与云端 `verbose_json` 同形状的结果；多一个 `detected_language`。 */
export type LocalSpeechTranscribeResult = {
  text: string;
  segments: LocalSpeechSegment[];
  language: string;
  detected_language: string;
  detected_language_probability: number;
  /** 诚实交付：这份稿子是哪个本地档位出的，UI 可以据此说清质量口径。 */
  local_tier: string;
};

/** 切一段出来喂引擎：16k 单声道 PCM wav —— whisper 内部就是这个采样率，给更高的只是更大。 */
export function buildChunkArgs(inputPath: string, startSeconds: number, lengthSeconds: number, outPath: string): string[] {
  return [
    "-y",
    "-ss", startSeconds.toFixed(3),
    "-t", lengthSeconds.toFixed(3),
    "-i", inputPath,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "pcm_s16le",
    "-f", "wav",
    outPath,
  ];
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => reject(localSpeechFailure("audio-unreadable", error.message)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(localSpeechFailure("audio-unreadable", `ffmpeg exit ${code}: ${stderr.trim().slice(-200)}`));
    });
  });
}

/**
 * 预估耗时（分钟），给「这次大概要等多久」那句提示用。
 * 倍率按**这台机器上的引擎有没有 GPU 加速**选，不是拿 mac 的数字去糊 Windows——
 * 那样报出来的「1 分钟」在用户那里会变成 10 分钟的沉默。
 */
export function estimateMinutes(durationSeconds: number, tier: LocalSpeechTier, gpuAccelerated: boolean): number {
  const factor = gpuAccelerated ? tier.measuredRealtimeFactor : tier.measuredCpuRealtimeFactor;
  return Math.max(1, Math.round(durationSeconds / (factor > 0 ? factor : 1) / 60));
}

export async function transcribeLocally(input: LocalSpeechTranscribeInput): Promise<LocalSpeechTranscribeResult> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw localSpeechFailure("audio-unreadable", "ffmpeg");
  if (!fs.existsSync(input.audioFilePath)) throw localSpeechFailure("audio-unreadable", input.audioFilePath);

  const meta = await probeMediaMetadata(input.audioFilePath);
  const durationSeconds = typeof meta.durationSeconds === "number" && Number.isFinite(meta.durationSeconds) ? meta.durationSeconds : 0;
  if (!(durationSeconds > 0)) throw localSpeechFailure("audio-unreadable", "duration");

  const engine = localSpeechEngineForPlatform();
  if (!engine) throw localSpeechFailure("unsupported-platform", `${process.platform}-${process.arch}`);
  input.onProgress?.({
    phase: "starting",
    estimatedMinutes: estimateMinutes(durationSeconds, input.tier, engine.gpuAccelerated),
    gpuAccelerated: engine.gpuAccelerated,
  });

  const ready = await ensureLocalSpeechReady(input.tier, {
    signal: input.signal,
    onProgress: (progress) => input.onProgress?.({ phase: "downloading", ...progress }),
  });

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-localstt-"));
  const server = await LocalSpeechServer.start({ ...ready, signal: input.signal });
  const chunkCount = countChunks(durationSeconds);
  const collected: LocalSpeechSegment[] = [];
  let detectedLanguage = "";
  let detectedProbability = 0;

  try {
    let cursor = 0;
    for (;;) {
      if (input.signal?.aborted) throw localSpeechFailure("cancelled", `${Math.round(cursor)}s`);
      const plan = planNextChunk(cursor, durationSeconds);
      if (!plan) break;
      input.onProgress?.({
        phase: "transcribing",
        chunkIndex: plan.index,
        chunkCount,
        doneSeconds: plan.startSeconds,
        totalSeconds: durationSeconds,
      });

      const wavPath = path.join(workDir, `chunk-${plan.index}-${crypto.randomUUID().slice(0, 6)}.wav`);
      await runFfmpeg(ffmpegPath, buildChunkArgs(input.audioFilePath, plan.startSeconds, plan.lengthSeconds, wavPath));
      // 「重试一次」就是字面意思：一次瞬时故障（端口抖动、单次解码失败）不该毁掉整条，
      // 但两次都挂就是真有问题，必须带着段号报出去，不许吞掉继续跑（那正是静默空结果的来路）。
      let inference;
      try {
        inference = await server.transcribeWav(wavPath, input.signal);
      } catch (firstError) {
        if (input.signal?.aborted) throw firstError;
        logInfo("local-speech", "chunk-retry", { chunk: plan.index, reason: (firstError as Error).message.slice(0, 160) });
        try {
          inference = await server.transcribeWav(wavPath, input.signal);
        } catch (secondError) {
          const detail = secondError instanceof Error ? secondError.message : String(secondError);
          throw localSpeechFailure("chunk-failed", `${plan.index + 1}/${chunkCount} — ${detail.slice(0, 160)}`);
        }
      } finally {
        try {
          fs.rmSync(wavPath, { force: true });
        } catch {
          /* 临时目录最后整个删 */
        }
      }

      if (inference.detectedLanguageProbability > detectedProbability) {
        detectedProbability = inference.detectedLanguageProbability;
        detectedLanguage = inference.detectedLanguage;
      }
      const accepted = acceptChunkSegments(plan, inference.segments);
      collected.push(...accepted.kept);
      cursor = accepted.nextCursorSeconds;
    }
  } finally {
    server.stop();
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结果 */
    }
  }

  const text = joinSegmentText(collected);
  if (!text.trim()) {
    // 跑完却一个字都没有：可能真的是纯音乐/环境声，也可能是模型哑火。**不静默返回空**，
    // 把这件事说出来并给「改用云端对一遍」的出口，由用户判断（硬约束：不许静默空结果）。
    throw localSpeechFailure("empty-result", `${Math.round(durationSeconds)}s`);
  }
  logInfo("local-speech", "transcribed", {
    tier: input.tier.id,
    durationSeconds: Math.round(durationSeconds),
    chunks: chunkCount,
    segments: collected.length,
    detectedLanguage,
  });
  return {
    text,
    segments: collected,
    language: detectedLanguage,
    detected_language: detectedLanguage,
    detected_language_probability: detectedProbability,
    local_tier: input.tier.id,
  };
}

export { LocalSpeechError, WINDOW_SECONDS };
