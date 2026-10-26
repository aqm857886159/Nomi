import { describe, expect, it } from "vitest";
import { AGNES_VENDOR_SEED, AGNES_VIDEO_QUERY_OP, AGNES_STATUS_MAPPING } from "./agnesVendor";
import { AGNES_IMAGE_MODELS } from "./agnesImages";
import { AGNES_VIDEO_MODELS } from "./agnesVideos";
import { AGNES_TEXT_MODELS } from "./agnesTexts";
import { normalizeAgnesVideo25 } from "./agnesVideoContract";
import { applyParamMap, agnesVideoWidth, agnesVideoHeight, agnesVideoNumFrames } from "./paramTranslate";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { taskTemplateParams, applyHeadlessParamDefaults } from "./taskParams";
import { modelReferenceSelection } from "./modelCatalogListing";
import { applyRequestTransform, validateRequestTransform } from "../tasks/requestTransforms";
import { getArchetypeById, resolveArchetypeForModel } from "../shared/modelArchetypes";
import { buildArchetypeInputParams, currentArchetypeMode, ensureArchetypeNodeMeta } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { bodyReferenceSupport } from "./referenceReachability";
import type { HttpOperation } from "./types";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";

// Official Agnes docs checked 2026-08-26; actual response fixtures and rendered wire contracts.
// 不需真 key——live E2E（需用户 AGNES key）另验数字字段被网关接受 + extra_body 嵌套解析。

describe("Agnes 供应商种子", () => {
  it("裸 baseUrl + bearer（避 joinUrl 双前缀，文本走 /v1 由 nomiModelConfigFor 补）", () => {
    expect(AGNES_VENDOR_SEED.key).toBe("agnes");
    expect(AGNES_VENDOR_SEED.baseUrl).toBe("https://apihub.agnes-ai.com"); // 裸，不带 /v1
    expect(AGNES_VENDOR_SEED.authType).toBe("bearer");
  });
});

describe("Agnes 文本大脑", () => {
  it("完整公开文本清单，不按当前账户权限删模型", () => {
    expect(AGNES_TEXT_MODELS.map((m) => m.modelKey)).toEqual(["agnes-2.0-flash", "agnes-2.5-flash", "agnes-2.5-pro-alpha", "agnes-2.5-pro-beta", "agnes-2.5-pro"]);
  });
});

describe("Agnes 图片（同步 create，形状锁）", () => {
  const SYNC_OK = { created: 1780000000, data: [{ url: "https://storage.googleapis.com/agnes-aigc/x.png", b64_json: null }] };

  it("2.0 + 2.1 各自尺寸档案；t2i/edit 两条 mapping，结果在 data.0.url", () => {
    expect(AGNES_IMAGE_MODELS.map((m) => m.modelKey)).toEqual(["agnes-image-2.1-flash", "agnes-image-2.0-flash"]);
    for (const model of AGNES_IMAGE_MODELS) {
      expect(model.archetypeId).toBe(model.modelKey.includes("2.1") ? "agnes-image-2.1" : "agnes-image");
      expect(model.mappings.map((m) => m.taskKind)).toEqual(["text_to_image", "image_edit"]);
      for (const mp of model.mappings) {
        expect(mp.create.path).toBe("/v1/images/generations");
        expect(mp.create.response_mapping?.image_url).toBe("data.0.url");
        expect(mp.create.response_mapping?.task_id).toBeUndefined(); // 同步族，无轮询
      }
    }
  });

  it("AGNES quirk：response_format 在 extra_body 内；edit 参考图进 extra_body.image（非顶层）", () => {
    const model = AGNES_IMAGE_MODELS[0];
    const t2i = model.mappings[0].create.body as { size: unknown; extra_body: Record<string, unknown> };
    expect(t2i.extra_body.response_format).toBe("url");
    expect(t2i.extra_body.image).toBeUndefined(); // 文生图无输入图
    expect(t2i.size).toBe("{{request.params.size}}");

    const edit = model.mappings[1].create.body as { extra_body: Record<string, unknown> };
    expect(edit.extra_body.image).toBe("{{request.params.image}}"); // 输入图数组进 extra_body
    expect(edit.extra_body.response_format).toBe("url");
  });

  it("真实同步响应经 runtime 解析器：有图即 succeeded", () => {
    const rm = AGNES_IMAGE_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    const url = firstMappedString(SYNC_OK, rm, "image_url");
    expect(url).toBe("https://storage.googleapis.com/agnes-aigc/x.png");
    expect(taskStatusFromResponse(SYNC_OK, rm, undefined, [url])).toBe("succeeded");
  });
});

describe("Agnes 视频（异步 create→poll，形状锁 + 两个 quirk）", () => {
  const CREATE_OK = { id: "task_abc", task_id: "task_abc", video_id: "video_xyz", status: "queued" };
  // Actual 2026-08-26 responses: output is url, remixed_from_video_id is null.
  const QUERY_OK = {
    id: "task_abc", video_id: "video_xyz", status: "completed", progress: 100,
    remixed_from_video_id: null, url: "https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4", error: null,
  };

  it("三款视频保留 V2.0 mapping IDs；提交抓 video_id；frame_rate 由控件提供", () => {
    expect(AGNES_VIDEO_MODELS).toHaveLength(3);
    const model = AGNES_VIDEO_MODELS[0];
    expect(model).toMatchObject({ modelKey: "agnes-video-v2.0", archetypeId: "agnes-video" });
    expect(model.mappings.map((m) => [m.id, m.taskKind])).toEqual([
      ["seed-agnes-video-v2-text_to_video", "text_to_video"],
      ["seed-agnes-video-v2-image_to_video", "image_to_video"],
    ]);
    for (const mp of model.mappings) {
      expect(mp.create.path).toBe("/v1/videos");
      expect(mp.create.response_mapping?.task_id).toBe("video_id");
      expect(mp.create.provider_meta_mapping?.video_id).toBe("video_id");
      expect((mp.create.body as { frame_rate: unknown }).frame_rate).toBe("{{request.params.frame_rate}}"); // Number normalization is verified on the rendered request below.
    }
    // i2v 多一个顶层 image 字段（单图首帧）。
    const i2v = model.mappings[1].create.body as Record<string, unknown>;
    expect(i2v.image).toBe("{{request.params.image}}");
  });

  it("quirk①：轮询 op 是 /agnesapi（非 /v1）+ video_id 走 query 参数", () => {
    expect(AGNES_VIDEO_QUERY_OP.method).toBe("GET");
    expect(AGNES_VIDEO_QUERY_OP.path).toBe("/agnesapi");
    expect((AGNES_VIDEO_QUERY_OP.query as Record<string, unknown>)?.video_id).toBe("{{providerMeta.video_id}}");
  });

  it("当前实际产物 URL 位于顶层 url；旧 remixed_from_video_id 为 null", () => {
    const createMap = AGNES_VIDEO_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    expect(firstMappedString(CREATE_OK, createMap, "task_id")).toBe("video_xyz");

    const queryMap = AGNES_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    const video = firstMappedString(QUERY_OK, queryMap, "video_url");
    expect(video).toBe("https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4");
    expect(collectAssetUrls(video)).toEqual(["https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4"]);
    // status "completed" 经 AGNES_STATUS_MAPPING 归一 succeeded。
    expect(taskStatusFromResponse(QUERY_OK, queryMap, AGNES_STATUS_MAPPING, [video])).toBe("succeeded");
  });

  it("status 归一：queued→queued、in_progress→running、failed→failed", () => {
    const queryMap = AGNES_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    expect(taskStatusFromResponse({ status: "queued" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("queued");
    expect(taskStatusFromResponse({ status: "in_progress" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("running");
    expect(taskStatusFromResponse({ status: "failed", error: "boom" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("failed");
  });
});

describe("Agnes 视频 paramMap 派生（D1：比例+清晰度+时长 → width/height/num_frames）", () => {
  // ⚠️ 返回**数字**：AGNES Go 后端 int 严格(发字符串 400,2026-06-30 live 实测)。
  it("transform：16:9 @720p → 1280×720；9:16 @720p → 720×1280；1:1 @1080p → 1080×1080（数字）", () => {
    expect([agnesVideoWidth(["16:9", "720p"]), agnesVideoHeight(["16:9", "720p"])]).toEqual([1280, 720]);
    expect([agnesVideoWidth(["9:16", "720p"]), agnesVideoHeight(["9:16", "720p"])]).toEqual([720, 1280]);
    expect([agnesVideoWidth(["1:1", "1080p"]), agnesVideoHeight(["1:1", "1080p"])]).toEqual([1080, 1080]);
  });

  it("transform：时长→num_frames 贴最近 8n+1，不能静默截短超出上限的时长", () => {
    expect(agnesVideoNumFrames(["5"])).toBe(121); // 5×24=120 → 8×15+1
    expect(agnesVideoNumFrames(["10"])).toBe(241);
    expect(() => agnesVideoNumFrames(["30"])).toThrow("duration");
    expect(() => agnesVideoNumFrames(["18", "60"])).toThrow("duration");
    expect(agnesVideoNumFrames(["1", "1"])).toBe(1);
    expect(agnesVideoNumFrames(["7.35", "60"])).toBe(441);
    expect(((Number(agnesVideoNumFrames(["3"])) - 1) % 8)).toBe(0); // 始终 8n+1
  });

  it("applyParamMap 套到 create.paramMap：注入数字 width/height/num_frames，原 canonical 键保留", () => {
    const paramMap = AGNES_VIDEO_MODELS[0].mappings[0].create.paramMap;
    const out = applyParamMap(paramMap, { aspect_ratio: "16:9", resolution: "1080p", duration: "5" });
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.num_frames).toBe(121);
  });
});


async function renderAgnes(op: HttpOperation, modelKey: string, params: Record<string, unknown> = {}) {
  const request = { kind: "text_to_video", prompt: "A paper crane", seed: 123, negativePrompt: "blur", extras: { ...op.defaultParams, ...params } };
  const context = buildTemplateContext({
    request, model: { modelKey }, modelKey, apiKey: "test-key",
    params: applyParamMap(op.paramMap, taskTemplateParams(request)),
    providerMeta: { video_id: "video_test" },
  });
  const rendered = buildHttpRequest({ baseUrl: AGNES_VENDOR_SEED.baseUrl, authType: "bearer", apiKey: "test-key", operation: op, context });
  await validateRequestTransform(op.request_transform, rendered.body, { baseUrl: AGNES_VENDOR_SEED.baseUrl, request });
  return { ...rendered, body: await applyRequestTransform(op.request_transform, rendered.body, { baseUrl: AGNES_VENDOR_SEED.baseUrl, request }) as Record<string, unknown> };
}

function videoOp(key: string, taskKind = "text_to_video") {
  const model = AGNES_VIDEO_MODELS.find((m) => m.modelKey === key);
  expect(model, key).toBeDefined();
  return model!.mappings.find((m) => m.taskKind === taskKind)!.create;
}

describe("Agnes 2026-08-26 documented wire contracts", () => {
  it.each([{ mode: ["text"] }, { size: ["720P"] }, { aspect_ratio: ["16:9"] }])("rejects non-string enums before spending: %j", (invalid) => {
    expect(() => normalizeAgnesVideo25({ model: "agnes-video-2.5", mode: "text", size: "720P", seconds: "4", ...invalid })).toThrow();
  });
  it("Image 2.1 sends tier, ratio and array edit input in the documented nesting", async () => {
    const model = AGNES_IMAGE_MODELS[0];
    const { body } = await renderAgnes(model.mappings[1].create, model.modelKey, { size: "4K", ratio: "21:9", archetypeInput: { image: ["https://example.com/a.png", "https://example.com/b.png"] } });
    expect(body).toEqual({ model: model.modelKey, prompt: "A paper crane", size: "4K", ratio: "21:9", extra_body: { response_format: "url", image: ["https://example.com/a.png", "https://example.com/b.png"] } });
    const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: "agnes" });
    expect(archetype?.id).toBe("agnes-image-2.1");
    expect(archetype?.modes[0].params.find((p) => p.key === "size")?.options.map((o) => o.value)).toEqual(["1K", "2K", "3K", "4K"]);
    expect(archetype?.modes[1].slots[0].max).toBeUndefined();
  });

  it("V2.0 preserves existing identity and modes while adding keyframes and typed advanced parameters", async () => {
    const archetype = getArchetypeById("agnes-video")!;
    expect(archetype.modes.map((m) => m.id)).toEqual(["t2v", "i2v", "keyframes"]);
    const { body } = await renderAgnes(videoOp("agnes-video-v2.0", "image_to_video"), "agnes-video-v2.0", {
      frame_rate: "30", duration: 4, num_inference_steps: "28", archetypeInput: { mode: "keyframes", keyframe_images: ["https://example.com/a.png", "https://example.com/b.png"] },
    });
    expect(body).toMatchObject({ width: 1280, height: 720, num_frames: 121, frame_rate: 30, seed: 123, num_inference_steps: 28, negative_prompt: "blur", extra_body: { mode: "keyframes", image: ["https://example.com/a.png", "https://example.com/b.png"] } });
    expect(body.image).toBeUndefined();
    expect(body.mode).toBeUndefined();
  });

  it("V2.0 rejects a single keyframe before spending, matching the real upstream 400", async () => {
    const archetype = getArchetypeById("agnes-video")!;
    expect(archetype.modes.find((mode) => mode.id === "keyframes")?.slots[0].min).toBe(2);
    await expect(renderAgnes(videoOp("agnes-video-v2.0", "image_to_video"), "agnes-video-v2.0", {
      archetypeInput: { keyframe_images: ["https://example.com/a.png"] },
    })).rejects.toThrow("at least two");
  });

  it.each(["agnes-video-2.5", "agnes-video-2.5-flash"])("%s text emits seconds as string and no unsupported V2.0 fields", async (modelKey) => {
    const { body } = await renderAgnes(videoOp(modelKey), modelKey, { duration: 7, size: "720P", aspect_ratio: "21:9" });
    expect(body).toEqual({ model: modelKey, prompt: "A paper crane", mode: "text", seconds: "7", size: "720P", aspect_ratio: "21:9", seed: 123, n: 1 });
  });

  it.each(["agnes-video-2.5", "agnes-video-2.5-flash"])("%s supports first-only, last-only and first+last keyframes", async (modelKey) => {
    for (const frames of [{ first_frame: "https://example.com/first.png" }, { last_frame: "https://example.com/last.png" }, { first_frame: "https://example.com/first.png", last_frame: "https://example.com/last.png" }]) {
      const { body } = await renderAgnes(videoOp(modelKey, "image_to_video"), modelKey, { archetypeInput: { mode: "keyframe", ...frames } });
      expect(body).toMatchObject({ mode: "keyframe", ...frames });
      expect(body.images).toBeUndefined();
    }
  });

  it("2.5 multimodal references render video objects without dropping start_seconds / require_audio", async () => {
    const { body } = await renderAgnes(videoOp("agnes-video-2.5", "image_to_video"), "agnes-video-2.5", { archetypeInput: {
      mode: "reference", images: ["https://example.com/a.png"], audios: ["https://example.com/a.mp3"],
      videos: [{ url: "https://example.com/a.mp4", start_seconds: 35, require_audio: false }],
    } });
    expect(body).toMatchObject({ mode: "reference", images: ["https://example.com/a.png"], audios: ["https://example.com/a.mp3"], videos: [{ url: "https://example.com/a.mp4", start_seconds: 35, require_audio: false }] });
    const converted = await renderAgnes(videoOp("agnes-video-2.5", "image_to_video"), "agnes-video-2.5", { archetypeInput: { mode: "reference", videos: ["https://example.com/a.mp4"] } });
    expect(converted.body.videos).toEqual([{ url: "https://example.com/a.mp4" }]);
  });

  it.each(["agnes-video-2.5", "agnes-video-2.5-flash"])("%s supports audio-only reference", async (modelKey) => {
    const { body } = await renderAgnes(videoOp(modelKey, "image_to_video"), modelKey, { archetypeInput: { mode: "reference", audios: ["https://example.com/a.mp3"] } });
    expect(body.audios).toEqual(["https://example.com/a.mp3"]);
    expect(body.images).toBeUndefined();
  });

  it.each([
    { mode: "text", images: ["https://example.com/a.png"] },
    { mode: "keyframe", first_frame: "https://example.com/a.png", audios: ["https://example.com/a.mp3"] },
    { mode: "reference", last_frame: "https://example.com/a.png", images: ["https://example.com/a.png"] },
    { mode: "keyframe" }, { mode: "reference" },
  ])("2.5 rejects invalid mode media before request: %j", async (archetypeInput) => {
    await expect(renderAgnes(videoOp("agnes-video-2.5", "image_to_video"), "agnes-video-2.5", { archetypeInput })).rejects.toThrow();
  });

  it("Flash enforces max five images, fixed 720P and no video", async () => {
    const op = videoOp("agnes-video-2.5-flash", "image_to_video");
    await expect(renderAgnes(op, "agnes-video-2.5-flash", { size: "960P", archetypeInput: { mode: "text" } })).rejects.toThrow();
    await expect(renderAgnes(op, "agnes-video-2.5-flash", { archetypeInput: { mode: "reference", images: Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.png`) } })).rejects.toThrow();
    await expect(renderAgnes(op, "agnes-video-2.5-flash", { archetypeInput: { mode: "reference", videos: ["https://example.com/a.mp4"] } })).rejects.toThrow();
  });

  it.each([3, 13, 4.5])("2.5 rejects invalid seconds %s", async (duration) => {
    await expect(renderAgnes(videoOp("agnes-video-2.5"), "agnes-video-2.5", { duration })).rejects.toThrow();
  });

  it.each(["agnes-video-2.5", "agnes-video-2.5-flash"])("%s archetype GUI projection uses wire mode and appropriate channels", async (modelKey) => {
    const archetype = resolveArchetypeForModel({ modelKey, vendorKey: "agnes" })!;
    expect(archetype.id).toBe(modelKey);
    expect(archetype.modes.map((m) => m.id)).toEqual(["text", "keyframe", "reference"]);
    const mode = archetype.modes.find((m) => m.id === "reference")!;
    expect(mode.slots.map((s) => s.kind)).toEqual(modelKey.endsWith("flash") ? ["image_ref", "audio_ref"] : ["image_ref", "audio_ref", "video_ref"]);
    expect(mode.slots[0].max).toBe(modelKey.endsWith("flash") ? 5 : undefined);
    expect(archetype.sources?.[0].checkedAt).toBe("2026-08-26");
    const input = buildArchetypeInputParams({ archetype: { id: archetype.id, modeId: "reference" }, referenceAudioUrls: ["https://example.com/a.mp3"] }, archetype);
    const { body } = await renderAgnes(videoOp(modelKey, "image_to_video"), modelKey, { archetypeInput: input });
    expect(body).toMatchObject({ mode: "reference", audios: ["https://example.com/a.mp3"] });
  });
});


/** 运行时第一闸收的完整身份（与 runtime.ts 同一个 helper）；内置行的 meta 就是档案指针。 */
const agnes = (modelKey: string, archetypeId: string, taskKind: string) => modelReferenceSelection("agnes", { modelKey, meta: { archetypeId } }, taskKind);

describe("Agnes runtime defaults and preflight", () => {
  it("existing V2.0 image mode is not changed into keyframes by generated defaults", async () => {
    const op = videoOp("agnes-video-v2.0", "image_to_video");
    const extras = applyHeadlessParamDefaults({ archetypeInput: { image: "https://example.com/a.png" } }, agnes("agnes-video-v2.0", "agnes-video", "image_to_video"), op.defaultParams, op.body);
    const { body } = await renderAgnes(op, "agnes-video-v2.0", extras);
    expect(body.image).toBe("https://example.com/a.png");
    expect(body.extra_body).toBeUndefined();
  });
  it("2.5 keyframe stays keyframe through runtime defaults even without an explicit mode", async () => {
    const op = videoOp("agnes-video-2.5", "image_to_video");
    const extras = applyHeadlessParamDefaults({ archetypeInput: { first_frame: "https://example.com/a.png" } }, agnes("agnes-video-2.5", "agnes-video-2.5", "image_to_video"), op.defaultParams, op.body);
    const { body } = await renderAgnes(op, "agnes-video-2.5", extras);
    expect(body).toMatchObject({ mode: "keyframe", first_frame: "https://example.com/a.png" });
  });
  it("headless 2.5 audio and video references remain arrays", async () => {
    const op = videoOp("agnes-video-2.5", "image_to_video");
    const extras = applyHeadlessParamDefaults({ referenceAudioUrls: ["https://example.com/a.mp3"], referenceVideoUrls: ["https://example.com/a.mp4"] }, agnes("agnes-video-2.5", "agnes-video-2.5", "image_to_video"), op.defaultParams, op.body);
    const { body } = await renderAgnes(op, "agnes-video-2.5", extras);
    expect(body.audios).toEqual(["https://example.com/a.mp3"]);
    expect(body.videos).toEqual([{ url: "https://example.com/a.mp4" }]);
  });
  it("reference video controls are applied to URL inputs and preserve per-video overrides", async () => {
    const op = videoOp("agnes-video-2.5", "image_to_video");
    const { body } = await renderAgnes(op, "agnes-video-2.5", { video_start_seconds: 35, video_require_audio: true, archetypeInput: { mode: "reference", videos: ["https://example.com/a.mp4", { url: "https://example.com/b.mp4", start_seconds: 0, require_audio: false }] } });
    expect(body.videos).toEqual([{ url: "https://example.com/a.mp4", start_seconds: 35, require_audio: true }, { url: "https://example.com/b.mp4", start_seconds: 0, require_audio: false }]);
    expect(body.video_start_seconds).toBeUndefined();
  });
  it("top-level actual and documented nested output URLs both resolve", () => {
    const mapping = AGNES_VIDEO_QUERY_OP.response_mapping!;
    expect(firstMappedString({ url: "https://example.com/actual.mp4", remixed_from_video_id: null }, mapping, "video_url")).toBe("https://example.com/actual.mp4");
    expect(firstMappedString({ metadata: { url: "https://example.com/documented.mp4" } }, mapping, "video_url")).toBe("https://example.com/documented.mp4");
  });
});


it("Flash mappings do not advertise unsupported reference video channels to headless callers", () => {
  expect(bodyReferenceSupport(videoOp("agnes-video-2.5-flash", "image_to_video").body).video).toBe(false);
  expect(bodyReferenceSupport(videoOp("agnes-video-2.5", "image_to_video").body).video).toBe(true);
});


it("Image 2.1 upgrades a persisted shared archetype without losing edit mode or reference images", () => {
  const meta = { modelKey: "agnes-image-2.1-flash", archetype: { id: "agnes-image", modeId: "edit" }, referenceImageUrls: ["https://example.com/a.png"], size: "1024x768" };
  const archetype = resolveArchetypeForModel({ modelKey: meta.modelKey, vendorKey: "agnes", meta })!;
  expect(archetype.id).toBe("agnes-image-2.1");
  expect(currentArchetypeMode(archetype, meta).id).toBe("edit");
  expect(buildArchetypeInputParams(meta, archetype)).toEqual({ image: ["https://example.com/a.png"] });
  expect(ensureArchetypeNodeMeta(meta, archetype)).toMatchObject({ archetype: { id: "agnes-image-2.1", modeId: "edit" }, referenceImageUrls: meta.referenceImageUrls, size: "1K", ratio: "4:3" });
  expect(resolveArchetypeForModel({ modelKey: "agnes-image-2.0-flash", vendorKey: "agnes", meta: { archetype: meta.archetype } })?.id).toBe("agnes-image");
});

it.each([
  ["1024x1024", "1:1"], ["768x1024", "3:4"], ["1280x720", "16:9"],
  ["720x1280", "9:16"], ["1536x1024", "3:2"], ["1024x1536", "2:3"],
])("Image 2.1 migrates legacy pixels %s to tier while retaining ratio %s", (size, ratio) => {
  const meta = { modelKey: "agnes-image-2.1-flash", archetype: { id: "agnes-image", modeId: "t2i" }, size };
  const archetype = resolveArchetypeForModel({ modelKey: meta.modelKey, vendorKey: "agnes", meta })!;
  const migrated = ensureArchetypeNodeMeta(meta, archetype)!;
  expect(migrated).toMatchObject({ size: "1K", ratio });
  expect(ensureArchetypeNodeMeta(migrated, archetype)).toBeNull();
  expect(ensureArchetypeNodeMeta({ ...meta, ratio: "21:9" }, archetype)).toMatchObject({ ratio: "21:9" });
});


it("Image 2.1 headless caller aspect and resolution reach the wire instead of default square 1K", async () => {
  const model = AGNES_IMAGE_MODELS[0];
  const op = model.mappings[0].create;
  const extras = applyHeadlessParamDefaults({ aspect_ratio: "16:9", resolution: "4k", size: "16:9" }, agnes(model.modelKey, model.archetypeId, "text_to_image"), op.defaultParams, op.body);
  expect((await renderAgnes(op, model.modelKey, extras)).body).toMatchObject({ size: "4K", ratio: "16:9" });
});
it("Video 2.5 headless caller resolution reaches uppercase size", async () => {
  const op = videoOp("agnes-video-2.5");
  const extras = applyHeadlessParamDefaults({ resolution: "960p" }, agnes("agnes-video-2.5", "agnes-video-2.5", "text_to_video"), op.defaultParams, op.body);
  expect((await renderAgnes(op, "agnes-video-2.5", extras)).body.size).toBe("960P");
});
