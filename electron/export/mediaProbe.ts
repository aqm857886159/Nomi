import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { resolveFfmpegPath } from "./ffmpegRunner";
import { ensureExecutable } from "./ensureExecutable";

export type MediaProbeMetadata = {
  kind: "image" | "video" | "audio" | "unknown";
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  sampleRate?: number;
  channels?: number;
  streamCount?: number;
};

export type BoundedProcessOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  input?: Uint8Array;
};

export class BoundedProcessError extends Error {
  code: string;

  constructor(code: string) {
    super(`Bounded process failed (${code})`);
    this.name = "BoundedProcessError";
    this.code = code;
  }
}

export type RunProbeProcess = (
  command: string,
  args: string[],
  options?: BoundedProcessOptions,
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export async function runBoundedProcess(
  command: string,
  args: string[],
  options: BoundedProcessOptions,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new BoundedProcessError("cancelled");
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      ensureExecutable(command);
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      reject(new BoundedProcessError("spawn_failed"));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: BoundedProcessError | undefined;
    let settled = false;

    const stop = (code: string) => {
      failure ??= new BoundedProcessError(code);
      child.stdin?.destroy();
      if (!child.killed) child.kill("SIGKILL");
    };
    const onAbort = () => stop("cancelled");
    const timer = setTimeout(() => stop("timeout"), Math.max(1, options.timeoutMs));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > options.maxStdoutBytes) {
        stop("output_limit");
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (raw: Buffer | string) => {
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      stderrBytes += chunk.byteLength;
      if (stderrBytes > options.maxStderrBytes) {
        stop("output_limit");
        return;
      }
      stderrChunks.push(chunk);
    });
    child.stdin?.on("error", () => {
      if (!failure) stop("spawn_failed");
    });
    child.on("error", () => {
      if (!settled) stop("spawn_failed");
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (failure) {
        reject(failure);
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8"),
        stderr: Buffer.concat(stderrChunks, stderrBytes).toString("utf8"),
      });
    });

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    if (options.input) child.stdin?.end(Buffer.from(options.input));
    else child.stdin?.end();
  });
}

export class MediaProbeError extends Error {
  code: "missing_file" | "probe_failed" | "unsupported_media" | "invalid_probe_output";

  constructor(code: MediaProbeError["code"], message: string) {
    super(message);
    this.name = "MediaProbeError";
    this.code = code;
  }
}

type FfprobeStream = Record<string, unknown> & {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
  sample_rate?: unknown;
  channels?: unknown;
  nb_frames?: unknown;
  duration?: unknown;
};

type FfprobeOutput = {
  streams?: unknown;
  format?: unknown;
};

const IMAGE_LIKE_CODECS = new Set(["apng", "bmp", "gif", "jpeg", "jpg", "mjpeg", "png", "tiff", "webp"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  const numeric = finitePositiveNumber(value);
  return numeric !== undefined && Number.isInteger(numeric) ? numeric : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseRational(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (trimmed.includes("/")) {
    const [numeratorRaw, denominatorRaw] = trimmed.split("/", 2);
    const numerator = Number(numeratorRaw);
    const denominator = Number(denominatorRaw);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0) {
      return numerator / denominator;
    }
    return undefined;
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function parseDuration(format: unknown, videoStream?: FfprobeStream, audioStream?: FfprobeStream): number | undefined {
  if (isRecord(format)) {
    const duration = finitePositiveNumber(format.duration);
    if (duration !== undefined) return duration;
  }
  return finitePositiveNumber(videoStream?.duration) ?? finitePositiveNumber(audioStream?.duration);
}

function isStillImage(videoStream: FfprobeStream | undefined, durationSeconds: number | undefined): boolean {
  if (!videoStream) return false;
  const codec = stringValue(videoStream.codec_name)?.toLowerCase();
  const nbFrames = finitePositiveInteger(videoStream.nb_frames);
  if (codec && IMAGE_LIKE_CODECS.has(codec) && (durationSeconds === undefined || durationSeconds <= 0.1 || nbFrames === 1)) {
    return true;
  }
  return durationSeconds === undefined && nbFrames === 1;
}

export function parseFfprobeJson(json: string): MediaProbeMetadata {
  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(json) as FfprobeOutput;
  } catch (error) {
    throw new MediaProbeError("invalid_probe_output", `Invalid ffprobe JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.streams)) {
    throw new MediaProbeError("invalid_probe_output", "ffprobe output must contain a streams array");
  }

  const streams = parsed.streams.filter(isRecord) as FfprobeStream[];
  if (streams.length === 0) {
    throw new MediaProbeError("unsupported_media", "ffprobe output did not contain media streams");
  }

  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStream = streams.find((stream) => stream.codec_type === "audio");
  if (!videoStream && !audioStream) {
    throw new MediaProbeError("unsupported_media", "ffprobe output did not contain audio or video streams");
  }

  const durationSeconds = parseDuration(parsed.format, videoStream, audioStream);
  const width = finitePositiveInteger(videoStream?.width);
  const height = finitePositiveInteger(videoStream?.height);
  const fps = parseRational(videoStream?.avg_frame_rate) ?? parseRational(videoStream?.r_frame_rate);
  const videoCodec = stringValue(videoStream?.codec_name);
  const audioCodec = stringValue(audioStream?.codec_name);
  const sampleRate = finitePositiveInteger(audioStream?.sample_rate);
  const channels = finitePositiveInteger(audioStream?.channels);
  const hasAudio = audioStream !== undefined;
  const kind: MediaProbeMetadata["kind"] = videoStream
    ? isStillImage(videoStream, durationSeconds) && !hasAudio
      ? "image"
      : "video"
    : audioStream
      ? "audio"
      : "unknown";

  const metadata: MediaProbeMetadata = { kind, hasAudio, streamCount: streams.length };
  if (durationSeconds !== undefined && kind !== "image") metadata.durationSeconds = durationSeconds;
  if (width !== undefined) metadata.width = width;
  if (height !== undefined) metadata.height = height;
  if (fps !== undefined && kind !== "image") metadata.fps = fps;
  if (videoCodec !== undefined) metadata.videoCodec = videoCodec;
  if (audioCodec !== undefined) metadata.audioCodec = audioCodec;
  if (sampleRate !== undefined) metadata.sampleRate = sampleRate;
  if (channels !== undefined) metadata.channels = channels;

  return metadata;
}

function executablePathForRuntime(candidate: string): string {
  if (!candidate.includes("app.asar")) return candidate;
  return candidate.replace(/app\.asar(?!\.unpacked)/g, "app.asar.unpacked");
}

function commandExists(command: string): boolean {
  if (!command) return false;
  const runtimeCommand = executablePathForRuntime(command);
  if (path.isAbsolute(runtimeCommand)) return fs.existsSync(runtimeCommand);
  const pathParts = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return pathParts.some((dir) => fs.existsSync(path.join(dir, runtimeCommand)));
}

function siblingFfprobePath(ffmpegPath: string): string {
  if (!ffmpegPath || !path.isAbsolute(ffmpegPath)) return "";
  const executableName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return path.join(path.dirname(executablePathForRuntime(ffmpegPath)), executableName);
}

function bundledFfprobePath(): string {
  // 打包随附的 ffprobe（@ffprobe-installer），让"双击即用"用户无需自装 ffprobe 即可探测音轨
  try {
    const installer = require("@ffprobe-installer/ffprobe") as { path?: string };
    const installerPath = typeof installer?.path === "string" ? executablePathForRuntime(installer.path) : "";
    return installerPath && commandExists(installerPath) ? installerPath : "";
  } catch {
    return "";
  }
}

function resolveFfprobePath(explicitFfprobePath?: string, explicitFfmpegPath?: string): string {
  if (typeof explicitFfprobePath === "string" && explicitFfprobePath.trim()) return explicitFfprobePath.trim();
  const envProbePath = String(process.env.NOMI_FFPROBE_PATH || "").trim();
  if (envProbePath) return envProbePath;

  const bundled = bundledFfprobePath();
  if (bundled) return bundled;

  const ffmpegPath = resolveFfmpegPath(explicitFfmpegPath);
  const sibling = siblingFfprobePath(ffmpegPath);
  if (sibling && commandExists(sibling)) return sibling;

  const executableName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return commandExists(executableName) ? executableName : "";
}

export async function probeMediaMetadata(
  inputPath: string,
  options: {
    ffprobePath?: string;
    ffmpegPath?: string;
    runProcess?: RunProbeProcess;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
  } = {},
): Promise<MediaProbeMetadata> {
  const absoluteInputPath = path.resolve(inputPath);
  if (!fs.existsSync(absoluteInputPath) || !fs.statSync(absoluteInputPath).isFile()) {
    throw new MediaProbeError("missing_file", `Media file does not exist: ${absoluteInputPath}`);
  }

  const ffprobePath = resolveFfprobePath(options.ffprobePath, options.ffmpegPath);
  if (!ffprobePath) {
    throw new MediaProbeError("probe_failed", "ffprobe executable could not be resolved");
  }

  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absoluteInputPath];
  const hasExplicitProcessLimits = options.signal !== undefined
    || options.timeoutMs !== undefined
    || options.maxStdoutBytes !== undefined
    || options.maxStderrBytes !== undefined;
  const processOptions: BoundedProcessOptions = {
    timeoutMs: options.timeoutMs ?? 15_000,
    maxStdoutBytes: options.maxStdoutBytes ?? 256 * 1024,
    maxStderrBytes: options.maxStderrBytes ?? 64 * 1024,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  let result: Awaited<ReturnType<RunProbeProcess>>;
  try {
    if (!options.runProcess) result = await runBoundedProcess(ffprobePath, args, processOptions);
    else if (hasExplicitProcessLimits) result = await options.runProcess(ffprobePath, args, processOptions);
    else result = await options.runProcess(ffprobePath, args);
  } catch (error) {
    const detail = error instanceof BoundedProcessError
      ? `ffprobe process ${error.code}`
      : "ffprobe failed to start";
    throw new MediaProbeError("probe_failed", detail);
  }

  if (result.code !== 0) {
    const detail = result.stderr.trim() || `ffprobe exited with code ${result.code}`;
    throw new MediaProbeError("probe_failed", detail);
  }

  return parseFfprobeJson(result.stdout);
}
