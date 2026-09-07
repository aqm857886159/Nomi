/**
 * 「提取深度」—— 主进程侧的一次运行（会话生命周期 + ffmpeg + 权重）。
 *
 * ── 谁在编排 ────────────────────────────────────────────────────────────────────
 * **渲染层编排，主进程做它做不到的那几段。** 推理必须在渲染层跑（WebGPU 只在渲染进程里），
 * 所以让主进程反过来「拉」渲染层算一批会需要一条 main→renderer 的请求/应答通道——
 * 那是第二套 IPC 语义，且取消/错误要在两个方向上各写一遍。这里改成：渲染层拿着循环，
 * 主进程暴露四个原语（prepare / readFrames / writeFrames / finish）＋一个 cancel，
 * 全部是 renderer→main 的单向 invoke，取消只有一个方向。
 *
 * ── 中间态为什么不落 .raw ────────────────────────────────────────────────────────
 * `writeFrames` 直接把裸帧写进 ffmpeg 的 stdin，磁盘上永远没有整段裸像素。
 * 见 depthVideoPipeline.ts 文件头。
 *
 * ── 并发 ────────────────────────────────────────────────────────────────────────
 * 同一项目同时只允许一个深度任务（GPU 与 ffmpeg 都是独占资源，两个一起跑只会都变慢，
 * 且进度条会互相串台）。第二个请求得到 `already-running`，不排队——排队会让用户以为卡死。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { resolveFfprobePath } from "../export/mediaProbe";
import { ensureExecutable } from "../export/ensureExecutable";
import { writeAsset } from "../runtime";
import { logInfo, logWarn } from "../logging/logger";
import {
  VIDEO_DEPTH_RECIPE,
  checkVideoDepthBudget,
  deriveProcessingPlan,
  type VideoDepthProcessingPlan,
} from "../shared/canvas/videoDepth";
import { VIDEO_DEPTH_MODEL_MANIFEST, videoDepthRequiredAssets } from "../shared/canvas/videoDepthModels";
import type { VideoDepthErrorCode, VideoDepthMainOwnedPhase } from "../shared/canvas/videoDepthRun";
import { ensureVideoDepthModels, pendingVideoDepthDownloadBytes } from "./depthVideoModelCache";
import {
  buildExtractFramesArgs,
  buildProbeArgs,
  buildRawStdinToMp4Args,
  parseProbeOutput,
  videoDepthFrameFileName,
} from "./depthVideoPipeline";
import { resolveVideoLocalPath } from "./extractVideoFrame";
import { localModelUrl, localRuntimeBundleUrl } from "../protocol/localRuntimeAssets";

export class VideoDepthJobError extends Error {
  readonly code: VideoDepthErrorCode;
  readonly retryable: boolean;

  constructor(code: VideoDepthErrorCode, message: string, retryable = true) {
    super(message);
    this.name = "VideoDepthJobError";
    this.code = code;
    this.retryable = retryable;
  }
}

type Session = {
  jobId: string;
  projectId: string;
  nodeId: string;
  plan: VideoDepthProcessingPlan;
  workDir: string;
  framesDir: string;
  outMp4: string;
  totalFrames: number;
  encoder: ChildProcessWithoutNullStreams | null;
  encoderExit: Promise<void> | null;
  cleanupSource: () => void;
  cancelled: boolean;
};

const sessions = new Map<string, Session>();

/** 渲染层调 prepare 时用来推「下载中」进度的回调（由 IPC 层注入，主进程不认识窗口）。 */
export type VideoDepthPrepareEmitter = (event: {
  jobId: string;
  nodeId: string;
  phase: VideoDepthMainOwnedPhase;
  doneBytes?: number;
  totalBytes?: number;
}) => void;

export type VideoDepthPreparePayload = {
  projectId: string;
  nodeId: string;
  sourceUrl: string;
};

export type VideoDepthPrepareResult = {
  jobId: string;
  totalFrames: number;
  outWidth: number;
  outHeight: number;
  /** 渲染层 worker 直接 fetch 的地址（nomi-local，打包态可用）。 */
  depthModelUrl: string;
  ortWasmBaseUrl: string;
};

function runProcess(binary: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    ensureExecutable(binary);
    const child = spawn(binary, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exit ${code}: ${stderr.trim().slice(-300) || "(no stderr)"}`));
    });
  });
}

function requireSession(jobId: string): Session {
  const session = sessions.get(jobId);
  if (!session) throw new VideoDepthJobError("media-failed", `unknown video depth job: ${jobId}`, false);
  return session;
}

function disposeSession(session: Session): void {
  try {
    session.encoder?.kill();
  } catch {
    /* 已经退出了 */
  }
  try {
    session.cleanupSource();
  } catch {
    /* 源是项目内文件时本来就没有临时副本 */
  }
  try {
    fs.rmSync(session.workDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不该让整次运行失败 */
  }
  sessions.delete(session.jobId);
}

/** 抽帧、下载权重、把这次运行的事实算准。返回之后渲染层才开始推理。 */
export async function prepareVideoDepthJob(
  payload: VideoDepthPreparePayload,
  emit: VideoDepthPrepareEmitter,
): Promise<VideoDepthPrepareResult> {
  for (const existing of sessions.values()) {
    if (existing.projectId === payload.projectId) {
      throw new VideoDepthJobError("already-running", `project ${payload.projectId} already has job ${existing.jobId}`, false);
    }
  }

  const ffmpegPath = resolveFfmpegPath();
  const ffprobePath = resolveFfprobePath();
  if (!ffmpegPath || !ffprobePath) throw new VideoDepthJobError("media-failed", "ffmpeg/ffprobe not found", false);

  let source: { filePath: string; cleanup: () => void };
  try {
    source = await resolveVideoLocalPath(payload.sourceUrl, payload.projectId);
  } catch (error) {
    throw new VideoDepthJobError("source-unavailable", error instanceof Error ? error.message : String(error), false);
  }

  const jobId = crypto.randomUUID();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-depth-"));
  const framesDir = path.join(workDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  try {
    const probe = parseProbeOutput((await runProcess(ffprobePath, buildProbeArgs(source.filePath))).stdout);
    if (!probe) {
      throw new VideoDepthJobError("source-unmeasurable", "ffprobe could not measure the source video", false);
    }
    const plan = deriveProcessingPlan(probe);
    const budget = checkVideoDepthBudget(plan);
    if (!budget.ok) {
      const detail =
        budget.reason === "over-budget"
          ? `${budget.expectedRawBytes} bytes exceeds the ${budget.limitBytes} byte budget`
          : "source facts are incomplete";
      throw new VideoDepthJobError(budget.reason === "over-budget" ? "over-budget" : "source-unmeasurable", detail, false);
    }

    const required = videoDepthRequiredAssets();
    const pendingBytes = pendingVideoDepthDownloadBytes(required);
    if (pendingBytes > 0) {
      emit({ jobId, nodeId: payload.nodeId, phase: "downloading", doneBytes: 0, totalBytes: pendingBytes });
      let alreadyDone = 0;
      try {
        await ensureVideoDepthModels(required, {
          onProgress: (progress) => {
            emit({
              jobId,
              nodeId: payload.nodeId,
              phase: "downloading",
              doneBytes: alreadyDone + progress.doneBytes,
              totalBytes: pendingBytes,
            });
            if (progress.doneBytes === progress.totalBytes) alreadyDone += progress.totalBytes;
          },
        });
      } catch (error) {
        throw new VideoDepthJobError(
          "model-download-failed",
          error instanceof Error ? error.message : String(error),
          true,
        );
      }
    }

    emit({ jobId, nodeId: payload.nodeId, phase: "extracting" });
    const durationSeconds = plan.durationSeconds ?? 0;
    try {
      await runProcess(
        ffmpegPath,
        buildExtractFramesArgs({
          sourcePath: source.filePath,
          durationSeconds,
          outWidth: plan.outWidth,
          outHeight: plan.outHeight,
          outDir: framesDir,
        }),
      );
    } catch (error) {
      throw new VideoDepthJobError("media-failed", error instanceof Error ? error.message : String(error), true);
    }

    // 帧数以**磁盘上真有几张**为准，不用估算值——估算只用来显示预估，不能当循环上界。
    const totalFrames = fs.readdirSync(framesDir).filter((name) => name.endsWith(".jpg")).length;
    if (totalFrames === 0) {
      throw new VideoDepthJobError("media-failed", "ffmpeg produced no frames for the selected range", false);
    }

    const session: Session = {
      jobId,
      projectId: payload.projectId,
      nodeId: payload.nodeId,
      plan,
      workDir,
      framesDir,
      outMp4: path.join(workDir, "depth.mp4"),
      totalFrames,
      encoder: null,
      encoderExit: null,
      cleanupSource: source.cleanup,
      cancelled: false,
    };
    sessions.set(jobId, session);
    logInfo("video-depth", "prepared", { jobId, totalFrames, width: plan.outWidth, height: plan.outHeight });

    return {
      jobId,
      totalFrames,
      outWidth: plan.outWidth,
      outHeight: plan.outHeight,
      depthModelUrl: localModelUrl(VIDEO_DEPTH_MODEL_MANIFEST[0].fileName),
      ortWasmBaseUrl: localRuntimeBundleUrl("ort"),
    };
  } catch (error) {
    try {
      source.cleanup();
    } catch {
      /* 清理失败不该盖住真正的错误 */
    }
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* 同上 */
    }
    throw error;
  }
}

/** 取一批已抽好的 JPEG 帧（1-based 序号）。 */
export function readVideoDepthFrames(payload: { jobId: string; firstIndex: number; count: number }): Buffer[] {
  const session = requireSession(payload.jobId);
  const frames: Buffer[] = [];
  for (let i = 0; i < payload.count; i += 1) {
    const oneBased = payload.firstIndex + i + 1;
    if (oneBased > session.totalFrames) break;
    frames.push(fs.readFileSync(path.join(session.framesDir, videoDepthFrameFileName(oneBased))));
  }
  return frames;
}

function startEncoder(session: Session): ChildProcessWithoutNullStreams {
  const ffmpegPath = resolveFfmpegPath();
  ensureExecutable(ffmpegPath);
  const child = spawn(
    ffmpegPath,
    buildRawStdinToMp4Args({
      outWidth: session.plan.outWidth,
      outHeight: session.plan.outHeight,
      fps: VIDEO_DEPTH_RECIPE.processingFps,
      outMp4: session.outMp4,
    }),
    { windowsHide: true },
  ) as ChildProcessWithoutNullStreams;
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  // stdin 的 error 必须有人接：取消时我们会 kill 编码器，此后仍在途的 write 会 EPIPE，
  // 没有监听器的 EPIPE 是**未捕获异常**，会直接崩主进程（check:heavy-path 的
  // child-stdin-write-unguarded 守的就是这条）。
  child.stdin.on("error", () => {
    /* 取消/编码器早退时的 EPIPE：由 encoderExit 统一报错，这里只负责别炸 */
  });
  session.encoderExit = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new VideoDepthJobError("media-failed", `ffmpeg encode failed (code ${code}): ${stderr.trim().slice(-300)}`, true));
    });
  });
  session.encoder = child;
  return child;
}

/** 把一批裸帧写进编码器 stdin。第一次调用时才真正拉起 ffmpeg（取消得早就一次也不拉）。 */
export async function writeVideoDepthFrames(payload: { jobId: string; frames: Uint8Array[] }): Promise<void> {
  const session = requireSession(payload.jobId);
  if (session.cancelled) throw new VideoDepthJobError("media-failed", "job was cancelled", false);
  const encoder = session.encoder ?? startEncoder(session);
  for (const frame of payload.frames) {
    const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
    if (!encoder.stdin.write(buffer)) {
      // 背压：等排空再继续，否则内存里会攒下整段裸像素——正是这条管线要避免的东西。
      await new Promise<void>((resolve) => encoder.stdin.once("drain", resolve));
    }
  }
}

export type VideoDepthFinishResult = { url: string; assetId?: string; frames: number };

/** 收尾：关 stdin、等编码完成、落成项目资产。 */
export async function finishVideoDepthJob(payload: { jobId: string }): Promise<VideoDepthFinishResult> {
  const session = requireSession(payload.jobId);
  try {
    if (!session.encoder || !session.encoderExit) {
      throw new VideoDepthJobError("media-failed", "no frames were written before finish", false);
    }
    session.encoder.stdin.end();
    await session.encoderExit;
    const bytes = fs.readFileSync(session.outMp4);
    const record = writeAsset(session.projectId, bytes, "depth.mp4", "video/mp4", {
      kind: "generated",
      source: "video-depth",
      ownerNodeId: session.nodeId,
    }) as { id?: string; data?: { url?: string } };
    const url = record?.data?.url;
    if (!url) throw new VideoDepthJobError("media-failed", "depth video could not be written to the project assets", false);
    logInfo("video-depth", "finished", { jobId: session.jobId, frames: session.totalFrames, bytes: bytes.byteLength });
    return { url, assetId: record.id, frames: session.totalFrames };
  } finally {
    disposeSession(session);
  }
}

/** 取消：杀编码器、清临时目录、忘掉会话。已落盘的历史产物不动（与画布删除语义一致）。 */
export function cancelVideoDepthJob(payload: { jobId: string }): { ok: true } {
  const session = sessions.get(payload.jobId);
  if (!session) return { ok: true };
  session.cancelled = true;
  logWarn("video-depth", "cancelled", { jobId: session.jobId });
  disposeSession(session);
  return { ok: true };
}

/** 退出前扫干净：临时目录不该活过进程。 */
export function disposeAllVideoDepthJobs(): void {
  for (const session of [...sessions.values()]) disposeSession(session);
}
