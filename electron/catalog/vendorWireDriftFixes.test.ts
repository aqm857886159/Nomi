// Regression tests for three real vendor-wire drifts caught by the 2026-09-02 model
// acceptance matrix pass (docs/research/2026-09-02-model-acceptance-matrix.md). Each was
// a "本地看不出、线上才 4xx" class of bug: the mock/loopback path did not exercise the exact
// live contract. These lock the fixes structurally so a future edit that regresses the wire
// shape fails here instead of only in production.

import { describe, expect, it } from "vitest";
import { FAL_OFFICIAL_MODELS } from "./falOfficial";
import { RUNWAY_OFFICIAL_MODELS } from "./runwayOfficial";
import { ratioResToFalImageSize, ratioResToOpenAiSize } from "./paramTranslate";
import { applyRequestTransform } from "../tasks/requestTransforms";

async function runwayImageBody(model: string, ratio: string): Promise<Record<string, unknown>> {
  // importing runwayOfficial (above) registers the transform as a side-effect.
  const out = await applyRequestTransform("runway-image-references", { model, ratio, promptText: "x" }, { baseUrl: "" });
  return out as Record<string, unknown>;
}

function findFalMapping(modelKey: string, modeId: string) {
  const model = FAL_OFFICIAL_MODELS.find((m) => m.modelKey === modelKey);
  const mapping = model?.mappings.find((mp) => mp.modeId === modeId);
  if (!mapping) throw new Error(`fal mapping not found: ${modelKey}/${modeId}`);
  return mapping;
}

describe("BUG-2: fal queue poll/result path collapses to owner/app root", () => {
  // Live fal (2026-09-01): status/result for a deep-sub-path submit endpoint live at the
  // app root (first two path segments). Submitting keeps the full endpoint; polling the full
  // endpoint returns HTTP 405. Regression: query/result must use the collapsed root.
  it.each([
    ["bytedance/seedance-2.5", "t2v", "bytedance/seedance-2.5"],
    ["fal-ai/kling-video/v3/pro", "t2v", "fal-ai/kling-video"],
    ["google/gemini-omni-flash/v1.1", "t2v", "google/gemini-omni-flash"],
    ["minimax/h3-max", "t2v", "minimax/h3-max"],
    ["bytedance/seedream/v5/pro", "t2i", "bytedance/seedream"],
    ["openai/gpt-image-2", "t2i", "openai/gpt-image-2"],
    ["fal-ai/nano-banana-2", "t2i", "fal-ai/nano-banana-2"],
    ["fal-ai/elevenlabs/sound-effects/v2", "sfx", "fal-ai/elevenlabs"],
  ] as const)("%s/%s → poll root /%s", (modelKey, modeId, expectedRoot) => {
    const mapping = findFalMapping(modelKey, modeId);
    expect(mapping.query.path).toBe(`/${expectedRoot}/requests/{{providerMeta.task_id}}/status`);
    expect(mapping.result.path).toBe(`/${expectedRoot}/requests/{{providerMeta.task_id}}`);
    // create still POSTs to the full submit endpoint (that part was always correct).
    const model = FAL_OFFICIAL_MODELS.find((m) => m.modelKey === modelKey)!;
    const created = model.mappings.find((mp) => mp.modeId === modeId)!;
    expect(created.create.path).toContain(modelKey);
  });
});

describe("BUG-1: fal openai/gpt-image-2 image_size must be a fal enum, not a WxH string", () => {
  // Live fal rejects "1024x1024" with 422 model_attributes_type; it accepts the ImageSize
  // enum. The OpenAI/new-api `size` field DOES take WxH — so the transform must be fal-specific.
  it("gpt-image-2 fal mapping translates aspect_ratio→image_size via ratioResToFalImageSize", () => {
    for (const modeId of ["t2i", "edit"] as const) {
      const mapping = findFalMapping("openai/gpt-image-2", modeId);
      const rule = mapping.create.paramMap?.rules?.find((r) => "wire" in r && r.wire === "image_size");
      expect(rule && "transform" in rule ? rule.transform : undefined).toBe("ratioResToFalImageSize");
    }
  });

  it("ratioResToFalImageSize emits fal ImageSize enums (never a WxH string)", () => {
    const falEnums = new Set(["square", "square_hd", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]);
    expect(ratioResToFalImageSize(["1:1", "1K"])).toBe("square");
    expect(ratioResToFalImageSize(["16:9", "1K"])).toBe("landscape_16_9");
    expect(ratioResToFalImageSize(["4:3", "1K"])).toBe("landscape_4_3");
    expect(ratioResToFalImageSize(["9:16", "1K"])).toBe("portrait_16_9");
    expect(ratioResToFalImageSize(["3:4", "1K"])).toBe("portrait_4_3");
    // auto / unknown → undefined (let fal default), not a bogus enum
    expect(ratioResToFalImageSize(["auto", "1K"])).toBeUndefined();
    for (const ratio of ["1:1", "16:9", "4:3", "9:16", "3:4", "3:2", "2:3", "21:9"]) {
      const v = ratioResToFalImageSize([ratio, "2K"]);
      if (v !== undefined) expect(falEnums.has(v)).toBe(true);
      // and it must never look like a WxH string
      if (v !== undefined) expect(/\d+x\d+/.test(v)).toBe(false);
    }
  });

  it("ratioResToOpenAiSize still returns WxH strings (unchanged; used by new-api/OpenAI size)", () => {
    expect(ratioResToOpenAiSize(["1:1", "1K"])).toMatch(/^\d+x\d+$/);
  });
});

describe("BUG-3: runway image ratio must be per-model; shared default 1024:1024 is invalid for some", () => {
  // Source of truth = Runway official OpenAPI spec, /v1/text_to_image oneOf per-model ratio.enum
  // (checked 2026-09-01 against raw.githubusercontent.com/runwayml/openapi/main/openapi.json):
  //   muse_image / gpt_image_2 enums exclude 1024:1024 (2048-class + `auto`); seedream5_lite enum is
  //   the ≥3.68M-px set (2048:2048 / 2848:1600 / …). Live-API probe confirmed shared default 1024:1024
  //   → 400 for these three, and every remap value below → ACCEPTED (seedream5_lite also tolerates
  //   free <w>:<h> off-enum, but we deliberately keep spec-listed values, fail-safe for future tightening).
  // Fix: every image mapping carries runway-image-references, which now remaps ratio per model.
  it("every runway image t2i/i2i mapping carries the ratio-aware transform", () => {
    const imageModels = RUNWAY_OFFICIAL_MODELS.filter((m) => m.kind === "image");
    expect(imageModels.length).toBeGreaterThan(5);
    for (const model of imageModels) {
      for (const mapping of model.mappings) {
        expect(mapping.create.request_transform).toBe("runway-image-references");
      }
    }
  });

  it("the three previously-broken models are covered by an explicit ratio remap", () => {
    // These models' live enums do not include the shared 1024:1024 default.
    const broken = ["muse_image", "gpt_image_2", "seedream5_lite"];
    for (const key of broken) {
      const model = RUNWAY_OFFICIAL_MODELS.find((m) => m.modelKey === key);
      expect(model, `runway image model ${key} present`).toBeTruthy();
      expect(model!.mappings.length).toBeGreaterThan(0);
      // t2i mapping must exist and carry the transform (base t2i previously had no transform).
      const t2i = model!.mappings.find((mp) => mp.modeId === "t2i");
      expect(t2i?.create.request_transform).toBe("runway-image-references");
    }
  });

  it("transform remaps the shared 1024:1024 default to each model's live-valid ratio", async () => {
    // Values verified against the live runway enums on 2026-09-01.
    expect((await runwayImageBody("muse_image", "1024:1024")).ratio).toBe("1600:1600");
    expect((await runwayImageBody("gpt_image_2", "1024:1024")).ratio).toBe("1920:1920");
    expect((await runwayImageBody("seedream5_lite", "1024:1024")).ratio).toBe("2048:2048");
    // orientation is preserved (landscape / portrait pick the right family member)
    expect((await runwayImageBody("gpt_image_2", "1280:720")).ratio).toBe("2560:1440");
    expect((await runwayImageBody("muse_image", "720:1280")).ratio).toBe("1152:2016");
    // seedream5_lite landscape/portrait use spec-listed enum values (both verified ACCEPTED live).
    expect((await runwayImageBody("seedream5_lite", "1280:720")).ratio).toBe("2848:1600");
    expect((await runwayImageBody("seedream5_lite", "720:1280")).ratio).toBe("1600:2848");
  });

  it("models whose enum already includes 1024:1024 are left untouched", async () => {
    // gen4_image / grok / gemini variants accept 1024:1024 → no remap.
    expect((await runwayImageBody("gen4_image", "1024:1024")).ratio).toBe("1024:1024");
    expect((await runwayImageBody("grok_imagine_image_2", "1280:720")).ratio).toBe("1280:720");
  });
});

describe("BUG-4: KIE Kling 3 uses the current Omni wire contract", () => {
  // The 2026-09-02 official pages replaced the earlier multi_shots contract with
  // customize_multi_shots/prefer_multi_shots and separate text/image model IDs.
  it("uses the documented model and fields for each mode", async () => {
    const { KLING_3_I2V_CREATE_OP, KLING_3_T2V_CREATE_OP } = await import("./kieKling");
    const textBody = KLING_3_T2V_CREATE_OP as { body: { model: string; input: Record<string, unknown> }; paramMap?: { drops?: string[] } };
    const imageBody = KLING_3_I2V_CREATE_OP as { body: { model: string; input: Record<string, unknown> }; paramMap?: { drops?: string[] } };

    expect(textBody.body.model).toBe("kling-3.0-omni/text-to-video");
    expect(imageBody.body.model).toBe("kling-3.0-omni/image-to-video");
    expect(textBody.body.input).toMatchObject({
      prompt: "{{request.prompt}}",
      audio: "{{request.params.sound}}",
      customize_multi_shots: false,
      prefer_multi_shots: false,
      resolution: "720p",
      aspect_ratio: "{{request.params.aspect_ratio}}",
    });
    expect(imageBody.body.input).toMatchObject({
      prompt: "{{request.prompt}}",
      image_urls: "{{request.params.image_urls}}",
      audio: "{{request.params.sound}}",
      customize_multi_shots: false,
      prefer_multi_shots: false,
      resolution: "720p",
      aspect_ratio: "auto",
    });
    expect(textBody.paramMap?.drops).toEqual(["mode"]);
    expect(imageBody.paramMap?.drops).toEqual(["mode", "aspect_ratio"]);

    for (const input of [textBody.body.input, imageBody.body.input]) {
      expect(input).not.toHaveProperty("mode");
      expect(input).not.toHaveProperty("sound");
      expect(input).not.toHaveProperty("multi_shots");
    }
  });
});

describe("Runway reference modes use the text-to-video reference union", () => {
  it("does not construct a promptImage or image_to_video mapping for multi-reference modes", () => {
    // 选择器按**线缆角色**（mapping id 的 `-refs` 后缀），不按 modeId：一模型一档案之后，
    // 各档案给同一个多图参考角色起的名字本就不同（seedance=omni / wan=ref / hailuo=ref），
    // 按 "reference" 这个名字筛会一个都筛不到 —— 那正是本断言 toBeGreaterThan(0) 要挡的假绿。
    // 角色是 Runway 侧的稳定事实，档案改名它不动。
    const referenceMappings = RUNWAY_OFFICIAL_MODELS
      .flatMap((model) => model.mappings.filter((mapping) => mapping.id.endsWith("-refs")));
    expect(referenceMappings.length).toBeGreaterThan(0);
    for (const mapping of referenceMappings) {
      expect(mapping.taskKind).toBe("text_to_video");
      expect(mapping.create.path).toBe("/v1/text_to_video");
      expect(mapping.create.body).not.toHaveProperty("promptImage");
      expect(mapping.create.body).toHaveProperty("reference_image_urls");
    }
  });

  it("keeps Seedance 2.5 omni aligned with its text-to-video operation", () => {
    const mapping = RUNWAY_OFFICIAL_MODELS
      .find((model) => model.modelKey === "seedance2_5")?.mappings.find((item) => item.modeId === "omni");
    expect(mapping).toMatchObject({ taskKind: "text_to_video", create: { path: "/v1/text_to_video" } });
  });

});
