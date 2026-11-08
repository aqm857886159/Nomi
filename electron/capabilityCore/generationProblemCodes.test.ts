// 起草被拒的闭合原因在**抛出点**定（`docs/plan/2026-11-08-generation-request-chain.md` S1）。
//
// 每个码一条，点名模型的写法取自 39 题评测轨迹（P04 / P07 / P10 原样），走的是生产的抛出点，
// 不是手搭一个 problem 去喂渲染层：要证的是「这一类拒收出门时就带着这个码」，抛出点漏了码，这里就红。
// `reference_role_not_in_mode` 今天在起草路径上没有抛出点（参考摆放归 S3），码表单测里有它的那一句。
import { describe, expect, it } from "vitest";

import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import type { GenerationProblem } from "../shared/generationProblem";
import { admitPlanCandidate, ContractCompilationError, type PlanCandidate } from "./executionContract";
import { normalizeAuthoredCandidate, videoModeForPlan } from "./mcpGenerationVideoResolve";
import { createModuleRegistry } from "./moduleRegistry";
import { admitShotIdentity, semanticCandidateFromParams, shotTaskKind } from "./semanticGenerationCandidate";
import { GenerationRefusal } from "./transportFailure";

const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "1.0.0",
  inputKinds: ["text", "image"],
  outputKinds: ["image", "video"],
  modes: ["text_to_image", "image_edit", "text_to_video", "image_to_video"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 4 } },
  providers: [
    { providerId: "apimart", models: [
      { modelId: "doubao-seedream-5-0-pro", modes: ["text_to_image", "image_edit"], parameterSchema: {}, capabilities },
      { modelId: "doubao-seedream-4.5", modes: ["text_to_image", "image_edit"], parameterSchema: {}, capabilities },
      { modelId: "z-image-turbo", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "doubao-seedance-2.0", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
      { modelId: "veo3.1-fast", modes: ["text_to_video"], parameterSchema: {}, capabilities },
    ] },
    { providerId: "volcengine", models: [
      { modelId: "doubao-seedream-5-0-260128", modes: ["text_to_image"], parameterSchema: {}, capabilities },
      { modelId: "doubao-seedance-2-0-260128", modes: ["text_to_video", "image_to_video"], parameterSchema: {}, capabilities },
    ] },
  ],
}]);

const parse = (value: unknown): PlanCandidate => value as PlanCandidate;
const candidate = (providerId: string, modelId: string, mode: string, parameters: Record<string, unknown> = {}, extra: Partial<PlanCandidate> = {}): PlanCandidate => ({
  candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot",
  providerId, modelId, mode, prompt: "午后窗台，一只橘猫", parameters, references: [], ...extra,
});

/** 跑一次、拿回它带出门的原因与给模型的正文。放行了就是这条测试红。 */
function refusal(run: () => unknown): { problem: GenerationProblem | undefined; message: string } {
  try { run(); } catch (error) {
    if (error instanceof GenerationRefusal || error instanceof ContractCompilationError) return { problem: error.problem, message: error.message };
    throw error;
  }
  throw new Error("应当拒绝，却放行了");
}

describe("unknown_model：点了名的模型不在目录里", () => {
  // 反例 1（P07 原样）：用户没接火山，apimart 上有同名模型。修之前模型读到的是「没有配置可用的图片模型」。
  it("P07 volcengine + doubao-seedream-5-0-pro，没有默认 → unknown_model，最接近的是 apimart 那一个；不说默认模型", () => {
    const { problem, message } = refusal(() => semanticCandidateFromParams({
      operationId: "op-p07",
      params: { prompt: "午后窗台", taskKind: "text_to_image", providerId: "volcengine", modelId: "doubao-seedream-5-0-pro" },
      candidateFrom: parse, registry,
    }));
    expect(problem).toMatchObject({ code: "unknown_model", field: "candidate.modelId", nearest: "apimart/doubao-seedream-5-0-pro", next: "use_nearest_model" });
    expect(message).toContain("volcengine/doubao-seedream-5-0-pro is not in the model catalog");
    expect(message).not.toMatch(/没有配置可用|has no default/);
  });

  it("用户存了默认、点名的又不存在 → 核身份那一步照样说 unknown_model（不是「做不了」）", () => {
    const { problem } = refusal(() => admitShotIdentity(candidate("volcengine", "doubao-seedream-5-0-pro", "text_to_image"), registry));
    expect(problem).toMatchObject({ code: "unknown_model", nearest: "apimart/doubao-seedream-5-0-pro" });
  });

  it("P04 带日期后缀的火山式 id（doubao-seedream-4-5-251128）→ 最接近的是 apimart 的 doubao-seedream-4.5", () => {
    const { problem } = refusal(() => admitShotIdentity(candidate("apimart", "doubao-seedream-4-5-251128", "text_to_image"), registry));
    expect(problem).toMatchObject({ code: "unknown_model", nearest: "apimart/doubao-seedream-4.5" });
  });

  it("P10 MAILAND/majicflus_v1：够不上「接近」就不凑一个，下一步是去 list_models 里挑", () => {
    const { problem, message } = refusal(() => semanticCandidateFromParams({
      operationId: "op-p10",
      params: { prompt: "一只橘猫坐在窗台上", taskKind: "text_to_image", providerId: "MAILAND", modelId: "MAILAND/majicflus_v1" },
      candidateFrom: parse, registry,
    }));
    expect(problem).toMatchObject({ code: "unknown_model", next: "pick_from_list_models" });
    expect(problem).not.toHaveProperty("nearest");
    expect(message).toContain("list_models");
  });

  it("没写种类、点名的模型又认不出 → 也是 unknown_model（有这个模型的话它的模式就定了种类）", () => {
    const { problem } = refusal(() => shotTaskKind({ params: { prompt: "x", providerId: "bytedance", modelId: "bytedance/seedance-2" }, registry }));
    expect(problem?.code).toBe("unknown_model");
  });
});

describe("no_default_model：没点名，也没有能用的默认", () => {
  // 反例 2：镜头没点名模型，用户也没存默认图片模型。
  it("图片镜头 → no_default_model / image，下一步指到默认模型", () => {
    const { problem, message } = refusal(() => semanticCandidateFromParams({
      operationId: "op-p04", params: { prompt: "雪夜木屋", taskKind: "text_to_image" }, candidateFrom: parse, registry,
    }));
    expect(problem).toMatchObject({ code: "no_default_model", media: "image", next: "set_default_model" });
    expect(message).toMatch(/No image model was named and the user has no default image model/);
  });

  it("视频镜头 → media 是 video", () => {
    const { problem } = refusal(() => semanticCandidateFromParams({
      operationId: "op-video", params: { prompt: "风筝掠过麦田", taskKind: "text_to_video" }, candidateFrom: parse, registry,
    }));
    expect(problem).toMatchObject({ code: "no_default_model", media: "video" });
  });
});

describe("mode_not_in_model：这个模型没有要的这种", () => {
  it("视频模型被要求出图 → mode_not_in_model，列出它做得了的", () => {
    const { problem, message } = refusal(() => shotTaskKind({ params: { prompt: "x", taskKind: "text_to_image", modelId: "doubao-seedance-2.0" }, registry }));
    expect(problem).toMatchObject({ code: "mode_not_in_model", allowed: ["text_to_video", "image_to_video"], next: "use_allowed_value" });
    expect(message).toMatch(/doubao-seedance-2\.0 cannot do text_to_image\. It does: text_to_video, image_to_video/);
  });

  it("核身份那一步：图片模型配视频镜头", () => {
    const { problem } = refusal(() => admitShotIdentity(candidate("apimart", "z-image-turbo", "text_to_video"), registry));
    expect(problem).toMatchObject({ code: "mode_not_in_model", allowed: ["text_to_image"] });
  });

  it("视频模式 id 这个模型没有（modeId: t2i）→ mode_not_in_model，列出它的模式", () => {
    const [video] = buildVideoModelCandidates([{ provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance 2.0" }]);
    const { problem } = refusal(() => videoModeForPlan(candidate("apimart", "doubao-seedance-2.0", "text_to_video", {}, { modeId: "t2i" }), video!));
    expect(problem?.code).toBe("mode_not_in_model");
    expect(problem?.field).toBe("modeId");
    expect(problem?.allowed?.length).toBeGreaterThan(0);
  });
});

describe("ratio_not_in_mode：这个模式出不了要的比例", () => {
  it("Z-Image Turbo 要 21:9（它的比例档里没有）→ ratio_not_in_mode，带它的比例档", () => {
    const { problem } = refusal(() => normalizeAuthoredCandidate(candidate("apimart", "z-image-turbo", "text_to_image", { aspectRatio: "21:9" }), registry, undefined));
    expect(problem).toMatchObject({ code: "ratio_not_in_mode", field: "aspectRatio", next: "use_allowed_value" });
    expect(problem?.allowed).toContain("1:1");
    expect(problem?.allowed).not.toContain("21:9");
  });

  it("volcengine doubao-seedream-5-0-260128 按像素出图、没有比例档 → ratio_not_in_mode，不带可选值，下一步是去掉比例", () => {
    const { problem } = refusal(() => normalizeAuthoredCandidate(candidate("volcengine", "doubao-seedream-5-0-260128", "text_to_image", { aspectRatio: "3:4" }), registry, undefined));
    expect(problem).toMatchObject({ code: "ratio_not_in_mode", field: "aspectRatio", next: "drop_field" });
    expect(problem).not.toHaveProperty("allowed");
  });
});

describe("duration_not_in_mode：时长不在这个模式的档里", () => {
  const videos = buildVideoModelCandidates([
    { provider: "volcengine", modelKey: "doubao-seedance-2-0-260128", label: "Seedance 2.0" },
    { provider: "apimart", modelKey: "veo3.1-fast", label: "Veo 3.1 Fast" },
  ]);

  it("volcengine doubao-seedance-2-0-260128 要 3 秒（范围 4–15）→ duration_not_in_mode，带 min / max", () => {
    const { problem } = refusal(() => normalizeAuthoredCandidate(candidate("volcengine", "doubao-seedance-2-0-260128", "text_to_video", { duration: 3 }), registry, videos));
    expect(problem).toMatchObject({ code: "duration_not_in_mode", field: "durationSec", min: 4, max: 15, next: "use_allowed_value" });
  });

  it("apimart veo3.1-fast 这个模式没有时长参数 → duration_not_in_mode，下一步是去掉时长", () => {
    const { problem } = refusal(() => normalizeAuthoredCandidate(candidate("apimart", "veo3.1-fast", "text_to_video", { duration: 8 }), registry, videos));
    expect(problem).toMatchObject({ code: "duration_not_in_mode", field: "durationSec", next: "drop_field" });
  });
});

describe("reference_over_capacity：参考素材超过这个模式的上限", () => {
  // 反例 3：生产的注册表清单今天不给 references 写上限，这一道在生产起草里走不到（真正的超量在提交那一步由
  // 供应商适配器拒，归 S3 / S4）；声明了上限的清单（测试与夹具都有）在这里当场拒，而且带着码。
  it("上限 4、带了 5 张 → reference_over_capacity，带 max；正文不是那句「不接受这组参数」", () => {
    const references = Array.from({ length: 5 }, (_, index) => ({ assetId: `asset-${index}`, contentHash: "a".repeat(64), version: 1 }));
    const { problem, message } = refusal(() => admitPlanCandidate(candidate("apimart", "doubao-seedream-5-0-pro", "image_edit", {}, { references } as Partial<PlanCandidate>), registry));
    expect(problem).toMatchObject({ code: "reference_over_capacity", field: "references", max: 4, next: "reduce_references" });
    expect(message).toMatch(/at most 4 references in this mode; got 5/);
  });
});

describe("parameter_not_allowed：其余入参问题照旧按字段说", () => {
  it("种类写成了不存在的值 → parameter_not_allowed，正文就是抛出点那句话", () => {
    const { problem, message } = refusal(() => semanticCandidateFromParams({
      operationId: "op-kind", params: { prompt: "x", taskKind: "video" }, candidateFrom: parse, registry,
    }));
    expect(problem).toMatchObject({ code: "parameter_not_allowed", next: "fix_field" });
    expect(message).toMatch(/taskKind must be text_to_image, image_edit, text_to_video or image_to_video/);
  });
});
