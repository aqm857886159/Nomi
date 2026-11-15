/**
 * 外部 Agent 接上一个新模型之后，正式生成能走到「等你确认」（用户原路径，同一个会话里不重启）。
 *
 * 用户那次：存 APIMart 密钥 → Agent 交一张卡、挂到已连着的 APIMart 上 → 读模型说可用 → 建草稿 → 预览 → 过门。
 * 修前红在两句上：门先说 `Unknown model: muse-video-x`（门读的是应用启动时拍的那份模型表）；
 * 那张卡又把整家 APIMart 判成 `configured_provider`（卡往内置连接上写了字段），连原来好好的内置模型也过不了门。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readCatalog } from "../catalog/catalogStore";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";
import { callTool, draftPreviewGate, FAKE_KEY, freshSettingsDir, hostWiredPlanning, readinessOf, videoCard } from "./externalAgentGateTestkit";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"),
      decryptString: (buffer: Buffer) => buffer.toString("utf8").replace(/^enc:/, ""),
    },
  };
});

afterEach(() => { vi.unstubAllEnvs(); });

const apimartRow = () => readCatalog().vendors.find((vendor) => vendor.key === "apimart") as Record<string, unknown>;

/** 内置目录里一个 APIMart 图片模型（任选一个可发布的），用来证明「其它内置模型不受影响」。 */
function builtinImageModel(runtime = createLiveGenerationRuntime()) {
  for (const manifest of runtime.createDraftScope().registry.snapshot?.() ?? []) {
    if (!manifest.outputKinds.includes("image")) continue;
    for (const provider of manifest.providers) {
      if (provider.providerId !== "apimart") continue;
      const model = provider.models.find((row) => row.modelId.includes("seedream"));
      if (model) return { providerId: "apimart", modelId: model.modelId, mode: model.modes[0]! };
    }
  }
  throw new Error("no built-in APIMart image model in the registry");
}

describe("external Agent: declared model reaches the confirm step", () => {
  it("user path on the built-in APIMart connection: card → read → draft → preview → gate answers confirm, same session", async () => {
    freshSettingsDir("user-path");
    expect((await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY })).ok).toBe(true);
    // 宿主在应用启动时就造好了生成工具：交卡发生在它之后。
    const planning = hostWiredPlanning();
    const image = builtinImageModel(planning.runtime);
    const before = apimartRow();

    const submitted = await callTool("nomi_model_setup", { action: "submit_declaration", vendorKey: "apimart", declaration: videoCard("https://api.apimart.ai", "muse-video-x") });
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);

    const declared = await draftPreviewGate(planning, { providerId: "apimart", modelId: "muse-video-x", mode: "text_to_video" });
    expect.soft(declared.preview?.threw, JSON.stringify(declared.preview)).toBeUndefined();
    expect.soft(declared.gate?.threw, JSON.stringify(declared.gate)).toBeUndefined();
    expect.soft(declared.gate?.nextAction).toBe("confirm");

    // 同一家的内置模型照常走到确认。
    const builtin = await draftPreviewGate(planning, image);
    expect.soft(builtin.gate?.threw, JSON.stringify(builtin.gate)).toBeUndefined();
    expect.soft(builtin.gate?.nextAction).toBe("confirm");

    // 挂卡不往内置连接行上写任何字段。
    const { updatedAt: _a, ...rowBefore } = before;
    const { updatedAt: _b, ...rowAfter } = apimartRow();
    expect(rowAfter).toEqual(rowBefore);
    expect(readinessOf("apimart")?.providerReady).toBe(true);
  });

  it("a card that names a different address for the built-in connection is refused and says which field", async () => {
    freshSettingsDir("other-origin");
    const before = apimartRow();
    const submitted = await callTool("nomi_model_setup", { action: "submit_declaration", vendorKey: "apimart", declaration: videoCard("https://relay.example.test", "relay-video") });
    expect(submitted.ok).toBe(false);
    expect(JSON.stringify(submitted)).toContain("provider.baseUrl");
    const { updatedAt: _a, ...rowBefore } = before;
    const { updatedAt: _b, ...rowAfter } = apimartRow();
    expect(rowAfter).toEqual(rowBefore);
  });

  it("a card that declares a model already in the built-in catalog is refused by name and leaves the connection alone", async () => {
    freshSettingsDir("builtin-name");
    await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY });
    const submitted = await callTool("nomi_model_setup", { action: "submit_declaration", vendorKey: "apimart", declaration: videoCard("https://api.apimart.ai", "flux-3-video") });
    expect(submitted.ok).toBe(false);
    expect(JSON.stringify(submitted)).toContain("flux-3-video");
    expect(readinessOf("apimart")?.providerReady).toBe(true);
  });
});
