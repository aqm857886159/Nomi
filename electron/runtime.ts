import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hardenedFetch, hardenedFetchText } from "./hardenedFetch";
import { localizeAssetsForVendor, resolveAssetIngestion } from "./catalog/assetLocalization";
import { absolutePathFromLocalAssetUrl, readNomiLocalAsset, postJsonForAssetUpload } from "./assets/localAssetFile";
import { streamText, tool, type CoreMessage, type LanguageModelV1 } from "ai";
import { agentStreamTuning, buildAgentPromptParts, capAgentHistory, createLinkedAbortController } from "./ai/agentChatHarness";
import { z } from "zod";
import { buildAiSdkModel } from "./ai/buildAiSdkModel";
import { consumeAgentStreamWithTimeout } from "./ai/agentStreamConsumer";
import { mergeMissingParamsIntoBody } from "./ai/onboarding/curlBlueprint";
import { assertProjectExportRelativePath, ensureExportDirs } from "./export/exportPaths";
import { ExportJobManager, type ExportJobEvent, type ExportJobSnapshot } from "./export/exportJobManager";
import { assertValidManifest, type NomiRenderManifestV1 } from "./export/exportManifest";
import { planExport } from "./export/exportPlanner";
import { ExportCancelledError, renderFiltergraphToMp4, transcodeWebmFileToMp4, transcodeWebmToMp4, type TimelineMp4ExportResult } from "./export/ffmpegRunner";
import { compileFfmpegFiltergraph, type FfmpegFiltergraphPlan } from "./export/ffmpegFiltergraph";
import { probeMediaMetadata } from "./export/mediaProbe";
import { endpoint } from "./vendorEndpoint";
import { appendExportTempInputChunk, finishExportTempInput as finishExportTempInputFile, removeExportTempInput } from "./export/exportTempInput";
import {
  canvasNodeKindSchema,
  plannedEdgeSchema,
  plannedNodeSchema,
  type CanvasToolName,
} from "./ai/canvasTools";
import {
  documentTools,
  type DocumentToolName,
} from "./ai/documentTools";
import {
  type AuthType,
  appendQueryParams,
  authHeaders as buildAuthHeaders,
  authQueryParams as buildAuthQueryParams,
  buildHttpRequest,
  buildTemplateContext,
  extractTaskId as extractTaskIdShared,
  looksLikeLogicalError,
} from "./ai/requestPipeline";
import { sanitizeForBroadCompat } from "./ai/promptSanitize";
import { discoverLegacyProjects, isLegacyProjectSuppressed, suppressLegacyProjectRediscovery } from "./workspace/legacyProjectMigration";
import {
  createWorkspaceProject,
  listWorkspaceProjects,
  readWorkspaceProject,
  removeWorkspaceProjectReference,
  resolveWorkspaceProjectDir,
  saveWorkspaceProject,
  type WorkspaceRepositoryDeps,
} from "./workspace/workspaceRepository";
import { rememberWorkspace } from "./workspace/workspaceRegistry";
import { resolveWorkspaceRelativePath } from "./workspace/workspacePaths";
import { firstString, isJsonRecord, nowIso, readNestedRecord, trim, type JsonRecord } from "./jsonUtils";
import {
  collectAssetUrls,
  firstMappedString,
  providerMetaFromResponse,
  taskStatusFromResponse,
  valuesFromMapping,
} from "./tasks/responseParsing";
import { TtlLruCache } from "./tasks/taskCache";
import {
  assetBucketFromMeta,
  assetKindFromContentType,
  contentTypeFromPath,
  extensionFromMime,
  extensionFromUrl,
  localAssetUrl,
  stableAssetId,
} from "./assets/assetPaths";
import {
  type ApiKeyRecord,
  decryptApiKeyRecord,
  isSafeStorageAvailable,
  makeApiKeyRecordFromPlain,
} from "./catalog/secrets";
import { writeJsonFileAtomic } from "./jsonFile";
import {
  CATALOG_FILE,
  PROJECT_FILE,
  PROJECT_ROOT_ENV,
  SKILLS_ROOT_ENV,
  ensureDir,
  getProjectsRoot,
  getSettingsRoot,
  getSkillsRoots,
  getWorkspaceRepositoryDeps,
  readJson,
  readText,
} from "./runtimePaths";
import {
  createProject,
  deleteProject,
  ensureProjectFolders,
  listProjects,
  projectDirById,
  readProject,
  resolveProjectRelativePath,
  sanitizeName,
  saveProject,
} from "./projects/repository";
// 公共 API：main.ts 仍从 "./runtime" 消费这些 —— re-export 保持其 import 不变。
export { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject };

// Catalog 领域类型已抽到 ./catalog/types（单一真相源，评审 CTO/M1 + P0-3）。
// 本文件 import 供内部使用，并 re-export 让外部 "./runtime" 消费方 import 不变。
import type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  HttpOperation,
  Mapping,
  Model,
  ProfileKind,
  Vendor,
} from "./catalog/types";
import { CURRENT_CATALOG_VERSION, selectTaskMapping } from "./catalog/types";
import { firstReferenceImage, taskTemplateParams } from "./catalog/taskParams";
import { applyBuiltinSeeds } from "./catalog/seedBuiltins";
export type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  CatalogVersion,
  HttpOperation,
  Mapping,
  Model,
  ProfileKind,
  Vendor,
} from "./catalog/types";

type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown>;
};

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

type TaskResult = {
  id: string;
  kind: ProfileKind;
  status: "queued" | "running" | "succeeded" | "failed";
  assets: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    assetId?: string | null;
    assetRefId?: string | null;
    assetName?: string | null;
  }>;
  raw: unknown;
  /**
   * E11: Complete provenance for reproducibility. Populated on successful
   * generation. Renderer copies this into GenerationNodeResult.provenance.
   */
  provenance?: {
    provider?: string;
    modelKey?: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    params?: Record<string, unknown>;
    vendorRequestId?: string;
    timestamp: number;
  };
};

// TTL(1h) + LRU(200) 上限，防异步任务条目无界驻留（P0-7）。不再缓存明文 apiKey。
const taskCache = new TtlLruCache<CachedTask>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });
const exportJobManager = new ExportJobManager();

type CachedTask = {
  vendor: string;
  request: TaskRequest;
  raw: unknown;
  mapping?: Mapping | null;
  model?: Model;
  providerMeta?: JsonRecord;
  projectId?: string;
  nodeId?: string;
  wantedKind?: BillingModelKind;
};

type LocalAssetRecord = {
  id: string;
  name: string;
  userId: "local";
  projectId: string;
  createdAt: string;
  updatedAt: string;
  data: {
    url: string;
    relativePath: string;
    absolutePath: string;
    contentType: string;
    size: number;
    kind: string;
  };
};

type SkillRecord = {
  name: string;
  directoryName: string;
  filePath: string;
  body: string;
};



function parseSkillName(markdown: string, directoryName: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  return String(nameMatch?.[1] || directoryName).trim();
}

function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function readSkillRecords(): SkillRecord[] {
  const records: SkillRecord[] = [];
  for (const root of getSkillsRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(filePath)) continue;
      const body = readText(filePath).trim();
      if (!body) continue;
      records.push({
        name: parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath,
        body,
      });
    }
  }
  return records;
}


function readRequestedSkill(payload: JsonRecord): { key: string; name: string } {
  const chatContext = payload.chatContext;
  const skill = readNestedRecord(chatContext, ["skill"]);
  return {
    key: trim(readNestedRecord(skill, ["key"])),
    name: trim(readNestedRecord(skill, ["name"])),
  };
}

function findSkillRecord(skillKey: string, skillName: string): SkillRecord | null {
  const records = readSkillRecords();
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);

  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;

  const prefix = records
    .filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;

  return records.find((skill) => (
    normalizeSkillLookupKey(skill.name) === normalizedKey
    || normalizeSkillLookupKey(skill.directoryName) === normalizedKey
    || (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName)
    || (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)
  )) || null;
}

/**
 * Universal language directive injected into every agent chat (v1 + v2),
 * regardless of which area or skill triggered it. Single source of truth so we
 * never have to repeat "reply in the user's language" in each prompt builder.
 */
const AGENT_LANGUAGE_DIRECTIVE = [
  "语言规则（最高优先级，覆盖一切其他指令）：",
  "始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文。",
  "永远不要因为本系统提示或某个 skill 是用中文/英文写的，就固定用那种语言；以用户最近一条消息的语言为准。",
].join("\n");

function buildSkillSystemPrompt(payload: JsonRecord): string {
  const requested = readRequestedSkill(payload);
  if (!requested.key && !requested.name) return "";
  const skill = findSkillRecord(requested.key, requested.name);
  if (!skill) {
    return [
      "Nomi 桌面 Agent skill 提示：",
      `请求的 skill 未在本地 skills 目录找到：${requested.key || requested.name}`,
      "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
    ].join("\n");
  }
  return [
    "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
    "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
    `skillKey: ${requested.key || skill.name}`,
    `skillName: ${requested.name || skill.name}`,
    `skillFile: ${path.relative(process.cwd(), skill.filePath)}`,
    "",
    skill.body,
  ].join("\n");
}


function bufferFromExportBytes(input: TimelineMp4ExportRequest["webmBytes"]): Buffer {
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Buffer.from(input);
  throw new Error("导出失败：缺少 WebM 输入数据");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnresolvedRendererAssets(manifest: NomiRenderManifestV1): boolean {
  return Object.values(manifest.assets).some((asset) => !isPlainRecord(asset) || typeof asset.absolutePath !== "string");
}

function isCurrentWebmTransitionRendererManifest(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const diagnostics = value.diagnostics;
  if (!isPlainRecord(diagnostics) || !Array.isArray(diagnostics.warnings)) return false;
  return diagnostics.warnings.some((warning) => typeof warning === "string" && /webm|capture|renderer|unresolved|unsupported tracks/i.test(warning));
}

function sanitizeCurrentWebmTransitionManifest(value: Record<string, unknown>): unknown {
  const timeline = isPlainRecord(value.timeline) ? value.timeline : {};
  return {
    ...value,
    timeline: {
      ...timeline,
      tracks: [],
    },
    assets: {},
  };
}

function parseExportJobManifest(value: unknown): NomiRenderManifestV1 {
  const manifestValue = isCurrentWebmTransitionRendererManifest(value) ? sanitizeCurrentWebmTransitionManifest(value) : value;
  if (isPlainRecord(manifestValue) && isPlainRecord(manifestValue.assets)) {
    for (const asset of Object.values(manifestValue.assets)) {
      if (isPlainRecord(asset) && ("url" in asset || "absolutePath" in asset)) {
        throw new Error("Export job asset resolution is not wired yet; renderer assets cannot start a production export job.");
      }
    }
  }
  assertValidManifest(manifestValue);
  if (hasUnresolvedRendererAssets(manifestValue)) {
    throw new Error("Export job asset resolution is not wired yet; manifest assets must include absolutePath.");
  }
  return manifestValue;
}

// ── filtergraph 导出主路径（音频 + letterbox WYSIWYG）；失败回退 WebM 转码 ──────────
// 按 jobId 暂存 renderer 原始 manifest；finishExportTempInput 里解析本地资产 + ffprobe + 编译 filtergraph。
const rawExportManifests = new Map<string, unknown>();

/**
 * renderer 原始 manifest → 可直接喂 ffmpeg 的 filtergraph 计划：
 * 资产 url → 本地绝对路径 + ffprobe(hasAudio/duration)；任一资产无法解析则返回 null（回退 WebM）。
 */
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
    const absolutePath = absolutePathFromLocalAssetUrl(rawAsset.url, projectId);
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
    },
    profile,
    assets: resolvedAssets,
  };

  try {
    assertValidManifest(manifest);
    const plan = compileFfmpegFiltergraph({ manifest });
    return { manifest, plan };
  } catch {
    return null; // 校验/编译失败 → 回退 WebM
  }
}

export function startExportJob(payload: unknown): { jobId: string } {
  const raw = (payload || {}) as ExportJobStartRequest;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  ensureProjectFolders(projectDir);
  const manifest = parseExportJobManifest(raw.manifest);
  if (manifest.projectId !== projectId) {
    throw new Error("Export job projectId must match manifest.projectId");
  }
  const plan = planExport(manifest);
  const job = exportJobManager.createJob({ projectId, projectDir, manifest, outputName: raw.outputName });
  // 暂存 renderer 原始 manifest，供 finishExportTempInput 解析本地资产走 filtergraph 主路径
  rawExportManifests.set(job.id, raw.manifest);
  exportJobManager.updateJob(job.id, {
    status: "planning",
    progress: { ratio: 0.02, stage: "planning", message: `Planned ${plan.backend} export backend` },
  });
  return { jobId: job.id };
}

export function getExportJobStatus(jobId: string): ExportJobSnapshot {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  const snapshot = exportJobManager.getJob(id);
  if (!snapshot) throw new Error(`Export job ${id} was not found`);
  return snapshot;
}

export async function cancelExportJob(jobId: string): Promise<{ ok: true }> {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  const job = exportJobManager.getJob(id);
  activeExportAbortControllers.get(id)?.abort();
  await exportJobManager.cancelJob(id);
  if (job) removeExportTempInput(job);
  rawExportManifests.delete(id);
  return { ok: true };
}

const EXPORT_TEMP_INPUT_WRITABLE_STATUSES = new Set(["queued", "preparing", "planning", "rendering", "encoding", "muxing", "finalizing"]);
const activeExportAbortControllers = new Map<string, AbortController>();

function requireWritableExportJob(jobId: unknown): ExportJobSnapshot {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId is required");
  const job = exportJobManager.getJob(id);
  if (!job) throw new Error(`Export job ${id} was not found`);
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

export async function writeExportTempInput(payload: unknown): Promise<{ ok: true; size: number }> {
  const raw = (payload || {}) as ExportTempInputRequest;
  const job = requireWritableExportJob(raw.jobId);
  const result = appendExportTempInputChunk(job, raw.chunk as never);
  exportJobManager.updateJob(job.id, {
    status: job.status === "queued" ? "preparing" : job.status,
    progress: { ratio: Math.max(job.progress.ratio, 0.08), stage: job.status === "queued" ? "preparing" : job.status, message: "Receiving WebM input" },
  });
  return result;
}

export async function finishExportTempInput(payload: unknown): Promise<unknown> {
  const raw = (payload || {}) as ExportTempInputRequest;
  const job = requireWritableExportJob(raw.jobId);
  const controller = new AbortController();
  activeExportAbortControllers.set(job.id, controller);
  try {
    const { inputPath } = finishExportTempInputFile(job);
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

    // 主路径：解析本地资产 → filtergraph 直读源文件渲染（含音频 + letterbox WYSIWYG）
    let result: TimelineMp4ExportResult | null = null;
    const rawManifest = rawExportManifests.get(job.id);
    if (rawManifest !== undefined) {
      try {
        const filtergraphExport = await tryBuildFiltergraphExport(rawManifest, job.manifest.projectId);
        if (filtergraphExport) {
          const fgDurationMs = Math.max(
            0,
            (filtergraphExport.manifest.timeline.durationFrames / Math.max(1, filtergraphExport.manifest.timeline.fps)) * 1000,
          );
          result = await renderFiltergraphToMp4({
            jobId: job.id,
            projectDir: job.projectDir,
            outputName: job.outputName || "nomi-export",
            profile: filtergraphExport.manifest.profile,
            filtergraph: filtergraphExport.plan,
            durationMs: fgDurationMs,
            signal: controller.signal,
            stderrLogPath,
            onProgress: onEncodeProgress,
          });
        }
      } catch (filtergraphError) {
        if (filtergraphError instanceof ExportCancelledError || controller.signal.aborted) throw filtergraphError;
        // filtergraph 失败 → 记录并回退 WebM 转码（保证导出不中断）
        try {
          fs.appendFileSync(stderrLogPath, `\n[filtergraph fallback] ${filtergraphError instanceof Error ? filtergraphError.message : String(filtergraphError)}\n`);
        } catch {
          /* ignore log write failure */
        }
        result = null;
      }
    }

    // 回退路径：WebM → MP4（视频帧由 renderer canvas 录制而来，无音频）
    if (!result) {
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
    rawExportManifests.delete(job.id);
  }
}

export function subscribeExportJobEvents(listener: (event: ExportJobEvent) => void): () => void {
  return exportJobManager.onEvent(listener);
}

export async function startTimelineMp4Export(payload: unknown): Promise<unknown> {
  const raw = (payload || {}) as TimelineMp4ExportRequest;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("导出失败：缺少项目 ID");
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("导出失败：Project not found");
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
  if (!projectId) throw new Error("打开导出位置失败：缺少项目 ID");
  if (!relativePath) throw new Error("打开导出位置失败：缺少导出文件路径");
  let normalized: string;
  try {
    normalized = assertProjectExportRelativePath(relativePath);
  } catch {
    throw new Error("打开导出位置失败：只能打开当前项目 exports 文件夹内的文件");
  }
  const resolved = resolveProjectRelativePath(projectId, normalized);
  if (!fs.existsSync(resolved)) throw new Error("打开导出位置失败：导出文件不存在");
  // Lazy require keeps runtime.ts usable in tests that do not initialize Electron shell.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { shell } = require("electron") as typeof import("electron");
  shell.showItemInFolder(resolved);
  return { ok: true };
}

function catalogPath(): string {
  return path.join(getSettingsRoot(), CATALOG_FILE);
}

function defaultCatalog(): CatalogState {
  // v0.8: empty catalog. Fresh users add their own models via the Wizard.
  // No more phantom seed entries (chatfire/sora/gpt-4o-mini) that have no keys.
  return {
    version: CURRENT_CATALOG_VERSION,
    vendors: [],
    models: [],
    mappings: [],
    apiKeysByVendor: {},
  };
}

function readCatalog(): CatalogState {
  const parsed = readJson<CatalogState | null>(catalogPath(), null);
  if (!parsed) {
    const initial = defaultCatalog();
    writeCatalog(initial);
    return initial;
  }

  // Migrate forward. v1 → v2: tag pre-existing keys as plaintext-encoded; M5.2
  // will lazy-upgrade them to safeStorage on first read once that lands.
  const migrated = migrateCatalogForward(parsed);

  const apiKeysByVendor = migrated.apiKeysByVendor || {};
  return {
    ...migrated,
    vendors: migrated.vendors.map((vendor) => ({
      ...vendor,
      providerKind: normalizeProviderKind(vendor.providerKind),
      hasApiKey: Boolean(apiKeysByVendor[vendor.key]?.apiKey && apiKeysByVendor[vendor.key]?.enabled !== false),
    })),
    apiKeysByVendor,
  };
}

/**
 * 应用内置模型种子（内置档案：Seedance 等主流模型）。**app 启动时调一次**——
 * 不放进 readCatalog（那会在每次读取/测试里都触发，污染测试且多余）。幂等、存在即跳过，
 * 写盘只在新建或种子有变化时发生。
 */
export function ensureBuiltinModelSeeds(): void {
  const current = readJson<CatalogState | null>(catalogPath(), null);
  const base = current ? migrateCatalogForward(current) : defaultCatalog();
  const { state, changed } = applyBuiltinSeeds(base, new Date().toISOString());
  if (!current || changed) writeCatalog(state);
}

/**
 * Convert one legacy mapping payload into a `{create, query}` pair, handling:
 *  - bare op: `{method, path, headers, body}` → treat as create
 *  - v2 envelope: `{version: "v2", create: {default: op}, query: {default: op}}`
 *    → unwrap both stages
 * Returns whatever is recognizable; the caller merges across rows.
 */
function extractLegacyStages(raw: unknown): { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } {
  if (!isJsonRecord(raw)) return {};
  const out: { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } = {};
  const opFrom = (v: unknown): HttpOperation | undefined => {
    if (!isJsonRecord(v)) return undefined;
    const inner = isJsonRecord(v.default) ? v.default : v;
    if (typeof inner.method === "string" && typeof inner.path === "string") return inner as unknown as HttpOperation;
    return undefined;
  };
  // Bare op first — a legacy {method, path, headers, body, query} row has its
  // own `query` field (HTTP query params), so envelope detection by the
  // presence of `raw.query` is wrong. Only unwrap an envelope when the marker
  // `version === "v2"` is present or `raw.create` is itself an op.
  if (typeof raw.method === "string" && typeof raw.path === "string") {
    out.create = raw as unknown as HttpOperation;
  } else if (raw.version === "v2" || opFrom(raw.create) || opFrom(raw.query)) {
    const c = opFrom(raw.create);
    const q = opFrom(raw.query);
    if (c) out.create = c;
    if (q) out.query = q;
    if (isJsonRecord(raw.status_mapping)) out.statusMapping = raw.status_mapping as Record<string, string[]>;
  }
  return out;
}

function normalizeLegacyMappings(rawMappings: unknown): Mapping[] {
  const list = Array.isArray(rawMappings) ? rawMappings : [];
  const grouped = new Map<string, Mapping>();
  for (const item of list) {
    if (!isJsonRecord(item)) continue;
    const vendorKey = String(item.vendorKey || "").trim();
    const taskKind = (item.taskKind as ProfileKind) || "chat";
    if (!vendorKey) continue;
    const key = `${vendorKey}|${taskKind}`;
    const existing = grouped.get(key);
    const name = String(item.name || "");
    const isQueryRow = /\bquery\b/i.test(name);
    const fromRequest = extractLegacyStages(item.requestMapping);
    const fromResponse = extractLegacyStages(item.responseMapping);
    // If the row's name says "query" but the legacy op landed in `create`,
    // promote it to `query` — those old rows stored a single op regardless of stage.
    const stages: { create?: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> } = {};
    for (const stage of [fromRequest, fromResponse]) {
      if (stage.create && isQueryRow && !stage.query) {
        stages.query = stages.query || stage.create;
      } else {
        if (stage.create) stages.create = stages.create || stage.create;
        if (stage.query) stages.query = stages.query || stage.query;
      }
      if (stage.statusMapping) stages.statusMapping = { ...(stages.statusMapping || {}), ...stage.statusMapping };
    }
    const baseName = name.replace(/\s*\((create|query)\)\s*$/i, "").trim() || taskKind;
    const id = String(item.id || "").trim() || `mapping-${crypto.randomUUID()}`;
    const createdAt = String(item.createdAt || nowIso());
    if (!existing) {
      if (!stages.create && !stages.query) continue; // unsalvageable
      grouped.set(key, {
        id,
        vendorKey,
        taskKind,
        name: baseName,
        enabled: normalizeEnabled(item.enabled, true),
        create: stages.create || (stages.query as HttpOperation), // create is required; fall back if only query was salvageable
        ...(stages.query ? { query: stages.query } : {}),
        ...(stages.statusMapping ? { statusMapping: stages.statusMapping } : {}),
        createdAt,
        updatedAt: nowIso(),
      });
    } else {
      // Merge: keep first row's create, fill in query from any later row.
      if (!existing.query && stages.query) existing.query = stages.query;
      if (!existing.query && stages.create && isQueryRow) existing.query = stages.create;
      if (stages.statusMapping) existing.statusMapping = { ...(existing.statusMapping || {}), ...stages.statusMapping };
      existing.updatedAt = nowIso();
    }
  }
  return Array.from(grouped.values());
}

/**
 * In-place forward migration. Unknown future versions fall back to defaults.
 * Always returns a state at CURRENT_CATALOG_VERSION.
 */
function migrateCatalogForward(state: CatalogState): CatalogState {
  let s = state;

  if (!s.version || (s.version as number) < 1) {
    // Garbled state — fall back to defaults rather than risk corruption.
    return defaultCatalog();
  }

  if (s.version === 1) {
    // v1 → v2: tag every existing API key as plaintext so M5.2 knows what to upgrade.
    const apiKeysByVendor: Record<string, ApiKeyRecord> = {};
    for (const [k, rec] of Object.entries(s.apiKeysByVendor || {})) {
      apiKeysByVendor[k] = { ...rec, enc: rec.enc || "plain" };
    }
    s = { ...s, version: 2, apiKeysByVendor };
    writeCatalog(s);
  }

  if (s.version === 2) {
    // v2 → v3: collapse legacy {requestMapping,responseMapping} into flat
    // {create,query}. Handles three legacy shapes — bare op, v2 envelope, and
    // split create/query rows — and dedupes by (vendorKey, taskKind).
    s = { ...s, version: 3, mappings: normalizeLegacyMappings(s.mappings) };
    writeCatalog(s);
  }

  if ((s.version as number) > CURRENT_CATALOG_VERSION) {
    // Newer file than this app understands — keep going read-only, but don't downgrade.
    console.warn(`[catalog] file version ${s.version} > app version ${CURRENT_CATALOG_VERSION}; reading as-is`);
  }

  // Lazy upgrade: any plaintext keys get re-encrypted on first read once safeStorage is up.
  // This handles both legacy v1 keys post-migration and import-from-export scenarios.
  if (isSafeStorageAvailable()) {
    let dirty = false;
    const upgraded: Record<string, ApiKeyRecord> = {};
    for (const [k, rec] of Object.entries(s.apiKeysByVendor || {})) {
      if (rec.enc !== "safeStorage" && rec.apiKey) {
        upgraded[k] = makeApiKeyRecordFromPlain(rec.apiKey, rec.vendorKey, rec.enabled, rec.createdAt, rec.updatedAt);
        dirty = true;
      } else {
        upgraded[k] = rec;
      }
    }
    if (dirty) {
      s = { ...s, apiKeysByVendor: upgraded };
      writeCatalog(s);
    }
  }

  return s;
}

function writeCatalog(state: CatalogState): CatalogState {
  writeJsonFileAtomic(catalogPath(), state);
  return state;
}

function normalizeEnabled(value: unknown, fallback = true): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeProviderKind(value: unknown, fallback: AiSdkProviderKind = "openai-compatible"): AiSdkProviderKind {
  return value === "anthropic" || value === "openai-compatible" || value === "openai-responses" ? value : fallback;
}

function filterByParams<T extends { vendorKey?: string; kind?: BillingModelKind; enabled?: boolean; taskKind?: ProfileKind }>(
  items: T[],
  params: unknown,
): T[] {
  if (!params || typeof params !== "object") return items;
  const raw = params as JsonRecord;
  return items.filter((item) => {
    if (typeof raw.vendorKey === "string" && item.vendorKey !== raw.vendorKey) return false;
    if (typeof raw.kind === "string" && item.kind !== raw.kind) return false;
    if (typeof raw.taskKind === "string" && item.taskKind !== raw.taskKind) return false;
    if (typeof raw.enabled === "boolean" && item.enabled !== raw.enabled) return false;
    return true;
  });
}

export function listModelCatalogVendors(): Vendor[] {
  return readCatalog().vendors;
}

export function listModelCatalogModels(params?: unknown): Model[] {
  return filterByParams(readCatalog().models, params);
}

export function listModelCatalogMappings(params?: unknown): Mapping[] {
  return filterByParams(readCatalog().mappings, params);
}

/**
 * Resolve the onboarding doc-reader LLM from a configured **text** model in the
 * catalog — i.e. the model the user already added (e.g. dm-fox GPT-5.5). This is
 * the product source of truth: it works identically in dev and a packaged app,
 * with no env vars / no `.secrets`. The key is decrypted here in main and never
 * leaves the process. Returns null when no usable text model is configured (the
 * caller then surfaces a "add a text model first" message). Bearer/none-auth
 * vendors only — query/x-api-key auth isn't a chat-completions shape.
 */
export function resolveOnboardingAgentFromCatalog():
  | {
      providerKind: AiSdkProviderKind;
      baseUrl: string;
      modelId: string;
      apiKey: string;
      extraHeaders?: Record<string, string>;
    }
  | null {
  const state = readCatalog();
  for (const model of state.models) {
    if (model.kind !== "text" || !model.enabled) continue;
    const vendor = state.vendors.find((v) => v.key === model.vendorKey && v.enabled);
    if (!vendor || !vendor.baseUrlHint) continue;
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    if (!apiKey) continue;
    const extraHeaders = extractVendorExtraHeaders(vendor);
    return {
      providerKind: normalizeProviderKind(vendor.providerKind),
      baseUrl: vendor.baseUrlHint,
      modelId: model.modelKey,
      apiKey,
      ...(extraHeaders ? { extraHeaders } : {}),
    };
  }
  return null;
}

export function getModelCatalogHealth(): unknown {
  const state = readCatalog();
  const enabledVendors = state.vendors.filter((vendor) => vendor.enabled);
  const enabledModels = state.models.filter((model) => model.enabled);
  const enabledApiKeys = Object.values(state.apiKeysByVendor).filter((key) => key.enabled && key.apiKey).length;
  const executableModels = enabledModels.filter((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    return Boolean(vendor?.enabled && (vendor.authType === "none" || (apiKey?.enabled && apiKey.apiKey)));
  });
  const byKind = (["text", "image", "video", "audio"] as BillingModelKind[]).map((kind) => ({
    kind,
    enabledModels: enabledModels.filter((model) => model.kind === kind).length,
    executableModels: executableModels.filter((model) => model.kind === kind).length,
  }));
  const issues = [];
  if (state.vendors.length === 0 || state.models.length === 0) {
    issues.push({ code: "catalog_empty", severity: "error", message: "Local model catalog is empty" });
  }
  for (const model of enabledModels) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    const apiKey = state.apiKeysByVendor[model.vendorKey];
    if (!vendor?.enabled) {
      issues.push({ code: "vendor_disabled", severity: "error", message: `Vendor disabled: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    } else if (vendor.authType !== "none" && !apiKey?.apiKey) {
      issues.push({ code: "vendor_api_key_missing", severity: "error", message: `API key missing: ${model.vendorKey}`, vendorKey: model.vendorKey, modelKey: model.modelKey, kind: model.kind });
    }
  }
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    counts: {
      vendors: state.vendors.length,
      enabledVendors: enabledVendors.length,
      models: state.models.length,
      enabledModels: enabledModels.length,
      mappings: state.mappings.length,
      enabledMappings: state.mappings.filter((mapping) => mapping.enabled).length,
      enabledApiKeys,
    },
    byKind,
    issues,
  };
}

export function upsertModelCatalogVendor(payload: unknown): Vendor {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const key = sanitizeName(raw.key, "").toLowerCase().replace(/\s+/g, "-");
  if (!key) throw new Error("vendor key is required");
  const existing = state.vendors.find((vendor) => vendor.key === key);
  const t = nowIso();
  const vendor: Vendor = {
    key,
    name: String(raw.name || existing?.name || key).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    hasApiKey: existing?.hasApiKey ?? false,
    baseUrlHint: typeof raw.baseUrlHint === "string" ? raw.baseUrlHint.trim() || null : existing?.baseUrlHint ?? null,
    authType: (raw.authType as Vendor["authType"]) || existing?.authType || "bearer",
    authHeader: typeof raw.authHeader === "string" ? raw.authHeader.trim() || null : existing?.authHeader ?? null,
    authQueryParam: typeof raw.authQueryParam === "string" ? raw.authQueryParam.trim() || null : existing?.authQueryParam ?? null,
    providerKind: normalizeProviderKind(raw.providerKind, existing?.providerKind ?? "openai-compatible"),
    meta: raw.meta ?? existing?.meta,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.vendors = [vendor, ...state.vendors.filter((item) => item.key !== key)];
  writeCatalog(state);
  return { ...vendor, hasApiKey: Boolean(state.apiKeysByVendor[key]?.apiKey) };
}

export function deleteModelCatalogVendor(key: string): void {
  const state = readCatalog();
  state.vendors = state.vendors.filter((vendor) => vendor.key !== key);
  state.models = state.models.filter((model) => model.vendorKey !== key);
  state.mappings = state.mappings.filter((mapping) => mapping.vendorKey !== key);
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
}

export function upsertModelCatalogVendorApiKey(vendorKey: string, payload: unknown): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const apiKey = String((payload as JsonRecord)?.apiKey || "").trim();
  if (!key) throw new Error("vendor key is required");
  if (!apiKey) throw new Error("api key is required");
  const t = nowIso();
  const existing = state.apiKeysByVendor[key];
  state.apiKeysByVendor[key] = makeApiKeyRecordFromPlain(
    apiKey,
    key,
    normalizeEnabled((payload as JsonRecord)?.enabled, true),
    existing?.createdAt || t,
    t,
  );
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: true, enabled: state.apiKeysByVendor[key].enabled, createdAt: state.apiKeysByVendor[key].createdAt, updatedAt: t };
}

export function clearModelCatalogVendorApiKey(vendorKey: string): unknown {
  const state = readCatalog();
  const key = String(vendorKey || "").trim();
  const t = nowIso();
  delete state.apiKeysByVendor[key];
  writeCatalog(state);
  return { vendorKey: key, hasApiKey: false, enabled: false, createdAt: t, updatedAt: t };
}

/**
 * Commit a successful onboarding trial into the local catalog as a real entry:
 * vendor + encrypted apiKey + model (with evidence) + create/query mappings.
 *
 * Designed to be called from the renderer once a TrialOutcome arrives with
 * status === "success". Returns the persisted Model so the caller can light up
 * the success UI.
 */
export function commitOnboardedModelToCatalog(payload: {
  outcome: unknown;
  userApiKey: string;
  /** Optional display label override; otherwise we use draft.modelDisplayName. */
  displayLabel?: string;
  /** How this model was added. Defaults to "agent" (the doc-reader path). The
   *  manual BaseURL entry passes "manual" so the catalog records provenance honestly. */
  addedVia?: "agent" | "manual";
}): Model {
  const outcome = payload?.outcome as JsonRecord | null;
  if (!outcome || typeof outcome !== "object") throw new Error("outcome required");
  const draft = (outcome as JsonRecord).draft as JsonRecord | null;
  if (!draft) throw new Error("outcome.draft missing");

  const vendorKey = String(draft.vendorKey || "").trim();
  const vendorName = String(draft.vendorName || vendorKey).trim();
  const vendorBaseUrl = String(draft.vendorBaseUrl || "").trim();
  const modelKey = String(draft.modelKey || "").trim();
  const modelDisplayName = String(payload.displayLabel || draft.modelDisplayName || modelKey).trim();
  const targetKind = String(draft.targetKind || "").trim();
  const userApiKey = String(payload.userApiKey || "").trim();

  if (!vendorKey || !vendorBaseUrl || !modelKey) {
    throw new Error("incomplete draft: vendorKey + vendorBaseUrl + modelKey are required");
  }
  if (!userApiKey) throw new Error("userApiKey required to commit a model");

  let billingKind: BillingModelKind;
  let taskKind: ProfileKind;
  if (targetKind === "text") { billingKind = "text"; taskKind = "chat"; }
  else if (targetKind === "image") { billingKind = "image"; taskKind = "text_to_image"; }
  else if (targetKind === "video") { billingKind = "video"; taskKind = "text_to_video"; }
  else if (targetKind === "audio") { billingKind = "audio"; taskKind = "text_to_audio"; }
  else throw new Error(`Unsupported model kind '${targetKind}'`);

  const auth = (draft.vendorAuth || {}) as JsonRecord;
  const authType = (auth.type as Vendor["authType"]) || "bearer";

  // 1. vendor — carry draft.vendorMeta through so the manual-entry form's custom
  // request headers (vendorMeta.extraHeaders) persist and reach buildAiSdkModel.
  upsertModelCatalogVendor({
    key: vendorKey,
    name: vendorName,
    baseUrlHint: vendorBaseUrl,
    authType,
    authHeader: auth.headerName || null,
    authQueryParam: auth.queryParam || null,
    providerKind: draft.vendorProviderKind || "openai-compatible",
    enabled: true,
    ...(draft.vendorMeta !== undefined ? { meta: draft.vendorMeta } : {}),
  });

  // 2. apiKey (auto-encrypted by upsert)
  upsertModelCatalogVendorApiKey(vendorKey, { apiKey: userApiKey, enabled: true });

  // 3. model + onboarding evidence snapshot
  type OnboardingField = NonNullable<Model["onboarding"]>["fields"][number];
  const onboardingFields: OnboardingField[] = Array.isArray(draft.modelFields)
    ? (draft.modelFields as JsonRecord[]).map((f) => ({
        key: String(f.key),
        displayName: String(f.displayName),
        type: f.type as OnboardingField["type"],
        ...(f.options ? { options: f.options as OnboardingField["options"] } : {}),
        ...(f.default !== undefined ? { default: String(f.default) } : {}),
        evidence: f.evidence as OnboardingField["evidence"],
      }))
    : [];

  // Project the agent-detected fields into model.meta.parameters so the node UI
  // can render them. The UI reads parameters/upload-slots exclusively from
  // model.meta (parseModelParameterControls); onboarding.fields is only an
  // evidence snapshot. Without this projection the model lands in the catalog
  // but shows zero parameters and no image-url upload slots on the node.
  // The shape parseParameterControl expects: { key, label, type, options, default }.
  const metaParameters = onboardingFields.map((f) => ({
    key: f.key,
    label: f.displayName || f.key,
    type: f.type,
    ...(f.options ? { options: f.options } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
  }));

  const model = upsertModelCatalogModel({
    modelKey,
    vendorKey,
    modelAlias: modelKey,
    labelZh: modelDisplayName,
    kind: billingKind,
    enabled: true,
    meta: { parameters: metaParameters },
    onboarding: {
      addedVia: payload.addedVia ?? "agent",
      trialId: String(outcome.trialId || ""),
      docsUrl: String(outcome.docsUrl || ""),
      addedAt: nowIso(),
      fields: onboardingFields,
    },
  });

  // 4. mapping: one row per (vendor, taskKind), carrying both stages.
  const mappingCreate = draft.mappingCreate as HttpOperation | undefined;
  const mappingQuery = draft.mappingQuery as HttpOperation | undefined;
  if (mappingCreate) {
    // Reconcile: the agent only templatizes params it saw in the curl example,
    // so spec-derived params (resolution, duration, ...) the user can now select
    // on the node have no {{request.params.*}} slot in the body and would send
    // nothing. Inject the missing field keys at the param nesting level.
    const reconciledCreate: HttpOperation =
      mappingCreate.body !== undefined && onboardingFields.length > 0
        ? { ...mappingCreate, body: mergeMissingParamsIntoBody(mappingCreate.body, onboardingFields.map((f) => f.key)) }
        : mappingCreate;
    upsertModelCatalogMapping({
      vendorKey,
      taskKind,
      name: modelDisplayName,
      enabled: true,
      create: reconciledCreate,
      ...(mappingQuery ? { query: mappingQuery } : {}),
    });
  }

  return model;
}

/**
 * Derive a stable vendorKey from a BaseURL host. Same host → same vendor (so
 * re-adding models under the same endpoint merges, per upsert semantics).
 * localhost/127.0.0.1 include the port so Ollama(11434) and ComfyUI(8188) don't
 * collide as one "localhost" vendor.
 */
export function deriveVendorKeyFromBaseUrl(baseUrl: string): string {
  let host = "";
  let port = "";
  try {
    const u = new URL(baseUrl);
    host = u.hostname;
    port = u.port;
  } catch {
    return "";
  }
  let seed = host;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    seed = `local-${port || "80"}`;
  }
  return seed.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * Manual provider entry — the PRIMARY model-adding path (BaseURL + key + models).
 * Deterministic: for a standard OpenAI-compatible text endpoint the whole catalog
 * shape is known, so no doc-reading AI is needed (that breaks the bootstrap
 * deadlock where the doc-reader itself required a pre-existing text model).
 *
 * Reuses the SINGLE write path (commitOnboardedModelToCatalog) — N models = one
 * vendor + N model upserts. Text/chat models run via the direct AI SDK path
 * (buildAiSdkModel → createOpenAICompatible), so we deliberately emit NO HTTP
 * mapping here: a fabricated /chat/completions mapping would be unused dead data.
 *
 * No connectivity test in this flow (aligns with opencode): local/custom
 * endpoints vary in tolerance; storing-then-failing-at-call-time is honest and
 * doesn't block legitimate models. A separate, non-blocking test exists.
 */
export function commitManualOpenAiCompatibleModels(payload: {
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{ id: string; displayName?: string }>;
  /** Endpoint shape. Defaults to "openai-compatible" (the common case). "anthropic"
   *  routes text/chat through the Messages API (createAnthropic, x-api-key). */
  providerKind?: AiSdkProviderKind;
  /** Extra request headers for relay/proxy gateways, persisted on the vendor and
   *  replayed on every model call via buildAiSdkModel. */
  headers?: Record<string, string>;
}): { vendorKey: string; committed: Array<{ modelKey: string; displayName: string }> } {
  const rawBaseUrl = String(payload?.baseUrl || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  const providerKind = normalizeProviderKind(payload?.providerKind);
  // Anthropic offers a hosted default; an OpenAI-compatible endpoint must be told.
  // For anthropic with a blank field we fill in the canonical host so the vendor
  // always has a concrete baseUrlHint (the doc-reader + commit path require one).
  const baseUrl =
    providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("接入地址需以 http:// 或 https:// 开头");
  if (!apiKey) throw new Error("API Key 不能为空");

  const vendorKey = deriveVendorKeyFromBaseUrl(baseUrl);
  if (!vendorKey) throw new Error("无法从接入地址解析出供应商标识");

  const vendorName = String(payload?.vendorName || "").trim() || vendorKey;

  // Clean custom headers: trim, drop blanks. Stored on vendor.meta.extraHeaders.
  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload?.headers || {})) {
    const key = String(k || "").trim();
    const value = String(v ?? "").trim();
    if (key && value) cleanHeaders[key] = value;
  }
  const vendorMeta =
    Object.keys(cleanHeaders).length > 0 ? { extraHeaders: cleanHeaders } : undefined;

  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set<string>();
  const cleanModels = rawModels
    .map((m) => ({ id: String(m?.id || "").trim(), displayName: String(m?.displayName || "").trim() }))
    .filter((m) => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  if (cleanModels.length === 0) throw new Error("至少填写一个模型 id");

  const committed: Array<{ modelKey: string; displayName: string }> = [];
  for (const m of cleanModels) {
    const displayName = m.displayName || m.id;
    const outcome = {
      status: "success",
      trialId: "",
      docsUrl: "",
      draft: {
        vendorKey,
        vendorName,
        vendorBaseUrl: baseUrl,
        vendorAuth: { type: providerKind === "anthropic" ? ("x-api-key" as const) : ("bearer" as const) },
        vendorProviderKind: providerKind,
        ...(vendorMeta ? { vendorMeta } : {}),
        modelKey: m.id,
        modelDisplayName: displayName,
        targetKind: "text" as const,
        modelFields: [],
      },
    };
    commitOnboardedModelToCatalog({ outcome, userApiKey: apiKey, addedVia: "manual" });
    committed.push({ modelKey: m.id, displayName });
  }

  return { vendorKey, committed };
}

export function upsertModelCatalogModel(payload: unknown): Model {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const modelKey = String(raw.modelKey || "").trim();
  const vendorKey = String(raw.vendorKey || "").trim();
  if (!modelKey || !vendorKey) throw new Error("modelKey and vendorKey are required");
  const existing = state.models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
  const t = nowIso();
  const model: Model = {
    modelKey,
    vendorKey,
    modelAlias: typeof raw.modelAlias === "string" ? raw.modelAlias.trim() || null : existing?.modelAlias ?? null,
    labelZh: String(raw.labelZh || existing?.labelZh || modelKey).trim(),
    kind: (raw.kind as BillingModelKind) || existing?.kind || "text",
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    meta: raw.meta ?? existing?.meta,
    pricing: raw.pricing as Model["pricing"] || existing?.pricing,
    onboarding: (raw.onboarding as Model["onboarding"]) ?? existing?.onboarding,
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.models = [model, ...state.models.filter((item) => !(item.vendorKey === vendorKey && item.modelKey === modelKey))];
  writeCatalog(state);
  return model;
}

export function deleteModelCatalogModel(vendorKey: string, modelKey: string): void {
  const state = readCatalog();
  state.models = state.models.filter((model) => !(model.vendorKey === vendorKey && model.modelKey === modelKey));
  writeCatalog(state);
}

export function upsertModelCatalogMapping(payload: unknown): Mapping {
  const state = readCatalog();
  const raw = payload as JsonRecord;
  const vendorKey = String(raw.vendorKey || "").trim();
  const taskKind = (raw.taskKind as ProfileKind) || "chat";
  if (!vendorKey) throw new Error("vendorKey is required");
  // One mapping per (vendor, taskKind). If id is supplied and matches, update
  // that row; otherwise locate by (vendor, taskKind) so callers can upsert
  // without tracking ids.
  const existing = state.mappings.find((m) =>
    raw.id ? m.id === raw.id : m.vendorKey === vendorKey && m.taskKind === taskKind,
  );
  const id = String(raw.id || existing?.id || `mapping-${crypto.randomUUID()}`);
  const t = nowIso();
  // Accept new shape (create/query) directly, or legacy {requestMapping,...}
  // (e.g. via the unchanged import path) and normalize on the way in.
  const legacy = extractLegacyStages(raw.requestMapping ?? raw.requestProfile);
  const legacyResp = extractLegacyStages(raw.responseMapping);
  const create = (raw.create as HttpOperation | undefined) || legacy.create || legacyResp.create || existing?.create;
  const query = (raw.query as HttpOperation | undefined) || legacy.query || legacyResp.query || existing?.query;
  if (!create) throw new Error("create operation is required (method + path)");
  const mapping: Mapping = {
    id,
    vendorKey,
    taskKind,
    name: String(raw.name || existing?.name || taskKind).trim(),
    enabled: normalizeEnabled(raw.enabled, existing?.enabled ?? true),
    create,
    ...(query ? { query } : {}),
    ...(raw.statusMapping || legacy.statusMapping || existing?.statusMapping
      ? { statusMapping: (raw.statusMapping as Record<string, string[]>) || legacy.statusMapping || existing?.statusMapping }
      : {}),
    createdAt: existing?.createdAt || t,
    updatedAt: t,
  };
  state.mappings = [mapping, ...state.mappings.filter((item) => item.id !== id)];
  writeCatalog(state);
  return mapping;
}

export function deleteModelCatalogMapping(id: string): void {
  const state = readCatalog();
  state.mappings = state.mappings.filter((mapping) => mapping.id !== id);
  writeCatalog(state);
}

export function exportModelCatalogPackage(params?: unknown): unknown {
  const state = readCatalog();
  const includeApiKeys = Boolean((params as JsonRecord | undefined)?.includeApiKeys);
  return {
    version: "desktop-local-v1",
    exportedAt: nowIso(),
    vendors: state.vendors.map((vendor) => ({
      vendor,
      // Export carries plaintext keys for portability; re-import will re-encrypt on the target machine.
      ...(includeApiKeys && state.apiKeysByVendor[vendor.key]?.apiKey
        ? { apiKey: { apiKey: decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]), enabled: state.apiKeysByVendor[vendor.key].enabled } }
        : {}),
      models: state.models.filter((model) => model.vendorKey === vendor.key),
      mappings: state.mappings.filter((mapping) => mapping.vendorKey === vendor.key),
    })),
  };
}

export function importModelCatalogPackage(payload: unknown): unknown {
  const state = readCatalog();
  const raw = payload as { vendors?: Array<{ vendor?: unknown; apiKey?: unknown; models?: unknown[]; mappings?: unknown[] }> };
  let vendors = 0;
  let models = 0;
  let mappings = 0;
  const errors: string[] = [];
  for (const bundle of raw.vendors || []) {
    try {
      const vendor = upsertModelCatalogVendor(bundle.vendor);
      vendors += 1;
      const apiKey = bundle.apiKey as JsonRecord | undefined;
      if (apiKey?.apiKey) upsertModelCatalogVendorApiKey(vendor.key, apiKey);
      for (const model of bundle.models || []) {
        upsertModelCatalogModel({ ...(model as JsonRecord), vendorKey: (model as JsonRecord).vendorKey || vendor.key });
        models += 1;
      }
      for (const mapping of bundle.mappings || []) {
        upsertModelCatalogMapping({ ...(mapping as JsonRecord), vendorKey: (mapping as JsonRecord).vendorKey || vendor.key });
        mappings += 1;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  writeCatalog(readCatalog() || state);
  return { imported: { vendors, models, mappings }, errors };
}

export async function fetchModelCatalogDocs(payload: unknown): Promise<unknown> {
  const targetUrl = String((payload as JsonRecord)?.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error("http/https url is required");
  // v0.7.6: hardenedFetch — 拦私网 + 超时 + 限制大小
  const fetched = await hardenedFetchText(targetUrl, {
    timeoutMs: 15_000,
    maxBytes: 5 * 1024 * 1024, // 文档抓取 5MB 上限够用
  });
  const html = fetched.text;
  const contentType = fetched.contentType;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const max = 120000;
  return {
    url: targetUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType,
    title,
    text: text.slice(0, max),
    truncated: text.length > max,
    diagnostics: [],
  };
}

export async function testModelCatalogMapping(id: string, payload: unknown): Promise<unknown> {
  const mapping = readCatalog().mappings.find((item) => item.id === id);
  const raw = payload as JsonRecord | undefined;
  if (!mapping) {
    return {
      mappingId: id,
      vendorKey: "",
      taskKind: "chat",
      stage: raw?.stage || "create",
      executed: false,
      ok: false,
      diagnostics: ["Mapping not found."],
      request: null,
    };
  }
  const stage = raw?.stage === "result" || raw?.stage === "query" ? "query" : "create";
  const operation: HttpOperation | undefined = stage === "create" ? mapping.create : mapping.query;
  if (!operation) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: false,
      diagnostics: [`Mapping has no ${stage} stage.`],
      request: null,
    };
  }
  const wantedKind = billingKindForTaskKind(mapping.taskKind);
  const { vendor, model, apiKey } = findExecutableModelForTask(mapping.vendorKey, trim(raw?.modelKey), wantedKind);
  const request: TaskRequest = {
    kind: mapping.taskKind,
    prompt: firstString(raw?.prompt, "Nomi mapping smoke test"),
    extras: {
      ...(isJsonRecord(raw?.extras) ? raw?.extras : {}),
      modelKey: model.modelKey,
      modelAlias: model.modelAlias || model.modelKey,
    },
  };
  const providerMeta = {
    query_id: firstString(raw?.taskId),
    task_id: firstString(raw?.taskId),
  };
  const preview = buildProfileHttpRequest({ vendor, model, apiKey, request, operation, providerMeta }).preview;
  const upstreamResponse = raw && Object.prototype.hasOwnProperty.call(raw, "upstreamResponse") ? raw.upstreamResponse : undefined;
  if (typeof upstreamResponse !== "undefined") {
    const normalized = await buildProfileTaskResult({
      response: upstreamResponse,
      mapping,
      operation,
      request,
      taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
      wantedKind,
    });
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: normalized.result.status !== "failed",
      diagnostics: ["Mapped the provided upstream response without sending a request."],
      request: preview,
      response: normalized.result,
    };
  }
  if (!raw?.execute) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: true,
      diagnostics: ["Rendered local desktop mapping without sending a request."],
      request: preview,
    };
  }
  const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation, providerMeta });
  const normalized = await buildProfileTaskResult({
    response: executed.response,
    mapping,
    operation,
    request,
    taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
    wantedKind,
  });
  return {
    mappingId: id,
    vendorKey: mapping.vendorKey,
    taskKind: mapping.taskKind,
    stage,
    executed: true,
    ok: normalized.result.status !== "failed",
    diagnostics: ["Executed mapping through the desktop runtime."],
    request: executed.request,
    response: normalized.result,
  };
}

function collectFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}


function uniqueAssetPath(projectId: string, fileName: string, bucket: "generated" | "imported" = "generated"): { absolutePath: string; relativePath: string } {
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", bucket, today);
  ensureDir(assetDir);
  const parsed = path.parse(sanitizeName(fileName, "asset.bin"));
  const base = parsed.name || "asset";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(projectDir, absolutePath).replace(/\\/g, "/"),
  };
}

function writeAsset(projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord): unknown {
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, fileName, assetBucketFromMeta(meta));
  fs.writeFileSync(absolutePath, bytes);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: `asset-${crypto.randomUUID()}`,
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType,
      size: bytes.byteLength,
    },
  };
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  const bytes = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  return { bytes, contentType };
}

export async function importRemoteAsset(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  if (url.startsWith("nomi-local://")) {
    return { id: `asset-${crypto.randomUUID()}`, name: String(raw.fileName || "local asset"), userId: "local", projectId, createdAt: nowIso(), updatedAt: nowIso(), data: { url, kind: raw.kind || "local" } };
  }
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "bin");
    return writeAsset(projectId, parsed.bytes, String(raw.fileName || `asset-${Date.now()}.${ext}`), parsed.contentType, { kind: raw.kind || "generated", originalUrl: null });
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  // v0.7.6: hardenedFetch — 资产下载需要更大上限（视频/图片），但仍拦私网 + 超时
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000,
    maxBytes: 200 * 1024 * 1024, // 200MB 资产上限
    allowContentTypes: ["image/", "video/", "audio/", "application/octet-stream"],
  });
  const contentType = fetched.contentType || "application/octet-stream";
  const bytes = fetched.bytes;
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = String(raw.fileName || path.basename(new URL(url).pathname) || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
  });
}

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

export async function importLocalFile(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const bytes = bytesFromPayload(raw.bytes);
  const contentType = String(raw.contentType || "application/octet-stream");
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || null,
  });
}

export function listProjectAssets(payload: unknown): { items: LocalAssetRecord[]; cursor: string | null } {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) return { items: [], cursor: null };
  const assetsDir = path.join(projectDir, "assets");
  const requestedLimit = typeof raw?.limit === "number" && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : 200;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const offset = Math.max(0, Number.parseInt(String(raw?.cursor || "0"), 10) || 0);
  const kindFilter = typeof raw?.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "";
  const records = collectFilesRecursively(assetsDir).flatMap((absolutePath): LocalAssetRecord[] => {
    try {
      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, "/");
      const contentType = contentTypeFromPath(absolutePath);
      const kind = assetKindFromContentType(contentType);
      if (kindFilter && kind !== kindFilter) return [];
      const createdAt = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
      const updatedAt = new Date(stat.mtimeMs).toISOString();
      return [{
        id: stableAssetId(projectId, relativePath),
        name: path.basename(absolutePath),
        userId: "local",
        projectId,
        createdAt,
        updatedAt,
        data: {
          url: localAssetUrl(projectId, relativePath),
          relativePath,
          absolutePath,
          contentType,
          size: stat.size,
          kind,
        },
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const items = records.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    cursor: nextOffset < records.length ? String(nextOffset) : null,
  };
}


function findExecutableModel(vendorKey: string, modelKey: string, kind?: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && (!kind || item.kind === kind) && (item.modelKey === modelKey || item.modelAlias === modelKey));
  if (!model) throw new Error(`Model is not enabled: ${modelKey}`);
  const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendorKey]);
  if (vendor.authType !== "none" && !apiKey) throw new Error(`API key missing: ${vendorKey}`);
  return { vendor, model, apiKey };
}

function findExecutableModelForTask(vendorKey: string, modelKey: string, kind: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}

// Thin Vendor→primitive adapters over the shared requestPipeline auth logic
// (the shared module is electron-free and doesn't know the Vendor shape).
function authHeaders(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthHeaders(vendor.authType as AuthType, apiKey, vendor.authHeader ?? undefined);
}

function authQueryParams(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthQueryParams(vendor.authType as AuthType, apiKey, vendor.authQueryParam ?? undefined);
}

// endpoint() 已抽到 electron/vendorEndpoint.ts（纯函数，便于无 electron 的单测）


function billingKindForTaskKind(kind: ProfileKind): BillingModelKind {
  if (kind === "text_to_video" || kind === "image_to_video") return "video";
  if (kind === "chat" || kind === "prompt_refine" || kind === "image_to_prompt") return "text";
  return "image";
}

function extractAssetUrl(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as JsonRecord;
  const candidates = [
    record.url,
    record.video_url,
    record.image_url,
    record.output,
    (record.data as JsonRecord[] | undefined)?.[0]?.url,
    (record.data as JsonRecord[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(record.data as JsonRecord[])[0].b64_json}` : "",
    (record.images as JsonRecord[] | undefined)?.[0]?.url,
    (record.videos as JsonRecord[] | undefined)?.[0]?.url,
    (record.result as JsonRecord | undefined)?.url,
    (record.result as JsonRecord | undefined)?.video_url,
    (record.result as JsonRecord | undefined)?.image_url,
  ];
  return firstString(...candidates);
}

async function postJson(url: string, apiKey: string, vendor: Vendor, body: unknown): Promise<unknown> {
  const response = await fetch(appendQueryParams(url, authQueryParams(vendor, apiKey)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(vendor, apiKey),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(firstString((json as JsonRecord | null)?.message, (json as JsonRecord | null)?.error, `Provider request failed: ${response.status}`));
  return json;
}

async function localizeTaskAsset(projectId: string, assetUrl: string, type: "image" | "video", nodeId?: string): Promise<TaskResult["assets"][number]> {
  const imported = await importRemoteAsset({
    projectId,
    url: assetUrl,
    kind: "generated",
    ownerNodeId: nodeId || null,
    fileName: `${type}-${Date.now()}.${type === "image" ? "png" : "mp4"}`,
  }) as { id?: string; name?: string; data?: { url?: string } };
  return {
    type,
    url: String(imported.data?.url || assetUrl),
    thumbnailUrl: type === "image" ? String(imported.data?.url || assetUrl) : null,
    assetId: imported.id || null,
    assetName: imported.name || null,
  };
}


function findTaskMapping(vendorKey: string, taskKind: ProfileKind, modelKey?: string): Mapping | null {
  // 按 (vendor, taskKind, modelKey) 选——同 vendor 下两个模型共用一个 taskKind 但请求形状不同时
  // （如 HappyHorse 与 Kling 都 text_to_video），靠 modelKey 精确路由，不再「第一个赢、另一个套错模板」。
  return selectTaskMapping(readCatalog().mappings, vendorKey, taskKind, modelKey);
}

// firstReferenceImage / taskTemplateParams 已抽到 electron/catalog/taskParams.ts（可测，见顶部 import）。

// Adapter over the shared requestPipeline context builder. Production maps the
// rich TaskRequest fields into normalized params via `taskTemplateParams`; the
// canonical context shape (model/account/user_api_key/providerMeta) lives in the
// shared module so the wizard test and production build identical contexts.
function templateContext(request: TaskRequest, model: Model, apiKey: string, providerMeta: JsonRecord = {}): JsonRecord {
  return buildTemplateContext({
    request: request as unknown as JsonRecord,
    params: taskTemplateParams(request),
    model: model as unknown as JsonRecord,
    modelKey: model.modelAlias || model.modelKey,
    apiKey,
    providerMeta,
  });
}

async function requestJson(
  vendor: Vendor,
  apiKey: string,
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body: unknown,
): Promise<unknown> {
  const finalUrl = appendQueryParams(url, { ...authQueryParams(vendor, apiKey), ...query });
  const upperMethod = method.toUpperCase();
  const hasBody = upperMethod !== "GET" && upperMethod !== "HEAD" && body != null;
  const response = await fetch(finalUrl, {
    method: upperMethod,
    headers,
    ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const record = isJsonRecord(json) ? json : {};
  // Many providers (kie.ai and other Java/Spring backends) return HTTP 200 with
  // a logical-error envelope `{ code: 4xx/5xx, msg/message: "..." }` instead of
  // a real error status. Treat that as a failure too, otherwise we'd hand a
  // body with no asset URL to the result builder and report a silent dud.
  const logicalCode = looksLikeLogicalError(record);
  if (!response.ok || logicalCode != null) {
    const upstreamMsg = firstString(
      record.msg,
      record.message,
      record.error,
      readNestedRecord(record, ["error", "message"]),
      readNestedRecord(record, ["data", "msg"]),
    );
    const statusLabel = logicalCode != null ? `code ${logicalCode}` : `HTTP ${response.status}`;
    // "No message available" is Spring's default placeholder — surface the URL
    // and status so the failure is diagnosable instead of opaque.
    const detail = upstreamMsg && upstreamMsg !== "No message available" ? upstreamMsg : `(no detail from provider)`;
    throw new Error(`Provider request failed (${statusLabel}) at ${vendor.key} ${upperMethod} ${url}: ${detail}`);
  }
  return json;
}

function buildProfileHttpRequest(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): { method: string; url: string; headers: Record<string, string>; query: Record<string, unknown>; body: unknown; preview: unknown } {
  // Single source of truth: the shared requestPipeline builds the exact request
  // the wizard test also builds, so "passed test" == "works in prod".
  return buildHttpRequest({
    baseUrl: String(input.vendor.baseUrlHint || ""),
    authType: input.vendor.authType as AuthType,
    authHeaderName: input.vendor.authHeader ?? undefined,
    apiKey: input.apiKey,
    context: templateContext(input.request, input.model, input.apiKey, input.providerMeta || {}),
    operation: input.operation,
  });
}

async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): Promise<{ response: unknown; request: unknown }> {
  // R1：发送前把 request 里的本地素材(nomi-local://)按当前 vendor 声明的策略变成可达值
  // (上传换公网 URL / 内联 base64)。通用层与供应商无关;无本地素材时零开销原样通过。
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    resolveAssetIngestion(input.vendor),
    input.apiKey,
    readNomiLocalAsset,
    postJsonForAssetUpload,
  );
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  const built = buildProfileHttpRequest(effectiveInput);
  const response = await requestJson(effectiveInput.vendor, effectiveInput.apiKey, built.method, built.url, built.headers, built.query, built.body);
  return {
    response,
    request: built.preview,
  };
}

/**
 * If `value` is a string that looks like serialized JSON ({...} or [...]),
 * parse it. Some providers (kie.ai) return nested results as JSON strings
 * (e.g. `data.resultJson = "{\"resultUrls\":[...]}"`) and the mapping path
 * `data.resultJson.resultUrls.0` only works if we transparently parse.
 */
async function buildProfileTaskResult(input: {
  response: unknown;
  mapping: Mapping;
  operation: HttpOperation;
  request: TaskRequest;
  taskIdFallback: string;
  wantedKind: BillingModelKind;
  projectId?: string;
  nodeId?: string;
}): Promise<{ result: TaskResult; providerMeta: JsonRecord }> {
  const responseMapping = isJsonRecord(input.operation.response_mapping) ? input.operation.response_mapping : null;
  const providerMetaMapping = isJsonRecord(input.operation.provider_meta_mapping) ? input.operation.provider_meta_mapping : null;
  const providerMeta = providerMetaFromResponse(input.response, providerMetaMapping);
  const taskId = firstString(
    firstMappedString(input.response, responseMapping, "task_id"),
    providerMeta.task_id,
    providerMeta.query_id,
    extractTaskIdShared(input.response),
    input.taskIdFallback,
  );
  const mappedAssetValues = [
    ...valuesFromMapping(input.response, responseMapping, "assets"),
    ...valuesFromMapping(input.response, responseMapping, "image_url"),
    ...valuesFromMapping(input.response, responseMapping, "video_url"),
  ];
  const assetUrls = Array.from(new Set([
    ...mappedAssetValues.flatMap(collectAssetUrls),
    ...collectAssetUrls(extractAssetUrl(input.response)),
  ]));
  const status = taskStatusFromResponse(input.response, responseMapping, input.mapping.statusMapping, assetUrls);
  const type: "image" | "video" = input.wantedKind === "video" ? "video" : "image";
  const assets = input.projectId
    ? await Promise.all(assetUrls.map((url) => localizeTaskAsset(input.projectId || "", url, type, input.nodeId)))
    : assetUrls.map((url) => ({ type, url, thumbnailUrl: type === "image" ? url : null }));
  return {
    providerMeta,
    result: {
      id: taskId,
      kind: input.request.kind,
      status,
      assets,
      raw: input.response,
    },
  };
}

export async function runTask(payload: unknown): Promise<TaskResult> {
  const raw = payload as { vendor?: string; request?: TaskRequest };
  const vendorKey = trim(raw.vendor);
  const request = raw.request;
  if (!vendorKey || !request) throw new Error("vendor and request are required");
  const kind = request.kind;
  const wantedKind = billingKindForTaskKind(kind);
  const modelKey = firstString(request.extras?.modelKey, request.extras?.modelAlias);
  const { vendor, model, apiKey } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId);
  const nodeId = trim(request.extras?.nodeId);
  const taskId = `task-${crypto.randomUUID()}`;
  const mapping = findTaskMapping(vendorKey, kind, modelKey);

  if (mapping) {
    const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: mapping.create });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping,
      operation: mapping.create,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
    });
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      taskCache.set(normalized.result.id, {
        vendor: vendorKey,
        request,
        raw: executed.response,
        mapping,
        model,
        providerMeta: normalized.providerMeta,
        projectId,
        nodeId,
        wantedKind,
      });
    }
    return normalized.result;
  }

  if (wantedKind === "text") {
    const imageUrl = kind === "image_to_prompt" ? firstReferenceImage(request) : "";
    // 收口 sanitize（P0-6）：聊天/文本 LLM 调用的 prompt 统一 ASCII 可移植化。
    const promptText = sanitizeForBroadCompat(request.prompt);
    const userContent: unknown = imageUrl
      ? [{ type: "text", text: promptText }, { type: "image_url", image_url: { url: imageUrl } }]
      : promptText;
    const maxTokensValue = Number(request.extras?.maxTokens ?? request.extras?.max_tokens);
    const temperatureValue = Number(request.extras?.temperature);
    const response = await postJson(endpoint(vendor, "/v1/chat/completions"), apiKey, vendor, {
      model: model.modelAlias || model.modelKey,
      messages: [{ role: "user", content: userContent }],
      temperature: Number.isFinite(temperatureValue) ? temperatureValue : 0.7,
      ...(Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? { max_tokens: maxTokensValue } : {}),
    });
    return { id: taskId, kind, status: "succeeded", assets: [], raw: response };
  }

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  const providerResponse = await postJson(endpoint(vendor, suffix), apiKey, vendor, {
    model: model.modelAlias || model.modelKey,
    prompt: request.prompt,
    size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
    seed: request.seed,
    n: 1,
    response_format: "url",
    extras: request.extras,
  });
  const assetUrl = extractAssetUrl(providerResponse);
  const upstreamTaskId = extractTaskIdShared(providerResponse) || taskId;
  if (!assetUrl) {
    taskCache.set(upstreamTaskId, { vendor: vendorKey, request, raw: providerResponse, model, projectId, nodeId, wantedKind });
    return { id: upstreamTaskId, kind, status: "queued", assets: [], raw: providerResponse };
  }
  const type: "image" | "video" = wantedKind === "video" ? "video" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId)
    : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
  // E11: provenance — captures everything needed to reproduce this exact
  // generation months later (model + prompt + seed + params).
  const provenance: NonNullable<TaskResult["provenance"]> = {
    provider: vendor.key,
    modelKey: model.modelAlias || model.modelKey,
    prompt: request.prompt,
    ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
    ...(typeof request.seed === "number" ? { seed: request.seed } : {}),
    params: {
      ...(request.width != null ? { width: request.width } : {}),
      ...(request.height != null ? { height: request.height } : {}),
      ...(request.steps != null ? { steps: request.steps } : {}),
      ...(request.cfgScale != null ? { cfgScale: request.cfgScale } : {}),
      ...(request.extras ? { extras: request.extras } : {}),
    },
    vendorRequestId: upstreamTaskId,
    timestamp: Date.now(),
  };
  return { id: upstreamTaskId, kind, status: "succeeded", assets: [asset], raw: providerResponse, provenance };
}

export async function fetchTaskResult(payload: unknown): Promise<{ vendor: string; result: TaskResult }> {
  const raw = payload as JsonRecord;
  const taskId = trim(raw.taskId);
  const cached = taskCache.get(taskId);
  if (!cached) {
    return {
      vendor: trim(raw.vendor),
      result: {
        id: taskId,
        kind: (raw.taskKind as ProfileKind) || "text_to_image",
        status: "failed",
        assets: [],
        raw: { message: "Local task is not in the pending cache." },
      },
    };
  }
  const queryOperation = cached.mapping?.query;
  if (cached.mapping && queryOperation && cached.model) {
    // 不再用缓存的明文 key，轮询时按 vendor 重新派生（并重新校验 key 仍可用）。
    const { vendor, model, apiKey } = findExecutableModel(
      cached.vendor,
      cached.model.modelKey,
      cached.wantedKind,
    );
    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey,
      request: cached.request,
      operation: queryOperation,
      providerMeta: {
        ...(cached.providerMeta || {}),
        query_id: cached.providerMeta?.query_id || taskId,
        task_id: cached.providerMeta?.task_id || taskId,
      },
    });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping: cached.mapping,
      operation: queryOperation,
      request: cached.request,
      taskIdFallback: taskId,
      wantedKind: cached.wantedKind || model.kind,
      projectId: cached.projectId,
      nodeId: cached.nodeId,
    });
    if (normalized.result.status === "succeeded" || normalized.result.status === "failed") {
      taskCache.delete(taskId);
    } else {
      taskCache.set(taskId, {
        ...cached,
        raw: executed.response,
        providerMeta: {
          ...(cached.providerMeta || {}),
          ...normalized.providerMeta,
        },
      });
    }
    return { vendor: cached.vendor, result: normalized.result };
  }

  const assetUrl = extractAssetUrl(cached.raw);
  if (assetUrl) {
    const type: "image" | "video" = cached.wantedKind === "video" ? "video" : "image";
    const asset = cached.projectId
      ? await localizeTaskAsset(cached.projectId, assetUrl, type, cached.nodeId)
      : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
    taskCache.delete(taskId);
    return {
      vendor: cached.vendor,
      result: { id: taskId, kind: cached.request.kind, status: "succeeded", assets: [asset], raw: cached.raw },
    };
  }

  return {
    vendor: cached.vendor,
    result: {
      id: taskId,
      kind: cached.request.kind,
      status: "queued",
      assets: [],
      raw: cached.raw,
    },
  };
}

// Agent（工具调用）模式下不适合做主控的 text 模型特征——vision/preview/audio 等
// 往往不可靠地发 tool_use，自动选模型撞上就「只说不做」（2026-06-07 真机走查 P0）。
// 无用户偏好时把它们降权（仍保留作回退），让通用对话模型优先。
const AUTO_TEXT_MODEL_DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i;
function autoTextModelPenalty(model: Model): number {
  const id = `${model.modelKey} ${model.modelAlias ?? ""}`;
  return AUTO_TEXT_MODEL_DEPRIORITIZE.test(id) ? 1 : 0;
}

function chooseTextModel(prefModelKey?: string): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const texts = state.models.filter((item) => item.kind === "text" && item.enabled);
  // 用户在助手面板选的模型排第一（仍保留其余作回退，避免选了不可用的就彻底没法跑）。
  // 无偏好时不再盲选第一个：按「是否像通用对话模型」稳定排序，vision/preview 等降到末尾。
  const ordered = prefModelKey
    ? [...texts].sort((a, b) => (a.modelKey === prefModelKey ? -1 : 0) - (b.modelKey === prefModelKey ? -1 : 0))
    : [...texts].sort((a, b) => autoTextModelPenalty(a) - autoTextModelPenalty(b));
  for (const model of ordered) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[model.vendorKey]);
    if (vendor && (vendor.authType === "none" || apiKey)) return { vendor, model, apiKey };
  }
  throw new Error("No local text model is configured. Open model settings and add an API key.");
}

/**
 * Read user-supplied custom request headers off a vendor. Stored under
 * `vendor.meta.extraHeaders` (a string→string map) by the manual-entry form so
 * relay/proxy gateways that need an extra auth header work without us hardcoding
 * per-provider knowledge. Returns undefined when none are set.
 */
export function extractVendorExtraHeaders(vendor: Vendor): Record<string, string> | undefined {
  const meta = vendor.meta as JsonRecord | undefined;
  const raw = meta?.extraHeaders;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = String(key || "").trim();
    const v = String(value ?? "").trim();
    if (k && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Single vendor→LanguageModel construction path. runAgentChatV2 (and any future
 * caller) goes through here so provider-kind, baseURL shaping, and custom headers
 * stay consistent (Rule 1: no parallel versions). anthropic uses the vendor's
 * baseUrlHint verbatim (or the SDK default when blank); openai-compatible appends /v1.
 */
function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  const providerKind = normalizeProviderKind(vendor.providerKind);
  const baseURL = providerKind === "anthropic"
    ? (vendor.baseUrlHint || "").trim()
    : endpoint(vendor, "/v1");
  const headers = extractVendorExtraHeaders(vendor);
  return buildAiSdkModel({
    kind: providerKind,
    baseURL,
    apiKey,
    modelId: model.modelAlias || model.modelKey,
    ...(headers ? { headers } : {}),
  });
}

// ---------------------------------------------------------------------------
// runAgentChatV2 — Phase B: tool-calling + real streaming
// ---------------------------------------------------------------------------
//
// v2 wires the canvas tools through `streamText` and surfaces token deltas +
// tool-call lifecycle to the renderer via an injected `emit` callback. The IPC layer (electron/
// main.ts) is responsible for forwarding those events on a per-session
// channel and for resolving the `awaitToolConfirmation` promise once the
// user confirms or rejects the proposed tool call.
// ---------------------------------------------------------------------------

// A tool call may target either the generation-canvas tool group or the
// creation-document tool group; the engine picks the group by skillKey.
export type AgentToolName = CanvasToolName | DocumentToolName;

export type AgentChatV2Event =
  | { type: "content-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: AgentToolName; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: AgentToolName; result: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: AgentToolName; message: string }
  | { type: "step-finish"; finishReason: string }
  | { type: "finish"; finishReason: string; usage?: unknown }
  | { type: "error"; message: string };

export type AgentToolConfirmation =
  | { ok: true; result: unknown }
  | { ok: false; message: string };

export type AgentChatV2Hooks = {
  emit: (event: AgentChatV2Event) => void;
  /**
   * Called when the LLM emits a tool call. The host (renderer over IPC) must
   * resolve with either `{ ok: true, result }` to feed the result back to
   * the model and continue the loop, or `{ ok: false, message }` to short
   * circuit the tool with an error result.
   */
  awaitToolConfirmation: (call: {
    toolCallId: string;
    toolName: AgentToolName;
    args: unknown;
  }) => Promise<AgentToolConfirmation>;
  abortSignal?: AbortSignal; // external cancel (user "Stop") → stream abort
};

// Wraps a tool descriptor so every invocation routes through the
// human-in-the-loop confirmation channel: emit `tool-call`, await the user's
// decision, then emit `tool-result` / `tool-error` and feed a structured
// result back to the model. Shared by both the canvas and document tool groups.
function makeAgentTool<TParams extends z.ZodTypeAny>(
  hooks: AgentChatV2Hooks,
  toolName: AgentToolName,
  description: string,
  parameters: TParams,
) {
  return tool({
    description,
    parameters,
    execute: async (args: unknown, opts: { toolCallId: string }) => {
      hooks.emit({ type: "tool-call", toolCallId: opts.toolCallId, toolName, args });
      const confirmation = await hooks.awaitToolConfirmation({
        toolCallId: opts.toolCallId,
        toolName,
        args,
      });
      if (!confirmation.ok) {
        hooks.emit({
          type: "tool-error",
          toolCallId: opts.toolCallId,
          toolName,
          message: confirmation.message,
        });
        // Surface as a structured tool result so the LLM can gracefully stop.
        return { ok: false as const, error: confirmation.message };
      }
      hooks.emit({
        type: "tool-result",
        toolCallId: opts.toolCallId,
        toolName,
        result: confirmation.result,
      });
      return { ok: true as const, result: confirmation.result };
    },
  });
}

function buildCanvasToolsForV2(hooks: AgentChatV2Hooks) {
  const makeTool = <TParams extends z.ZodTypeAny>(
    toolName: CanvasToolName,
    description: string,
    parameters: TParams,
  ) => makeAgentTool(hooks, toolName, description, parameters);

  return {
    read_canvas_state: makeTool(
      "read_canvas_state",
      "Read the current generation canvas (nodes + edges).",
      z.object({}),
    ),
    create_canvas_nodes: makeTool(
      "create_canvas_nodes",
      "Propose a batch of new canvas nodes for user confirmation.",
      z.object({
        summary: z.string(),
        nodes: z.array(plannedNodeSchema).min(1).max(24),
      }),
    ),
    connect_canvas_edges: makeTool(
      "connect_canvas_edges",
      "Connect nodes with reference edges (source feeds target).",
      z.object({
        edges: z.array(plannedEdgeSchema).min(1).max(48),
      }),
    ),
    set_node_prompt: makeTool(
      "set_node_prompt",
      "Rewrite the prompt of an existing node.",
      z.object({
        nodeId: z.string().min(1),
        prompt: z.string().min(1),
      }),
    ),
    delete_canvas_nodes: makeTool(
      "delete_canvas_nodes",
      "Delete one or more existing canvas nodes (destructive).",
      z.object({
        nodeIds: z.array(z.string().min(1)).min(1).max(24),
        // Keep a hint slot so the model can surface its rationale to the user
        // before destructive confirmation.
        reason: z.string().optional(),
      }),
    ),
    // Silence unused-import warning for canvasNodeKindSchema by re-exporting
    // it through the tool registry shape (it's enforced via plannedNodeSchema).
    _kindSchema: canvasNodeKindSchema,
  } as const;
}

// Creation-area document tools. We reuse the zod schemas + descriptions from
// `documentTools` (the source of truth) but wrap each in the v2 confirmation
// channel via `makeAgentTool`. read_* tools auto-confirm on the renderer; the
// write tools (insert/replace/append) surface a confirmation card.
function buildDocumentToolsForV2(hooks: AgentChatV2Hooks) {
  const make = (name: DocumentToolName) =>
    makeAgentTool(
      hooks,
      name,
      documentTools[name].description ?? name,
      documentTools[name].parameters as z.ZodTypeAny,
    );

  return {
    read_full_text: make("read_full_text"),
    read_selection: make("read_selection"),
    insert_at_cursor: make("insert_at_cursor"),
    replace_selection: make("replace_selection"),
    append_to_end: make("append_to_end"),
  } as const;
}

// Tool-group selector: creation-area skills (workbench.creation.*) get the
// document tools; everything else (generation / storyboard / default) gets the
// canvas tools. One engine, parameterized tool group.
function buildToolsForSkill(skillKey: string | undefined, hooks: AgentChatV2Hooks) {
  if (typeof skillKey === "string" && skillKey.startsWith("workbench.creation.")) {
    return buildDocumentToolsForV2(hooks);
  }
  const { _kindSchema, ...canvasTools } = buildCanvasToolsForV2(hooks);
  void _kindSchema;
  return canvasTools;
}

export type RunAgentChatV2Payload = {
  prompt: string;
  displayPrompt?: string;
  systemPrompt?: string;
  skill?: unknown;
  skillKey?: string;
  skillName?: string;
  chatContext?: unknown;
  mode?: string;
  temperature?: number;
  agentModelKey?: string; // 助手模型偏好（用户选的）：优先用，否则回退第一个可用 text 模型
  agentVendorKey?: string;
  /**
   * Shared conversation memory key. Both workbench panels use
   * `nomi:workbench:<projectId|local>` so the agent remembers across turns and
   * across the creation / generation areas. Omitted = no memory (one-shot).
   */
  sessionKey?: string;
  /** Drop any stored history for this sessionKey before running ("新对话"). */
  resetSession?: boolean;
};

// In-memory conversation history, keyed by sessionKey. Lives only for the app
// session (cleared on quit). Capped per key (capAgentHistory) so prompts can't
// grow unbounded. History/maxSteps/repair helpers live in ./ai/agentChatHarness.
const agentChatV2History = new Map<string, CoreMessage[]>();

/** Drop stored history for a session (or all sessions when no key given). */
export function clearAgentChatV2History(sessionKey?: string): void {
  if (sessionKey && sessionKey.trim()) {
    agentChatV2History.delete(sessionKey.trim());
  } else {
    agentChatV2History.clear();
  }
}

export async function runAgentChatV2(
  payload: RunAgentChatV2Payload,
  hooks: AgentChatV2Hooks,
): Promise<{ id: string; text: string; finishReason: string; usage?: unknown }> {
  const { vendor, model, apiKey } = chooseTextModel(trim(payload.agentModelKey));
  const systemPrompt = trim(payload.systemPrompt as unknown as JsonRecord["systemPrompt"]);
  const skillSystemPrompt = buildSkillSystemPrompt(payload as unknown as JsonRecord);
  // 收口 sanitize（P0-6）：送进 LLM 的 user/system 文本 ASCII 可移植化（防 Moonshot 等 tokenizer 异常）。
  const userPrompt = sanitizeForBroadCompat(trim(payload.prompt) || trim(payload.displayPrompt));

  const systemParts = [AGENT_LANGUAGE_DIRECTIVE, systemPrompt, skillSystemPrompt].filter((part) => part && part.length > 0);
  const system = systemParts.length > 0 ? sanitizeForBroadCompat(systemParts.join("\n\n")) : undefined;

  const languageModel = buildLanguageModelForVendor(vendor, model, apiKey);

  // Pick the tool group by skill: creation-area skills get document tools,
  // everything else gets canvas tools. The canonical skill key lives in
  // chatContext.skill.key; fall back to the top-level payload.skillKey.
  const resolvedSkillKey =
    readRequestedSkill(payload as unknown as JsonRecord).key || trim(payload.skillKey);
  const tools = buildToolsForSkill(resolvedSkillKey, hooks);

  // Replay stored history for this session so the agent remembers prior turns
  // (within a panel and across the creation / generation areas, which share a
  // sessionKey). "新对话" sends resetSession to wipe it first.
  const sessionKey = trim(payload.sessionKey);
  if (sessionKey && payload.resetSession) agentChatV2History.delete(sessionKey);
  const priorMessages = sessionKey ? agentChatV2History.get(sessionKey) ?? [] : [];
  const userMessage: CoreMessage = { role: "user", content: userPrompt };
  const messages: CoreMessage[] = [...priorMessages, userMessage];

  const abortController = createLinkedAbortController(hooks.abortSignal);
  const result = streamText({
    model: languageModel,
    ...buildAgentPromptParts(system, messages, normalizeProviderKind(vendor.providerKind) === "anthropic"),
    temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
    tools,
    abortSignal: abortController.signal,
    // maxSteps(skill) + toolCallStreaming + maxRetries + repairToolCall（见 harness 模块）。
    ...agentStreamTuning(resolvedSkillKey, languageModel),
    onError: ({ error }) => hooks.emit({ type: "error", message: error instanceof Error ? error.message : String(error) }),
  });

  const { finalText, finalFinish, finalUsage, ok } = await consumeAgentStreamWithTimeout(result, abortController, hooks, { firstChunkTimeoutMs: 90_000, label: `${vendor?.key}/${model?.modelKey}/${resolvedSkillKey}` });

  // 历史只存简短 displayPrompt（不存含整张快照的完整 prompt，否则每轮各存一份旧快照、token 膨胀）。
  if (ok && sessionKey) {
    const generated = (await result.response).messages as CoreMessage[];
    agentChatV2History.set(sessionKey, capAgentHistory([...priorMessages, { role: "user", content: sanitizeForBroadCompat(trim(payload.displayPrompt)) || userPrompt }, ...generated]));
  }

  return { id: `agent-${crypto.randomUUID()}`, text: finalText, finishReason: finalFinish, usage: finalUsage };
}
