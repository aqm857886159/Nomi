import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { absolutePathFromLocalAssetUrlAnyProject } from "../assets/localAssetFile";
import { assertProjectExportRelativePath } from "./exportPaths";
import {
  createExportJobExecutionEvidence,
  ExportJobManager,
  type ExportJobEvent,
  type ExportJobExecutionEvidence,
  type ExportJobProjectIdentity,
  type ExportJobSnapshot,
  type ExportJobVerification,
} from "./exportJobManager";
import { assertValidManifest, type NomiRenderManifestV1 } from "./exportManifest";
import {
  createExportAuditManifest,
  deriveWebmExecutionManifest,
  exportAuditManifestDigest,
} from "./exportAuditManifest";
import { planExport } from "./exportPlanner";
import { ExportCancelledError, renderFiltergraphToMp4, transcodeWebmFileToMp4, transcodeWebmToMp4, type TimelineMp4ExportResult } from "./ffmpegRunner";
import { compileFfmpegFiltergraph, type FfmpegFiltergraphPlan, type FfmpegTextOverlayInput } from "./ffmpegFiltergraph";
import { probeMediaMetadata } from "./mediaProbe";
import { appendExportTempInputChunk, finishExportTempInput as finishExportTempInputFile, removeExportTempInput } from "./exportTempInput";
import { ensureProjectFolders, projectDirById, resolveProjectRelativePath } from "../projects/repository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import { desktopT } from "../i18n";

type TimelineMp4ExportRequest = {
  projectId?: string;
  webmBytes?: ArrayBuffer | Uint8Array | number[];
  outputName?: string;
  resolution?: "720p" | "1080p";
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5" | "3:4" | "4:3" | "21:9";
  quality?: "small" | "standard" | "high";
  fps?: number;
};

type ShowExportInFolderRequest = {
  projectId?: string;
  relativePath?: string;
};

type ExportJobStartRequest = {
  projectId?: string;
  manifest?: unknown;
  outputName?: string;
};

type ExportTempInputRequest = {
  jobId?: string;
  chunk?: ArrayBuffer | Uint8Array | number[];
};

type ProductionRunExportInput = Readonly<{
  projectId: string;
  runId: string;
  outputName: string;
  manifest: unknown;
  captureWebm: () => Promise<unknown>;
}>;

const exportJobManager = new ExportJobManager();

function bufferFromExportBytes(input: TimelineMp4ExportRequest["webmBytes"]): Buffer {
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Buffer.from(input);
  throw new Error(desktopT("export.missingWebmInput"));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCurrentWebmTransitionRendererManifest(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const diagnostics = value.diagnostics;
  if (!isPlainRecord(diagnostics) || !Array.isArray(diagnostics.warnings)) return false;
  return diagnostics.warnings.some((warning) => typeof warning === "string" && /webm|capture|renderer|unresolved|unsupported tracks/i.test(warning));
}

// ── 导出后端决策（所见即所得 + 删 WebM 并行版）────────────────────────────────────
// startExportJob 里**前置**尝试编译 filtergraph 计划（解析本地资产 + ffprobe + 编译）：
//   成功 → 暂存计划、backend='filtergraph'，renderer 不录 WebM，finishExportTempInput 直接 ffmpeg 渲染源文件。
//   失败（资产无法本地解析等）→ backend='webm'，renderer 录 canvas WebM 上传，finishExportTempInput 转码。
// 决策提到 startJob 是为了 renderer 能据 backend 决定「要不要录 WebM」——不再「总是先录再可能丢弃」。
const preparedFiltergraphExports = new Map<string, { manifest: NomiRenderManifestV1; plan: FfmpegFiltergraphPlan }>();

/**
 * renderer 原始 manifest → 可直接喂 ffmpeg 的 filtergraph 计划：
 * 资产 url → 本地绝对路径 + ffprobe(hasAudio/duration)；任一资产无法解析则返回 null（回退 WebM）。
 */
/** 从 raw manifest 的 textOverlays 把每条字幕 PNG（base64）落成 jobDir 下的临时 PNG，返回 filtergraph overlay 输入。 */
function writeTextOverlayFiles(rawManifest: unknown, jobDir: string): FfmpegTextOverlayInput[] {
  if (!isPlainRecord(rawManifest) || !Array.isArray(rawManifest.textOverlays)) return [];
  const out: FfmpegTextOverlayInput[] = [];
  rawManifest.textOverlays.forEach((overlay, index) => {
    if (!isPlainRecord(overlay)) return;
    const base64 = typeof overlay.pngBase64 === "string" ? overlay.pngBase64 : "";
    const startFrame = Number(overlay.startFrame);
    const endFrame = Number(overlay.endFrame);
    if (!base64 || !Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) return;
    const filePath = path.join(jobDir, `text-overlay-${index}.png`);
    try {
      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    } catch {
      return;
    }
    out.push({ path: filePath, startFrame, endFrame });
  });
  return out;
}

async function tryBuildFiltergraphExport(
  rawManifest: unknown,
  projectId: string,
): Promise<{ manifest: NomiRenderManifestV1; plan: FfmpegFiltergraphPlan } | null> {
  if (!isPlainRecord(rawManifest)) return null;
  const rawTimeline = isPlainRecord(rawManifest.timeline) ? rawManifest.timeline : null;
  const rawProfile = isPlainRecord(rawManifest.profile) ? rawManifest.profile : null;
  const rawAssets = isPlainRecord(rawManifest.assets) ? rawManifest.assets : null;
  if (!rawTimeline || !rawProfile || !rawAssets) return null;
  if (!Array.isArray(rawTimeline.tracks) || rawTimeline.tracks.length === 0) return null;
  if (Object.keys(rawAssets).length === 0) return null;

  const resolvedAssets: Record<string, NomiRenderManifestV1["assets"][string]> = {};
  let anyHasAudio = false;
  for (const [assetId, rawAsset] of Object.entries(rawAssets)) {
    if (!isPlainRecord(rawAsset)) return null;
    const kind = rawAsset.kind;
    if (kind !== "image" && kind !== "video" && kind !== "audio") return null;
    // 信 URL 自带 projectId(C4):跨项目拖进来的素材也能导出,不再整体回退 WebM。
    const absolutePath = absolutePathFromLocalAssetUrlAnyProject(rawAsset.url);
    if (!absolutePath) return null; // 非本地/无法解析 → 整体回退 WebM
    const asset: NomiRenderManifestV1["assets"][string] = { id: assetId, kind, absolutePath };
    if (kind === "video" || kind === "audio") {
      try {
        const probe = await probeMediaMetadata(absolutePath);
        if (probe.hasAudio) {
          asset.hasAudio = true;
          anyHasAudio = true;
        }
        if (probe.durationSeconds !== undefined) asset.durationSeconds = probe.durationSeconds;
        if (probe.audioCodec !== undefined) asset.audioCodec = probe.audioCodec;
      } catch {
        // 探测失败不致命：按无音频处理
      }
    }
    resolvedAssets[assetId] = asset;
  }

  const fps = Number(rawTimeline.fps);
  const durationFrames = Number(rawTimeline.durationFrames);
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationFrames) || durationFrames <= 0) return null;

  const profile = {
    ...(rawProfile as NomiRenderManifestV1["profile"]),
    audioCodec: anyHasAudio ? ("aac" as const) : ("none" as const),
    audioMode: anyHasAudio ? ("mixdown" as const) : ("mute" as const),
    ...(anyHasAudio ? { audioBitrateKbps: 192 } : {}),
  } satisfies NomiRenderManifestV1["profile"];

  const manifest: NomiRenderManifestV1 = {
    version: 1,
    projectId,
    createdAt: typeof rawManifest.createdAt === "string" ? rawManifest.createdAt : new Date().toISOString(),
    timeline: {
      fps,
      durationFrames,
      range: { startFrame: 0, endFrame: durationFrames },
      tracks: rawTimeline.tracks as NomiRenderManifestV1["timeline"]["tracks"],
      ...(Array.isArray(rawTimeline.transitions)
        ? { transitions: rawTimeline.transitions as NomiRenderManifestV1["timeline"]["transitions"] }
        : {}),
    },
    profile,
    assets: resolvedAssets,
  };

  assertValidManifest(manifest);
  try {
    const textOverlays = isPlainRecord(rawManifest) && Array.isArray(rawManifest.textOverlays)
      ? rawManifest.textOverlays.flatMap((entry, index): FfmpegTextOverlayInput[] => {
          if (!isPlainRecord(entry)) return [];
          const startFrame = Number(entry.startFrame);
          const endFrame = Number(entry.endFrame);
          if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) return [];
          return [{ path: path.resolve(path.sep, "nomi-export-preflight", `text-overlay-${index}.png`), startFrame, endFrame }];
        })
      : [];
    const plan = compileFfmpegFiltergraph({ manifest, textOverlays });
    if (plan.warnings.length > 0) {
      manifest.diagnostics = {
        warnings: [...(manifest.diagnostics?.warnings ?? []), ...plan.warnings],
      };
    }
    return { manifest, plan };
  } catch {
    return null; // 校验/编译失败 → 回退 WebM
  }
}

export async function executeProductionRunExport(input: ProductionRunExportInput): Promise<{ relativePath: string; size: number }> {
  const projectId = String(input.projectId || "").trim();
  const runId = String(input.runId || "").trim();
  if (!projectId || !/^[A-Za-z0-9._-]{1,160}$/.test(runId)) throw new Error("Production export identity is invalid");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Production export project was not found");
  ensureProjectFolders(projectDir);

  const prepared = await tryBuildFiltergraphExport(input.manifest, projectId);
  const backend = prepared ? "filtergraph" as const : "webm" as const;
  const audit = createExportAuditManifest(input.manifest, {
    projectId,
    backend,
    ...(prepared ? { effectiveProfile: prepared.manifest.profile } : {}),
  });
  planExport(prepared?.manifest ?? deriveWebmExecutionManifest(audit));

  const runDir = path.join(projectDir, ".nomi", "runs", runId);
  const workDir = path.join(runDir, "export-work");
  fs.mkdirSync(workDir, { recursive: true });
  let inputDigest: string | undefined;
  let result!: TimelineMp4ExportResult;
  try {
    if (prepared) {
      const textOverlays = writeTextOverlayFiles(input.manifest, workDir);
      result = await renderFiltergraphToMp4({
        jobId: `production-${runId}`,
        projectDir,
        outputName: input.outputName,
        profile: prepared.manifest.profile,
        filtergraph: compileFfmpegFiltergraph({ manifest: prepared.manifest, textOverlays }),
        durationMs: Math.max(0, prepared.manifest.timeline.durationFrames / Math.max(1, prepared.manifest.timeline.fps) * 1000),
        stderrLogPath: path.join(runDir, "ffmpeg.log"),
      });
    } else {
      const bytes = bufferFromExportBytes(await input.captureWebm() as TimelineMp4ExportRequest["webmBytes"]);
      inputDigest = createHash("sha256").update(bytes).digest("hex");
      result = await transcodeWebmToMp4({
        jobId: `production-${runId}`,
        projectDir,
        inputBytes: bytes,
        outputName: input.outputName,
        resolution: resolutionFromProfile(audit.profile),
        aspectRatio: aspectRatioFromProfile(audit.profile),
        quality: audit.profile.quality || "standard",
        fps: audit.profile.fps || audit.timeline.fps || 30,
        durationMs: Math.max(0, audit.timeline.durationFrames / Math.max(1, audit.timeline.fps) * 1000),
        stderrLogPath: path.join(runDir, "ffmpeg.log"),
      });
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  fs.writeFileSync(path.join(runDir, "manifest.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(runDir, "export-execution.json"), `${JSON.stringify({
    schemaVersion: 1,
    buildSha: String(process.env.NOMI_BUILD_SHA || process.env.GITHUB_SHA || "development").trim(),
    owner: "production-run",
    runId,
    backend,
    auditManifestDigest: exportAuditManifestDigest(audit),
    ...(inputDigest ? { inputDigest } : {}),
    output: { relativePath: result.relativePath, bytes: result.size },
  }, null, 2)}\n`, "utf8");
  return { relativePath: result.relativePath, size: result.size };
}

function exportProjectIdentity(value: ExportJobProjectIdentity): ExportJobProjectIdentity {
  return Object.freeze({
    projectId: String(value.projectId || "").trim(),
    immutableProjectUuid: String(value.immutableProjectUuid || "").trim(),
    projectGeneration: Number(value.projectGeneration),
    canonicalRootDigest: String(value.canonicalRootDigest || "").trim(),
  });
}

function sameExportProjectIdentity(left: ExportJobProjectIdentity, right: ExportJobProjectIdentity): boolean {
  return left.projectId === right.projectId
    && left.immutableProjectUuid === right.immutableProjectUuid
    && left.projectGeneration === right.projectGeneration
    && left.canonicalRootDigest === right.canonicalRootDigest;
}

export async function startExportJob(
  payload: unknown,
  authorizedIdentity?: ExportJobProjectIdentity,
): Promise<{ jobId: string; backend: "filtergraph" | "webm" }> {
  const raw = (payload || {}) as ExportJobStartRequest;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  ensureProjectFolders(projectDir);
  const diskIdentity = exportProjectIdentity(await ensureWorkspaceProjectIdentity(projectDir));
  if (diskIdentity.projectId !== projectId) throw new Error("Export project identity is unavailable");
  const projectIdentity = authorizedIdentity ? exportProjectIdentity(authorizedIdentity) : diskIdentity;
  if (!sameExportProjectIdentity(projectIdentity, diskIdentity)) {
    throw new Error("Export project identity changed before job creation");
  }
  const prepared = await tryBuildFiltergraphExport(raw.manifest, projectId);
  const backend: "filtergraph" | "webm" = prepared ? "filtergraph" : "webm";
  if (isPlainRecord(raw.manifest) && isPlainRecord(raw.manifest.assets)) {
    for (const asset of Object.values(raw.manifest.assets)) {
      if (isPlainRecord(asset) && "absolutePath" in asset) {
        throw new Error("Export job asset resolution is not wired yet; renderer assets cannot supply absolutePath.");
      }
    }
  }
  if (!prepared && isPlainRecord(raw.manifest) && isPlainRecord(raw.manifest.assets)
    && Object.keys(raw.manifest.assets).length > 0 && !isCurrentWebmTransitionRendererManifest(raw.manifest)) {
    throw new Error("Export job asset resolution is not wired yet; renderer assets cannot start a production export job.");
  }
  const manifest = createExportAuditManifest(raw.manifest, {
    projectId,
    backend,
    ...(prepared ? { effectiveProfile: prepared.manifest.profile } : {}),
  });
  const executionManifest = prepared?.manifest ?? deriveWebmExecutionManifest(manifest);
  planExport(executionManifest);
  const job = exportJobManager.createJob({ projectIdentity, projectDir, manifest, outputName: raw.outputName });
  if (prepared) {
    const textOverlays = writeTextOverlayFiles(raw.manifest, job.jobDir);
    preparedFiltergraphExports.set(job.id, {
      manifest: prepared.manifest,
      plan: compileFfmpegFiltergraph({ manifest: prepared.manifest, textOverlays }),
    });
  }

  exportJobManager.updateJob(job.id, {
    status: "planning",
    progress: { ratio: 0.02, stage: "planning", message: `Planned ${backend} export backend` },
  });
  return { jobId: job.id, backend };
}

export function getExportJobStatus(projectIdentity: ExportJobProjectIdentity, jobId: string): ExportJobSnapshot {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  return exportJobManager.getJobForProject(exportProjectIdentity(projectIdentity), id);
}

export function verifyExportJob(projectIdentity: ExportJobProjectIdentity, jobId: string): ExportJobVerification {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  return exportJobManager.verifyJobOutputForProject(exportProjectIdentity(projectIdentity), id);
}

export function listExportJobs(projectIdentity: ExportJobProjectIdentity): ExportJobSnapshot[] {
  const identity = exportProjectIdentity(projectIdentity);
  const projectDir = projectDirById(identity.projectId);
  if (!projectDir) throw new Error("Project not found");
  return exportJobManager.listJobsForProject(identity, projectDir);
}

export async function cancelExportJob(projectIdentity: ExportJobProjectIdentity, jobId: string): Promise<{ ok: true }> {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  const identity = exportProjectIdentity(projectIdentity);
  const job = exportJobManager.getJobForProject(identity, id);
  activeExportAbortControllers.get(id)?.abort();
  await exportJobManager.cancelJobForProject(identity, id);
  removeExportTempInput(job);
  preparedFiltergraphExports.delete(id);
  return { ok: true };
}

/**
 * App 退出时统一中止所有在跑导出：abort 每个 active controller → ffmpegRunner 监听
 * abort 后 child.kill()（见 ffmpegRunner runProcess），子进程不再变孤儿。
 * 返回被中止的数量，便于上层日志。同步、不抛——退出路径上不能因清理失败拖住退出。
 */
export function abortAllActiveExports(): number {
  let aborted = 0;
  for (const controller of activeExportAbortControllers.values()) {
    try {
      controller.abort();
      aborted += 1;
    } catch {
      // 退出清理：单个 abort 失败不影响其余，绝不抛。
    }
  }
  return aborted;
}

const EXPORT_TEMP_INPUT_WRITABLE_STATUSES = new Set(["queued", "preparing", "planning", "rendering", "encoding", "muxing", "finalizing"]);
const activeExportAbortControllers = new Map<string, AbortController>();

function requireWritableExportJob(projectIdentity: ExportJobProjectIdentity, jobId: unknown): ExportJobSnapshot {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  const job = exportJobManager.getJobForProject(exportProjectIdentity(projectIdentity), id);
  if (job.cancelled || !EXPORT_TEMP_INPUT_WRITABLE_STATUSES.has(job.status)) {
    throw new Error(`Cannot write temp input for export job ${id} while it is ${job.status}`);
  }
  return job;
}

function aspectRatioFromProfile(profile: NomiRenderManifestV1["profile"]): TimelineMp4ExportRequest["aspectRatio"] {
  const ratio = profile.width / profile.height;
  const candidates: Array<{ value: NonNullable<TimelineMp4ExportRequest["aspectRatio"]>; ratio: number }> = [
    { value: "16:9", ratio: 16 / 9 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "1:1", ratio: 1 },
    { value: "4:5", ratio: 4 / 5 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "21:9", ratio: 21 / 9 },
  ];
  return candidates.sort((a, b) => Math.abs(a.ratio - ratio) - Math.abs(b.ratio - ratio))[0]?.value || "16:9";
}

function resolutionFromProfile(profile: NomiRenderManifestV1["profile"]): TimelineMp4ExportRequest["resolution"] {
  return Math.max(profile.width, profile.height) <= 1280 ? "720p" : "1080p";
}

export async function writeExportTempInput(
  projectIdentity: ExportJobProjectIdentity,
  payload: unknown,
): Promise<{ ok: true; size: number }> {
  const raw = (payload || {}) as ExportTempInputRequest;
  const job = requireWritableExportJob(projectIdentity, raw.jobId);
  const result = appendExportTempInputChunk(job, raw.chunk as never);
  exportJobManager.updateJob(job.id, {
    status: job.status === "queued" ? "preparing" : job.status,
    progress: { ratio: Math.max(job.progress.ratio, 0.08), stage: job.status === "queued" ? "preparing" : job.status, message: "Receiving WebM input" },
  });
  return result;
}

export async function finishExportTempInput(
  projectIdentity: ExportJobProjectIdentity,
  payload: unknown,
): Promise<unknown> {
  const raw = (payload || {}) as ExportTempInputRequest;
  const job = requireWritableExportJob(projectIdentity, raw.jobId);
  const controller = new AbortController();
  activeExportAbortControllers.set(job.id, controller);
  try {
    const prepared = preparedFiltergraphExports.get(job.id);
    const profile = job.manifest.profile;
    const durationMs = Math.max(0, (job.manifest.timeline.durationFrames / Math.max(1, job.manifest.timeline.fps)) * 1000);
    const stderrLogPath = path.join(job.jobDir, "ffmpeg.log");
    exportJobManager.updateJob(job.id, {
      status: "encoding",
      progress: { ratio: Math.max(job.progress.ratio, 0.12), stage: "encoding", message: "Encoding MP4" },
    });

    const onEncodeProgress = (progress: { ratio: number; message?: string }) => {
      const current = exportJobManager.getJob(job.id);
      if (!current || current.cancelled) return;
      exportJobManager.updateJob(job.id, {
        status: "encoding",
        progress: {
          ratio: Math.max(current.progress.ratio, 0.12 + progress.ratio * 0.84),
          stage: "encoding",
          message: progress.message || "Encoding MP4",
        },
      });
    };

    let result: TimelineMp4ExportResult;
    let executionInput: ExportJobExecutionEvidence["input"] = { kind: "filtergraph" };
    if (prepared) {
      // 主路径（startJob 已编译好计划）：filtergraph 直读源文件渲染（含音频 + 取景 WYSIWYG）。
      // 此模式 renderer 未录 WebM，无临时输入文件可读 —— 直接渲染，不调 finishExportTempInputFile。
      const fgDurationMs = Math.max(
        0,
        (prepared.manifest.timeline.durationFrames / Math.max(1, prepared.manifest.timeline.fps)) * 1000,
      );
      result = await renderFiltergraphToMp4({
        jobId: job.id,
        projectDir: job.projectDir,
        outputName: job.outputName || "nomi-export",
        profile: prepared.manifest.profile,
        filtergraph: prepared.plan,
        durationMs: fgDurationMs,
        signal: controller.signal,
        stderrLogPath,
        onProgress: onEncodeProgress,
      });
    } else {
      // 降级路径：资产无法本地解析 → renderer 录的 canvas WebM → MP4（无音频）。
      const { inputPath, size, sha256 } = finishExportTempInputFile(job);
      executionInput = { kind: "webm", bytes: size, sha256 };
      result = await transcodeWebmFileToMp4({
        jobId: job.id,
        projectDir: job.projectDir,
        inputPath,
        outputName: job.outputName || "nomi-export",
        resolution: resolutionFromProfile(profile),
        aspectRatio: aspectRatioFromProfile(profile),
        quality: profile.quality || "standard",
        fps: profile.fps || job.manifest.timeline.fps || 30,
        durationMs,
        signal: controller.signal,
        stderrLogPath,
        onProgress: onEncodeProgress,
      });
    }
    if (controller.signal.aborted || exportJobManager.getJob(job.id)?.cancelled) {
      throw new ExportCancelledError();
    }
    exportJobManager.updateJob(job.id, {
      status: "finalizing",
      progress: { ratio: 0.98, stage: "finalizing", message: "Finalizing MP4" },
    });
    exportJobManager.completeJob(job.id, {
      outputPath: result.absolutePath,
      relativeOutputPath: result.relativePath,
      bytes: result.size,
      durationMs,
      execution: createExportJobExecutionEvidence(job.manifest, executionInput),
    });
    return result;
  } catch (error) {
    if (error instanceof ExportCancelledError || exportJobManager.getJob(job.id)?.cancelled) {
      await exportJobManager.cancelJob(job.id);
    } else {
      exportJobManager.failJob(job.id, error);
    }
    throw error;
  } finally {
    activeExportAbortControllers.delete(job.id);
    removeExportTempInput(job);
    preparedFiltergraphExports.delete(job.id);
  }
}

export function subscribeExportJobEvents(listener: (event: ExportJobEvent) => void): () => void {
  return exportJobManager.onEvent(listener);
}

export async function startTimelineMp4Export(payload: unknown): Promise<unknown> {
  const raw = (payload || {}) as TimelineMp4ExportRequest;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error(desktopT("export.missingProjectId"));
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error(desktopT("export.projectNotFound"));
  ensureProjectFolders(projectDir);
  return transcodeWebmToMp4({
    projectDir,
    inputBytes: bufferFromExportBytes(raw.webmBytes),
    outputName: raw.outputName || "nomi-export",
    resolution: raw.resolution || "1080p",
    aspectRatio: raw.aspectRatio || "16:9",
    quality: raw.quality || "standard",
    fps: raw.fps || 30,
  });
}

export function showExportInFolder(payload: unknown): { ok: true } {
  const raw = (payload || {}) as ShowExportInFolderRequest;
  const projectId = String(raw.projectId || "").trim();
  const relativePath = String(raw.relativePath || "").trim();
  if (!projectId) throw new Error(desktopT("export.reveal.missingProjectId"));
  if (!relativePath) throw new Error(desktopT("export.reveal.missingPath"));
  let normalized: string;
  try {
    normalized = assertProjectExportRelativePath(relativePath);
  } catch {
    throw new Error(desktopT("export.reveal.outsideExports"));
  }
  const resolved = resolveProjectRelativePath(projectId, normalized);
  if (!fs.existsSync(resolved)) throw new Error(desktopT("export.reveal.fileMissing"));
  // Lazy require keeps runtime.ts usable in tests that do not initialize Electron shell.
  const { shell } = require("electron") as typeof import("electron");
  shell.showItemInFolder(resolved);
  return { ok: true };
}
