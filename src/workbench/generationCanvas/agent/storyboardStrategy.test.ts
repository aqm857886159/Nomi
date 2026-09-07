import { describe, expect, it } from "vitest";
import type { PlanShot, StoryboardPlan } from "./storyboardPlan";
import type { GenerationResolvePlanValue } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";
import {
  applyMergeSuggestion,
  applySplitSuggestion,
  classifyResolveStrategy,
  firstResolveBlockerMessage,
  hasResolveBlockers,
  mergeStoryboardShots,
  splitStoryboardShot,
  storyboardPlanToPlanShotInputs,
} from "./storyboardStrategy";

const shot = (partial: Partial<PlanShot> & { index: number; durationSec: number; prompt: string; anchorIds?: string[] }): PlanShot => ({
  shotKind: "video",
  sceneId: "scene-1",
  ...{ anchorIds: [] },
  ...partial,
} as PlanShot);

const plan = (shots: PlanShot[]): StoryboardPlan => ({
  title: "t",
  anchors: [],
  shots,
  scenes: [{ id: "scene-1", title: "雨夜巷口" }],
});

describe("storyboardStrategy · 投影到引擎输入", () => {
  it("只投影视频镜头（跳过 image），字段按引擎契约，id 稳定", () => {
    const inputs = storyboardPlanToPlanShotInputs(plan([
      shot({ index: 1, shotId: "s1", durationSec: 6, prompt: "a", anchorIds: ["anchor-1"], modelKey: "minimax-h3", modeId: "ref", params: { duration: 6 }, sceneId: "scene-1" }),
      shot({ index: 2, shotKind: "image", durationSec: 0, prompt: "still", anchorIds: [] }),
      shot({ index: 3, durationSec: 4, prompt: "b" }), // 无 shotId → 派生
    ]));
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ id: "s1", durationSec: 6, sceneAnchorId: "scene-1", modelKey: "minimax-h3", modeId: "ref", anchorIds: ["anchor-1"] });
    expect(inputs[0]!.params).toEqual({ duration: 6 });
    expect(inputs[1]).toMatchObject({ id: "shot-3", durationSec: 4 });
  });
});

describe("storyboardStrategy · 合并采纳", () => {
  it("覆盖镜头替换为一条（位序保持、时长求和、锚并集、prompt 顺序拼接、index 重排、参考绑定去重保序）", () => {
    const original = plan([
      shot({ index: 1, shotId: "s1", durationSec: 6, prompt: "A", anchorIds: ["a1"], sceneId: "scene-1" }),
      shot({ index: 2, shotId: "s2", durationSec: 4, prompt: "B", anchorIds: ["a1", "a2"], sceneId: "scene-1" }),
      shot({ index: 3, shotId: "s3", durationSec: 8, prompt: "C", sceneId: "scene-2" }),
    ]);
    const merged = mergeStoryboardShots(original, ["s1", "s2"]);
    expect(merged.shots).toHaveLength(2);
    expect(merged.shots[0]!.shotId).toBe("s1");
    expect(merged.shots[0]!.durationSec).toBe(10);
    expect(merged.shots[0]!.anchorIds).toEqual(["a1", "a2"]);
    expect(merged.shots[0]!.prompt).toBe("A\nB");
    expect(merged.shots[0]!.index).toBe(1);
    expect(merged.shots[1]).toMatchObject({ shotId: "s3", durationSec: 8, index: 2, prompt: "C" });
  });

  it("覆盖集不完整/少于两条时原样返回", () => {
    const original = plan([shot({ index: 1, shotId: "s1", durationSec: 6, prompt: "A" })]);
    expect(mergeStoryboardShots(original, ["s1", "missing"])).toBe(original);
    expect(mergeStoryboardShots(original, ["s1"])).toBe(original);
  });
});

describe("storyboardStrategy · 拆条采纳", () => {
  it("把一条超限镜拆成连续 N 镜：同锚/绑定/模型，时长按段、id 分化、index 重排", () => {
    const original = plan([
      shot({ index: 1, shotId: "s1", durationSec: 40, prompt: "长镜", anchorIds: ["a1"], modelKey: "minimax-h3" }),
      shot({ index: 2, shotId: "s2", durationSec: 4, prompt: "B" }),
    ]);
    const split = splitStoryboardShot(original, "s1", [15, 15, 10]);
    expect(split.shots).toHaveLength(4);
    expect(split.shots[0]).toMatchObject({ shotId: "s1", durationSec: 15, prompt: "长镜", anchorIds: ["a1"], modelKey: "minimax-h3" });
    expect(split.shots[1]).toMatchObject({ shotId: "s1-2", durationSec: 15 });
    expect(split.shots[2]).toMatchObject({ shotId: "s1-3", durationSec: 10 });
    expect(split.shots.map((item) => item.index)).toEqual([1, 2, 3, 4]);
  });

  it("段数 <2 或找不到源镜头时原样返回", () => {
    const original = plan([shot({ index: 1, shotId: "s1", durationSec: 40, prompt: "长镜" })]);
    expect(splitStoryboardShot(original, "s1", [15])).toBe(original);
    expect(splitStoryboardShot(original, "nope", [15, 15, 10])).toBe(original);
  });
});

/** 造一份 resolve 载荷夹具（形状按 seam resolve 分支输出；构造素材全来自真实引擎语义）。 */
const resolveValue = (partial?: Partial<GenerationResolvePlanValue>): GenerationResolvePlanValue => ({
  resolvedShots: [
    {
      id: "s1",
      modelKey: "doubao-seedance-2.5",
      modeId: "text",
      modeLabel: "文生视频",
      durationMin: 5,
      durationMax: 15,
      params: {},
      issues: [],
    },
    {
      id: "s2",
      modelKey: "doubao-seedance-2.5",
      modeId: "text",
      modeLabel: "文生视频",
      durationMin: 5,
      durationMax: 15,
      params: {},
      issues: [],
    },
    {
      id: "s3",
      modelKey: "doubao-seedance-2.5",
      modeId: "text",
      modeLabel: "文生视频",
      durationMin: 5,
      durationMax: 15,
      params: {},
      issues: [],
    },
  ],
  mergeProposals: [],
  splitProposals: [],
  planIssues: [],
  ...partial,
});

describe("storyboardStrategy · resolve 审阅分类与执行闸（classify / gate）", () => {
  it("advisory 效率合并不算阻断；required 合并（低于下限）与拆条算阻断", () => {
    const advisoryOnly = resolveValue({
      mergeProposals: [{
        id: "merge-s1+s2", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "doubao-seedance-2.5",
        modeId: "text", modeLabel: "文生视频", advisory: true, reason: "效率合并",
      }],
    });
    expect(classifyResolveStrategy(advisoryOnly).mergeSuggestions).toHaveLength(1);
    expect(hasResolveBlockers(advisoryOnly)).toBe(false);

    const required = resolveValue({
      mergeProposals: [{
        id: "merge-s1+s2", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "doubao-seedance-2.5",
        modeId: "text", modeLabel: "文生视频", advisory: false, reason: "低于下限需并入邻镜",
      }],
    });
    expect(hasResolveBlockers(required)).toBe(true);
    expect(classifyResolveStrategy(required).requiredMerges[0]!.reason).toBe("低于下限需并入邻镜");

    const split = resolveValue({
      splitProposals: [{
        shotId: "s3", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
        suggestFirstLast: true, reason: "超上限拆 15+15+10",
      }],
    });
    expect(hasResolveBlockers(split)).toBe(true);
    expect(classifyResolveStrategy(split).splits[0]!.pieces).toHaveLength(3);
  });

  it("无候选/模型缺失/孤立低于下限（无合并建议覆盖）→ blockers；被 required/split 覆盖的 underflow 不重复", () => {
    const underflowCovered = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: null, modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {},
          issues: [{ code: "duration.underflow", shotId: "s1", message: "低于下限" }],
        },
      ],
      mergeProposals: [{
        id: "merge-s1+s2", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "x", modeId: "text",
        modeLabel: "文生视频", advisory: false, reason: "must",
      }],
    });
    expect(classifyResolveStrategy(underflowCovered).blockers).toHaveLength(0);

    const standaloneUnderflow = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {},
          issues: [{ code: "duration.underflow", shotId: "s1", message: "低于下限且无相邻可并" }],
        },
      ],
    });
    expect(classifyResolveStrategy(standaloneUnderflow).blockers.map((issue) => issue.code)).toEqual(["duration.underflow"]);

    const missingModel = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: "ghost", modeId: "text", modeLabel: "文生视频", durationMin: null, durationMax: null,
          params: {},
          issues: [{ code: "model.missing", shotId: "s1", message: "模型不存在" }],
        },
      ],
    });
    expect(classifyResolveStrategy(missingModel).blockers[0]!.code).toBe("model.missing");
  });

  it("firstResolveBlockerMessage 取拆分/必须合并/blocker 中的第一条人话理由", () => {
    const value = resolveValue({
      splitProposals: [{
        shotId: "s3", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
        suggestFirstLast: true, reason: "s3 超上限拆 15+15+10",
      }],
    });
    expect(firstResolveBlockerMessage(value)).toBe("s3 超上限拆 15+15+10");
    expect(firstResolveBlockerMessage(resolveValue())).toBeNull();
  });
});

describe("storyboardStrategy · 建议采纳包装（applyMerge/applySplit → 新方案）", () => {
  it("applyMergeSuggestion 走 mergeStoryboardShots 且时长用引擎建议值", () => {
    const original = plan([
      shot({ index: 1, shotId: "s1", durationSec: 6, prompt: "A" }),
      shot({ index: 2, shotId: "s2", durationSec: 4, prompt: "B" }),
    ]);
    const next = applyMergeSuggestion(original, {
      id: "m", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "k", modeId: "t", modeLabel: "L", advisory: true, reason: "r",
    });
    expect(next.shots).toHaveLength(1);
    expect(next.shots[0]!.durationSec).toBe(10);
    expect(next.shots[0]!.prompt).toBe("A\nB");
  });

  it("applySplitSuggestion 走 splitStoryboardShot 按段替换", () => {
    const original = plan([shot({ index: 1, shotId: "s1", durationSec: 40, prompt: "长镜" })]);
    const next = applySplitSuggestion(original, {
      shotId: "s1", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
      suggestFirstLast: true, reason: "r",
    });
    expect(next.shots.map((item) => item.durationSec)).toEqual([15, 15, 10]);
  });
});
