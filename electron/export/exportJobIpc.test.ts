import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NomiRenderManifestV1 } from "./exportManifest";

vi.mock("./ffmpegRunner", () => ({
  transcodeWebmFileToMp4: vi.fn(async ({ projectDir }: { projectDir: string }) => {
    const outputDir = path.join(projectDir, "exports");
    fs.mkdirSync(outputDir, { recursive: true });
    const absolutePath = path.join(outputDir, "mock.mp4");
    fs.writeFileSync(absolutePath, "mp4");
    return { absolutePath, relativePath: path.join("exports", "mock.mp4"), size: 3 };
  }),
  transcodeWebmToMp4: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), "nomi-electron-mock", name),
    getAppPath: () => process.cwd(),
  },
}));

let tempRoot = "";

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
      audioCodec: "aac",
      width: 1920,
      height: 1080,
      fps: 30,
      pixelFormat: "yuv420p",
      quality: "standard",
    },
    assets: {},
  };
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-job-ipc-test-"));
  process.env.NOMI_PROJECTS_DIR = tempRoot;
});

afterEach(() => {
  delete process.env.NOMI_PROJECTS_DIR;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("runtime export job IPC functions", () => {
  it("does not expose legacy one-shot WebM export IPC to the renderer", () => {
    const preload = fs.readFileSync(path.join(process.cwd(), "electron", "preload.ts"), "utf8");
    const main = fs.readFileSync(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    const bridge = fs.readFileSync(path.join(process.cwd(), "src", "desktop", "bridge.ts"), "utf8");

    expect(preload).not.toMatch(/ipcRenderer\.invoke\(["']nomi:exports:start["']/);
    expect(preload).not.toMatch(/\bstart:\s*\(/);
    expect(main).not.toMatch(/ipcMain\.handle\(["']nomi:exports:start["']/);
    expect(bridge).not.toContain("webmBytes");
    expect(bridge).not.toMatch(/\bstart:\s*\(payload: DesktopMp4ExportStartPayload\)/);
  });

  it("starts a job by resolving projectId to projectDir and returns jobId", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });

    const result = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1"), outputName: "demo" });
    const snapshot = getExportJobStatus(result.jobId);

    expect(result.jobId).toBe(snapshot.id);
    expect(snapshot).toMatchObject({
      projectId: "project-1",
      projectDir: path.join(tempRoot, "Project One"),
      outputName: "demo",
      status: "queued",
    });
    await cancelExportJob(result.jobId);
  });

  it("returns status and can cancel a job", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });

    expect(getExportJobStatus(jobId).status).toBe("queued");

    const result = await cancelExportJob(jobId);
    const cancelled = getExportJobStatus(jobId);

    expect(result).toEqual({ ok: true });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
  });

  it("rejects temp input writes for unknown jobId", async () => {
    const { writeExportTempInput } = await import("../runtime");

    await expect(writeExportTempInput({ jobId: "missing-job", chunk: [1, 2, 3] })).rejects.toThrow(/not found/i);
  });

  it("rejects temp input writes after cancel", async () => {
    const { cancelExportJob, createProject, startExportJob, writeExportTempInput } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    await cancelExportJob(jobId);

    await expect(writeExportTempInput({ jobId, chunk: [1, 2, 3] })).rejects.toThrow(/cancelled|not active|cannot write/i);
  });

  it("appends temp input chunks for active jobs under the jobDir", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });

    await expect(writeExportTempInput({ jobId, chunk: new Uint8Array([1, 2]), path: path.join(tempRoot, "escape.webm") })).resolves.toEqual({ ok: true, size: 2 });
    await expect(writeExportTempInput({ jobId, chunk: [3] })).resolves.toEqual({ ok: true, size: 3 });

    const snapshot = getExportJobStatus(jobId);
    const inputPath = path.join(snapshot.jobDir, "input.webm");
    expect(fs.existsSync(path.join(tempRoot, "escape.webm"))).toBe(false);
    expect([...fs.readFileSync(inputPath)]).toEqual([1, 2, 3]);
    await cancelExportJob(jobId);
  });

  it("rejects oversized temp input chunks through runtime IPC", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = await import("../runtime");
    const { EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES } = await import("./exportTempInput");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const job = getExportJobStatus(jobId);

    await expect(writeExportTempInput({ jobId, chunk: new Uint8Array(EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES + 1) })).rejects.toThrow(/chunk.*too large|exceeds/i);
    expect(fs.existsSync(path.join(job.jobDir, "input.webm"))).toBe(false);
    await cancelExportJob(jobId);
  });

  it("removes temp input after a successful finish", async () => {
    const { createProject, getExportJobStatus, startExportJob, writeExportTempInput, finishExportTempInput } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    await writeExportTempInput({ jobId, chunk: [1, 2, 3] });
    const inputPath = path.join(getExportJobStatus(jobId).jobDir, "input.webm");
    expect(fs.existsSync(inputPath)).toBe(true);

    await finishExportTempInput({ jobId });

    expect(fs.existsSync(inputPath)).toBe(false);
  });

  it("removes temp input when a job is cancelled", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });
    const { jobId } = startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    await writeExportTempInput({ jobId, chunk: [1, 2, 3] });
    const inputPath = path.join(getExportJobStatus(jobId).jobDir, "input.webm");
    expect(fs.existsSync(inputPath)).toBe(true);

    await cancelExportJob(jobId);

    expect(fs.existsSync(inputPath)).toBe(false);
  });

  it("rejects missing and unknown projectId before creating a job", async () => {
    const { createProject, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });

    expect(() => startExportJob({ manifest: makeManifest("project-1") })).toThrow(/projectId is required/i);
    expect(() => startExportJob({ projectId: "missing", manifest: makeManifest("missing") })).toThrow(/Project not found/i);
  });

  it("rejects unresolved renderer manifest requests with a clear asset resolution error", async () => {
    const { createProject, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });

    expect(() =>
      startExportJob({
        projectId: "project-1",
        manifest: {
          ...makeManifest("project-1"),
          assets: {
            asset1: { id: "asset1", kind: "video", url: "nomi-local://project-1/assets/video.webm" },
          },
        },
      }),
    ).toThrow(/asset resolution is not wired yet/i);
  });

  it("rejects renderer URL assets even when a fake absolutePath is supplied", async () => {
    const { createProject, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });

    expect(() =>
      startExportJob({
        projectId: "project-1",
        manifest: {
          ...makeManifest("project-1"),
          assets: {
            asset1: {
              id: "asset1",
              kind: "video",
              url: "nomi-local://project-1/assets/video.webm",
              absolutePath: path.join(tempRoot, "fake-renderer-path.webm"),
            },
          },
        },
      }),
    ).toThrow(/asset resolution is not wired yet/i);
  });

  it("rejects renderer-supplied absolutePath assets without a URL", async () => {
    const { createProject, startExportJob } = await import("../runtime");
    createProject({ id: "project-1", name: "Project One", version: 1 });

    expect(() =>
      startExportJob({
        projectId: "project-1",
        manifest: {
          ...makeManifest("project-1"),
          assets: {
            asset1: {
              id: "asset1",
              kind: "video",
              absolutePath: path.join(tempRoot, "renderer-supplied.webm"),
            },
          },
        },
      }),
    ).toThrow(/asset resolution is not wired yet/i);
  });
});
