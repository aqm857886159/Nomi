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

import { registerExistingConnectionIpc } from "./existingConnectionIpc";
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

describe("registerExistingConnectionIpc", () => {
  beforeEach(() => handlers.clear());

  it("accepts only a saved vendor id when listing models", async () => {
    const service = {
      listExistingHttpModels: vi.fn(async () => ({ ok: true, models: ["a"], connection: { vendorKey: "saved" } })),
      startExistingHttp: vi.fn(),
      retryHttp: vi.fn(),
    };
    registerExistingConnectionIpc(service as never);

    await handlers.get("nomi:integration-certification:http:existing:list-models")?.(trustedEvent(), {
      vendorKey: " saved ",
      apiKey: "renderer-must-not-override-this",
      baseUrl: "https://attacker.invalid",
    });

    expect(service.listExistingHttpModels).toHaveBeenCalledWith("saved");
  });

  it("sanitizes model selections and ignores renderer connection credentials", async () => {
    const service = {
      listExistingHttpModels: vi.fn(),
      startExistingHttp: vi.fn(async () => ({ ok: true, run: { id: "run-1" } })),
      retryHttp: vi.fn(),
    };
    registerExistingConnectionIpc(service as never);

    const result = await handlers.get("nomi:integration-certification:http:existing:start")?.(trustedEvent(), {
      idempotencyKey: "confirm-1",
      vendorKey: "saved",
      apiKey: "renderer-must-not-override-this",
      models: [
        { id: " image-a ", displayName: " Image A ", kind: "image" },
        { modelKey: "future-kind", kind: "not-a-kind" },
      ],
    });

    expect(service.startExistingHttp).toHaveBeenCalledWith({
      entryPoint: "manual-ui",
      idempotencyKey: "confirm-1",
      vendorKey: "saved",
      models: [
        { modelKey: "image-a", labelZh: "Image A", kind: "image" },
        { modelKey: "future-kind", kind: "text" },
      ],
    });
    expect(result).toEqual({ ok: true, run: { id: "run-1" } });
  });

  it("does not expose legacy register/start/adapt paths beside canonical certification", () => {
    registerExistingConnectionIpc({
      listExistingHttpModels: vi.fn(),
      startExistingHttp: vi.fn(),
      retryHttp: vi.fn(),
    } as never);
    for (const legacy of [
      "nomi:provider-adapter:existing:list-models",
      "nomi:provider-adapter:existing:register",
      "nomi:provider-adapter:existing:start",
      "nomi:provider-adapter:existing:adapt",
      "nomi:provider-adapter:retry",
    ]) expect(handlers.has(legacy)).toBe(false);
  });

  it("accepts only the persisted run id and optional model key when retrying", async () => {
    const service = {
      listExistingHttpModels: vi.fn(),
      startExistingHttp: vi.fn(),
      retryHttp: vi.fn(async () => ({ ok: true, run: { id: "run-new" } })),
    };
    registerExistingConnectionIpc(service as never);

    const result = await handlers.get("nomi:integration-certification:http:retry")?.(trustedEvent(), {
      runId: " run-old ",
      modelKey: " failed-video ",
      idempotencyKey: "retry-1",
      vendorKey: "attacker-vendor",
      apiKey: "renderer-must-not-override-this",
      baseUrl: "https://attacker.invalid",
      models: [{ modelKey: "attacker-model", kind: "text" }],
    });

    expect(service.retryHttp).toHaveBeenCalledWith({
      runId: "run-old",
      modelKey: "failed-video",
      idempotencyKey: "retry-1",
    });
    expect(result).toEqual({ ok: true, run: { id: "run-new" } });
  });

  it("converts thrown start and retry failures to stable redacted codes", async () => {
    const service = {
      listExistingHttpModels: vi.fn(),
      startExistingHttp: vi.fn(async () => { throw new Error("raw provider English sk-secret"); }),
      retryHttp: vi.fn(async () => { throw new Error("raw retry detail sk-secret"); }),
    };
    registerExistingConnectionIpc(service as never);
    const start = await handlers.get("nomi:integration-certification:http:existing:start")?.(trustedEvent(), {});
    const retry = await handlers.get("nomi:integration-certification:http:retry")?.(trustedEvent(), {});
    expect(start).toEqual({ ok: false, code: "START_FAILED", error: "Certification start failed" });
    expect(retry).toEqual({ ok: false, code: "START_FAILED", error: "Certification retry failed" });
    expect(JSON.stringify([start, retry])).not.toContain("sk-secret");
  });
});
