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

const own = (record: Readonly<Record<string, unknown>>, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
const seconds = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * 核候选里的时长，返回**新候选**（不原地改：候选常来自冻结的持久化对象）。没写时长 → 原样返回同一个对象。
 * `parameterSchema` = 这个候选此刻接受的参数表；空表 = 这个模型一个参数都没声明，证不出错，原样放行（与准入层同一条：判不了就不拒）。
 */
export function admitAuthoredDuration(
  candidate: PlanCandidate,
  parameterSchema: Readonly<Record<string, ParameterField>>,
): PlanCandidate {
  const writtenKey = DURATION_KEYS.find((key) => own(candidate.parameters, key));
  if (!writtenKey) return candidate;
  const allowedKeys = Object.keys(parameterSchema).sort();
  if (allowedKeys.length === 0) return candidate;
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
    );
  }
  const field = parameterSchema[fieldKey]!;
  const { [writtenKey]: _written, ...rest } = candidate.parameters;
  if (field.enum && field.enum.length > 0) {
    const matched = field.enum.find((option) => seconds(option) === value);
    if (matched === undefined) {
      const allowed = field.enum.map((option) => String(option));
      throw new ContractCompilationError(
        `${model} 只支持 ${allowed.join(" / ")} 秒，收到 ${value} 秒。请从这几档里选一个写进 durationSec，或者先问用户要哪一档。`,
        { code: "parameter_not_in_enum", path: "durationSec", allowedValues: [...field.enum], allowedKeys },
      );
    }
    return { ...candidate, parameters: { ...rest, [fieldKey]: matched } };
  }
  if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
    throw new ContractCompilationError(
      `${model} 的时长只能在 ${field.min ?? "不限"}～${field.max ?? "不限"} 秒之间，收到 ${value} 秒。请改成这个范围里的秒数，或者先问用户。`,
      {
        code: "parameter_out_of_range", path: "durationSec",
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        allowedKeys,
      },
    );
  }
  return { ...candidate, parameters: { ...rest, [fieldKey]: field.type === "string" ? String(value) : value } };
}
