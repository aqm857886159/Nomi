import { describe, expect, it, vi } from "vitest";

import { createCatalogGenerationProvider as createProvider } from "./apimartGenerationProvider";
import type { CatalogState } from "../catalog/types";
import { APIMART_IMAGE_MODELS } from "../catalog/apimartImages";
import { APIMART_VIDEO_MODELS } from "../catalog/apimartVideos";
import { APIMART_IMAGE_QUERY_OP, APIMART_STATUS_MAPPING, APIMART_VENDOR_SEED } from "../catalog/apimartVendor";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";

/** 授权时封存的那份 URL 快照，键就是付费卡上那一条参考的身份。 */
function approvedUrls(entries: ReadonlyArray<readonly [Record<string, unknown>, string]>): Record<string, string> {
  return Object.fromEntries(entries.map(([reference, url]) =>
    [spendReferenceKey(reference as Parameters<typeof spendReferenceKey>[0]), url]));
}

function catalogFixture(overrides: Partial<CatalogState> = {}): CatalogState {
  const now = "now";
  const models = [
    ...APIMART_IMAGE_MODELS.map((model) => ({
      modelKey: model.modelKey,
      vendorKey: "apimart" as const,
      labelZh: model.labelZh,
      kind: "image" as const,
      enabled: true,
      meta: { archetypeId: model.archetypeId },
      createdAt: now,
      updatedAt: now,
    })),
    ...APIMART_VIDEO_MODELS.map((model) => ({
      modelKey: model.modelKey,
      vendorKey: "apimart" as const,
      labelZh: model.labelZh,
      kind: "video" as const,
      enabled: true,
      meta: { archetypeId: model.archetypeId },
      createdAt: now,
      updatedAt: now,
    })),
  ];
  const mappings = [
    ...APIMART_IMAGE_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
      ...mapping,
      vendorKey: "apimart" as const,
      modelKey: model.modelKey,
      enabled: true,
      query: APIMART_IMAGE_QUERY_OP,
      statusMapping: APIMART_STATUS_MAPPING,
      createdAt: now,
      updatedAt: now,
    }))),
    ...APIMART_VIDEO_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
      ...mapping,
      vendorKey: "apimart" as const,
      modelKey: model.modelKey,
      enabled: true,
      query: APIMART_IMAGE_QUERY_OP,
      statusMapping: APIMART_STATUS_MAPPING,
      createdAt: now,
      updatedAt: now,
    }))),
  ];
  return {
    version: 11,
    vendors: [{
      key: "apimart",
      name: APIMART_VENDOR_SEED.name,
      enabled: true,
      baseUrlHint: APIMART_VENDOR_SEED.baseUrl,
      authType: APIMART_VENDOR_SEED.authType,
      authHeader: APIMART_VENDOR_SEED.authHeader,
      createdAt: "now",
      updatedAt: "now",
    }],
    models,
    mappings,
    apiKeysByVendor: {},
    ...overrides,
  };
}

function createApimartGenerationProvider(options: Omit<Parameters<typeof createProvider>[0], "vendorKey"> & { vendorKey?: string; catalogReader?: () => CatalogState }) {
  return createProvider({ vendorKey: "apimart", catalogReader: () => catalogFixture(), ...options });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "gpt-image-2",
    mode: "text-to-image",
    prompt: "a red paper crane",
    parameters: { aspectRatio: "1:1", resolution: "1K" },
    references: [],
    contractHash: "a".repeat(64),
    idempotencyKey: "stable-nomi-key",
    requestFingerprint: "b".repeat(64),
    executionBinding: {
      immutableProjectUuid: "project-1",
      projectGeneration: 1,
      runId: "run-1",
      shotId: "shot-1",
      contractHash: "a".repeat(64),
      runtimeTaskId: "runtime-1",
      providerNamespace: "apimart",
      providerIdempotencyKey: "stable-nomi-key",
      requestFingerprint: "b".repeat(64),
      runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json",
      fencingEpoch: 1,
    },
    ...overrides,
    ...overrides,
  };
}

import { pinAssetReference } from "./semanticGenerationCandidate";

describe("V-3b: where does a 3D-BOX preview mp4 land in the sealed provider body", () => {
  const provider = () => createApimartGenerationProvider({ resolveConnection: () => ({ apiKey: "test-key" }), fetchImpl: vi.fn() });
  const URL = "https://cdn.example/preview.mp4";
  const body = (reference: Record<string, unknown>, modeId = "omni") => provider().buildRequest(input({
    modelId: "doubao-seedance-2.0", mode: "image_to_video", modeId, references: [reference],
    referenceUrls: approvedUrls([[reference, URL]]), parameters: { duration: 5 },
  })) as Record<string, unknown>;

  const identity = { contentHash: "a".repeat(64), version: 1 };

  it("draft_shots: model gives only assetId, host pins hash+version AND the asset's own kind -> mp4 lands in video_urls", () => {
    const pinned = pinAssetReference({ assetId: "asset-pre" }, () => ({ ...identity, kind: "video" as const })) as Record<string, unknown>;
    expect(pinned.kind).toBe("video");
    const b = body(pinned);
    expect(JSON.stringify(b.video_urls ?? null)).toContain("preview.mp4");
    expect(JSON.stringify(b.image_urls ?? null)).not.toContain("preview.mp4");
  });

  it("an image asset still goes through image_urls", () => {
    const pinned = pinAssetReference({ assetId: "asset-img" }, () => ({ ...identity, kind: "image" as const })) as Record<string, unknown>;
    expect(pinned.kind).toBe("image");
    const b = provider().buildRequest(input({
      modelId: "doubao-seedance-2.0", mode: "image_to_video", modeId: "omni", references: [pinned],
      referenceUrls: approvedUrls([[pinned, "https://cdn.example/pic.png"]]), parameters: { duration: 5 },
    })) as Record<string, unknown>;
    expect(JSON.stringify(b.image_urls ?? null)).toContain("pic.png");
    expect(b.video_urls).toBeUndefined();
  });

  it("the asset decides: a caller kind that disagrees is overridden, on the fresh and on the already-pinned path", () => {
    const resolve = () => ({ ...identity, kind: "video" as const });
    expect((pinAssetReference({ assetId: "a", kind: "image" }, resolve) as Record<string, unknown>).kind).toBe("video");
    expect((pinAssetReference({ assetId: "a", ...identity, kind: "image" }, resolve) as Record<string, unknown>).kind).toBe("video");
    expect((pinAssetReference({ assetId: "a", ...identity }, resolve) as Record<string, unknown>).kind).toBe("video");
  });

  it("control: same reference with kind=video lands in the video channel", () => {
    const b = body({ assetId: "asset-pre", contentHash: "a".repeat(64), version: 1, kind: "video" });
    console.log("BODY_WITH_KIND_VIDEO", JSON.stringify(b))
    expect(JSON.stringify(b.video_urls ?? null)).toContain("preview.mp4");
  });
});
