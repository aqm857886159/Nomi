import { describe, expect, it } from "vitest";

import {
  ASSET_READ_ALIASES,
  ASSET_READ_CAPABILITY,
  assetReadInputForAlias,
  assetReadPiInputSchemaForAlias,
  assetReadResultSchema,
} from "./assetRead";

describe("asset.read capability", () => {
  it("owns all five strict Pi aliases", () => {
    expect(ASSET_READ_CAPABILITY.effect).toBe("read");
    expect(ASSET_READ_CAPABILITY.effectClass).toBe("reversible_local");
    expect([ASSET_READ_CAPABILITY.aliases.pi, ...ASSET_READ_CAPABILITY.additionalAliases.pi]).toEqual([
      "get_media",
      "inspect_media",
      "search_media",
      "inspect_source_range",
      "read_waveform",
    ]);
    expect(assetReadPiInputSchemaForAlias(ASSET_READ_ALIASES.search)?.safeParse({ extra: true }).success).toBe(false);
    expect(assetReadInputForAlias("get_media", { assetId: "asset-1" })).toEqual({
      operation: "get_media",
      assetId: "asset-1",
    });
  });

  it("bounds search, source usages, and waveform buckets", () => {
    expect(assetReadPiInputSchemaForAlias("search_media")?.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      assetReadPiInputSchemaForAlias("inspect_source_range")?.safeParse({
        assetId: "asset-1",
        startFrame: 20,
        endFrame: 10,
      }).success,
    ).toBe(false);
    expect(
      assetReadPiInputSchemaForAlias("read_waveform")?.safeParse({ assetId: "asset-1", buckets: 257 }).success,
    ).toBe(false);
  });

  it("structurally rejects path, URL, bytes, and semantic claims", () => {
    const base = {
      operation: "inspect_media",
      media: {
        id: "asset-1",
        name: "clip.mp4",
        kind: "video",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
      technical: { durationSeconds: 1 },
      semanticInspection: "not_performed",
    } as const;
    expect(assetReadResultSchema.safeParse(base).success).toBe(true);
    for (const forbidden of [
      { media: { ...base.media, url: "nomi-local://secret" } },
      { media: { ...base.media, relativePath: "assets/secret.mp4" } },
      { media: { ...base.media, absolutePath: "/private/secret.mp4" } },
      { media: { ...base.media, providerUrl: "https://provider.example/secret" } },
      { media: { ...base.media, bytes: "base64" } },
      { semanticInspection: "a person is visible" },
    ]) {
      expect(assetReadResultSchema.safeParse({ ...base, ...forbidden }).success).toBe(false);
    }
  });
});
