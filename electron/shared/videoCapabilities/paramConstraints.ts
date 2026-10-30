/**
 * Single owner: "what does a model archetype allow for this parameter?"
 *
 * 这份文件是**参数合法性与时长范围的唯一语义 owner**（R14.1 / P1）。在它之前，同一个问题
 * 在仓库里有三个互不认识的答案：
 *   - `recommendation.ts` 有 `numericOptions` / `nearestNumber` 与 duration 的 min-max clamp；
 *   - `planResolver.ts` 又抄了一份 `numericOptionValues` / `nearestEnumValue` / `clampToDurationRange`；
 *   - `src/workbench/generationCanvas/agent/plannedNodeMeta.ts` 的 `isValidParamValue` 用
 *     `String(option.value) === String(value)` 判枚举，而 planResolver 用严格 `===`——
 *     于是 `{"duration": "5"}` 这一个输入在两条路径上得到两个不同的答案（一条静默回落默认、
 *     一条报 `param.value`）。
 *
 * 现在的分工（写清楚谁是 owner，见 `docs/plan/2026-09-07-generation-strategy-resolver.md`）：
 *   - **合法性判定**（值在不在允许集合内、范围内）只有这里一份 → `isParamValueAllowed`；
 *   - **不合法之后怎么办**是各调用方的策略，故意不同、各自注释：
 *       · `plannedNodeMeta` 丢弃并回落档案默认（落节点时不能把非法值写进持久化 meta）；
 *       · `planResolver` 钳值并产出结构化 issue（审阅面要告诉用户「被改成了什么、为什么」）。
 *
 * 纯函数，无 Electron / React / i18n / 文件系统依赖：renderer 与主进程共用同一份判据。
 */
import type { ArchetypeMode, ModelParameterControl } from "./types";

/** The bare semantic role and the scalar namespace defined by the workflow importer. */
export function isDurationControl(control: Pick<ModelParameterControl, "key">): boolean {
  return control.key === "duration" || control.key === "comfy_duration";
}

export function durationControlOf(controls: readonly ModelParameterControl[]): ModelParameterControl | undefined {
  const matches = controls.filter(isDurationControl);
  if (matches.length > 1) throw new Error("generation_duration_ambiguous");
  return matches[0];
}

/** Preserve unrelated parameters; never choose between contradictory explicit values. */
export function placeDurationParameters(parameters: Readonly<Record<string, unknown>>, controls: readonly ModelParameterControl[]): Record<string, unknown> {
  const result = { ...parameters };
  if (parameters.duration === undefined) return result;
  const control = durationControlOf(controls);
  if (!control || control.key === "duration") return result;
  const explicit = parameters[control.key];
  if (explicit !== undefined && String(explicit) !== String(parameters.duration)) throw new Error("generation_duration_conflict");
  result[control.key] = parameters.duration;
  delete result.duration;
  return result;
}

/** A changed shot duration invalidates its old duration override, not its other parameters. */
export function withoutDurationParameters(parameters: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).filter(([key]) => !isDurationControl({ key })));
}

/** 控件枚举里的**数值**档位（非数值/非有限值不算档位）。 */
export function numericOptionValues(control: ModelParameterControl): number[] {
  return control.options
    .map((option) => option.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

/** 在一组档位里取离 `wanted` 最近的那个（档位非空时才有意义）。 */
export function nearestNumber(wanted: number, values: readonly number[]): number {
  return values.reduce((nearest, value) => (Math.abs(value - wanted) < Math.abs(nearest - wanted) ? value : nearest), values[0]!);
}

/** 一个参数的合法取值范围：枚举档位（`enum` 非空）或连续区间。 */
export type ParamRange = { min: number; max: number; enum?: number[] };

/** 读出某个数值参数的合法范围。读不到（无此参数 / 既无档位也无 min-max）= null。 */
export function numericRangeOf(control: ModelParameterControl | undefined): ParamRange | null {
  if (!control) return null;
  const options = numericOptionValues(control);
  if (options.length > 0) return { min: Math.min(...options), max: Math.max(...options), enum: options };
  if (typeof control.min === "number" && typeof control.max === "number") return { min: control.min, max: control.max };
  return null;
}

/** 模式的 duration 合法范围（档案数值是唯一真相源；模式没有 duration 参数 = null）。 */
export function modeDurationRange(mode: ArchetypeMode): ParamRange | null {
  return numericRangeOf(durationControlOf(mode.params));
}

/** 把想要的数值钳进合法集合：枚举取最近档，区间取四舍五入后 clamp。 */
export function clampToRange(wanted: number, range: ParamRange): { value: number; changed: boolean } {
  const raw = Number.isFinite(wanted) ? wanted : range.min;
  const rounded = Math.round(raw);
  const value = range.enum ? nearestNumber(raw, range.enum) : Math.min(range.max, Math.max(range.min, rounded));
  return { value, changed: Math.abs(value - raw) > 1e-9 };
}

/**
 * 唯一的「这个值合法吗」判据。
 *
 * 枚举比较**按字符串形**（`String(option.value) === String(value)`）是刻意的：参数从 agent 的
 * JSON、从 IPC 信封、从持久化 meta 三条路进来，同一档位可能是 `5` 也可能是 `"5"`。严格 `===`
 * 会把同一个合法档位在其中一条路上判成非法——这正是两份实现行为分叉的那处。
 */
export function isParamValueAllowed(control: ModelParameterControl, value: string | number | boolean): boolean {
  if (control.options.length > 0) return control.options.some((option) => String(option.value) === String(value));
  if (control.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (control.min !== undefined && value < control.min) return false;
    if (control.max !== undefined && value > control.max) return false;
    return true;
  }
  if (control.type === "boolean") return typeof value === "boolean";
  return true;
}
