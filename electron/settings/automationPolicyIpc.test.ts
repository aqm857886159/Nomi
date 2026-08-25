import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

const harness = vi.hoisted(() => {
  class FakeWebContents {
    readonly mainFrame = { routingId: 7 };
    url = "file:///app/index.html";
    isDestroyed(): boolean {
      return false;
    }
    getURL(): string {
      return this.url;
    }
  }
  class FakeBrowserWindow {
    static byContents = new Map<FakeWebContents, FakeBrowserWindow>();
    readonly webContents = new FakeWebContents();
    constructor() {
      FakeBrowserWindow.byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean {
      return false;
    }
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null {
      return FakeBrowserWindow.byContents.get(contents) ?? null;
    }
  }
  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({
  BrowserWindow: harness.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerAutomationPolicyIpc } from "./automationPolicyIpc";
import { setMainWindow } from "../mainWindowRegistry";

const GET = "nomi:settings:automation-policy-get";
const SET = "nomi:settings:automation-policy-set";

/** 主窗口发来的事件（唯一被信任的来源）。 */
function trustedEvent(win: InstanceType<typeof harness.FakeBrowserWindow>) {
  return { sender: win.webContents, senderFrame: { routingId: 7, url: win.webContents.getURL() } };
}

describe("automation policy IPC", () => {
  let mainWindow: InstanceType<typeof harness.FakeBrowserWindow>;

  beforeEach(() => {
    handlers.clear();
    harness.FakeBrowserWindow.byContents.clear();
    mainWindow = new harness.FakeBrowserWindow();
    setMainWindow(mainWindow as never);
  });

  it("registers read and write handlers", () => {
    const store = { read: vi.fn(() => ({ mode: "balanced" })), write: vi.fn((value) => value) };
    registerAutomationPolicyIpc(store as never);
    expect([...handlers.keys()]).toEqual([GET, SET]);
  });

  it("returns the durable value produced by the settings store", async () => {
    const stored = { mode: "balanced", trustedHosts: ["nomi", "codex"] };
    const store = { read: vi.fn(() => stored), write: vi.fn(() => stored) };
    registerAutomationPolicyIpc(store as never);

    expect(await handlers.get(GET)?.(trustedEvent(mainWindow))).toEqual(stored);
    expect(await handlers.get(SET)?.(trustedEvent(mainWindow), { mode: "policy-auto" })).toEqual(stored);
    expect(store.write).toHaveBeenCalledWith({ mode: "policy-auto" });
  });

  // —— 权限升级链的回归（PR#174 安全跟进）——
  // 这两条通道写的是 anonymousAssetHosting 同意策略。若应用内浏览器里的远端页面能把它改成
  // "allow"，素材托管的同意卡就不再弹，本地素材会无声上传公网托管——正好把同意机制架空。
  describe("sender binding", () => {
    it("refuses a remote page trying to silence the hosting-consent card", async () => {
      const store = { read: vi.fn(() => ({})), write: vi.fn((value) => value) };
      registerAutomationPolicyIpc(store as never);
      const remote = {
        id: 99,
        mainFrame: { routingId: 7 },
        isDestroyed: () => false,
        getURL: () => "https://evil.example/",
      };
      const remoteEvent = { sender: remote, senderFrame: { routingId: 7, url: "https://evil.example/" } };

      await expect(handlers.get(SET)?.(remoteEvent, { anonymousAssetHosting: "allow" })).rejects.toThrow(
        /不是 Nomi 主窗口/,
      );
      await expect(handlers.get(GET)?.(remoteEvent)).rejects.toThrow(/不是 Nomi 主窗口/);
      // 关键断言：策略一个字都没被写进去，不是「写了但记了条日志」。
      expect(store.write).not.toHaveBeenCalled();
    });

    it("refuses another app window that merely shares the local origin", async () => {
      const store = { read: vi.fn(() => ({})), write: vi.fn((value) => value) };
      registerAutomationPolicyIpc(store as never);
      const otherWindow = new harness.FakeBrowserWindow();

      await expect(
        handlers.get(SET)?.(trustedEvent(otherWindow), { anonymousAssetHosting: "allow" }),
      ).rejects.toThrow(/不是 Nomi 主窗口/);
      expect(store.write).not.toHaveBeenCalled();
    });
  });
});
