import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATION_MODEL_DEFAULTS,
  GENERATION_MODEL_KEY_MAX_LENGTH,
  normalizeGenerationModelDefaults,
} from "../shared/contracts/generationModelDefaultsContract";

describe("normalizeGenerationModelDefaults", () => {
  it("keeps a well-formed two-part identity per task kind", () => {
    const value = normalizeGenerationModelDefaults({
      schemaVersion: 1,
      byTaskKind: {
        text_to_image: { vendorKey: "kie", modelKey: "seedream-4.0" },
        image_to_video: { vendorKey: "apimart", modelKey: "seedance-1.0-pro" },
      },
    });
    expect(value.byTaskKind.text_to_image).toEqual({ vendorKey: "kie", modelKey: "seedream-4.0" });
    expect(value.byTaskKind.image_to_video).toEqual({ vendorKey: "apimart", modelKey: "seedance-1.0-pro" });
  });

  it("drops half an identity — it cannot resolve to one model", () => {
    // 只有 modelKey 时无法区分「哪家的 seedream」，落到卡片上必然是错的那一个。
    const value = normalizeGenerationModelDefaults({
      byTaskKind: {
        text_to_image: { modelKey: "seedream-4.0" },
        image_edit: { vendorKey: "kie" },
        text_to_video: { vendorKey: "  ", modelKey: "x" },
      },
    });
    expect(value.byTaskKind).toEqual({});
  });

  it("drops unknown task kinds and malformed entries", () => {
    const value = normalizeGenerationModelDefaults({
      byTaskKind: {
        text_to_audio: { vendorKey: "a", modelKey: "b" },
        text_to_image: "not-an-object",
        image_edit: null,
      },
    });
    expect(value.byTaskKind).toEqual({});
  });

  it("trims keys and rejects absurdly long ones", () => {
    const value = normalizeGenerationModelDefaults({
      byTaskKind: {
        text_to_image: { vendorKey: "  kie  ", modelKey: "  seedream  " },
        image_edit: { vendorKey: "a", modelKey: "x".repeat(GENERATION_MODEL_KEY_MAX_LENGTH + 1) },
      },
    });
    expect(value.byTaskKind.text_to_image).toEqual({ vendorKey: "kie", modelKey: "seedream" });
    expect(value.byTaskKind.image_edit).toBeUndefined();
  });

  it("survives garbage input without throwing", () => {
    for (const garbage of [undefined, null, 42, "text", [], { byTaskKind: [] }]) {
      expect(normalizeGenerationModelDefaults(garbage)).toEqual(DEFAULT_GENERATION_MODEL_DEFAULTS);
    }
  });
});
