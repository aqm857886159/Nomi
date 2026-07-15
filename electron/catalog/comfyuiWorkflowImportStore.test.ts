// S3 store 集成：证 importComfyWorkflowToCatalog 真落库 + 同 vendor 同 taskKind 的多条导入靠 modelKey 不互相覆盖
// （applyMappingUpsert 的 modelKey 修复）。用 electron mock + 临时目录，与 catalogImport.test 同套路。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectTaskMapping } from "./types";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
}));

function emptyCatalog(): void {
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify({ version: 5, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }), "utf8");
}

// 一条最小 i2v 图（LoadImage 首帧 + VHS 视频输出 + positive 连到提示词节点）。
const videoWorkflow = (promptText: string) => JSON.stringify({
  "1": { class_type: "LoadImage", inputs: { image: "s.png" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: promptText, clip: ["3", 0] } },
  "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "m.safetensors" } },
  "4": { class_type: "KSampler", inputs: { seed: 1, steps: 10, positive: ["2", 0], model: ["3", 0] } },
  "5": { class_type: "VHS_VideoCombine", inputs: { images: ["4", 0], frame_rate: 24 } },
});

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-comfy-import-"));
  tempRoots.push(mockedUserDataRoot);
  vi.resetModules();
});
afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("importComfyWorkflowToCatalog（S3 落库）", () => {
  it("导入 i2v 图 → 落一个 video 模型 + i2v mapping（带 modelKey）", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels, listModelCatalogMappings } = await import("./catalogStore");
    const text = videoWorkflow("a dragon");
    const a = analyzeComfyWorkflowText(text);
    expect(a.ok).toBe(true);
    const binding = (a as { analysis: { suggested: unknown } }).analysis.suggested;
    const r = importComfyWorkflowToCatalog({ text, binding, labelZh: "WAN i2v A" }, "aaa");
    expect(r).toMatchObject({ ok: true, kind: "video", taskKind: "image_to_video" });

    const models = listModelCatalogModels({ vendorKey: "comfyui-local" }) as Array<{ modelKey: string; kind: string }>;
    expect(models.find((m) => m.kind === "video")).toBeTruthy();
    const mappings = listModelCatalogMappings() as Array<{ vendorKey: string; taskKind: string; modelKey?: string }>;
    const mine = mappings.find((m) => m.vendorKey === "comfyui-local" && m.taskKind === "image_to_video");
    expect(mine?.modelKey).toBe("comfy-wan-i2v-a-aaa");
  });

  it("同 vendor 同 taskKind 两条导入靠 modelKey 不互相覆盖，selectTaskMapping 各取各的", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogMappings } = await import("./catalogStore");
    const textA = videoWorkflow("dragon A");
    const textB = videoWorkflow("dragon B");
    const bindA = (analyzeComfyWorkflowText(textA) as { analysis: { suggested: unknown } }).analysis.suggested;
    const bindB = (analyzeComfyWorkflowText(textB) as { analysis: { suggested: unknown } }).analysis.suggested;
    const rA = importComfyWorkflowToCatalog({ text: textA, binding: bindA, labelZh: "WAN A" }, "a1");
    const rB = importComfyWorkflowToCatalog({ text: textB, binding: bindB, labelZh: "WAN B" }, "b2");
    const keyA = (rA as { modelKey: string }).modelKey;
    const keyB = (rB as { modelKey: string }).modelKey;
    expect(keyA).not.toBe(keyB);

    const mappings = listModelCatalogMappings() as Parameters<typeof selectTaskMapping>[0];
    const i2vMappings = mappings.filter((m) => m.vendorKey === "comfyui-local" && m.taskKind === "image_to_video");
    expect(i2vMappings).toHaveLength(2); // 没被覆盖成 1 条
    // selectTaskMapping 按 modelKey 精确选对应那条（body 里提示词不同 → 证没张冠李戴）
    const pickA = selectTaskMapping(mappings, "comfyui-local", "image_to_video", keyA);
    const pickB = selectTaskMapping(mappings, "comfyui-local", "image_to_video", keyB);
    expect(pickA?.modelKey).toBe(keyA);
    expect(pickB?.modelKey).toBe(keyB);
    expect(JSON.stringify(pickA?.create.body)).toContain("{{request.prompt}}"); // 提示词已注参
  });

  it("坏 workflow → { ok:false, error }，不落库", async () => {
    emptyCatalog();
    const { importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels } = await import("./catalogStore");
    const r = importComfyWorkflowToCatalog({ text: "{bad json", binding: { numeric: [] }, labelZh: "x" }, "z");
    expect(r.ok).toBe(false);
    expect(listModelCatalogModels({ vendorKey: "comfyui-local" })).toHaveLength(0);
  });
});
