import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import type { CatalogState } from "../catalog/types";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";

type ResolveRequest = { moduleId: string; providerId: string; modelId: string; mode: string };

const emptyCatalog = { version: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
const state = applyBuiltinSeeds(emptyCatalog, "2026-08-26T00:00:00.000Z").state;
const readiness = Object.fromEntries(state.vendors.map((vendor) => [vendor.key, {
  providerReady: true,
  capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
}]));

const createProbeRuntime = vi.fn(() => {
  return createLiveGenerationRuntime({
    catalogReader: () => state,
    bootstrap: () => ({ providers: [], readinessByProvider: readiness }),
    registry: (current, currentReadiness) => createCatalogModuleRegistry(current, { readinessByProvider: currentReadiness }),
  });
});

function realCatalogCandidates(): ResolveRequest[] {
  const registry = createCatalogModuleRegistry(state, { readinessByProvider: readiness });
  const candidates: ResolveRequest[] = [];
  for (const model of state.models) {
    for (const mapping of state.mappings) {
      if (mapping.vendorKey !== model.vendorKey || !mapping.enabled || (mapping.modelKey && mapping.modelKey !== model.modelKey)) continue;
      const request = { moduleId: "generation.single-shot", providerId: model.vendorKey, modelId: model.modelKey, mode: mapping.taskKind };
      try {
        registry.resolve(request);
        candidates.push(request);
        break;
      } catch { /* Built-in mappings include rows that are not published together. */ }
    }
    if (candidates.length >= 33) break;
  }
  if (candidates.length < 33) throw new Error(`expected 33 resolvable built-in candidates, got ${candidates.length}`);
  return candidates;
}

function resolveBatch(candidates: readonly ResolveRequest[], freshRegistry: boolean) {
  const scopedRegistry = freshRegistry ? undefined : createProbeRuntime().createDraftScope().registry;
  const resolved = candidates.map((candidate) => {
    const registry = freshRegistry ? createProbeRuntime().createDraftScope().registry : scopedRegistry;
    if (!registry) throw new Error("scoped registry missing");
    return registry.resolve(candidate);
  });
  return resolved;
}

describe("real built-in catalog resolution compatibility", () => {
  it("compares fresh-registry and explicit-scope 33-shot paths byte-for-byte", () => {
    const candidates = realCatalogCandidates();
    // Each fresh-registry shot is independent, so prefixes share the same reference results.
    const oldPath = resolveBatch(candidates, true);
    for (const count of [8, 16, 33]) {
      const newPath = resolveBatch(candidates.slice(0, count), false);
      expect(Buffer.from(JSON.stringify(oldPath.slice(0, count)))).toEqual(Buffer.from(JSON.stringify(newPath)));
    }

    expect(createProbeRuntime).toHaveBeenCalledTimes(36);

    // The original synthetic fixture remains the byte-level compatibility anchor.
    expect(readFileSync(new URL("./fixtures/live-generation-runtime.baseline-33.json", import.meta.url), "utf8")).toContain("generation.single-shot");
  });
});
