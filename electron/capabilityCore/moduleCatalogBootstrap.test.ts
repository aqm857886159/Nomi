import { describe, expect, it } from "vitest";

import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import type { CatalogState, Mapping, Model } from "../catalog/types";

function state(over: Partial<CatalogState>): CatalogState {
  return { version: 8, vendors: [], models: [], mappings: [], apiKeysByVendor: {}, ...over } as CatalogState;
}

function model(over: Partial<Model>): Model {
  return { modelKey: "image-model", vendorKey: "provider-a", labelZh: "Image", kind: "image", enabled: true, createdAt: "t", updatedAt: "t", ...over } as Model;
}

function mapping(over: Partial<Mapping>): Mapping {
  return { id: "mapping-1", vendorKey: "provider-a", modelKey: "image-model", taskKind: "text_to_image", name: "Image", enabled: true, create: { method: "POST", path: "/generate", body: {}, defaultParams: { aspectRatio: "16:9" } }, createdAt: "t", updatedAt: "t", ...over } as Mapping;
}

describe("createCatalogModuleRegistry", () => {
  it("derives provider/model/mode/parameter declarations from the user catalog", () => {
    const registry = createCatalogModuleRegistry(state({
      models: [
        model({ modelKey: "image-model", vendorKey: "provider-a", onboarding: { addedVia: "manual", addedAt: "t", fields: [{ key: "aspectRatio", displayName: "Aspect", type: "select", options: [{ value: "1:1", label: "Square" }, { value: "16:9", label: "Wide" }] }] } }),
        model({ modelKey: "video-model", vendorKey: "provider-b", kind: "video" }),
      ],
      mappings: [mapping({}), mapping({ id: "mapping-2", vendorKey: "provider-b", modelKey: "video-model", taskKind: "image_to_video", create: { method: "POST", path: "/video", body: {} } })],
    }));
    const image = registry.resolve({ moduleId: "generation.single-shot", providerId: "provider-a", modelId: "image-model", mode: "text_to_image" });
    const video = registry.resolve({ moduleId: "generation.single-shot", providerId: "provider-b", modelId: "video-model", mode: "image_to_video" });
    expect(image.parameterSchema.aspectRatio).toMatchObject({ type: "enum", enum: ["1:1", "16:9"] });
    expect(video.mode).toBe("image_to_video");
    expect(video.capabilities).toEqual({ submitIdempotency: false, query: false, reconcile: false, cancel: false });
  });

  it("returns an empty registry for an empty catalog instead of inventing a provider", () => {
    const registry = createCatalogModuleRegistry(state({ models: [] }));
    expect(() => registry.resolve({ moduleId: "generation.single-shot", providerId: "anything", modelId: "anything", mode: "text_to_image" })).toThrow(/Unknown module/);
  });

  it("does not register an enabled unverified adapter model even when a raw enabled mapping exists", () => {
    const registry = createCatalogModuleRegistry(state({
      models: [model({ meta: { adapter: { state: "unverified", modes: [], updatedAt: "t" } } })],
      mappings: [mapping({ enabled: true })],
    }));

    expect(() => registry.resolve({
      moduleId: "generation.single-shot",
      providerId: "provider-a",
      modelId: "image-model",
      mode: "text_to_image",
    })).toThrow(/Unknown module/);
  });
});
