import { describe, expect, it } from "vitest";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta } from "../shared/videoCapabilities";
import { modeSlotReach } from "./referenceReachability";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState } from "./types";

function seededState(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-08-24T00:00:00.000Z").state;
}

describe("all curated video providers share their existing GUI capability contracts with planning", () => {
  it("backs every exposed mode with a real mapping and at least one reachable reference channel", () => {
    const state = seededState();
    const models = state.models.filter((model) => model.kind === "video" && videoArchetypeIdFromMeta(model.meta));
    const candidates = buildVideoModelCandidates(models.map((model) => ({
      provider: model.vendorKey,
      modelKey: model.modelKey,
      label: model.labelZh,
      archetypeId: videoArchetypeIdFromMeta(model.meta),
    })));
    const violations: string[] = [];

    for (const [index, model] of models.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        const taskKind = mode.transportTaskKind ?? candidate.archetype.transportTaskKind;
        const mapping = selectTaskMapping(state.mappings, model.vendorKey, taskKind, model.modelKey, mode.id);
        if (!mapping) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: missing ${taskKind} mapping`);
          continue;
        }
        if (mode.slots.length === 0) continue;
        const reach = modeSlotReach(mode.slots, mapping.create.body, mode.combineSlotsInto?.key);
        if (reach.every((item) => item === "none")) {
          violations.push(`${model.vendorKey}/${model.modelKey}/${mode.id}: no reference slot reaches the selected mapping`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
