/**
 * 整家删掉内置连接，再存一次这家的密钥就整家回来（2026-11-16 协调拍板 C；Q12 仍然成立）。
 *
 * 用户那次：删了 APIMart 整家，后来想用回来、重新存了密钥——连接行在、0 个模型，门说「没就绪」，
 * 而没有任何一句话告诉他怎么回来。现在：
 *   · 删完、不存密钥、重启：内置模型不回来，门说「你删了这家，重新存密钥就回来」；
 *   · 存回密钥：内置模型全回来，单删过的那一个照旧不回；
 *   · 0.24.x 旧盘（整家删是逐模型记的）：每个内置模型都在删除记录里 = 当年整家删的，同样存密钥就回来。
 */
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinVendorDeletedUntilKeySaved, deleteModelCatalogModels, ensureBuiltinModelSeeds, readCatalog } from "../catalog/catalogStore";
import { builtinCatalogModelKeys } from "../catalog/seedBuiltins";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";
import { callTool, draftPreviewGate, FAKE_KEY, freshSettingsDir, liveCatalogPlanning, openOldUserDir, restoreSettingsDir } from "./externalAgentGateTestUtils";

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

afterEach(() => { restoreSettingsDir(); });

const apimartModelKeys = () => new Set(readCatalog().models.filter((model) => model.vendorKey === "apimart").map((model) => model.modelKey));

/** 一个内置 APIMart 图片模型（从代码目录取，删了之后注册表里没有它也取得到）。 */
const IMAGE_MODEL = [...builtinCatalogModelKeys("apimart")].find((modelKey) => modelKey.includes("seedream"))!;

function imageTarget() {
  for (const manifest of createLiveGenerationRuntime().current().registry.snapshot()) {
    for (const provider of manifest.providers) {
      const model = provider.providerId === "apimart" ? provider.models.find((row) => row.modelId === IMAGE_MODEL) : undefined;
      if (model) return { providerId: "apimart", modelId: model.modelId, mode: model.modes[0]! };
    }
  }
  return { providerId: "apimart", modelId: IMAGE_MODEL, mode: "text_to_image" };
}

async function removeWholeApimart() {
  const read = await callTool("nomi_read", { target: "models" }) as { fingerprint?: string };
  const removed = await callTool("nomi_remove_provider", { vendorKey: "apimart", ifUnchanged: read.fingerprint });
  expect(removed.ok, JSON.stringify(removed)).toBe(true);
  return removed;
}

describe("whole built-in provider deleted, then its key saved again", () => {
  it("deleted and not reconnected: a restart does not bring the models back, and the gate says how to get them back", async () => {
    freshSettingsDir("whole-delete");
    await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY });
    const removed = await removeWholeApimart();
    expect(JSON.stringify(removed)).toMatch(/saving this provider's key again/i);

    ensureBuiltinModelSeeds(); // 重启
    expect(apimartModelKeys().size).toBe(0);
    expect(readCatalog().suppressedBuiltinVendors).toEqual(["apimart"]);
    expect(readCatalog().suppressedBuiltinModels ?? []).toEqual([]);

    const planning = liveCatalogPlanning();
    const { created, preview, gate } = await draftPreviewGate(planning, imageTarget());
    const said = JSON.stringify({ created, preview, gate });
    expect(said, said).toMatch(/deleted/i);
    expect(said, said).toMatch(/sav(e|ing) .*key again/i);
  });

  it("saving the key again brings every built-in model back except the one deleted on its own", async () => {
    freshSettingsDir("whole-delete-reconnect");
    await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY });
    deleteModelCatalogModels([{ vendorKey: "apimart", modelKey: IMAGE_MODEL }]);
    const before = apimartModelKeys();
    await removeWholeApimart();
    ensureBuiltinModelSeeds();

    expect((await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY })).ok).toBe(true);
    expect(apimartModelKeys()).toEqual(before);
    expect(apimartModelKeys().has(IMAGE_MODEL)).toBe(false);
    expect(readCatalog().suppressedBuiltinVendors ?? []).toEqual([]);
    ensureBuiltinModelSeeds(); // 再重启一次也一样
    expect(apimartModelKeys()).toEqual(before);
  });

  it("a built-in provider without a key (local ComfyUI): deleted stays deleted, and nothing promises that a key brings it back", async () => {
    freshSettingsDir("whole-delete-keyless");
    ensureBuiltinModelSeeds();
    const read = await callTool("nomi_read", { target: "models" }) as { fingerprint?: string };
    const removed = await callTool("nomi_remove_provider", { vendorKey: "comfyui-local", ifUnchanged: read.fingerprint });
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    expect(JSON.stringify(removed)).not.toMatch(/key again/i);
    ensureBuiltinModelSeeds(); // 重启
    expect(readCatalog().models.filter((model) => model.vendorKey === "comfyui-local")).toEqual([]);
    expect(builtinVendorDeletedUntilKeySaved("comfyui-local")).toBe(false);
  });

  it("0.24.x disk where the whole provider was deleted model by model: treated as a whole deletion, the key brings it back", async () => {
    openOldUserDir(fileURLToPath(new URL("../../tests/fixtures/old-user-data/builtin-connection/v0.24.0-builtin-whole-deleted/", import.meta.url)));
    ensureBuiltinModelSeeds();
    expect(readCatalog().suppressedBuiltinVendors).toEqual(["apimart"]);
    expect(apimartModelKeys().size).toBe(0);
    expect((await callTool("nomi_model_setup", { action: "set_key", vendorKey: "apimart", apiKey: FAKE_KEY })).ok).toBe(true);
    expect([...builtinCatalogModelKeys("apimart")].every((modelKey) => apimartModelKeys().has(modelKey))).toBe(true);
    const planning = liveCatalogPlanning();
    const gate = (await draftPreviewGate(planning, imageTarget())).gate;
    expect(gate?.nextAction, JSON.stringify(gate)).toBe("confirm");
  });
});
