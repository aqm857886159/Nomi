import { describe, expect, it } from "vitest";
import { buildVideoModelCandidates } from "../shared/videoCapabilities";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { normalizeVideoCandidate, videoModeForPlan } from "./mcpGenerationVideoResolve";
import type { PlanCandidate } from "./executionContract";

// 历史拒收逐条锁住形状；原报告未给完整请求，模型使用声明相同模式的现役档案。
const replays = [
  ["P07[7]", "apimart", "doubao-seedance-2.0", "firstlast", "text_to_video"],
  ["P16[7]", "volcengine", "doubao-seedance-2-5-260628", "omni", "text_to_video"],
  ["P20[4]", "kie", "minimax-h3", "ref", "image_to_video"],
  ["P21[7]", "apimart", "doubao-seedance-2.0", "firstlast", "text_to_video"],
  ["P22[7]", "kie", "happyhorse", "edit", "image_to_video"],
  ["P24[6]", "volcengine", "doubao-seedance-2-5-260628", "omni", "text_to_video"],
  ["P25[4]", "volcengine", "doubao-seedance-2-5-260628", "omni", "text_to_video"],
  ["P29[8]", "volcengine", "doubao-seedance-2-5-260628", "omni", "text_to_video"],
  ["P32[2]", "volcengine", "doubao-seedance-2-5-260628", "omni", "text_to_video"],
  ["P35[4]", "volcengine", "doubao-seedance-2-5-260628", "first", "text_to_video"],
] as const;
const plan = (providerId: string, modelId: string, mode: string, modeId?: string): PlanCandidate => ({
  candidateId: "c", revision: 1, moduleId: "generation.single-shot", providerId, modelId,
  mode, ...(modeId ? { modeId } : {}), prompt: "一镜", parameters: {}, references: [],
});

describe("模式决定种类", () => {
  it.each(replays)("%s：modeId 决定传输，不拿 taskKind 拒收", (_id, provider, modelKey, modeId, taskKind) => {
    const candidates = buildVideoModelCandidates([{ provider, modelKey, label: modelKey }]);
    expect(candidates).toHaveLength(1);
    const candidate = plan(provider, modelKey, taskKind, modeId);
    const selected = videoModeForPlan(candidate, candidates[0]!);
    expect(selected.id).toBe(modeId);
    expect(normalizeVideoCandidate(candidate, candidates)).toMatchObject({ modeId,
      mode: modeTransportFor(selected, candidates[0]!.archetype, provider) });
  });

  it("没有 modeId 的旧草稿仍按 taskKind 选模式，未知模式仍拒", () => {
    const candidates = buildVideoModelCandidates([{ provider: "apimart", modelKey: "doubao-seedance-2.0", label: "Seedance" }]);
    expect(normalizeVideoCandidate(plan("apimart", "doubao-seedance-2.0", "text_to_video"), candidates))
      .toMatchObject({ mode: "text_to_video", modeId: "t2v" });
    expect(() => videoModeForPlan(plan("apimart", "doubao-seedance-2.0", "text_to_video", "missing"), candidates[0]!)).toThrow();
  });
});
