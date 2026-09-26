import { describe, expect, it } from "vitest";
import type { PlanShot, StoryboardPlan } from "../../generationCanvas/agent/storyboardPlan";
import { shotDurationWarnings, storyboardPlanToPlanShotInputs } from "../../generationCanvas/agent/storyboardStrategy";
import { createModuleRegistry } from "../../../../electron/capabilityCore/moduleRegistry";
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from "../../../../electron/capabilityCore/mcpGenerationTools";
import { resolveGenerationPlanForProject, toResolveEnvelopeError } from "../../../../electron/capabilityCore/generationResolveIpc";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../../../../electron/shared/videoCapabilities";
import type { ModelArchetype } from "../../../../electron/shared/modelArchetypes/types";
import type { GenerationResolvePlanEnvelope } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";
import { fetchStoryboardResolve, resolveGeneratableGate, type StoryboardResolveClient } from "./strategyGate";

/**
 * 分镜编辑器 ↔ 主进程执行计划检查的**真实对接**（不是假 client）。
 *
 * 为什么要这一份：`strategyGate.test.ts` 用的是假 client，渲染层发什么它都说 ok——于是
 * 渲染层给镜头多带了 `modelVendor`、主进程的 `.strict()` 形状却不认识它这件事，单测一直绿，
 * 真机上**每一个记了供应商的视频镜**都显示「执行计划检查失败」，并且时长闸因此整个放行
 * （0.22.0 回归，632677d15）。这里把渲染层的真实投影直接喂进主进程的真实解析核心。
 */

const DEFAULT_MODEL_KEY = "doubao-seedance-2.0";

/** 同名两家：先登记的中转站只收 10 秒，APIMart 收 15 秒——按名字取第一家就会拿错上限。 */
function withDurationMax(archetype: ModelArchetype, max: number): ModelArchetype {
  return {
    ...archetype,
    id: `${archetype.id}-relay-fixture`,
    modes: archetype.modes.map((mode) => ({
      ...mode,
      params: mode.params.map((param) => (param.key === "duration" ? { ...param, max } : param)),
    })),
  };
}

const relay = { provider: "custom-relay", modelKey: DEFAULT_MODEL_KEY, label: "Seedance 2.0 (relay)", archetype: withDurationMax(SEEDANCE_2_APIMART_ARCHETYPE, 10) };
const apimart = { provider: "apimart", modelKey: DEFAULT_MODEL_KEY, label: "Seedance 2.0", archetype: SEEDANCE_2_APIMART_ARCHETYPE };

const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image", "video"],
  outputKinds: ["video"],
  modes: ["text-to-video", "image-to-video"],
  parameterSchema: { duration: { type: "number" } },
  assetInputSchema: { references: { kind: "asset", max: 30 } },
  providers: [{
    providerId: "video-provider",
    models: [{
      modelId: "video-model",
      modes: ["text-to-video", "image-to-video"],
      parameterSchema: { duration: { type: "number" } },
      capabilities: { submitIdempotency: false, query: true, reconcile: true, cancel: false },
    }],
  }],
}]);

/** 与 `registerGenerationResolveIpc` 的 handler 同形：真实核心 + ok/err 信封。 */
function mainProcessClient(): StoryboardResolveClient {
  const planning = createGenerationPlanningHandler({
    registry,
    operations: createInMemoryGenerationOperationStore(),
    videoModelCandidates: [relay, apimart],
    now: () => "2026-09-26T00:00:00.000Z",
  });
  const deps = { getGenerationPlanning: () => planning, getCommittedProjectId: () => "project-1" };
  return {
    resolvePlan: async (request): Promise<GenerationResolvePlanEnvelope> => {
      try {
        return { ok: true, value: await resolveGenerationPlanForProject(deps, request) };
      } catch (error) {
        return { ok: false, error: toResolveEnvelopeError(error) };
      }
    },
  };
}

/** 图片+视频镜（开了首帧）、记了供应商——用户在分镜表里选 APIMart 的 Seedance 2.0 图生视频就是这个形状。 */
const vendorShot = (over: Partial<PlanShot> & Pick<PlanShot, "index" | "shotId" | "durationSec">): PlanShot => ({
  shotKind: "video",
  prompt: "雨夜巷口",
  anchorIds: [],
  modelKey: DEFAULT_MODEL_KEY,
  modelVendor: "apimart",
  modeId: "i2v",
  keyframe: { enabled: true },
  ...over,
});

const plan: StoryboardPlan = {
  title: "vendor plan",
  anchors: [],
  shots: [
    vendorShot({ index: 1, shotId: "s1", durationSec: 20 }),
    vendorShot({ index: 2, shotId: "s2", durationSec: 12 }),
  ],
};

describe("分镜执行计划检查 × 主进程真实解析（记了供应商的镜头）", () => {
  it("渲染层的真实投影确实带着供应商，主进程照单全收（不再 generation_input_invalid）", async () => {
    const shots = storyboardPlanToPlanShotInputs(plan);
    expect(shots.map((shot) => shot.modelVendor)).toEqual(["apimart", "apimart"]);
    const envelope = await fetchStoryboardResolve(plan, "project-1", mainProcessClient());
    expect(envelope).toMatchObject({ ok: true });
  });

  it("按记下的那一家裁决时长：APIMart 上限 15 秒，不是同名中转站的 10 秒", async () => {
    const envelope = await fetchStoryboardResolve(plan, "project-1", mainProcessClient());
    if (!envelope?.ok) throw new Error(`resolve failed: ${JSON.stringify(envelope)}`);
    expect(envelope.value.resolvedShots.map((shot) => [shot.id, shot.durationMax])).toEqual([["s1", 15], ["s2", 15]]);
    // 行内时长警示：20 秒那一镜超上限；12 秒那一镜在 APIMart 的范围里，不该被中转站的 10 秒误报。
    const warnings = shotDurationWarnings(envelope.value);
    expect(warnings.get("s1")?.kind).toBe("overflow");
    expect(warnings.has("s2")).toBe(false);
  });

  it("生成前的时长闸真的拦得住超上限的那一镜（此前检查报错 → 一律放行）", async () => {
    const blocker = await resolveGeneratableGate(plan, "project-1", mainProcessClient(), ["s1"]);
    expect(blocker).toMatchObject({ kind: "split", proposal: { shotId: "s1", durationMax: 15 } });
    expect(await resolveGeneratableGate(plan, "project-1", mainProcessClient(), ["s2"])).toBeNull();
  });
});
