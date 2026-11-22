/**
 * 参数值的内部类型——**唯一的家**（设计卡 docs/plan/2026-11-17-param-value-type.md）。
 *
 * 一个参数值只在门口规整一次，门里只用这一份，发给供应商时再按它声明的写法编回去：
 *   · 声明门 `normalizeDeclaredControls`：档案进门（`modelArchetypes/entry.ts`）时，选项全是规范数字串的下拉
 *     （RunningHub / Agnes / Kling 3.0 的时长 `"5"`、topaz 放大倍数 `"2"`）换成数字档，记住报文写法；
 *   · 值门 `admitParamValue`：外来的值（节点存盘、助手、外部助手、面板输入）进门时，按控件要不要数字规整；
 *   · 出口 `encodeParamsForWire`：发送前（`electron/catalog/taskParams.ts`，两套引擎共用那一处）按声明编回报文写法。
 *
 * 门里任何地方再自己 `Number(...)` / `typeof … === "number"` / 字符串化比较参数值，都是第二个解析器——
 * ESLint 规则 `nomi/param-value-door`（判据在 `scripts/param-value-door-rule.mjs`）拦。
 *
 * 只认「规范数字串」：转成数字再转回来一字不差（`"12"`、`"2.5"`）。`"05"`、`"5s"`、`" 5"`、`""` 都不算，原样交给
 * 各自的政策（取最近 / 拒收并说明），**不当 0、不当默认**。解析交给 Zod，这里只写这条判据。
 *
 * 纯函数，无 Electron / React / 文件系统依赖：渲染层与主进程共用。
 */
import { z } from "zod";
import type { ModelParameterControl, ModelParameterControlOption } from "./types";

type Scalar = string | number | boolean;

/** 规范数字串：有限数，且 `String(Number(s)) === s`。 */
export function isCanonicalNumericString(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && String(parsed) === value;
}

/** 有限数（类型守卫；门里判「这个值是不是数字」都走它，不各写一份 typeof）。 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const numericDoor = z.union([
  z.number().finite(),
  z.string().refine(isCanonicalNumericString).transform(Number),
]);

/** 值门的数字分支：有限数原样、规范数字串转成数字；认不出 → undefined（不当 0、不当默认）。 */
export function admitNumber(raw: unknown): number | undefined {
  const parsed = numericDoor.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** 声明（档案控件或准入字段）里看「要不要数字」所需的那几项。 */
type NumericDeclaration = Readonly<{ type: string; options?: readonly { value: unknown }[] }>;

/** 这个声明要的是数字：数字控件 / 准入的 number、integer 字段，或选项全是数字的下拉。 */
export function expectsNumber(declaration: NumericDeclaration): boolean {
  if (declaration.type === "number" || declaration.type === "integer") return true;
  const options = declaration.options ?? [];
  return declaration.type === "select" && options.length > 0 && options.every((option) => isFiniteNumber(option.value));
}

/**
 * 没过声明门的数字串下拉：目录行自己带的控件（不认档案的通用模型，按接入文档原样展示）选项是 `"5"` 这种写法，
 * 门里没有它的数字档，值就按它声明的写法收。
 */
function expectsNumericString(declaration: NumericDeclaration): boolean {
  const options = declaration.options ?? [];
  return declaration.type === "select" && options.length > 0 && options.every((option) => isCanonicalNumericString(option.value));
}

/**
 * 值门：外来的值按声明规整成声明的那一种类型。要数字的声明 → 有限数原样、规范数字串转数字；没过声明门的数字串下拉 →
 * 有限数写成它的字符串；混型下拉（用户目录 / ComfyUI 的 `[5, "auto", 10]`）→ 数值相同的那一档就是它（`"5"` 落 5、5 落 `"5"`）；
 * 其余一律原样返回（文字档、布尔、认不出的值都交给调用方现有的政策）。可以重复跑。
 */
export function admitParamValue(declaration: NumericDeclaration, raw: unknown): unknown {
  if (expectsNumber(declaration)) return admitNumber(raw) ?? raw;
  if (expectsNumericString(declaration) && isFiniteNumber(raw)) return String(raw);
  const wanted = declaration.type === "select" ? admitNumber(raw) : undefined;
  if (wanted === undefined) return raw;
  const options = declaration.options ?? [];
  if (options.some((option) => Object.is(option.value, raw))) return raw;
  const same = options.find((option) => admitNumber(option.value) === wanted);
  return same ? same.value : raw;
}

/** 控件档位里的数字档（声明门之后，数字档就是数字；文字档不算档位）。 */
export function declaredNumericOptions(control: Pick<ModelParameterControl, "options">): number[] {
  return control.options.map((option) => option.value).filter(isFiniteNumber);
}

/** 时长这一族键（视频档案全叫 `duration`；`durationSeconds` 是旧目录配置绑定的键）。读的顺序就是这个顺序。 */
const SECONDS_KEYS = ["duration", "durationSeconds"] as const;

/**
 * 从参数袋里读出秒数的**唯一取值函数**（节点 meta、候选 parameters、分镜 params 都用它）：`duration` 优先、
 * 其次 `durationSeconds`，经值门；读不出 → undefined。正负、是否大于 0 是调用方各自的语义，这里不判。
 */
export function paramSeconds(bag: Readonly<Record<string, unknown>> | null | undefined): number | undefined {
  if (!bag) return undefined;
  for (const key of SECONDS_KEYS) {
    const seconds = admitNumber(bag[key]);
    if (seconds !== undefined) return seconds;
  }
  return undefined;
}

// ── 声明门 ──

/** 报文写法：声明门把规范数字串档换成数字时记下，出口按它编回去。没有 = 报文就是内部类型本身。 */
export type ParamWireEncoding = "numeric-string";

function hasOnlyCanonicalNumericStrings(options: readonly ModelParameterControlOption[]): boolean {
  return options.length > 0 && options.every((option) => isCanonicalNumericString(option.value));
}

function numericValue(value: Scalar): Scalar {
  return isCanonicalNumericString(value) ? Number(value) : value;
}

/**
 * 声明门：选项全是规范数字串的下拉 → 选项值、默认值换成数字，记 `wireEncoding: "numeric-string"`；引用这些键的
 * `optionConstraints`（自己的 `values`、别的控件的 `when.value`）一并换。文字、混型、非规范写法一律不动。
 * 幂等；什么都没换时返回同一个数组（档案缓存与渲染层靠引用相等省重算）。
 */
export function normalizeDeclaredControls(controls: readonly ModelParameterControl[]): readonly ModelParameterControl[] {
  const numericKeys = new Set(controls
    .filter((control) => control.type === "select" && hasOnlyCanonicalNumericStrings(control.options))
    .map((control) => control.key));
  if (numericKeys.size === 0) return controls;
  return controls.map((control) => {
    const own = numericKeys.has(control.key);
    const constraints = control.optionConstraints?.map((rule) => ({
      when: "key" in rule.when && numericKeys.has(rule.when.key) ? { ...rule.when, value: numericValue(rule.when.value) } : rule.when,
      values: own ? rule.values.map(numericValue) : rule.values,
    }));
    const touchesConstraint = control.optionConstraints?.some((rule) => "key" in rule.when && numericKeys.has(rule.when.key)) ?? false;
    if (!own && !touchesConstraint) return control;
    return {
      ...control,
      ...(own ? {
        options: control.options.map((option) => ({ ...option, value: numericValue(option.value) })),
        ...(control.defaultValue === undefined ? {} : { defaultValue: numericValue(control.defaultValue) }),
        wireEncoding: "numeric-string" as const,
      } : {}),
      ...(constraints ? { optionConstraints: constraints } : {}),
    };
  });
}

// ── 出口 ──

/** 一个键在一组方式里的声明：同一个键各方式要的数字 / 报文写法一致才有答案，不一致 → null（原样放行）。 */
function consistentDeclaration(declarations: readonly ModelParameterControl[]): ModelParameterControl | null {
  const [first, ...rest] = declarations;
  if (!first) return null;
  const shape = (control: ModelParameterControl) => `${expectsNumber(control)}|${control.wireEncoding ?? ""}`;
  return rest.every((control) => shape(control) === shape(first)) ? first : null;
}

/**
 * 出口编码：每个已声明的键先过值门，再按声明的报文写法编（`numeric-string` → `String(n)`）。
 * `declarations` 是同一个键在这次请求可能落到的方式里的全部声明（方式已知就是这一个方式的控件）。
 * 可以重复跑；不认识的键、认不出的值原样放行。
 */
export function encodeParamsForWire(
  declarations: readonly ModelParameterControl[],
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!params) return params;
  const byKey = new Map<string, ModelParameterControl[]>();
  for (const control of declarations) byKey.set(control.key, [...(byKey.get(control.key) ?? []), control]);
  let next = params;
  for (const [key, controls] of byKey) {
    if (!(key in params)) continue;
    const declaration = consistentDeclaration(controls);
    if (!declaration) continue;
    const admitted = admitParamValue(declaration, params[key]);
    const wire = declaration.wireEncoding === "numeric-string" && isFiniteNumber(admitted) ? String(admitted) : admitted;
    if (Object.is(wire, params[key])) continue;
    if (next === params) next = { ...params };
    next[key] = wire;
  }
  return next;
}

// ── 界面输入门 ──

/** 面板上选中的那一项（显示串）→ 它**声明的**值（数字档回数字、文字档回文字、ComfyUI 开关回布尔）；没匹配上原样返回。 */
export function declaredOptionValue(values: readonly Scalar[], selected: string): Scalar {
  return values.find((value) => String(value) === selected) ?? selected;
}

/**
 * 面板上的字符串 → 按控件声明的值（界面原始输入的门：画布面板、节点底栏、分镜行都走这一处）。
 * 数字控件：空 → null，规范数字串之外的数字写法也按 `Number` 读（输入框里打的 `5.0`），读不成 → null。
 */
export function parseControlInput(control: ModelParameterControl, value: string): Scalar | null {
  if (control.type === "boolean") return value === "true";
  if (control.type === "number") {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (control.type === "select") return declaredOptionValue(control.options.map((option) => option.value), value);
  return value;
}
