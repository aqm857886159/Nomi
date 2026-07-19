import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createExportTempDir, createSafeOutputPaths } from "./exportPaths";
import { renameSyncWithRetry } from "../jsonFile";
import { ensureExecutable } from "./ensureExecutable";
import { buildWebmToMp4Args } from "./ffmpegCommandBuilder";
import { parseFfmpegProgressChunk, progressFromOutTime } from "./ffmpegProgress";
import type { ExportProfile } from "./exportTypes";
import type { FfmpegFiltergraphPlan } from "./ffmpegFiltergraph";

export type FfmpegProcessResult = {
  code: number | null;
  stderr: string;
};

export type FfmpegProgressEvent = {
  ratio: number;
  outTimeMs?: number;
  stage?: string;
  message?: string;
};

export type RunFfmpegProcessOptions = {
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
};

export type RunFfmpegProcess = (command: string, args: string[], options?: RunFfmpegProcessOptions) => Promise<FfmpegProcessResult>;

export type TranscodeWebmToMp4Options = {
  projectDir: string;
  inputBytes: Buffer;
  outputName?: string;
  ffmpegPath?: string;
  resolution?: "720p" | "1080p";
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5" | "3:4" | "4:3" | "21:9";
  quality?: "small" | "standard" | "high";
  fps?: number;
  runProcess?: RunFfmpegProcess;
  jobId?: string;
  durationMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegProgressEvent) => void;
  stderrLogPath?: string;
};

export type TranscodeWebmFileToMp4Options = Omit<TranscodeWebmToMp4Options, "inputBytes"> & {
  inputPath: string;
};

export type TimelineMp4ExportResult = {
  absolutePath: string;
  relativePath: string;
  size: number;
};

const RESOLUTION_SIZE: Record<"720p" | "1080p", { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

const ASPECT_RATIO_VALUE: Record<NonNullable<TranscodeWebmToMp4Options["aspectRatio"]>, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "21:9": 21 / 9,
};

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function exportDimensionsForPreset(
  resolution: "720p" | "1080p" = "1080p",
  aspectRatio: TranscodeWebmToMp4Options["aspectRatio"] = "16:9",
): { width: number; height: number } {
  if (!aspectRatio || aspectRatio === "16:9") return RESOLUTION_SIZE[resolution];
  const base = resolution === "720p" ? 720 : 1080;
  const ratio = ASPECT_RATIO_VALUE[aspectRatio] || ASPECT_RATIO_VALUE["16:9"];
  if (ratio >= 1) return { width: even(base * ratio), height: even(base) };
  return { width: even(base), height: even(base / ratio) };
}

function exportProfileFromLegacyOptions(options: TranscodeWebmFileToMp4Options): ExportProfile {
  const dimensions = exportDimensionsForPreset(options.resolution || "1080p", options.aspectRatio || "16:9");
  return {
    preset: "publish",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "none",
    audioMode: "mute",
    width: dimensions.width,
    height: dimensions.height,
    fps: Math.max(1, Math.floor(options.fps || 30)),
    pixelFormat: "yuv420p",
    quality: options.quality || "standard",
  };
}

function executablePathForRuntime(candidate: string): string {
  if (!candidate.includes("app.asar")) return candidate;
  return candidate.replace(/app\.asar(?!\.unpacked)/g, "app.asar.unpacked");
}

function commandExists(command: string, pathEnv = process.env.PATH || ""): boolean {
  if (!command) return false;
  const runtimeCommand = executablePathForRuntime(command);
  if (path.isAbsolute(runtimeCommand)) return fs.existsSync(runtimeCommand);
  const pathParts = String(pathEnv || "").split(path.delimiter).filter(Boolean);
  return pathParts.some((dir) => fs.existsSync(path.join(dir, runtimeCommand)));
}

const STDERR_SUMMARY_LIMIT = 16 * 1024;

export class ExportCancelledError extends Error {
  constructor(message = "Export cancelled") {
    super(message);
    this.name = "ExportCancelledError";
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "ExportCancelledError";
}

function cappedTail(existing: string, chunk: string, limit = STDERR_SUMMARY_LIMIT): string {
  const next = existing + chunk;
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

function appendLog(logPath: string | undefined, chunk: string): void {
  if (!logPath || chunk.length === 0) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, chunk);
}

type ProgressStreamState = {
  buffer: string;
  recordLines: string[];
};

function consumeProgressStreamChunk(state: ProgressStreamState, chunk: string, durationMs: number | undefined, onProgress: ((progress: FfmpegProgressEvent) => void) | undefined): void {
  if (!onProgress) return;
  state.buffer += chunk;
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() ?? "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    state.recordLines.push(line);
    if (!line.startsWith("progress=")) continue;

    const parsed = parseFfmpegProgressChunk(state.recordLines.join("\n"));
    state.recordLines = [];
    if (parsed.outTimeMs === undefined) continue;

    onProgress({
      ratio: progressFromOutTime(parsed.outTimeMs, durationMs ?? 0),
      outTimeMs: parsed.outTimeMs,
      stage: parsed.progress,
      message: parsed.progress ? `FFmpeg progress: ${parsed.progress}` : undefined,
    });
  }
}

function stderrSummaryForError(stderr: string): string {
  const detail = stderr.trim();
  if (!detail) return "";
  if (stderr.length <= STDERR_SUMMARY_LIMIT) return detail;
  return `[stderr truncated to last ${STDERR_SUMMARY_LIMIT} chars]\n${detail}`;
}

type ResolveFfmpegPathOptions = {
  bundledPath?: string;
  resourcesPath?: string;
  pathEnv?: string;
};

function resolveBundledFfmpegPath(): string {
  try {
    // @ffmpeg-installer/ffmpeg resolves to the platform-specific binary shipped with the app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require("@ffmpeg-installer/ffmpeg") as { path?: unknown };
    return typeof bundled.path === "string" ? bundled.path : "";
  } catch {
    return "";
  }
}

export function resolveFfmpegPath(explicitPath?: string, options: ResolveFfmpegPathOptions = {}): string {
  if (typeof explicitPath === "string") return explicitPath.trim();
  const explicit = String(process.env.NOMI_FFMPEG_PATH || "").trim();
  if (explicit) return explicit;
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? "";
  const candidates = [
    options.bundledPath ?? resolveBundledFfmpegPath(),
    path.join(resourcesPath, "ffmpeg", executableName),
    path.join(resourcesPath, "app.asar.unpacked", "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : process.platform === "darwin" ? "darwin-x64" : "linux-x64", executableName),
    executableName,
  ];
  return candidates.map(executablePathForRuntime).find((candidate) => commandExists(candidate, options.pathEnv)) || "";
}

function defaultRunProcess(command: string, args: string[], options: RunFfmpegProcessOptions = {}): Promise<FfmpegProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ExportCancelledError());
      return;
    }

    ensureExecutable(command);
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let settled = false;
    let onAbort: (() => void) | undefined;
    const cleanup = () => {
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    };
    onAbort = () => {
      if (settled) return;
      child.kill();
      settled = true;
      cleanup();
      reject(new ExportCancelledError());
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stderr?.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      stderr = cappedTail(stderr, text);
      options.onStderr?.(text);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ code, stderr });
    });
  });
}

export async function transcodeWebmFileToMp4(options: TranscodeWebmFileToMp4Options): Promise<TimelineMp4ExportResult> {
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("导出失败：MP4 编码组件缺失，请重新安装 Nomi。你不需要单独安装 FFmpeg。");
  }

  const inputPath = path.resolve(options.inputPath);
  if (!fs.existsSync(inputPath)) {
    throw new Error("导出失败：输入视频不存在");
  }
  const inputStat = fs.statSync(inputPath);
  if (!inputStat.isFile() || inputStat.size <= 0) {
    throw new Error("导出失败：输入视频为空");
  }

  const projectDir = path.resolve(options.projectDir);
  const outputPaths = createSafeOutputPaths({ projectDir, outputName: options.outputName, extension: "mp4" });
  const outputPath = outputPaths.finalPath;
  const partialOutputPath = outputPaths.partialPath;

  const args = buildWebmToMp4Args({
    inputPath,
    outputPath: partialOutputPath,
    profile: exportProfileFromLegacyOptions(options),
    noAudio: true,
    reportProgress: Boolean(options.onProgress || options.durationMs),
  });

  if (options.signal?.aborted) throw new ExportCancelledError();

  let stderrSummary = "";
  let sawStderrChunk = false;
  const progressStream: ProgressStreamState = { buffer: "", recordLines: [] };
  const handleStderr = (chunk: string) => {
    if (chunk.length === 0) return;
    sawStderrChunk = true;
    stderrSummary = cappedTail(stderrSummary, chunk);
    appendLog(options.stderrLogPath, chunk);
    consumeProgressStreamChunk(progressStream, chunk, options.durationMs, options.onProgress);
  };

  try {
    const runProcess = options.runProcess || defaultRunProcess;
    const result = await runProcess(ffmpegPath, args, { signal: options.signal, onStderr: handleStderr });
    if (result.stderr && !sawStderrChunk) {
      handleStderr(result.stderr);
    } else if (result.stderr && result.stderr.trim().length > 0 && !stderrSummary.includes(result.stderr)) {
      stderrSummary = cappedTail(stderrSummary, result.stderr);
      appendLog(options.stderrLogPath, result.stderr);
    }
    if (result.code !== 0) {
      const detail = stderrSummaryForError(stderrSummary) || `ffmpeg exited with code ${result.code}`;
      throw new Error(`导出失败：${detail}`);
    }
    if (options.signal?.aborted) throw new ExportCancelledError();
    if (!fs.existsSync(partialOutputPath)) throw new Error("导出失败：MP4 文件未生成");
    const stat = fs.statSync(partialOutputPath);
    if (stat.size <= 0) throw new Error("导出失败：MP4 文件为空");
    // Windows：旧导出 MP4 被播放器/资源管理器预览持有会 EPERM，共享重试收口（P2）。
    renameSyncWithRetry(partialOutputPath, outputPath);
    const finalStat = fs.statSync(outputPath);
    return {
      absolutePath: outputPath,
      relativePath: outputPaths.relativeFinalPath,
      size: finalStat.size,
    };
  } catch (error) {
    if (isAbortLikeError(error) || options.signal?.aborted) {
      throw new ExportCancelledError(error instanceof Error && error.message ? error.message : undefined);
    }
    throw error;
  } finally {
    fs.rmSync(partialOutputPath, { force: true });
  }
}

export type RenderFiltergraphToMp4Options = {
  projectDir: string;
  outputName?: string;
  ffmpegPath?: string;
  profile: ExportProfile;
  filtergraph: FfmpegFiltergraphPlan;
  durationMs?: number;
  jobId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegProgressEvent) => void;
  stderrLogPath?: string;
  runProcess?: RunFfmpegProcess;
};

/**
 * 用 ffmpegFiltergraph 计划直接读源文件渲染 MP4（letterbox 视频 + 可选音频）。
 * 与 transcodeWebmFileToMp4 并列：那条是 WebM→MP4 回退路径，这条是生产主路径。
 * 复用同一套进度/取消/原子落盘/错误摘要逻辑。
 */
export async function renderFiltergraphToMp4(options: RenderFiltergraphToMp4Options): Promise<TimelineMp4ExportResult> {
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("导出失败：MP4 编码组件缺失，请重新安装 Nomi。你不需要单独安装 FFmpeg。");
  }

  const projectDir = path.resolve(options.projectDir);
  const outputPaths = createSafeOutputPaths({ projectDir, outputName: options.outputName, extension: "mp4" });
  const outputPath = outputPaths.finalPath;
  const partialOutputPath = outputPaths.partialPath;

  const args = buildWebmToMp4Args({
    inputPath: "",
    outputPath: partialOutputPath,
    profile: options.profile,
    noAudio: false, // 由 profile.audioMode / filtergraph.audioOutputLabel 决定是否真有音频
    filtergraph: options.filtergraph,
    reportProgress: Boolean(options.onProgress || options.durationMs),
  });

  if (options.signal?.aborted) throw new ExportCancelledError();

  let stderrSummary = "";
  let sawStderrChunk = false;
  const progressStream: ProgressStreamState = { buffer: "", recordLines: [] };
  const handleStderr = (chunk: string) => {
    if (chunk.length === 0) return;
    sawStderrChunk = true;
    stderrSummary = cappedTail(stderrSummary, chunk);
    appendLog(options.stderrLogPath, chunk);
    consumeProgressStreamChunk(progressStream, chunk, options.durationMs, options.onProgress);
  };

  try {
    const runProcess = options.runProcess || defaultRunProcess;
    const result = await runProcess(ffmpegPath, args, { signal: options.signal, onStderr: handleStderr });
    if (result.stderr && !sawStderrChunk) {
      handleStderr(result.stderr);
    } else if (result.stderr && result.stderr.trim().length > 0 && !stderrSummary.includes(result.stderr)) {
      stderrSummary = cappedTail(stderrSummary, result.stderr);
      appendLog(options.stderrLogPath, result.stderr);
    }
    if (result.code !== 0) {
      const detail = stderrSummaryForError(stderrSummary) || `ffmpeg exited with code ${result.code}`;
      throw new Error(`导出失败：${detail}`);
    }
    if (options.signal?.aborted) throw new ExportCancelledError();
    if (!fs.existsSync(partialOutputPath)) throw new Error("导出失败：MP4 文件未生成");
    const stat = fs.statSync(partialOutputPath);
    if (stat.size <= 0) throw new Error("导出失败：MP4 文件为空");
    // Windows：旧导出 MP4 被播放器/资源管理器预览持有会 EPERM，共享重试收口（P2）。
    renameSyncWithRetry(partialOutputPath, outputPath);
    const finalStat = fs.statSync(outputPath);
    return {
      absolutePath: outputPath,
      relativePath: outputPaths.relativeFinalPath,
      size: finalStat.size,
    };
  } catch (error) {
    if (isAbortLikeError(error) || options.signal?.aborted) {
      throw new ExportCancelledError(error instanceof Error && error.message ? error.message : undefined);
    }
    throw error;
  } finally {
    fs.rmSync(partialOutputPath, { force: true });
  }
}

export async function transcodeWebmToMp4(options: TranscodeWebmToMp4Options): Promise<TimelineMp4ExportResult> {
  if (!options.inputBytes || options.inputBytes.byteLength <= 0) {
    throw new Error("导出失败：输入视频为空");
  }

  const projectDir = path.resolve(options.projectDir);
  const tempDir = createExportTempDir(projectDir, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const inputPath = path.join(tempDir, "input.webm");
  fs.writeFileSync(inputPath, options.inputBytes);

  try {
    return await transcodeWebmFileToMp4({
      ...options,
      projectDir,
      inputPath,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
