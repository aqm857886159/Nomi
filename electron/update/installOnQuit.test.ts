import { beforeEach, describe, expect, it, vi } from "vitest";
import { exitWithoutConfirmation, installQuitTeardown, quitStartProbeResult, registerQuitDrain, registerQuitStartProbe, resetQuitTeardownForTests } from "../quitTeardown";
import { createInstallOnQuit } from "./installOnQuit";

// 走真实的退出 owner（installQuitTeardown）：排空项是不是真的在 will-quit 里、在别的排空项之后、被调用，
// 不靠假的 registerDrain 自说自话。
type Listener = (event: { preventDefault: () => void }) => void;

function fakeApp() {
  const listeners = new Map<string, Listener>();
  const app = {
    on: vi.fn((event: string, listener: Listener) => { listeners.set(event, listener); return app; }),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return { app, emit: (event: "before-quit" | "will-quit") => listeners.get(event)?.({ preventDefault: vi.fn() }) };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function setup(installResult = true) {
  const order: string[] = [];
  const { app, emit } = fakeApp();
  installQuitTeardown(app as never, {
    disposeBackgroundLifecycle: () => { order.push("background"); },
    stopDesktopCapabilityCore: () => { order.push("core"); },
    abortAllActiveExports: () => 0,
    disposeDesktopLaneIpc: async () => { order.push("lane"); },
  });
  registerQuitDrain("startup-drain", () => { order.push("startup-drain"); });
  const install = vi.fn(() => { order.push("install"); return installResult; });
  const gate = createInstallOnQuit({ registerDrain: registerQuitDrain, install });
  return { app, emit, order, install, gate };
}

describe("退出时自动装更新（走退出 owner 的排空项）", () => {
  beforeEach(() => resetQuitTeardownForTests());

  it("同意 + 下好了：正常退出时装，而且排在启动期排空项和 Agent 通道收尾之后", async () => {
    const { app, emit, order, install, gate } = setup();
    gate.consent();
    gate.markDownloaded();
    emit("before-quit");
    emit("will-quit");
    await settle();
    expect(install).toHaveBeenCalledTimes(1);
    expect(order.at(-1)).toBe("install");
    expect(order.indexOf("lane")).toBeLessThan(order.indexOf("install"));
    expect(order.indexOf("startup-drain")).toBeLessThan(order.indexOf("install"));
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("没点下载（没同意）、或还没下好：退出什么都不装", async () => {
    const a = setup();
    a.emit("will-quit");
    await settle();
    expect(a.install).not.toHaveBeenCalled();

    resetQuitTeardownForTests();
    const b = setup();
    b.gate.consent();
    b.emit("will-quit");
    await settle();
    expect(b.install).not.toHaveBeenCalled();
    expect(b.app.exit).toHaveBeenCalled();
  });

  it("下载失败撤销同意：退出不装", async () => {
    const { emit, install, gate } = setup();
    gate.consent();
    gate.markDownloaded();
    gate.revoke();
    emit("will-quit");
    await settle();
    expect(install).not.toHaveBeenCalled();
  });

  it("连点「下载」只登记一次；用户已点「重启以更新」时退出排空项不重复装", async () => {
    const { emit, install, gate } = setup();
    gate.consent();
    gate.consent();
    gate.markDownloaded();
    gate.markInstallStarted();
    emit("will-quit");
    await settle();
    expect(install).not.toHaveBeenCalled();
  });

  it("起装包程序失败后撤销「已开始」：下次退出还会再试", async () => {
    const { emit, install, gate } = setup();
    gate.consent();
    gate.markDownloaded();
    gate.markInstallStarted();
    gate.markInstallFailed();
    emit("will-quit");
    await settle();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("系统关机 / 登出这类无人值守退出只跑关键排空项，不装更新", async () => {
    const { app, install, gate } = setup();
    gate.consent();
    gate.markDownloaded();
    exitWithoutConfirmation("session-end");
    await settle();
    expect(install).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalled();
  });

  it("装包程序没起来：排空项报失败，退出照常结束；「已开始」被原子撤回、「已下载」保留（还能再试）", async () => {
    const { app, emit, gate } = setup(false);
    gate.consent();
    gate.markDownloaded();
    emit("will-quit");
    await settle();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(gate.isDownloaded()).toBe(true);
    expect(gate.isArmed()).toBe(true);
  });

  it("装包程序抛错同样原子撤回「已开始」", async () => {
    const { emit, gate, install } = setup();
    install.mockImplementation(() => { throw new Error("spawn EACCES"); });
    gate.consent();
    gate.markDownloaded();
    emit("will-quit");
    await settle();
    expect(gate.isArmed()).toBe(true);
  });

  it("有活在跑（isBusy）：退出时不装，状态保留", async () => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app as never, {
      disposeBackgroundLifecycle: () => undefined,
      stopDesktopCapabilityCore: () => undefined,
      abortAllActiveExports: () => 0,
      disposeDesktopLaneIpc: async () => undefined,
    });
    const install = vi.fn(() => true);
    const gate = createInstallOnQuit({ registerDrain: registerQuitDrain, install, isBusy: () => true });
    gate.consent();
    gate.markDownloaded();
    emit("will-quit");
    await settle();
    expect(install).not.toHaveBeenCalled();
    expect(gate.isArmed()).toBe(true);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("退出开始时有导出在跑：owner 先 abort 导出（计数随即归零），更新排空项仍读到退出开始的快照 → 不装", async () => {
    const { app, emit } = fakeApp();
    const exportsRunning = { count: 1 };
    const order: string[] = [];
    installQuitTeardown(app as never, {
      disposeBackgroundLifecycle: () => undefined,
      stopDesktopCapabilityCore: () => undefined,
      // 和真实现一致：abort 之后计数在异步收尾里才变；这里最坏情形——abort 立刻让计数归零。
      abortAllActiveExports: () => { const aborted = exportsRunning.count; exportsRunning.count = 0; order.push("abort-exports"); return aborted; },
      disposeDesktopLaneIpc: async () => undefined,
    });
    registerQuitStartProbe("update-busy", () => exportsRunning.count > 0);
    const install = vi.fn(() => { order.push("install"); return true; });
    const gate = createInstallOnQuit({
      registerDrain: registerQuitDrain,
      install,
      isBusy: () => (quitStartProbeResult("update-busy") ?? false) || exportsRunning.count > 0,
    });
    gate.consent();
    gate.markDownloaded();
    emit("before-quit");
    emit("will-quit");
    await settle();
    expect(order).toEqual(["abort-exports"]);
    expect(install).not.toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("没有活在跑时快照为假，照常装（快照不会把正常退出变成永远不装）", async () => {
    const { app, emit } = fakeApp();
    installQuitTeardown(app as never, {
      disposeBackgroundLifecycle: () => undefined,
      stopDesktopCapabilityCore: () => undefined,
      abortAllActiveExports: () => 0,
      disposeDesktopLaneIpc: async () => undefined,
    });
    registerQuitStartProbe("update-busy", () => false);
    const install = vi.fn(() => true);
    const gate = createInstallOnQuit({ registerDrain: registerQuitDrain, install, isBusy: () => quitStartProbeResult("update-busy") ?? false });
    gate.consent();
    gate.markDownloaded();
    emit("before-quit");
    emit("will-quit");
    await settle();
    expect(install).toHaveBeenCalledTimes(1);
  });
});
