// 「Agent 说的时长」在起草那一刻就核：这个模式收不收时长、收哪几档。全仓只在这里核。
//
// ── 它在治哪一类真实故障（铁律 ⑩「说的=摆的」首跑，`docs/plan/2026-10-05-experience-iron-laws-batch1.md`）──
//
// `draft_shots.shots[].durationSec` 由投影放进宿主候选的 `parameters.duration`。以前起草只核模型身份，参数值留到
// 封印那一刻才核，于是中间那一段各说各的：
//   · 海螺 2.3 只收 6 / 10 秒，Agent 说 8 秒：草稿、付费卡、请求都写 8，画布节点按档案回落成 6，没人告诉 Agent；
//   · Veo 3.1 Fast、GPT Image 2 没有时长参数，Agent 说了时长：草稿记着，节点和卡都看不到，请求也不带——意图被悄悄丢掉。
// 现在起草那一刻就按**这个候选此刻接受的参数表**（`mcpGenerationVideoResolve.acceptedParameterSchema`，与准入层同一份）核：
//   · 这个模式没有时长参数 → 拒，告诉 Agent 去掉时长；
//   · 有档位、不在档里 / 有范围、出了范围 → 拒，带合法值；
//   · 合法 → 落到参数表里那个键上（数值类型与档位一致），之后草稿、节点、卡、派发读到的是同一个值。
// **不回落、不钳值**：回落就是用户付钱拿到一段他没要的时长。和比例那一道（`semanticAspectRatio.ts`）同一个形状。
import { ContractCompilationError, type PlanCandidate } from "./executionContract";
import type { ParameterField } from "./moduleManifest";

/** 候选里承载时长的键：投影写 `duration`，旧的拟稿路径可能写 `durationSeconds`。参数表里叫哪个就落到哪个。 */
const DURATION_KEYS = ["duration", "durationSeconds"] as const;

export type DraftParameterAdjustment = Readonly<{
  shotId?: string;
  field: "durationSec";
  requested: number;
  applied: number;
  allowed?: readonly number[];
  min?: number;
  max?: number;
  reason: string;
}>;

const own = (record: Readonly<Record<string, unknown>>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const seconds = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * 核候选里的时长，并在落入枚举外或越界但可确定性吸附到最近合法档时返回 `adjustment`：
 *   · 这个模式根本没有时长参数（静帧或固定时长模型）→ 照旧拒，叫 Agent 去掉 durationSec；
 *   · 不是正的秒数 → 照旧拒；
 *   · 离散枚举档：精确命中原样落；未命中则确定性吸附到距离最近的合法档（等距取更短档，不替用户往贵处凑），
 *     草稿、画布节点、付费卡三处落同一个合法值，并随结果返回 `adjustments` 让 Agent 诚实告知用户；
 *   · 连续/整数范围档：超出 `[min, max]` 时确定性钳制到最近合法边界并返回 `adjustments`。
 */
export function admitAuthoredDurationWithAdjustment(
  candidate: PlanCandidate,
  parameterSchema: Readonly<Record<string, ParameterField>>,
): { candidate: PlanCandidate; adjustment?: DraftParameterAdjustment } {
  const writtenKey = DURATION_KEYS.find((key) => own(candidate.parameters, key));
  if (!writtenKey) return { candidate };
  const allowedKeys = Object.keys(parameterSchema).sort();
  if (allowedKeys.length === 0) return { candidate };
  const model = `${candidate.providerId}/${candidate.modelId}`;
  const requested = candidate.parameters[writtenKey];
  const value = seconds(requested);
  if (value === null) {
    throw new ContractCompilationError(
      `时长要写成正的秒数（durationSec），收到的是 ${JSON.stringify(requested)}。`,
      { code: "parameter_type_mismatch", path: "durationSec", expectedType: "number", allowedKeys },
    );
  }
  const fieldKey = DURATION_KEYS.find((key) => parameterSchema[key] !== undefined);
  if (!fieldKey) {
    throw new ContractCompilationError(
      `${model} 这个模式没有时长参数，片子多长由模型自己定。请去掉 durationSec；如果用户一定要这个时长，换一个能设时长的模型，或者先问用户。`,
      { code: "unknown_parameter", path: "durationSec", allowedKeys },
      { code: "duration_not_in_mode", field: "durationSec", model, value },
    );
  }
  const field = parameterSchema[fieldKey]!;
  const { [writtenKey]: _written, ...rest } = candidate.parameters;
  if (field.enum && field.enum.length > 0) {
    const matched = field.enum.find((option) => seconds(option) === value);
    if (matched !== undefined) {
      return { candidate: { ...candidate, parameters: { ...rest, [fieldKey]: matched } } };
    }
    const numericOptions = field.enum
      .map((raw) => ({ raw, sec: seconds(raw) }))
      .filter((entry): entry is { raw: string | number | boolean; sec: number } => entry.sec !== null);
    if (numericOptions.length === 0) {
      const allowed = field.enum.map((option) => String(option));
      throw new ContractCompilationError(
        `${model} 只支持 ${allowed.join(" / ")} 秒，收到 ${value} 秒。`,
        { code: "parameter_not_in_enum", path: "durationSec", allowedValues: [...field.enum], allowedKeys },
        { code: "duration_not_in_mode", field: "durationSec", model, value, allowed },
      );
    }
    const nearest = numericOptions.reduce((best, current) => {
      const currentDiff = Math.abs(current.sec - value);
      const bestDiff = Math.abs(best.sec - value);
      if (currentDiff < bestDiff) return current;
      if (currentDiff === bestDiff && current.sec < best.sec) return current;
      return best;
    });
    const allowedNums = numericOptions.map((item) => item.sec);
    return {
      candidate: { ...candidate, parameters: { ...rest, [fieldKey]: nearest.raw } },
      adjustment: {
        field: "durationSec",
        requested: value,
        applied: nearest.sec,
        allowed: allowedNums,
        reason: `${model} supports ${allowedNums.join("/")}s; snapped requested ${value}s to nearest valid ${nearest.sec}s. Tell the user the clip duration was adjusted to ${nearest.sec}s.`,
      },
    };
  }
  let applied = value;
  if (field.min !== undefined && applied < field.min) applied = field.min;
  if (field.max !== undefined && applied > field.max) applied = field.max;
  if (field.type === "integer" && !Number.isInteger(applied)) {
    applied = Math.round(applied);
    if (field.min !== undefined && applied < field.min) applied = field.min;
    if (field.max !== undefined && applied > field.max) applied = field.max;
  }
  const storedValue = field.type === "string" ? String(applied) : applied;
  if (applied !== value) {
    const rangeLabel = `${field.min ?? 1}–${field.max ?? "∞"}s`;
    return {
      candidate: { ...candidate, parameters: { ...rest, [fieldKey]: storedValue } },
      adjustment: {
        field: "durationSec",
        requested: value,
        applied,
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        reason: `${model} supports ${rangeLabel}; snapped requested ${value}s to nearest valid ${applied}s. Tell the user the clip duration was adjusted to ${applied}s.`,
      },
    };
  }
  return { candidate: { ...candidate, parameters: { ...rest, [fieldKey]: storedValue } } };
}

export function admitAuthoredDuration(
  candidate: PlanCandidate,
  parameterSchema: Readonly<Record<string, ParameterField>>,
): PlanCandidate {
  return admitAuthoredDurationWithAdjustment(candidate, parameterSchema).candidate;
}
