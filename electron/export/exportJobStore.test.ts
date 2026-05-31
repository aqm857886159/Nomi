import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExportJobStore } from "./exportJobStore";
import type { NomiRenderManifestV1 } from "./exportManifest";
import type { ExportJobSnapshot } from "./exportJobManager";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-job-store-test-"));
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

function makeSnapshot(projectDir: string, overrides: Partial<ExportJobSnapshot> = {}): ExportJobSnapshot {
  return {
    id: "job-1",
    projectId: "project-1",
    projectDir,
    jobDir: path.join(projectDir, ".nomi", "jobs", "job-1"),
    manifest: makeManifest(),
    status: "queued",
    progress: { ratio: 0, stage: "queued", message: "Queued" },
    cancelled: false,
    createdAt: "2026-05-24T01:00:00.000Z",
    updatedAt: "2026-05-24T01:00:00.000Z",
    ...overrides,
  };
}

describe("ExportJobStore", () => {
  it("writes manifest/job/log/result files under the job temp dir", () => {
    const projectDir = makeTempDir();
    const store = new ExportJobStore();
    const snapshot = makeSnapshot(projectDir);

    store.create(snapshot);
    const completed = store.save({
      ...snapshot,
      status: "succeeded",
      updatedAt: "2026-05-24T01:01:00.000Z",
      result: { outputPath: path.join(projectDir, "exports", "video.mp4"), relativeOutputPath: "exports/video.mp4" },
    });

    expect(fs.existsSync(path.join(snapshot.jobDir, "manifest.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(snapshot.jobDir, "manifest.json"), "utf8"))).toEqual(snapshot.manifest);
    expect(JSON.parse(fs.readFileSync(path.join(snapshot.jobDir, "job.json"), "utf8"))).toEqual(completed);
    expect(fs.readFileSync(path.join(snapshot.jobDir, "export.log"), "utf8")).toContain("created job job-1");
    expect(JSON.parse(fs.readFileSync(path.join(snapshot.jobDir, "result.json"), "utf8"))).toEqual(completed.result);
  });

  it("can load a persisted failed job snapshot for post-crash review", () => {
    const projectDir = makeTempDir();
    const store = new ExportJobStore();
    const failed = makeSnapshot(projectDir, {
      status: "failed",
      error: { message: "ffmpeg crashed" },
      updatedAt: "2026-05-24T01:02:00.000Z",
    });

    store.create(makeSnapshot(projectDir));
    store.save(failed);

    const loaded = store.loadJob(projectDir, "job-1");
    const recent = store.loadRecentJobs(projectDir);

    expect(loaded).toEqual(failed);
    expect(recent).toEqual([failed]);
    expect(JSON.parse(fs.readFileSync(path.join(failed.jobDir, "error.json"), "utf8"))).toEqual(failed.error);
  });
});
