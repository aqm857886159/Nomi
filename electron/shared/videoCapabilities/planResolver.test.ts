import { describe, expect, it } from "vitest";
import type { ModelArchetype, ModelParameterControl } from "./types";
import type { VideoModelCandidate } from "./recommendation";
import { MINIMAX_H3_ARCHETYPE } from "./minimaxH3";
import { applyMergeProposal, applySplitProposal, resolveGenerationPlan } from "./planResolver";
import type { PlanShotInput } from "./planResolver";

const candidateFor = (archetype: ModelArchetype, modelKey = archetype.id, provider = "kie"): VideoModelCandidate => ({
  provider,
  modelKey,
  label: archetype.label,
  archetype,
});

/** 合成枚举时长档案：duration 只有 5 / 10 两档（模拟单条上限 10s 的常见模型形态）。 */
const ENUM_DURATION: ModelParameterControl = {
  key: "duration",
  label: "时长",
  type: "select",
  options: [
    { value: 5, label: "5 秒" },
    { value: 10, label: "10 秒" },
  ],
  defaultValue: 5,
};
const ENUM_CAP_ARCHETYPE: ModelArchetype = {
  id: "test-enum-cap",
  family: "test",
  label: "Test EnumCap",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["test-enum-cap"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "test",
      promptRequired: true,
      slots: [],
      params: [ENUM_DURATION],
    },
  ],
};

const H3 = candidateFor(MINIMAX_H3_ARCHETYPE);

describe("planResolver · 校验与钳值", () => {
  it("H3 时长区间钳值：超上限钳到 15 并记 overflow，低于下限钳到 4 并记 underflow", () => {
    const { shots, issues } = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 20, sceneAnchorId: "s1" },
        { id: "b", durationSec: 2, sceneAnchorId: "s1" },
      ],
      candidates: [H3],
    });
    expect(shots[0]!.params.duration).toBe(15);
    expect(shots[1]!.params.duration).toBe(4);
    expect(issues.some((issue) => issue.code === "duration.overflow" && issue.shotId === "a")).toBe(true);
    expect(issues.some((issue) => issue.code === "duration.underflow" && issue.shotId === "b")).toBe(true);
  });

  it("合法时长不误报；枚举时长取最近档", () => {
    const enumCap = candidateFor(ENUM_CAP_ARCHETYPE);
    const { shots, issues } = resolveGenerationPlan({
      shots: [
        { id: "keep", durationSec: 6, sceneAnchorId: "s1" },
        { id: "near", durationSec: 5, sceneAnchorId: "s1" },
      ],
      candidates: [enumCap],
    });
    expect(shots[0]!.params.duration).toBe(5); // 6 最近取 5
    expect(shots[1]!.params.duration).toBe(5);
    expect(issues.some((issue) => issue.code === "duration.clamped" && issue.shotId === "keep")).toBe(true);
    expect(issues.some((issue) => issue.code === "duration.clamped" && issue.shotId === "near")).toBe(false);
  });

  it("未知参数键被丢弃并记 issue；档案真实键保留；非法模式回退默认并记 issue", () => {
    const { shots, issues } = resolveGenerationPlan({
      shots: [
        {
          id: "x",
          durationSec: 6,
          sceneAnchorId: "s1",
          modelKey: "minimax-h3",
          modeId: "omni", // H3 无此模式
          params: { aspect_ratio: "16:9", resolution: "2K", made_up_key: "boom" },
        },
      ],
      candidates: [H3],
    });
    const shot = shots[0]!;
    expect(shot.resolved).toBe(true);
    expect(shot.modeId).toBe("t2v");
    expect(shot.params.aspect_ratio).toBe("16:9");
    expect(shot.params.resolution).toBe("2K");
    expect("made_up_key" in shot.params).toBe(false);
    expect(issues.some((issue) => issue.code === "mode.fallback")).toBe(true);
    expect(issues.some((issue) => issue.code === "param.unknown")).toBe(true);
  });

  it("清单外模型回退默认候选并记 issue；无候选直接 fail-closed", () => {
    const { shots: fallbackShots, issues: fallbackIssues } = resolveGenerationPlan({
      shots: [{ id: "y", durationSec: 6, modelKey: "no-such-model", sceneAnchorId: "s1" }],
      candidates: [H3],
      defaultModelKey: "minimax-h3",
    });
    expect(fallbackShots[0]!.candidate!.modelKey).toBe("minimax-h3");
    expect(fallbackIssues.some((issue) => issue.code === "model.missing")).toBe(true);

    const { shots: emptyShots, issues: emptyIssues } = resolveGenerationPlan({ shots: [{ id: "z", durationSec: 6 }], candidates: [] });
    expect(emptyShots[0]!.resolved).toBe(false);
    expect(emptyIssues.some((issue) => issue.code === "no.candidates")).toBe(true);
  });
});

describe("planResolver · 合并建议", () => {
  it("相邻同场短拍（各 ≤ 上限一半、合计 ≤ 上限）给出效率合并建议", () => {
    const enumCap = candidateFor(ENUM_CAP_ARCHETYPE);
    const { mergeProposals } = resolveGenerationPlan({
      shots: [
        { id: "shot1", durationSec: 5, sceneAnchorId: "s1" },
        { id: "shot2", durationSec: 5, sceneAnchorId: "s1" },
      ],
      candidates: [enumCap],
    });
    expect(mergeProposals).toHaveLength(1);
    expect(mergeProposals[0]!.shotIds).toEqual(["shot1", "shot2"]);
    expect(mergeProposals[0]!.durationSec).toBe(10);
    expect(mergeProposals[0]!.advisory).toBe(true);
    expect(mergeProposals[0]!.reason).toContain("合计 10s");
  });

  it("合计超单条上限不合并（H3：8+8 > 15）", () => {
    const { mergeProposals } = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 8, sceneAnchorId: "s1" },
        { id: "b", durationSec: 8, sceneAnchorId: "s1" },
      ],
      candidates: [H3],
    });
    expect(mergeProposals).toHaveLength(0);
  });

  it("跨场/缺场景锚不做效率合并；关闭效率合并后仅保留 must-merge", () => {
    const { mergeProposals: crossScene } = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 4, sceneAnchorId: "s1" },
        { id: "b", durationSec: 4, sceneAnchorId: "s2" },
      ],
      candidates: [H3],
    });
    expect(crossScene).toHaveLength(0);

    const noAnchor = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 4 },
        { id: "b", durationSec: 4 },
      ],
      candidates: [H3],
    });
    expect(noAnchor.mergeProposals).toHaveLength(0);

    const off = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 4, sceneAnchorId: "s1" },
        { id: "b", durationSec: 4, sceneAnchorId: "s1" },
      ],
      candidates: [H3],
      goals: { allowAdvisoryMerge: false },
    });
    expect(off.mergeProposals).toHaveLength(0);

    // 低于下限（H3 min=4）的镜头即使关闭效率合并也必须并入邻镜
    const must = resolveGenerationPlan({
      shots: [
        { id: "a", durationSec: 3, sceneAnchorId: "s1" },
        { id: "b", durationSec: 4, sceneAnchorId: "s1" },
      ],
      candidates: [H3],
      goals: { allowAdvisoryMerge: false },
    });
    expect(must.mergeProposals).toHaveLength(1);
    expect(must.mergeProposals[0]!.advisory).toBe(false);
  });
});

describe("planResolver · 拆条建议", () => {
  it("H3：40s 拆成 3 段（15+15+10），段落在 [4,15] 内，给首尾帧承接提示", () => {
    const { splitProposals } = resolveGenerationPlan({
      shots: [{ id: "long", durationSec: 40, sceneAnchorId: "s1" }],
      candidates: [H3],
    });
    expect(splitProposals).toHaveLength(1);
    const pieces = splitProposals[0]!.pieces.map((piece) => piece.durationSec);
    expect(pieces).toEqual([15, 15, 10]);
    expect(pieces.reduce((sum, value) => sum + value, 0)).toBe(40);
    expect(splitProposals[0]!.suggestFirstLast).toBe(true);
  });

  it("枚举 10s 上限模型：24s 拆成 10+9+5，均落在 [5,10]", () => {
    const enumCap = candidateFor(ENUM_CAP_ARCHETYPE);
    const { splitProposals } = resolveGenerationPlan({
      shots: [{ id: "long", durationSec: 24, sceneAnchorId: "s1" }],
      candidates: [enumCap],
    });
    const pieces = splitProposals[0]!.pieces.map((piece) => piece.durationSec);
    expect(pieces).toEqual([10, 9, 5]);
    expect(pieces.every((value) => value >= 5 && value <= 10)).toBe(true);
  });
});

describe("planResolver · 采纳建议（应用函数）", () => {
  it("applyMergeProposal：原位替换、保持镜序、时长求和、锚取并集", () => {
    const shots: PlanShotInput[] = [
      { id: "shot1", durationSec: 5, sceneAnchorId: "s1", anchorIds: ["anchor-1"] },
      { id: "shot2", durationSec: 5, sceneAnchorId: "s1", anchorIds: ["anchor-1"] },
      { id: "shot3", durationSec: 4, sceneAnchorId: "s2", anchorIds: ["anchor-2"] },
    ];
    const { mergeProposals } = resolveGenerationPlan({ shots, candidates: [candidateFor(ENUM_CAP_ARCHETYPE)] });
    const merged = applyMergeProposal(shots, mergeProposals[0]!);
    expect(merged.map((shot) => shot.id)).toEqual(["merge-shot1+shot2", "shot3"]);
    expect(merged[0]!.durationSec).toBe(10);
    expect(merged[0]!.anchorIds).toEqual(["anchor-1"]);
    expect(merged[0]!.sceneAnchorId).toBe("s1");
  });

  it("applySplitProposal：拆成连续镜、首镜保 id、段时长为建议值", () => {
    const shot: PlanShotInput = { id: "long", durationSec: 40, sceneAnchorId: "s1", anchorIds: ["anchor-1"] };
    const { splitProposals } = resolveGenerationPlan({ shots: [shot], candidates: [H3] });
    const pieces = applySplitProposal(shot, splitProposals[0]!);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]!.id).toBe("long");
    expect(pieces[1]!.id).toBe("long-2");
    expect(pieces[2]!.durationSec).toBe(10);
    expect(pieces[0]!.anchorIds).toEqual(["anchor-1"]);
  });
});
