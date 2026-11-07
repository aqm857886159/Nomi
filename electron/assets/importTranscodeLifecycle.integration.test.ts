// 导入转码的生命周期（真 ffmpeg、真退出 owner、真 assetsIpc 注册；只换掉 Electron 本体和发送方校验）：
// 中止 / 退出时，ffmpeg 进程真没了（按 PID 查）、半成品和临时目录真删了、导入以取消结束、不发布资产。
// 夹具从登记的真实素材（tests/ux/real-media-fixtures.json · video-canvas-follow-hand-1080p15）派生，只落测试 tmp。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveFfmpegPath } from "../export/ffmpegRunner";
import { installQuitTeardown, resetQuitTeardownForTests, type QuitLifecycleApp, type QuitLifecycleEvent, type QuitTeardownDependencies } from "../quitTeardown";
import { createProject } from "../runtime";
import type { IpcRequestSender } from "../ipcRequestRegistry";
import { registerAssetsIpc } from "./assetsIpc";
import { importLocalFile } from "./localFileImport";
import { resetVideoImportTranscodesForTests, stopVideoImportTranscodes, transcodeFileToPlayableMp4IfNeeded } from "./videoImportNormalize";

const harness = vi.hoisted(() => {
  const running: number[] = [];
  const waiters: Array<{ count: number; resolve: (pids: number[]) => void }> = [];
  return {
    documentsRoot: "",
    userDataRoot: "",
    handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
    /** 起过的 ffmpeg / ffprobe 子进程（命令行第一个参数）。 */
    spawned: [] as string[],
    /** 导入起的 ffmpeg（不含 ffprobe）第一次往 stderr 吐进度 = 转码真的在跑了。 */
    markRunning(pid: number) {
      running.push(pid);
      for (const waiter of waiters.splice(0)) {
        if (running.length >= waiter.count) waiter.resolve([...running]);
        else waiters.push(waiter);
      }
    },
    /** 等到至少 count 个 ffmpeg 在跑（事件握手，不拿墙钟猜）。 */
    whenRunning(count: number): Promise<number[]> {
      if (running.length >= count) return Promise.resolve([...running]);
      return new Promise((resolve) => { waiters.push({ count, resolve }); });
    },
    reset() {
      running.length = 0;
      waiters.length = 0;
      this.spawned.length = 0;
    },
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "documents" ? harness.documentsRoot : harness.userDataRoot),
    getAppPath: () => process.cwd(),
    on: () => undefined,
    whenReady: () => Promise.resolve(),
  },
  clipboard: {},
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => { harness.handlers.set(name, handler); },
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined, assertTrustedUiSender: () => undefined }));
// 只记下 ffmpeg 子进程的 PID 和「第一次吐进度」，进程照常由生产代码起、由生产代码收。
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const spawn = ((...args: unknown[]) => {
    const child = (actual.spawn as (...spawnArgs: unknown[]) => ChildProcess)(...args);
    const pid = child.pid;
    const command = String(args[0]);
    if (/(?:^|[\\/])ff(?:mpeg|probe)(?:\.exe)?$/i.test(command)) harness.spawned.push(command);
    if (/(?:^|[\\/])ffmpeg(?:\.exe)?$/i.test(command) && pid !== undefined) {
      child.stderr?.once("data", () => harness.markRunning(pid));
    }
    return child;
  }) as typeof actual.spawn;
  return { ...actual, spawn, default: { ...actual, spawn } };
});

// 系统 tmp 在任何 TMPDIR 打桩之前取：夹具和项目放这里；每条用例另给导入一个私有 tmp，好查它收没收干净。
const systemTmp = os.tmpdir();
const tempRoots: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(systemTmp, prefix));
  tempRoots.push(dir);
  return dir;
}

let legacyAviPath = "";

beforeAll(() => {
  harness.documentsRoot = makeTempDir("nomi-import-lifecycle-documents-");
  harness.userDataRoot = makeTempDir("nomi-import-lifecycle-user-data-");
  // mpeg4-in-AVI：Chromium 放不了，导入必须整段重编码（15 秒 1080p，转码要好几秒，中途一定停得到）。
  legacyAviPath = path.join(makeTempDir("nomi-import-lifecycle-fixture-"), "legacy.avi");
  const derive = spawnSync(resolveFfmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", path.resolve("tests/ux/fixtures/canvas-follow-hand-1080p15.mp4"),
    "-an", "-c:v", "mpeg4", "-q:v", "6", legacyAviPath,
  ], { encoding: "utf8", timeout: 120_000 });
  if (derive.status !== 0) throw new Error(`fixture derive failed: ${derive.stderr}`);
}, 120_000);

afterAll(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

let importTmp = "";
beforeEach(() => {
  // 每条用例一个「刚启动的应用」：退出 owner 没装过，退出排空关上的导入转码之门重新打开。
  resetQuitTeardownForTests();
  resetVideoImportTranscodesForTests();
  harness.handlers.clear();
  harness.reset();
  importTmp = makeTempDir("nomi-import-lifecycle-tmp-");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(name, importTmp);
});

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((entry) => fs.statSync(path.join(dir, entry)).isFile());
}

const sender: IpcRequestSender = { id: 1, isDestroyed: () => false, once: () => undefined, removeListener: () => undefined };

/** 真退出 owner + 假 Electron app：quit() = before-quit → will-quit；exited = owner 调 app.exit 的那一刻。 */
function installQuitOwner(overrides: Partial<QuitTeardownDependencies> = {}) {
  const listeners = new Map<string, (event: QuitLifecycleEvent) => void>();
  const receipts: Array<{ event: string; fields: Record<string, string | number> }> = [];
  let exit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => { exit = resolve; });
  const app = {
    on: (event: string, listener: (event: QuitLifecycleEvent) => void) => { listeners.set(event, listener); return app; },
    whenReady: () => Promise.resolve(),
    quit: () => undefined,
    exit: (code = 0) => exit(code),
  } as unknown as QuitLifecycleApp;
  installQuitTeardown(app, {
    disposeBackgroundLifecycle: () => undefined,
    stopDesktopCapabilityCore: () => undefined,
    disposeDesktopLaneIpc: async () => undefined,
    abortAllActiveExports: () => 0,
    onReceipt: (event, fields) => { receipts.push({ event, fields }); },
    ...overrides,
  });
  const quit = () => {
    for (const name of ["before-quit", "will-quit"]) listeners.get(name)?.({ preventDefault: () => undefined });
  };
  return { quit, exited, receipts };
}

/** 两扇门同时在转：界面的原生路径导入（经请求表、带信号）+ Agent 的 asset.import（core.ts → importLocalFile，不带信号）。 */
async function startImportsFromBothDoors() {
  const projectRoot = makeTempDir("nomi-import-lifecycle-project-");
  const projectId = (createProject({ rootPath: projectRoot, name: "Import Lifecycle", payload: {} }) as { id: string }).id;
  registerAssetsIpc(() => undefined);
  const fromUi = harness.handlers.get("nomi:assets:import-native-file")!({ sender, senderFrame: {} }, {
    projectId, sourcePath: legacyAviPath, fileName: "legacy.avi", contentType: "video/x-msvideo",
  });
  const fromAgent = importLocalFile(
    { projectId, sourcePath: legacyAviPath, fileName: "agent.avi", contentType: "video/x-msvideo", kind: "imported" },
    { allowSourcePath: true },
  ).then(() => "published", (error: unknown) => error);
  const pids = await harness.whenRunning(2);
  return { projectRoot, fromUi, fromAgent, pids };
}

describe("导入转码的生命周期", () => {
  it("发起方中止（窗口没了 / 换项目）：转码进行中停下 → ffmpeg 进程没了、半成品删了、以取消结束", async () => {
    const outputDir = makeTempDir("nomi-import-lifecycle-cancel-");
    const controller = new AbortController();
    const pending = transcodeFileToPlayableMp4IfNeeded(legacyAviPath, "legacy.avi", outputDir, {
      signal: controller.signal,
      // 第一份带比例的进度 = ffmpeg 真在编码了，这时候停。
      onProgress: (ratio) => { if (ratio > 0) controller.abort(); },
    });
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const [pid] = await harness.whenRunning(1);
    expect(processGone(pid!)).toBe(true);
    expect(filesUnder(outputDir)).toEqual([]);
  }, 60_000);

  it("转码进行中退出：两扇门的 ffmpeg 都停了、临时目录删了，导入以取消结束、不发布资产", async () => {
    const owner = installQuitOwner();
    const { projectRoot, fromUi, fromAgent, pids } = await startImportsFromBothDoors();
    owner.quit();
    expect(await owner.exited).toBe(0);
    // owner 调 app.exit 的这一刻：进程都没了，系统 tmp 里一个文件都没留（半成品、临时目录、源副本）。
    expect(pids.map(processGone)).toEqual([true, true]);
    expect(filesUnder(importTmp)).toEqual([]);
    expect(fs.readdirSync(importTmp)).toEqual([]);
    expect(owner.receipts).toContainEqual({ event: "quit-step", fields: expect.objectContaining({ step: "asset-import-transcode", outcome: "done" }) });
    expect(owner.receipts).toContainEqual({ event: "quit-exit", fields: expect.objectContaining({ reason: "completed" }) });
    await expect(fromUi).resolves.toMatchObject({ ok: false });
    expect(await fromAgent).toMatchObject({ code: "cancelled" });
    expect(filesUnder(projectRoot).filter((file) => /\.(mp4|avi)$/i.test(file))).toEqual([]);
  }, 60_000);

  it("Agent 收尾在等它的工具调用（正在转码的导入）：转码在 will-quit 那一刻就停，不排在 Agent 收尾后面", async () => {
    // 收尾链里 Agent 那一步排在必选排空项前面；它要等在途的导入落定才收得了尾。
    // 停转码若只挂在它后面，就互相等到 owner 的 3 秒期限，进程在 ffmpeg 还活着时被结束。
    let laneWaitsFor: Promise<unknown> = Promise.resolve();
    const owner = installQuitOwner({ disposeDesktopLaneIpc: async () => { await laneWaitsFor; } });
    const { fromUi, fromAgent, pids } = await startImportsFromBothDoors();
    laneWaitsFor = Promise.allSettled([fromUi, fromAgent]);
    owner.quit();
    expect(await owner.exited).toBe(0);
    expect(owner.receipts).toContainEqual({ event: "quit-exit", fields: expect.objectContaining({ reason: "completed" }) });
    expect(pids.map(processGone)).toEqual([true, true]);
    expect(fs.readdirSync(importTmp)).toEqual([]);
    await expect(fromUi).resolves.toMatchObject({ ok: false });
    expect(await fromAgent).toMatchObject({ code: "cancelled" });
  }, 60_000);

  it("退出开始以后，任何一扇门都不再起新的导入转码（连探测都不起）", async () => {
    expect(await stopVideoImportTranscodes()).toBe(0);
    await expect(transcodeFileToPlayableMp4IfNeeded(legacyAviPath, "legacy.avi", makeTempDir("nomi-import-lifecycle-closed-")))
      .rejects.toMatchObject({ code: "cancelled" });
    expect(harness.spawned).toEqual([]);
  }, 60_000);
});
