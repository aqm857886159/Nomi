import { describe, it, expect } from "vitest";
import type { CatalogState, Mapping } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";
import {
  GPT_IMAGE_2_I2I_CREATE_OP,
  GPT_IMAGE_2_QUERY_OP,
  GPT_IMAGE_2_T2I_CREATE_OP,
  isBrokenKieImageMapping,
} from "./kieGptImage2";

const NOW = "2026-06-06T00:00:00.000Z";
const emptyCatalog = (): CatalogState => ({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} });

describe("GPT Image 2 · 传输契约（锁死，防漂移）", () => {
  it("文生图 body：prompt + aspect_ratio + resolution（铁律：resolution 是 gpt-image-2 能力），无 input_urls、无 duration", () => {
    const input = (GPT_IMAGE_2_T2I_CREATE_OP.body as { input: Record<string, unknown> }).input;
    expect(input.prompt).toBe("{{request.prompt}}");
    expect(input.aspect_ratio).toBe("{{request.params.aspect_ratio}}");
    expect(input.resolution).toBe("{{request.params.resolution}}");
    expect("input_urls" in input).toBe(false);
    expect("duration" in input).toBe(false); // duration 才是视频参数（resolution 不是）
    expect(GPT_IMAGE_2_T2I_CREATE_OP.path).toBe("/api/v1/jobs/createTask");
  });

  it("图生图 body：input_urls + aspect_ratio + resolution，仍无 duration", () => {
    const input = (GPT_IMAGE_2_I2I_CREATE_OP.body as { input: Record<string, unknown> }).input;
    expect(input.input_urls).toBe("{{request.params.input_urls}}");
    expect(input.prompt).toBe("{{request.prompt}}");
    expect(input.resolution).toBe("{{request.params.resolution}}");
    expect("duration" in input).toBe(false);
  });

  it("结果读 image_url = data.resultJson.resultUrls.0（不是 video_url）", () => {
    const rm = GPT_IMAGE_2_QUERY_OP.response_mapping || {};
    expect(rm.image_url).toBe("data.resultJson.resultUrls.0");
    expect(rm.video_url).toBeUndefined();
    expect(GPT_IMAGE_2_QUERY_OP.path).toBe("/api/v1/jobs/recordInfo");
  });
});

describe("isBrokenKieImageMapping", () => {
  const mk = (over: Partial<Mapping>): Mapping => ({
    id: "x", vendorKey: "kie", taskKind: "text_to_image", name: "x", enabled: true,
    create: { method: "POST", path: "/p", body: { input: {} } },
    createdAt: NOW, updatedAt: NOW, ...over,
  });
  it("视频参数（duration）→ 坏", () => {
    expect(isBrokenKieImageMapping(mk({ create: { method: "POST", path: "/p", body: { input: { prompt: "x", duration: "{{x}}" } } } }))).toBe(true);
  });
  it("结果读 video_url 且 image_url 空 → 坏", () => {
    expect(isBrokenKieImageMapping(mk({ query: { method: "GET", path: "/q", response_mapping: { video_url: "data.resultJson.resultUrls.0" } } }))).toBe(true);
  });
  it("正确的文生图 mapping → 不算坏", () => {
    expect(isBrokenKieImageMapping(mk({ create: GPT_IMAGE_2_T2I_CREATE_OP, query: GPT_IMAGE_2_QUERY_OP }))).toBe(false);
  });
  it("非 (kie, text_to_image) → 不判定", () => {
    expect(isBrokenKieImageMapping(mk({ vendorKey: "other" }))).toBe(false);
    expect(isBrokenKieImageMapping(mk({ taskKind: "image_to_video" }))).toBe(false);
  });
});

describe("applyBuiltinSeeds · GPT Image 2", () => {
  it("空目录：补齐 t2i + i2i 模型 + (kie,text_to_image) + (kie,image_edit) mapping", () => {
    const { state } = applyBuiltinSeeds(emptyCatalog(), NOW);
    expect(state.models.find((m) => m.modelKey === "gpt-image-2-text-to-image")).toMatchObject({ vendorKey: "kie", kind: "image", enabled: true });
    expect(state.models.find((m) => m.modelKey === "gpt-image-2-image-to-image")).toMatchObject({ vendorKey: "kie", kind: "image" });
    const t2i = state.mappings.find((mp) => mp.vendorKey === "kie" && mp.taskKind === "text_to_image");
    const i2i = state.mappings.find((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_edit");
    expect(t2i).toBeTruthy();
    expect(i2i).toBeTruthy();
    expect((i2i?.create.body as { input: Record<string, unknown> }).input.input_urls).toBe("{{request.params.input_urls}}");
  });

  it("repair：已存在的视频形状坏 (kie,text_to_image) 被替换成正确契约", () => {
    const broken: Mapping = {
      id: "mapping-kie-gpt-image-2", vendorKey: "kie", taskKind: "text_to_image", name: "Gemini Omni Video", enabled: true,
      create: { method: "POST", path: "/api/v1/jobs/createTask", body: { model: "{{model.modelKey}}", input: { prompt: "{{request.prompt}}", duration: "{{request.params.duration}}", resolution: "{{request.params.resolution}}" } } },
      query: { method: "GET", path: "/api/v1/jobs/recordInfo", response_mapping: { video_url: "data.resultJson.resultUrls.0", image_url: "" } },
      createdAt: NOW, updatedAt: NOW,
    };
    const seed = applyBuiltinSeeds({ version: 3, vendors: [], models: [], mappings: [broken], apiKeysByVendor: {} }, NOW);
    const repaired = seed.state.mappings.find((mp) => mp.id === "mapping-kie-gpt-image-2");
    const input = (repaired?.create.body as { input: Record<string, unknown> }).input;
    expect("duration" in input).toBe(false);
    expect(repaired?.query?.response_mapping?.image_url).toBe("data.resultJson.resultUrls.0");
    // 且 image_edit 也补上了
    expect(seed.state.mappings.some((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_edit")).toBe(true);
  });

  it("幂等：第二次调用不再 changed", () => {
    const first = applyBuiltinSeeds(emptyCatalog(), NOW);
    const second = applyBuiltinSeeds(first.state, NOW);
    expect(second.changed).toBe(false);
  });
});
