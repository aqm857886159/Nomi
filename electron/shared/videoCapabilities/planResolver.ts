/**
 * Plan-level generation strategy resolver (pure).
 *
 * 把「分镜方案（逻辑镜头）→ 生成执行结构」这一步做成确定性、可解释、可测试的机器决策，
 * 让 LLM 只负责叙事（拆镜、prompt、演时估算），模型/模式/参数上限与合并/拆条/时长分配
 * 由这里基于真实档案数值裁决——LLM 不再需要背诵参数，也就不存在编造参数键。
 *
 * 设计约定（2026-09-06 docs/plan/2026-09-06-generation-strategy-resolver.md）：
 *  - 纯函数：不 import Electron/React/文件系统，与 recommendation.ts 同层，renderer/headless 共用。
 *  - 不新建第二份事实：时长上下限、参数枚举全部读自 ModelArchetype.modes[].params。
 *  - 本模块产出「建议」（mergeProposals/splitProposals/校验 issues），是否采纳由上层（GUI 审阅/
 *    Agent）决定 —— 对齐「方案免费可改、执行才花钱」的产品哲学。
 *  - 语义拍段的真实性（两镜是否同场连续、切点在哪）属于叙事判断，由调用方通过 sceneAnchorId /
 *    durationSec / beatNote 提供；本引擎只做物理约束下的结构决策。
 *
 * 不产出（v1 明确不做，见设计文档 §5 P3）：原生音频三态、比例/分辨率档位映射之外的参数风格化、
 * 成本/总时长预算约束。不做的事不假装做了。
 */
import type { ArchetypeMode, ModelParameterControl } from "./types";
import type { VideoModelCandidate } from "./recommendation";
import { effectiveVideoModes } from "./recommendation";

/** 逻辑镜头输入（调用方 = storyboard planner / GUI；durationSec 建议用演时换算的真实表演秒）。 */
export type PlanShotInput = {
  id: string;
  /** 语义表演时长（秒）。可为小数，落参数时按模式约束取整/钳值。 */
  durationSec: number;
  /** 同场锚：相邻同值才允许并入同一条生成（场景连续性由叙事侧标）。 */
  sceneAnchorId?: string;
  /** 引用的锚（角色/场景/道具/style id 集），合并时取并集，供上层拼 prompt 与参考图绑定。 */
  anchorIds?: string[];
  /** 期望模型（catalog modelKey）。留空 → 系统默认候选。 */
  modelKey?: string;
  /** 期望模式 id（档案 modeId）。留空/非法 → 档案默认模式 + issue。 */
  modeId?: string;
  /** 期望参数（仅档案真实键会被保留；未知键丢弃并记 issue）。 */
  params?: Record<string, unknown>;
  /** 叙事备注（如「开口前铺垫」「说话中」），透传给拆条建议供上层组织切点。 */
  beatNote?: string;
};

export type PlanShotOutput = PlanShotInput & {
  resolved: boolean;
  candidate: { provider: string; modelKey: string; label: string } | null;
  modeId: string;
  modeLabel: string;
  durationMin: number | null;
  durationMax: number | null;
  params: Record<string, string | number | boolean>;
  issues: PlanIssue[];
};

export type PlanIssue = {
  code:
    | "no.candidates"
    | "model.missing"
    | "mode.fallback"
    | "param.unknown"
    | "param.clamped"
    | "param.value"
    | "duration.clamped"
    | "duration.underflow"
    | "duration.overflow";
  shotId?: string;
  message: string;
};

export type MergeProposal = {
  id: string;
  shotIds: string[];
  durationSec: number;
  modelKey: string;
  modeId: string;
  modeLabel: string;
  /** true = 短拍效率合并（产品规则）；false = 镜头低于模式下限的必须合并。 */
  advisory: boolean;
  reason: string;
};

export type SplitProposal = {
  shotId: string;
  durationSec: number;
  pieces: { durationSec: number }[];
  /** 拆条承接是否建议同锚复用 + 首尾帧衔接（叙事侧确认）。 */
  suggestFirstLast: boolean;
  reason: string;
};

export type GenerationResolutionInput = {
  shots: PlanShotInput[];
  candidates: readonly VideoModelCandidate[];
  /** 默认候选 modelKey（shots 未显式选模型时用它；缺省取 candidates[0]）。 */
  defaultModelKey?: string;
  goals?: {
    /** 是否允许「短拍效率合并」（相邻同场、每镜 ≤ 单条上限一半、合计 ≤ 上限）。默认 true。 */
    allowAdvisoryMerge?: boolean;
  };
};

export type GenerationResolutionResult = {
  shots: PlanShotOutput[];
  mergeProposals: MergeProposal[];
  splitProposals: SplitProposal[];
  issues: PlanIssue[];
};

/** 短拍效率合并的比例阈值：单镜 ≤ 单条上限一半视为「短拍」，同场相邻可并入一条。 */
const MERGE_SHORT_FRACTION = 0.5;

const numericOptionValues = (control: ModelParameterControl): number[] =>
  control.options.map((option) => option.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

/** 从模式参数里读出 duration 的合法范围（档案数值是唯一真相源；读不到 = 该模式无时长参数）。 */
function modeDurationRange(mode: ArchetypeMode): { min: number; max: number; enum?: number[] } | null {
  const control = mode.params.find((item) => item.key === "duration");
  if (!control) return null;
  const options = numericOptionValues(control);
  if (options.length > 0) {
    return { min: Math.min(...options), max: Math.max(...options), enum: options };
  }
  if (typeof control.min === "number" && typeof control.max === "number") {
    return { min: control.min, max: control.max };
  }
  return null;
}

const nearestEnumValue = (wanted: number, values: number[]): number =>
  values.reduce((nearest, value) => (Math.abs(value - wanted) < Math.abs(nearest - wanted) ? value : nearest), values[0]!);

/** 把想要的时长钳进模式的合法集合：枚举取最近合法值，区间取 clamp。返回钳后的整数值与是否被改动。 */
function clampToDurationRange(wanted: number, range: NonNullable<ReturnType<typeof modeDurationRange>>): { value: number; changed: boolean } {
  const raw = Number.isFinite(wanted) ? wanted : range.min;
  const rounded = Math.round(raw);
  const value = range.enum ? nearestEnumValue(raw, range.enum) : Math.min(range.max, Math.max(range.min, rounded));
  return { value, changed: Math.abs(value - raw) > 1e-9 };
}

function findCandidate(candidates: readonly VideoModelCandidate[], modelKey?: string): VideoModelCandidate | undefined {
  if (!modelKey) return undefined;
  return candidates.find((candidate) => candidate.modelKey === modelKey.trim() || candidate.modelKey.endsWith(`/${modelKey.trim()}`));
}

/** 校验 + 铺参数的单镜解析：拒绝/钳值一切不合法的东西，产出可行参数与逐条 issue。 */
function resolveShot(shot: PlanShotInput, candidates: readonly VideoModelCandidate[], defaultModelKey?: string): PlanShotOutput {
  const issues: PlanIssue[] = [];
  const output: PlanShotOutput = {
    ...shot,
    resolved: false,
    candidate: null,
    modeId: "",
    modeLabel: "",
    durationMin: null,
    durationMax: null,
    params: {},
    issues,
  };

  if (candidates.length === 0) {
    issues.push({ code: "no.candidates", shotId: shot.id, message: "没有可用视频模型候选，无法为镜头定模式与参数" });
    return output;
  }
  const firstCandidate = candidates[0]!;

  const candidate = findCandidate(candidates, shot.modelKey) ?? findCandidate(candidates, defaultModelKey) ?? firstCandidate;
  if (shot.modelKey && candidate.modelKey !== shot.modelKey && !candidate.modelKey.endsWith(`/${shot.modelKey.trim()}`)) {
    issues.push({ code: "model.missing", shotId: shot.id, message: `清单里没有模型「${shot.modelKey}」，已用默认模型 ${candidate.label} 兜底` });
  }
  output.candidate = { provider: candidate.provider, modelKey: candidate.modelKey, label: candidate.label };

  const modes = effectiveVideoModes(candidate);
  const fallbackMode = modes.find((mode) => mode.id === candidate.archetype.defaultModeId) ?? modes[0];
  const requestedMode = shot.modeId ? modes.find((mode) => mode.id === shot.modeId) : undefined;
  const mode = requestedMode ?? fallbackMode;
  if (shot.modeId && !requestedMode) {
    issues.push({ code: "mode.fallback", shotId: shot.id, message: `模型 ${candidate.label} 没有模式「${shot.modeId}」，已回退到默认模式「${mode?.vendorTerm ?? mode?.id}」` });
  }
  if (!mode) {
    issues.push({ code: "mode.fallback", shotId: shot.id, message: `模型 ${candidate.label} 没有可用模式` });
    return output;
  }
  output.modeId = mode.id;
  output.modeLabel = mode.vendorTerm || mode.id;

  const range = modeDurationRange(mode);
  output.durationMin = range?.min ?? null;
  output.durationMax = range?.max ?? null;

  // 参数：只保留档案真实键；未知键丢弃；select 越界回默认；number 越界钳值。
  const params: Record<string, string | number | boolean> = {};
  for (const [key, rawValue] of Object.entries(shot.params ?? {})) {
    const control = mode.params.find((item) => item.key === key);
    if (!control) {
      issues.push({ code: "param.unknown", shotId: shot.id, message: `模式「${output.modeLabel}」没有参数「${key}」，已丢弃（取值必须来自模型清单）` });
      continue;
    }
    if (control.type === "select" && control.options.length > 0 && !control.options.some((option) => option.value === rawValue)) {
      issues.push({
        code: "param.value",
        shotId: shot.id,
        message: `参数「${key}」的值 ${String(rawValue)} 不在 ${control.options.map((option) => String(option.value)).join(" / ")} 内，已回默认`,
      });
      if (control.defaultValue !== undefined) params[key] = control.defaultValue;
      continue;
    }
    if ((control.type === "number" || control.type === "select") && typeof rawValue === "number") {
      let value = rawValue;
      if (control.type === "number" && key !== "duration") {
        const min = typeof control.min === "number" ? control.min : Number.NEGATIVE_INFINITY;
        const max = typeof control.max === "number" ? control.max : Number.POSITIVE_INFINITY;
        const clamped = Math.min(max, Math.max(min, rawValue));
        if (clamped !== rawValue) issues.push({ code: "param.clamped", shotId: shot.id, message: `参数「${key}」${rawValue} 超出 ${min}–${max}，已钳到 ${clamped}` });
        value = clamped;
      }
      params[key] = value;
      continue;
    }
    if (typeof rawValue === "boolean" || typeof rawValue === "string") {
      params[key] = rawValue;
    }
  }

  // duration：由模式的合法集合裁决（覆盖用户填的任意值）。
  if (!range) {
    issues.push({ code: "param.unknown", shotId: shot.id, message: `模式「${output.modeLabel}」没有 duration 参数，时长不写入请求` });
  } else {
    const clamped = clampToDurationRange(shot.durationSec, range);
    params.duration = clamped.value;
    const roundedDesired = Math.round(shot.durationSec);
    if (clamped.changed) {
      issues.push({ code: "duration.clamped", shotId: shot.id, message: `目标时长 ${shot.durationSec}s 已按模式范围 ${range.min}–${range.max}s 调整为 ${clamped.value}s` });
    }
    if (roundedDesired < range.min) {
      issues.push({
        code: "duration.underflow",
        shotId: shot.id,
        message: `镜头 ${shot.id} 只有 ${shot.durationSec}s，低于 ${candidate.label}「${output.modeLabel}」下限 ${range.min}s——建议并入同场邻镜或补足（≥${range.min}s）再生成`,
      });
    }
    if (roundedDesired > range.max) {
      issues.push({
        code: "duration.overflow",
        shotId: shot.id,
        message: `镜头 ${shot.id} 需要 ${shot.durationSec}s，超过 ${candidate.label}「${output.modeLabel}」单条上限 ${range.max}s——单条参数已钳到 ${range.max}s；完整覆盖请采纳拆条建议（${Math.ceil(shot.durationSec / range.max)} 条 + 段间首尾帧承接）`,
      });
    }
  }

  output.params = params;
  output.resolved = true;
  return output;
}

/** 相邻同场（sceneAnchorId 相同）+ 同模型同模式的一组镜头，才可能并入一次生成。 */
function sameBucket(left: PlanShotOutput, right: PlanShotOutput): boolean {
  if (!left.candidate || !right.candidate) return false;
  if (left.candidate.modelKey !== right.candidate.modelKey || left.modeId !== right.modeId) return false;
  return (left.sceneAnchorId ?? "none") === (right.sceneAnchorId ?? "none");
}

/** 拆条：贪心让每一段落在 [min, max]，最后一段也尽量 ≥ min。 */
function splitPieces(total: number, min: number, max: number): number[] {
  const pieces: number[] = [];
  let remaining = total;
  while (remaining > max) {
    const take = Math.max(min, Math.min(max, remaining - min));
    pieces.push(take);
    remaining -= take;
  }
  if (remaining > 0) pieces.push(remaining);
  return pieces;
}

export function resolveGenerationPlan(input: GenerationResolutionInput): GenerationResolutionResult {
  const resolved = input.shots.map((shot) => resolveShot(shot, input.candidates, input.defaultModelKey));
  const issues = resolved.flatMap((shot) => shot.issues);
  const mergeProposals: MergeProposal[] = [];
  const splitProposals: SplitProposal[] = [];
  const allowAdvisory = input.goals?.allowAdvisoryMerge !== false;

  // 拆条建议（先于合并，独立于合并存在：超上限的镜头先被拆，不参与合并）。
  for (const shot of resolved) {
    if (!shot.candidate || shot.durationMax === null || shot.durationMin === null) continue;
    if (shot.durationSec <= shot.durationMax) continue;
    const pieces = splitPieces(shot.durationSec, shot.durationMin, shot.durationMax);
    if (pieces.length < 2) continue;
    splitProposals.push({
      shotId: shot.id,
      durationSec: shot.durationSec,
      pieces: pieces.map((durationSec) => ({ durationSec })),
      suggestFirstLast: true,
      reason: `${shot.id} 的 ${shot.durationSec}s 超出 ${shot.candidate.label}「${shot.modeLabel}」单条上限 ${shot.durationMax}s，拆成 ${pieces.length} 条（${pieces.join("+")}s）；同锚复用 + 段间首尾帧承接，避免截断`,
    });
  }

  // 合并建议：贪心相邻同场分组。分组条件 = 同候选/同模式 + 同场 + 上一条加入后仍 ≤ 上限；
  // 「必须合并」= 组内有低于下限的镜头（否则无法生成）；「效率合并」= 每镜 ≤ 上限一半的短拍。
  let index = 0;
  while (index < resolved.length) {
    const first = resolved[index]!;
    if (!first.candidate || first.durationMin === null || first.durationMax === null) {
      index += 1;
      continue;
    }
    const group: PlanShotOutput[] = [first];
    let sum = first.durationSec;
    let nextIndex = index + 1;
    const mustMerge = first.durationSec < first.durationMin;
    while (nextIndex < resolved.length) {
      const next = resolved[nextIndex]!;
      if (!sameBucket(first, next) || next.durationMax === null) break;
      const nextUnderflow = next.durationSec < next.durationMin!;
      const stillUnderflow = sum < (first.durationMin ?? Number.POSITIVE_INFINITY) || nextUnderflow;
      const hasScene = Boolean(first.sceneAnchorId && first.sceneAnchorId.trim());
      const stillAdvisoryShort = hasScene && sum <= first.durationMax * MERGE_SHORT_FRACTION && next.durationSec <= next.durationMax! * MERGE_SHORT_FRACTION;
      if (sum + next.durationSec > first.durationMax) break;
      if (!mustMerge && !stillUnderflow && !(allowAdvisory && stillAdvisoryShort)) break;
      group.push(next);
      sum += next.durationSec;
      nextIndex += 1;
    }
    if (group.length >= 2) {
      const hasUnderflow = group.some((shot) => shot.durationSec < (shot.durationMin ?? Number.POSITIVE_INFINITY));
      const advisory = !hasUnderflow;
      const modelLabel = first.candidate.label;
      const cappedSum = first.durationMax !== null ? Math.min(sum, first.durationMax) : sum;
      const modeRange = first.durationMax !== null && first.durationMin !== null
        ? `${first.durationMin}–${first.durationMax}s`
        : "?";
      mergeProposals.push({
        id: `merge-${group.map((shot) => shot.id).join("+")}`,
        shotIds: group.map((shot) => shot.id),
        durationSec: cappedSum,
        modelKey: first.candidate.modelKey,
        modeId: first.modeId,
        modeLabel: first.modeLabel,
        advisory,
        reason: advisory
          ? `${group.map((shot) => `${shot.id}(${shot.durationSec}s)`).join(" + ")} 合计 ${sum}s ≤ ${modelLabel}「${first.modeLabel}」单条上限，同场同模型——并入一次生成（${modeRange}），减少抽卡次数、动作与光线更连续`
          : `${group.map((shot) => `${shot.id}(${shot.durationSec}s)`).join(" + ")} 合计 ${cappedSum}s：组内有镜头低于 ${modelLabel}「${first.modeLabel}」下限，需并入邻镜补足（${modeRange}）后才能生成`,
      });
    }
    index = group.length >= 2 ? nextIndex : index + 1;
  }

  return { shots: resolved, mergeProposals, splitProposals, issues };
}

/** 采纳一条合并建议：把覆盖的镜头原位替换为一条合并镜头（时长=建议值，锚取并集，模型/模式沿用组首，保持镜序）。 */
export function applyMergeProposal(shots: readonly PlanShotInput[], proposal: MergeProposal): PlanShotInput[] {
  const covered = new Set(proposal.shotIds);
  const merged = shots.filter((shot) => covered.has(shot.id));
  if (merged.length === 0) return [...shots];
  const first = merged[0]!;
  const params = { ...(first.params ?? {}) };
  delete params.duration;
  const head: PlanShotInput = {
    ...first,
    id: proposal.id,
    durationSec: proposal.durationSec,
    anchorIds: Array.from(new Set(merged.flatMap((shot) => shot.anchorIds ?? []))),
    sceneAnchorId: merged.every((shot) => shot.sceneAnchorId === first.sceneAnchorId) ? first.sceneAnchorId : undefined,
    params,
    beatNote: merged.map((shot) => shot.beatNote ?? shot.id).join(" → "),
  };
  const result: PlanShotInput[] = [];
  let inserted = false;
  for (const shot of shots) {
    if (!covered.has(shot.id)) {
      result.push(shot);
      continue;
    }
    if (!inserted) {
      result.push(head);
      inserted = true;
    }
  }
  return result;
}

/** 采纳一条拆条建议：把超限镜头拆成若干连续镜头（同锚复用，时长=各段建议值）。 */
export function applySplitProposal(shot: PlanShotInput, proposal: SplitProposal): PlanShotInput[] {
  if (proposal.pieces.length < 2) return [shot];
  return proposal.pieces.map((piece, pieceIndex) => ({
    ...shot,
    id: pieceIndex === 0 ? shot.id : `${shot.id}-${pieceIndex + 1}`,
    durationSec: piece.durationSec,
    beatNote: pieceIndex === 0 ? shot.beatNote : `${shot.id} 承接段 ${pieceIndex + 1}${shot.beatNote ? `（${shot.beatNote}）` : ""}`,
  }));
}
