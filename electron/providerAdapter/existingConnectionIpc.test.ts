import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const dependencies = vi.hoisted(() => ({ readCatalog: vi.fn() }));
vi.mock("../catalog/catalogStore", () => ({ readCatalog: dependencies.readCatalog }));
vi.mock("../catalog/secrets", () => ({ decryptApiKeyRecord: () => "stored" }));
vi.mock("./service", () => ({ getProviderAdapterService: () => ({ register: vi.fn(), start: vi.fn(), getRun: vi.fn() }) }));

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
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only a saved vendor id when listing models", async () => {
    const actions = {
      listModels: vi.fn(async () => ({ ok: true, models: ["a"], connection: { vendorKey: "saved" } })),
      register: vi.fn(),
      start: vi.fn(),
      adapt: vi.fn(),
      retry: vi.fn(),
    };
    registerExistingConnectionIpc(actions as never);

    await handlers.get("nomi:provider-adapter:existing:list-models")?.(trustedEvent(), {
      vendorKey: " saved ",
      apiKey: "renderer-must-not-override-this",
      baseUrl: "https://attacker.invalid",
    });

    expect(actions.listModels).toHaveBeenCalledWith({ vendorKey: "saved" });
  });

  it.each(["authorization", "AUTHORIZATION"])("the production saved-connection fetch sends only the %s override", async (header) => {
    dependencies.readCatalog.mockReturnValue({
      vendors: [{ key: "saved", name: "Saved", baseUrlHint: "https://gateway.test/v1", authType: "bearer",
        providerKind: "openai-compatible", meta: { extraHeaders: { [header]: "Bearer gateway-override" } } }],
      models: [], apiKeysByVendor: { saved: { apiKey: "stored" } },
    });
    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    registerExistingConnectionIpc();
    expect(await handlers.get("nomi:provider-adapter:existing:list-models")?.(trustedEvent(), { vendorKey: "saved" }))
      .toMatchObject({ ok: true, models: ["model"] });
    expect(new Headers(fetchSpy.mock.calls[0][1].headers).get("authorization")).toBe("Bearer gateway-override");
  });

  it("sanitizes model selections and ignores renderer connection credentials", async () => {
    const actions = {
      listModels: vi.fn(),
      register: vi.fn(),
      start: vi.fn(async () => ({ ok: true, run: { id: "run-1" } })),
      adapt: vi.fn(),
      retry: vi.fn(),
    };
    registerExistingConnectionIpc(actions as never);

    const result = await handlers.get("nomi:provider-adapter:existing:start")?.(trustedEvent(), {
      vendorKey: "saved",
      apiKey: "renderer-must-not-override-this",
      models: [
        { id: " image-a ", displayName: " Image A ", kind: "image" },
        { modelKey: "future-kind", kind: "not-a-kind" },
      ],
    });

    expect(actions.start).toHaveBeenCalledWith({
      vendorKey: "saved",
      models: [
        { modelKey: "image-a", labelZh: "Image A", kind: "image" },
        { modelKey: "future-kind", kind: "text" },
      ],
    });
    expect(result).toEqual({ ok: true, run: { id: "run-1" } });
  });

  it("keeps save and explicit adaptation as separate existing-connection actions", async () => {
    const actions = {
      listModels: vi.fn(),
      register: vi.fn(async () => ({ ok: true, registration: { vendorKey: "saved" } })),
      start: vi.fn(),
      adapt: vi.fn(async () => ({ ok: true, run: { id: "run-adapt" } })),
      retry: vi.fn(),
    };
    registerExistingConnectionIpc(actions as never);
    const payload = {
      vendorKey: " saved ",
      apiKey: "renderer-must-not-override-this",
      models: [{ id: " image-a ", displayName: " Image A ", kind: "image" }],
    };

    const registered = await handlers.get("nomi:provider-adapter:existing:register")?.(trustedEvent(), payload);
    const adapted = await handlers.get("nomi:provider-adapter:existing:adapt")?.(trustedEvent(), payload);

    const expected = {
      vendorKey: "saved",
      models: [{ modelKey: "image-a", labelZh: "Image A", kind: "image" }],
    };
    expect(actions.register).toHaveBeenCalledWith(expected);
    expect(actions.adapt).toHaveBeenCalledWith(expected);
    expect(registered).toEqual({ ok: true, registration: { vendorKey: "saved" } });
    expect(adapted).toEqual({ ok: true, run: { id: "run-adapt" } });
  });

  it("accepts only the persisted run id and optional model key when retrying", async () => {
    const actions = {
      listModels: vi.fn(),
      register: vi.fn(),
      start: vi.fn(),
      adapt: vi.fn(),
      retry: vi.fn(async () => ({ ok: true, run: { id: "run-new" } })),
    };
    registerExistingConnectionIpc(actions as never);

    const result = await handlers.get("nomi:provider-adapter:retry")?.(trustedEvent(), {
      runId: " run-old ",
      modelKey: " failed-video ",
      vendorKey: "attacker-vendor",
      apiKey: "renderer-must-not-override-this",
      baseUrl: "https://attacker.invalid",
      models: [{ modelKey: "attacker-model", kind: "text" }],
    });

    expect(actions.retry).toHaveBeenCalledWith({ runId: "run-old", modelKey: "failed-video" });
    expect(result).toEqual({ ok: true, run: { id: "run-new" } });
  });
});
