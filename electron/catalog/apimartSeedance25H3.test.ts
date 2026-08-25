import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyRequestTransform } from "../tasks/requestTransforms";
import { buildArchetypeInputParams } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { getArchetypeById } from "../../src/config/modelArchetypes";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { applyParamMap } from "./paramTranslate";
import { taskTemplateParams } from "./taskParams";

const emptyCatalog = () => ({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });

function renderH3I2vBody(extras: Record<string, unknown>) {
  const mapping = APIMART_VIDEO_MODELS.find((model) => model.modelKey === "MiniMax-H3")?.mappings.find((item) => item.taskKind === "image_to_video");
  if (!mapping) throw new Error("MiniMax-H3 image_to_video mapping is missing");
  const request = { kind: "image_to_video", prompt: "镜头缓慢推近", extras };
  const context = buildTemplateContext({
    request,
    params: applyParamMap(mapping.create.paramMap, taskTemplateParams(request)),
    model: { modelKey: "MiniMax-H3" },
    modelKey: "MiniMax-H3",
    apiKey: "TEST_SECRET",
  });
  const built = buildHttpRequest({
    baseUrl: "https://api.apimart.ai",
    authType: "bearer",
    apiKey: "TEST_SECRET",
    context,
    operation: mapping.create,
  });
  return { mapping, body: built.body as Record<string, unknown> };
}

describe("APIMart Seedance 2.5 / MiniMax-H3 curated 接入", () => {
  it("fresh seed 包含四个官方入口，且 mapping 桶按模型精确绑定", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), "2026-08-11T00:00:00.000Z");
    expect(state.models.filter((m) => m.vendorKey === "apimart").map((m) => m.modelKey)).toEqual(expect.arrayContaining([
      "doubao-seedance-2.5",
      "MiniMax-H3",
      "MiniMax-H3-Regeneration",
      "MiniMax-H3-Context-IR",
    ]));

    const seedance25 = state.mappings.filter((m) => m.modelKey === "doubao-seedance-2.5");
    expect(seedance25.map((m) => m.taskKind)).toEqual(["text_to_video", "image_to_video"]);
    expect(seedance25[1].create.body).toMatchObject({
      model: "{{model.modelKey}}",
      image_with_roles: "{{request.params.image_with_roles}}",
      video_urls: "{{request.params.video_urls}}",
      audio_urls: "{{request.params.audio_urls}}",
      return_last_frame: "{{request.params.return_last_frame}}",
    });

    const h3 = state.mappings.filter((m) => m.modelKey === "MiniMax-H3");
    expect(h3.map((m) => m.taskKind)).toEqual(["text_to_video", "image_to_video"]);
    expect(h3[1].create.body).toMatchObject({
      first_frame_image: "{{request.params.first_frame_image}}",
      last_frame_image: "{{request.params.last_frame_image}}",
      image_urls: "{{request.params.image_urls}}",
      video_urls: "{{request.params.video_urls}}",
      audio_urls: "{{request.params.audio_urls}}",
    });

    const context = state.mappings.find((m) => m.modelKey === "MiniMax-H3-Context-IR");
    expect(context).toMatchObject({ taskKind: "prompt_refine", query: { response_mapping: { text: "data.result.prompt" } } });

    const regeneration = state.mappings.find((m) => m.modelKey === "MiniMax-H3-Regeneration");
    expect(regeneration).toMatchObject({ taskKind: "text_to_video" });
    expect(regeneration?.create.body).toEqual({
      model: "{{model.modelKey}}",
      source_task_id: "{{request.params.source_task_id}}",
    });
  });

  it("Seedance 2.5 首尾帧只生成 image_with_roles，不与 image_urls 混发", () => {
    const archetype = getArchetypeById("seedance-2.5-apimart");
    expect(archetype).toBeTruthy();
    const meta = { archetype: { id: "seedance-2.5-apimart", modeId: "firstlast" } };
    const params = buildArchetypeInputParams(meta, archetype!, { firstFrameUrl: "https://x/first.png", lastFrameUrl: "https://x/last.png" });
    expect(params.image_with_roles).toEqual([
      { url: "https://x/first.png", role: "first_frame" },
      { url: "https://x/last.png", role: "last_frame" },
    ]);
    expect(params.image_urls).toBeUndefined();
  });

  it("H3 首帧使用 APIMart 的 first_frame_image wire 键", () => {
    const archetype = getArchetypeById("minimax-h3-apimart");
    expect(archetype).toBeTruthy();
    const meta = { archetype: { id: "minimax-h3-apimart", modeId: "first" } };
    const params = buildArchetypeInputParams(meta, archetype!, { firstFrameUrl: "https://x/first.png" });
    expect(params.first_frame_image).toBe("https://x/first.png");
    expect(params.first_frame_url).toBeUndefined();
  });

  it("H3 最终请求体拒绝首尾帧与多模态参考混发", async () => {
    const { mapping, body } = renderH3I2vBody({
      first_frame_image: "https://x/first.png",
      image_urls: ["https://x/reference.png"],
    });

    await expect(
      applyRequestTransform(mapping.create.request_transform, body, { baseUrl: "https://api.apimart.ai" }),
    ).rejects.toThrow(/首尾帧.*参考素材/);
  });

  it("H3 多模态参考拒绝音频单独输入，并清理首尾帧模式忽略的字段", async () => {
    const ref = renderH3I2vBody({
      audio_urls: ["https://x/reference.mp3"],
    });
    await expect(
      applyRequestTransform(ref.mapping.create.request_transform, ref.body, { baseUrl: "https://api.apimart.ai" }),
    ).rejects.toThrow(/音频不能单独/);

    const frame = renderH3I2vBody({
      first_frame_image: "https://x/first.png",
      aspect_ratio: "16:9",
      webhook: "",
    });
    const transformed = await applyRequestTransform(frame.mapping.create.request_transform, frame.body, { baseUrl: "https://api.apimart.ai" });
    expect(transformed).not.toHaveProperty("aspect_ratio");
    expect(transformed).not.toHaveProperty("webhook");
  });
});
