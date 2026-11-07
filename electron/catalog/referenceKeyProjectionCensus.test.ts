import { describe, expect, it } from "vitest";

import { bodyReferencedParamKeys } from "./paramTranslate";
import { projectReferencesOntoBodyKeys } from "./taskParams";
import { buildReferenceKeyCensus } from "../../scripts/reference-key-census";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { bodyReferenceSupport } from "./referenceReachability";
import { referenceKeyCapacityDeclarationFor, referenceKeyDeclarationFor } from "../shared/modelArchetypes/referenceKeys";
import { desktopT } from "../desktopStrings";

const NOW = "2026-10-25T00:00:00.000Z";
const IMAGE = "https://ref.test/image.png";
const VIDEO = "https://ref.test/video.mp4";
const AUDIO = "https://ref.test/audio.mp3";

function seededMapping(id: string) {
  const { state } = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW);
  const mapping = state.mappings.find((candidate) => candidate.id === id);
  if (!mapping) throw new Error(`missing seeded mapping: ${id}`);
  return mapping;
}

function seededContext(mapping: ReturnType<typeof seededMapping>) {
  const { state } = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW);
  const model = state.models.find((candidate) => candidate.modelKey === mapping.modelKey && candidate.vendorKey === mapping.vendorKey);
  return { vendorKey: mapping.vendorKey, modelKey: mapping.modelKey, modelMeta: model?.meta, taskKind: mapping.taskKind };
}

describe("reference-key projection census — declared reference behavior", () => {
  it("has no false positives in real seeded creation bodies", () => {
    const census = buildReferenceKeyCensus();
    // 2026-11-07 +6：APIMart Suno V6 三档的歌曲和音效（没有参考图键，所以分类行数不变）。
    expect(census.summary.seededMappings).toBe(252);
    expect(census.summary.rowsWithClassifiedKeys).toBe(124);
    expect(census.summary.falsePositiveRows).toBe(0);
    expect(census.summary.falsePositiveKeys).toBe(0);
    expect(census.summary.falsePositiveKeyNames).toEqual([]);
  });

  it("directory capacity follows each model declaration when one exists", () => {
    const { state } = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW);
    const modelByKey = new Map(state.models.map((model) => [`${model.vendorKey}:${model.modelKey}`, model]));
    const census = buildReferenceKeyCensus();
    for (const row of census.rows) {
      const mapping = state.mappings.find((candidate) => candidate.id === row.id)!;
      const model = mapping.modelKey ? modelByKey.get(`${mapping.vendorKey}:${mapping.modelKey}`) : undefined;
      const context = { vendorKey: mapping.vendorKey, modelKey: mapping.modelKey, modelMeta: model?.meta, taskKind: mapping.taskKind };
      const declared = row.keys.filter((entry) => entry.capacitySource === "模型声明");
      if (declared.length === 0) continue;
      const support = bodyReferenceSupport(mapping.create?.body, context);
      expect(support.multiImage, row.id).toBe(declared.some((entry) => entry.capacity?.multiImage));
      for (const entry of declared) {
        expect(entry.capacity?.source, `${row.id}/${entry.key}`).toBe("model-declaration");
      }
    }
  });

  it("image-only headless input does not land in a quantity field", () => {
    const mapping = seededMapping("seed-fal-openai-gpt-image-2-t2i");
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: [IMAGE] }, mapping.create.body);
    expect(bodyReferencedParamKeys(mapping.create.body)).toContain("num_images");
    expect(overlay).not.toHaveProperty("num_images");
    expect(overlay).toEqual({});
  });

  it("image-only headless input lands in a declared image slot", () => {
    const mapping = seededMapping("seed-kie-seedance2-image_to_video");
    const overlay = projectReferencesOntoBodyKeys({ referenceImages: [IMAGE] }, mapping.create.body);
    expect(overlay).toEqual({ reference_image_urls: [IMAGE] });
  });

  it.each([
    ["seed-rh-seedance-global-i2v", "generateAudio"],
    ["seed-kie-happyhorse-text_to_video", "audio_setting"],
    ["seed-apimart-kling-3.0-image_to_video", "audio"],
  ])("audio-only headless input does not land in the %s non-reference field", (mappingId, key) => {
    const mapping = seededMapping(mappingId);
    const overlay = projectReferencesOntoBodyKeys({ referenceAudioUrls: [AUDIO] }, mapping.create.body);
    expect(bodyReferencedParamKeys(mapping.create.body)).toContain(key);
    expect(overlay).not.toHaveProperty(key);
    expect(overlay).toEqual({});
  });

  it("removing the declared video input from a real body does not project into a numeric control", () => {
    const mapping = seededMapping("seed-agnes-video-2.5-text_to_video");
    const bodyWithoutDeclaredVideoInput = { ...(mapping.create.body as Record<string, unknown>) };
    delete bodyWithoutDeclaredVideoInput.videos;
    const overlay = projectReferencesOntoBodyKeys({ referenceVideoUrls: [VIDEO] }, bodyWithoutDeclaredVideoInput);
    expect(overlay).not.toHaveProperty("video_start_seconds");
    expect(overlay).toEqual({});
  });

  it("keeps an existing boolean value while projecting audio into its declared slot", () => {
    const mapping = seededMapping("seed-apimart-seedance-2-apimart-image_to_video");
    const overlay = projectReferencesOntoBodyKeys({ referenceAudioUrls: [AUDIO], audio: false }, mapping.create.body);
    expect(overlay).toEqual({ audio_urls: [AUDIO] });
  });

  it.each([
    ["seed-volcengine-seedance-2-image_to_video", "volcengine-seedance-2", 9],
    ["seed-volcengine-seedance-2-5-image_to_video", "volcengine-seedance-2-5", 30],
  ] as const)("model declaration keeps Volcengine omni image capacity at %d", (mappingId, archetypeId, max) => {
    const mapping = seededMapping(mappingId);
    const context = { ...seededContext(mapping), archetypeId, taskKind: mapping.taskKind };
    const support = bodyReferenceSupport(mapping.create.body, context);
    expect(support).toMatchObject({ image: true, multiImage: true });
    expect(referenceKeyCapacityDeclarationFor("volcengine_image_contents", context)).toMatchObject({
      source: "model-declaration",
      family: "image",
      max,
    });
  });

  it.each([
    ["seed-rh-seedream45-i2i", "rh-seedream-4.5"],
    ["seed-rh-nano-edit", "rh-nano-banana"],
    ["seed-rh-gpt2-i2i", "rh-gpt-image-2"],
  ] as const)("model declaration keeps RunningHub image capacity single for %s", (mappingId, archetypeId) => {
    const mapping = seededMapping(mappingId);
    const context = { ...seededContext(mapping), archetypeId, taskKind: mapping.taskKind };
    expect(referenceKeyDeclarationFor("imageUrls")?.multiImage).toBe(true);
    expect(bodyReferenceSupport(mapping.create.body, context)).toMatchObject({ image: true, multiImage: false });
    expect(referenceKeyCapacityDeclarationFor("imageUrls", context)).toMatchObject({ source: "model-declaration", max: 1, multiImage: false });
    expect(() => projectReferencesOntoBodyKeys({ referenceImages: [IMAGE, `${IMAGE}-2`] }, mapping.create.body, context))
      .toThrow(desktopT("modelConstraints.imageReferenceCapacity", { max: 1 }));
  });
});
