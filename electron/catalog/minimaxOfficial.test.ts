import { describe, expect, it } from "vitest";
import {
  MINIMAX_H3_OFFICIAL_CREATE,
  MINIMAX_OFFICIAL_MAPPING_IDS,
  MINIMAX_OFFICIAL_MODELS,
  MINIMAX_VENDOR_SEED,
  normalizeMinimaxH3OfficialBody,
} from "./minimaxOfficial";
import { MINIMAX_H3_MAX_ARCHETYPE } from "../shared/videoCapabilities/minimaxH3Max";

describe("MiniMax 官方合同", () => {
  it("uses the Open Platform .com host accepted by the scoped API key", () => {
    expect(MINIMAX_VENDOR_SEED.baseUrl).toBe("https://api.minimaxi.com");
    expect(MINIMAX_VENDOR_SEED.authHeader).toBe("Authorization");
  });

  it("points H3-Max at the current official video guide", () => {
    expect(MINIMAX_H3_MAX_ARCHETYPE.sources?.[0]).toMatchObject({
      url: "https://platform.minimaxi.com/docs/guides/video-generation",
      checkedAt: "2026-09-02",
    });
  });

  it("serializes H3 multimodal content and rejects mixed frame/reference inputs", () => {
    const body = normalizeMinimaxH3OfficialBody({
      prompt: "a slow camera move",
      first_frame_url: "https://example.com/first.png",
      resolution: "768P",
      duration: 6,
    }) as Record<string, unknown>;
    expect(body.content).toEqual([
      { type: "text", text: "a slow camera move" },
      { type: "image_url", image_url: { url: "https://example.com/first.png" }, role: "first_frame" },
    ]);
    expect(body.ratio).toBe("adaptive");
    expect(() => normalizeMinimaxH3OfficialBody({
      prompt: "conflict",
      first_frame_url: "https://example.com/first.png",
      reference_image_urls: ["https://example.com/ref.png"],
    })).toThrow(/冲突/);
  });

  it("keeps the model identity and production endpoint in one mapping", () => {
    expect(MINIMAX_H3_OFFICIAL_CREATE.path).toBe("/v2/video_generation");
    expect(MINIMAX_H3_OFFICIAL_CREATE.body).toMatchObject({ model: "MiniMax-H3" });
  });

  it("keeps the static certification identity manifest in sync with every curated mapping", () => {
    expect([...MINIMAX_OFFICIAL_MAPPING_IDS].sort()).toEqual(
      MINIMAX_OFFICIAL_MODELS.flatMap((model) => model.mappings.map((mapping) => mapping.id)).sort(),
    );
  });

  // MiniMax 的文本/对话「大脑」是 MiniMax-M3（2026-06-01 官方发布，多模态 chat；M3 取代已废弃的
  // M1，见 docs/plan/2026-08-30-provider-model-expansion-and-runtime.md）。M3 是 OpenAI 兼容 chat，
  // 故**无 create/query mapping**——agent 走 buildLanguageModelForVendor 直连 /v1/chat/completions，
  // modelKey 即 chat model id。这条断言把「文本模型仍在册且仍是无 mapping 的 chat 形状」钉住，
  // 防止有人误加 mapping（那会把它错当异步任务模型）或悄悄删掉它。
  it("declares MiniMax-M3 as the openai-compatible chat brain (no async mapping)", () => {
    const text = MINIMAX_OFFICIAL_MODELS.filter((model) => model.kind === "text");
    expect(text.map((model) => model.modelKey)).toEqual(["MiniMax-M3"]);
    expect(text.every((model) => model.mappings.length === 0)).toBe(true);
  });
});
