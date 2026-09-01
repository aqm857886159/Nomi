import { describe, expect, it } from "vitest";
import { applyRequestTransform } from "../tasks/requestTransforms";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { normalizeApimartCanonicalModelId, validateOmniFlashExtBody } from "./apimartModelIds";

const video = (modelKey: string, taskKind: string) => {
  const model = APIMART_VIDEO_MODELS.find((item) => item.modelKey === modelKey);
  const mapping = model?.mappings.find((item) => item.taskKind === taskKind);
  if (!mapping) throw new Error(`missing APIMart mapping ${modelKey}/${taskKind}`);
  return mapping;
};

const image = (modelKey: string, taskKind: string) => {
  const model = APIMART_IMAGE_MODELS.find((item) => item.modelKey === modelKey);
  const mapping = model?.mappings.find((item) => item.taskKind === taskKind);
  if (!mapping) throw new Error(`missing APIMart mapping ${modelKey}/${taskKind}`);
  return mapping;
};

describe("APIMart official model IDs and Omni reference contract", () => {
  it.each([
    ["doubao-seedream-4.5", "seedream-4.5"],
    ["doubao-seedream-5-0-pro", "seedream-5-0-pro"],
    ["doubao-seedance-2.0", "seedance-2.0"],
    ["doubao-seedance-2-0", "seedance-2.0"],
    ["doubao-seedance-2.0-fast", "seedance-2.0-fast"],
    ["doubao-seedance-2-0-fast", "seedance-2.0-fast"],
    ["doubao-seedance-2.0-mini", "seedance-2.0-mini"],
    ["doubao-seedance-2-0-mini", "seedance-2.0-mini"],
    ["doubao-seedance-2.0-face", "seedance-2.0-face"],
    ["doubao-seedance-2-0-face", "seedance-2.0-face"],
    ["doubao-seedance-2.0-fast-face", "seedance-2.0-fast-face"],
    ["doubao-seedance-2-0-fast-face", "seedance-2.0-fast-face"],
    ["doubao-seedance-2.5", "seedance-2.5"],
    ["doubao-seedance-2-5", "seedance-2.5"],
    ["grok-imagine-1.5-video-apimart", "grok-imagine-1.5-video-ext"],
    ["Omni-Flash-Ext", "gemini-omni-1.1-flash-ext"],
  ] as const)("canonicalizes every historical alias %s", (legacy, expected) => {
    expect(normalizeApimartCanonicalModelId({ model: legacy, prompt: "x" })).toMatchObject({ model: expected });
  });

  it.each([
    ["doubao-seedream-4.5", "text_to_image", "seedream-4.5"],
    ["doubao-seedream-5-0-pro", "text_to_image", "seedream-5-0-pro"],
  ])("canonicalizes image model %s", async (modelKey, taskKind, expected) => {
    const mapping = image(modelKey, taskKind);
    expect(mapping.create.request_transform).toBe("apimart-canonical-model-id");
    await expect(applyRequestTransform(mapping.create.request_transform, { model: modelKey }, { baseUrl: "https://api.apimart.ai" })).resolves.toMatchObject({ model: expected });
  });

  it.each([
    ["doubao-seedance-2.0", "seedance-2.0"],
    ["doubao-seedance-2.5", "seedance-2.5"],
    ["grok-imagine-1.5-video-apimart", "grok-imagine-1.5-video-ext"],
  ])("canonicalizes video model %s", async (modelKey, expected) => {
    const mapping = video(modelKey, "text_to_video");
    expect(mapping.create.request_transform).toBe("apimart-canonical-model-id");
    await expect(applyRequestTransform(mapping.create.request_transform, { model: modelKey }, { baseUrl: "https://api.apimart.ai" })).resolves.toMatchObject({ model: expected });
  });

  it("canonicalizes Omni and rejects two reference images before spend", async () => {
    const mapping = video("Omni-Flash-Ext", "image_to_video");
    expect(mapping.create.request_transform).toBe("apimart-omni-flash-ext-contract");
    await expect(applyRequestTransform(mapping.create.request_transform, {
      model: "Omni-Flash-Ext",
      image_urls: ["https://x/one.png", "https://x/two.png"],
      generation_type: "reference",
    }, { baseUrl: "https://api.apimart.ai" })).rejects.toThrow(/1 或 3/);
  });

  it.each([1, 3])("accepts Omni reference cardinality %s", async (count) => {
    const mapping = video("Omni-Flash-Ext", "image_to_video");
    const transformed = await applyRequestTransform(mapping.create.request_transform, {
      model: "Omni-Flash-Ext",
      image_urls: Array.from({ length: count }, (_, index) => `https://x/${index}.png`),
      generation_type: "reference",
    }, { baseUrl: "https://api.apimart.ai" });
    expect(transformed).toMatchObject({ model: "gemini-omni-1.1-flash-ext" });
  });

  it("rejects Omni reference mode when generation_type is missing or frame", () => {
    for (const generation_type of [undefined, "frame"]) {
      expect(() => validateOmniFlashExtBody({ image_urls: ["https://x/one.png"], generation_type })).toThrow();
    }
  });

  it("rejects malformed Omni image_urls before request construction", () => {
    expect(() => validateOmniFlashExtBody({ image_urls: "https://x/one.png", generation_type: "reference" })).toThrow();
    expect(() => validateOmniFlashExtBody({ image_urls: ["https://x/one.png", "https://x/two.png"], generation_type: "reference" })).toThrow(/1 或 3/);
  });
});
