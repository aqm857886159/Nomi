import { readFileSync } from "node:fs";
import inspector from "node:inspector";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import type { CatalogState } from "../catalog/types";
import { createCatalogModuleRegistry } from "./moduleCatalogBootstrap";
import { createLiveGenerationRuntime } from "./liveGenerationRuntime";

type ResolveRequest = { moduleId: string; providerId: string; modelId: string; mode: string };
type CpuProfile = {
  nodes?: readonly { id: number; callFrame: { functionName?: string; url?: string } }[];
  samples?: readonly number[];
  timeDeltas?: readonly number[];
};

const emptyCatalog = { version: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
const state = applyBuiltinSeeds(emptyCatalog, "2026-08-26T00:00:00.000Z").state;
const readiness = Object.fromEntries(state.vendors.map((vendor) => [vendor.key, {
  providerReady: true,
  capabilities: { submitIdempotency: false, query: false, reconcile: false, cancel: false },
}]));

function createProbeRuntime() {
  return createLiveGenerationRuntime({
    catalogReader: () => state,
    bootstrap: () => ({ providers: [], readinessByProvider: readiness }),
    registry: (current, currentReadiness) => createCatalogModuleRegistry(current, { readinessByProvider: currentReadiness }),
  });
}

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

function inspectorPost(session: inspector.Session, method: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    session.post(method, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function topCpuFunctions(profile: CpuProfile, count = 5) {
  const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, number>();
  for (let index = 0; index < (profile.samples ?? []).length; index += 1) {
    const frame = nodes.get(profile.samples?.[index] ?? -1);
    if (!frame) continue;
    const key = `${frame.functionName || "(anonymous)"} @ ${frame.url || "[native]"}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([functionName, microseconds]) => ({ functionName, microseconds }));
}

function resolveBatch(candidates: readonly ResolveRequest[], freshRegistry: boolean) {
  const scopedRegistry = freshRegistry ? undefined : createProbeRuntime().createDraftScope().registry;
  const started = performance.now();
  const resolved = candidates.map((candidate) => {
    const registry = freshRegistry ? createProbeRuntime().createDraftScope().registry : scopedRegistry;
    if (!registry) throw new Error("scoped registry missing");
    return registry.resolve(candidate);
  });
  return { resolved, elapsedMs: Number((performance.now() - started).toFixed(3)) };
}

async function profiledResolve(candidates: readonly ResolveRequest[], freshRegistry: boolean) {
  const session = new inspector.Session();
  session.connect();
  await inspectorPost(session, "Profiler.enable");
  await inspectorPost(session, "Profiler.start");
  const perShotMs: number[] = [];
  const scopedRegistry = freshRegistry ? undefined : createProbeRuntime().createDraftScope().registry;
  const resolved = candidates.map((candidate) => {
    const started = performance.now();
    const registry = freshRegistry ? createProbeRuntime().createDraftScope().registry : scopedRegistry;
    if (!registry) throw new Error("scoped registry missing");
    const result = registry.resolve(candidate);
    perShotMs.push(Number((performance.now() - started).toFixed(3)));
    return result;
  });
  const stopped = await inspectorPost(session, "Profiler.stop") as { profile?: CpuProfile };
  await inspectorPost(session, "Profiler.disable");
  session.disconnect();
  return { resolved, perShotMs, cpuTop5: topCpuFunctions(stopped.profile ?? {}) };
}

describe("card 12 real built-in catalog performance probe", () => {
  it("compares fresh-registry and explicit-scope 33-shot paths byte-for-byte", async () => {
    const candidates = realCatalogCandidates();
    console.info(JSON.stringify({
      probe: "catalog-registry-real-catalog",
      catalog: { version: state.version, vendors: state.vendors.length, models: state.models.length, mappings: state.mappings.length },
    }));

    for (const count of [8, 16, 33]) {
      const oldPath = resolveBatch(candidates.slice(0, count), true);
      const newPath = resolveBatch(candidates.slice(0, count), false);
      expect(Buffer.from(JSON.stringify(oldPath.resolved))).toEqual(Buffer.from(JSON.stringify(newPath.resolved)));
      console.info(JSON.stringify({
        probe: "catalog-registry-real",
        shots: count,
        beforeMs: oldPath.elapsedMs,
        afterMs: newPath.elapsedMs,
        bytes: Buffer.byteLength(JSON.stringify(newPath.resolved)),
      }));
    }

    const before = await profiledResolve(candidates, true);
    const after = await profiledResolve(candidates, false);
    expect(Buffer.from(JSON.stringify(before.resolved))).toEqual(Buffer.from(JSON.stringify(after.resolved)));
    console.info(JSON.stringify({
      probe: "catalog-registry-real-shot-profile",
      shots: candidates.length,
      beforeMsByShot: before.perShotMs,
      afterMsByShot: after.perShotMs,
      beforeCpuTop5: before.cpuTop5,
      afterCpuTop5: after.cpuTop5,
      bytes: Buffer.byteLength(JSON.stringify(after.resolved)),
    }));

    // The original synthetic fixture remains the byte-level compatibility anchor.
    expect(readFileSync(new URL("./fixtures/live-generation-runtime.baseline-33.json", import.meta.url), "utf8")).toContain("generation.single-shot");
  });
});
