import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { EcutClient } from "./ecutClient";
import { createVideoAnalysisRepository } from "./repository";
import { createVideoAnalysisService } from "./service";

const roots: string[] = [];

function projectFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-video-analysis-service-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "reference.mp4"), "video");
  let id = 0;
  const repository = createVideoAnalysisRepository({
    projectDirResolver: (projectId) => projectId === "project-a" ? root : null,
    randomId: () => `fixed-${++id}`,
  });
  return { root, repository };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function scheduler() {
  const background: Promise<void>[] = [];
  const timers: Array<() => void> = [];
  return {
    background,
    timers,
    runInBackground: (job: Promise<void>) => { background.push(job); },
    schedulePoll: (callback: () => void) => { timers.push(callback); },
    async flushBackground() {
      const jobs = background.splice(0);
      await Promise.all(jobs);
    },
  };
}

function baseClient(overrides: Partial<EcutClient> = {}): EcutClient {
  return {
    origin: "http://127.0.0.1:8931",
    health: vi.fn(async () => ({
      engine: "eccut-local",
      version: "eccut-local-api-v2",
      pipelineReady: true,
      missingDependencies: [],
      analysisModes: ["deterministic", "model"],
    })),
    submit: vi.fn(async ({ requestId, sourceSha256 }) => ({
      taskId: "task-0123456789abcdef0123456789abcdef",
      requestId,
      sourceSha256: sourceSha256 ?? "a".repeat(64),
      deduplicated: false,
    })),
    lookup: vi.fn(async () => null),
    poll: vi.fn(),
    cancel: vi.fn(async () => ({ accepted: true as const, state: "cancel_requested" })),
    deleteSource: vi.fn(async () => ({ removed: true })),
    ...overrides,
  };
}

const finishedStoryboard = {
  summary: "A workflow",
  hookAnalysis: "Evidence first",
  scenes: [],
  patterns: [],
  metrics: { shotCount: 38 },
  source: "model" as const,
};

describe("video analysis service", () => {
  it("returns immediately, persists submit intent, reports real stages, and completes durably", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    const client = baseClient({
      poll: vi.fn()
        .mockResolvedValueOnce({
          taskId: "task-0123456789abcdef0123456789abcdef",
          done: false,
          cancelled: false,
          stage: 3,
          stageTotal: 6,
          stageText: "OCR",
          error: null,
          storyboard: null,
        })
        .mockResolvedValueOnce({
          taskId: "task-0123456789abcdef0123456789abcdef",
          done: true,
          cancelled: false,
          stage: 6,
          stageTotal: 6,
          stageText: "模式提炼",
          error: null,
          storyboard: finishedStoryboard,
        }),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });

    const started = service.start({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
    });

    expect(started.status).toBe("queued");
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("running");
    expect(client.submit).toHaveBeenCalledTimes(1);

    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    const during = repository.read("project-a", started.analysisId);
    expect(during?.stage).toBe("analyzing_evidence");
    expect(during?.engineStage).toBe(3);
    expect(during?.stageText).toBe("OCR");

    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("completed");
    expect(repository.readResult("project-a", started.analysisId)?.metrics).toEqual({ shotCount: 38 });
  });

  it("reconciles a submitting task by request id after restart and never posts it twice", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    const created = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", created.analysisId, (task) => ({
      ...task,
      status: "submitting",
      sourceSha256: "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
    }));
    const client = baseClient({
      lookup: vi.fn(async () => "task-0123456789abcdef0123456789abcdef"),
      poll: vi.fn(async () => ({
        taskId: "task-0123456789abcdef0123456789abcdef",
        done: false,
        cancelled: false,
        stage: 1,
        stageTotal: 6,
        stageText: "镜头切分",
        error: null,
        storyboard: null,
      })),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: true }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });

    service.resumeProject("project-a");
    await scheduling.flushBackground();

    expect(client.lookup).toHaveBeenCalledWith(created.analysisId);
    expect(client.submit).not.toHaveBeenCalled();
    expect(repository.read("project-a", created.analysisId)?.engineTaskId).toBe("task-0123456789abcdef0123456789abcdef");
    expect(repository.read("project-a", created.analysisId)?.sourceSha256)
      .toBe("0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc");
  });

  it("keeps reconciling an unknown submission by lookup without posting the source again", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    const client = baseClient({
      submit: vi.fn(async () => { throw new Error("connection closed after upload"); }),
      lookup: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("task-0123456789abcdef0123456789abcdef"),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });

    const started = service.start({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
    });
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("submission_unknown");

    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("submission_unknown");

    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("running");
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(client.lookup).toHaveBeenCalledTimes(2);
  });

  it("keeps an unknowable submission quarantined and verifies cancellation through polling", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    const unknown = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", unknown.analysisId, (task) => ({ ...task, status: "submitting" }));
    const client = baseClient({
      lookup: vi.fn(async () => { throw new Error("engine offline"); }),
      poll: vi.fn(async () => ({
        taskId: "task-0123456789abcdef0123456789abcdef",
        done: true,
        cancelled: true,
        stage: 3,
        stageTotal: 6,
        stageText: "OCR",
        error: null,
        storyboard: null,
      })),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: true }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    service.resumeProject("project-a");
    await scheduling.flushBackground();
    expect(repository.read("project-a", unknown.analysisId)?.status).toBe("submission_unknown");
    expect(client.submit).not.toHaveBeenCalled();

    const running = repository.create({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
      engineOrigin: "http://127.0.0.1:8931",
      externalInference: true,
    });
    repository.update("project-a", running.analysisId, (task) => ({ ...task, status: "submitting" }));
    repository.update("project-a", running.analysisId, (task) => ({
      ...task,
      status: "running",
      engineTaskId: "task-0123456789abcdef0123456789abcdef",
    }));

    await service.cancel("project-a", running.analysisId);
    expect(repository.read("project-a", running.analysisId)?.status).toBe("cancel_requested");
    scheduling.timers.pop()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", running.analysisId)?.status).toBe("cancelled");
  });

  it("single-flights concurrent start and resume before the health probe resolves", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    let releaseHealth: (() => void) | undefined;
    const healthGate = new Promise<void>((resolve) => { releaseHealth = resolve; });
    const client = baseClient({
      health: vi.fn(async () => {
        await healthGate;
        return { engine: "eccut-local", version: "v2", pipelineReady: true, missingDependencies: [], analysisModes: ["deterministic"] };
      }),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    const started = service.start({
      projectId: "project-a",
      source: { kind: "project_asset", relativePath: "assets/reference.mp4" },
    });
    service.resumeProject("project-a");
    releaseHealth?.();
    await scheduling.flushBackground();

    expect(repository.read("project-a", started.analysisId)?.status).toBe("running");
    expect(client.health).toHaveBeenCalledTimes(1);
    expect(client.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps the original hash when the source changes after a lost submission receipt", async () => {
    const { root, repository } = projectFixture();
    const scheduling = scheduler();
    const client = baseClient({
      submit: vi.fn(async () => { throw new Error("lost receipt"); }),
      lookup: vi.fn(async () => "task-0123456789abcdef0123456789abcdef"),
    });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    const started = service.start({ projectId: "project-a", source: { kind: "project_asset", relativePath: "assets/reference.mp4" } });
    await scheduling.flushBackground();
    const originalHash = repository.read("project-a", started.analysisId)?.sourceSha256;
    fs.writeFileSync(path.join(root, "assets", "reference.mp4"), "changed-video");
    scheduling.timers.shift()?.();
    await scheduling.flushBackground();

    expect(originalHash).toBe("0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc");
    expect(repository.read("project-a", started.analysisId)?.sourceSha256).toBe(originalHash);
    expect(repository.read("project-a", started.analysisId)?.status).toBe("running");
  });

  it("accepts completion after cancellation and after an engine outage", async () => {
    const { repository } = projectFixture();
    const scheduling = scheduler();
    const completedResponse = {
      taskId: "task-0123456789abcdef0123456789abcdef",
      done: true,
      cancelled: false,
      stage: 6,
      stageTotal: 6,
      stageText: "完成",
      error: null,
      storyboard: finishedStoryboard,
      rawEvidence: [],
    };
    const client = baseClient({ poll: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(completedResponse) });
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    const started = service.start({ projectId: "project-a", source: { kind: "project_asset", relativePath: "assets/reference.mp4" } });
    await scheduling.flushBackground();
    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("engine_unreachable");
    scheduling.timers.shift()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", started.analysisId)?.status).toBe("completed");

    const second = service.start({ projectId: "project-a", source: { kind: "project_asset", relativePath: "assets/reference.mp4" } });
    await scheduling.flushBackground();
    await service.cancel("project-a", second.analysisId);
    scheduling.timers.pop()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", second.analysisId)?.status).toBe("completed");
  });

  it("persists source failures and truncates valid long engine errors", async () => {
    const { root, repository } = projectFixture();
    const scheduling = scheduler();
    fs.unlinkSync(path.join(root, "assets", "reference.mp4"));
    const client = baseClient();
    const service = createVideoAnalysisService({
      repository,
      createClient: () => client,
      resolveEngineConfig: () => ({ origin: client.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    const missing = service.start({ projectId: "project-a", source: { kind: "project_asset", relativePath: "assets/reference.mp4" } });
    await scheduling.flushBackground();
    expect(repository.read("project-a", missing.analysisId)?.status).toBe("failed");

    fs.writeFileSync(path.join(root, "assets", "reference.mp4"), "video");
    const failingClient = baseClient({
      poll: vi.fn(async () => ({
        taskId: "task-0123456789abcdef0123456789abcdef", done: true, cancelled: false,
        stage: 6, stageTotal: 6, stageText: "失败", error: "x".repeat(20_000), storyboard: null, rawEvidence: [],
      })),
    });
    const failingService = createVideoAnalysisService({
      repository,
      createClient: () => failingClient,
      resolveEngineConfig: () => ({ origin: failingClient.origin, token: "secret", externalInference: false }),
      runInBackground: scheduling.runInBackground,
      schedulePoll: scheduling.schedulePoll,
    });
    const failing = failingService.start({ projectId: "project-a", source: { kind: "project_asset", relativePath: "assets/reference.mp4" } });
    await scheduling.flushBackground();
    scheduling.timers.pop()?.();
    await scheduling.flushBackground();
    expect(repository.read("project-a", failing.analysisId)?.errorMessage).toHaveLength(2_000);
  });
});
