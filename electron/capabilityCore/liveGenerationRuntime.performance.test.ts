import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

function createProbeRuntime() {
  return createLiveGenerationRuntime({
    catalogReader: () => state,
    bootstrap: () => ({ providers: [], readinessByProvider: readiness }),
    registry: (current, currentReadiness) => createCatalogModuleRegistry(current, { readinessByProvider: currentReadiness }),
  });
}

function resolveShots(count: number) {
  const runtime = createProbeRuntime();
  const started = performance.now();
  const registry = runtime.createDraftScope().registry;
  const resolved = Array.from({ length: count }, (_, index) => registry.resolve({
    moduleId: "generation.single-shot",
    providerId: "provider-a",
    modelId: `video-${index + 1}`,
    mode: "text_to_video",
  }));
  return { resolved, elapsedMs: performance.now() - started };
}

describe("card 12 generation catalog performance probe", () => {
  it.each([8, 16, 33])("resolves %s shots from one draft snapshot with byte-identical output", (count) => {
    const { resolved, elapsedMs } = resolveShots(count);
    const expected = JSON.stringify(baselineResolutions.slice(0, count));
    const actual = JSON.stringify(resolved);
    expect(Buffer.from(actual)).toEqual(Buffer.from(expected));
    expect(elapsedMs).toBeLessThan(10_000);
    // Keep the measured wall time in the test output for the task-board receipt.
    console.info(JSON.stringify({ probe: "catalog-registry", shots: count, elapsedMs: Number(elapsedMs.toFixed(3)), bytes: Buffer.byteLength(actual) }));
  });
});
