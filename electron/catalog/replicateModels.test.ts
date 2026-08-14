import { describe, expect, it } from "vitest";
import { getArchetypeById, resolveArchetypeForModel } from "../../src/config/modelArchetypes";
import type { ModelArchetype } from "../../src/config/modelArchetypes/types";
import { applyArchetypeModeSwitch } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { bodyReferencedParamKeys } from "./paramTranslate";
import { modeSlotReach } from "./referenceReachability";
import { applyBuiltinSeeds } from "./seedBuiltins";
import {
  REPLICATE_CURATED_MAPPINGS,
  REPLICATE_CURATED_MODELS,
  REPLICATE_STATUS_MAPPING,
} from "./replicateModels";
import type { CatalogState } from "./types";

type ReplicateModelContract = ModelArchetype & { modelKey: string };
const REPLICATE_MODEL_CONTRACTS: ReplicateModelContract[] = REPLICATE_CURATED_MODELS.map((model) => {
  const archetype = getArchetypeById(model.archetypeId);
  if (!archetype) throw new Error(`missing archetype: ${model.archetypeId}`);
  return { ...archetype, modelKey: model.modelKey };
});
const models = new Map(REPLICATE_MODEL_CONTRACTS.map((model) => [model.modelKey, model]));

describe("Replicate 官方模型契约", () => {
  it("覆盖不同输入形状：文生图、单图、多图、首帧、首尾帧和角色参考", () => {
    expect([...models.keys()]).toEqual(expect.arrayContaining([
      "black-forest-labs/flux-schnell",
      "black-forest-labs/flux-kontext-pro",
      "qwen/qwen-image-edit",
      "google/nano-banana",
      "minimax/video-01",
      "bytedance/seedance-1-pro",
    ]));

    expect(models.get("google/nano-banana")?.modes.find((mode) => mode.id === "edit")?.slots[0]).toMatchObject({
      kind: "image_ref",
      inputKey: "image_input",
      min: 1,
      max: 3,
    });
    expect(models.get("minimax/video-01")?.modes.find((mode) => mode.id === "s2v")?.slots[0]).toMatchObject({
      kind: "image_ref",
      inputKey: "subject_reference",
      asArray: false,
    });
    expect(models.get("bytedance/seedance-1-pro")?.modes.find((mode) => mode.id === "firstlast")?.slots).toEqual([
      expect.objectContaining({ kind: "first_frame", inputKey: "image" }),
      expect.objectContaining({ kind: "last_frame", inputKey: "last_frame_image" }),
    ]);
  });

  it("每个模型都有官方来源和模式级参数，而不是一套全局参数", () => {
    for (const model of REPLICATE_MODEL_CONTRACTS) {
      expect(model.sources?.[0]?.url, model.modelKey).toMatch(/^https:\/\/replicate\.com\//);
      expect(model.modes.length, model.modelKey).toBeGreaterThan(0);
      expect(model.modes.every((mode) => mode.params.length > 0), model.modelKey).toBe(true);
    }
    expect(models.get("black-forest-labs/flux-schnell")?.modes[0].params.map((param) => param.key)).toContain("num_outputs");
    expect(models.get("google/nano-banana")?.modes[0].params.map((param) => param.key)).toContain("output_format");
    expect(models.get("bytedance/seedance-1-pro")?.modes[0].params.map((param) => param.key)).toContain("resolution");
  });

  it("同一模型的模式约束也按官方契约分开", () => {
    const kontext = models.get("black-forest-labs/flux-kontext-pro");
    const t2iSafety = kontext?.modes.find((mode) => mode.id === "t2i")?.params.find((param) => param.key === "safety_tolerance");
    const editSafety = kontext?.modes.find((mode) => mode.id === "edit")?.params.find((param) => param.key === "safety_tolerance");
    expect(t2iSafety?.max).toBe(6);
    expect(editSafety?.max).toBe(2);

    const seedance = models.get("bytedance/seedance-1-pro");
    expect(seedance?.modes.find((mode) => mode.id === "t2v")?.params.map((param) => param.key)).toContain("aspect_ratio");
    expect(seedance?.modes.find((mode) => mode.id === "i2v")?.params.map((param) => param.key)).not.toContain("aspect_ratio");
    expect(seedance?.modes.find((mode) => mode.id === "firstlast")?.params.map((param) => param.key)).not.toContain("aspect_ratio");
    expect(seedance?.modes.every((mode) => !mode.params.some((param) => param.key === "fps"))).toBe(true);
  });

  it("切到约束更窄的模式时修正旧参数，不把非法值带进下一次请求", () => {
    const kontext = models.get("black-forest-labs/flux-kontext-pro")!;
    const next = applyArchetypeModeSwitch(
      { archetype: { id: kontext.id, modeId: "t2i" }, safety_tolerance: 6 },
      kontext,
      "edit",
    );
    expect(next.safety_tolerance).toBe(2);
  });
});

describe("Replicate curated catalog", () => {
  it("为每个官方模型写入明确的 archetype 和 mapping", () => {
    expect(REPLICATE_CURATED_MODELS).toHaveLength(REPLICATE_MODEL_CONTRACTS.length);
    for (const model of REPLICATE_CURATED_MODELS) {
      expect(model.archetypeId, model.modelKey).toBeTruthy();
      expect(getArchetypeById(model.archetypeId)?.label, model.modelKey).toBe(model.labelZh);
      expect(REPLICATE_CURATED_MAPPINGS.some((mapping) => mapping.modelKey === model.modelKey), model.modelKey).toBe(true);
      expect(resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: "replicate", meta: { archetypeId: model.archetypeId } })?.id).toBe(model.archetypeId);
    }
  });

  it("每个 mapping 都走 Replicate predictions + polling，并把 output 归一成 assets", () => {
    for (const mapping of REPLICATE_CURATED_MAPPINGS) {
      expect(mapping.create.method).toBe("POST");
      expect(mapping.create.path).toMatch(/^\/models\/.+\/predictions$/);
      expect(mapping.create.headers?.Prefer).toBe("wait=60");
      expect(mapping.create.response_mapping).toMatchObject({ task_id: "id", status: "status", assets: "output" });
      expect(mapping.create.provider_meta_mapping).toEqual({ task_id: "id" });
      expect(mapping.query?.method).toBe("GET");
      expect(mapping.query?.path).toBe("/predictions/{{providerMeta.task_id}}");
      expect(mapping.query?.response_mapping).toMatchObject({ task_id: "id", status: "status", assets: "output" });
      expect(mapping.statusMapping).toEqual(REPLICATE_STATUS_MAPPING);
    }
  });

  it("每个模式声明的槽位和参数都能到达它实际使用的请求 body", () => {
    const violations: string[] = [];
    for (const model of REPLICATE_MODEL_CONTRACTS) {
      const allModelParams = new Set(model.modes.flatMap((mode) => mode.params.map((param) => param.key)));
      for (const mode of model.modes) {
        const taskKind = mode.transportTaskKind ?? model.transportTaskKind;
        const mapping = REPLICATE_CURATED_MAPPINGS.find(
          (candidate) => candidate.modelKey === model.modelKey && candidate.taskKind === taskKind,
        );
        if (!mapping) {
          violations.push(`${model.modelKey}/${mode.id}: missing mapping`);
          continue;
        }
        const reach = modeSlotReach(mode.slots, mapping.create.body, mode.combineSlotsInto?.key);
        reach.forEach((value, index) => {
          if (value !== "full") violations.push(`${model.modelKey}/${mode.id}: slot ${mode.slots[index]?.inputKey} is ${value}`);
        });
        const consumed = new Set(bodyReferencedParamKeys(mapping.create.body));
        const activeParams = new Set(mode.params.map((param) => param.key));
        for (const param of mode.params) {
          if (!consumed.has(param.key)) violations.push(`${model.modelKey}/${mode.id}: param ${param.key} is not consumed`);
        }
        for (const key of consumed) {
          if (allModelParams.has(key) && !activeParams.has(key)) {
            violations.push(`${model.modelKey}/${mode.id}: inactive param ${key} is still consumed`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("seed 后确实存在 6 个模型和 10 条模型专属 mapping，且重复 seed 幂等", () => {
    const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const first = applyBuiltinSeeds(empty, "2026-08-14T00:00:00.000Z");
    expect(first.state.models.filter((model) => model.vendorKey === "replicate" && REPLICATE_CURATED_MODELS.some((item) => item.modelKey === model.modelKey))).toHaveLength(6);
    expect(first.state.mappings.filter((mapping) => mapping.vendorKey === "replicate" && mapping.id.startsWith("seed-replicate-"))).toHaveLength(10);
    expect(applyBuiltinSeeds(first.state, "2026-08-14T00:00:01.000Z").changed).toBe(false);
  });
});
