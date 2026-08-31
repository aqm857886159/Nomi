import crypto from "node:crypto";
import fs from "node:fs";

import type { EcutHealth, EcutTask, VideoAnalysisSource, VideoAnalysisStage, VideoAnalysisTask } from "./contracts";
import { supportsRequestedInference } from "./contracts";
import type { EcutClient } from "./ecutClient";
import type { VideoAnalysisRepository } from "./repository";

type EngineConfig = {
  origin: string;
  token: string;
  externalInference: boolean;
  engineSourceRetention?: "delete_after_analysis" | "keep";
};

type ServiceDeps = {
  repository: VideoAnalysisRepository;
  createClient: (config: EngineConfig) => EcutClient;
  resolveEngineConfig: (projectId: string) => EngineConfig;
  runInBackground?: (job: Promise<void>) => void;
  schedulePoll?: (callback: () => void, delayMs: number) => void;
  now?: () => string;
  pollIntervalMs?: number;
};

type StartInput = {
  projectId: string;
  source: VideoAnalysisSource;
  sourceNodeId?: string | null;
};

function stageForEngine(task: EcutTask): VideoAnalysisStage {
  if (task.done) return "completed";
  if (task.stage <= 1) return "reading_media";
  if (task.stage >= Math.max(2, task.stageTotal - 1)) return "structuring";
  return "analyzing_evidence";
}

function errorDetail(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function createVideoAnalysisService(deps: ServiceDeps) {
  const runInBackground = deps.runInBackground ?? ((job) => { void job; });
  const schedulePoll = deps.schedulePoll ?? ((callback, delayMs) => { setTimeout(callback, delayMs); });
  const now = deps.now ?? (() => new Date().toISOString());
  const pollIntervalMs = Math.max(250, deps.pollIntervalMs ?? 2_000);
  const reconciliationIntervalMs = Math.max(5_000, pollIntervalMs * 3);
  const submissionFlights = new Set<string>();
  const reconciliationFlights = new Set<string>();
  const pollFlights = new Set<string>();

  function flightKey(projectId: string, analysisId: string): string {
    return `${projectId}\u0000${analysisId}`;
  }

  function clientFor(task: VideoAnalysisTask): EcutClient {
    const config = deps.resolveEngineConfig(task.projectId);
    if (config.origin !== task.engineOrigin || config.externalInference !== task.externalInference) {
      throw new Error("Video analysis engine settings changed; this task cannot silently change execution mode");
    }
    return deps.createClient(config);
  }

  function queuePoll(projectId: string, analysisId: string): void {
    schedulePoll(() => runInBackground(pollOnce(projectId, analysisId)), pollIntervalMs);
  }

  function queueReconciliation(projectId: string, analysisId: string): void {
    schedulePoll(() => {
      const task = deps.repository.read(projectId, analysisId);
      if (task && ["submitting", "submission_unknown"].includes(task.status)) {
        runInBackground(reconcileSubmission(task));
      }
    }, reconciliationIntervalMs);
  }

  function markFailure(task: VideoAnalysisTask, status: "failed" | "engine_unreachable" | "engine_incompatible", code: string, error: unknown): void {
    deps.repository.update(task.projectId, task.analysisId, (current) => ({
      ...current,
      status,
      errorCode: code,
      errorMessage: errorDetail(error),
      lastEngineCheckAt: now(),
    }));
  }

  function rememberHealth(task: VideoAnalysisTask, health: EcutHealth): VideoAnalysisTask {
    return deps.repository.update(task.projectId, task.analysisId, (current) => ({
      ...current,
      engineName: health.engine,
      engineVersion: health.version,
      lastEngineCheckAt: now(),
    }));
  }

  async function beginSubmissionOnce(projectId: string, analysisId: string): Promise<void> {
    const task = deps.repository.read(projectId, analysisId);
    if (!task || task.status !== "queued") return;
    let client: EcutClient;
    let health: EcutHealth;
    try {
      client = clientFor(task);
      health = await client.health();
    } catch (error) {
      markFailure(task, "engine_unreachable", "engine_unreachable", error);
      return;
    }
    rememberHealth(task, health);
    if (!supportsRequestedInference(health, task.externalInference)) {
      markFailure(task, "engine_incompatible", "engine_incompatible", task.externalInference
        ? "The local engine does not advertise model analysis support."
        : "The local engine does not advertise deterministic analysis support.");
      return;
    }

    let sourcePath: string;
    let sourceSha256: string;
    try {
      sourcePath = deps.repository.resolveSourcePath(projectId, task.source);
      sourceSha256 = await sha256File(sourcePath);
    } catch (error) {
      markFailure(task, "failed", "source_unavailable", error);
      return;
    }
    deps.repository.update(projectId, analysisId, (current) => ({
      ...current,
      status: "submitting",
      stage: "reading_media",
      sourceSha256,
      startedAt: current.startedAt ?? now(),
      errorCode: null,
      errorMessage: null,
    }));
    try {
      const submitted = await client.submit({
        filePath: sourcePath,
        requestId: analysisId,
        externalInference: task.externalInference,
        sourceSha256,
      });
      if (submitted.sourceSha256 !== sourceSha256) {
        throw new Error("The e-cut upload did not match Nomi's persisted source hash.");
      }
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        status: "running",
        engineTaskId: submitted.taskId,
        sourceSha256,
        lastEngineCheckAt: now(),
        lastEngineUpdateAt: now(),
      }));
      queuePoll(projectId, analysisId);
    } catch (error) {
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        status: "submission_unknown",
        errorCode: "submission_unknown",
        errorMessage: `The engine may have accepted this analysis. Nomi will not submit it again. ${errorDetail(error)}`.slice(0, 2_000),
        lastEngineCheckAt: now(),
      }));
      queueReconciliation(projectId, analysisId);
    }
  }

  async function beginSubmission(projectId: string, analysisId: string): Promise<void> {
    const key = flightKey(projectId, analysisId);
    if (submissionFlights.has(key)) return;
    submissionFlights.add(key);
    try {
      await beginSubmissionOnce(projectId, analysisId);
    } finally {
      submissionFlights.delete(key);
    }
  }

  async function reconcileSubmissionOnce(task: VideoAnalysisTask): Promise<void> {
    let client: EcutClient;
    try {
      client = clientFor(task);
      const taskId = await client.lookup(task.analysisId);
      if (!taskId) throw new Error("The engine has no task for this request id.");
      if (!task.sourceSha256) {
        markFailure(task, "failed", "source_integrity_unavailable", "Nomi did not persist the source hash before submission.");
        return;
      }
      deps.repository.update(task.projectId, task.analysisId, (current) => ({
        ...current,
        status: "running",
        engineTaskId: taskId,
        sourceSha256: task.sourceSha256,
        errorCode: null,
        errorMessage: null,
        lastEngineCheckAt: now(),
        lastEngineUpdateAt: now(),
      }));
      queuePoll(task.projectId, task.analysisId);
    } catch (error) {
      deps.repository.update(task.projectId, task.analysisId, (current) => ({
        ...current,
        status: "submission_unknown",
        errorCode: "submission_unknown",
        errorMessage: `Nomi could not confirm whether the engine accepted this analysis and did not submit it again. ${errorDetail(error)}`.slice(0, 2_000),
        lastEngineCheckAt: now(),
      }));
      queueReconciliation(task.projectId, task.analysisId);
    }
  }

  async function reconcileSubmission(task: VideoAnalysisTask): Promise<void> {
    const key = flightKey(task.projectId, task.analysisId);
    if (reconciliationFlights.has(key)) return;
    reconciliationFlights.add(key);
    try {
      await reconcileSubmissionOnce(task);
    } finally {
      reconciliationFlights.delete(key);
    }
  }

  async function pollOnceCore(projectId: string, analysisId: string): Promise<void> {
    const task = deps.repository.read(projectId, analysisId);
    if (!task || !task.engineTaskId || !["running", "cancel_requested", "engine_unreachable"].includes(task.status)) return;
    let response: EcutTask;
    try {
      response = await clientFor(task).poll(task.engineTaskId);
    } catch (error) {
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        status: "engine_unreachable",
        errorCode: "engine_unreachable",
        errorMessage: errorDetail(error),
        lastEngineCheckAt: now(),
      }));
      queuePoll(projectId, analysisId);
      return;
    }

    const latest = deps.repository.read(projectId, analysisId);
    if (!latest || !["running", "cancel_requested", "engine_unreachable"].includes(latest.status)) return;
    const engineChanged = latest.engineStage !== response.stage || latest.stageText !== response.stageText;
    if (response.cancelled) {
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        status: "cancelled",
        engineStage: response.stage,
        engineStageTotal: response.stageTotal,
        stageText: response.stageText,
        completedAt: now(),
        lastEngineCheckAt: now(),
        lastEngineUpdateAt: engineChanged ? now() : current.lastEngineUpdateAt,
        errorCode: null,
        errorMessage: null,
      }));
      return;
    }
    if (response.done && response.error) {
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        status: "failed",
        engineStage: response.stage,
        engineStageTotal: response.stageTotal,
        stageText: response.stageText,
        completedAt: now(),
        lastEngineCheckAt: now(),
        lastEngineUpdateAt: engineChanged ? now() : current.lastEngineUpdateAt,
        errorCode: "engine_failed",
        errorMessage: errorDetail(response.error),
      }));
      return;
    }
    if (response.done && response.storyboard) {
      const current = deps.repository.read(projectId, analysisId);
      if (!current) return;
      if (!current.sourceSha256) {
        markFailure(current, "failed", "source_integrity_unavailable", "Nomi could not verify the source video hash.");
        return;
      }
      deps.repository.complete(projectId, analysisId, response.storyboard, {
        engine: current.engineName ?? "unknown-local-engine",
        engineVersion: current.engineVersion,
        rawEvidence: response.rawEvidence ?? [],
        frames: [],
      });
      if (deps.resolveEngineConfig(projectId).engineSourceRetention === "delete_after_analysis") {
        try {
          await clientFor(current).deleteSource(current.engineTaskId!);
        } catch {
          // The canonical result is already durable in Nomi; cleanup remains retryable from settings.
        }
      }
      return;
    }

    deps.repository.update(projectId, analysisId, (current) => ({
      ...current,
      status: current.status === "cancel_requested" ? "cancel_requested" : "running",
      stage: stageForEngine(response),
      engineStage: response.stage,
      engineStageTotal: response.stageTotal,
      stageText: response.stageText,
      lastEngineCheckAt: now(),
      lastEngineUpdateAt: engineChanged ? now() : current.lastEngineUpdateAt,
      errorCode: null,
      errorMessage: null,
    }));
    queuePoll(projectId, analysisId);
  }

  async function pollOnce(projectId: string, analysisId: string): Promise<void> {
    const key = flightKey(projectId, analysisId);
    if (pollFlights.has(key)) return;
    pollFlights.add(key);
    try {
      await pollOnceCore(projectId, analysisId);
    } finally {
      pollFlights.delete(key);
    }
  }

  function start(input: StartInput): VideoAnalysisTask {
    const config = deps.resolveEngineConfig(input.projectId);
    const task = deps.repository.create({
      projectId: input.projectId,
      source: input.source,
      sourceNodeId: input.sourceNodeId ?? null,
      engineOrigin: config.origin,
      externalInference: config.externalInference,
    });
    runInBackground(beginSubmission(task.projectId, task.analysisId));
    return task;
  }

  function resumeProject(projectId: string): VideoAnalysisTask[] {
    const tasks = deps.repository.list(projectId);
    for (const task of tasks) {
      if (task.status === "queued") runInBackground(beginSubmission(projectId, task.analysisId));
      else if (["submitting", "submission_unknown"].includes(task.status)) runInBackground(reconcileSubmission(task));
      else if (task.engineTaskId && ["running", "cancel_requested", "engine_unreachable"].includes(task.status)) {
        queuePoll(projectId, task.analysisId);
      }
    }
    return tasks;
  }

  async function cancel(projectId: string, analysisId: string): Promise<VideoAnalysisTask> {
    const task = deps.repository.read(projectId, analysisId);
    if (!task || !["running", "engine_unreachable"].includes(task.status) || !task.engineTaskId) {
      throw new Error("Video analysis is not cancellable");
    }
    const updated = deps.repository.update(projectId, analysisId, (current) => ({
      ...current,
      status: "cancel_requested",
      errorCode: null,
      errorMessage: null,
      lastEngineCheckAt: now(),
    }));
    try {
      const response = await clientFor(updated).cancel(updated.engineTaskId!);
      if (!response.accepted) throw new Error("The local engine did not accept cancellation");
    } catch (error) {
      deps.repository.update(projectId, analysisId, (current) => ({
        ...current,
        errorCode: "cancel_verification_pending",
        errorMessage: errorDetail(error),
        lastEngineCheckAt: now(),
      }));
    }
    queuePoll(projectId, analysisId);
    return deps.repository.read(projectId, analysisId) ?? updated;
  }

  async function cleanup(projectId: string): Promise<{ attempted: number; removed: number; failed: number }> {
    const tasks = deps.repository.list(projectId).filter((task) => task.status === "completed" && task.engineTaskId);
    let removed = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        const result = await clientFor(task).deleteSource(task.engineTaskId!);
        if (result.removed) removed += 1;
      } catch {
        failed += 1;
      }
    }
    return { attempted: tasks.length, removed, failed };
  }

  return { start, resumeProject, cancel, cleanup };
}

export type VideoAnalysisService = ReturnType<typeof createVideoAnalysisService>;
