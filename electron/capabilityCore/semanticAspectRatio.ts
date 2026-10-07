// 「Agent 说的比例」→「所选模式的真实参数键」。全仓唯一做这件事的地方。
//
// ── 它在治哪一类真实故障（2026-10-05，`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`）──
//
// 用户说 16:9，付费卡上 Z-Image 是 1:1；说 1:1，Nano Banana 2 是「自动」——都是出厂默认。比例在各家档案里叫
// `size` / `aspect_ratio` / `ratio` / `aspectRatio`，模型面只有一个通用 `parameters`，模型只能猜；它最常猜的驼峰
// `aspectRatio` 又被登记成「Nomi 自己读、永不上线缆」的意图键，编合同时一句 `continue` 吞掉。
//
// 现在比例在模型面有自己的位置（`draft_shots.shots[].aspectRatio`），投影把它放进宿主候选的
// `parameters.aspectRatio`（语义载体键），这里按**这个候选此刻的参数表**把它翻成真实键：
//   · 比例控件 = 选项除自动档外全是比例的那个（判据 `electron/shared/aspectRatioValue.ts`，画布参数面板同用）；
//   · 翻不了（没有比例控件 / 值不在选项里 / 和 parameters 里真实键写的不一样）→ 当场拒，带合法值。
// **不回落默认**：回落默认就是用户付钱拿到一张他没要的画幅——这一族缺陷本身。
import { ASPECT_RATIO_SEMANTIC_KEY, resolveAspectRatioChoice } from "../shared/aspectRatioValue";
import { ContractCompilationError, type PlanCandidate } from "./executionContract";
import type { ParameterField } from "./moduleManifest";

const display = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * 把候选里的语义比例翻成真实键，返回**新候选**（不原地改：候选常来自冻结的持久化对象）。
 * 没写比例 → 原样返回（同一个对象）。`parameterSchema` = 这个候选此刻接受的参数表
 * （`mcpGenerationVideoResolve.acceptedParameterSchema`）；空表 = 这个模型什么参数都没声明，翻不了，拒。
 */
export function projectSemanticAspectRatio(
  candidate: PlanCandidate,
  parameterSchema: Readonly<Record<string, ParameterField>>,
  /**
   * 改草稿时这一镜**原有**的参数：只拿来判「同一档」（像素档同比例多档时留在原来那一档），
   * 不参与「两处写的不一样」的冲突判断——改比例本来就是要换掉原来那个值。
   */
  tierReference: Readonly<Record<string, unknown>> = {},
): PlanCandidate {
  if (!Object.prototype.hasOwnProperty.call(candidate.parameters, ASPECT_RATIO_SEMANTIC_KEY)) return candidate;
  const { [ASPECT_RATIO_SEMANTIC_KEY]: requested, ...rest } = candidate.parameters;
  const path = ASPECT_RATIO_SEMANTIC_KEY;
  const model = `${candidate.providerId}/${candidate.modelId}`;
  const allowedKeys = Object.keys(parameterSchema).sort();
  if (typeof requested !== "string" || !requested.trim()) {
    throw new ContractCompilationError(
      `aspectRatio must be a ratio such as 16:9, or auto; got ${display(requested)}.`,
      { code: "parameter_type_mismatch", path, expectedType: "string", allowedKeys },
    );
  }
  const controls = Object.entries(parameterSchema).map(([key, field]) => ({
    key, options: (field.enum ?? []).map((value) => ({ value })), defaultValue: field.default,
  }));
  // `rest` 里调用方自己写着的真实键是「这一镜当前那一档」：像素档同比例多档时按它挑同档。
  const choice = resolveAspectRatioChoice(requested, controls, { ...tierReference, ...rest });
  if (!choice.ok) {
    if (choice.reason === "several_sizes") {
      throw new ContractCompilationError(
        `${model} offers ${requested.trim()} in several sizes (parameter ${choice.key}): ${choice.candidates.map(display).join(", ")}. `
        + `Nomi cannot tell which size this shot wants; set parameters.${choice.key} to one of them, or ask the user.`,
        { code: "parameter_not_in_enum", path: `parameters.${choice.key}`, allowedValues: choice.candidates.filter(isPrimitive), allowedKeys },
      );
    }
    if (choice.reason === "not_offered") {
      throw new ContractCompilationError(
        `${model} cannot make ${requested.trim()} in this mode. Its ratio choices (parameter ${choice.key}): `
        + `${choice.allowedValues.map(display).join(", ")}. Pick one of them, or ask the user.`,
        { code: "parameter_not_in_enum", path, allowedValues: choice.allowedValues.filter(isPrimitive), allowedKeys },
      );
    }
    if (choice.reason === "ambiguous") {
      throw new ContractCompilationError(
        `${model} declares several ratio parameters (${choice.keys.join(", ")}), so aspectRatio is ambiguous here. `
        + "Leave aspectRatio out and set the one you mean in parameters.",
        { code: "unknown_parameter", path, allowedKeys },
      );
    }
    throw new ContractCompilationError(
      `${model} has no frame-ratio choice in this mode (it may follow the input image, or size the frame in pixels). `
      + `Leave aspectRatio out${allowedKeys.length ? `; if one of its parameters (${allowedKeys.join(", ")}) is what you mean, set that one in parameters` : ""}.`,
      { code: "unknown_parameter", path, allowedKeys },
    );
  }
  // 同一件事写了两处、说法不一样：模型面的 aspectRatio 与 parameters 里那个真实键。替它挑一个就是替用户花钱。
  if (choice.key !== ASPECT_RATIO_SEMANTIC_KEY && Object.prototype.hasOwnProperty.call(rest, choice.key)
    && !Object.is(rest[choice.key], choice.value)) {
    // 没有现成的「冲突」码，所以不挂 rejection（落 `contract_invalid`）；话说清楚比挂一个恢复动作不对的码强。
    throw new ContractCompilationError(
      `A shot names two different ratios: aspectRatio=${requested.trim()} and parameters.${choice.key}=${display(rest[choice.key])}. `
      + `Ratio has one home: keep aspectRatio and drop parameters.${choice.key}.`,
    );
  }
  return { ...candidate, parameters: { ...rest, [choice.key]: choice.value } };
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
