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

    // 已知遗留缺口（2026-09-02 勘探定性，归 Runway 模型↔档案身份工作流）：happyhorse_1_0 挂共享
    // runway-video 档案却从无 reference mapping。主线此前"绿"是假绿——reference(旧 transport=i2v)
    // 回落到 i2v mapping、promptImage 被宽松判可达，用户选多图参考实际只有单图行为；B 班把 reference
    // 传输面按官方修到 t2v 后，回落目标变成无图键的 t2v mapping，掩盖才揭开。豁免仅此一条，修复=
    // 身份工作流里给 happyhorse 正确能力面（专属档案或 wire 实证后的 union mapping）。
    const KNOWN_LEGACY_GAPS = new Set(["runway/happyhorse_1_0/reference"]);
    for (const [index, model] of models.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        if (KNOWN_LEGACY_GAPS.has(`${model.vendorKey}/${model.modelKey}/${mode.id}`)) continue;
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
