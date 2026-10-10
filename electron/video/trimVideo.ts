// 「直接剪辑」：把视频节点的一段（入点—出点）精确切出来，落成项目素材 mp4。
//
// 通用基建：只认「视频 + 区间 → 新素材 URL」，不知道节点 / 画布。ffmpeg 与执行位复用 export 那套（resolveFfmpegPath +
// ensureExecutable），源视频解析与抽帧同源（resolveVideoLocalPath），进度解析是导出用的同一个（ffmpegProgress）。
// 取消 = 按 jobId 中止 AbortController → 杀 ffmpeg 子进程、删临时文件，什么都不落盘（「取消 = 当没发生过」）。
// 参数与「为什么精确切 + 重编码」见 trimVideoArgs.ts。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { ensureExecutable } from "../export/ensureExecutable";
import { parseFfmpegProgressChunk } from "../export/ffmpegProgress";
import { probeMediaMetadata } from "../export/mediaProbe";
import { writeAsset } from "../runtime";
import { captureAssetWriteContext } from "../assets/assetWriteContext";
import type { ProjectBinding } from "../shared/projectBinding";
import { resolveVideoLocalPath } from "./extractVideoFrame";
import { buildTrimVideoArgs, clampTrimRange } from "./trimVideoArgs";

export type TrimVideoPayload = {
  videoUrl: string;
  startSeconds: number;
  endSeconds: number;
  projectId: string;
  /** 发起动作那一刻签发的原项目完整绑定：ffmpeg 之后只发布进这一份身份。 */
  projectBinding?: ProjectBinding;
  /** 渲染层给的任务号：进度事件与取消都按它找。 */
  jobId: string;
};

export type TrimVideoResult = { url: string; assetId?: string; durationSeconds: number };

export class TrimVideoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrimVideoError";
  }
}

/** 正在跑的剪辑任务（jobId → 取消开关）。同一时刻最多 2 个（与胶片条并发闸同口径）。 */
const running = new Map<string, AbortController>();
export const MAX_CONCURRENT_TRIMS = 2;

export function cancelTrimJob(jobId: string): boolean {
  const controller = running.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

function runFfmpeg(ffmpegPath: string, args: string[], signal: AbortSignal, onOutTime: (seconds: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureExecutable(ffmpegPath);
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const kill = () => { try { child.kill("SIGKILL"); } catch { /* already gone */ } };
    if (signal.aborted) kill();
    signal.addEventListener("abort", kill, { once: true });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout?.on("data", (chunk) => {
      const progress = parseFfmpegProgressChunk(String(chunk));
      if (typeof progress.outTimeMs === "number" && progress.outTimeMs >= 0) onOutTime(progress.outTimeMs / 1000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", kill);
      if (signal.aborted) reject(new TrimVideoError("已取消"));
      else if (code === 0) resolve();
      else reject(new TrimVideoError(`ffmpeg 剪辑失败（code ${code}）：${stderr.trim().slice(-300) || "(无 stderr)"}`));
    });
  });
}

export async function trimVideoToAsset(
  payload: TrimVideoPayload,
  options: { assertCurrent?: () => void; onProgress?: (ratio: number) => void } = {},
): Promise<TrimVideoResult> {
  const { videoUrl, projectId, jobId } = payload;
  if (!videoUrl || typeof videoUrl !== "string") throw new TrimVideoError("缺少源视频地址");
  if (!projectId || typeof projectId !== "string") throw new TrimVideoError("缺少 projectId");
  if (!jobId || typeof jobId !== "string") throw new TrimVideoError("缺少任务号");
  if (!Number.isFinite(payload.startSeconds) || !Number.isFinite(payload.endSeconds)) throw new TrimVideoError("入点或出点不是有效数字");
  if (running.has(jobId)) throw new TrimVideoError("这个剪辑任务已经在跑了");
  if (running.size >= MAX_CONCURRENT_TRIMS) throw new TrimVideoError("同时在剪的视频太多了，等前一个剪完再试");
  const context = await captureAssetWriteContext(projectId, payload.projectBinding, options.assertCurrent);

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) throw new TrimVideoError("找不到 ffmpeg 可执行文件");

  const controller = new AbortController();
  running.set(jobId, controller);
  let cleanupSource = () => {};
  const outPath = path.join(os.tmpdir(), `nomi-trim-${crypto.randomUUID()}.mp4`);
  try {
    const source = await resolveVideoLocalPath(videoUrl, projectId);
    cleanupSource = source.cleanup;
    if (controller.signal.aborted) throw new TrimVideoError("已取消");
    const meta = await probeMediaMetadata(source.filePath).catch(() => null);
    const range = clampTrimRange(payload.startSeconds, payload.endSeconds, typeof meta?.durationSeconds === "number" ? meta.durationSeconds : 0);
    const duration = range.end - range.start;
    await runFfmpeg(ffmpegPath, buildTrimVideoArgs({ inputPath: source.filePath, outputPath: outPath, startSeconds: range.start, durationSeconds: duration }), controller.signal, (seconds) => {
      options.onProgress?.(Math.max(0, Math.min(0.99, seconds / duration)));
    });
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new TrimVideoError("ffmpeg 未产出有效 mp4");
    // 发布前最后一次复验项目身份：换了项目就不发布（assertCurrent 抛的是项目取消，不当成剪辑失败）。
    options.assertCurrent?.();
    const bytes = fs.readFileSync(outPath);
    const record = writeAsset(projectId, bytes, `trim-${range.start.toFixed(1)}-${range.end.toFixed(1)}-${crypto.randomUUID().slice(0, 8)}.mp4`, "video/mp4", {
      kind: "generated",
      source: "video-trim",
    }, context) as { id?: string; data?: { url?: string } };
    const url = record?.data?.url;
    if (!url) throw new TrimVideoError("剪好的 mp4 写盘失败");
    options.onProgress?.(1);
    return { url, assetId: record.id, durationSeconds: duration };
  } finally {
    running.delete(jobId);
    cleanupSource();
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch { /* non-fatal */ }
  }
}
