// 改类型的落库集成测试：证「改 kind」同时**重建了调用通道**——这正是只翻标签会漏掉的那一半。
// 用 electron mock + 临时目录，与 comfyuiWorkflowImportStore.test / catalogImport.test 同套路。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectTaskMapping } from "./types";
import type { CatalogState, Model } from "./types";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

/** 一个「中转拉进来、被猜成文本」的模型：kind=text 且**没有任何 mapping**（文本走 chat 直连）。 */
function seedCatalog(over: Partial<Model> = {}): void {
  const state: Partial<CatalogState> = {
    version: 8,
    vendors: [{
      key: "relay", name: "relay", enabled: true, hasApiKey: true,
      baseUrlHint: "https://relay.test/v1", authType: "bearer",
      providerKind: "openai-compatible", createdAt: "", updatedAt: "",
    }],
    models: [{
      modelKey: "seedream-4-0", vendorKey: "relay", labelZh: "Seedream 4.0",
      kind: "text", enabled: true,
      onboarding: { addedVia: "manual", addedAt: "", fields: [] },
      createdAt: "", updatedAt: "",
      ...over,
    } as Model],
    mappings: [],
    apiKeysByVendor: {},
  };
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-retype-"));
  tempRoots.push(mockedUserDataRoot);
  vi.resetModules();
});
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("retypeModelCatalogModel", () => {
  it("text → image：改 kind 的同时建出 text_to_image 通道（只改 kind 的话这里会是 null）", async () => {
    seedCatalog();
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const { listModelCatalogModels, listModelCatalogMappings } = await import("./catalogStore");

    const res = retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" });
    expect(res.model.kind).toBe("image");
    expect(res.rebuiltMappings).toBeGreaterThan(0);

    expect(listModelCatalogModels().find((m) => m.modelKey === "seedream-4-0")?.kind).toBe("image");
    // 这条断言是本次修复的核心：通道真的建出来了，改完立刻能跑。
    expect(selectTaskMapping([...listModelCatalogMappings()], "relay", "text_to_image", "seedream-4-0")).toBeTruthy();
    // 图片还应带上改图通道（否则连了参考图的节点会被拒发）。
    expect(selectTaskMapping([...listModelCatalogMappings()], "relay", "image_edit", "seedream-4-0")).toBeTruthy();
  });

  it("text → video：文生视频与图生视频两条通道都建（少一条＝一连首帧就被拒发）", async () => {
    seedCatalog({ modelKey: "kling-v2" } as Partial<Model>);
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const { listModelCatalogMappings } = await import("./catalogStore");

    retypeModelCatalogModel({ vendorKey: "relay", modelKey: "kling-v2", kind: "video" });
    const maps = [...listModelCatalogMappings()];
    expect(selectTaskMapping(maps, "relay", "text_to_video", "kling-v2")).toBeTruthy();
    expect(selectTaskMapping(maps, "relay", "image_to_video", "kling-v2")).toBeTruthy();
  });

  it("重建参数控件：改成图片后 meta.parameters 不再是空的（否则节点上一个控件都没有）", async () => {
    seedCatalog();
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const res = retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" });
    const params = (res.model.meta as { parameters?: unknown[] } | undefined)?.parameters;
    expect(Array.isArray(params) && params.length).toBeGreaterThan(0);
  });

  it("幂等：类型本来就对时不写盘、不重复堆 mapping", async () => {
    seedCatalog({ kind: "image" } as Partial<Model>);
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const { listModelCatalogMappings } = await import("./catalogStore");
    const res = retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" });
    expect(res.rebuiltMappings).toBe(0);
    expect(listModelCatalogMappings()).toHaveLength(0);
  });

  it("只增不删：改走 image 后，同 vendor 别的模型在用的通道不受影响", async () => {
    seedCatalog();
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const { listModelCatalogMappings, upsertModelCatalogMapping } = await import("./catalogStore");
    // 同 vendor 已有一条别人在用的 generic 视频通道。
    upsertModelCatalogMapping({
      vendorKey: "relay", taskKind: "text_to_video", name: "video", enabled: true,
      create: { method: "POST", path: "/video/generations" },
    });
    retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" });
    expect(selectTaskMapping([...listModelCatalogMappings()], "relay", "text_to_video")).toBeTruthy();
  });

  it("守卫：内置/agent 路的模型拒绝改（套通用模板会毁掉它们手写的通道）", async () => {
    seedCatalog({ onboarding: { addedVia: "agent", addedAt: "", fields: [] } } as Partial<Model>);
    const { retypeModelCatalogModel } = await import("./modelRetype");
    expect(() => retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" }))
      .toThrow(/not user-editable/);
  });

  it("守卫：没有 onboarding 记录的（内置种子）同样拒绝", async () => {
    seedCatalog({ onboarding: undefined } as Partial<Model>);
    const { retypeModelCatalogModel } = await import("./modelRetype");
    expect(() => retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "image" }))
      .toThrow(/not user-editable/);
  });

  it("3D 诚实：登记得下，但不假造通道（中转没有 3D 端点）", async () => {
    seedCatalog({ modelKey: "hunyuan3d-2" } as Partial<Model>);
    const { retypeModelCatalogModel } = await import("./modelRetype");
    const res = retypeModelCatalogModel({ vendorKey: "relay", modelKey: "hunyuan3d-2", kind: "model3d" });
    expect(res.model.kind).toBe("model3d");
    expect(res.rebuiltMappings).toBe(0);
  });

  it("拒绝无效 kind / 不存在的模型", async () => {
    seedCatalog();
    const { retypeModelCatalogModel } = await import("./modelRetype");
    expect(() => retypeModelCatalogModel({ vendorKey: "relay", modelKey: "seedream-4-0", kind: "nope" })).toThrow();
    expect(() => retypeModelCatalogModel({ vendorKey: "relay", modelKey: "ghost", kind: "image" })).toThrow(/not found/);
  });
});
