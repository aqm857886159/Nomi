import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createExportTempDir, createSafeOutputPaths } from "./exportPaths";

export type FfmpegProcessResult = {
  code: number | null;
  stderr: string;
};

export type RunFfmpegProcess = (command: string, args: string[]) => Promise<FfmpegProcessResult>;

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

const QUALITY_CRF: Record<"small" | "standard" | "high", string> = {
  small: "28",
  standard: "23",
  high: "18",
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

function defaultRunProcess(command: string, args: string[]): Promise<FfmpegProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
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

  const resolution = exportDimensionsForPreset(options.resolution || "1080p", options.aspectRatio || "16:9");
  const fps = Math.max(1, Math.floor(options.fps || 30));
  const vf = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`;
  const args = [
    "-y",
    "-i", inputPath,
    "-an",
    "-vf", vf,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", QUALITY_CRF[options.quality || "standard"],
    "-movflags", "+faststart",
    partialOutputPath,
  ];

  try {
    const runProcess = options.runProcess || defaultRunProcess;
    const result = await runProcess(ffmpegPath, args);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || `ffmpeg exited with code ${result.code}`;
      throw new Error(`导出失败：${detail}`);
    }
    const stat = fs.statSync(partialOutputPath);
    if (stat.size <= 0) throw new Error("导出失败：MP4 文件为空");
    fs.renameSync(partialOutputPath, outputPath);
    const finalStat = fs.statSync(outputPath);
    return {
      absolutePath: outputPath,
      relativePath: outputPaths.relativeFinalPath,
      size: finalStat.size,
    };
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
