import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { getArchetypeById } from "../shared/modelArchetypes";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { applyParamMap } from "./paramTranslate";
import { applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";
import { modelReferenceSelection } from "./modelCatalogListing";

// 本批新增的 APIMart 图片 / 视频型号：每个模式按「默认参数 + 参考图」真实造一遍请求，
// 请求体的字段集合必须等于独立抄自官方页的允许集合（多发一个官方不认的字段、少发一个必填字段都红）。
// 期望表是手抄的官方字段名，不从声明里推——声明改错时这里会红。

const REF = "https://example.invalid/ref.png";
const REF2 = "https://example.invalid/ref2.png";

type Expected = { fields: string[]; model: string; values?: Record<string, unknown> };

// 上限（官方页写明的参考图张数）：档案声明的槽上限不许超过它。
const REF_LIMITS: Record<string, number> = {
  // GPT Image 2.6：image_urls 最多 16 张（官方页 gpt-image-2.6/generation，llms-full.txt 6338 行附近）。
  "gpt-image-2.6-flare": 16,
  "gpt-image-2.6-sunburst": 16,
};

const IMAGE_CASES: Record<string, { t2i: Expected; i2i: Expected }> = {
  // ── 分支 2 改过档位（legacy → 可选）且带请求体声明的上一代：字段集合也钉住 ──
  "doubao-seedream-4.5": {
    t2i: { model: "doubao-seedream-4.5", fields: ["model", "prompt", "size", "resolution"] },
    i2i: { model: "doubao-seedream-4.5", fields: ["model", "prompt", "size", "resolution", "image_urls"] },
  },
  "qwen-image-2.0": {
    t2i: { model: "qwen-image-2.0", fields: ["model", "prompt", "size", "resolution"] },
    i2i: { model: "qwen-image-2.0", fields: ["model", "prompt", "size", "resolution", "image_urls"] },
  },
  // GPT Image 2.6 两档（分支 2 的新型号）：默认参数五字段齐发，改图参考图落在官方的 image_urls 数组上。
  // 质量默认 medium 而不是官方默认的 auto（auto 按最高档预扣款）；清晰度发小写 1k。
  "gpt-image-2.6-flare": {
    t2i: { model: "gpt-image-2.6-flare", fields: ["model", "prompt", "size", "resolution", "quality", "background"], values: { resolution: "1k", quality: "medium" } },
    i2i: { model: "gpt-image-2.6-flare", fields: ["model", "prompt", "size", "resolution", "quality", "background", "image_urls"] },
  },
  "gpt-image-2.6-sunburst": {
    t2i: { model: "gpt-image-2.6-sunburst", fields: ["model", "prompt", "size", "resolution", "quality", "background"], values: { resolution: "1k", quality: "medium" } },
    i2i: { model: "gpt-image-2.6-sunburst", fields: ["model", "prompt", "size", "resolution", "quality", "background", "image_urls"] },
  },
  "gemini-nano-banana-2.1": {
    t2i: { model: "gemini-nano-banana-2.1", fields: ["model", "prompt", "size", "resolution"], values: { resolution: "1K" } },
    i2i: { model: "gemini-nano-banana-2.1", fields: ["model", "prompt", "size", "resolution", "image_urls"] },
  },
  "gemini-nano-banana-2.1-ext": {
    t2i: { model: "gemini-nano-banana-2.1-ext", fields: ["model", "prompt", "size", "resolution"], values: { resolution: "1K" } },
    i2i: { model: "gemini-nano-banana-2.1-ext", fields: ["model", "prompt", "size", "resolution", "image_urls"] },
  },
  "gemini-3.1-flash-lite-image": {
    t2i: { model: "gemini-3.1-flash-lite-image", fields: ["model", "prompt", "size"] },
    i2i: { model: "gemini-3.1-flash-lite-image", fields: ["model", "prompt", "size", "image_urls"] },
  },
  "gemini-3.1-flash-lite-image-ext": {
    t2i: { model: "gemini-3.1-flash-lite-image-ext", fields: ["model", "prompt", "size"] },
    i2i: { model: "gemini-3.1-flash-lite-image-ext", fields: ["model", "prompt", "size", "image_urls"] },
  },
  "flux-3-image": {
    t2i: { model: "flux-3-image", fields: ["model", "prompt", "aspect_ratio", "resolution", "grounding"] },
    i2i: { model: "flux-3-image", fields: ["model", "prompt", "aspect_ratio", "resolution", "grounding", "image_urls"] },
  },
  "flux-3-image-klein": {
    t2i: { model: "flux-3-image-klein", fields: ["model", "prompt", "aspect_ratio", "resolution", "output_format", "steps"] }, // seed 留空即用官方默认；steps 默认 16 照发
    i2i: { model: "flux-3-image-klein", fields: ["model", "prompt", "aspect_ratio", "resolution", "output_format", "steps", "image_urls"] },
  },
  "grok-imagine-image-2.0": {
    t2i: { model: "grok-imagine-image-2.0", fields: ["model", "prompt", "aspect_ratio", "resolution", "quality"], values: { quality: "medium" } },
    // 官方：带 image_urls 时不能发 quality。
    i2i: { model: "grok-imagine-image-2.0", fields: ["model", "prompt", "aspect_ratio", "resolution", "image_urls"] },
  },
  "hy-image-v3.5-preview": {
    t2i: { model: "hy-image-v3.5-preview", fields: ["model", "prompt", "size", "resolution"] },
    i2i: { model: "hy-image-v3.5-preview", fields: ["model", "prompt", "size", "resolution", "image_urls"] },
  },
  "muse-image-ext": {
    // 官方：比例不要发 auto；没有默认比例就不发；也没有 resolution。
    t2i: { model: "muse-image-ext", fields: ["model", "prompt"] },
    i2i: { model: "muse-image-ext", fields: ["model", "prompt", "image_urls"] },
  },
  "wan2.7-image": {
    t2i: { model: "wan2.7-image", fields: ["model", "prompt", "size", "resolution"], values: { resolution: "2K" } },
    // 改图的比例跟随最后一张输入图，不发 size。
    i2i: { model: "wan2.7-image", fields: ["model", "prompt", "resolution", "image_urls"] },
  },
  "wan2.7-image-pro": {
    t2i: { model: "wan2.7-image-pro", fields: ["model", "prompt", "size", "resolution"], values: { resolution: "2K" } },
    i2i: { model: "wan2.7-image-pro", fields: ["model", "prompt", "resolution", "image_urls"] },
  },
};

const VIDEO_CASES: Record<string, { t2v?: Expected; i2v: Expected }> = {
  // ── 分支 2 改过档位（legacy → 可选）且带请求体声明的上一代 ──
  "doubao-seedance-2.0": {
    t2v: { model: "doubao-seedance-2.0", fields: ["model", "prompt", "duration", "size", "resolution", "generate_audio"] },
    i2v: { model: "doubao-seedance-2.0", fields: ["model", "prompt", "duration", "size", "resolution", "generate_audio", "image_urls"] },
  },
  "wan2.7": {
    t2v: { model: "wan2.7", fields: ["model", "prompt", "size", "resolution", "duration"] },
    i2v: { model: "wan2.7", fields: ["model", "prompt", "resolution", "duration", "image_urls"] },
  },
  "Omni-Flash-Ext": {
    t2v: { model: "Omni-Flash-Ext", fields: ["model", "prompt", "size", "resolution", "duration"] },
    i2v: { model: "Omni-Flash-Ext", fields: ["model", "prompt", "size", "resolution", "duration", "image_urls", "generation_type"] },
  },
  "kling-v4": {
    t2v: { model: "kling-v4", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration"], values: { duration: 5 } },
    i2v: { model: "kling-v4", fields: ["model", "prompt", "resolution", "duration", "first_frame_image"] },
  },
  "grok-imagine-video-1.5": {
    // 比例不设默认，不发。
    t2v: { model: "grok-imagine-video-1.5", fields: ["model", "prompt", "resolution", "duration"], values: { resolution: "480p", duration: 8 } },
    i2v: { model: "grok-imagine-video-1.5", fields: ["model", "prompt", "resolution", "duration", "image_urls"] },
  },
  "pixverse-v6": {
    t2v: { model: "pixverse-v6", fields: ["model", "prompt", "size", "resolution", "duration", "audio"], values: { audio: false, resolution: "540p" } },
    i2v: { model: "pixverse-v6", fields: ["model", "prompt", "resolution", "duration", "audio", "image_urls"] },
  },
  "pixverse-v6-max": {
    t2v: { model: "pixverse-v6-max", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "audio"], values: { audio: false, resolution: "540p" } },
    i2v: { model: "pixverse-v6-max", fields: ["model", "prompt", "resolution", "duration", "audio", "image_urls"] },
  },
  "muse-video-ext": {
    // 时长 / 清晰度 / 声音都由供应商固定，只有可选比例。
    t2v: { model: "muse-video-ext", fields: ["model", "prompt"] },
    i2v: { model: "muse-video-ext", fields: ["model", "prompt", "image_urls"] },
  },
  "flux-3-video": {
    t2v: { model: "flux-3-video", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "audio"], values: { audio: true } },
    i2v: { model: "flux-3-video", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "audio", "image_urls"] }, // 官方：有图时 aspect_ratio 仍可传（auto 跟随首图）
  },
  "wan3.0-video-prime": {
    // Prime 与 Wan 3.0 同一份官方合同，只是 model id 与单价不同。
    t2v: { model: "wan3.0-video-prime", fields: ["model", "prompt", "size", "resolution", "duration", "audio", "watermark"] },
    i2v: { model: "wan3.0-video-prime", fields: ["model", "prompt", "resolution", "duration", "audio", "watermark", "generation_type", "image_urls"] },
  },
  "veo3.1-fast-official": {
    t2v: { model: "veo3.1-fast-official", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "generate_audio"], values: { duration: 8, generate_audio: false, resolution: "720p" } },
    i2v: { model: "veo3.1-fast-official", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "generate_audio", "first_frame_image"] },
  },
  "veo3.1-quality-official": {
    t2v: { model: "veo3.1-quality-official", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "generate_audio"], values: { duration: 8, generate_audio: false, resolution: "720p" } },
    i2v: { model: "veo3.1-quality-official", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "generate_audio", "first_frame_image"] },
  },
  "viduq3-pro": {
    t2v: { model: "viduq3-pro", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "audio"] },
    // 有图时官方禁止同时发 aspect_ratio。
    i2v: { model: "viduq3-pro", fields: ["model", "prompt", "resolution", "duration", "audio", "image_urls"] },
  },
  "viduq3-turbo": {
    t2v: { model: "viduq3-turbo", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration", "audio"] },
    i2v: { model: "viduq3-turbo", fields: ["model", "prompt", "resolution", "duration", "audio", "image_urls"] },
  },
  "gemini-omni-1.2-flash": {
    t2v: { model: "gemini-omni-1.2-flash", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration"], values: { duration: 10, resolution: "720p" } },
    // 首帧图生：只发首帧字段（官方：首尾帧才加 last_frame_image；image_urls 是多图参考）。
    i2v: { model: "gemini-omni-1.2-flash", fields: ["model", "prompt", "resolution", "duration", "first_frame_image"] },
  },
  "gemini-omni-1.2-flash-ext": {
    t2v: { model: "gemini-omni-1.2-flash-ext", fields: ["model", "prompt", "aspect_ratio", "resolution", "duration"], values: { duration: 10, resolution: "720p" } },
    i2v: { model: "gemini-omni-1.2-flash-ext", fields: ["model", "prompt", "resolution", "duration", "first_frame_image"] },
  },
  "viduq4-preview": {
    i2v: { model: "viduq4-preview", fields: ["model", "prompt", "resolution", "duration", "audio", "first_frame_image"] },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- create 是目录 mapping 的原样 JSON，字段形状由生产函数消费
function buildBody(model: { modelKey: string; archetypeId?: string; mappings: Array<{ taskKind: string; create: any }> }, taskKind: string, referenceExtras: Record<string, unknown>) {
  const mapping = model.mappings.find((item) => item.taskKind === taskKind);
  if (!mapping) throw new Error(`${model.modelKey}: no ${taskKind} mapping`);
  const extras = {
    ...applyHeadlessParamDefaults(
      { modelKey: model.modelKey },
      modelReferenceSelection("apimart", { modelKey: model.modelKey, meta: { archetypeId: model.archetypeId } }, taskKind as never),
      mapping.create.defaultParams,
      mapping.create.body,
    ),
    ...referenceExtras,
  };
  const request = { kind: taskKind, prompt: "a quiet sunrise", extras };
  const context = buildTemplateContext({
    request: request as never,
    params: applyParamMap(mapping.create.paramMap, taskTemplateParams(request as never)),
    model: { modelKey: model.modelKey },
    modelKey: model.modelKey,
    apiKey: "TEST_SECRET",
  });
  const built = buildHttpRequest({ baseUrl: "https://api.apimart.ai", authType: "bearer", apiKey: "TEST_SECRET", context, operation: mapping.create });
  return { body: built.body as Record<string, unknown>, url: built.url };
}

function check(label: string, actual: { body: Record<string, unknown>; url: string }, expected: Expected) {
  expect(actual.url, `${label} url`).toMatch(/^https:\/\/api\.apimart\.ai\/v1\/(images|videos)\/generations$/);
  expect(actual.body.model, `${label} model`).toBe(expected.model);
  expect(Object.keys(actual.body).sort(), `${label} body fields: ${JSON.stringify(actual.body)}`).toEqual([...expected.fields].sort());
  for (const [key, value] of Object.entries(expected.values ?? {})) expect(actual.body[key], `${label} ${key}`).toBe(value);
  // 付费档位绝不默认成 auto：auto 会按最高档预扣。
  for (const key of ["resolution", "quality", "duration"]) {
    if (key in actual.body) expect(String(actual.body[key]).toLowerCase(), `${label} ${key} must not default to auto`).not.toBe("auto");
  }
}

describe("APIMart 图片型号（GPT Image 2.6 + 上一代改档 + 剩余新型号）：每个模式的真实请求体字段集合等于官方允许集合", () => {
  for (const [modelKey, modes] of Object.entries(IMAGE_CASES)) {
    const model = APIMART_IMAGE_MODELS.find((item) => item.modelKey === modelKey);
    it(`${modelKey} 文生图 / 改图`, () => {
      expect(model, `${modelKey} must be declared`).toBeTruthy();
      check(`${modelKey}/t2i`, buildBody(model!, "text_to_image", {}), modes.t2i);
      // 参考图按档案槽自己的键名喂进去（2.5 / 2.6 的槽叫 input_urls，由目录 body 转接成官方的 image_urls）：
      // 槽 → 官方字段这一段才是真走过的，body 里把 image_urls 写错（比如 image_url）会少一个字段当场红。
      const slot = getArchetypeById(model!.archetypeId ?? "")!.modes.find((mode) => mode.transportTaskKind === "image_edit")!.slots?.find((item) => item.kind === "image_ref");
      const images = buildBody(model!, "image_edit", { [slot?.inputKey ?? "image_urls"]: [REF, REF2] });
      check(`${modelKey}/i2i`, images, modes.i2i);
      expect(images.body.image_urls, `${modelKey} image_urls is an array`).toEqual([REF, REF2]);
      const limit = REF_LIMITS[modelKey];
      if (limit !== undefined) expect(slot?.max, `${modelKey} 参考图槽上限 = 官方上限`).toBe(limit);
    });
  }
});

describe("APIMart 视频型号（上一代改档 + 剩余新型号）：每个模式的真实请求体字段集合等于官方允许集合", () => {
  for (const [modelKey, modes] of Object.entries(VIDEO_CASES)) {
    const model = APIMART_VIDEO_MODELS.find((item) => item.modelKey === modelKey);
    it(`${modelKey} 文生视频 / 图生视频`, () => {
      expect(model, `${modelKey} must be declared`).toBeTruthy();
      const archetype = getArchetypeById(model!.archetypeId ?? "");
      expect(archetype, `${modelKey} archetype`).toBeTruthy();
      if (modes.t2v) check(`${modelKey}/t2v`, buildBody(model!, "text_to_video", {}), modes.t2v);
      else expect(model!.mappings.some((item) => item.taskKind === "text_to_video"), `${modelKey} must not declare text-to-video`).toBe(false);
      const firstFrame = modes.i2v.fields.includes("first_frame_image");
      const refs = firstFrame ? { first_frame_image: REF } : { image_urls: [REF] };
      const built = buildBody(model!, "image_to_video", refs);
      check(`${modelKey}/i2v`, built, modes.i2v);
      if (!firstFrame) expect(Array.isArray(built.body.image_urls), `${modelKey} image_urls is an array`).toBe(true);
    });
  }
});

describe("Gemini Omni 1.2：多图参考和首尾帧的边界", () => {
  it("多图参考带 omni_reference_task_type=reference；Ext 没有首尾帧；首尾帧最长 10 秒", () => {
    const flash = getArchetypeById("gemini-omni-1.2-flash")!;
    const ext = getArchetypeById("gemini-omni-1.2-flash-ext")!;
    expect(flash.modes.find((mode) => mode.id === "reference")?.fixedParams).toEqual({ omni_reference_task_type: "reference" });
    expect(ext.modes.map((mode) => mode.id)).toEqual(["t2v", "i2v", "reference"]);
    const firstlast = flash.modes.find((mode) => mode.id === "firstlast")!;
    expect(firstlast.params.find((param) => param.key === "duration")?.max).toBe(10);
    expect(flash.modes.find((mode) => mode.id === "i2v")!.params.find((param) => param.key === "duration")?.max).toBe(15);
  });
});
