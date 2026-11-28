// 「Agent 说的时长」起草时就核（铁律 ⑩ 首跑 LAW10-OUT-OF-RANGE-SPLIT / LAW10-SILENT-DROP）。
// 类测试：不点名哪家模型，只看参数表的三种形状——没有时长、有档位、有范围。
import { describe, expect, it } from "vitest";

import { admitAuthoredDuration, admitAuthoredDurationWithAdjustment } from "./generationAuthoredDuration";
import { ContractCompilationError, type PlanCandidate } from "./executionContract";

const candidate = (parameters: Record<string, unknown>): PlanCandidate => ({
  candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "model-x",
  mode: "text_to_video", prompt: "海边", parameters, references: [],
} as PlanCandidate);

function refusalOf(run: () => unknown): ContractCompilationError {
  try { run() } catch (error) { if (error instanceof ContractCompilationError) return error; throw error }
  throw new Error("应当拒绝，却放行了");
}

describe("admitAuthoredDuration", () => {
  it("没写时长：原样返回同一个对象", () => {
    const input = candidate({ resolution: "720p" });
    expect(admitAuthoredDuration(input, { duration: { type: "number", enum: [6, 10] } })).toBe(input);
  });

  it("档位里有：落到参数表那个键上，类型跟档位一致（字符串档就写字符串）", () => {
    expect(admitAuthoredDuration(candidate({ duration: 6 }), { duration: { type: "number", enum: [6, 10] } }).parameters).toEqual({ duration: 6 });
    expect(admitAuthoredDuration(candidate({ duration: 5 }), { duration: { type: "enum", enum: ["5", "10"] } }).parameters).toEqual({ duration: "5" });
    expect(admitAuthoredDuration(candidate({ durationSeconds: 8 }), { durationSeconds: { type: "number", min: 4, max: 15 } }).parameters).toEqual({ durationSeconds: 8 });
  });

  it("不在档里：确定性吸附到最近合法档（等距取更短省钱档），并产出结构化 adjustment 供 Agent 诚实告知用户", () => {
    const down = admitAuthoredDurationWithAdjustment(candidate({ duration: 8 }), { duration: { type: "number", enum: [6, 10] } });
    expect(down.candidate.parameters).toEqual({ duration: 6 });
    expect(down.adjustment).toMatchObject({ field: "durationSec", requested: 8, applied: 6 });

    const up = admitAuthoredDurationWithAdjustment(candidate({ duration: 9 }), { duration: { type: "enum", enum: ["6", "10"] } });
    expect(up.candidate.parameters).toEqual({ duration: "10" });
    expect(up.adjustment).toMatchObject({ field: "durationSec", requested: 9, applied: 10 });
  });

  it("出了范围：确定性吸附到合法边界档，并产出结构化 adjustment（不盲抛错让模型猜重试）", () => {
    const low = admitAuthoredDurationWithAdjustment(candidate({ duration: 3 }), { duration: { type: "number", min: 4, max: 15 } });
    expect(low.candidate.parameters).toEqual({ duration: 4 });
    expect(low.adjustment).toMatchObject({ field: "durationSec", requested: 3, applied: 4 });

    const high = admitAuthoredDurationWithAdjustment(candidate({ duration: 30 }), { duration: { type: "number", min: 4, max: 15 } });
    expect(high.candidate.parameters).toEqual({ duration: 15 });
    expect(high.adjustment).toMatchObject({ field: "durationSec", requested: 30, applied: 15 });
  });

  it("这个模式没有时长参数：拒，叫 Agent 去掉时长（不悄悄丢掉）", () => {
    const error = refusalOf(() => admitAuthoredDuration(candidate({ duration: 8 }), { aspect_ratio: { type: "enum", enum: ["16:9"] } }));
    expect(error.message).toContain("没有时长参数");
    expect(error.rejection).toMatchObject({ code: "unknown_parameter", path: "durationSec", allowedKeys: ["aspect_ratio"] });
  });

  it("模型一个参数都没声明：证不出错，放行（与准入层同一条）", () => {
    const input = candidate({ duration: 8 });
    expect(admitAuthoredDuration(input, {})).toBe(input);
  });

  it("不是正的秒数：拒", () => {
    expect(refusalOf(() => admitAuthoredDuration(candidate({ duration: "abc" }), { duration: { type: "number" } })).rejection)
      .toMatchObject({ code: "parameter_type_mismatch" });
  });
});
