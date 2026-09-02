import { describe, expect, it } from "vitest";
import { applyParamMap } from "./paramTranslate";
import {
  ELEVENLABS_MAPPING_IDS,
  ELEVENLABS_MODELS,
  ELEVENLABS_OPERATIONS,
} from "./elevenlabs";
import { applyRequestTransform } from "../tasks/requestTransforms";

describe("ElevenLabs 官方旗舰合同", () => {
  it("keeps Music v2 prompt-only and translates canonical seconds to milliseconds", () => {
    expect(ELEVENLABS_OPERATIONS.musicV2.body).toMatchObject({ prompt: "{{request.prompt}}", model_id: "music_v2" });
    expect(ELEVENLABS_OPERATIONS.musicV2.body).not.toHaveProperty("seed");
    expect(applyParamMap(ELEVENLABS_OPERATIONS.musicV2.paramMap, { duration_seconds: 30, seed: 7 })).toMatchObject({
      duration_seconds: 30,
      seed: 7,
      music_length_ms: 30_000,
    });
  });

  it("rejects Sound Effects v2 above the official 30 second cap before provider dispatch", async () => {
    await expect(applyRequestTransform("eleven-sfx-v2-duration-cap", {
      duration_seconds: 31,
    }, { baseUrl: "https://api.elevenlabs.io" })).rejects.toThrow(/30 秒/);
    await expect(applyRequestTransform("eleven-sfx-v2-duration-cap", {
      duration_seconds: 30,
    }, { baseUrl: "https://api.elevenlabs.io" })).resolves.toMatchObject({ duration_seconds: 30 });
  });

  it("keeps the static identity manifest in sync with all four curated mappings", () => {
    expect([...ELEVENLABS_MAPPING_IDS].sort()).toEqual(
      ELEVENLABS_MODELS.flatMap((model) => model.mappings.map((mapping) => mapping.id)).sort(),
    );
  });
});
