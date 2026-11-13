import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { CatalogState } from "../catalog/types";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";

const BASELINE_SNAPSHOT = readFileSync(
  new URL("./fixtures/live-generation-runtime.baseline-33.json", import.meta.url),
  "utf8",
);
const baselineResolutions = JSON.parse(BASELINE_SNAPSHOT) as readonly unknown[];

const vendor = { key: "provider-a", name: "Provider A", enabled: true, createdAt: "t", updatedAt: "t" };
const models = Array.from({ length: 64 }, (_, index) => ({
  modelKey: `video-${index + 1}`,
  vendorKey: vendor.key,
  labelZh: `Video ${index + 1}`,
  kind: "video",
  enabled: true,
  createdAt: "t",
  updatedAt: "t",
}));
const mappings = models.map((model, index) => ({
  id: `mapping-${index + 1}`,
  vendorKey: vendor.key,
  modelKey: model.modelKey,
  taskKind: "text_to_video",
  name: model.modelKey,
  enabled: true,
  create: { method: "POST", path: "/generate", body: {}, defaultParams: {} },
  createdAt: "t",
  updatedAt: "t",
}));
const state = { version: 1, vendors: [vendor], models, mappings, apiKeysByVendor: {} } as unknown as CatalogState;
const readiness = {
  "provider-a": {
    providerReady: true,
    capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
  },
};

function resolveShots(count: number) {
  const buildRegistry = vi.fn(() => createCatalogModuleRegistry(state, { readinessByProvider: readiness }));
  const runtime = createLiveGenerationRuntime({
    catalogReader: () => state,
    bootstrap: () => ({ providers: [], readinessByProvider: readiness }),
    registry: buildRegistry,
  });
  const registry = runtime.createDraftScope().registry;
  const resolved = Array.from({ length: count }, (_, index) => registry.resolve({
    moduleId: "generation.single-shot",
    providerId: "provider-a",
    modelId: `video-${index + 1}`,
    mode: "text_to_video",
  }));
  return { resolved, registryBuilds: buildRegistry.mock.calls.length };
}

describe("generation catalog draft scope work", () => {
  it.each([8, 16, 33])("resolves %s shots from one draft snapshot with byte-identical output", (count) => {
    const { resolved, registryBuilds } = resolveShots(count);
    const expected = JSON.stringify(baselineResolutions.slice(0, count));
    const actual = JSON.stringify(resolved);
    expect(Buffer.from(actual)).toEqual(Buffer.from(expected));
    expect(registryBuilds).toBe(1);
  });
});
