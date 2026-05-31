import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExportJobManager, type ExportJobEvent } from "./exportJobManager";
import type { NomiRenderManifestV1 } from "./exportManifest";

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

function makeManifest(projectId = "project-1"): NomiRenderManifestV1 {
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
  };
}

describe("ExportJobManager", () => {
  it("creates queued job", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });

    const job = manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });

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

  it("emits event on status update", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });
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

  it("rejects concurrent active jobs", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });

    expect(() => manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() })).toThrow(/active export job/i);
  });

  it("rejects creating a new job when an active job is persisted for the project after restart", () => {
    const projectDir = makeTempDir();
    const firstManager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    firstManager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });
    const restartedManager = new ExportJobManager({ idGenerator: () => "job-2", clock: () => "2026-05-24T01:01:00.000Z" });

    expect(() => restartedManager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() })).toThrow(
      /active export job job-1 is queued/i,
    );
  });

  it("hydrates persisted failed jobs for manager get/list readback", () => {
    const projectDir = makeTempDir();
    const firstManager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    firstManager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });
    const failed = firstManager.failJob("job-1", new Error("ffmpeg crashed"));

    const restartedManager = new ExportJobManager({ projectDirs: [projectDir] });

    expect(restartedManager.getJob("job-1")).toEqual(failed);
    expect(restartedManager.listJobs("project-1")).toEqual([failed]);
  });

  it("marks job cancelled", async () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });

    const cancelled = await manager.cancelJob("job-1");

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
  });

  it("stores failure message", () => {
    const projectDir = makeTempDir();
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => "2026-05-24T01:00:00.000Z" });
    manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });

    const failed = manager.failJob("job-1", new Error("ffmpeg crashed"));

    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({ message: "ffmpeg crashed" });
  });

  it("clears stale terminal details when returning to active or completing successfully", () => {
    const projectDir = makeTempDir();
    let now = "2026-05-24T01:00:00.000Z";
    const manager = new ExportJobManager({ idGenerator: () => "job-1", clock: () => now });
    manager.createJob({ projectId: "project-1", projectDir, manifest: makeManifest() });
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
    const completed = manager.completeJob("job-1", { outputPath: path.join(projectDir, "exports", "video.mp4") });

    expect(completed.status).toBe("succeeded");
    expect(completed.error).toBeUndefined();
    expect(completed.result).toEqual({ outputPath: path.join(projectDir, "exports", "video.mp4") });
  });
});
