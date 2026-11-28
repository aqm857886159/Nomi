import { describe, expect, it } from "vitest";

import {
  DEFAULT_GENERATION_MODEL_DEFAULTS,
  GENERATION_MODEL_KEY_MAX_LENGTH,
  mediaKindForTaskKind,
  normalizeGenerationModelDefaults,
} from "../shared/contracts/generationModelDefaultsContract";

describe("normalizeGenerationModelDefaults (schemaVersion 2)", () => {
  it("keeps a well-formed two-part identity per media kind (image / video)", () => {
    const value = normalizeGenerationModelDefaults({
      schemaVersion: 2,
      byKind: {
        image: { vendorKey: "apimart", modelKey: "gpt-image-2.6-sunburst" },
        video: { vendorKey: "apimart", modelKey: "doubao-seedance-2.5" },
      },
    });
    expect(value.schemaVersion).toBe(2);
    expect(value.byKind.image).toEqual({ vendorKey: "apimart", modelKey: "gpt-image-2.6-sunburst" });
    expect(value.byKind.video).toEqual({ vendorKey: "apimart", modelKey: "doubao-seedance-2.5" });
  });

  it("resets legacy schemaVersion 1 (4-row byTaskKind) cleanly back to Auto without migrating (SG-3)", () => {
    const upgraded = normalizeGenerationModelDefaults({
      schemaVersion: 1,
      byTaskKind: {
        text_to_image: { vendorKey: "kie", modelKey: "seedream-4.0" },
        image_edit: { vendorKey: "apimart", modelKey: "gpt-image-2" },
        text_to_video: { vendorKey: "apimart", modelKey: "doubao-seedance-2.0" },
        image_to_video: { vendorKey: "kie", modelKey: "bytedance/seedance-2" },
      },
    });
    expect(upgraded).toEqual({ schemaVersion: 2, byKind: {} });
  });

  it("drops half an identity — it cannot resolve to one model", () => {
    const value = normalizeGenerationModelDefaults({
      schemaVersion: 2,
      byKind: {
        image: { modelKey: "seedream-4.0" },
        video: { vendorKey: "  ", modelKey: "x" },
      },
    });
    expect(value.byKind).toEqual({});
  });

  it("drops unknown media kinds and malformed entries", () => {
    const value = normalizeGenerationModelDefaults({
      schemaVersion: 2,
      byKind: {
        audio: { vendorKey: "a", modelKey: "b" },
        image: "not-an-object",
        video: null,
      },
    });
    expect(value.byKind).toEqual({});
  });

  it("trims keys and rejects absurdly long ones", () => {
    const value = normalizeGenerationModelDefaults({
      schemaVersion: 2,
      byKind: {
        image: { vendorKey: "  kie  ", modelKey: "  seedream  " },
        video: { vendorKey: "a", modelKey: "x".repeat(GENERATION_MODEL_KEY_MAX_LENGTH + 1) },
      },
    });
    expect(value.byKind.image).toEqual({ vendorKey: "kie", modelKey: "seedream" });
    expect(value.byKind.video).toBeUndefined();
  });

  it("maps all 4 task kinds onto image or video media kinds", () => {
    expect(mediaKindForTaskKind("text_to_image")).toBe("image");
    expect(mediaKindForTaskKind("image_edit")).toBe("image");
    expect(mediaKindForTaskKind("text_to_video")).toBe("video");
    expect(mediaKindForTaskKind("image_to_video")).toBe("video");
  });

  it("survives garbage input without throwing", () => {
    for (const garbage of [undefined, null, 42, "text", [], { schemaVersion: 2, byKind: [] }]) {
      expect(normalizeGenerationModelDefaults(garbage)).toEqual(DEFAULT_GENERATION_MODEL_DEFAULTS);
    }
  });
});
