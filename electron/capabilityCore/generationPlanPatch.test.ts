// 候选补丁的并入规则（`resolvePlanPatch`）：只换了生成方式（档案模式 id）时，种类跟着这个生成方式走。
// 付费卡上切「文生图 / 图生图」、画布连来参考图时卡自己切过去，发给宿主的都只有 modeId；
// 种类不跟，派发就按旧种类挑供应商的 mapping（2026-10-02 pb02：文生图那一份不收参考图，点下去在出站前被拒）。
import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "./executionContract";
import { resolvePlanPatch } from "./generationPlanPatch";
import { createModuleRegistry } from "./moduleRegistry";

const capabilities = { submitIdempotency: true, query: true, reconcile: true, cancel: true };
// 目录里的拼法故意用连字符：写回的必须是目录自己的那一种。
const registry = createModuleRegistry([{
  moduleId: "generation.single-shot",
  version: "test",
  inputKinds: ["text", "image"],
  outputKinds: ["image"],
  modes: ["text-to-image", "image-edit"],
  parameterSchema: {},
  assetInputSchema: { references: { kind: "asset", max: 8 } },
  providers: [{
    providerId: "apimart",
    models: [
      { modelId: "gpt-image-2", modes: ["text-to-image", "image-edit"], parameterSchema: {}, capabilities },
      // 同一个档案（按身份认出 GPT Image 2），目录里却只声明了文生图。
      { modelId: "gpt-image-2-text-to-image", modes: ["text-to-image"], parameterSchema: {}, capabilities },
    ],
  }],
}]);

const IMG_REF: PlanCandidate["references"] = [
  { assetId: "asset-img-1", contentHash: "a".repeat(64), version: 1, kind: "image" },
];

function base(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot", providerId: "apimart", modelId: "gpt-image-2",
    mode: "text-to-image", prompt: "同一个人站在黄昏的海边，逆光", parameters: {}, references: [], ...overrides,
  };
}

describe("resolvePlanPatch · 种类跟着生成方式走", () => {
  it("只换成图生图（modeId i2i，带参考图）：种类跟成目录里这个模型的「改图」拼法", () => {
    const { normalizedPatch, changeset } = resolvePlanPatch({ baseCandidate: base({ references: IMG_REF }), userPatch: { modeId: "i2i" }, registry });
    expect(normalizedPatch).toMatchObject({ modeId: "i2i", mode: "image-edit" });
    expect(changeset).toMatchObject({ modeChanged: true, modelChanged: false });
  });

  it("显式切到图生图（modeId i2i）却没有参考图：当场按 mode_input_missing 拒收", () => {
    expect(() => resolvePlanPatch({ baseCandidate: base(), userPatch: { modeId: "i2i" }, registry }))
      .toThrow(/mode_input_missing/);
  });

  it("切回文生图（modeId t2i）：种类跟回文生图", () => {
    const { normalizedPatch } = resolvePlanPatch({ baseCandidate: base({ mode: "image-edit", modeId: "i2i" }), userPatch: { modeId: "t2i" }, registry });
    expect(normalizedPatch).toMatchObject({ modeId: "t2i", mode: "text-to-image" });
  });

  it("modeId 没变（同一个生成方式再发一次，带参考图）：种类不动、不算换了方式", () => {
    const { normalizedPatch, changeset } = resolvePlanPatch({ baseCandidate: base({ mode: "image-edit", modeId: "i2i", references: IMG_REF }), userPatch: { modeId: "i2i", prompt: "换一句" }, registry });
    expect(normalizedPatch).not.toHaveProperty("mode");
    expect(changeset).toBeUndefined();
  });

  it("这个模型在目录里做不了那一种：当场拒，说清它能做什么（和建镜头同一道账）", () => {
    expect(() => resolvePlanPatch({ baseCandidate: base({ modelId: "gpt-image-2-text-to-image" }), userPatch: { modeId: "i2i" }, registry }))
      .toThrow(/text-to-image/);
  });

  it("档案里没有这个生成方式：种类不猜、原样留着", () => {
    const { normalizedPatch } = resolvePlanPatch({ baseCandidate: base(), userPatch: { modeId: "no-such-mode" }, registry });
    expect(normalizedPatch).not.toHaveProperty("mode");
  });

  it("明写了种类就按明写的（不拿 modeId 覆盖调用方这一次点名的）", () => {
    const { normalizedPatch } = resolvePlanPatch({ baseCandidate: base({ references: IMG_REF }), userPatch: { modeId: "i2i", mode: "image-edit" }, registry });
    expect(normalizedPatch).toMatchObject({ mode: "image-edit", modeId: "i2i" });
  });
});
