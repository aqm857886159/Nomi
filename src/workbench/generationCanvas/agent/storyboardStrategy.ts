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
import type {
  MergeProposal,
  PlanIssue,
  PlanShotInput,
  SplitProposal,
} from "../../../../electron/shared/videoCapabilities/planResolver";
import type { GenerationResolvePlanValue } from "../../../../electron/shared/videoCapabilities/planResolutionContracts";

const effectiveVideoShots = (plan: StoryboardPlan): PlanShot[] =>
  plan.shots.filter((shot) => shot.shotKind !== "image");

const shotIdOf = (shot: PlanShot): string => shot.shotId ?? `shot-${shot.index}`;

/** 投影成引擎输入：只带引擎能裁决的字段；id 稳定（shotId ?? shot-<index>）。 */
export function storyboardPlanToPlanShotInputs(plan: StoryboardPlan): PlanShotInput[] {
  return effectiveVideoShots(plan).map((shot) => ({
    id: shotIdOf(shot),
    durationSec: shot.durationSec,
    ...(shot.sceneId ? { sceneAnchorId: shot.sceneId } : {}),
    ...(shot.anchorIds.length > 0 ? { anchorIds: [...shot.anchorIds] } : {}),
    ...(shot.modelKey ? { modelKey: shot.modelKey } : {}),
    ...(shot.modeId ? { modeId: shot.modeId } : {}),
    ...(shot.params ? { params: { ...shot.params } } : {}),
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

/** 执行闸判据：是否存在「原样生成即截断/无模型」的阻断（效率合并不算）。 */
export function hasResolveBlockers(value: GenerationResolvePlanValue): boolean {
  const view = classifyResolveStrategy(value);
  return view.requiredMerges.length > 0 || view.splits.length > 0 || view.blockers.length > 0;
}

/** 闸 toast 的第一条人话阻断理由（给用户先处理哪条）；无阻断返回 null。 */
export function firstResolveBlockerMessage(value: GenerationResolvePlanValue): string | null {
  const view = classifyResolveStrategy(value);
  return view.splits[0]?.reason ?? view.requiredMerges[0]?.reason ?? view.blockers[0]?.message ?? null;
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
