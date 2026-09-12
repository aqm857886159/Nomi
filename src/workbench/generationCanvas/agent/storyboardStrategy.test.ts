import { describe, expect, it } from "vitest";
import type { PlanShot, StoryboardPlan } from "./storyboardPlan";
import type { GenerationResolvePlanValue } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";
import {
  applyMergeSuggestion,
  applySplitSuggestion,
  classifyResolveStrategy,
  firstResolveBlocker,
  shotDurationWarnings,
  hasResolveBlockers,
  mergeStoryboardShots,
  splitStoryboardShot,
  storyboardPlanToPlanShotInputs,
} from "./storyboardStrategy";

/** 引擎理由所需的结构化数值（句子在显示边界成形，夹具只交数据）。 */
const MERGE_FACTS = { shotDurations: [6, 4], totalSec: 10, modelLabel: "Seedance 2.5", durationMin: 5, durationMax: 15 };
const SPLIT_FACTS = { modelLabel: "Seedance 2.5", modeLabel: "文生视频", durationMax: 15 };

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
        modeId: "text", modeLabel: "文生视频", advisory: true, ...MERGE_FACTS,
      }],
    });
    expect(classifyResolveStrategy(advisoryOnly).mergeSuggestions).toHaveLength(1);
    expect(hasResolveBlockers(advisoryOnly)).toBe(false);

    const required = resolveValue({
      mergeProposals: [{
        id: "merge-s1+s2", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "doubao-seedance-2.5",
        modeId: "text", modeLabel: "文生视频", advisory: false, ...MERGE_FACTS,
      }],
    });
    expect(hasResolveBlockers(required)).toBe(true);
    expect(classifyResolveStrategy(required).requiredMerges[0]!.advisory).toBe(false);

    const split = resolveValue({
      splitProposals: [{
        shotId: "s3", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
        suggestFirstLast: true, ...SPLIT_FACTS,
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
          issues: [{ code: "duration.underflow", shotId: "s1", params: {} }],
        },
      ],
      mergeProposals: [{
        id: "merge-s1+s2", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "x", modeId: "text",
        modeLabel: "文生视频", advisory: false, ...MERGE_FACTS,
      }],
    });
    expect(classifyResolveStrategy(underflowCovered).blockers).toHaveLength(0);

    const standaloneUnderflow = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {},
          issues: [{ code: "duration.underflow", shotId: "s1", params: {} }],
        },
      ],
    });
    expect(classifyResolveStrategy(standaloneUnderflow).blockers.map((issue) => issue.code)).toEqual(["duration.underflow"]);

    const missingModel = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: "ghost", modeId: "text", modeLabel: "文生视频", durationMin: null, durationMax: null,
          params: {},
          issues: [{ code: "model.missing", shotId: "s1", params: {} }],
        },
      ],
    });
    expect(classifyResolveStrategy(missingModel).blockers[0]!.code).toBe("model.missing");
  });

  it("firstResolveBlocker 交结构化身份（拆分/必须合并/blocker），不再交一句现成中文", () => {
    const value = resolveValue({
      splitProposals: [{
        shotId: "s3", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
        suggestFirstLast: true, ...SPLIT_FACTS,
      }],
    });
    expect(firstResolveBlocker(value)).toMatchObject({ kind: "split", proposal: { shotId: "s3" } });
    expect(firstResolveBlocker(resolveValue())).toBeNull();
  });

  it("闸作用域收窄到本次镜头集合：别的镜头超限拦不住这一镜（返工 1）", () => {
    const value = resolveValue({
      splitProposals: [{
        shotId: "s3", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
        suggestFirstLast: true, ...SPLIT_FACTS,
      }],
      resolvedShots: [{
        id: "s1", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
        params: {}, issues: [],
      }],
    });
    // 整批：拦
    expect(hasResolveBlockers(value)).toBe(true);
    // 只生成 s1：s3 的拆条与它无关 → 放行
    expect(hasResolveBlockers(value, ["s1"])).toBe(false);
    // 只生成 s3：拦
    expect(hasResolveBlockers(value, ["s3"])).toBe(true);
  });

  it("方案级问题（无 shotId，如没有可用模型）任何作用域都拦得住", () => {
    const value = resolveValue({
      resolvedShots: [{
        id: "s1", modelKey: null, modeId: "", modeLabel: "", durationMin: null, durationMax: null,
        params: {}, issues: [{ code: "no.candidates", params: {} }],
      }],
    });
    expect(hasResolveBlockers(value, ["s9"])).toBe(true);
  });

  it("行内警示按镜索引 overflow/underflow（返工 7 的数据源）", () => {
    const value = resolveValue({
      resolvedShots: [
        {
          id: "s1", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {}, issues: [{ code: "duration.overflow", shotId: "s1", params: { max: 15 } }],
        },
        {
          id: "s2", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {}, issues: [{ code: "duration.underflow", shotId: "s2", params: { min: 5 } }],
        },
        {
          id: "s3", modelKey: "m", modeId: "text", modeLabel: "文生视频", durationMin: 5, durationMax: 15,
          params: {}, issues: [],
        },
      ],
    });
    const warnings = shotDurationWarnings(value);
    expect(warnings.get("s1")!.kind).toBe("overflow");
    expect(warnings.get("s2")!.kind).toBe("underflow");
    expect(warnings.has("s3")).toBe(false);
  });
});

describe("storyboardStrategy · 建议采纳包装（applyMerge/applySplit → 新方案）", () => {
  it("applyMergeSuggestion 走 mergeStoryboardShots 且时长用引擎建议值", () => {
    const original = plan([
      shot({ index: 1, shotId: "s1", durationSec: 6, prompt: "A" }),
      shot({ index: 2, shotId: "s2", durationSec: 4, prompt: "B" }),
    ]);
    const next = applyMergeSuggestion(original, {
      id: "m", shotIds: ["s1", "s2"], durationSec: 10, modelKey: "k", modeId: "t", modeLabel: "L", advisory: true, ...MERGE_FACTS,
    });
    expect(next.shots).toHaveLength(1);
    expect(next.shots[0]!.durationSec).toBe(10);
    expect(next.shots[0]!.prompt).toBe("A\nB");
  });

  it("applySplitSuggestion 走 splitStoryboardShot 按段替换", () => {
    const original = plan([shot({ index: 1, shotId: "s1", durationSec: 40, prompt: "长镜" })]);
    const next = applySplitSuggestion(original, {
      shotId: "s1", durationSec: 40, pieces: [{ durationSec: 15 }, { durationSec: 15 }, { durationSec: 10 }],
      suggestFirstLast: true, ...SPLIT_FACTS,
    });
    expect(next.shots.map((item) => item.durationSec)).toEqual([15, 15, 10]);
  });
});

describe("storyboardStrategy · 整片默认也要进引擎输入", () => {
  // 策略引擎（planResolver）按 params 判 param.unknown / param.value 并给出建议。它读到的参数
  // 必须与真正发出去的一致——否则引擎按"没有画幅"裁决、落画布却按整片默认发，建议与请求是两份东西。
  it("继承整片默认的镜头，引擎输入里带上整片画幅", () => {
    const source: StoryboardPlan = { ...plan([shot({ index: 1, durationSec: 6, prompt: "镜一" })]), aspectRatio: "9:16" };
    expect(storyboardPlanToPlanShotInputs(source)[0]?.params).toEqual({ aspect_ratio: "9:16" });
  });

  it("行覆盖赢整片默认", () => {
    const source: StoryboardPlan = {
      ...plan([shot({ index: 1, durationSec: 6, prompt: "镜一", params: { aspect_ratio: "16:9" } })]),
      aspectRatio: "9:16",
    };
    expect(storyboardPlanToPlanShotInputs(source)[0]?.params).toEqual({ aspect_ratio: "16:9" });
  });

  it("整片默认未定且该镜没参数 → 不带 params 字段（保持既有契约形状）", () => {
    expect(storyboardPlanToPlanShotInputs(plan([shot({ index: 1, durationSec: 6, prompt: "镜一" })]))[0]?.params).toBeUndefined();
  });
});
