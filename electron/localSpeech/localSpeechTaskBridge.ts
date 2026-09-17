/**
 * 本地转写接进 `transcribe` taskKind 的**唯一那一层胶水**。
 *
 * `audioTaskRunner.runTranscribe` 见到 create op 上的 `localEngine` 声明就转交这里；
 * 这里负责三件事，然后把结果原样交回去：
 *  ① 把请求里的音频 URL 解成**本地绝对路径**（引擎要读文件，不读 URL）；
 *  ② 把请求里的档位参数按白名单解成一档权重（不拿用户输入去拼文件路径）；
 *  ③ 把编排层的进度转给登记过的接收器（拆解那边的进度条）。
 *
 * 出去的结果是**与云端 whisper 同形状的 verbose_json**，所以调用方拿到的 `raw` 和
 * APIMart Whisper / ElevenLabs Scribe 的完全一样——拆解读 `raw.segments` 那段代码一个字不用改（P1）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { absolutePathFromLocalAssetUrl } from "../assets/localAssetFile";
import { localSpeechTier } from "../shared/localSpeech/localSpeechAssets";
import { resolveLocalSpeechTierId } from "../catalog/localSpeech";
import { localSpeechFailure } from "./localSpeechErrors";
import { emitLocalSpeechProgress } from "./localSpeechProgressBus";
import { transcribeLocally, type LocalSpeechTranscribeResult } from "./localSpeechTranscribe";

export type LocalSpeechBridgeInput = {
  /** 音频来源：`nomi-local://asset/...`（拆解产出的音轨走这条）或已经是绝对路径。 */
  audioUrl: string;
  /** 请求里携带的档位（`request.params[op.localEngine.tierParam]`）。 */
  requestedTier: unknown;
  /** 进度接收器的绑定键（拆解用 nodeId）；空则不报进度。 */
  progressKey: string;
  signal?: AbortSignal;
};

/**
 * 音频 URL → 本地绝对路径。
 * **只认已经在本机磁盘上的东西**：本地转写的全部意义是不联网，
 * 为了转写去下载一个远端音频会把「离线」这条承诺悄悄作废（P1：不留逃生口）。
 * 返回 `{ filePath, cleanup }`——data: URL 要先落盘，落的那份用完要删。
 */
export function resolveLocalAudioPath(audioUrl: string): { filePath: string; cleanup: () => void } {
  const url = String(audioUrl || "").trim();
  if (!url) throw localSpeechFailure("audio-unreadable", "empty url");
  if (url.startsWith("nomi-local://asset/")) {
    const rest = url.slice("nomi-local://asset/".length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex < 0) throw localSpeechFailure("audio-unreadable", url);
    let projectId: string;
    try {
      projectId = decodeURIComponent(rest.slice(0, slashIndex));
    } catch {
      throw localSpeechFailure("audio-unreadable", url);
    }
    const absolutePath = absolutePathFromLocalAssetUrl(url, projectId);
    if (!absolutePath || !fs.existsSync(absolutePath)) throw localSpeechFailure("audio-unreadable", url);
    return { filePath: absolutePath, cleanup: () => undefined };
  }
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const isBase64 = /;base64/i.test(url.slice(0, comma));
    if (comma < 0 || !isBase64) throw localSpeechFailure("audio-unreadable", "data url");
    const bytes = Buffer.from(url.slice(comma + 1), "base64");
    const filePath = path.join(os.tmpdir(), `nomi-localstt-in-${crypto.randomUUID().slice(0, 8)}.bin`);
    fs.writeFileSync(filePath, bytes);
    return {
      filePath,
      cleanup: () => {
        try {
          fs.rmSync(filePath, { force: true });
        } catch {
          /* 临时文件删不掉不影响结果 */
        }
      },
    };
  }
  if (/^https?:\/\//i.test(url)) throw localSpeechFailure("audio-unreadable", "remote url");
  if (!path.isAbsolute(url) || !fs.existsSync(url)) throw localSpeechFailure("audio-unreadable", url);
  return { filePath: url, cleanup: () => undefined };
}

export async function runLocalSpeechTranscription(input: LocalSpeechBridgeInput): Promise<LocalSpeechTranscribeResult> {
  const tierId = resolveLocalSpeechTierId(input.requestedTier);
  const tier = localSpeechTier(tierId);
  if (!tier) throw localSpeechFailure("unsupported-platform", tierId);
  const { filePath, cleanup } = resolveLocalAudioPath(input.audioUrl);
  try {
    return await transcribeLocally({
      audioFilePath: filePath,
      tier,
      signal: input.signal,
      onProgress: (progress) => emitLocalSpeechProgress(input.progressKey, progress),
    });
  } finally {
    cleanup();
  }
}
