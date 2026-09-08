import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  let nextId = 1;

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
    readonly id: number;
    readonly webContents: FakeWebContents;
    destroyed = false;
    private readonly closedListeners: Array<() => void> = [];

    constructor(url?: string) {
      this.id = nextId++;
      this.webContents = new FakeWebContents(this.id);
      if (url) this.webContents.url = url;
      FakeBrowserWindow.byContents.set(this.webContents, this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
    once(event: string, listener: () => void): void {
      if (event === "closed") this.closedListeners.push(listener);
    }
    close(): void {
      this.destroyed = true;
      for (const listener of this.closedListeners) listener();
    }
    static fromWebContents(contents: FakeWebContents): FakeBrowserWindow | null {
      return FakeBrowserWindow.byContents.get(contents) ?? null;
    }
  }

  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({ BrowserWindow: harness.FakeBrowserWindow }));

import { assertTrustedSender, assertTrustedUiSender, UntrustedIpcSenderError } from "./ipcSenderGuard";
import { registerAppWindow, setMainWindow } from "./appWindowRegistry";

afterEach(() => setMainWindow(null));

type Win = InstanceType<typeof harness.FakeBrowserWindow>;

function eventFor(sender: Win, frame: { routingId: number } = sender.webContents.mainFrame) {
  return { sender: sender.webContents, senderFrame: { ...frame, url: sender.webContents.getURL() } } as never;
}

function mainWindow(url = "file:///app/index.html"): Win {
  const win = new harness.FakeBrowserWindow(url);
  setMainWindow(win as never);
  return win;
}

function appSurface(url: string): Win {
  const win = new harness.FakeBrowserWindow(url);
  registerAppWindow(win as never, "app-surface", url);
  return win;
}

describe("IPC sender guard — 主窗口专属面", () => {
  it("只放行已登记主窗口的主帧", () => {
    const main = mainWindow();
    expect(() => assertTrustedSender(eventFor(main))).not.toThrow();
  });

  it("同 origin 的另一个窗口也不算主窗口", () => {
    const main = mainWindow();
    const foreign = appSurface("file:///app/index.html");
    expect(() => assertTrustedSender(eventFor(main))).not.toThrow();
    expect(() => assertTrustedSender(eventFor(foreign))).toThrow(UntrustedIpcSenderError);
  });

  it("子帧与 origin 漂移都拒绝", () => {
    const main = mainWindow();
    expect(() => assertTrustedSender(eventFor(main, { routingId: 8 }))).toThrow(UntrustedIpcSenderError);
    expect(() =>
      assertTrustedSender({
        sender: main.webContents,
        senderFrame: { routingId: 7, url: "https://evil.example/" },
      } as never),
    ).toThrow(UntrustedIpcSenderError);
  });
});

describe("IPC sender guard — Nomi 自有 UI 面", () => {
  it("放行主窗口与已登记的辅助窗（素材盒浮层）", () => {
    const main = mainWindow();
    const overlay = appSurface("file:///app/index.html?nomiOverlay=browserAsset#/browser-asset-overlay");
    expect(() => assertTrustedUiSender(eventFor(main))).not.toThrow();
    expect(() => assertTrustedUiSender(eventFor(overlay))).not.toThrow();
    // 两条闸不是别名：辅助窗仍拿不到主窗口专属面。
    expect(() => assertTrustedSender(eventFor(overlay))).toThrow(UntrustedIpcSenderError);
  });

  it("data: 入口的 chrome 菜单窗也放行（回归：旧守卫写死 file:// 把它整个打死）", () => {
    const menu = appSurface("data:text/html;charset=utf-8,%3Cbutton%3EAlpha%3C/button%3E");
    expect(() => assertTrustedUiSender(eventFor(menu))).not.toThrow();
  });

  it("dev 模式渲染层跑 http 时，主窗口仍拿得到 UI 面（回归：写死 file:// 会误伤自己）", () => {
    const main = mainWindow("http://127.0.0.1:5273/#/studio");
    expect(() => assertTrustedUiSender(eventFor(main))).not.toThrow();
    expect(() => assertTrustedSender(eventFor(main))).not.toThrow();
  });

  it("没登记的窗口一条都拿不到（fail-closed）", () => {
    const stray = new harness.FakeBrowserWindow("file:///app/index.html");
    expect(() => assertTrustedUiSender(eventFor(stray))).toThrow(UntrustedIpcSenderError);
    expect(() => assertTrustedSender(eventFor(stray))).toThrow(UntrustedIpcSenderError);
  });

  it("登记成 untrusted 的窗口（ComfyUI 转换窗）拿不到任何一档", () => {
    const converter = new harness.FakeBrowserWindow("http://127.0.0.1:8188/");
    registerAppWindow(converter as never, "untrusted", "http://127.0.0.1:8188/");
    expect(() => assertTrustedUiSender(eventFor(converter))).toThrow(UntrustedIpcSenderError);
    expect(() => assertTrustedSender(eventFor(converter))).toThrow(UntrustedIpcSenderError);
  });

  it("辅助窗被导航去别的 origin 后立刻失去权限", () => {
    const overlay = appSurface("file:///app/index.html#/browser-asset-overlay");
    overlay.webContents.url = "https://evil.example/page";
    expect(() => assertTrustedUiSender(eventFor(overlay))).toThrow(UntrustedIpcSenderError);
  });

  it("远端网页够不到：既非主帧，也不隶属任何已登记窗口", () => {
    const overlay = appSurface("file:///app/index.html#/browser-asset-overlay");
    // 应用内的 iframe 子帧不算。
    expect(() => assertTrustedUiSender(eventFor(overlay, { routingId: 99 }))).toThrow(UntrustedIpcSenderError);
    // 应用内浏览器的远端页面：无 preload 的 WebContentsView，不隶属任何 BrowserWindow。
    const orphan = { id: 42, mainFrame: { routingId: 7 }, isDestroyed: () => false, getURL: () => "file:///x" };
    expect(() =>
      assertTrustedUiSender({ sender: orphan, senderFrame: { routingId: 7, url: "file:///x" } } as never),
    ).toThrow(UntrustedIpcSenderError);
  });

  it("窗口关闭后自动注销，权限不残留", () => {
    const overlay = appSurface("file:///app/index.html#/browser-asset-overlay");
    expect(() => assertTrustedUiSender(eventFor(overlay))).not.toThrow();
    overlay.close();
    expect(() => assertTrustedUiSender(eventFor(overlay))).toThrow(UntrustedIpcSenderError);
  });
});
