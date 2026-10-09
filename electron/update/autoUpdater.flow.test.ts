import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 更新流程的主进程接线：真实的 autoUpdater.ts + 真实的退出 owner + 真实的提醒记忆文件，
// 只假 electron / electron-updater。验证「点下载 = 同意 → 退出时装」「连点只下一次」
// 「失败后重试直接重下」「快照给晚挂载的窗口」这些用户动作链，而不是各个零件。
type Handler = (event: unknown, payload?: unknown) => unknown;
type QuitListener = (event: { preventDefault: () => void }) => void;

const NOTES_HTML = "<h1>Nomi v0.24.0 — 新版标题</h1><h2>组</h2><ul><li><strong>短语</strong>：说明</li></ul><h2>What changed</h2><p>New headline</p><ul><li><strong>Phrase</strong>: detail</li></ul>";

let root = "";
const mainBusy = { value: false };

async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

async function load(options: { version?: string } = {}) {
  vi.resetModules();
  const handlers = new Map<string, Handler>();
  const sent: Array<Record<string, unknown>> = [];
  const quitListeners = new Map<string, QuitListener>();
  const electronApp = {
    isPackaged: true,
    getName: () => "Nomi",
    getVersion: () => options.version ?? "0.23.1",
    on: vi.fn((event: string, listener: QuitListener) => { quitListeners.set(event, listener); return electronApp; }),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn<() => Promise<unknown>>(async () => undefined),
    quitAndInstall: vi.fn(),
    install: vi.fn(() => true),
  });
  vi.doMock("electron", () => ({
    app: electronApp,
    BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_c: string, p: Record<string, unknown>) => sent.push(p) } }] },
    ipcMain: { handle: vi.fn((channel: string, handler: Handler) => { handlers.set(channel, handler); }) },
    shell: { openExternal: vi.fn(async () => undefined) },
  }));
  vi.doMock("electron-updater", () => ({ autoUpdater: updater }));
  vi.doMock("../i18n", () => ({ desktopT: (key: string) => key }));
  vi.doMock("../ipcSenderGuard", () => ({ assertTrustedSender: vi.fn() }));
  vi.doMock("../telemetry/telemetryOutbox", () => ({ recordTelemetryEvent: vi.fn() }));
  vi.doMock("../backgroundLaunch", () => ({ hasInFlightProductionWork: () => mainBusy.value }));
  vi.doMock("../settings/settingsRoot", () => ({ getSettingsRoot: () => root }));
  const owner = await import("../quitTeardown");
  owner.installQuitTeardown(electronApp as never, {
    disposeBackgroundLifecycle: () => undefined,
    stopDesktopCapabilityCore: () => undefined,
    abortAllActiveExports: () => 0,
    disposeDesktopLaneIpc: async () => undefined,
  });
  const mod = await import("./autoUpdater");
  mod.registerUpdaterIpc();
  const sender = { id: 1, once: vi.fn() };
  const call = async (channel: string, payload?: unknown) => handlers.get(channel)?.({ sender }, payload);
  // 渲染层挂载就会报一次任务数（没报过的窗口，主进程按忙算）。
  const reportBusy = (count: number) => call("nomi:update:report-busy", count);
  const announceAvailable = async () => {
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("checking-for-update");
      updater.emit("update-available", { version: "0.24.0", releaseNotes: [{ version: "0.24.0", note: NOTES_HTML }], files: [{ url: "Nomi-Setup.exe", size: 90 * 1024 * 1024 }] });
    });
    await call("nomi:update:check");
  };
  const quit = async () => {
    quitListeners.get("before-quit")?.({ preventDefault: vi.fn() });
    quitListeners.get("will-quit")?.({ preventDefault: vi.fn() });
    await flush();
  };
  return { call, updater, sent, announceAvailable, quit, electronApp, reportBusy, mod };
}

describe("更新流程：下载 → 退出时装 / 重启装 / 失败重试", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-update-flow-"));
    vi.stubEnv("NOMI_E2E", "");
    mainBusy.value = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("晚打开的窗口用快照拿到已发现的新版（含两种语言的摘要、安装包大小、完整说明地址）", async () => {
    const { call, announceAvailable } = await load();
    await announceAvailable();
    const snapshot = await call("nomi:update:snapshot") as { state: Record<string, unknown>; memory: unknown };
    expect(snapshot.state).toMatchObject({ phase: "available", latestVersion: "0.24.0", sizeBytes: 90 * 1024 * 1024, releaseUrl: "https://github.com/aqm857886159/Nomi/releases/tag/v0.24.0" });
    expect((snapshot.state.notes as Array<{ en: { title: string } }>)[0].en.title).toBe("New headline");
  });

  it("点「下载更新」= 同意：下好后正常退出时装好（静默、不自动重开）；连点只下一次", async () => {
    const { call, updater, announceAvailable, quit, electronApp } = await load();
    await announceAvailable();
    let finishDownload: () => void = () => undefined;
    updater.downloadUpdate.mockImplementation(() => new Promise<void>((resolve) => { finishDownload = resolve; }));
    const first = call("nomi:update:download");
    const second = await call("nomi:update:download");
    expect(second).toEqual({ ok: true });
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    updater.emit("download-progress", { percent: 55.4 });
    updater.emit("update-downloaded", { version: "0.24.0" });
    finishDownload();
    await first;
    expect((await call("nomi:update:snapshot") as { state: { phase: string } }).state.phase).toBe("downloaded");
    await quit();
    expect(updater.install).toHaveBeenCalledTimes(1);
    expect(updater.install).toHaveBeenCalledWith(true, false);
    expect(electronApp.exit).toHaveBeenCalledWith(0);
  });

  it("没点下载就退出：什么都不装", async () => {
    const { updater, announceAvailable, quit } = await load();
    await announceAvailable();
    await quit();
    expect(updater.install).not.toHaveBeenCalled();
  });

  it("下载失败：错误带上「哪一步 + 是不是网络」，状态保留新版信息；重试一次点击就重下，成功后退出才装", async () => {
    const { call, updater, announceAvailable, quit } = await load();
    await announceAvailable();
    updater.downloadUpdate.mockImplementationOnce(async () => {
      const error = Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" });
      updater.emit("error", error);
      throw error;
    });
    expect(await call("nomi:update:download")).toEqual({ ok: false });
    const failed = (await call("nomi:update:snapshot") as { state: Record<string, unknown> }).state;
    expect(failed).toMatchObject({ phase: "error", errorStage: "download", errorReason: "offline", latestVersion: "0.24.0" });
    await quit();
    expect(updater.install).not.toHaveBeenCalled(); // 失败撤销了同意

    // 重试 = 直接再下载（不先重新检查）
    updater.downloadUpdate.mockImplementation(async () => { updater.emit("update-downloaded", { version: "0.24.0" }); });
    expect(await call("nomi:update:download")).toEqual({ ok: true });
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2);
  });

  it("「重启以更新」：没下好不装；下好后只触发一次；随后的退出不再重复装", async () => {
    const { call, updater, announceAvailable, quit, reportBusy } = await load();
    await reportBusy(0);
    await announceAvailable();
    expect(await call("nomi:update:install")).toEqual({ ok: false });
    updater.downloadUpdate.mockImplementation(async () => { updater.emit("update-downloaded", { version: "0.24.0" }); });
    await call("nomi:update:download");
    expect(await call("nomi:update:install")).toEqual({ ok: true });
    expect(await call("nomi:update:install")).toEqual({ ok: false });
    await flush();
    await new Promise((resolve) => setImmediate(resolve));
    await flush();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    await quit();
    expect(updater.install).not.toHaveBeenCalled();
  });

  it("热修横幅 ✕ 被主进程记住（快照里带着）", async () => {
    const { call } = await load();
    await call("nomi:update:dismiss", { kind: "banner", version: "0.23.2" });
    expect((await call("nomi:update:snapshot") as { memory: { dismissedBanners: string[] } }).memory.dismissedBanners).toEqual(["0.23.2"]);
    expect(await call("nomi:update:dismiss", { kind: "nope" })).toBeNull();
  });

  describe("有任务在跑就不打断（判断只在主进程，判不准就拦）", () => {
    async function downloaded() {
      const ctx = await load();
      await ctx.announceAvailable();
      ctx.updater.downloadUpdate.mockImplementation(async () => { ctx.updater.emit("update-downloaded", { version: "0.24.0" }); });
      await ctx.call("nomi:update:download");
      return ctx;
    }
    const settleInstall = async () => { await flush(); await new Promise((resolve) => setImmediate(resolve)); await flush(); };

    it("画布里排队中（queued）的节点：渲染层报了 2 个，立即重启被拒绝；清零后才放行", async () => {
      const { call, updater, reportBusy } = await downloaded();
      await reportBusy(2);
      expect(await call("nomi:update:install")).toEqual({ ok: false, reason: "busy" });
      await settleInstall();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      await reportBusy(0);
      expect(await call("nomi:update:install")).toEqual({ ok: true });
      await settleInstall();
      expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
    });

    it("只存在于主进程的任务（任务缓存里的异步生成 / 制作流程 Run / 导出）：渲染层报 0 也拒绝", async () => {
      const { call, updater, reportBusy } = await downloaded();
      await reportBusy(0);
      mainBusy.value = true;
      expect(await call("nomi:update:install")).toEqual({ ok: false, reason: "busy" });
      await settleInstall();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
    });

    it("没报过数的窗口（主进程不知道它那边有没有活）按忙算", async () => {
      const { call, updater } = await downloaded();
      expect(await call("nomi:update:install")).toEqual({ ok: false, reason: "busy" });
      await settleInstall();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
    });

    it("退出时安装同理：有活在跑就不装，退出照常结束", async () => {
      const { updater, quit, reportBusy, electronApp } = await downloaded();
      await reportBusy(0);
      mainBusy.value = true;
      await quit();
      expect(updater.install).not.toHaveBeenCalled();
      expect(electronApp.exit).toHaveBeenCalledWith(0);
    });
  });

  describe("安装失败后重试要真生效", () => {
    it("点「重启以更新」装失败 → 状态进 error(install) 但保留已下载 → 再点一次真的重新安装", async () => {
      const { call, updater, announceAvailable, reportBusy } = await load();
      await reportBusy(0);
      await announceAvailable();
      updater.downloadUpdate.mockImplementation(async () => { updater.emit("update-downloaded", { version: "0.24.0" }); });
      await call("nomi:update:download");
      updater.quitAndInstall.mockImplementationOnce(() => { updater.emit("error", new Error("spawn EACCES")); });
      expect(await call("nomi:update:install")).toEqual({ ok: true });
      await flush(); await new Promise((resolve) => setImmediate(resolve)); await flush();
      const failed = (await call("nomi:update:snapshot") as { state: Record<string, unknown> }).state;
      expect(failed).toMatchObject({ phase: "error", errorStage: "install" });
      expect(await call("nomi:update:install")).toEqual({ ok: true });
      await flush(); await new Promise((resolve) => setImmediate(resolve)); await flush();
      expect(updater.quitAndInstall).toHaveBeenCalledTimes(2);
    });

    it("退出时装失败 → 库的「已调用」旗被复位，已下载状态保留，之后的重试不会被库自己忽略", async () => {
      const { updater, announceAvailable, call, quit, reportBusy } = await load();
      await reportBusy(0);
      await announceAvailable();
      updater.downloadUpdate.mockImplementation(async () => { updater.emit("update-downloaded", { version: "0.24.0" }); });
      await call("nomi:update:download");
      Object.assign(updater, { quitAndInstallCalled: true });
      updater.install.mockImplementationOnce(() => { throw new Error("spawn EACCES"); });
      await quit();
      expect((updater as unknown as { quitAndInstallCalled: boolean }).quitAndInstallCalled).toBe(false);
      expect((await call("nomi:update:snapshot") as { state: { phase: string } }).state.phase).toBe("downloaded");
    });
  });

  describe("装包程序异步起不来：进程退出后「同意 + 已下载」不丢，下个进程退出时再试", () => {
    const AFTER_START = 30_000;

    /** 第一个进程：同意并下载好，退出时装；装包程序 spawn 之后才异步报错（真实 NsisUpdater 就是这样：doInstall 先返回 true）。 */
    async function firstProcessThatFailsToInstall(cachedFile: string) {
      const first = await load();
      await first.reportBusy(0);
      await first.announceAvailable();
      first.updater.downloadUpdate.mockImplementation(async () => {
        first.updater.emit("update-downloaded", { version: "0.24.0", downloadedFile: cachedFile });
      });
      await first.call("nomi:update:download");
      first.updater.install.mockImplementation(() => {
        setImmediate(() => first.updater.emit("error", new Error("spawn EACCES")));
        return true;
      });
      await first.quit();
      expect(first.updater.install).toHaveBeenCalledTimes(1);
      return first;
    }

    function cacheFile(): string {
      const file = path.join(root, "Nomi-Setup-0.24.0.exe");
      fs.writeFileSync(file, "installer");
      return file;
    }

    it("新进程：版本仍低于目标、缓存包还在 → 界面显示「上次没装上」，核对缓存后退出时再次尝试安装", async () => {
      await firstProcessThatFailsToInstall(cacheFile());
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      try {
        const second = await load();
        (second.updater.checkForUpdates as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ updateInfo: { version: "0.24.0" } });
        second.updater.downloadUpdate.mockImplementation(async () => {
          second.updater.emit("update-downloaded", { version: "0.24.0", downloadedFile: path.join(root, "Nomi-Setup-0.24.0.exe") });
        });
        second.mod.startAutoUpdateCheck();
        const restored = (await second.call("nomi:update:snapshot") as { state: Record<string, unknown> }).state;
        expect(restored).toMatchObject({ phase: "error", errorStage: "install", latestVersion: "0.24.0" });
        await vi.advanceTimersByTimeAsync(AFTER_START);
        await flush();
        expect(second.updater.downloadUpdate).toHaveBeenCalledTimes(1); // 核对缓存走库自己的 check + downloadUpdate
        await second.quit();
        expect(second.updater.install).toHaveBeenCalledTimes(1);
        expect(second.updater.install).toHaveBeenCalledWith(true, false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("新进程里点一次「重试」：先核对缓存包，再真的重新安装（不用等 30 秒、不用重新下载）", async () => {
      await firstProcessThatFailsToInstall(cacheFile());
      const second = await load();
      (second.updater.checkForUpdates as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ updateInfo: { version: "0.24.0" } });
      second.updater.downloadUpdate.mockImplementation(async () => {
        second.updater.emit("update-downloaded", { version: "0.24.0", downloadedFile: path.join(root, "Nomi-Setup-0.24.0.exe") });
      });
      second.mod.startAutoUpdateCheck();
      await second.reportBusy(0);
      expect(await second.call("nomi:update:install")).toEqual({ ok: true });
      await flush(); await new Promise((resolve) => setImmediate(resolve)); await flush();
      expect(second.updater.quitAndInstall).toHaveBeenCalledTimes(1);
    });

    it("版本已经是目标版本（上次其实装上了）：记录被清掉，不出「没装上」，退出也不再装", async () => {
      await firstProcessThatFailsToInstall(cacheFile());
      const second = await load({ version: "0.24.0" });
      second.mod.startAutoUpdateCheck();
      expect((await second.call("nomi:update:snapshot") as { state: { phase: string } }).state.phase).toBe("idle");
      expect(JSON.parse(fs.readFileSync(path.join(root, "update-reminder.json"), "utf8")).pendingInstall).toBeNull();
      await second.quit();
      expect(second.updater.install).not.toHaveBeenCalled();
    });

    it("缓存包已经不在：不撒谎，记录清掉、界面保持空闲", async () => {
      const file = cacheFile();
      await firstProcessThatFailsToInstall(file);
      fs.rmSync(file);
      const second = await load();
      second.mod.startAutoUpdateCheck();
      expect((await second.call("nomi:update:snapshot") as { state: { phase: string } }).state.phase).toBe("idle");
      expect(JSON.parse(fs.readFileSync(path.join(root, "update-reminder.json"), "utf8")).pendingInstall).toBeNull();
    });
  });
});
