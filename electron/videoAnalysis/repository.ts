import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { readJsonFile, writeJsonFileAtomic } from "../jsonFile";
import { projectDirById } from "../projects/repository";
import {
  VIDEO_ANALYSIS_SCHEMA_VERSION,
  parseVideoAnalysisEvidence,
  parseVideoAnalysisResult,
  parseVideoAnalysisTask,
  type VideoAnalysisEvidence,
  type VideoAnalysisEvidenceInput,
  type VideoAnalysisResult,
  type VideoAnalysisSource,
  type VideoAnalysisTask,
} from "./contracts";
import { normalizeLoopbackEngineUrl } from "./engineUrl";

export type VideoAnalysisRepositoryDeps = {
  projectDirResolver?: (projectId: string) => string | null;
  now?: () => string;
  randomId?: () => string;
};

type CreateInput = {
  projectId: string;
  source: VideoAnalysisSource;
  sourceNodeId?: string | null;
  engineOrigin: string;
  externalInference: boolean;
};

const ANALYSIS_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
type TaskEnvelope = {
  schemaVersion: typeof VIDEO_ANALYSIS_SCHEMA_VERSION;
  task: VideoAnalysisTask;
  checksum: string;
};

const ALLOWED_TRANSITIONS: Record<VideoAnalysisTask["status"], ReadonlySet<VideoAnalysisTask["status"]>> = {
  queued: new Set(["submitting", "failed", "engine_unreachable", "engine_incompatible", "detached"]),
  submitting: new Set(["running", "submission_unknown", "failed", "engine_unreachable", "engine_incompatible", "cancelled", "detached"]),
  running: new Set(["completed", "cancelled", "failed", "engine_unreachable", "cancel_requested", "detached"]),
  engine_unreachable: new Set(["queued", "running", "completed", "cancel_requested", "cancelled", "failed", "detached"]),
  engine_incompatible: new Set(["queued", "failed", "detached"]),
  submission_unknown: new Set(["running", "failed", "cancelled", "detached"]),
  cancel_requested: new Set(["cancelled", "completed", "failed", "engine_unreachable", "detached"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  detached: new Set(),
};

function valueChecksum(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function taskEnvelope(task: VideoAnalysisTask): TaskEnvelope {
  const value = { schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION, task };
  return { ...value, checksum: valueChecksum(value) };
}

function safeRelativePath(value: string): string {
  const normalized = path.posix.normalize(String(value || "").replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("Invalid video analysis source relative path");
  }
  return normalized;
}

function readTaskFile(filePath: string): VideoAnalysisTask | null {
  try {
    const raw = readJsonFile(filePath) as TaskEnvelope;
    const value = { schemaVersion: raw?.schemaVersion, task: raw?.task };
    if (raw?.checksum !== valueChecksum(value)) return null;
    const task = parseVideoAnalysisTask(raw.task);
    task.source.relativePath = safeRelativePath(task.source.relativePath);
    if (normalizeLoopbackEngineUrl(task.engineOrigin) !== task.engineOrigin) return null;
    return task;
  } catch {
    return null;
  }
}

export function createVideoAnalysisRepository(deps: VideoAnalysisRepositoryDeps = {}) {
  const resolveProjectDir = deps.projectDirResolver ?? projectDirById;
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  function projectDir(projectId: string): string {
    const id = String(projectId || "").trim();
    const root = resolveProjectDir(id);
    if (!id || !root) throw new Error(`Video analysis project not found: ${id || "(empty)"}`);
    return root;
  }

  function paths(projectId: string, analysisId: string) {
    if (!ANALYSIS_ID.test(analysisId)) throw new Error("Invalid video analysis id");
    const dir = path.join(projectDir(projectId), ".nomi", "analysis", "video", analysisId);
    return {
      dir,
      task: path.join(dir, "task.json"),
      result: path.join(dir, "result.json"),
      evidence: path.join(dir, "evidence.json"),
    };
  }

  function create(input: CreateInput): VideoAnalysisTask {
    const timestamp = now();
    const analysisId = `analysis-${randomId()}`;
    const source = { ...input.source, relativePath: safeRelativePath(input.source.relativePath) };
    const target = paths(input.projectId, analysisId);
    if (fs.existsSync(target.task)) throw new Error(`Video analysis already exists: ${analysisId}`);
    const task: VideoAnalysisTask = {
      schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      analysisId,
      projectId: input.projectId,
      source,
      sourceNodeId: input.sourceNodeId ?? null,
      engineOrigin: input.engineOrigin,
      externalInference: input.externalInference,
      status: "queued",
      stage: "queued",
      engineTaskId: null,
      sourceSha256: null,
      engineName: null,
      engineVersion: null,
      engineStage: null,
      engineStageTotal: null,
      stageText: "",
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      lastEngineCheckAt: null,
      lastEngineUpdateAt: null,
      resultAvailable: false,
    };
    writeJsonFileAtomic(target.task, taskEnvelope(task));
    return task;
  }

  function read(projectId: string, analysisId: string): VideoAnalysisTask | null {
    return readTaskFile(paths(projectId, analysisId).task);
  }

  function resolveSourcePath(projectId: string, source: VideoAnalysisSource): string {
    const root = projectDir(projectId);
    const relativePath = safeRelativePath(source.relativePath);
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Video analysis source must be a project file");
    }

    let cursor = root;
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error("Video analysis source cannot use symbolic links");
    }
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) throw new Error("Video analysis source must be a file");
    const realRoot = fs.realpathSync(root);
    const realSource = fs.realpathSync(candidate);
    const realRelative = path.relative(realRoot, realSource);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Video analysis source escaped the project boundary");
    }
    return candidate;
  }

  function update(
    projectId: string,
    analysisId: string,
    apply: (task: VideoAnalysisTask) => VideoAnalysisTask,
  ): VideoAnalysisTask {
    const target = paths(projectId, analysisId);
    const current = readTaskFile(target.task);
    if (!current) throw new Error(`Video analysis task not found: ${analysisId}`);
    const next = { ...apply(current), schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION, updatedAt: now() };
    if (next.analysisId !== current.analysisId || next.projectId !== current.projectId) {
      throw new Error("Video analysis identity cannot change");
    }
    next.source = { ...next.source, relativePath: safeRelativePath(next.source.relativePath) };
    next.engineOrigin = normalizeLoopbackEngineUrl(next.engineOrigin);
    if (next.status !== current.status && !ALLOWED_TRANSITIONS[current.status].has(next.status)) {
      throw new Error(`Invalid video analysis status transition: ${current.status} -> ${next.status}`);
    }
    const parsed = parseVideoAnalysisTask(next);
    writeJsonFileAtomic(target.task, taskEnvelope(parsed));
    return parsed;
  }

  function list(projectId: string): VideoAnalysisTask[] {
    const root = path.join(projectDir(projectId), ".nomi", "analysis", "video");
    if (!fs.existsSync(root)) return [];
    const tasks = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ANALYSIS_ID.test(entry.name))
      .map((entry) => readTaskFile(path.join(root, entry.name, "task.json")))
      .filter((task): task is VideoAnalysisTask => Boolean(task));
    return tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function complete(
    projectId: string,
    analysisId: string,
    result: VideoAnalysisResult,
    evidence: VideoAnalysisEvidenceInput,
  ): VideoAnalysisTask {
    const target = paths(projectId, analysisId);
    const current = read(projectId, analysisId);
    if (!current || !["running", "cancel_requested", "engine_unreachable"].includes(current.status)) {
      throw new Error("Video analysis must be recoverably active before completion");
    }
    if (!current.engineTaskId || !current.sourceSha256) {
      throw new Error("Video analysis identities must be durable before completion");
    }
    const verifiedResult = parseVideoAnalysisResult(result);
    const verifiedEvidence = parseVideoAnalysisEvidence({
      schemaVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
      projectId: current.projectId,
      analysisId: current.analysisId,
      engineTaskId: current.engineTaskId,
      sourceRelativePath: current.source.relativePath,
      sourceSha256: current.sourceSha256,
      ...evidence,
      resultSha256: valueChecksum(verifiedResult),
    });
    writeJsonFileAtomic(target.result, verifiedResult);
    writeJsonFileAtomic(target.evidence, verifiedEvidence);
    return update(projectId, analysisId, (current) => ({
      ...current,
      status: "completed",
      stage: "completed",
      completedAt: now(),
      resultAvailable: true,
      errorCode: null,
      errorMessage: null,
    }));
  }

  function readBoundArtifacts(projectId: string, analysisId: string): {
    result: VideoAnalysisResult;
    evidence: VideoAnalysisEvidence;
  } | null {
    const target = paths(projectId, analysisId);
    try {
      if (!fs.existsSync(target.result) || !fs.existsSync(target.evidence)) return null;
      const task = read(projectId, analysisId);
      if (!task || task.status !== "completed" || !task.resultAvailable || !task.engineTaskId || !task.sourceSha256) return null;
      const result = parseVideoAnalysisResult(readJsonFile(target.result));
      const evidence = parseVideoAnalysisEvidence(readJsonFile(target.evidence));
      if (
        evidence.projectId !== task.projectId
        || evidence.analysisId !== task.analysisId
        || evidence.engineTaskId !== task.engineTaskId
        || evidence.sourceRelativePath !== task.source.relativePath
        || evidence.sourceSha256 !== task.sourceSha256
        || evidence.resultSha256 !== valueChecksum(result)
      ) return null;
      return { result, evidence };
    } catch {
      return null;
    }
  }

  function readResult(projectId: string, analysisId: string): VideoAnalysisResult | null {
    return readBoundArtifacts(projectId, analysisId)?.result ?? null;
  }

  function readEvidence(projectId: string, analysisId: string): VideoAnalysisEvidence | null {
    return readBoundArtifacts(projectId, analysisId)?.evidence ?? null;
  }

  function recoverAfterRestart(projectId: string): VideoAnalysisTask[] {
    return list(projectId).map((task) => {
      if (task.status !== "submitting") return task;
      return update(projectId, task.analysisId, (current) => ({
        ...current,
        status: "submission_unknown",
        errorCode: "submission_unknown",
        errorMessage: "The engine may have accepted this analysis before Nomi restarted. It was not submitted again.",
      }));
    });
  }

  return { create, read, update, list, complete, readResult, readEvidence, recoverAfterRestart, resolveSourcePath, paths };
}

export type VideoAnalysisRepository = ReturnType<typeof createVideoAnalysisRepository>;
