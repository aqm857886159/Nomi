import { describe, expect, it } from "vitest";
import { APIMART_VIDEO_MODELS } from "../../catalog/apimartVideos";
import { applyBuiltinSeeds } from "../../catalog/seedBuiltins";
import type { CatalogState } from "../../catalog/types";
import { getArchetypeById } from "../../../src/config/modelArchetypes";
import {
  SEEDANCE_2_APIMART_ARCHETYPE,
  buildVideoModelCandidates,
  recommendVideoGeneration,
  sourceBackedVideoProfiles,
  videoArchetypeIdFromMeta,
} from "./index";

describe("shared video capability registry", () => {
  it("does not reject references just because the provider has not published a maximum", () => {
    const [base] = buildVideoModelCandidates([{ provider: "apimart", modelKey: "sora-2", label: "Sora", archetypeId: "sora-2" }]);
    const candidate = { ...base!, archetype: { ...base!.archetype,
      modes: base!.archetype.modes.map(mode => ({ ...mode, slots: mode.slots.map(slot => ({ ...slot, max: undefined })) })),
    } };
    const result = recommendVideoGeneration({ references: Array.from({ length: 12 }, () => ({ kind: "image" as const })) }, [candidate]);
    expect(result.recommendations.some(item => item.modeId === "i2v")).toBe(true);
  });

  it("exposes the same source-backed profile to renderer and shared consumers", () => {
    // The renderer registry (MODEL_ARCHETYPES) now holds the exact electron object —
    // no re-export shell in between — so resolving by id returns the identical instance.
    expect(getArchetypeById(SEEDANCE_2_APIMART_ARCHETYPE.id)).toBe(SEEDANCE_2_APIMART_ARCHETYPE);
    const candidates = buildVideoModelCandidates([
      { provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" },
      { provider: "apimart", modelKey: "doubao-seedance-2.0-fast", label: "Seedance 2.0 Fast" },
      { provider: "apimart", modelKey: "doubao-seedance-2.0-mini", label: "Seedance 2.0 Mini" },
    ]);
    expect(candidates.map((candidate) => candidate.modelKey)).toEqual([
      "doubao-seedance-2.0",
      "doubao-seedance-2.0-fast",
      "doubao-seedance-2.0-mini",
    ]);
    expect(candidates.map((candidate) => candidate.variantId)).toEqual(["standard", "fast", "mini"]);
  });

  it("recommends from facts without any provider or app dependency", () => {
    const candidates = buildVideoModelCandidates([
      { provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" },
    ]);
    const result = recommendVideoGeneration({
      prompt: "从首帧自然过渡到尾帧",
      references: [
        { kind: "image", role: "first_frame" },
        { kind: "image", role: "last_frame" },
      ],
    }, candidates);

    expect(result.recommendations[0]).toMatchObject({ provider: "apimart", modeId: "firstlast" });
  });

  it("keeps an unverified catalog model usable without inventing advanced reference capabilities", () => {
    const [candidate] = buildVideoModelCandidates([
      { provider: "new-provider", modelKey: "new-video-model", label: "New video model" },
    ]);
    expect(candidate?.archetype.modes.map((mode) => mode.id)).toEqual(["t2v", "i2v"]);
    expect(candidate?.archetype.modes.flatMap((mode) => mode.expressionChannels ?? [])).toEqual([
      expect.objectContaining({ signal: "camera_motion", status: "unknown" }),
      expect.objectContaining({ signal: "camera_motion", status: "unknown" }),
    ]);
    expect(recommendVideoGeneration({ references: [{ kind: "image", role: "character" }] }, [candidate!]).recommendations[0]?.modeId).toBe("i2v");
    expect(recommendVideoGeneration({ references: [{ kind: "image", role: "first_frame" }, { kind: "image", role: "last_frame" }] }, [candidate!]).recommendations).toHaveLength(0);
  });

  it("resolves every curated APIMart video model through its existing archetype pointer", () => {
    const candidates = buildVideoModelCandidates(APIMART_VIDEO_MODELS.map((model) => ({
      provider: "apimart",
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: model.archetypeId,
    })));

    expect(candidates).toHaveLength(APIMART_VIDEO_MODELS.length);
    expect(candidates.map((candidate) => candidate.archetype.id)).toEqual(
      APIMART_VIDEO_MODELS.map((model) => model.archetypeId),
    );
  });

  it("uses the existing provider-specific controls and isolates them across model switches", () => {
    const candidates = buildVideoModelCandidates([
      { provider: "apimart", modelKey: "kling-v3", label: "Kling 3.0", archetypeId: "kling-3.0" },
      { provider: "apimart", modelKey: "MiniMax-Hailuo-2.3", label: "Hailuo 2.3", archetypeId: "hailuo-2.3" },
    ]);
    const klingParams = candidates[0]?.archetype.modes.find((mode) => mode.id === "t2v")?.params.map((control) => control.key);
    const hailuoParams = candidates[1]?.archetype.modes.find((mode) => mode.id === "t2v")?.params.map((control) => control.key);

    expect(klingParams).toContain("audio");
    expect(klingParams).not.toContain("sound");
    expect(klingParams).toContain("aspect_ratio");
    expect(hailuoParams).toEqual(["resolution", "duration"]);
  });

  it("reuses every existing curated video archetype across all seeded providers", () => {
    const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const state = applyBuiltinSeeds(empty, "2026-08-24T00:00:00.000Z").state;
    const models = state.models.filter((model) => model.kind === "video" && videoArchetypeIdFromMeta(model.meta));
    const candidates = buildVideoModelCandidates(models.map((model) => ({
      provider: model.vendorKey,
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: videoArchetypeIdFromMeta(model.meta),
    })));
    const mismatches = candidates.flatMap((candidate, index) => {
      const expected = videoArchetypeIdFromMeta(models[index]?.meta);
      return candidate.archetype.id === expected ? [] : [`${models[index]?.vendorKey}/${candidate.modelKey}: ${candidate.archetype.id} != ${expected}`];
    });

    expect(mismatches).toEqual([]);
  });

  it("keeps renderer lookups and main-process planning on the same profile objects", () => {
    const mismatches = sourceBackedVideoProfiles().flatMap((profile) =>
      getArchetypeById(profile.id) === profile ? [] : [profile.id],
    );

    expect(mismatches).toEqual([]);
  });
});
