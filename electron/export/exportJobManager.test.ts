import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExportJobExecutionEvidence,
  ExportJobManager,
  type ExportJobEvent,
  type ExportJobResult,
} from "./exportJobManager";
import type { ExportAuditManifestV1 } from "./exportAuditManifest";
import type { ExportJobProjectIdentity } from "./exportJobManager";
import { deriveCanonicalWorkspaceRootIdentity } from "../workspace/workspaceProjectIdentity";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-job-manager-test-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeManifest(projectId = "project-1"): ExportAuditManifestV1 {
  return {
    version: 1,
    projectId,
    createdAt: "2026-05-24T00:00:00.000Z",
    timeline: {
      fps: 30,
      durationFrames: 30,
      range: { startFrame: 0, endFrame: 30 },
      tracks: [{ id: "track-1", kind: "video", clips: [] }],
    },
    profile: {
      preset: "publish",
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "none",
      audioMode: "mute",
      width: 1920,
      height: 1080,
      fps: 30,
      pixelFormat: "yuv420p",
      quality: "standard",
    },
    assets: {},
    execution: { backend: "webm" },
  };
}

function identityFor(projectId = "project-1"): ExportJobProjectIdentity {
  return {
    projectId,
    immutableProjectUuid: `${projectId}-immutable-uuid`,
    projectGeneration: 1,
    canonicalRootDigest: `${projectId}-root-digest`,
  };
}

function successfulResult(projectDir: string, manifest: ExportAuditManifestV1, contents = "video"): ExportJobResult {
  const outputPath = path.join(projectDir, "exports", "video.mp4");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contents);
  return {
    outputPath,
    relativeOutputPath: "exports/video.mp4",
    bytes: Buffer.byteLength(contents),
    execution: createExportJobExecutionEvidence(manifest, { kind: "webm", sha256: "a".repeat(64), bytes: 5 }),
  };
}

describe("ExportJobManager", () => {
  const projectIdentity = Object.freeze({
    projectId: "project-1",
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
    projectGeneration: 1,
    canonicalRootDigest: "root-project-1",
  });

  it("creates queued job", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });

    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    expect(job).toMatchObject({
      id: "job-1",
      projectId: "project-1",
      projectDir,
      jobDir: path.join(projectDir, ".nomi", "jobs", "job-1"),
      status: "queued",
      progress: { ratio: 0, stage: "queued", message: "Queued" },
      cancelled: false,
      createdAt: "2026-05-24T01:00:00.000Z",
      updatedAt: "2026-05-24T01:00:00.000Z",
    });
    expect(manager.getJob("job-1")).toEqual(job);
    expect(manager.listJobs("project-1")).toEqual([job]);
  });

  it("reaps orphaned active jobs from a previous process on hydrate (no deadlock)", () => {
    const projectDir = makeTempDir();
    // 进程1：创建 job（queued = active），随即"崩溃"（永不完成）。
    const m1 = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    m1.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    // 进程2：重启，hydrate 同一项目目录 → 孤儿 active job 应被 reap 成 failed。
    const m2 = new ExportJobManager({
      projectDirs: [projectDir],
      idGenerator: () => "job-2",
      clock: () => "2026-05-24T02:00:00.000Z",
    });
    const reaped = m2.getJob("job-1");
    expect(reaped?.status).toBe("failed");
    expect(reaped?.error?.message).toMatch(/restart/i);

    // 不再死锁：能创建新 job（旧版会 throw "Cannot create export job while active …"）。
    const fresh = m2.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    expect(fresh.id).toBe("job-2");
    expect(fresh.status).toBe("queued");
  });

  it("emits event on status update", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    const events: ExportJobEvent[] = [];
    const unsubscribe = manager.onEvent((event) => events.push(event));

    const updated = manager.updateJob("job-1", { status: "rendering", progress: { ratio: 0.5, stage: "rendering", message: "Rendering" } });
    unsubscribe();
    manager.updateJob("job-1", { progress: { ratio: 0.75, stage: "rendering", message: "Still rendering" } });

    expect(updated.status).toBe("rendering");
    expect(events).toEqual([
      {
        type: "status",
        jobId: "job-1",
        projectId: "project-1",
        snapshot: updated,
      },
      {
        type: "progress",
        jobId: "job-1",
        projectId: "project-1",
        snapshot: updated,
      },
    ]);
  });

  it("rejects concurrent active jobs in the same project", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    expect(() => manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() })).toThrow(/active export job/i);
  });

  it("allows concurrent active jobs across different projects (per-project lock, not global)", () => {
    // 两个不同项目各起一个导出：旧的全局锁会让第二个项目被第一个阻死；
    // per-project 锁下两者应都能创建、互不阻塞。
    const projectDirA = makeTempDir();
    const projectDirB = makeTempDir();
    let id = 0;
    const manager = new ExportJobManager({ idGenerator: () => `job-${++id}`, clock: () => "2026-05-24T01:00:00.000Z" });

    const jobA = manager.createJob({ projectIdentity: identityFor("project-A"), projectDir: projectDirA, manifest: makeManifest("project-A") });
    const jobB = manager.createJob({ projectIdentity: identityFor("project-B"), projectDir: projectDirB, manifest: makeManifest("project-B") });

    expect(jobA.projectId).toBe("project-A");
    expect(jobB.projectId).toBe("project-B");
    expect(jobA.status).toBe("queued");
    expect(jobB.status).toBe("queued");
    // 同项目再起仍被拒（锁仍生效，只是范围收到 project 维度）。
    expect(() => manager.createJob({ projectIdentity: identityFor("project-A"), projectDir: projectDirA, manifest: makeManifest("project-A") })).toThrow(/active export job/i);
  });

  it("reaps a persisted orphan active job on restart instead of deadlocking (createJob-triggered hydrate)", () => {
    const projectDir = makeTempDir();
    const firstManager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    firstManager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    // 进程2：未在构造时 hydrate；createJob 内部 hydrate 应 reap 掉上个进程的孤儿 active job。
    const restartedManager = new ExportJobManager({ idGenerator: () => "job-2", clock: () => "2026-05-24T01:01:00.000Z" });

    // 旧行为：抛 "Cannot create export job while active export job job-1 is queued"（死锁）。
    // 新行为：reap 孤儿 → 成功创建新 job。
    const fresh = restartedManager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    expect(fresh.id).toBe("job-2");
    expect(fresh.status).toBe("queued");
    expect(restartedManager.getJob("job-1")?.status).toBe("failed");
  });

  it("hydrates persisted failed jobs for manager get/list readback", () => {
    const projectDir = makeTempDir();
    const firstManager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    firstManager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    const failed = firstManager.failJob("job-1", new Error("ffmpeg crashed"));

    const restartedManager = new ExportJobManager({ projectDirs: [projectDir] });

    expect(restartedManager.getJob("job-1")).toEqual(failed);
    expect(restartedManager.listJobs("project-1")).toEqual([failed]);
  });

  it("marks job cancelled", async () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    const cancelled = await manager.cancelJob("job-1");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
  });

  it("requires exact immutable project identity for status and cancellation", async () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    expect(manager.getJobForProject(projectIdentity, job.id)).toEqual(job);
    for (const replacement of [
      { ...projectIdentity, projectId: "project-2" },
      { ...projectIdentity, immutableProjectUuid: "22222222-2222-4222-8222-222222222222" },
      { ...projectIdentity, projectGeneration: 2 },
      { ...projectIdentity, canonicalRootDigest: "replacement-root" },
    ]) {
      expect(() => manager.getJobForProject(replacement, job.id)).toThrow(/project.*identity|does not belong/i);
      await expect(manager.cancelJobForProject(replacement, job.id)).rejects.toThrow(/project.*identity|does not belong/i);
    }

    expect(manager.getJob(job.id)?.status).toBe("queued");
  });

  it("lists jobs only for the exact immutable project identity", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    expect(manager.listJobsForProject(projectIdentity)).toEqual([job]);
    for (const replacement of [
      { ...projectIdentity, projectId: "project-2" },
      { ...projectIdentity, immutableProjectUuid: "22222222-2222-4222-8222-222222222222" },
      { ...projectIdentity, projectGeneration: 2 },
      { ...projectIdentity, canonicalRootDigest: "replacement-root" },
    ]) {
      expect(manager.listJobsForProject(replacement)).toEqual([]);
    }
  });

  it("hydrates the current project directory before exact identity listing", () => {
    const projectDir = makeTempDir();
    const first = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    const job = first.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    const completed = first.completeJob("job-1", successfulResult(projectDir, job.manifest));
    const restarted = new ExportJobManager();

    expect(restarted.listJobsForProject(projectIdentity, projectDir)).toEqual([completed]);
  });

  it("archives erased legacy evidence without rewriting or binding it during restart inspection", async () => {
    const projectDir = makeTempDir();
    const jobDir = path.join(projectDir, ".nomi", "jobs", "legacy-job");
    fs.mkdirSync(jobDir, { recursive: true });
    const legacyManifest = {
      ...makeManifest(),
      execution: undefined,
      timeline: { ...makeManifest().timeline, tracks: [] },
      diagnostics: { warnings: ["Renderer WebM capture migration used unresolved assets."] },
    };
    const legacySnapshot = {
      id: "legacy-job",
      projectId: "project-1",
      projectDir,
      jobDir,
      manifest: legacyManifest,
      status: "queued",
      progress: { ratio: 0, stage: "queued", message: "Queued" },
      cancelled: false,
      createdAt: "2026-05-24T01:00:00.000Z",
      updatedAt: "2026-05-24T01:00:00.000Z",
    };
    const manifestPath = path.join(jobDir, "manifest.json");
    const jobPath = path.join(jobDir, "job.json");
    fs.writeFileSync(manifestPath, JSON.stringify(legacyManifest));
    fs.writeFileSync(jobPath, JSON.stringify(legacySnapshot));
    const manifestBytes = fs.readFileSync(manifestPath);
    const jobBytes = fs.readFileSync(jobPath);

    const manager = new ExportJobManager({ projectDirs: [projectDir], clock: () => "2026-05-24T02:00:00.000Z" });
    const identity = {
      ...projectIdentity,
      canonicalRootDigest: deriveCanonicalWorkspaceRootIdentity(projectDir).canonicalRootDigest,
    };
    const recovered = manager.getJob("legacy-job")!;

    expect(recovered.status).toBe("failed");
    expect(recovered.error?.message).toMatch(/restart/i);
    expect(recovered.manifestIntegrity).toBe("legacy_incomplete");
    expect(recovered.projectIdentity).toBeNull();
    expect(recovered.manifest.execution).toEqual({ backend: "webm" });
    expect(manager.listJobsForProject(identity, projectDir)).toEqual([]);
    expect(() => manager.getJobForProject(identity, recovered.id)).toThrow(/project.*identity|does not belong/i);
    await expect(manager.cancelJobForProject(identity, recovered.id)).rejects.toThrow(/project.*identity|does not belong/i);
    expect(fs.readFileSync(manifestPath)).toEqual(manifestBytes);
    expect(fs.readFileSync(jobPath)).toEqual(jobBytes);
  });

  it("stores failure message", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });

    const failed = manager.failJob("job-1", new Error("ffmpeg crashed"));

    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({ message: "ffmpeg crashed" });
  });

  it("clears stale terminal details when returning to active or completing successfully", () => {
    const projectDir = makeTempDir();
    let now = "2026-05-24T01:00:00.000Z";
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => now });
    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    manager.failJob("job-1", new Error("ffmpeg crashed"));

    now = "2026-05-24T01:01:00.000Z";
    const activeAgain = manager.updateJob("job-1", {
      status: "rendering",
      progress: { ratio: 0.5, stage: "rendering", message: "Rendering" },
    });

    expect(activeAgain.status).toBe("rendering");
    expect(activeAgain.error).toBeUndefined();
    expect(activeAgain.result).toBeUndefined();

    manager.failJob("job-1", new Error("second failure"));
    now = "2026-05-24T01:02:00.000Z";
    const completed = manager.completeJob("job-1", successfulResult(projectDir, job.manifest));

    expect(completed.status).toBe("succeeded");
    expect(completed.error).toBeUndefined();
    expect(completed.result).toMatchObject({
      outputPath: fs.realpathSync.native(path.join(projectDir, "exports", "video.mp4")),
      relativeOutputPath: "exports/video.mp4",
      bytes: 5,
      execution: { input: { kind: "webm" } },
    });
  });

  it("fails closed for missing, empty, outside-project, or later-removed output files", () => {
    const projectDir = makeTempDir();
    const outsideDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    const job = manager.createJob({ projectIdentity, projectDir, manifest: makeManifest() });
    const execution = createExportJobExecutionEvidence(job.manifest, { kind: "webm", sha256: "b".repeat(64), bytes: 8 });
    const missingPath = path.join(projectDir, "exports", "missing.mp4");

    expect(() => manager.completeJob(job.id, { outputPath: missingPath, execution })).toThrow(/missing/i);
    fs.mkdirSync(path.dirname(missingPath), { recursive: true });
    fs.writeFileSync(missingPath, "");
    expect(() => manager.completeJob(job.id, { outputPath: missingPath, execution })).toThrow(/empty/i);

    const outsidePath = path.join(outsideDir, "video.mp4");
    fs.writeFileSync(outsidePath, "outside");
    expect(() => manager.completeJob(job.id, { outputPath: outsidePath, execution })).toThrow(/outside|project/i);

    fs.writeFileSync(missingPath, "valid");
    manager.completeJob(job.id, { outputPath: missingPath, relativeOutputPath: "exports/missing.mp4", execution });
    expect(manager.verifyJobOutputForProject(projectIdentity, job.id)).toMatchObject({ verified: true, bytes: 5 });
    fs.rmSync(missingPath);
    expect(manager.verifyJobOutputForProject(projectIdentity, job.id)).toMatchObject({ verified: false, code: "missing_output" });
  });
});
