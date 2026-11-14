import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { buildVideoModelCandidates, modeTransportFor } from "../shared/videoCapabilities";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { applyParamMap } from "./paramTranslate";
import { modeSlotReach } from "./referenceReachability";
import { applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";
import { modelReferenceSelection } from "./modelCatalogListing";
import type { ArchetypeMode } from "../shared/modelArchetypes/types";

const REF = "https://assets.example.com/shared-contract";
/** 这个方式每个必填槽按下限给几件（标准输入键）。 */
function requiredInputs(mode: ArchetypeMode): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const count = (kind: string) => mode.slots.filter((slot) => slot.kind === kind).reduce((sum, slot) => sum + slot.min, 0);
  const list = (kind: string, ext: string) => Array.from({ length: count(kind) }, (_unused, index) => `${REF}/${kind}-${index}.${ext}`);
  if (count("first_frame")) inputs.firstFrameUrl = `${REF}/first.png`;
  if (count("last_frame")) inputs.lastFrameUrl = `${REF}/last.png`;
  if (count("image_ref")) inputs.referenceImages = list("image_ref", "png");
  if (count("video_ref")) inputs.referenceVideoUrls = list("video_ref", "mp4");
  if (count("audio_ref")) inputs.referenceAudioUrls = list("audio_ref", "mp3");
  return inputs;
}

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
        // 每个方式带上它必需的输入（标准输入键，headless 的说法）：缺必需输入的方式在发送前就拒，那不是这里要量的。
        const extras = applyHeadlessParamDefaults(
          { modelKey: model.modelKey, ...requiredInputs(mode) },
          modelReferenceSelection("apimart", { modelKey: model.modelKey, meta: { archetypeId: candidate.archetype.id } }, taskKind, mode.id),
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
