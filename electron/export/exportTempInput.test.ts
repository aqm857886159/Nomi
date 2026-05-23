import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExportJobSnapshot } from "./exportJobManager";
import {
  EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES,
  appendExportTempInputChunk,
  finishExportTempInput,
  removeExportTempInput,
  resolveExportTempInputPath,
} from "./exportTempInput";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeJob(): ExportJobSnapshot {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-temp-input-project-"));
  tempRoots.push(projectDir);
  const jobDir = path.join(projectDir, "cache", "exports", "job-1");
  fs.mkdirSync(jobDir, { recursive: true });
  return {
    id: "job-1",
    projectId: "project-1",
    projectDir,
    jobDir,
    manifest: {
      version: 1,
      projectId: "project-1",
      createdAt: "2026-05-24T00:00:00.000Z",
      timeline: { fps: 30, durationFrames: 30, range: { startFrame: 0, endFrame: 30 }, tracks: [] },
      profile: { preset: "publish", container: "mp4", videoCodec: "h264", audioCodec: "aac", width: 1920, height: 1080, fps: 30, pixelFormat: "yuv420p", quality: "standard" },
      assets: {},
    },
    status: "queued",
    progress: { ratio: 0, stage: "queued", message: "Queued" },
    cancelled: false,
    createdAt: "2026-05-24T00:00:00.000Z",
    updatedAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("export temp input", () => {
  it("appends chunked bytes under the export job directory and finishes with size", () => {
    const job = makeJob();

    const first = appendExportTempInputChunk(job, new Uint8Array([1, 2, 3]));
    const second = appendExportTempInputChunk(job, [4, 5]);
    const finished = finishExportTempInput(job);

    expect(first).toEqual({ ok: true, size: 3 });
    expect(second).toEqual({ ok: true, size: 5 });
    expect(finished.size).toBe(5);
    expect(finished.inputPath).toBe(resolveExportTempInputPath(job));
    expect(path.resolve(finished.inputPath).startsWith(`${path.resolve(job.jobDir)}${path.sep}`)).toBe(true);
    expect([...fs.readFileSync(finished.inputPath)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects empty chunks and empty finished input", () => {
    const job = makeJob();

    expect(() => appendExportTempInputChunk(job, new Uint8Array())).toThrow(/empty/i);
    expect(() => finishExportTempInput(job)).toThrow(/empty|missing/i);
  });

  it("rejects a single chunk larger than the temp input IPC chunk limit", () => {
    const job = makeJob();
    const oversized = new Uint8Array(EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES + 1);

    expect(() => appendExportTempInputChunk(job, oversized)).toThrow(/chunk.*too large|exceeds/i);
    expect(fs.existsSync(resolveExportTempInputPath(job))).toBe(false);
  });

  it("never accepts renderer supplied paths and ignores path-like payload properties", () => {
    const job = makeJob();
    const escapePath = path.join(job.projectDir, "escaped.webm");

    appendExportTempInputChunk(job, { chunk: [9, 8, 7], inputPath: escapePath });

    expect(fs.existsSync(escapePath)).toBe(false);
    expect([...fs.readFileSync(resolveExportTempInputPath(job))]).toEqual([9, 8, 7]);
  });

  it("removes only the managed temp input file", () => {
    const job = makeJob();
    appendExportTempInputChunk(job, [1]);
    const sibling = path.join(job.jobDir, "keep.txt");
    fs.writeFileSync(sibling, "keep");

    removeExportTempInput(job);

    expect(fs.existsSync(resolveExportTempInputPath(job))).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });
});
