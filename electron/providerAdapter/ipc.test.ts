import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

// 已加固通道（assertTrustedSender）只认「当前登记的主窗口主帧」，
// 所以测试要先立一个假主窗口，再用 trustedEvent 当事件传进 handler。
const harness = vi.hoisted(() => {
  const MAIN_FRAME_ROUTING_ID = 7;
  const APP_ENTRY_URL = "file:///app/index.html";
  const byContents = new Map<object, object>();
  class FakeBrowserWindow {
    readonly webContents: { mainFrame: { routingId: number }; isDestroyed(): boolean; getURL(): string };
    constructor() {
      this.webContents = {
        mainFrame: { routingId: MAIN_FRAME_ROUTING_ID },
        isDestroyed: () => false,
        getURL: () => APP_ENTRY_URL,
      };
      byContents.set(this.webContents, this);
    }
    isDestroyed(): boolean {
      return false;
    }
    static fromWebContents(contents: object): object | null {
      return byContents.get(contents) ?? null;
    }
  }
  return { FakeBrowserWindow, MAIN_FRAME_ROUTING_ID, APP_ENTRY_URL };
});

vi.mock("electron", () => ({
  BrowserWindow: harness.FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler),
  },
}));

import { registerProviderAdapterIpc } from "./ipc";
import { setMainWindow } from "../mainWindowRegistry";

/** 立一个假主窗口并返回它发来的合法事件（未登记主窗口时守卫一律拒绝）。 */
function trustedEvent(): { sender: unknown; senderFrame: unknown } {
  const win = new harness.FakeBrowserWindow();
  setMainWindow(win as never);
  return {
    sender: win.webContents,
    senderFrame: { routingId: harness.MAIN_FRAME_ROUTING_ID, url: harness.APP_ENTRY_URL },
  };
}

describe("registerProviderAdapterIpc", () => {
  beforeEach(() => handlers.clear());

  it("exposes register/start/get/latest/cancel/list without returning credentials", async () => {
    const run = {
      id: "run-1",
      vendorKey: "example-com",
      stage: "queued",
      connectionFingerprint: "sha256-derived-from-secret",
    };
    const publicRun = { id: "run-1", vendorKey: "example-com", stage: "queued" };
    const registration = {
      vendorKey: "example-com",
      vendorName: "Example",
      state: "configured",
      selectedModelKeys: ["paint-v2"],
      models: [{ modelKey: "paint-v2", kind: "image", state: "unverified" }],
      savedAt: "2026-08-15T00:00:00.000Z",
    };
    const service = {
      register: vi.fn(() => registration),
      start: vi.fn(() => run),
      getRun: vi.fn(() => run),
      latestRun: vi.fn(() => run),
      cancel: vi.fn(() => ({ ...run, stage: "cancelled" })),
      listRuns: vi.fn(() => [run]),
      resumeInterrupted: vi.fn(),
    };
    registerProviderAdapterIpc(service as never);

    const registered = await handlers.get("nomi:provider-adapter:register")?.(trustedEvent(), {
      vendorName: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret",
      catalogVendorKey: "renderer-cannot-choose-this",
      preserveExistingCredential: true,
      models: [{ modelKey: "paint-v2", kind: "image" }],
    });
    const started = await handlers.get("nomi:provider-adapter:start")?.(trustedEvent(), {
      vendorName: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret",
      models: [{ modelKey: "paint-v2", kind: "image" }],
    });
    const fetched = await handlers.get("nomi:provider-adapter:get")?.(trustedEvent(), { runId: "run-1" });
    const latest = await handlers.get("nomi:provider-adapter:latest")?.(trustedEvent(), { vendorKey: "example-com" });
    const cancelled = await handlers.get("nomi:provider-adapter:cancel")?.(trustedEvent(), { runId: "run-1" });
    const listed = await handlers.get("nomi:provider-adapter:list")?.(trustedEvent(), { vendorKey: "example-com", activeOnly: true, limit: 5 });

    expect(registered).toEqual({ ok: true, registration });
    expect(service.register).toHaveBeenCalledWith(expect.not.objectContaining({
      catalogVendorKey: expect.anything(),
      preserveExistingCredential: expect.anything(),
    }));
    expect(started).toEqual({ ok: true, run: publicRun });
    expect(JSON.stringify(registered)).not.toContain("sk-secret");
    expect(JSON.stringify(started)).not.toContain("sk-secret");
    expect(fetched).toEqual({ ok: true, run: publicRun });
    expect(latest).toEqual({ ok: true, run: publicRun });
    expect(cancelled).toEqual({ ok: true, run: { ...publicRun, stage: "cancelled" } });
    expect(listed).toEqual({ ok: true, runs: [publicRun] });
    expect(JSON.stringify([started, fetched, latest, cancelled, listed])).not.toContain("connectionFingerprint");
    expect(JSON.stringify([started, fetched, latest, cancelled, listed])).not.toContain("sha256-derived-from-secret");
    expect(service.listRuns).toHaveBeenCalledWith({ vendorKey: "example-com", activeOnly: true, limit: 5 });
    expect(service.resumeInterrupted).toHaveBeenCalledTimes(1);
  });
});
