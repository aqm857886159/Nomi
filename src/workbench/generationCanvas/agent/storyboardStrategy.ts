/**
 * Storyboard ↔ Generation Strategy Resolver adapter (pure, renderer-safe).
 *
 * 方案编辑器（StoryboardPlanEditor）与 resolve（Generation Strategy Resolver）之间的纯函数桥：
 *   - `storyboardPlanToPlanShotInputs` 把方案里的视频镜头投影成引擎输入（PlanShotInput）——
 *     引擎只读时长/场景/模型/参数/锚，不含 PlanShot 的 prompt/参考绑定等渲染字段；
 *   - `mergeStoryboardShots` / `splitStoryboardShot` 把引擎给出的合并/拆条**建议**应用到方案
 *     本体（不可变返回新 StoryboardPlan），保留每个镜头的 prompt / referenceBindings / keyframe
 *     等 PlanShot 专有字段，供现有 `setStoryboardPlan` 存储与画布 materialize 复用。
 *
 * 设计约束：
 *  - 纯函数 + type-only import，不拉 i18n / store / React 链（storyboardPlan 运行时较重，只引类型）。
 *  - 采纳仍是「建议式」：合并 prompt 用顺序拼接（join），用户在编辑器里仍可逐行改（方案免费可改）。
 *  - 图片镜头（shotKind === 'image'）不参与视频生成策略：不投影、不被合并/拆条吞掉。
 */
import type { PlanShot, StoryboardPlan } from "./storyboardPlan";
// 运行时 import（不是 type-only）：镜头 id 只能有**一把尺**。这里曾自带一份
// `shot.shotId ?? shot-${index}`，而落画布/行绑定用的是 `stableShotId`（多一道字符白名单）——
// 同一个镜头在「引擎输入 id」与「行绑定 id」上会得出两个值，闸的作用域和行内警示就对不上号（R14.1）。
import { stableShotId } from "./storyboardPlan";
// 同理：镜头**发出去时携带的参数**也只有一把尺（`resolveShotParams` = 行覆盖 ?? 整片默认 ?? 缺席）。
// 这里曾直接铺那一行自己写着的参数，于是策略引擎按"没有画幅"去裁决、落画布却按整片默认发——
// 引擎给的建议与真正发出去的请求是两份东西（2026-09-12 根因合同）。
import { resolveShotParams } from "./storyboardShotScope";
import type {
  MergeProposal,
  PlanIssue,
  PlanShotInput,
  SplitProposal,
} from "../../../../electron/shared/videoCapabilities/planResolver";
import type { GenerationResolvePlanValue } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";

const effectiveVideoShots = (plan: StoryboardPlan): PlanShot[] =>
  plan.shots.filter((shot) => shot.shotKind !== "image");

/** 镜头稳定 id（引擎输入、闸作用域、行内警示三处必须用同一把尺 = `stableShotId`）。 */
export const storyboardShotId = stableShotId;
const shotIdOf = storyboardShotId;

/** 投影成引擎输入：只带引擎能裁决的字段；id 稳定（shotId ?? shot-<index>）。 */
export function storyboardPlanToPlanShotInputs(plan: StoryboardPlan): PlanShotInput[] {
  return effectiveVideoShots(plan).map((shot) => ({
    id: shotIdOf(shot),
    durationSec: shot.durationSec,
    ...(shot.sceneId ? { sceneAnchorId: shot.sceneId } : {}),
    ...(shot.anchorIds.length > 0 ? { anchorIds: [...shot.anchorIds] } : {}),
    ...(shot.modelKey ? { modelKey: shot.modelKey } : {}),
    ...(shot.modeId ? { modeId: shot.modeId } : {}),
    ...(() => {
      const params = resolveShotParams(plan, shot);
      return Object.keys(params).length > 0 ? { params } : {};
    })(),
    ...(shot.ffDesc ? { beatNote: shot.ffDesc } : {}),
  }));
}

/** 合并被采纳的若干镜头为一条（同场相邻、引擎已判可行）。返回新方案，其余镜头与字段原样。 */
export function mergeStoryboardShots(
  plan: StoryboardPlan,
  shotIds: readonly string[],
  opts?: { durationSec?: number; promptJoiner?: string },
): StoryboardPlan {
  const ids = new Set(shotIds);
  if (ids.size < 2) return plan;
  const covered = plan.shots.filter((shot) => ids.has(shotIdOf(shot)));
  if (covered.length !== ids.size) return plan;
  const first = covered[0]!;
  const joiner = opts?.promptJoiner ?? "\n";
  const merged: PlanShot = {
    ...first,
    durationSec: opts?.durationSec ?? covered.reduce((sum, shot) => sum + shot.durationSec, 0),
    prompt: covered.map((shot) => shot.prompt).filter(Boolean).join(joiner),
    anchorIds: Array.from(new Set(covered.flatMap((shot) => shot.anchorIds))),
    ...(covered.some((shot) => shot.referenceBindings)
      ? {
          referenceBindings: mergeBindings(covered),
        }
      : {}),
  };
  const skipped = new Set(shotIds);
  const kept: PlanShot[] = [];
  for (const shot of plan.shots) {
    if (skipped.has(shotIdOf(shot))) {
      if (!kept.some((candidate) => candidate.index === merged.index)) kept.push(merged);
      continue;
    }
    kept.push(shot);
  }
  return renumber(plan, kept);
}

/** 拆条被采纳：把一条超限镜头替换为若干连续镜头（同锚/绑定/模型，仅时长与 id 分化）。 */
export function splitStoryboardShot(plan: StoryboardPlan, shotId: string, pieces: readonly number[]): StoryboardPlan {
  if (pieces.length < 2) return plan;
  const source = plan.shots.find((shot) => shotIdOf(shot) === shotId);
  if (!source) return plan;
  const clones = pieces.map((durationSec, pieceIndex) => ({
    ...source,
    index: 0, // renumber 会重排
    ...(source.shotId && pieceIndex > 0 ? { shotId: `${source.shotId}-${pieceIndex + 1}` } : {}),
    durationSec,
  }));
  const kept: PlanShot[] = [];
  for (const shot of plan.shots) {
    if (shotIdOf(shot) === shotId) kept.push(...clones);
    else kept.push(shot);
  }
  return renumber(plan, kept);
}

/** 按槽合并参考绑定：同一 slot 下按 url 去重保序（同场衔接时两镜各自的首帧/角色图都可能要保留）。 */
function mergeBindings(shots: readonly PlanShot[]): Record<string, NonNullable<PlanShot["referenceBindings"]>[string]> {
  const merged: Record<string, Array<{ url: string; name?: string; sourceNodeId?: string; anchorId?: string; ignore?: string }>> = {};
  for (const shot of shots) {
    for (const [kind, bindings] of Object.entries(shot.referenceBindings ?? {})) {
      const bucket = (merged[kind] ??= []);
      for (const binding of bindings) {
        if (!bucket.some((item) => item.url === binding.url)) bucket.push({ ...binding });
      }
    }
  }
  return merged;
}

/** 保持镜序与 index 连续（1 起）。scenes/anchors/title 原样。 */
function renumber(plan: StoryboardPlan, shots: PlanShot[]): StoryboardPlan {
  return { ...plan, shots: shots.map((shot, offset) => (shot.index === offset + 1 ? shot : { ...shot, index: offset + 1 })) };
}

/**
 * resolve 结果的「审阅视图」分类（纯函数，面板与执行闸共用同一份语义）：
 *   - mergeSuggestions：效率合并（advisory，建议式，不并也合法）；
 *   - requiredMerges：低于下限的「必须合并」（不并 → 原样生成即截断）；
 *   - splits：超上限拆条（不拆 → 原样生成即截断）；
 *   - blockers：其余致命问题（单镜低于下限且无相邻可并 / 无候选模型 / 模型不存在）——无采纳钮，只有提示。
 */
export type ResolveStrategyView = {
  mergeSuggestions: MergeProposal[];
  requiredMerges: MergeProposal[];
  splits: SplitProposal[];
  blockers: PlanIssue[];
};

export function classifyResolveStrategy(value: GenerationResolvePlanValue): ResolveStrategyView {
  const mergeSuggestions: MergeProposal[] = [];
  const requiredMerges: MergeProposal[] = [];
  for (const proposal of value.mergeProposals) {
    (proposal.advisory ? mergeSuggestions : requiredMerges).push(proposal);
  }
  const blockers: PlanIssue[] = [];
  const requiredShotIds = new Set(requiredMerges.flatMap((proposal) => proposal.shotIds));
  const splitShotIds = new Set(value.splitProposals.map((proposal) => proposal.shotId));
  for (const shot of value.resolvedShots) {
    for (const issue of shot.issues) {
      // duration.underflow 且该镜已被 requiredMerges/splits 覆盖时，由对应建议呈现，不重复进 blockers。
      if (issue.code === "duration.underflow" && (requiredShotIds.has(shot.id) || splitShotIds.has(shot.id))) continue;
      if (issue.code === "no.candidates" || issue.code === "model.missing" || issue.code === "duration.underflow") {
        blockers.push(issue);
      }
    }
  }
  return { mergeSuggestions, requiredMerges, splits: value.splitProposals, blockers };
}

/**
 * 把审阅视图收窄到**本次真正要 materialize 的那批镜头**。
 *
 * 为什么必须有它（返工 1）：resolve 永远按整份方案算——合并建议依赖真实相邻关系，只把选中的几镜
 * 喂进引擎会算出错误的分组。但**闸**问的是另一个问题：「我这一次点的这些镜头，原样生成会不会
 * 截断/出不来」。第 7 镜超限不该拦住单点第 3 镜的生成。所以：整份方案照算，闸按本次镜头集合过滤。
 * 传 undefined = 不收窄（整批/面板视图）。
 */
export function scopeResolveStrategy(view: ResolveStrategyView, shotIds?: readonly string[]): ResolveStrategyView {
  if (!shotIds) return view;
  const scope = new Set(shotIds);
  const touches = (ids: readonly string[]): boolean => ids.some((id) => scope.has(id));
  return {
    mergeSuggestions: view.mergeSuggestions.filter((proposal) => touches(proposal.shotIds)),
    requiredMerges: view.requiredMerges.filter((proposal) => touches(proposal.shotIds)),
    splits: view.splits.filter((proposal) => scope.has(proposal.shotId)),
    // shotId 缺失的是方案级问题（如无候选模型）——任何一次生成都撞得上，不因收窄而消失。
    blockers: view.blockers.filter((issue) => !issue.shotId || scope.has(issue.shotId)),
  };
}

/** 一条阻断的结构化身份（人话由显示边界 `strategyText` 渲染 —— 引擎不产文案，R15）。 */
export type ResolveBlocker =
  | { kind: "split"; proposal: SplitProposal }
  | { kind: "merge"; proposal: MergeProposal }
  | { kind: "issue"; issue: PlanIssue };

/** 执行闸判据：本次镜头集合里是否存在「原样生成即截断/无模型」的阻断（效率合并不算）。 */
export function hasResolveBlockers(value: GenerationResolvePlanValue, shotIds?: readonly string[]): boolean {
  return firstResolveBlocker(value, shotIds) !== null;
}

/** 闸 toast 的第一条阻断（给用户先处理哪条）；无阻断返回 null。 */
export function firstResolveBlocker(value: GenerationResolvePlanValue, shotIds?: readonly string[]): ResolveBlocker | null {
  const view = scopeResolveStrategy(classifyResolveStrategy(value), shotIds);
  if (view.splits[0]) return { kind: "split", proposal: view.splits[0] };
  if (view.requiredMerges[0]) return { kind: "merge", proposal: view.requiredMerges[0] };
  if (view.blockers[0]) return { kind: "issue", issue: view.blockers[0] };
  return null;
}

/**
 * 分镜行的行内警示（返工 7 / D1）：超限或低于下限**在表格行上就看得见**，不用点开面板才知道。
 * 只认 duration.overflow / duration.underflow 两条——它们是「原样生成必然出问题」的那两种。
 */
export type ShotDurationWarning = { shotId: string; kind: "overflow" | "underflow"; issue: PlanIssue };

export function shotDurationWarnings(value: GenerationResolvePlanValue): Map<string, ShotDurationWarning> {
  const warnings = new Map<string, ShotDurationWarning>();
  for (const shot of value.resolvedShots) {
    for (const issue of shot.issues) {
      if (issue.code === "duration.overflow") warnings.set(shot.id, { shotId: shot.id, kind: "overflow", issue });
      else if (issue.code === "duration.underflow" && !warnings.has(shot.id)) {
        warnings.set(shot.id, { shotId: shot.id, kind: "underflow", issue });
      }
    }
  }
  return warnings;
}

/** 采纳一条合并建议（advisory 或 required 通用）：时长=建议值、prompt 顺序拼接、锚并集，其余镜头原样。 */
export function applyMergeSuggestion(
  plan: StoryboardPlan,
  proposal: MergeProposal,
): StoryboardPlan {
  return mergeStoryboardShots(plan, proposal.shotIds, { durationSec: proposal.durationSec });
}

/** 采纳一条拆条建议：同锚/绑定/模型，按建议分段替换为若干连续镜头。 */
export function applySplitSuggestion(
  plan: StoryboardPlan,
  proposal: SplitProposal,
): StoryboardPlan {
  return splitStoryboardShot(plan, proposal.shotId, proposal.pieces.map((piece) => piece.durationSec));
}
