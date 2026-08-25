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

import { assertTrustedSender, UntrustedIpcSenderError } from "./ipcSenderGuard";
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
