/**
 * v6 → v7 回归：**存量** v6 catalog 里的 gpt-image / dall-e-2 图生图从 chat/completions 升级到
 * OpenAI multipart /v1/images/edits。
 *
 * 真机(2026-07-21)抓到的真 bug：v5→v6 迁移跑在「gpt-image 还没接 multipart edits」之前 → 存量
 * gpt-image-2 被留在 chat/completions。之后智能默认改了(gpt-image→multipart)，但迁移**版本门控**、
 * 不会在已是 v6 的 catalog 上重跑 → 存量用户图生图仍撞 chat 端点。根治=bump 到 v7 强制重跑幂等迁移。
 * 这条测的是**迁移的接线**(readCatalog→migrateCatalogForward 真的在 v6 catalog 上重跑)，不是迁移函数本身。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

const NOW = "2026-07-21T00:00:00.000Z";
const catalogFile = () => path.join(mockedUserDataRoot, "model-catalog.json");

/** 存量 v6 catalog：自建中转 gpt-image-2，t2i 走 /images/generations，image_edit 还是 generic chat（v6 遗留）。 */
function v6CatalogWithChatGptImage() {
  return {
    version: 6,
    vendors: [{
      key: "code-newcli-com", name: "relay", enabled: true,
      baseUrlHint: "https://code.newcli.com/codex/v1", authType: "bearer", authHeader: null,
      authQueryParam: null, providerKind: "openai-compatible", createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      modelKey: "gpt-image-2", vendorKey: "code-newcli-com", modelAlias: "gpt-image-2", labelZh: "GPT Image 2",
      kind: "image", enabled: true, meta: { imageOptions: { supportsReferenceImages: true } }, createdAt: NOW, updatedAt: NOW,
    }],
    mappings: [
      { id: "m-t2i", vendorKey: "code-newcli-com", taskKind: "text_to_image", name: "t2i", enabled: true,
        create: { method: "POST", path: "/v1/images/generations", body: {} }, createdAt: NOW, updatedAt: NOW },
      { id: "m-edit", vendorKey: "code-newcli-com", taskKind: "image_edit", name: "edit", enabled: true,
        create: { method: "POST", path: "/v1/chat/completions", body: {} }, createdAt: NOW, updatedAt: NOW },
    ],
    apiKeysByVendor: {},
  };
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-v7-"));
  tempRoots.push(mockedUserDataRoot);
  vi.resetModules();
});
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("v6 → v7：存量 gpt-image 图生图重迁移到 multipart", () => {
  it("readCatalog 把 v6 catalog 升到 v7，并给 gpt-image-2 加 multipart /v1/images/edits 精确 mapping", async () => {
    fs.writeFileSync(catalogFile(), JSON.stringify(v6CatalogWithChatGptImage()), "utf8");
    const { readCatalog } = await import("./catalogStore");
    const state = readCatalog();

    expect(state.version).toBe(7);
    const edits = state.mappings.filter((m) => m.taskKind === "image_edit");
    const exact = edits.find((m) => m.modelKey === "gpt-image-2");
    expect(exact?.create.path).toBe("/v1/images/edits");
    expect(Boolean(exact?.create.multipart)).toBe(true);
    expect(((exact?.create.multipart as { imageField?: string }) || {}).imageField).toBe("image[]");
    const model = state.models.find((m) => m.modelKey === "gpt-image-2");
    expect((model?.meta as { imageOptions?: { imageEditProtocol?: string } })?.imageOptions?.imageEditProtocol).toBe("openai-multipart-edits");
    // 磁盘被写回 v7（下次开机不再重迁）。
    expect(JSON.parse(fs.readFileSync(catalogFile(), "utf8")).version).toBe(7);
  });

  it("幂等：v7 catalog 再读不再改动（迁移只在版本门触发一次）", async () => {
    fs.writeFileSync(catalogFile(), JSON.stringify(v6CatalogWithChatGptImage()), "utf8");
    const { readCatalog } = await import("./catalogStore");
    readCatalog(); // v6→v7 一次
    const before = fs.readFileSync(catalogFile(), "utf8");
    readCatalog(); // 已 v7，不应再迁
    expect(fs.readFileSync(catalogFile(), "utf8")).toBe(before);
  });
});
