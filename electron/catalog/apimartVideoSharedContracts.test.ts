import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { buildVideoModelCandidates, modeTransportFor } from "../shared/videoCapabilities";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { applyParamMap } from "./paramTranslate";
import { modeSlotReach } from "./referenceReachability";
import { applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";

const candidates = buildVideoModelCandidates(APIMART_VIDEO_MODELS.map((model) => ({
  provider: "apimart",
  modelKey: model.modelKey,
  label: model.labelZh,
  archetypeId: model.archetypeId,
})));

describe("APIMart curated video profiles stay aligned across shared planning and transport", () => {
  it("exposes only modes that have an existing transport mapping and can carry every declared reference slot", () => {
    const violations: string[] = [];

    for (const [index, model] of APIMART_VIDEO_MODELS.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        const taskKind = modeTransportFor(mode, candidate.archetype, "apimart");
        const mapping = model.mappings.find((item) => item.taskKind === taskKind);
        if (!mapping) {
          violations.push(`${model.modelKey}/${mode.id}: missing ${taskKind} mapping`);
          continue;
        }
        const reach = modeSlotReach(mode.slots, mapping.create.body, mode.combineSlotsInto?.key);
        const missing = mode.slots.filter((_slot, slotIndex) => reach[slotIndex] === "none");
        if (missing.length > 0) {
          violations.push(`${model.modelKey}/${mode.id}: unreachable ${missing.map((slot) => slot.kind).join(",")}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("renders an authenticated real request with a concrete model identity for every curated mode", () => {
    const violations: string[] = [];

    for (const [index, model] of APIMART_VIDEO_MODELS.entries()) {
      const candidate = candidates[index]!;
      for (const mode of candidate.archetype.modes) {
        const taskKind = modeTransportFor(mode, candidate.archetype, "apimart");
        const mapping = model.mappings.find((item) => item.taskKind === taskKind);
        if (!mapping) continue;
        const extras = applyHeadlessParamDefaults(
          { modelKey: model.modelKey },
          candidate.archetype.id,
          taskKind,
          "apimart",
          mapping.create.defaultParams,
          mapping.create.body,
        );
        const request = { kind: taskKind, prompt: "a quiet sunrise", extras };
        const context = buildTemplateContext({
          request,
          params: applyParamMap(mapping.create.paramMap, taskTemplateParams(request)),
          model: { modelKey: model.modelKey },
          modelKey: model.modelKey,
          apiKey: "TEST_SECRET",
        });
        const built = buildHttpRequest({
          baseUrl: "https://api.apimart.ai",
          authType: "bearer",
          apiKey: "TEST_SECRET",
          context,
          operation: mapping.create,
        });
        const body = built.body as Record<string, unknown>;
        if (typeof body.model !== "string" || !body.model.trim()) {
          violations.push(`${model.modelKey}/${mode.id}: empty model identity`);
        }
        if (built.headers.Authorization !== "Bearer TEST_SECRET") {
          violations.push(`${model.modelKey}/${mode.id}: missing bearer auth`);
        }
        if (JSON.stringify(body).includes("TEST_SECRET")) {
          violations.push(`${model.modelKey}/${mode.id}: secret leaked into body`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
