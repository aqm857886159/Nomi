import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NomiRenderManifestV1 } from "./exportManifest";
import type { ExportJobProjectIdentity } from "./exportJobManager";
import { ExportCancelledError, transcodeWebmFileToMp4 } from "./ffmpegRunner";
// 静态导入（vi.mock 会提升到它们前面）：runtime 的导入图很重，负载下冷导入可达十几秒。放在用例体里 await import 时，
// 第一个用例要替整个文件付这笔账，超时被放弃后它仍在后台把导出任务建出来、留在单例里，后面的用例全被拖红
// （2026-10-10 负载下复现：第一个用例 15 秒超时，后面 9 个报「已有导出在进行」）。静态导入发生在收集阶段，不计入任何用例的超时。
import * as projectRepository from "../projects/repository";
import * as runtime from "../runtime";
import * as workspaceProjectIdentity from "../workspace/workspaceProjectIdentity";
import * as exportTempInput from "./exportTempInput";

vi.mock("./ffmpegRunner", () => {
  class ExportCancelledError extends Error {
    constructor(message = "Export cancelled") {
      super(message);
      this.name = "ExportCancelledError";
    }
  }
  return {
    ExportCancelledError,
    transcodeWebmFileToMp4: vi.fn(async (options: {
      projectDir: string;
      stderrLogPath?: string;
      signal?: AbortSignal;
      onProgress?: (progress: { ratio: number; outTimeMs?: number; stage?: string; message?: string }) => void;
    }) => {
      if (options.signal?.aborted) throw new ExportCancelledError();
      options.onProgress?.({ ratio: 0.4, outTimeMs: 400, stage: "encoding", message: "Encoding MP4" });
      if (options.stderrLogPath) {
        fs.mkdirSync(path.dirname(options.stderrLogPath), { recursive: true });
        fs.writeFileSync(options.stderrLogPath, "mock ffmpeg log");
      }
      const outputDir = path.join(options.projectDir, "exports");
      fs.mkdirSync(outputDir, { recursive: true });
      const absolutePath = path.join(outputDir, "mock.mp4");
      fs.writeFileSync(absolutePath, "mp4");
      return { absolutePath, relativePath: path.join("exports", "mock.mp4"), size: 3 };
    }),
    transcodeWebmToMp4: vi.fn(),
  };
});

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

async function exportProjectIdentity(projectId = "project-1"): Promise<ExportJobProjectIdentity> {
  const { projectDirById } = projectRepository;
  const { ensureWorkspaceProjectIdentity } = workspaceProjectIdentity;
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error(`Project ${projectId} was not found`);
  const identity = await ensureWorkspaceProjectIdentity(projectDir);
  return {
    projectId: identity.projectId,
    immutableProjectUuid: identity.immutableProjectUuid,
    projectGeneration: identity.projectGeneration,
    canonicalRootDigest: identity.canonicalRootDigest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-job-ipc-test-"));
  vi.stubEnv("NOMI_PROJECTS_DIR", tempRoot);
});

afterEach(() => {
  vi.stubEnv("NOMI_PROJECTS_DIR", undefined);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("runtime export job IPC functions", () => {
  it("does not expose legacy one-shot WebM export IPC to the renderer", () => {
    const preload = fs.readFileSync(path.join(process.cwd(), "electron", "preload.ts"), "utf8");
    const main = fs.readFileSync(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    const bridge = fs.readFileSync(path.join(process.cwd(), "src", "desktop", "bridge.ts"), "utf8");

    const exportsBridge = preload.match(/\n  exports: \{[\s\S]*?\n  \},\n  tasks:/)?.[0] ?? "";

    expect(preload).not.toMatch(/ipcRenderer\.invoke\(["']nomi:exports:start["']/);
    expect(exportsBridge).not.toMatch(/\bstart:\s*\(/);
    expect(main).not.toMatch(/ipcMain\.handle\(["']nomi:exports:start["']/);
    expect(bridge).not.toContain("webmBytes");
    expect(bridge).not.toMatch(/\bstart:\s*\(payload: DesktopMp4ExportStartPayload\)/);
  });

  it("starts a job by resolving projectId to projectDir and returns jobId", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    const result = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1"), outputName: "demo" });
    const identity = await exportProjectIdentity();
    const snapshot = getExportJobStatus(identity, result.jobId);

    expect(result.jobId).toBe(snapshot.id);
    expect(snapshot).toMatchObject({
      projectId: "project-1",
      projectDir: tempRoot,
      outputName: "demo",
      status: "planning",
      progress: expect.objectContaining({
        stage: "planning",
        message: expect.stringMatching(/ffmpeg-webm-transcode|backend/i),
      }),
    });
    await cancelExportJob(identity, result.jobId);
  });

  it("returns status and can cancel a job", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();

    expect(getExportJobStatus(identity, jobId).status).toBe("planning");

    const result = await cancelExportJob(identity, jobId);
    const cancelled = getExportJobStatus(identity, jobId);

    expect(result).toEqual({ ok: true });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled).toBe(true);
  });

  it("rejects temp input writes for unknown jobId", async () => {
    const { writeExportTempInput } = runtime;

    await expect(writeExportTempInput({
      projectId: "project-1",
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
      canonicalRootDigest: "missing-root",
    }, { jobId: "missing-job", chunk: [1, 2, 3] })).rejects.toThrow(/not found/i);
  });

  it("rejects temp input writes after cancel", async () => {
    const { cancelExportJob, createProject, startExportJob, writeExportTempInput } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    await cancelExportJob(identity, jobId);

    await expect(writeExportTempInput(identity, { jobId, chunk: [1, 2, 3] })).rejects.toThrow(/cancelled|not active|cannot write/i);
  });

  it("appends temp input chunks for active jobs under the jobDir", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();

    await expect(writeExportTempInput(identity, { jobId, chunk: new Uint8Array([1, 2]), path: path.join(tempRoot, "escape.webm") })).resolves.toEqual({ ok: true, size: 2 });
    await expect(writeExportTempInput(identity, { jobId, chunk: [3] })).resolves.toEqual({ ok: true, size: 3 });

    const snapshot = getExportJobStatus(identity, jobId);
    const inputPath = path.join(snapshot.jobDir, "input.webm");
    expect(fs.existsSync(path.join(tempRoot, "escape.webm"))).toBe(false);
    expect([...fs.readFileSync(inputPath)]).toEqual([1, 2, 3]);
    await cancelExportJob(identity, jobId);
  });

  it("rejects list, write, and finish after immutable project rotation before file or encoder effects", async () => {
    const {
      cancelExportJob,
      createProject,
      finishExportTempInput,
      getExportJobStatus,
      listExportJobs,
      startExportJob,
      writeExportTempInput,
    } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    const replacement = { ...identity, projectGeneration: identity.projectGeneration + 1 };
    const inputPath = path.join(getExportJobStatus(identity, jobId).jobDir, "input.webm");

    expect(listExportJobs(identity).map((job) => job.id)).toEqual([jobId]);
    expect(listExportJobs(replacement)).toEqual([]);
    await expect(writeExportTempInput(replacement, { jobId, chunk: [1, 2, 3] })).rejects.toThrow(/project.*identity|does not belong/i);
    await expect(finishExportTempInput(replacement, { jobId })).rejects.toThrow(/project.*identity|does not belong/i);

    expect(fs.existsSync(inputPath)).toBe(false);
    expect(transcodeWebmFileToMp4).not.toHaveBeenCalled();
    expect(getExportJobStatus(identity, jobId).status).toBe("planning");
    await cancelExportJob(identity, jobId);
  });

  it("rejects oversized temp input chunks through runtime IPC", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = runtime;
    const { EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES } = exportTempInput;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    const job = getExportJobStatus(identity, jobId);

    await expect(writeExportTempInput(identity, { jobId, chunk: new Uint8Array(EXPORT_TEMP_INPUT_MAX_CHUNK_BYTES + 1) })).rejects.toThrow(/chunk.*too large|exceeds/i);
    expect(fs.existsSync(path.join(job.jobDir, "input.webm"))).toBe(false);
    await cancelExportJob(identity, jobId);
  });

  it("removes temp input after a successful finish and wires runner progress/log options into the job lifecycle", async () => {
    const { createProject, getExportJobStatus, startExportJob, writeExportTempInput, finishExportTempInput } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    await writeExportTempInput(identity, { jobId, chunk: [1, 2, 3] });
    const inputPath = path.join(getExportJobStatus(identity, jobId).jobDir, "input.webm");
    expect(fs.existsSync(inputPath)).toBe(true);

    await finishExportTempInput(identity, { jobId });

    const snapshot = getExportJobStatus(identity, jobId);
    expect(fs.existsSync(inputPath)).toBe(false);
    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.result?.durationMs).toBe(1000);
    expect(transcodeWebmFileToMp4).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      inputPath,
      durationMs: 1000,
      stderrLogPath: path.join(snapshot.jobDir, "ffmpeg.log"),
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    }));
    expect(fs.readFileSync(path.join(snapshot.jobDir, "ffmpeg.log"), "utf8")).toContain("mock ffmpeg log");
  });

  it("keeps an in-flight finish cancelled when cancel aborts the active runner", async () => {
    let resolveRunnerStarted!: () => void;
    const runnerStarted = new Promise<void>((resolve) => {
      resolveRunnerStarted = resolve;
    });
    let sawAbort = false;
    vi.mocked(transcodeWebmFileToMp4).mockImplementationOnce(
      async (options: { projectDir: string; signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new ExportCancelledError());
          });
          resolveRunnerStarted();
          setTimeout(() => {
            const outputDir = path.join(options.projectDir, "exports");
            fs.mkdirSync(outputDir, { recursive: true });
            const absolutePath = path.join(outputDir, "ignored-after-cancel.mp4");
            fs.writeFileSync(absolutePath, "mp4");
            resolve({ absolutePath, relativePath: path.join("exports", "ignored-after-cancel.mp4"), size: 3 });
          }, 50);
        }),
    );
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput, finishExportTempInput } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    await writeExportTempInput(identity, { jobId, chunk: [1, 2, 3] });
    const inputPath = path.join(getExportJobStatus(identity, jobId).jobDir, "input.webm");

    const finishPromise = finishExportTempInput(identity, { jobId });
    await runnerStarted;
    await cancelExportJob(identity, jobId);

    await expect(finishPromise).rejects.toThrow(/cancelled/i);
    const snapshot = getExportJobStatus(identity, jobId);
    expect(sawAbort).toBe(true);
    expect(snapshot.status).toBe("cancelled");
    expect(snapshot.cancelled).toBe(true);
    expect(snapshot.result).toBeUndefined();
    expect(snapshot.error).toBeUndefined();
    expect(fs.existsSync(inputPath)).toBe(false);
  });

  it("removes temp input when a job is cancelled", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob, writeExportTempInput } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    const identity = await exportProjectIdentity();
    await writeExportTempInput(identity, { jobId, chunk: [1, 2, 3] });
    const inputPath = path.join(getExportJobStatus(identity, jobId).jobDir, "input.webm");
    expect(fs.existsSync(inputPath)).toBe(true);

    await cancelExportJob(identity, jobId);

    expect(fs.existsSync(inputPath)).toBe(false);
  });

  it("rejects missing and unknown projectId before creating a job", async () => {
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    await expect(startExportJob({ manifest: makeManifest("project-1") })).rejects.toThrow(/projectId is required/i);
    await expect(startExportJob({ projectId: "missing", manifest: makeManifest("missing") })).rejects.toThrow(/Project not found/i);
  });

  it("rejects unresolved renderer manifest requests with a clear asset resolution error", async () => {
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    await expect(
      startExportJob({
        projectId: "project-1",
        manifest: {
          ...makeManifest("project-1"),
          assets: {
            asset1: { id: "asset1", kind: "video", url: "nomi-local://project-1/assets/video.webm" },
          },
        },
      }),
    ).rejects.toThrow(/asset resolution is not wired yet/i);
  });

  it("keeps canonical audit truth when a renderer manifest uses the WebM backend", async () => {
    const { cancelExportJob, createProject, getExportJobStatus, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    const { jobId } = await startExportJob({
      projectId: "project-1",
      manifest: {
        ...makeManifest("project-1"),
        diagnostics: {
          warnings: ["Renderer request omits unsupported tracks while WebM capture migration is incomplete."],
        },
        timeline: {
          fps: 30,
          durationFrames: 30,
          range: { startFrame: 0, endFrame: 30 },
          tracks: [
            {
              id: "video-track",
              kind: "video",
              clips: [{ id: "clip-1", assetId: "asset1", startFrame: 0, endFrame: 30 }],
            },
          ],
        },
        assets: {
          asset1: { id: "asset1", kind: "video", url: "nomi-local://project-1/assets/video.webm" },
        },
      },
    });

    const identity = await exportProjectIdentity();
    const snapshot = getExportJobStatus(identity, jobId);
    expect(snapshot.status).toBe("planning");
    // 资产 URL 无法本地解析 → 后端降级为 webm（决策已前移到 startJob）
    expect(snapshot.progress.message).toMatch(/webm/i);
    expect(snapshot.manifest.timeline.tracks).toEqual([
      {
        id: "video-track",
        kind: "video",
        clips: [{ id: "clip-1", assetId: "asset1", startFrame: 0, endFrame: 30 }],
      },
    ]);
    expect(snapshot.manifest.assets.asset1).toMatchObject({
      id: "asset1",
      kind: "video",
      sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(snapshot.manifest.execution).toEqual({ backend: "webm" });
    const persisted = JSON.parse(fs.readFileSync(path.join(snapshot.jobDir, "manifest.json"), "utf8"));
    expect(persisted).toEqual(snapshot.manifest);
    expect(JSON.stringify(persisted)).not.toContain("nomi-local://");
    await cancelExportJob(identity, jobId);
  });

  it("rejects invalid renderer clip audio instead of silently falling back to WebM", async () => {
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    const assetDir = path.join(tempRoot, "assets");
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, "tone.wav"), "not-a-real-wave");

    const request = {
      ...makeManifest("project-1"),
      diagnostics: {
        warnings: ["Renderer request omits unsupported tracks while WebM capture migration is incomplete."],
      },
      timeline: {
        fps: 30,
        durationFrames: 30,
        range: { startFrame: 0, endFrame: 30 },
        tracks: [{
          id: "audio-track",
          kind: "audio",
          clips: [{
            id: "clip-1",
            assetId: "asset1",
            startFrame: 0,
            endFrame: 30,
            audio: { gainDb: 1, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
          }],
        }],
      },
      assets: {
        asset1: {
          id: "asset1",
          kind: "audio",
          url: "nomi-local://asset/project-1/assets/tone.wav",
        },
      },
    };

    await expect(startExportJob({ projectId: "project-1", manifest: request })).rejects.toThrow(/gainDb/i);
  });

  it("rejects renderer URL assets even when a fake absolutePath is supplied", async () => {
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    await expect(
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
    ).rejects.toThrow(/asset resolution is not wired yet/i);
  });

  it("rejects renderer-supplied absolutePath assets without a URL", async () => {
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });

    await expect(
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
    ).rejects.toThrow(/asset resolution is not wired yet/i);
  });
});

describe("export job table inflight probe (tests/setup/inflightWork.ts)", () => {
  it("counts a job left active and settles it so the next job on the same project can start", async () => {
    const probe = (globalThis as Record<symbol, Map<string, { count: () => number; settle: () => Promise<void> }> | undefined>)[Symbol.for("nomi.inflightProbes")]?.get("export-jobs");
    expect(probe).toBeDefined();
    const { createProject, startExportJob } = runtime;
    createProject({ id: "project-1", rootPath: tempRoot, name: "Project One", version: 1 });
    await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    expect(probe!.count()).toBe(1);
    await expect(startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") })).rejects.toThrow(/active export job/i);
    await probe!.settle();
    expect(probe!.count()).toBe(0);
    const { jobId } = await startExportJob({ projectId: "project-1", manifest: makeManifest("project-1") });
    await runtime.cancelExportJob(await exportProjectIdentity(), jobId);
    expect(probe!.count()).toBe(0);
  });
});
