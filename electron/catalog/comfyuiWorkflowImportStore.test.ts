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
const textToVideoWorkflow = (promptText: string) => JSON.stringify({
  "2": { class_type: "CLIPTextEncode", inputs: { text: promptText, clip: ["3", 0] } },
  "3": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "m.safetensors" } },
  "4": { class_type: "KSampler", inputs: { seed: 2, steps: 12, positive: ["2", 0], model: ["3", 0] } },
  "5": { class_type: "CreateVideo", inputs: { images: ["4", 0], fps: 16 } },
  "6": { class_type: "SaveVideo", inputs: { video: ["5", 0], filename_prefix: "test" } },
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

    const candidateVendorKey = (r as { vendorKey: string }).vendorKey;
    expect(candidateVendorKey).not.toBe("comfyui-local");
    const models = listModelCatalogModels({ vendorKey: candidateVendorKey }) as Array<{ modelKey: string; kind: string; enabled: boolean }>;
    expect(models.find((m) => m.kind === "video")).toBeTruthy();
    expect(models.find((m) => m.kind === "video")?.enabled).toBe(false);
    const mappings = listModelCatalogMappings() as Array<{ vendorKey: string; taskKind: string; modelKey?: string; enabled: boolean }>;
    const mine = mappings.find((m) => m.vendorKey === candidateVendorKey && m.taskKind === "image_to_video");
    expect(mine?.modelKey).toBe("comfy-wan-i2v-a-aaa");
    expect(mine?.enabled).toBe(false);
  });

  it("导入时保存原始 workflow + 规范化 binding 草稿，供 UI 重新编辑", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels } = await import("./catalogStore");
    const text = videoWorkflow("editable dragon");
    const binding = (analyzeComfyWorkflowText(text) as { analysis: { suggested: unknown } }).analysis.suggested;
    const r = importComfyWorkflowToCatalog({ text, binding, labelZh: "WAN editable" }, "edit1");
    const modelKey = (r as { modelKey: string }).modelKey;

    const models = listModelCatalogModels({ vendorKey: (r as { vendorKey: string }).vendorKey }) as Array<{ modelKey: string; meta?: { comfyWorkflowImport?: { text?: string; binding?: unknown } } }>;
    const model = models.find((m) => m.modelKey === modelKey);
    expect(model?.meta?.comfyWorkflowImport?.text).toBe(text);
    const savedBinding = model?.meta?.comfyWorkflowImport?.binding as { params?: unknown[]; numeric?: unknown };
    expect(savedBinding.params).toEqual((binding as { params?: unknown[] }).params);
    expect(savedBinding).not.toHaveProperty("numeric");
  });

  it("显式 params: [] 落库后保持为空，不会从 numeric 复活已删除参数", async () => {
    emptyCatalog();
    const { importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels } = await import("./catalogStore");
    const text = videoWorkflow("explicit empty");
    const result = importComfyWorkflowToCatalog({
      text,
      binding: {
        promptNodeId: "2", promptInputKey: "text",
        firstFrameNodeId: "1", firstFrameInputKey: "image",
        outputNodeId: "5", outputKind: "video",
        numeric: [{ nodeId: "4", inputKey: "seed", paramKey: "comfy_seed", label: "Seed", default: 1 }],
        params: [],
      },
      labelZh: "Explicit empty",
    }, "empty1");
    const modelKey = (result as { modelKey: string }).modelKey;
    const model = (listModelCatalogModels({ vendorKey: (result as { vendorKey: string }).vendorKey }) as Array<{
      modelKey: string;
      meta?: {
        parameters?: Array<{ key: string; type: string }>;
        comfyWorkflowImport?: { binding?: { params?: unknown[]; numeric?: unknown } };
      };
    }>).find((item) => item.modelKey === modelKey);
    // 本例只管「numeric 不复活」：值参数必须为空。
    // 图像输入是另一条声明（type:'image-url'，由 binding.images 派生），不在此断言范围内——
    // 这里按 type 过滤而不是笼统 toEqual([])，免得把这条用例的原意稀释掉。
    expect(model?.meta?.parameters?.filter((p) => p.type !== "image-url")).toEqual([]);
    expect(model?.meta?.parameters?.map((p) => p.key)).toEqual(["first_frame_url"]);
    expect(model?.meta?.comfyWorkflowImport?.binding?.params).toEqual([]);
    expect(model?.meta?.comfyWorkflowImport?.binding).not.toHaveProperty("numeric");
  });

  it("仅 params 缺失时把 legacy numeric 单向迁移成现代 params", async () => {
    emptyCatalog();
    const { importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels } = await import("./catalogStore");
    const text = videoWorkflow("legacy migration");
    const result = importComfyWorkflowToCatalog({
      text,
      binding: {
        outputNodeId: "5", outputKind: "video",
        numeric: [{ nodeId: "4", inputKey: "seed", paramKey: "comfy_seed", label: "Seed", default: 1 }],
      },
      labelZh: "Legacy migration",
    }, "legacy1");
    const modelKey = (result as { modelKey: string }).modelKey;
    const model = (listModelCatalogModels({ vendorKey: (result as { vendorKey: string }).vendorKey }) as Array<{
      modelKey: string;
      meta?: { comfyWorkflowImport?: { binding?: { params?: unknown[]; numeric?: unknown } } };
    }>).find((item) => item.modelKey === modelKey);
    expect(model?.meta?.comfyWorkflowImport?.binding?.params).toEqual([
      { nodeId: "4", inputKey: "seed", paramKey: "comfy_seed", label: "Seed", type: "number", default: 1 },
    ]);
    expect(model?.meta?.comfyWorkflowImport?.binding).not.toHaveProperty("numeric");
  });

  it("界面格式原图保留到草稿和提交 extra_pnginfo，API 文本仍是执行图", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { listModelCatalogModels, listModelCatalogMappings } = await import("./catalogStore");
    const text = videoWorkflow("keep ui source");
    const binding = (analyzeComfyWorkflowText(text) as { analysis: { suggested: unknown } }).analysis.suggested;
    const uiWorkflowText = JSON.stringify({ nodes: [{ id: 5, type: "CreateVideo" }], links: [] });
    const result = importComfyWorkflowToCatalog({ text, binding, labelZh: "UI source", uiWorkflowText }, "ui1");
    const modelKey = (result as { modelKey: string }).modelKey;
    const candidateVendorKey = (result as { vendorKey: string }).vendorKey;
    const model = (listModelCatalogModels({ vendorKey: candidateVendorKey }) as Array<Record<string, unknown>>)
      .find((item) => item.modelKey === modelKey) as { meta?: { comfyWorkflowImport?: { uiWorkflowText?: string } } };
    const mapping = (listModelCatalogMappings({ vendorKey: candidateVendorKey }) as Array<Record<string, unknown>>)
      .find((item) => item.modelKey === modelKey) as { create?: { body?: { extra_data?: unknown; prompt?: unknown } } };
    expect(model.meta?.comfyWorkflowImport?.uiWorkflowText).toBe(uiWorkflowText);
    expect(mapping.create?.body?.extra_data).toEqual({ extra_pnginfo: { workflow: JSON.parse(uiWorkflowText) } });
    expect(mapping.create?.body?.prompt).toBeTruthy();
  });

  it("同 source 的两条 staged revision 彼此隔离，selectTaskMapping 各取各的", async () => {
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
    const vendorA = (rA as { vendorKey: string }).vendorKey;
    const vendorB = (rB as { vendorKey: string }).vendorKey;
    expect(keyA).not.toBe(keyB);
    expect(vendorA).not.toBe(vendorB);

    const mappings = listModelCatalogMappings() as Parameters<typeof selectTaskMapping>[0];
    const i2vMappings = mappings.filter((m) => [vendorA, vendorB].includes(m.vendorKey) && m.taskKind === "image_to_video");
    expect(i2vMappings).toHaveLength(2); // 没被覆盖成 1 条
    const pickA = mappings.find((mapping) => mapping.vendorKey === vendorA && mapping.modelKey === keyA);
    const pickB = mappings.find((mapping) => mapping.vendorKey === vendorB && mapping.modelKey === keyB);
    expect(pickA?.modelKey).toBe(keyA);
    expect(pickB?.modelKey).toBe(keyB);
    expect(JSON.stringify(pickA?.create.body)).toContain("{{request.prompt}}"); // 提示词已注参
  });

  it("删除导入 workflow 模型时级联删除同 modelKey 的 mapping，不影响其他导入", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { deleteModelCatalogModels, listModelCatalogModels, listModelCatalogMappings } = await import("./catalogStore");
    const textA = videoWorkflow("dragon A");
    const textB = videoWorkflow("dragon B");
    const bindA = (analyzeComfyWorkflowText(textA) as { analysis: { suggested: unknown } }).analysis.suggested;
    const bindB = (analyzeComfyWorkflowText(textB) as { analysis: { suggested: unknown } }).analysis.suggested;
    const resultA = importComfyWorkflowToCatalog({ text: textA, binding: bindA, labelZh: "WAN A" }, "a1") as { modelKey: string; vendorKey: string };
    const resultB = importComfyWorkflowToCatalog({ text: textB, binding: bindB, labelZh: "WAN B" }, "b2") as { modelKey: string; vendorKey: string };
    const keyA = resultA.modelKey;
    const keyB = resultB.modelKey;

    deleteModelCatalogModels([{ vendorKey: resultA.vendorKey, modelKey: keyA }]);

    expect(listModelCatalogModels({ vendorKey: resultA.vendorKey })).toHaveLength(0);
    expect(listModelCatalogMappings({ vendorKey: resultA.vendorKey })).toHaveLength(0);
    expect((listModelCatalogModels({ vendorKey: resultB.vendorKey }) as Array<{ modelKey: string }>).map((m) => m.modelKey)).toContain(keyB);
    expect((listModelCatalogMappings({ vendorKey: resultB.vendorKey }) as Array<{ modelKey?: string }>).map((m) => m.modelKey)).toContain(keyB);
  });

  it("编辑 active workflow 时写隔离 staged revision，不删除或覆盖 active model/mapping", async () => {
    emptyCatalog();
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog, updateComfyWorkflowInCatalog } = await import("./comfyuiWorkflowImportStore");
    const {
      listModelCatalogModels,
      listModelCatalogMappings,
      upsertModelCatalogVendor,
      upsertModelCatalogModel,
      upsertModelCatalogMapping,
    } = await import("./catalogStore");
    const oldText = videoWorkflow("old i2v");
    const oldBinding = (analyzeComfyWorkflowText(oldText) as { analysis: { suggested: unknown } }).analysis.suggested;
    const initial = importComfyWorkflowToCatalog({ text: oldText, binding: oldBinding, labelZh: "WAN edit me" }, "same") as { modelKey: string; vendorKey: string };
    const modelKey = initial.modelKey;
    const stagedModel = (listModelCatalogModels({ vendorKey: initial.vendorKey }) as Array<Record<string, unknown>>)
      .find((model) => model.modelKey === modelKey);
    const stagedMapping = (listModelCatalogMappings({ vendorKey: initial.vendorKey }) as Array<Record<string, unknown>>)
      .find((mapping) => mapping.modelKey === modelKey);
    expect(stagedModel).toBeTruthy();
    expect(stagedMapping).toBeTruthy();
    // A staged import is intentionally disabled until certification. Mark the
    // whole candidate vendor active as well as its model/mapping so this
    // fixture represents the real post-certification predecessor. The
    // identity planner must then preserve it while writing the edited
    // workflow into a new isolated candidate revision.
    upsertModelCatalogVendor({ key: initial.vendorKey, enabled: true });
    upsertModelCatalogModel({
      ...stagedModel,
      enabled: true,
      meta: {
        ...((stagedModel?.meta as Record<string, unknown>) || {}),
        adapter: { state: "verified", activeRevision: "comfy-active", modes: [{ taskKind: "image_to_video", state: "verified" }] },
      },
    });
    upsertModelCatalogMapping({ ...stagedMapping, enabled: true });
    expect(listModelCatalogMappings({ vendorKey: initial.vendorKey }) as Array<{ taskKind: string; modelKey?: string }>)
      .toContainEqual(expect.objectContaining({ modelKey, taskKind: "image_to_video" }));

    const nextText = textToVideoWorkflow("new t2v");
    const nextBinding = (analyzeComfyWorkflowText(nextText) as { analysis: { suggested: unknown } }).analysis.suggested;
    const beforeModels = structuredClone(listModelCatalogModels({ vendorKey: initial.vendorKey }));
    const beforeMappings = structuredClone(listModelCatalogMappings({ vendorKey: initial.vendorKey }));
    const r = updateComfyWorkflowInCatalog({ vendorKey: initial.vendorKey, modelKey, text: nextText, binding: nextBinding, labelZh: "WAN edited" });
    expect(r).toMatchObject({ ok: true, modelKey, taskKind: "text_to_video" });
    expect(r).toHaveProperty("revisionId");
    expect(r).toHaveProperty("vendorKey");

    expect(listModelCatalogModels({ vendorKey: initial.vendorKey })).toEqual(beforeModels);
    expect(listModelCatalogMappings({ vendorKey: initial.vendorKey })).toEqual(beforeMappings);
    const candidateVendorKey = (r as { vendorKey: string }).vendorKey;
    expect(candidateVendorKey).not.toBe(initial.vendorKey);
    expect(listModelCatalogModels({ vendorKey: candidateVendorKey })).toContainEqual(expect.objectContaining({
      modelKey, labelZh: "WAN edited", enabled: false,
      meta: expect.objectContaining({ comfyWorkflowImport: expect.objectContaining({ text: nextText }) }),
    }));
    expect(listModelCatalogMappings({ vendorKey: candidateVendorKey })).toContainEqual(expect.objectContaining({
      modelKey, taskKind: "text_to_video", enabled: false,
    }));
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

describe("多实例：两台 ComfyUI 互不串台（方案 A · key 前缀身份）", () => {
  it("isComfyuiVendor：第一台与第 2+ 台都认，别家一律不认", async () => {
    const { isComfyuiVendor } = await import("./types");
    expect(isComfyuiVendor({ key: "comfyui-local" })).toBe(true);
    expect(isComfyuiVendor({ key: "comfyui-local-workstation" })).toBe(true);
    for (const key of ["apimart", "kie", "comfyui", "comfyui-cloud", "", undefined]) {
      expect(isComfyuiVendor({ key }), String(key)).toBe(false);
    }
    expect(isComfyuiVendor(null)).toBe(false);
  });

  it("导入到第二台：model 与 mapping 都落在那一台名下（不串到第一台）", async () => {
    const { importComfyWorkflow } = await import("./comfyuiWorkflowImport");
    const models: Array<Record<string, unknown>> = [];
    const mappings: Array<Record<string, unknown>> = [];
    importComfyWorkflow(
      {
        text: JSON.stringify({
          "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "a.safetensors" } },
          "9": { class_type: "SaveImage", inputs: { filename_prefix: "x", images: ["1", 0] } },
        }),
        binding: { outputNodeId: "9", outputKind: "image", params: [] },
        labelZh: "工作站的图",
        modelKey: "comfy-ws-1",
        vendorKey: "comfyui-local-workstation",
      },
      (m) => models.push(m),
      (m) => mappings.push(m),
    );
    expect(models[0].vendorKey).toBe("comfyui-local-workstation");
    expect(mappings[0].vendorKey).toBe("comfyui-local-workstation");
  });

  it("缺省仍是第一台（存量零迁移）", async () => {
    const { buildComfyImportModelMapping } = await import("./comfyuiWorkflowImport");
    const built = { templatedGraph: {}, parameters: [], kind: "image" as const, taskKind: "text_to_image" as const };
    const { model, mapping } = buildComfyImportModelMapping(built, { modelKey: "k", labelZh: "旧的" });
    expect(model.vendorKey).toBe("comfyui-local");
    expect(mapping.vendorKey).toBe("comfyui-local");
  });

  it("SSRF 信任：每台只信自己的 origin（多一台不放宽范围）", async () => {
    const { trustedLocalOutputOrigin } = await import("./assetLocalization");
    expect(trustedLocalOutputOrigin({ key: "comfyui-local", baseUrlHint: "http://127.0.0.1:8188" })).toBe("http://127.0.0.1:8188");
    expect(trustedLocalOutputOrigin({ key: "comfyui-local-ws", baseUrlHint: "http://192.168.1.9:8188" })).toBe("http://192.168.1.9:8188");
    // 别家 vendor 即便配了私网地址也不给信任
    expect(trustedLocalOutputOrigin({ key: "apimart", baseUrlHint: "http://192.168.1.9:8188" })).toBeNull();
  });
});

describe("reconcileComfyWorkflowTexts（设置页批量缺件对账）", () => {
  it("20 条 workflow 只读取一次 /object_info，并按 id 返回独立结果", async () => {
    emptyCatalog();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      CLIPTextEncode: { input: { required: { text: ["STRING"] } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["m.safetensors"]] } } },
      KSampler: { input: { required: { seed: ["INT"], steps: ["INT"] } } },
      CreateVideo: { input: { required: {} } },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const { reconcileComfyWorkflowTexts } = await import("./comfyuiWorkflowImportStore");
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `workflow-${index}`, text: textToVideoWorkflow(`prompt ${index}`) }));

    const result = await reconcileComfyWorkflowTexts(items);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.results).toHaveLength(20);
    expect(result.results.map((item) => item.id)).toEqual(items.map((item) => item.id));
    expect(result.results.every((item) => item.result.ok && item.result.serverReachable)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8188/object_info", expect.any(Object));
    vi.unstubAllGlobals();
  });

  it("坏 workflow 只让该条失败，其他条仍完成对账", async () => {
    emptyCatalog();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      CLIPTextEncode: { input: { required: {} } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["m.safetensors"]] } } },
      KSampler: { input: { required: {} } },
      CreateVideo: { input: { required: {} } },
    }))));
    const { reconcileComfyWorkflowTexts } = await import("./comfyuiWorkflowImportStore");
    const result = await reconcileComfyWorkflowTexts([
      { id: "bad", text: "{bad json" },
      { id: "good", text: textToVideoWorkflow("ok") },
    ]);
    expect(result).toMatchObject({
      ok: true,
      results: [
        { id: "bad", result: { ok: false } },
        { id: "good", result: { ok: true, serverReachable: true } },
      ],
    });
    vi.unstubAllGlobals();
  });
});
