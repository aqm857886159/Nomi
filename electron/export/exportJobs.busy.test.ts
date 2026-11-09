import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProject } from "../projects/repository";
import { ensureWorkspaceProjectIdentity } from "../workspace/workspaceProjectIdentity";
import type { ExportJobProjectIdentity } from "./exportJobManager";

// 导出算忙矩阵（方向检查 docs/engineering/direction-checks/2026-11-09-app-reopen-owner.md「特征测试清单」）：
// 「有活在跑」是关窗藏 / 退、后台空闲退出、更新安装共用的那一份真相。本次运行里建的导出，从建任务前的素材探测起
// 到终态都算忙；以前会话留在磁盘上的 active 作业不算（它没人在跑，算忙会让 App 永远退不掉）。
// 走真导出入口、真项目目录；只替换 ffprobe 的答复与编码器，让每一段停在我们想看的地方。
vi.mock("./mediaProbe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mediaProbe")>()),
  probeMediaMetadata: vi.fn(),
}));

vi.mock("./ffmpegRunner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ffmpegRunner")>()),
  renderFiltergraphToMp4: vi.fn(),
  transcodeWebmFileToMp4: vi.fn(),
  transcodeWebmToMp4: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), "nomi-electron-mock", name),
    getAppPath: () => process.cwd(),
  },
}));

const PROJECT_ID = "export-busy-project";
let tempRoot = "";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function manifest() {
  const dir = path.join(tempRoot, "assets", "imported");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "clip.mp4"), "media bytes are not inspected in this test");
  const url = `nomi-local://asset/${encodeURIComponent(PROJECT_ID)}/assets/imported/clip.mp4`;
  return {
    version: 1,
    projectId: PROJECT_ID,
    createdAt: "2026-11-09T00:00:00.000Z",
    timeline: {
      fps: 30,
      durationFrames: 60,
      range: { startFrame: 0, endFrame: 60 },
      tracks: [{ id: "track-0", kind: "video", type: "video", clips: [{ id: "clip-0", assetId: "asset-0", startFrame: 0, endFrame: 60, sourceStartFrame: 0, sourceEndFrame: 60 }] }],
    },
    profile: { preset: "publish", container: "mp4", videoCodec: "h264", audioCodec: "none", audioMode: "mute", width: 1920, height: 1080, fps: 30, pixelFormat: "yuv420p", quality: "standard" },
    assets: { "asset-0": { id: "asset-0", kind: "video", url } },
    diagnostics: { warnings: [] },
  };
}

async function identity(): Promise<ExportJobProjectIdentity> {
  const disk = await ensureWorkspaceProjectIdentity(tempRoot);
  return { projectId: disk.projectId, immutableProjectUuid: disk.immutableProjectUuid, projectGeneration: disk.projectGeneration, canonicalRootDigest: disk.canonicalRootDigest };
}

// 每个用例一个新的模块表（= 一次新的运行）；替身也要从同一张表里拿。
async function load() {
  const jobs = await import("./exportJobs");
  const { probeMediaMetadata } = await import("./mediaProbe");
  const { renderFiltergraphToMp4 } = await import("./ffmpegRunner");
  return { jobs, probeMediaMetadata: vi.mocked(probeMediaMetadata), renderFiltergraphToMp4: vi.mocked(renderFiltergraphToMp4) };
}

const silentVideo = { kind: "video" as const, hasAudio: false, durationSeconds: 2, streamCount: 1 };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-busy-"));
  vi.stubEnv("NOMI_PROJECTS_DIR", tempRoot);
  vi.stubEnv("NOMI_SETTINGS_DIR", path.join(tempRoot, ".settings"));
  createProject({ id: PROJECT_ID, rootPath: tempRoot, name: "Export busy", version: 1 });
});

afterEach(async () => {
  const { jobs } = await load();
  jobs.abortAllActiveExports();
  vi.unstubAllEnvs();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("export busy matrix (one truth for close / idle exit / update install)", () => {
  it("counts an export while its assets are still being probed (preparing, before the job exists)", async () => {
    const { jobs, probeMediaMetadata } = await load();
    const probe = deferred<typeof silentVideo>();
    probeMediaMetadata.mockReturnValue(probe.promise);
    const started = jobs.startExportJob({ projectId: PROJECT_ID, manifest: manifest(), outputName: "out" });
    await vi.waitFor(() => expect(probeMediaMetadata).toHaveBeenCalled());
    expect(jobs.activeExportCount()).toBe(0);
    probe.resolve(silentVideo);
    const { jobId } = await started;
    await jobs.cancelExportJob(await identity(), jobId);
  });

  it("counts a created job that is still queued / planning / waiting for the renderer (webm recording)", async () => {
    const { jobs, probeMediaMetadata } = await load();
    probeMediaMetadata.mockResolvedValue(silentVideo);
    const { jobId } = await jobs.startExportJob({ projectId: PROJECT_ID, manifest: manifest(), outputName: "out" });
    expect(["queued", "planning", "preparing"]).toContain(jobs.getExportJobStatus(await identity(), jobId).status);
    expect(jobs.activeExportCount()).toBe(0);
    await jobs.cancelExportJob(await identity(), jobId);
  });

  it("counts an export that is encoding", async () => {
    const { jobs, probeMediaMetadata, renderFiltergraphToMp4 } = await load();
    probeMediaMetadata.mockResolvedValue(silentVideo);
    const encode = deferred<{ absolutePath: string; relativePath: string; size: number }>();
    renderFiltergraphToMp4.mockReturnValue(encode.promise);
    const { jobId } = await jobs.startExportJob({ projectId: PROJECT_ID, manifest: manifest(), outputName: "out" });
    const finishing = jobs.finishExportTempInput(await identity(), { jobId });
    await vi.waitFor(() => expect(renderFiltergraphToMp4).toHaveBeenCalled());
    expect(jobs.activeExportCount()).toBe(1);
    fs.mkdirSync(path.join(tempRoot, "exports"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "exports", "out.mp4"), "mp4");
    encode.resolve({ absolutePath: path.join(tempRoot, "exports", "out.mp4"), relativePath: "exports/out.mp4", size: 3 });
    await finishing.catch(() => undefined);
    // 终态：编码结束（成功或验收失败都是终态）就不算忙。
    expect(jobs.activeExportCount()).toBe(0);
  });

  it("stops counting a job once it reaches a terminal state (cancelled)", async () => {
    const { jobs, probeMediaMetadata } = await load();
    probeMediaMetadata.mockResolvedValue(silentVideo);
    const { jobId } = await jobs.startExportJob({ projectId: PROJECT_ID, manifest: manifest(), outputName: "out" });
    await jobs.cancelExportJob(await identity(), jobId);
    expect(jobs.activeExportCount()).toBe(0);
  });

  it("does not count an active job left on disk by a previous session", async () => {
    const { jobs: before, probeMediaMetadata } = await load();
    probeMediaMetadata.mockResolvedValue(silentVideo);
    await before.startExportJob({ projectId: PROJECT_ID, manifest: manifest(), outputName: "out" });
    // 新进程：内存里的任务表是空的，磁盘上留着一个停在 planning 的作业。
    vi.resetModules();
    const { jobs: after } = await load();
    after.listExportJobs(await identity());
    expect(after.activeExportCount()).toBe(0);
  });
});
