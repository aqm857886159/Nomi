import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>(),
  runScript: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => mocks.handlers.set(channel, handler) },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("./catalogStore", () => ({
  readCatalog: () => ({
    version: 11,
    vendors: [{ key: "relay", name: "Relay", enabled: true, authType: "bearer", baseUrlHint: "https://relay.example" }],
    models: [{ vendorKey: "relay", modelKey: "relay-video", labelZh: "Relay video", kind: "video", enabled: true }],
    mappings: [],
    apiKeysByVendor: {},
  }),
  listModelCatalogCustomCallConfig: () => [],
  upsertModelCatalogCustomCallConfig: () => [],
}));
vi.mock("./customCallRunner", () => ({
  runCustomCallScript: (...args: unknown[]) => mocks.runScript(...args),
  CustomCallScriptError: class CustomCallScriptError extends Error {
    transcript = [];
  },
}));

import { registerCustomCallIpc } from "./customCallIpc";

// 带空格的参考链接：试跑参数由渲染层按模式槽拼好、不经 taskTemplateParams（唯一绕开参数层的门）。参考链接在交给脚本之前
// 过同一道序列化，脚本拿到的就是要发出去的写法；别的参数原样。
describe("自定义调用试跑 × 带空格的参考链接", () => {
  it("交给脚本的参数里，参考链接是序列化后的写法", async () => {
    mocks.runScript.mockResolvedValue({ assets: ["https://cdn.example.com/out.mp4"], transcript: [] });
    registerCustomCallIpc(() => undefined);
    const result = await mocks.handlers.get("nomi:model-catalog:custom-call:test-run")!({}, {
      runId: "run-1",
      vendorKey: "relay",
      modelKey: "relay-video",
      script: "return { assets: [] }",
      params: { image_urls: ["https://cdn.example.com/Windows ref.png"], firstFrameUrl: "https://cdn.example.com/first frame.png", style: "a b" },
    });
    expect(result).toMatchObject({ state: "succeeded" });
    expect(mocks.runScript).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        image_urls: ["https://cdn.example.com/Windows%20ref.png"],
        firstFrameUrl: "https://cdn.example.com/first%20frame.png",
        style: "a b",
      },
    }));
  });
});
