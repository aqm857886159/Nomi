import { describe, expect, it } from "vitest";
import { applyParamMap } from "./paramTranslate";
import { GEMINI_OMNI_11_CREATE_OP } from "./kieGeminiOmni11";

describe("KIE Gemini Omni 1.1 wire contract", () => {
  it("keeps numeric UI duration but emits the documented string enum", () => {
    const params = applyParamMap(GEMINI_OMNI_11_CREATE_OP.paramMap, { duration: 4 });
    expect(params.duration).toBe("4");
  });

  it("declares all multimodal reference fields at the mapping boundary", () => {
    const input = (GEMINI_OMNI_11_CREATE_OP.body as { input: Record<string, unknown> }).input;
    expect(Object.keys(input)).toEqual(expect.arrayContaining(["audio_ids", "video_list", "character_ids", "first_frame_url", "last_frame_url"]));
  });
});
