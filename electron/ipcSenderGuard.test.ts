import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  class FakeWebContents {
    readonly id: number;
    readonly mainFrame = { routingId: 7 };
    destroyed = false;
    url = "file:///app/index.html";

    constructor(id: number) {
      this.id = id;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    getURL(): string {
      return this.url;
    }
  }

  class FakeBrowserWindow {
    static byContents = new Map<FakeWebContents, FakeBrowserWindow>();
    readonly webContents: FakeWebContents;
    destroyed = false;

    constructor(id: number) {
      this.webContents = new FakeWebContents(id);
      FakeBrowserWindow.byContents.set(this.webContents, this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null {
      return FakeBrowserWindow.byContents.get(contents) ?? null;
    }
  }

  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({ BrowserWindow: harness.FakeBrowserWindow }));

import { assertTrustedSender, assertTrustedUiSender, UntrustedIpcSenderError } from "./ipcSenderGuard";
import { setMainWindow } from "./mainWindowRegistry";

afterEach(() => setMainWindow(null));

function eventFor(sender: InstanceType<typeof harness.FakeBrowserWindow>, frame = sender.webContents.mainFrame) {
  return { sender: sender.webContents, senderFrame: { ...frame, url: sender.webContents.getURL() } } as never;
}

describe("IPC sender guard", () => {
  it("accepts only the registered main window main frame with matching origin", () => {
    const main = new harness.FakeBrowserWindow(1);
    setMainWindow(main as never);
    expect(() => assertTrustedSender(eventFor(main))).not.toThrow();
  });

  it("rejects a different BrowserWindow even when it has the same origin", () => {
    const main = new harness.FakeBrowserWindow(1);
    const foreign = new harness.FakeBrowserWindow(2);
    setMainWindow(main as never);
    expect(() => assertTrustedSender(eventFor(foreign))).toThrow(UntrustedIpcSenderError);
  });

  it("rejects a child frame or origin drift", () => {
    const main = new harness.FakeBrowserWindow(1);
    setMainWindow(main as never);
    expect(() => assertTrustedSender(eventFor(main, { routingId: 8 }))).toThrow(UntrustedIpcSenderError);
    expect(() =>
      assertTrustedSender({
        sender: main.webContents,
        senderFrame: { routingId: 7, url: "https://evil.example/" },
      } as never),
    ).toThrow(UntrustedIpcSenderError);
  });
});

describe("IPC UI sender guard (in-app browser control channels)", () => {
  it("accepts the app's own browser surfaces beyond the main window", () => {
    // 叠加窗 / 浏览器菜单窗是我们自己建、带 preload 的独立 BrowserWindow，
    // 它们合法驱动 browser:* 通道；主窗口专用守卫会直接把在应用内浏览器打死。
    const main = new harness.FakeBrowserWindow(1);
    const overlay = new harness.FakeBrowserWindow(2);
    setMainWindow(main as never);
    expect(() => assertTrustedUiSender(eventFor(main))).not.toThrow();
    expect(() => assertTrustedUiSender(eventFor(overlay))).not.toThrow();
    // 而主窗口专用守卫仍然只认主窗口——两条规则是不同的闸，不是同一条的别名。
    expect(() => assertTrustedSender(eventFor(overlay))).toThrow(UntrustedIpcSenderError);
  });

  it("rejects remote content: non-file origin and sub-frames", () => {
    const remote = new harness.FakeBrowserWindow(3);
    remote.webContents.url = "https://evil.example/page";
    // 远端页面即使被 BrowserWindow.fromWebContents 归到某个宿主窗口，origin 也过不了 file:// 这关。
    expect(() =>
      assertTrustedUiSender({
        sender: remote.webContents,
        senderFrame: { routingId: 7, url: "https://evil.example/page" },
      } as never),
    ).toThrow(UntrustedIpcSenderError);
    // 应用内的 iframe 子帧同样不算：routingId 必须是该窗口的主帧。
    const app = new harness.FakeBrowserWindow(4);
    expect(() => assertTrustedUiSender(eventFor(app, { routingId: 99 }))).toThrow(UntrustedIpcSenderError);
  });

  it("rejects a sender that belongs to no BrowserWindow (a bare WebContentsView)", () => {
    // 应用内浏览器的远端页面就是这种：WebContentsView 无 preload、不隶属任何窗口的 webContents。
    const orphan = { id: 42, mainFrame: { routingId: 7 }, isDestroyed: () => false, getURL: () => "file:///x" };
    expect(() =>
      assertTrustedUiSender({ sender: orphan, senderFrame: { routingId: 7, url: "file:///x" } } as never),
    ).toThrow(UntrustedIpcSenderError);
  });
});
