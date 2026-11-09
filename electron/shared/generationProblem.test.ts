// 闭合原因码表本身（`generationProblem.ts`）：公开那一份不带收到的值、下一步按事实定、模型正文由事实生成、读回不信任。
import { describe, expect, it } from "vitest";

import {
  GENERATION_PROBLEM_CODE_LIST,
  GENERATION_PROBLEM_NEXT_ACTION_EN,
  GENERATION_PROBLEM_NEXT_LIST,
  generationProblemFrom,
  generationProblemModelText,
  generationProblemOf,
  isGenerationProblemCode,
  type GenerationProblemInput,
} from "./generationProblem";

/** 每个码一份典型入参（带上只给模型读的事实，好验它们不进公开那一份）。 */
const SAMPLES: Readonly<Record<GenerationProblemInput["code"], GenerationProblemInput>> = {
  unknown_model: { code: "unknown_model", field: "candidate.modelId", model: "volcengine/doubao-seedream-5-0-pro", nearest: "apimart/doubao-seedream-5-0-pro" },
  no_default_model: { code: "no_default_model", field: "candidate.modelId", media: "image" },
  mode_not_in_model: { code: "mode_not_in_model", field: "taskKind", model: "apimart/doubao-seedance-2.0", value: "text_to_image", allowed: ["text_to_video", "image_to_video"] },
  ratio_not_in_mode: { code: "ratio_not_in_mode", field: "aspectRatio", model: "apimart/z-image-turbo", value: "21:9", allowed: ["1:1", "16:9"] },
  duration_not_in_mode: { code: "duration_not_in_mode", field: "durationSec", model: "volcengine/doubao-seedance-2-0-260128", value: 3, min: 4, max: 15 },
  reference_over_capacity: { code: "reference_over_capacity", field: "references", model: "apimart/gpt-image-2", value: 16, max: 15 },
  reference_role_not_in_mode: { code: "reference_role_not_in_mode", field: "references.0.role", model: "apimart/doubao-seedance-2.0", value: "last_frame", allowed: ["first_frame"] },
  parameter_not_allowed: { code: "parameter_not_allowed", field: "parameters.size", allowed: ["1K", "2K"], detail: "size must be one of: 1K, 2K." },
};

describe("generationProblem：起草被拒的闭合原因", () => {
  it("码表与样本一一对应；读回函数只认码表里的码", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...GENERATION_PROBLEM_CODE_LIST].sort());
    for (const code of GENERATION_PROBLEM_CODE_LIST) expect(isGenerationProblemCode(code)).toBe(true);
    expect(isGenerationProblemCode("generation_input_invalid")).toBe(false);
    expect(isGenerationProblemCode("Unknown_Model")).toBe(false);
  });

  it("公开那一份不带收到的值、点名的模型和散文；起草期一律可重试、没花钱", () => {
    for (const input of Object.values(SAMPLES)) {
      const problem = generationProblemFrom(input);
      expect(problem.code).toBe(input.code);
      expect(problem).not.toHaveProperty("model");
      expect(problem).not.toHaveProperty("value");
      expect(problem).not.toHaveProperty("detail");
      expect(problem).toMatchObject({ retryable: true, charged: false });
      expect(GENERATION_PROBLEM_NEXT_LIST).toContain(problem.next);
      const serialized = JSON.stringify(problem);
      if ("model" in input && input.model) expect(serialized, input.code).not.toContain(input.model);
      if ("detail" in input) expect(serialized).not.toContain(input.detail);
    }
  });

  it("同一个码，事实不同，下一步不同", () => {
    expect(generationProblemFrom(SAMPLES.unknown_model).next).toBe("use_nearest_model");
    expect(generationProblemFrom({ code: "unknown_model", model: "MAILAND/majicflus_v1" }).next).toBe("pick_from_list_models");
    expect(generationProblemFrom(SAMPLES.ratio_not_in_mode).next).toBe("use_allowed_value");
    expect(generationProblemFrom({ code: "ratio_not_in_mode", model: "volcengine/doubao-seedream-4-5-251128", value: "1:1" }).next).toBe("drop_field");
    expect(generationProblemFrom(SAMPLES.duration_not_in_mode).next).toBe("use_allowed_value");
    expect(generationProblemFrom({ code: "duration_not_in_mode", model: "apimart/veo3.1-fast", value: 8 }).next).toBe("drop_field");
    expect(generationProblemFrom(SAMPLES.no_default_model).next).toBe("pick_from_list_models");
    expect(generationProblemFrom(SAMPLES.reference_over_capacity).next).toBe("reduce_references");
    expect(generationProblemFrom(SAMPLES.parameter_not_allowed).next).toBe("fix_field");
  });

  it("每个下一步（fix_field 除外，它沿用准入层按字段给的那句）都有一句给模型读的 Next", () => {
    for (const next of GENERATION_PROBLEM_NEXT_LIST) {
      if (next === "fix_field") continue;
      expect(GENERATION_PROBLEM_NEXT_ACTION_EN[next], next).toMatch(/\S/);
    }
  });

  it("模型正文由事实生成：说清哪里不行、合法的是什么", () => {
    expect(generationProblemModelText(SAMPLES.ratio_not_in_mode)).toMatch(/apimart\/z-image-turbo cannot make 21:9 .*1:1, 16:9/);
    expect(generationProblemModelText(SAMPLES.duration_not_in_mode)).toMatch(/between 4 and 15 seconds.*got 3/);
    expect(generationProblemModelText(SAMPLES.reference_over_capacity)).toMatch(/at most 15 references.*got 16/);
    expect(generationProblemModelText(SAMPLES.mode_not_in_model)).toMatch(/cannot do text_to_image\. It does: text_to_video, image_to_video/);
    const structural = { code: "parameter_not_allowed", field: "parameters.size", detail: "size must be one of: 1K, 2K." } as const;
    expect(generationProblemModelText(structural)).toBe(structural.detail);
  });

  // 2026-11-08 的真实故障：点名的 id 不存在时模型读到「没有配置可用的图片模型」，于是去劝用户配默认模型（39 题里 9 次）。
  it("反例：点名的模型不存在时，正文说「不在目录里 + 最接近的那个」，不说「没配默认模型」", () => {
    const text = generationProblemModelText(SAMPLES.unknown_model);
    expect(text).toContain("volcengine/doubao-seedream-5-0-pro is not in the model catalog");
    expect(text).toContain("apimart/doubao-seedream-5-0-pro");
    expect(text).not.toMatch(/no default|has no default|没有配置可用/i);
    expect(generationProblemModelText(SAMPLES.no_default_model)).toMatch(/No image model was named and the user has no default image model/);
  });

  it.each(["image", "video"] as const)("无默认 %s：正文和 Next 都要求 Agent 点名重试并报告显示名", (media) => {
    const input = { code: "no_default_model", media } as const;
    const next = generationProblemFrom(input).next!;
    for (const text of [generationProblemModelText(input), GENERATION_PROBLEM_NEXT_ACTION_EN[next as Exclude<typeof next, "fix_field">]]) {
      expect(text).toContain("list_models");
      expect(text).toContain("modelId");
      expect(text).toContain("display name");
      expect(text).not.toMatch(/ask the user|settings|pick a default/i);
    }
  });

  it("读回不信任：形状不对的格丢掉，码不在表里整份不要（老转录、被改坏的转录都可能出现）", () => {
    const problem = generationProblemFrom(SAMPLES.ratio_not_in_mode);
    expect(generationProblemOf(JSON.parse(JSON.stringify(problem)))).toEqual(problem);
    expect(generationProblemOf({ code: "made_up" })).toBeUndefined();
    expect(generationProblemOf(undefined)).toBeUndefined();
    expect(generationProblemOf(["unknown_model"])).toBeUndefined();
    expect(generationProblemOf({ code: "unknown_model", nearest: 3, allowed: [1, 2], media: "audio", next: "guess", retryable: "yes" }))
      .toEqual({ code: "unknown_model", retryable: false, charged: false });
  });
});
