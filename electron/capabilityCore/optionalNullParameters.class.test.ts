// 类级回归：大模型把「不设」的可选参数写成 null（`{"seed":null}`）——这在合同编译口必须等于没填。
//
// 2026-10-18 真付费走查：默认大脑 deepseek-v4-pro 起草 `draft_shots` 时写了 `seed: null`，草稿和付费卡都正常出来，
// 用户点「生成」才在 `compileParameters` 被 `typeof null === "object"` 拒掉，界面一个字不说。
// 这里钉的是**准入边界本身**（唯一的 `compileParameters`，经 `admitPlanCandidate` / `compileExecutionContract` 进来），
// 普查遍历全部模型档案，不挑样本：任何一个档案的任何一个可选参数写成 null 都不许被拒、也不许进合同。
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "./moduleRegistry";
import { ContractCompilationError, admitPlanCandidate, compileExecutionContract, type PlanCandidate } from "./executionContract";
import { GENERATION_PLANNING_HINT_KEYS } from "./generationPlanningParameters";
import { parameterFieldForControl } from "./modelAdmissionSchema";
import type { ModuleManifest, ParameterField } from "./moduleManifest";
import { rescopeArchetypeVariant, specializeArchetypeForVendor } from "../shared/modelArchetypes";
import { MODEL_ARCHETYPES } from "../shared/modelArchetypes/builtInCatalog";

const manifest: ModuleManifest = {
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text"],
  outputKinds: ["video"],
  modes: ["text-to-video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 4 } },
  providers: [{
    providerId: "apimart",
    models: [{
      modelId: "seedance-2",
      modes: ["text-to-video"],
      parameterSchema: {},
      capabilities: { submitIdempotency: true, query: true, reconcile: true, cancel: true },
    }],
  }],
};
const registry = createModuleRegistry([manifest]);

const candidate = (parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "c", revision: 1, moduleId: "generation.single-shot",
  providerId: "apimart", modelId: "seedance-2", mode: "text-to-video",
  prompt: "a red fox", parameters, references: [],
});

function schemaCombos(): Array<{ id: string; schema: Record<string, ParameterField> }> {
  const combos: Array<{ id: string; schema: Record<string, ParameterField> }> = [];
  for (const base of MODEL_ARCHETYPES) {
    const variants: Array<string | undefined> = base.variants?.length ? base.variants.map((variant) => variant.id) : [undefined];
    for (const variantId of variants) {
      const archetype = variantId ? rescopeArchetypeVariant(base, { variantId: variantId, modelId: undefined }) : base;
      const vendors = [null, ...new Set(archetype.modes.flatMap((mode) => Object.keys(mode.vendorParams ?? {})))];
      for (const vendor of vendors) {
        for (const mode of specializeArchetypeForVendor(archetype, vendor).modes) {
          combos.push({
            id: `${base.id}${variantId ? `@${variantId}` : ""}/${vendor ?? "*"}/${mode.id}`,
            schema: Object.fromEntries((mode.params ?? []).map((control) => [control.key, parameterFieldForControl(control)])),
          });
        }
      }
    }
  }
  return combos;
}

function rejectionOf(run: () => unknown): ContractCompilationError {
  try { run(); } catch (error) {
    if (error instanceof ContractCompilationError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("可选参数写成 null = 没填（全目录普查）", () => {
  const combos = schemaCombos();

  it("普查有真实规模（目录长了这个数只会涨，掉了说明遍历坏了）", () => {
    expect(combos.length).toBeGreaterThan(300);
    expect(combos.filter((combo) => Object.keys(combo.schema).length > 0).length).toBeGreaterThan(200);
  });

  it("每个档案 × 变体 × 供应商分层 × 模式：全部可选参数都写 null，能过，合同里一个键也没有", () => {
    const failures: string[] = [];
    for (const { id, schema } of combos) {
      const keys = Object.keys(schema);
      const nulls = Object.fromEntries(keys.map((key) => [key, null]));
      try {
        const contract = compileExecutionContract(candidate(nulls), registry, { parameterSchema: schema });
        for (const key of keys) if (key in contract.parameters) failures.push(`${id}: ${key} 进了合同`);
        for (const key of keys) {
          if (!contract.warnings.some((warning) => warning.includes(key))) failures.push(`${id}: ${key} 没有留下追查用的 warning`);
        }
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("每个可选参数单独写 null，其余写合法值：只丢这一个键，其余原样进合同", () => {
    const failures: string[] = [];
    for (const { id, schema } of combos) {
      const keys = Object.keys(schema);
      if (keys.length < 2) continue;
      const valid: Record<string, unknown> = {};
      for (const key of keys) {
        const field = schema[key];
        valid[key] = field.enum?.[0] ?? field.default ?? (field.type === "boolean" ? false : field.type === "string" ? "x" : field.min ?? 1);
      }
      for (const nulled of keys) {
        try {
          const contract = compileExecutionContract(candidate({ ...valid, [nulled]: null }), registry, { parameterSchema: schema });
          if (nulled in contract.parameters) failures.push(`${id}: ${nulled} 进了合同`);
          for (const key of keys.filter((key) => key !== nulled)) {
            if (!Object.is(contract.parameters[key], valid[key])) failures.push(`${id}: ${key} 被连带改了`);
          }
        } catch (error) {
          failures.push(`${id}/${nulled}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("undefined 与 null 同待遇（JSON 之外的调用方）", () => {
    const schema = { seed: { type: "number" } } satisfies Record<string, ParameterField>;
    const contract = compileExecutionContract(candidate({ seed: undefined }), registry, { parameterSchema: schema });
    expect(contract.parameters).toEqual({});
  });
});

describe("选型意图键写成 null 也等于没填", () => {
  it("每个意图键写 null：过、不进合同、留 warning", () => {
    for (const key of GENERATION_PLANNING_HINT_KEYS) {
      const contract = compileExecutionContract(candidate({ [key]: null }), registry, { parameterSchema: { seed: { type: "number" } } });
      expect(contract.parameters, key).toEqual({});
      expect(contract.warnings.some((warning) => warning.includes(key)), key).toBe(true);
    }
  });
});

describe("只放宽 null：其余照旧拒", () => {
  const schema = {
    seed: { type: "number" },
    duration: { type: "number", required: true },
    generate_audio: { type: "boolean" },
  } satisfies Record<string, ParameterField>;

  it("必填参数写 null → 按缺必填拒绝，原话点名是哪个键", () => {
    const error = rejectionOf(() => compileExecutionContract(candidate({ duration: null, seed: null }), registry, { parameterSchema: schema }));
    expect(error.rejection?.code).toBe("missing_required_parameter");
    expect(error.rejection?.path).toBe("parameters.duration");
    expect(error.message).toContain("parameters.duration");
    expect(error.message).toContain("null");
  });

  it("非规范数字串 \"05\"、\"4s\" 写在数字参数上 → 仍然拒", () => {
    for (const seed of ["05", "4s"]) {
      const error = rejectionOf(() => compileExecutionContract(candidate({ duration: 5, seed }), registry, { parameterSchema: schema }));
      expect(error.rejection?.code).toBe("parameter_type_mismatch");
      expect(error.rejection?.path).toBe("parameters.seed");
    }
  });

  it("规范数字串 \"4\" 先过值门：对要数字的字段就是 4，按数字进合同（2026-11-17 参数值内部类型）", () => {
    const contract = compileExecutionContract(candidate({ duration: "5", seed: "4" }), registry, { parameterSchema: schema });
    expect(contract.parameters).toEqual({ duration: 5, seed: 4 });
  });

  it("字符串 \"abc\" 写在数字参数上 → 仍然拒", () => {
    const error = rejectionOf(() => admitPlanCandidate(candidate({ duration: 5, seed: "abc" }), registry, { parameterSchema: schema }));
    expect(error.rejection?.code).toBe("parameter_type_mismatch");
  });

  it("布尔写成字符串 \"false\" → 仍然拒", () => {
    const error = rejectionOf(() => compileExecutionContract(candidate({ duration: 5, generate_audio: "false" }), registry, { parameterSchema: schema }));
    expect(error.rejection?.code).toBe("parameter_type_mismatch");
    expect(error.rejection?.path).toBe("parameters.generate_audio");
  });

  it("没声明过的键写 null：空值不带意图，按没填处理（留 warning）；写了真值才按未知参数拒", () => {
    const contract = compileExecutionContract(candidate({ duration: 5, sed: null }), registry, { parameterSchema: schema });
    expect(contract.parameters).toEqual({ duration: 5 });
    expect(contract.warnings.join("|")).toContain("sed");
    const error = rejectionOf(() => compileExecutionContract(candidate({ duration: 5, sed: 7 }), registry, { parameterSchema: schema }));
    expect(error.rejection?.code).toBe("unknown_parameter");
  });

  it("同一份草稿：真值保留、null 丢掉，合同哈希与「根本没写那个键」完全一致", () => {
    const withNull = compileExecutionContract(candidate({ duration: 5, seed: null, generate_audio: false }), registry, { parameterSchema: schema });
    const without = compileExecutionContract(candidate({ duration: 5, generate_audio: false }), registry, { parameterSchema: schema });
    expect(withNull.parameters).toEqual({ duration: 5, generate_audio: false });
    expect(withNull.contractHash).toBe(without.contractHash);
  });
});
