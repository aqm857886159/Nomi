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

  it("exposes only canonical configure/start/get/cancel/list/delete without returning credentials", async () => {
    const run = {
      id: "run-1",
      vendorKey: "example-com",
      vendorName: "Example",
      selectedModelKeys: ["paint-v2"],
      stage: "queued",
      repairAttempt: 0,
      models: [],
      sourceUrls: [],
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z",
      schemaVersion: 1,
      kind: "http-api-provider",
      childRunRef: { runId: "run-1", revisionDigest: "a".repeat(64) },
    };
    const registration = {
      vendorKey: "example-com",
      vendorName: "Example",
      state: "configured",
      selectedModelKeys: ["paint-v2"],
      models: [{ modelKey: "paint-v2", kind: "image", state: "unverified" }],
      savedAt: "2026-08-15T00:00:00.000Z",
    };
    const service = {
      configureHttpConnection: vi.fn(() => registration),
      startHttp: vi.fn(async () => run),
      get: vi.fn(() => run),
      cancel: vi.fn(() => ({ ...run, stage: "cancelled" })),
      deleteRun: vi.fn(() => ({ ...run, stage: "failed" })),
      list: vi.fn(() => [run]),
      resumeInterrupted: vi.fn(),
    };
    registerProviderAdapterIpc(service as never);

    const configured = await handlers.get("nomi:integration-certification:http:configure")?.(trustedEvent(), {
      vendorName: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret",
      catalogVendorKey: "renderer-cannot-choose-this",
      preserveExistingCredential: true,
      models: [{ modelKey: "paint-v2", kind: "image" }],
    });
    const started = await handlers.get("nomi:integration-certification:http:start")?.(trustedEvent(), {
      idempotencyKey: "manual-confirm-1",
      vendorName: "Example",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret",
      models: [{ modelKey: "paint-v2", kind: "image" }],
    });
    const fetched = await handlers.get("nomi:integration-certification:get")?.(trustedEvent(), { runId: "run-1" });
    const cancelled = await handlers.get("nomi:integration-certification:cancel")?.(trustedEvent(), { runId: "run-1" });
    const deleted = await handlers.get("nomi:integration-certification:delete")?.(trustedEvent(), { runId: "run-1" });
    const listed = await handlers.get("nomi:integration-certification:list")?.(trustedEvent(), { vendorKey: "example-com", activeOnly: true, limit: 5 });

    expect(configured).toEqual({ ok: true, registration });
    expect(service.configureHttpConnection).toHaveBeenCalledWith(expect.not.objectContaining({
      catalogVendorKey: expect.anything(),
      preserveExistingCredential: expect.anything(),
    }));
    expect(service.startHttp).toHaveBeenCalledWith(expect.objectContaining({
      entryPoint: "manual-ui",
      idempotencyKey: "manual-confirm-1",
      connection: expect.not.objectContaining({
        catalogVendorKey: expect.anything(),
        preserveExistingCredential: expect.anything(),
      }),
    }));
    expect(started).toEqual({ ok: true, run });
    expect(JSON.stringify(configured)).not.toContain("sk-secret");
    expect(JSON.stringify(started)).not.toContain("sk-secret");
    expect(fetched).toEqual({ ok: true, run });
    expect(cancelled).toEqual({ ok: true, run: { ...run, stage: "cancelled" } });
    expect(deleted).toEqual({ ok: true, run: { ...run, stage: "failed" } });
    expect(service.deleteRun).toHaveBeenCalledWith("run-1");
    expect(listed).toEqual({ ok: true, runs: [run] });
    expect(service.list).toHaveBeenCalledWith({ vendorKey: "example-com", activeOnly: true, limit: 5 });
    expect(service.resumeInterrupted).toHaveBeenCalledTimes(1);
    for (const legacy of [
      "nomi:provider-adapter:register",
      "nomi:provider-adapter:start",
      "nomi:provider-adapter:get",
      "nomi:provider-adapter:latest",
      "nomi:provider-adapter:cancel",
      "nomi:provider-adapter:list",
    ]) expect(handlers.has(legacy)).toBe(false);
  });

  it("returns stable codes without leaking raw main-process certification errors", async () => {
    const service = {
      configureHttpConnection: vi.fn(() => { throw new Error("upstream sk-secret exploded"); }),
      startHttp: vi.fn(async () => { throw new Error("provider English raw detail"); }),
      get: vi.fn(), cancel: vi.fn(), deleteRun: vi.fn(), list: vi.fn(() => []), resumeInterrupted: vi.fn(),
    };
    registerProviderAdapterIpc(service as never);
    const configured = await handlers.get("nomi:integration-certification:http:configure")?.(trustedEvent(), {});
    const started = await handlers.get("nomi:integration-certification:http:start")?.(trustedEvent(), { idempotencyKey: "same" });
    const missing = await handlers.get("nomi:integration-certification:get")?.(trustedEvent(), { runId: "missing" });

    expect(configured).toEqual({ ok: false, code: "START_FAILED", error: "Connection configuration failed" });
    expect(started).toEqual({ ok: false, code: "START_FAILED", error: "Certification start failed" });
    expect(missing).toEqual({ ok: false, code: "RUN_NOT_FOUND", error: "Certification run not found" });
    expect(JSON.stringify([configured, started, missing])).not.toMatch(/sk-secret|provider English/);
  });
});
