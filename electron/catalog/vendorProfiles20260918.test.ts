import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { KIE_IMAGE_MODELS_2026 } from "./kieImages2026";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { applyParamMap } from "./paramTranslate";
import { taskTemplateParams } from "./taskParams";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { KIE_GPT_IMAGE_25_ONE_K_ONLY_RATIOS, KIE_GPT_IMAGE_25_TRANSFORM, validateKieGptImage25Body } from "./kieGptImage25";
import { applyRequestTransformSync, validateRequestTransformSync } from "../tasks/requestTransforms";
import type { CatalogState, HttpOperation } from "./types";

// ---------------------------------------------------------------------------
// 2026-09-18 接入批的**线缆锁 + 否定式锁**（GPT Image 2.5 Flare/Sunburst · Imagen 4 Fast/Ultra ·
// Gemini 3 Pro 图像 · Grok Imagine 2.0 Ext）。
//
// 为什么这批需要自己的锁：本批四处差异**全是静默的**——发出去 HTTP 200，只是结果不对或参数没生效：
//   1. 改图输入图字段名三家三个名字：kie `input_urls` / apimart `image_urls` / 档案槽（Gemini 走
//      Runway 契约）`reference_image_urls`。抄错 = 参考图全丢、当纯文生图跑。
//   2. apimart 的 GPT Image 2.5 清晰度必须**小写** `1k/2k/4k`；发大写会被忽略（不报错，出图尺寸不对）。
//   3. `quality` 只有 apimart 有 —— 混进 kie 的 body 会 422；混进基础 params 会在 kie 侧摆出
//      「按了没反应的控件」。
//   4. Grok Imagine 2.0 Ext 在 apimart **没有改图端点**（文档明写 Not supported）——多种一条
//      image_edit mapping 就是造一个永远失败的入口。
// 契约出处逐条在档案 sources 里（gptImage25.ts / imagen4Kie.ts / runwayNativeImage.ts）。
// ---------------------------------------------------------------------------

const emptyCatalog = (): CatalogState => ({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });
const REFS = ["https://example.com/a.png", "https://example.com/b.png"];

function renderBody(opts: { create: HttpOperation; modelKey: string; kind: string; extras: Record<string, unknown>; baseUrl: string }) {
  const request = { kind: opts.kind, prompt: "一个站在雨里的女孩", extras: opts.extras };
  const context = buildTemplateContext({
    request,
    params: applyParamMap(opts.create.paramMap, taskTemplateParams(request, { vendorKey: "", modelKey: opts.modelKey, operation: opts.create })),
    model: { modelKey: opts.modelKey },
    modelKey: opts.modelKey,
    apiKey: "TEST_SECRET",
  });
  return buildHttpRequest({ baseUrl: opts.baseUrl, authType: "bearer", apiKey: "TEST_SECRET", context, operation: opts.create }).body as Record<string, unknown>;
}

const renderKie = (modelKey: string, taskKind: string, extras: Record<string, unknown>) => {
  const model = KIE_IMAGE_MODELS_2026.find((m) => m.modelKey === modelKey)!;
  const mapping = model.mappings.find((m) => m.taskKind === taskKind)!;
  return renderBody({ create: mapping.create, modelKey, kind: taskKind, extras, baseUrl: "https://api.kie.ai" });
};

const apimartModel = (modelKey: string) => APIMART_IMAGE_MODELS.find((m) => m.modelKey === modelKey)!;

const renderApimart = (modelKey: string, taskKind: string, extras: Record<string, unknown>) => {
  const mapping = apimartModel(modelKey).mappings.find((m) => m.taskKind === taskKind)!;
  return renderBody({ create: mapping.create, modelKey, kind: taskKind, extras, baseUrl: "https://api.apimart.ai" });
};

/** 该 (模型, 供应商) 在 UI 上真正给得出的标量参数键（B 分层 vendorParams 已叠加）。 */
const paramKeys = (modelKey: string, vendorKey: string, modeId: string): string[] => {
  const archetype = resolveArchetypeForModel({ modelKey, vendorKey })!;
  return archetype.modes.find((m) => m.id === modeId)!.params.map((p) => p.key).sort();
};

describe("GPT Image 2.5 · kie 线缆（4 个拆分 model id）", () => {
  it("改图发 -image-to-image 那个 id，输入图走 input_urls", () => {
    const body = renderKie("gpt-image-2-5-flare-text-to-image", "image_edit", {
      input_urls: REFS, aspect_ratio: "9:16", resolution: "2K", background: "auto",
    });
    expect(body.model).toBe("gpt-image-2-5-flare-image-to-image");
    const input = body.input as Record<string, unknown>;
    expect(input.input_urls).toEqual(REFS);
    expect(input).not.toHaveProperty("image_urls"); // 抄 apimart 的字段名就会在这里红
    expect(input.resolution).toBe("2K"); // kie 要大写（apimart 才是小写）
  });

  it("kie 的四个端点没有 quality / n / output_format —— 上层塞了也不许发出去", () => {
    const input = renderKie("gpt-image-2-5-sunburst-text-to-image", "text_to_image", {
      aspect_ratio: "auto", resolution: "1K", background: "transparent",
      quality: "max", n: 4, output_format: "webp",
    }).input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "background", "prompt", "resolution"]);
  });

  it("文生图端点不带任何输入图字段", () => {
    const input = renderKie("gpt-image-2-5-flare-text-to-image", "text_to_image", {
      aspect_ratio: "16:9", resolution: "1K", background: "auto",
    }).input as Record<string, unknown>;
    expect(input).not.toHaveProperty("input_urls");
    expect(input).not.toHaveProperty("image_urls");
  });
});

describe("GPT Image 2.5 · apimart 线缆（单 id 双模式）", () => {
  it("改图：槽名 input_urls → 线缆名 image_urls 的键名转接（写错会静默丢光参考图）", () => {
    const body = renderApimart("gpt-image-2.5-flare", "image_edit", {
      input_urls: REFS, size: "3:1", resolution: "2K", quality: "low", background: "auto",
    });
    expect(body.model).toBe("gpt-image-2.5-flare"); // 单 id：改图不换 model
    expect(body.image_urls).toEqual(REFS);
    expect(body).not.toHaveProperty("input_urls");
    expect(body.size).toBe("3:1"); // apimart 独有画幅，kie 那 13 档里没有
  });

  it("清晰度必须小写发出（apimart 线缆是 1k/2k/4k，档案给的是 1K/2K/4K）", () => {
    const body = renderApimart("gpt-image-2.5-sunburst", "text_to_image", { size: "16:9", resolution: "4K", quality: "medium", background: "auto" });
    expect(body.resolution).toBe("4k");
    expect(body.quality).toBe("medium");
  });

  it("quality 只在 apimart 那侧可选；kie 那侧连控件都没有（否定式判断的机器锁）", () => {
    expect(paramKeys("gpt-image-2.5-flare", "apimart", "t2i")).toEqual(["background", "quality", "resolution", "size"]);
    expect(paramKeys("gpt-image-2-5-flare-text-to-image", "kie", "t2i")).toEqual(["aspect_ratio", "background", "resolution"]);
  });

  it("两档的改图槽都是 16 张（两家文档一致）", () => {
    for (const key of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
      const slot = resolveArchetypeForModel({ modelKey: key, vendorKey: "apimart" })!.modes.find((m) => m.id === "i2i")!.slots[0];
      expect(slot.max, key).toBe(16);
      expect(slot.inputKey, key).toBe("input_urls");
    }
  });
});

describe("Gemini 3 Pro 图像 · apimart 并入既有 Runway 档案（P4）", () => {
  it("两家共用一个档案 id，不是第二份档案", () => {
    expect(resolveArchetypeForModel({ modelKey: "gemini-3-pro-image-preview", vendorKey: "apimart" })!.id).toBe("gemini-image-3-pro");
    expect(resolveArchetypeForModel({ modelKey: "gemini_image3_pro", vendorKey: "runway" })!.id).toBe("gemini-image-3-pro");
  });

  it("改图：Runway 契约槽名 reference_image_urls → apimart 线缆名 image_urls", () => {
    const body = renderApimart("gemini-3-pro-image-preview", "image_edit", { reference_image_urls: REFS, size: "21:9", resolution: "2K" });
    expect(body.image_urls).toEqual(REFS);
    expect(body).not.toHaveProperty("reference_image_urls");
    expect(body.resolution).toBe("2K"); // 这页文档是**大写**，不套 GPT 2.5 那条小写规则
  });

  it("参考图上限 14（模型本身的能力，两家一致）", () => {
    const slot = resolveArchetypeForModel({ modelKey: "gemini-3-pro-image-preview", vendorKey: "apimart" })!.modes.find((m) => m.id === "i2i")!.slots[0];
    expect(slot.max).toBe(14);
  });

  it("apimart 侧给朝向式比例，Runway 侧给像素式比例（一个值在另一家都不合法）", () => {
    const apimartOptions = resolveArchetypeForModel({ modelKey: "gemini-3-pro-image-preview", vendorKey: "apimart" })!
      .modes.find((m) => m.id === "t2i")!.params.find((p) => p.key === "size")!.options!.map((o) => o.value);
    expect(apimartOptions).toContain("16:9");
    expect(apimartOptions.some((v) => String(v).includes("1344"))).toBe(false);
  });
});

describe("Grok Imagine 2.0 Ext · apimart 只有文生图（文档明写 Not supported: image-to-image）", () => {
  it("catalog 只种 t2i 一条 mapping，绝不种 image_edit", () => {
    expect(apimartModel("grok-imagine-2.0-ext").mappings.map((m) => m.taskKind)).toEqual(["text_to_image"]);
    const { state } = applyBuiltinSeeds(emptyCatalog(), "2026-09-18T00:00:00.000Z");
    const kinds = state.mappings.filter((m) => m.vendorKey === "apimart" && m.modelKey === "grok-imagine-2.0-ext").map((m) => m.taskKind);
    expect(kinds).toEqual(["text_to_image"]);
  });

  it("并进既有档案而非新建第二份", () => {
    expect(resolveArchetypeForModel({ modelKey: "grok-imagine-2.0-ext", vendorKey: "apimart" })!.id).toBe("grok-imagine-image-2");
  });

  it("只发 size —— resolution 唯一合法值是 \"quality\"，档案因此不摆这个控件", () => {
    const body = renderApimart("grok-imagine-2.0-ext", "text_to_image", { size: "9:16", resolution: "4K", n: 8 });
    expect(Object.keys(body).sort()).toEqual(["model", "prompt", "size"]);
    expect(paramKeys("grok-imagine-2.0-ext", "apimart", "t2i")).toEqual(["size"]);
  });
});

describe("Imagen 4 Fast / Ultra · kie（纯文生图）", () => {
  it("两档默认比例不同（fast 16:9 / ultra 1:1）—— 文档 default 逐字不同，别照抄", () => {
    const ratioDefault = (modelKey: string) =>
      resolveArchetypeForModel({ modelKey, vendorKey: "kie" })!.modes[0].params.find((p) => p.key === "aspect_ratio")!.defaultValue;
    expect(ratioDefault("google/imagen4-fast")).toBe("16:9");
    expect(ratioDefault("google/imagen4-ultra")).toBe("1:1");
  });

  it("没有改图模式，也不种 image_edit mapping（input 里根本没有图片字段）", () => {
    for (const key of ["google/imagen4-fast", "google/imagen4-ultra"]) {
      expect(resolveArchetypeForModel({ modelKey: key, vendorKey: "kie" })!.modes.map((m) => m.id), key).toEqual(["t2i"]);
      expect(KIE_IMAGE_MODELS_2026.find((m) => m.modelKey === key)!.mappings.map((m) => m.taskKind), key).toEqual(["text_to_image"]);
    }
  });

  it("body 只发 prompt + aspect_ratio + negative_prompt；seed 两档类型不同故一律不发", () => {
    const input = renderKie("google/imagen4-ultra", "text_to_image", { aspect_ratio: "3:4", negative_prompt: "模糊", seed: 7 }).input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["aspect_ratio", "negative_prompt", "prompt"]);
    expect(input.aspect_ratio).toBe("3:4");
  });

  it("负向提示词不填就不发（模板丢弃 undefined 键，不发空串惹 vendor 报错）", () => {
    const input = renderKie("google/imagen4-fast", "text_to_image", { aspect_ratio: "16:9" }).input as Record<string, unknown>;
    expect(input).not.toHaveProperty("negative_prompt");
  });
});

describe("GPT Image 2.5 · kie 跨字段约束（发请求前就拦，不等 vendor 报错）", () => {
  const body = (ratio: string, resolution: string) => ({ model: "gpt-image-2-5-flare-text-to-image", input: { prompt: "x", aspect_ratio: ratio, resolution } });

  it.each(KIE_GPT_IMAGE_25_ONE_K_ONLY_RATIOS)("%s 画幅配 4K 被拒（文档：这四档只支持 1K）", (ratio) => {
    expect(() => validateKieGptImage25Body(body(ratio, "4K"))).toThrow();
    // 两个阶段（预检与真发前）用的是同一个注册项，不能只拦一头。
    expect(() => validateRequestTransformSync(KIE_GPT_IMAGE_25_TRANSFORM, body(ratio, "2K"), { baseUrl: "" })).toThrow();
    expect(() => applyRequestTransformSync(KIE_GPT_IMAGE_25_TRANSFORM, body(ratio, "2K"), { baseUrl: "" })).toThrow();
  });

  it("同样这四档配 1K 放行；普通画幅配 4K 也放行（别把闸修成一刀切）", () => {
    expect(() => validateKieGptImage25Body(body("27:16", "1K"))).not.toThrow();
    expect(() => validateKieGptImage25Body(body("16:9", "4K"))).not.toThrow();
  });

  it("两条 mapping（文生图 + 改图）都挂上了这道闸——只挂一条等于没挂", () => {
    for (const key of ["gpt-image-2-5-flare-text-to-image", "gpt-image-2-5-sunburst-text-to-image"]) {
      const model = KIE_IMAGE_MODELS_2026.find((m) => m.modelKey === key)!;
      expect(model.mappings.map((m) => m.create.request_transform), key).toEqual([KIE_GPT_IMAGE_25_TRANSFORM, KIE_GPT_IMAGE_25_TRANSFORM]);
    }
  });
});
