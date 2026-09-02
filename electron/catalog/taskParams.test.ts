import { describe, it, expect } from "vitest";
import { hasImageEditReferences, taskTemplateParams, firstReferenceImage, projectReferencesOntoBodyKeys, unreachableReferenceLabels, imageEditGuardError, NO_MAPPING_FALLBACK_BODY } from "./taskParams";

// 「接入即验证」的零额度一环：在不真跑、不花额度的前提下，核对"摊平给模板的参数"是否完整、类型对。
// 这些坑都只在真实参数构建里暴露（实测）：① duration 是数字被 firstString 吞成 ""；
// ② omni 参考数组该不该进 params；③ generate_audio 布尔值该原样保留。

describe("taskTemplateParams — 时长类型", () => {
  it("数字时长原样保留（修复点：number 5 不再被吞成空串）", () => {
    expect(taskTemplateParams({ extras: { duration: 5 } }).duration).toBe(5);
  });
  it("字符串时长 trim 后保留；缺省为空串", () => {
    expect(taskTemplateParams({ extras: { duration: " 8 " } }).duration).toBe("8");
    expect(taskTemplateParams({ extras: {} }).duration).toBe("");
  });
  it("durationSeconds / videoDuration 兜底", () => {
    expect(taskTemplateParams({ extras: { durationSeconds: 10 } }).duration).toBe(10);
  });
});

describe("taskTemplateParams — 数字线参数", () => {
  it("speed 字符串归一化为 number（修复中转 TTS 的严格 JSON 类型错误）", () => {
    expect(taskTemplateParams({ extras: { speed: " 1.5 " } }).speed).toBe(1.5);
  });
  it("speed number 原样保留，缺省不凭空造字段", () => {
    expect(taskTemplateParams({ extras: { speed: 0.75 } }).speed).toBe(0.75);
    expect(taskTemplateParams({ extras: {} })).not.toHaveProperty("speed");
  });
  it("非法 speed 不静默改成默认值", () => {
    expect(taskTemplateParams({ extras: { speed: "fast" } }).speed).toBe("fast");
  });
});

describe("taskTemplateParams — 档案参考输入（omni）", () => {
  it("archetypeInput 的 reference_image_urls 透传进 params（数组），generate_audio 布尔原样", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { reference_image_urls: ["a.png", "b.png"] },
        generate_audio: true,
        resolution: "720p",
      },
    });
    expect(params.reference_image_urls).toEqual(["a.png", "b.png"]);
    expect(params.generate_audio).toBe(true);
    expect(params.resolution).toBe("720p");
  });
  it("无 archetypeInput → 不凭空造参考键", () => {
    const params = taskTemplateParams({ extras: { resolution: "1080p" } });
    expect(params).not.toHaveProperty("reference_image_urls");
  });
});

// 根因回归（2026-07-24 群反馈）：档案投影曾**独占**参考通道（archetypeInput 整包替换标准键）——
// 中转 gpt-image-2 的参考只剩 kie 键 input_urls，multipart 模板读 reference_images、chat 多模态读
// chat_image_parts、i2v 读 image_url，全空 → 改图不带图被拒/首帧到不了 wire。不变量：标准键先建、
// 档案键叠加其上（同名键档案权威）；内置家 body 只引用自家声明键，多出的标准键不进 body。
describe("referenceInputParams/taskTemplateParams — 标准键与档案键并存（中转不丢参考）", () => {
  it("档案模型（kie input_urls 键）+ 标准 referenceImages：两面并存，chat_image_parts/image_url 可派生", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { input_urls: ["ref.png"], model: "gpt-image-2-image-to-image" },
        referenceImages: ["ref.png"],
      },
    });
    // 档案键照旧（kie/apimart body 读它）
    expect(params.input_urls).toEqual(["ref.png"]);
    // 标准键不再被吞（中转 multipart 模板读 reference_images）
    expect(params.reference_images).toEqual(["ref.png"]);
    // chat 多模态参考件由标准键派生（中转 chat/completions 图生图）
    expect(params.chat_image_parts).toEqual([{ type: "image_url", image_url: { url: "ref.png" } }]);
    // i2v/单图口径由标准面派生
    expect(params.image_url).toBe("ref.png");
  });

  it("档案首帧（标准 firstFrameUrl 并存）→ first_frame_url 与 image_url 都在场；同名键档案权威", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { first_frame_url: "frame-A.png" },
        firstFrameUrl: "frame-A.png",
      },
    });
    expect(params.first_frame_url).toBe("frame-A.png");
    expect(params.image_url).toBe("frame-A.png");
  });

  it("同名键冲突时档案权威覆盖标准值（构造层投影是单一真相）", () => {
    const params = taskTemplateParams({
      extras: {
        archetypeInput: { first_frame_url: "mode-filtered.png" },
        firstFrameUrl: "raw-standard.png",
      },
    });
    expect(params.first_frame_url).toBe("mode-filtered.png");
  });
});

describe("firstReferenceImage — 单图首选", () => {
  it("按 image_url → imageUrl → firstFrameUrl → lastFrameUrl → referenceImages[0] 顺序取第一个非空", () => {
    expect(firstReferenceImage({ extras: { firstFrameUrl: "f.png" } })).toBe("f.png");
    expect(firstReferenceImage({ extras: { referenceImages: ["r.png"] } })).toBe("r.png");
    expect(firstReferenceImage({ extras: {} })).toBe("");
  });

  it("valid Comfy exact contract ignores stale aggregate aliases", () => {
    const exactPending = {
      modelKey: "workflow", modelVendor: "comfyui-local",
      parameterReferenceSlots: {
        modelKey: "workflow", vendorKey: "comfyui-local",
        slots: [{ key: "comfy_image_1", label: "Reference", group: "reference", mediaKind: "image" }],
      },
      comfy_image_1: null,
      firstFrameUrl: "https://stale.test/frame.png",
      referenceImages: ["https://stale.test/reference.png"],
    };
    expect(firstReferenceImage({ extras: exactPending })).toBe("");
    expect(firstReferenceImage({ extras: {
      ...exactPending,
      comfy_image_1: "https://exact.test/reference.png",
    } })).toBe("https://exact.test/reference.png");
  });
});

describe("taskTemplateParams — explicit media slots precede aggregate fallbacks", () => {
  it("keeps the archetype projection authoritative over explicit and aggregate values", () => {
    expect(taskTemplateParams({ extras: {
      first_frame_url: "explicit.png", firstFrameUrl: "fallback.png",
      archetypeInput: { first_frame_url: null },
    } }).first_frame_url).toBeNull();
  });

  it.each([null, []] as const)("binds exact Comfy %j authority to the actually selected vendor and model", (pending) => {
    const extras = {
      modelKey: "workflow", modelVendor: "comfyui-local",
      parameterReferenceSlots: {
        modelKey: "workflow", vendorKey: "comfyui-local",
        slots: [{ key: "reference_images", label: "Reference", group: "reference", mediaKind: "image" }],
      },
      reference_images: pending,
      referenceImages: ["nomi-local://asset/project/fallback.png"],
    };
    expect(taskTemplateParams({ extras }, { vendorKey: "comfyui-local", modelKey: "workflow" }).reference_images)
      .toEqual(pending);
    expect(taskTemplateParams({ extras }, { vendorKey: "antigravity-cli", modelKey: "generate_image" }).reference_images)
      .toEqual(["nomi-local://asset/project/fallback.png"]);
    expect(firstReferenceImage({ extras }, { vendorKey: "antigravity-cli", modelKey: "generate_image" }))
      .toBe("nomi-local://asset/project/fallback.png");
  });

  it.each([
    ["image_url", "first.png"], ["first_frame_url", "first.png"], ["last_frame_url", "last.png"],
    ["source_video_url", "fallback.mp4"], ["reference_images", ["fallback.png"]],
    ["reference_image_urls", ["fallback.png"]], ["reference_video_urls", ["fallback.mp4"]],
    ["reference_audio_urls", ["fallback.mp3"]],
  ] as const)("empty defaults do not mask populated legacy %s values", (key, expected) => {
    for (const empty of ["", "   ", undefined]) {
      const params = taskTemplateParams({ extras: {
        [key]: empty, firstFrameUrl: "first.png", lastFrameUrl: "last.png",
        referenceImages: ["fallback.png"], referenceImageUrls: ["fallback.png"],
        referenceVideoUrls: ["fallback.mp4"], referenceAudioUrls: ["fallback.mp3"],
      } });
      expect(params[key]).toEqual(expected);
    }
  });
});

describe("hasImageEditReferences — L3 诚实护栏判定（图生图/图生视频是否真带了参考）", () => {
  const declaredExtras = (
    slots: Array<{ key: string; mediaKind?: "image" | "video" }>,
    values: Record<string, unknown>,
    vendorKey = "comfyui-local",
  ) => ({
    modelKey: "workflow",
    modelVendor: vendorKey,
    parameterReferenceSlots: {
      modelKey: "workflow",
      vendorKey,
      slots: slots.map((slot) => ({ ...slot, label: slot.key, group: "reference" })),
    },
    ...values,
  });

  it("空 extras → false", () => {
    expect(hasImageEditReferences({ extras: {} })).toBe(false);
    expect(hasImageEditReferences({})).toBe(false);
  });
  it("referenceImages（非档案路）→ true", () => {
    expect(hasImageEditReferences({ extras: { referenceImages: ["https://cdn/a.png"] } })).toBe(true);
  });
  it("archetypeInput 只有 model enum + fixedParams（无任何 URL）→ false（enum 不算参考图）", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { model: "gpt-image-2-image-to-image", generation_type: "edit" } } })).toBe(false);
  });
  it("archetypeInput.input_urls → true（gpt-image-2 i2i 口径）", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { model: "gpt-image-2-image-to-image", input_urls: ["nomi-local://asset/p/a.png"] } } })).toBe(true);
  });
  it("volcengine content 项（嵌套 {image_url:{url}}）→ true", () => {
    expect(hasImageEditReferences({ extras: { archetypeInput: { volcengine_image_contents: [{ type: "image_url", image_url: { url: "https://cdn/a.png" }, role: "reference_image" }] } } })).toBe(true);
  });
  it("extras.image 裸键（headless/老调用方）→ true", () => {
    expect(hasImageEditReferences({ extras: { image: "https://cdn/first.png" } })).toBe(true);
  });
  it("firstFrameUrl 单图口径 → true", () => {
    expect(hasImageEditReferences({ extras: { firstFrameUrl: "https://cdn/f.png" } })).toBe(true);
  });
  it("Comfy 单个或多个已填 image 参数 → true，pending null 不计入", () => {
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: "https://cdn/single.png" },
    ) })).toBe(true);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_image_1" }, { key: "comfy_image_2", mediaKind: "image" }],
      { comfy_image_1: null, comfy_image_2: "nomi-local://asset/p/second.png" },
    ) })).toBe(true);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: null },
    ) })).toBe(false);
  });
  const staleGenericReferences: Array<[string, Record<string, unknown>]> = [
    ["image", { image: "https://stale.test/image.png" }],
    ["image_url", { image_url: "https://stale.test/image.png" }],
    ["imageUrl", { imageUrl: "https://stale.test/image.png" }],
    ["referenceImages", { referenceImages: ["https://stale.test/image.png"] }],
    ["referenceImageUrl", { referenceImageUrl: "https://stale.test/image.png" }],
    ["referenceImageUrls", { referenceImageUrls: ["https://stale.test/image.png"] }],
    ["reference_images", { reference_images: ["https://stale.test/image.png"] }],
    ["reference_image_urls", { reference_image_urls: ["https://stale.test/image.png"] }],
    ["firstFrameUrl", { firstFrameUrl: "https://stale.test/first.png" }],
    ["first_frame_url", { first_frame_url: "https://stale.test/first.png" }],
    ["lastFrameUrl", { lastFrameUrl: "https://stale.test/last.png" }],
    ["last_frame_url", { last_frame_url: "https://stale.test/last.png" }],
    ["referenceVideoUrls", { referenceVideoUrls: ["https://stale.test/video.mp4"] }],
    ["sourceVideoUrl", { sourceVideoUrl: "https://stale.test/video.mp4" }],
    ["referenceAudioUrls", { referenceAudioUrls: ["https://stale.test/audio.mp3"] }],
    ["styleReferenceImages", { styleReferenceImages: ["https://stale.test/style.png"] }],
    ["characterReferenceImages", { characterReferenceImages: ["https://stale.test/character.png"] }],
    ["compositionReferenceImages", { compositionReferenceImages: ["https://stale.test/composition.png"] }],
    ["upstreamResultUrls", { upstreamResultUrls: ["https://stale.test/upstream.png"] }],
    ["activeAssetUrls", { activeAssetUrls: ["https://stale.test/active.png"] }],
    ["archetypeInput", { archetypeInput: { input_urls: ["https://stale.test/archetype.png"] } }],
  ];
  it.each(staleGenericReferences)("valid Comfy pending image contract ignores stale generic %s", (_name, stale) => {
    const extras = declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: null, ...stale },
    );
    expect(hasImageEditReferences({ extras })).toBe(false);
  });
  it("valid Comfy contract uses only exact structural image inputs", () => {
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: "https://exact.test/reference.png", referenceImages: ["https://stale.test/reference.png"] },
    ) })).toBe(true);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_video_1", mediaKind: "video" }],
      { comfy_video_1: "https://exact.test/video.mp4", referenceImages: ["https://stale.test/reference.png"] },
    ) })).toBe(false);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [],
      { comfy_input_image: "https://not-media.test/text", referenceImages: ["https://stale.test/reference.png"] },
    ) })).toBe(false);
  });
  it("invalid Comfy and non-Comfy declarations retain the legacy generic guard", () => {
    const invalid = declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: null, referenceImages: ["https://legacy.test/reference.png"] },
    );
    invalid.parameterReferenceSlots.vendorKey = "other";
    expect(hasImageEditReferences({ extras: invalid })).toBe(true);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [],
      { referenceImages: ["https://legacy.test/reference.png"] },
      "custom",
    ) })).toBe(true);
  });
  it("reachability and headless projection also ignore stale generics behind a pending exact contract", () => {
    const extras = declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: null, referenceImages: ["https://stale.test/reference.png"] },
    );
    const body = { image: "{{request.params.comfy_image_1}}" };
    expect(unreachableReferenceLabels({ extras }, body)).toEqual([]);
    expect(projectReferencesOntoBodyKeys(extras, { image_urls: "{{request.params.image_urls}}" })).toEqual({});
  });
  it("Comfy video 参数、失效声明和任意字符串参数都不冒充 image 参考", () => {
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_video_1", mediaKind: "video" }],
      { comfy_video_1: "https://cdn/clip.mp4" },
    ) })).toBe(false);
    expect(hasImageEditReferences({ extras: {
      ...declaredExtras([{ key: "comfy_image_1", mediaKind: "image" }], { comfy_image_1: "https://cdn/stale.png" }),
      modelKey: "replacement-workflow",
    } })).toBe(false);
    expect(hasImageEditReferences({ extras: { comfy_image_1: "https://cdn/arbitrary.png" } })).toBe(false);
  });
  it("允许精确 Comfy 槽在上传后使用 input 文件名继续通过媒体护栏", () => {
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: "certification-reference-1.png" },
    ) })).toBe(true);
    expect(hasImageEditReferences({ extras: declaredExtras(
      [{ key: "comfy_video_1", mediaKind: "video" }],
      { comfy_video_1: "certification-reference-1.mp4" },
    ) })).toBe(false);
  });
  it("non-Comfy keyed declarations keep relying on their legacy generic alias", () => {
    const extras = declaredExtras(
      [{ key: "custom_image", mediaKind: "image" }],
      { custom_image: "https://cdn/custom.png" },
      "custom",
    );
    expect(hasImageEditReferences({ extras })).toBe(false);
    expect(hasImageEditReferences({ extras: { ...extras, referenceImages: ["https://cdn/custom.png"] } })).toBe(true);
  });

  it("checks declared Comfy media against the exact body parameter without generic projection", () => {
    const extras = declaredExtras(
      [{ key: "comfy_image_1", mediaKind: "image" }],
      { comfy_image_1: "https://cdn/reference.png" },
    );
    expect(unreachableReferenceLabels(
      { extras },
      { image: "{{request.params.comfy_image_1}}" },
    )).toEqual([]);
    expect(unreachableReferenceLabels(
      { extras },
      { image: "{{request.params.different_image_key}}" },
    )).toEqual(["参考图"]);
    expect(taskTemplateParams({ extras })).not.toHaveProperty("referenceImages");
  });
});

// W1d：headless/MCP 参考键形态投影（把 referenceImages 投影到 body 真读的 image_urls / first_frame_image…）。
// 现场：docs/audit/2026-08-19-l3-w1-shot-verify/run.json——参考落 reference_images、body 读 image_urls → 全被护栏拒。
describe("projectReferencesOntoBodyKeys — headless 参考键形态投影（W1d 根因修复）", () => {
  // seedream/gemini 改图真实 seed body：读 image_urls（数组）。
  const editBody = { model: "{{model.modelKey}}", size: "{{request.params.size}}", image_urls: "{{request.params.image_urls}}" };
  // seedance i2v 真实 seed body：image_urls 与 image_with_roles 互斥同存。
  const seedanceI2v = { image_urls: "{{request.params.image_urls}}", video_urls: "{{request.params.video_urls}}", audio_urls: "{{request.params.audio_urls}}", image_with_roles: "{{request.params.image_with_roles}}" };
  // kling i2v：单图字符串首帧键。
  const klingI2v = { first_frame_image: "{{request.params.first_frame_image}}" };
  // 纯文生 body（无参考键）。
  const t2iBody = { model: "{{model.modelKey}}", size: "{{request.params.size}}" };

  it("referenceImages 投影到 image_urls（数组键塞整组）→ 护栏放行", () => {
    const extras = { referenceImages: ["nomi-local://asset/p/a.jpg", "nomi-local://asset/p/b.jpg"] };
    const overlay = projectReferencesOntoBodyKeys(extras, editBody);
    expect(overlay).toEqual({ image_urls: ["nomi-local://asset/p/a.jpg", "nomi-local://asset/p/b.jpg"] });
    // 投影后 body 读得到参考 → 第三闸不再判「参考图发不出」。
    const merged = { ...extras, ...overlay };
    expect(unreachableReferenceLabels({ extras: merged }, editBody)).toEqual([]);
    expect(imageEditGuardError("image_edit", { extras: merged }, true, "Seedream 4.5", editBody, [{ taskKind: "image_edit", body: editBody }])).toBeNull();
  });

  it("单图字符串键（first_frame_image）塞首张、不塞数组（严格端点期待 string）", () => {
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://a.jpg", "nomi-local://b.jpg"] }, klingI2v);
    expect(overlay).toEqual({ first_frame_image: "nomi-local://a.jpg" });
  });

  it("互斥的对象形态键（image_with_roles）不填——只填 plain image_urls，避免既错形状又互斥", () => {
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://a.jpg", "nomi-local://b.jpg"] }, seedanceI2v);
    expect(overlay).toEqual({ image_urls: ["nomi-local://a.jpg", "nomi-local://b.jpg"] });
    expect(overlay).not.toHaveProperty("image_with_roles");
  });

  it("同族多键（image_urls 数组 + first_frame_image 单值）只填一个：优先数组键（扁平列表天然去处）", () => {
    const happyhorse = { first_frame_image: "{{request.params.first_frame_image}}", image_urls: "{{request.params.image_urls}}" };
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://a.jpg", "nomi-local://b.jpg"] }, happyhorse);
    expect(overlay).toEqual({ image_urls: ["nomi-local://a.jpg", "nomi-local://b.jpg"] });
  });

  it("image + video 两族各填自己的 plain 复数键（都塞数组）", () => {
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://a.jpg"], referenceVideoUrls: ["nomi-local://v.mp4"] }, seedanceI2v);
    expect(overlay).toEqual({ image_urls: ["nomi-local://a.jpg"], video_urls: ["nomi-local://v.mp4"] });
  });

  it("纯文生 body（无参考键）→ 投影 no-op（行为逐字节不变）", () => {
    expect(projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://a.jpg"] }, t2iBody)).toEqual({});
  });

  it("既有值优先：extras 已填 image_urls（渲染层 archetypeInput 或调用方显式）→ 不覆盖（渲染层路径 no-op）", () => {
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: ["nomi-local://new.jpg"], image_urls: ["https://cdn/preset.jpg"] }, editBody);
    expect(overlay).toEqual({});
  });

  it("无任何携带参考 → 空对象（零开销）", () => {
    expect(projectReferencesOntoBodyKeys({}, editBody)).toEqual({});
    expect(projectReferencesOntoBodyKeys(undefined, editBody)).toEqual({});
  });
});

describe("declared numeric and negative controls", () => {
  it("preserves extras seed and negative_prompt when top-level request fields are absent", () => {
    const params = taskTemplateParams({ extras: { seed: "123", negative_prompt: "blur" } });
    expect(params.seed).toBe(123);
    expect(params.negative_prompt).toBe("blur");
  });
  it("top-level request values win over extras, including seed zero", () => {
    const params = taskTemplateParams({ seed: 0, negativePrompt: "noise", extras: { seed: "123", negative_prompt: "blur" } });
    expect(params.seed).toBe(0);
    expect(params.negative_prompt).toBe("noise");
  });
});

describe("projectReferencesOntoBodyKeys — 帧意图优先（2026-08-27 真机 422 的回归）", () => {
  // Wan 3.0（kie）真实 seed body：**同时**声明帧键与参考数组键，而官方规定两族硬互斥。
  const wan30Body = {
    model: "{{request.params.model}}",
    input: {
      prompt: "{{request.prompt}}",
      first_frame_url: "{{request.params.first_frame_url}}",
      last_frame_url: "{{request.params.last_frame_url}}",
      reference_image_urls: "{{request.params.reference_image_urls}}",
      reference_video_urls: "{{request.params.reference_video_urls}}",
      reference_audio_urls: "{{request.params.reference_audio_urls}}",
    },
  };
  const FIRST = "https://x/first.png";
  const LAST = "https://x/last.png";

  // 病史：扁平 firstFrameUrl 被「每族优先数组键」的启发式塞进 reference_image_urls，
  // 而标准键 firstFrameUrl 又原样留着 → 渲染出的 body 两族键同时出现 → kie HTTP 422
  // "first_frame_url / last_frame_url and reference_*_urls are mutually exclusive"。
  // 只有渲染层（按选中模式构造 archetypeInput）躲过了，headless/MCP/agent 提交全中。
  it("扁平 firstFrameUrl 只落帧键，**绝不**同时填参考数组键", () => {
    const overlay = projectReferencesOntoBodyKeys({ firstFrameUrl: FIRST }, wan30Body);
    expect(overlay).toEqual({ first_frame_url: FIRST });
    // 负例对照：数组键一旦回来就红——这正是 422 的直接成因。
    expect(overlay).not.toHaveProperty("reference_image_urls");
    expect(Object.keys(overlay)).toHaveLength(1);
  });

  it("首尾帧各归各位，仍不碰参考数组", () => {
    const overlay = projectReferencesOntoBodyKeys({ firstFrameUrl: FIRST, lastFrameUrl: LAST }, wan30Body);
    expect(overlay).toEqual({ first_frame_url: FIRST, last_frame_url: LAST });
    expect(overlay).not.toHaveProperty("reference_image_urls");
  });

  it("只给参考图列表时照旧走数组键（没把这条路修死）", () => {
    const overlay = projectReferencesOntoBodyKeys({ referenceImageUrls: ["https://x/a.png", "https://x/b.png"] }, wan30Body);
    expect(overlay).toEqual({ reference_image_urls: ["https://x/a.png", "https://x/b.png"] });
  });

  it("调用方**自己**同时给了首帧与参考图 → 各归各位（这个组合是他要的，不是我们造的）", () => {
    // 我们只保证不**发明**互斥组合；调用方显式要的组合照发，由上游按自己的规则裁决。
    const overlay = projectReferencesOntoBodyKeys({ firstFrameUrl: FIRST, referenceImageUrls: ["https://x/a.png"] }, wan30Body);
    expect(overlay).toEqual({ first_frame_url: FIRST, reference_image_urls: ["https://x/a.png"] });
  });

  it("UI 路逐字节 no-op（archetypeInput 权威，短路投影）", () => {
    const overlay = projectReferencesOntoBodyKeys(
      { firstFrameUrl: FIRST, archetypeInput: { first_frame_url: FIRST } },
      wan30Body,
    );
    expect(overlay).toEqual({});
  });

  it("body **没有**帧键时，首帧照旧落进数组键（Wan 2.7 / HappyHorse 用 image_urls 兼作首帧位）", () => {
    // 这条守的是「别把修复做过头」：帧意图优先只在 body 真有帧键时生效。
    const wan27Body = { model: "m", image_urls: "{{request.params.image_urls}}" };
    expect(projectReferencesOntoBodyKeys({ firstFrameUrl: FIRST }, wan27Body)).toEqual({ image_urls: [FIRST] });
  });

  it("控制开关键不是帧载体：return_last_frame 不许接走首帧", () => {
    // seedance 的 return_last_frame（返回尾帧图的布尔开关）名字里有 frame，但它是开关不是载体。
    // 误判会让首帧落到一个布尔位上，真正的图一张都发不出去。
    const body = { image_urls: "{{request.params.image_urls}}", return_last_frame: "{{request.params.return_last_frame}}" };
    const overlay = projectReferencesOntoBodyKeys({ firstFrameUrl: FIRST }, body);
    expect(overlay).toEqual({ image_urls: [FIRST] });
    expect(overlay).not.toHaveProperty("return_last_frame");
  });
});

describe("投影不变量：全体内置 mapping 都不许同时发出帧键与同族参考数组键（P2 类级门岗）", () => {
  // 要求是「修在根上，让**任何**同时带帧槽与参考槽的档案都安全，而不只是 Wan 3.0」。
  // 故这条不针对某个模型，而是遍历**全部**内置 mapping：只要一条 body 同时声明了真帧键与
  // 图族数组键，就断言「只给首帧」时投影绝不会两个都填。新增档案落进这个形状会被自动覆盖。
  it("遍历全部内置 mapping", async () => {
    const [{ applyBuiltinSeeds }, { bodyReferencedParamKeys }, { classifyReferenceKeyDetailed }] = await Promise.all([
      import("./seedBuiltins"),
      import("./paramTranslate"),
      import("./referenceReachability"),
    ]);
    const state = applyBuiltinSeeds(
      { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} },
      "2026-01-01T00:00:00.000Z",
    ).state;

    const FRAME_URL = "https://x/frame.png";
    const violations: string[] = [];
    let covered = 0;

    for (const mapping of state.mappings) {
      const body = mapping.create?.body;
      if (!body) continue;
      const keys = bodyReferencedParamKeys(body);
      // 真帧键：名字命中 first/last_frame **且**被分类器认作参考载体（排除 return_last_frame 这类开关）。
      const frameKeys = keys.filter(
        (k) => /first_frame|last_frame/i.test(k) && !/with_roles|_contents?\b/i.test(k) && classifyReferenceKeyDetailed(k),
      );
      const arrayKeys = keys.filter((k) => /^(reference_)?image_urls$|^input_urls$|^reference_images$/i.test(k));
      if (frameKeys.length === 0 || arrayKeys.length === 0) continue;
      covered += 1;

      const overlay = projectReferencesOntoBodyKeys({ firstFrameUrl: FRAME_URL }, body);
      const filledFrame = frameKeys.filter((k) => overlay[k] !== undefined);
      const filledArray = arrayKeys.filter((k) => overlay[k] !== undefined);
      if (filledFrame.length > 0 && filledArray.length > 0) {
        violations.push(`${mapping.vendorKey}/${mapping.modelKey ?? mapping.id}: 同时填了 ${filledFrame} 与 ${filledArray}`);
      }
      if (filledArray.length > 0 && filledFrame.length === 0) {
        violations.push(`${mapping.vendorKey}/${mapping.modelKey ?? mapping.id}: 首帧被投进数组键 ${filledArray}（帧键 ${frameKeys} 空着）`);
      }
    }

    // 前提坐实：真有这个形状的 mapping 存在，否则这条测试等于没测（空跑绿）。
    expect(covered).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

// ── 无 mapping 兜底路的静默退化（自建中转最吃亏的那一族）─────────────────────────────
//
// 场景：用户把模型接在自己的中转上，模型经 Provider Adapter 认证发布（meta.adapter.publicationModes），
// 但**一条 mapping 都没有**。runtime 找不到 mapping → 走 /v1/{images,videos}/generations 兜底，
// 那条 body 写死 {model,prompt,size,seed,n,response_format}，**没有任何参考位**。
// 修复前：第三闸只在 createBody 有值时才跑，而这条路 createBody 是 undefined，于是
// text_to_image / text_to_video 带着参考图长驱直入 → 生成成功、扣费成功、和参考图毫无关系。
// （image_edit / image_to_video 早被下方 !hasMapping 分支拦住，所以这个洞只在纯文生两个 kind 上现形。）
describe("无 mapping 兜底：参考素材不得静默丢弃", () => {
  const refs = { referenceImages: ["https://cdn.example.com/ref.png"] };

  it.each(["text_to_image", "text_to_video"] as const)(
    "%s 带参考图但没有任何 mapping → 拒发（而不是走兜底把参考丢掉）",
    (kind) => {
      const error = imageEditGuardError(kind, { extras: refs }, false, "我的中转模型");
      expect(error).toContain("发不出");
      expect(error).toContain("参考图");
    },
  );

  it("首帧图同样受保护（不同参考族，同一条兜底 wire）", () => {
    const error = imageEditGuardError(
      "text_to_video",
      { extras: { firstFrameUrl: "https://cdn.example.com/f.png" } },
      false,
      "我的中转模型",
    );
    expect(error).toContain("首帧");
  });

  it("没带参考时兜底路照常放行——纯文生是它的正当用途，不许误伤", () => {
    expect(imageEditGuardError("text_to_image", { extras: {} }, false, "我的中转模型")).toBeNull();
    expect(imageEditGuardError("text_to_video", { extras: {} }, false, "我的中转模型")).toBeNull();
    // 配音走同步 TTS runner，也在「无 mapping」形状里，不能被这条闸误伤。
    expect(imageEditGuardError("text_to_audio", { extras: {} }, false, "我的中转模型")).toBeNull();
  });

  it("image_edit / image_to_video 无 mapping 时仍用更具体的「没有通道」文案（本闸不抢答）", () => {
    // 两条路都是拒发 + 零扣费，效果相同；但「没有『图生图（改图）』通道」点名了缺什么、该怎么办，
    // 比通用的「发不出：参考图」更会说话。故补兜底 body 只补下方没管的那些 kind。
    expect(imageEditGuardError("image_edit", { extras: refs }, false, "我的中转模型"))
      .toMatch(/没有「图生图（改图）」通道/);
    expect(imageEditGuardError("image_to_video", { extras: refs }, false, "我的中转模型"))
      .toMatch(/没有「图生视频」通道/);
  });

  it("有 mapping、只是调用方没传 body（customCall 走脚本）→ 无证据，不收窄", () => {
    // hasMapping=true + createBody=undefined 是「查不到」，不是「确知发不出」。
    // 把它也拦掉就会把脚本渠道的参考能力冤杀（fail-open 纪律）。
    expect(imageEditGuardError("text_to_image", { extras: refs }, true, "脚本模型")).toBeNull();
  });

  it("兜底 body 形状与 runtime 实际发出的键一致（防两处漂移）", () => {
    // runtime.ts 兜底分支发的就是这几个键。任何一边加了参考位而另一边没跟上，
    // 闸门与真实 wire 就会分家——这条断言把对应关系钉死。
    expect(Object.keys(NO_MAPPING_FALLBACK_BODY).sort()).toEqual(
      ["model", "n", "prompt", "response_format", "seed", "size"],
    );
    // 关键不变量：这条 wire 一个参考族的位置都没有。
    expect(unreachableReferenceLabels({ extras: refs }, NO_MAPPING_FALLBACK_BODY)).toEqual(["参考图"]);
  });
});
