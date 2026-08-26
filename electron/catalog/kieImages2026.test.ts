import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { KIE_IMAGE_MODELS_2026 } from "./kieImages2026";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { applyParamMap } from "./paramTranslate";
import { taskTemplateParams } from "./taskParams";
import type { CatalogState, HttpOperation } from "./types";

// ---------------------------------------------------------------------------
// 2026-08-26 新接入图像模型的**线缆锁**：断言真实渲染出来的 body 字段名与取值。
// 为什么档案层的契约锁不够——本轮最阴的两个坑都只在 body 里现形，且都是**静默错误**：
//   1. kie Nano Banana 2 主款的输入图字段叫 `image_input`，同族 lite 却叫 `image_urls`。
//      写错不会报错，只是参考图全丢、当纯文生图跑（用户只觉得「这模型不看参考图」）。
//   2. FLUX.2 改图字段叫 `input_urls`（非 image_urls）。同样静默。
// 数字与字段名出处见各档案 sources（nanoBanana2.ts / kieSeedream5.ts / flux2Pro.ts）。
// ---------------------------------------------------------------------------

const emptyCatalog = (): CatalogState => ({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });

/** 渲染某条 curated mapping 的 create body（模拟真实发请求那一刻）。 */
function renderBody(opts: {
  create: HttpOperation;
  modelKey: string;
  kind: string;
  extras: Record<string, unknown>;
  baseUrl: string;
}) {
  const request = { kind: opts.kind, prompt: "一个站在雨里的女孩", extras: opts.extras };
  const context = buildTemplateContext({
    request,
    params: applyParamMap(opts.create.paramMap, taskTemplateParams(request)),
    model: { modelKey: opts.modelKey },
    modelKey: opts.modelKey,
    apiKey: "TEST_SECRET",
  });
  const built = buildHttpRequest({
    baseUrl: opts.baseUrl,
    authType: "bearer",
    apiKey: "TEST_SECRET",
    context,
    operation: opts.create,
  });
  return built.body as Record<string, unknown>;
}

const kieMapping = (modelKey: string, taskKind: string) => {
  const model = KIE_IMAGE_MODELS_2026.find((m) => m.modelKey === modelKey);
  if (!model) throw new Error(`kie model ${modelKey} 未登记`);
  const mapping = model.mappings.find((m) => m.taskKind === taskKind);
  if (!mapping) throw new Error(`kie model ${modelKey} 缺 ${taskKind} mapping`);
  return mapping;
};

const renderKie = (modelKey: string, taskKind: string, extras: Record<string, unknown>) =>
  renderBody({ create: kieMapping(modelKey, taskKind).create, modelKey, kind: taskKind, extras, baseUrl: "https://api.kie.ai" });

const REFS = ["https://example.com/a.png", "https://example.com/b.png"];

describe("kie 2026-08 图像模型 · 种子登记", () => {
  it("五个新模型都进了 kie 的 curated 目录，且各带文生图+改图两条 mapping", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), "2026-08-26T00:00:00.000Z");
    const kieKeys = state.models.filter((m) => m.vendorKey === "kie").map((m) => m.modelKey);
    expect(kieKeys).toEqual(expect.arrayContaining([
      "nano-banana-2", "nano-banana-2-lite",
      "seedream/5-pro-text-to-image", "seedream/5-lite-text-to-image",
      "flux-2/pro-text-to-image",
    ]));
    // 老一代仍在（本轮是新增，不是替换）。
    expect(kieKeys).toEqual(expect.arrayContaining(["nano-banana", "seedream"]));

    for (const model of KIE_IMAGE_MODELS_2026) {
      const ids = state.mappings.filter((m) => m.vendorKey === "kie" && m.modelKey === model.modelKey).map((m) => m.taskKind).sort();
      expect(ids, model.modelKey).toEqual(["image_edit", "text_to_image"]);
    }
  });

  it("每个新模型的 archetypeId 都指向真实存在的档案", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), "2026-08-26T00:00:00.000Z");
    for (const model of KIE_IMAGE_MODELS_2026) {
      const row = state.models.find((m) => m.vendorKey === "kie" && m.modelKey === model.modelKey)!;
      // meta 在 catalog 类型里是 unknown（用户可写的自由字段）→ 断言前先窄化，别用 any 糊过去。
      const meta = row.meta as { archetypeId?: string } | undefined;
      expect(meta?.archetypeId, model.modelKey).toBe(model.archetypeId);
    }
  });
});

describe("Nano Banana 2 · 线缆", () => {
  it("主款改图用 image_input（不是 image_urls）——写错会静默丢掉全部参考图", () => {
    const body = renderKie("nano-banana-2", "image_edit", { image_urls: REFS, aspect_ratio: "16:9", resolution: "2K", output_format: "png" });
    const input = body.input as Record<string, unknown>;
    expect(input.image_input).toEqual(REFS);
    expect(input).not.toHaveProperty("image_urls");
    // 单 id 双模式：改图不换 model（与 seedream/flux 的两 id 结构相反）。
    expect(body.model).toBe("nano-banana-2");
  });

  it("lite 改图反而用 image_urls，且不发 resolution / output_format（文档里没有这两个字段）", () => {
    const body = renderKie("nano-banana-2-lite", "image_edit", { image_urls: REFS, aspect_ratio: "auto", resolution: "4K", output_format: "png" });
    const input = body.input as Record<string, unknown>;
    expect(input.image_urls).toEqual(REFS);
    expect(input).not.toHaveProperty("image_input");
    // 即使上层塞了 resolution/output_format，也不该发出去。
    expect(input).not.toHaveProperty("resolution");
    expect(input).not.toHaveProperty("output_format");
    expect(body.model).toBe("nano-banana-2-lite");
  });

  it("文生图不带任何输入图字段", () => {
    const input = renderKie("nano-banana-2", "text_to_image", { aspect_ratio: "auto", resolution: "1K", output_format: "png" }).input as Record<string, unknown>;
    expect(input).not.toHaveProperty("image_input");
    expect(input).not.toHaveProperty("image_urls");
    expect(input.aspect_ratio).toBe("auto");
    expect(input.resolution).toBe("1K");
  });

  it("apimart 侧走扁平 body + image_urls，model 用 gemini-3.1-flash-image-preview", () => {
    const model = APIMART_IMAGE_MODELS.find((m) => m.modelKey === "gemini-3.1-flash-image-preview")!;
    const mapping = model.mappings.find((m) => m.taskKind === "image_edit")!;
    const body = renderBody({ create: mapping.create, modelKey: model.modelKey, kind: "image_edit", extras: { size: "16:9", resolution: "4K", image_urls: REFS }, baseUrl: "https://api.apimart.ai" });
    expect(body.model).toBe("gemini-3.1-flash-image-preview");
    expect(body.image_urls).toEqual(REFS); // 扁平，不嵌 input
    expect(body.size).toBe("16:9");
    expect(body.resolution).toBe("4K");
    expect(model.archetypeId).toBe("nano-banana-2");
  });
});

describe("kie Seedream 5.0 · 线缆（两 id 结构）", () => {
  it("改图发的是 image-to-image 那个 model id，由档案 modelEnum 供给", () => {
    // kie 把两种能力拆成两个 model id；body.model 读 {{request.params.model}}，
    // 值来自档案当前 mode 的 modelEnum。这条断言就是「两 id 收口在档案层」的证据。
    const body = renderKie("seedream/5-pro-text-to-image", "image_edit", {
      model: "seedream/5-pro-image-to-image", image_urls: REFS, aspect_ratio: "9:16", quality: "high", output_format: "png",
    });
    expect(body.model).toBe("seedream/5-pro-image-to-image");
    const input = body.input as Record<string, unknown>;
    expect(input.image_urls).toEqual(REFS);
    expect(input.quality).toBe("high");
    expect(input.aspect_ratio).toBe("9:16");
  });

  it("lite 能发出 ultra 质量档（pro 没有这档）", () => {
    const input = renderKie("seedream/5-lite-text-to-image", "text_to_image", {
      model: "seedream/5-lite-text-to-image", aspect_ratio: "1:1", quality: "ultra", output_format: "jpeg",
    }).input as Record<string, unknown>;
    expect(input.quality).toBe("ultra");
    expect(input.output_format).toBe("jpeg");
  });

  it("文生图不带 image_urls（kie 的 t2i 端点没有这个字段）", () => {
    const input = renderKie("seedream/5-pro-text-to-image", "text_to_image", {
      model: "seedream/5-pro-text-to-image", aspect_ratio: "1:1", quality: "basic", output_format: "png",
    }).input as Record<string, unknown>;
    expect(input).not.toHaveProperty("image_urls");
  });
});

describe("FLUX.2 Pro · 线缆", () => {
  it("改图用 input_urls（非 image_urls），并发 image-to-image 的 model id", () => {
    const body = renderKie("flux-2/pro-text-to-image", "image_edit", {
      model: "flux-2/pro-image-to-image", input_urls: REFS, aspect_ratio: "auto", resolution: "2K",
    });
    expect(body.model).toBe("flux-2/pro-image-to-image");
    const input = body.input as Record<string, unknown>;
    expect(input.input_urls).toEqual(REFS);
    expect(input).not.toHaveProperty("image_urls");
    expect(input.aspect_ratio).toBe("auto"); // auto 只在改图端点合法
  });

  it("文生图只发 prompt + aspect_ratio + resolution", () => {
    const input = renderKie("flux-2/pro-text-to-image", "text_to_image", {
      model: "flux-2/pro-text-to-image", aspect_ratio: "16:9", resolution: "1K",
    }).input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "prompt", "resolution"]);
  });
});

describe("Qwen-Image 3.0 · 线缆（apimart）", () => {
  it("Pro 变体把 model 换成 qwen-image-3.0-pro，改图带 image_urls", () => {
    const model = APIMART_IMAGE_MODELS.find((m) => m.modelKey === "qwen-image-3.0")!;
    const mapping = model.mappings.find((m) => m.taskKind === "image_edit")!;
    const body = renderBody({
      create: mapping.create, modelKey: model.modelKey, kind: "image_edit",
      extras: { model: "qwen-image-3.0-pro", size: "3:2", resolution: "2K", image_urls: REFS },
      baseUrl: "https://api.apimart.ai",
    });
    expect(body.model).toBe("qwen-image-3.0-pro");
    expect(body.image_urls).toEqual(REFS);
    expect(body.size).toBe("3:2");
    expect(model.archetypeId).toBe("qwen-image-3");
  });

  it("没填负向提示时不发 negative_prompt 字段", () => {
    const model = APIMART_IMAGE_MODELS.find((m) => m.modelKey === "qwen-image-3.0")!;
    const mapping = model.mappings.find((m) => m.taskKind === "text_to_image")!;
    const body = renderBody({
      create: mapping.create, modelKey: model.modelKey, kind: "text_to_image",
      extras: { model: "qwen-image-3.0", size: "1:1", resolution: "1K" },
      baseUrl: "https://api.apimart.ai",
    });
    expect(body).not.toHaveProperty("negative_prompt");
  });
});
