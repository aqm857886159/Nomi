/**
 * 按 APIMart 官方页对齐的那几处，在 **Run 路**（Agent / 生成门走的引擎 B）上也同样成立。
 *
 * 渲染层（画布）由 `electron/catalog/apimartMediaDocsAlign.test.ts` 钉住；这里钉 Run 路真发出去的报文：
 *   · Vidu Q4 参考生 1 张图：走 image_with_roles、role = reference_image，不发 image_urls / first_frame_image
 *     （官方：只有 1 张、没有参考音频时不写 role reference_image 就按图生视频）；
 *   · Gemini Omni 1.2 Flash Ext 首尾帧：first_frame_image + last_frame_image 都发出去；
 *   · Grok Imagine Image 2.0 官方通道：不带 X-APIMart-Response-Version 头（协调 2026-11-07 选 C）。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-docs-align-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";
import { getArchetypeById, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";

const REF_A = "https://assets.example.com/docs-align/a.png";
const REF_B = "https://assets.example.com/docs-align/b.png";

let capture: FetchCapture;

beforeAll(async () => {
  capture = installFetchCapture();
  await seedParityCatalog(["apimart"]);
}, 60_000);

afterAll(() => { capture?.restore(); });

type Role = "first_frame" | "last_frame" | "reference";

async function videoBody(modelId: string, modeId: string | undefined, refs: Array<{ url: string; role: Role }>, parameters: Record<string, unknown> = {}) {
  capture.reset();
  const references = refs.map((ref, index) => ({ assetId: ref.url, contentHash: `docs-align-${index}`, version: 1, kind: "image" as const, role: ref.role }));
  const referenceUrls = Object.fromEntries(references.map((reference, index) => [spendReferenceKey(reference), refs[index]!.url]));
  const record = await driveEngineB(capture, {
    vendorKey: "apimart",
    modelId,
    mode: "image_to_video",
    ...(modeId ? { modeId } : {}),
    prompt: "镜头缓缓推近，人物转身看向窗外",
    parameters,
    references,
    referenceUrls,
  });
  if (!record.request) throw new Error(`没有出站报文: ${JSON.stringify(record.failure)}`);
  return record.request.body as Record<string, unknown>;
}

async function canvasBody(modelKey: string, archetypeId: string, modeId: string, urls: string[], kind: "image" | "video" = "video") {
  const node = createGenerationNode({ id: "parity-node", kind, prompt: "人物转身" });
  node.meta = { modelKey, modelVendor: "apimart", vendor: "apimart", archetype: { id: archetypeId, modeId }, referenceImageUrls: urls };
  const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
  const record = await driveEngineA(capture, { vendorKey: "apimart", kind: request.kind, prompt: request.prompt, extras: request.extras ?? {} });
  expect(record.request, JSON.stringify(record.failure)).toBeTruthy();
  return record.request!.body as Record<string, unknown>;
}

describe("画布生成和 Agent 运行在实际出站边界遵守选中模式的参考槽", () => {
  it("GPT Image 2 的 APIMart 限 15；同一个老档案在 KIE 保留 16", () => {
    const archetype = getArchetypeById("gpt-image-2")!;
    const max = (vendorKey: string) => specializeArchetypeForVendor(archetype, vendorKey)
      .modes.find(({id}) => id === "i2i")!.slots[0]!.max;
    expect(max("apimart")).toBe(15);
    expect(max("kie")).toBe(16);
    expect(archetype.modes.find(({id}) => id === "i2i")!.slots[0]!.max).toBe(16);
  });

  it.each([1, 8, 15, 16])("Vidu Q4 参考 %i 张，每张只发一次", async (count) => {
    const urls = Array.from({ length: count }, (_, i) => `https://assets.example.com/q4/${i}.png`);
    const expected = urls.slice(0, 15).map((url) => ({ url, role: "reference_image" }));
    const canvas = await canvasBody("viduq4-preview", "viduq4-preview", "ref", urls);
    expect(canvas.image_with_roles).toEqual(expected);
    expect(canvas).not.toHaveProperty("image_urls");
    expect(canvas).not.toHaveProperty("first_frame_image");
    const run = videoBody("viduq4-preview", "ref", urls.map((url) => ({ url, role: "reference" })));
    if (count > 15) {
      await expect(run).rejects.toThrow(/15/);
      expect(capture.calls).toHaveLength(0);
    } else {
      const body = await run;
      expect(body.image_with_roles).toEqual(expected);
      expect(body).not.toHaveProperty("image_urls");
      expect(body).not.toHaveProperty("first_frame_image");
    }
  });

  it.each([
    ["doubao-seedance-2.0", "seedance-2-apimart"],
    ["doubao-seedance-2.5", "seedance-2.5-apimart"],
    ["wan3.0-video", "wan-3.0-apimart"],
  ])("%s 的首尾帧各占一个角色，次序一致", async (model, archetype) => {
    const refs = [{ url: REF_A, role: "first_frame" }, { url: REF_B, role: "last_frame" }] as const;
    const canvas = await canvasBody(model, archetype, "firstlast", [REF_A, REF_B]);
    const run = await videoBody(model, "firstlast", [...refs]);
    for (const body of [canvas, run]) {
      expect(body.image_with_roles).toEqual(refs);
      expect(body).not.toHaveProperty("image_urls");
    }
  });

  it("Veo 的扁平首尾槽按声明排序，Agent 合同的输入顺序可以相反", async () => {
    const canvas = await canvasBody("veo3.1-fast", "veo-3.1", "frame", [REF_A, REF_B]);
    const run = await videoBody("veo3.1-fast", "frame", [{ url: REF_B, role: "last_frame" }, { url: REF_A, role: "first_frame" }]);
    for (const body of [canvas, run]) {
      expect(body.image_urls).toEqual([REF_A, REF_B]);
      expect(body.generation_type).toBe("frame");
      expect(body).not.toHaveProperty("image_with_roles");
    }
  });

  it.each([1, 10])("Wan 3.0 参考 %i 张按 reference 方式提交", async (n) => {
    const urls = Array.from({ length: n }, (_, i) => `https://assets.example.com/wan/${i}.png`);
    const canvas = await canvasBody("wan3.0-video", "wan-3.0-apimart", "ref", urls);
    const run = await videoBody("wan3.0-video", "ref", urls.map((url) => ({ url, role: "reference" })), { generation_type: "frame" });
    for (const body of [canvas, run]) {
      expect(body.image_urls).toEqual(urls);
      expect(body.generation_type).toBe("reference");
      expect(body).not.toHaveProperty("image_with_roles");
    }
  });

  it.each([
    ["gemini-3-pro-image-preview", "gemini-image-3-pro", 1],
    ["gemini-3-pro-image-preview", "gemini-image-3-pro", 14],
    ["gpt-image-2", "gpt-image-2", 16],
  ] as const)("%s %s 改图 %i 张按所选渠道承载", async (model, archetype, n) => {
    const urls = Array.from({ length: n }, (_, i) => `https://assets.example.com/edit/${i}.png`);
    const canvas = await canvasBody(model, archetype, "i2i", urls, "image");
    expect(canvas.image_urls).toEqual(urls.slice(0, 15));
    const references = urls.map((url, index) => ({ assetId: url, contentHash: `edit-${index}`, version: 1, kind: "image" as const, role: "reference" as const }));
    capture.reset();
    const run = await driveEngineB(capture, {
      vendorKey: "apimart", modelId: model, mode: "image_edit", prompt: "改图", parameters: {},
      references, referenceUrls: Object.fromEntries(references.map((ref) => [spendReferenceKey(ref), ref.assetId])),
    });
    if (n === 16) {
      expect(capture.calls).toHaveLength(0);
      expect(run.failure?.message).toMatch(/15/);
    } else {
      expect(run.request?.body, JSON.stringify(run.failure)).toMatchObject({ image_urls: urls });
    }
  });

  it("Wan 2.7 单张参考携带线上角色，两个入口均不回填首帧", async () => {
    const canvas = await canvasBody("wan2.7", "wan-2.7", "ref", [REF_A]);
    const run = await videoBody("wan2.7", "ref", [{ url: REF_A, role: "reference" }]);
    for (const body of [canvas, run]) {
      expect(body.image_with_roles).toEqual([{ url: REF_A, role: "reference_image" }]);
      expect(body).not.toHaveProperty("image_urls");
    }
  });
});

describe("Vidu Q4 预览版参考生：1 张图也按参考，不在背后换成图生", () => {
  it("参考生 1 张 → image_with_roles 一条 role=reference_image，不发 image_urls / first_frame_image", async () => {
    const body = await videoBody("viduq4-preview", "ref", [{ url: REF_A, role: "reference" }]);
    expect(body.image_with_roles).toEqual([{ url: REF_A, role: "reference_image" }]);
    expect(body).not.toHaveProperty("image_urls");
    expect(body).not.toHaveProperty("first_frame_image");
  });

  it("参考生 2 张 → 两条都带 role=reference_image", async () => {
    const body = await videoBody("viduq4-preview", "ref", [{ url: REF_A, role: "reference" }, { url: REF_B, role: "reference" }]);
    expect(body.image_with_roles).toEqual([
      { url: REF_A, role: "reference_image" },
      { url: REF_B, role: "reference_image" },
    ]);
    expect(body).not.toHaveProperty("image_urls");
  });

  it("图生 1 张 → 只发 first_frame_image（不带角色数组）", async () => {
    const body = await videoBody("viduq4-preview", "i2v", [{ url: REF_A, role: "first_frame" }]);
    expect(body.first_frame_image).toBe(REF_A);
    expect(body).not.toHaveProperty("image_with_roles");
    expect(body).not.toHaveProperty("image_urls");
  });
});

describe("Gemini Omni 1.2 Flash Ext：首尾帧两张都发出去", () => {
  it("firstlast → first_frame_image + last_frame_image，比例 16:9", async () => {
    const body = await videoBody("gemini-omni-1.2-flash-ext", "firstlast", [{ url: REF_A, role: "first_frame" }, { url: REF_B, role: "last_frame" }], { duration: 5 });
    expect(body.model).toBe("gemini-omni-1.2-flash-ext");
    expect(body.first_frame_image).toBe(REF_A);
    expect(body.last_frame_image).toBe(REF_B);
    expect(body).not.toHaveProperty("image_urls");
    expect(body.aspect_ratio).toBe("16:9");
  });
});

describe("Grok Imagine Image 2.0 官方通道：Run 路也不带响应版本头", () => {
  it("文生图出站请求头里没有 x-apimart-response-version，按平台默认形状提交", async () => {
    capture.reset();
    const record = await driveEngineB(capture, {
      vendorKey: "apimart",
      modelId: "grok-imagine-image-2.0",
      mode: "text_to_image",
      prompt: "一只红色纸鹤停在窗台上",
      parameters: {},
      references: [],
    });
    expect(record.request, JSON.stringify(record.failure)).toBeTruthy();
    expect(record.request!.path).toBe("/v1/images/generations");
    expect(capture.calls[0]!.headers).not.toHaveProperty("x-apimart-response-version");
    expect((record.request!.body as Record<string, unknown>).model).toBe("grok-imagine-image-2.0");
  });
});
