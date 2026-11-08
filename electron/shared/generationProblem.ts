/**
 * 生成入参被拒时的**闭合原因**（2026-11-08，`docs/plan/2026-11-08-generation-request-chain.md` S1）。
 *
 * ── 它在治哪一类真实故障 ──
 *
 * 用户原话（11-08）：「很多时候我们参数不合法什么的，没有最后有一个错误码，或者说分析码以及下一步该怎么办」。
 * 在这之前，起草被拒只有一个粗码 `generation_input_invalid` 加一句散文：面板对所有这类拒收说同一句
 * 「这个模型不接受这组参数」；模型读的散文里，「点名的 id 不存在」和「真没配默认模型」是**同一句**
 * 「没有配置可用的图片模型」——39 题轨迹里 9 次模型因此去劝用户「先去设置选默认模型」，而它点名的模型只是拼错了。
 * 原因是**抛出的那一刻**才知道的事实，事后从散文里猜是猜不准的；所以码在抛出时定，一路带到面板和遥测。
 *
 * ── 形状 ──
 *
 * 成员语义借 RFC 9457（Problem Details）：`code` ≈ `type`（闭合、机读），`field` 指向出错的那一格，
 * `allowed` / `nearest` / `min` / `max` 是扩展成员里的事实，`detail` ≈ RFC 9457 的 `detail`（这一次的具体说明）。
 * 不走 HTTP 媒体类型——这里没有 HTTP。`next` 是**我们自己的**闭合动作词表：同一个码在不同事实下下一步不同
 * （`unknown_model` 有最近的就换成它，没有就去 list_models 里挑）。
 *
 * 本文件**一个运行时依赖都没有**：渲染层要 import 码表和读回函数，理由与 `laneToolFailureEnvelope.ts` 逐字相同（#614 白屏）。
 */

/**
 * 闭合码表。加码 = 改这里 + 面板 zh / en 各一句 + 模型正文一句。后两处都是穷尽 `switch`
 * （`laneToolFailureText.problemSentence`、下面的 `generationProblemModelText`）：漏写一句类型检查就红；遥测自动认得。
 */
export const GENERATION_PROBLEM_CODE_LIST = [
  /** 调用里点了名的模型在目录里不存在。带 `nearest`（目录里最接近的那一个）。 */
  "unknown_model",
  /** 没点名，也没有可用的默认模型。带 `media`（缺的是图片还是视频的默认）。 */
  "no_default_model",
  /** 这个模型没有要的这种模式。带 `allowed`（它有的模式）。 */
  "mode_not_in_model",
  /** 这个模式出不了要的比例。带 `allowed`；没有 `allowed` = 这个模式根本没有比例可选。 */
  "ratio_not_in_mode",
  /** 时长不在这个模式的档里。带 `min` / `max` 或 `allowed`；都没有 = 这个模式不收时长。 */
  "duration_not_in_mode",
  /** 参考素材超过这个模式的上限。带 `max`。 */
  "reference_over_capacity",
  /** 这个模式不接这种参考用途。带 `allowed`。 */
  "reference_role_not_in_mode",
  /** 其它入参值不允许（字段级问题见失败信封的 `issues`）。 */
  "parameter_not_allowed",
] as const;

export type GenerationProblemCode = (typeof GENERATION_PROBLEM_CODE_LIST)[number];

const CODES: ReadonlySet<string> = new Set(GENERATION_PROBLEM_CODE_LIST);

export function isGenerationProblemCode(value: unknown): value is GenerationProblemCode {
  return typeof value === "string" && CODES.has(value);
}

/** 下一步的闭合动作词表（我们自己的，不是 RFC 的）。模型那句 `Next:` 和面板的指路都按它出。 */
export const GENERATION_PROBLEM_NEXT_LIST = [
  "use_nearest_model",
  "pick_from_list_models",
  "set_default_model",
  "use_allowed_value",
  "drop_field",
  "reduce_references",
  "fix_field",
] as const;

export type GenerationProblemNext = (typeof GENERATION_PROBLEM_NEXT_LIST)[number];

const NEXTS: ReadonlySet<string> = new Set(GENERATION_PROBLEM_NEXT_LIST);

/** 公开那一份：进失败信封、过 IPC、到渲染层与遥测。**绝不含收到的值**（用户文稿正文可能在参数里）。 */
export interface GenerationProblem {
  readonly code: GenerationProblemCode;
  /** 出错那一格的契约路径（`candidate.modelId`、`aspectRatio`、`durationSec`、`references`……）。 */
  readonly field?: string;
  /** 合法值（模式 id / 比例 / 时长档 / 参考用途）。 */
  readonly allowed?: readonly string[];
  /** 目录里最接近的那一个（`provider/model`），只在真的接近时才有。 */
  readonly nearest?: string;
  readonly min?: number;
  readonly max?: number;
  /** `no_default_model`：缺的是哪一类默认。 */
  readonly media?: "image" | "video";
  readonly next?: GenerationProblemNext;
  /** 改了再调一次能不能成（起草期的拒收都能）。 */
  readonly retryable: boolean;
  /** 这一次有没有花钱（起草期的拒收一律没有）。 */
  readonly charged: boolean;
}

/** 只给模型读的事实：点名的模型、收到的值、这一次的具体说明。**不进公开信封。** */
export interface GenerationProblemModelFacts {
  /** 调用里写的模型（`provider/model`，照它写的原样）。 */
  readonly model?: string;
  /** 调用里要的值（比例、时长、模式 id）。 */
  readonly value?: string | number;
  /** RFC 9457 `detail`：这一次的具体说明。只有 `parameter_not_allowed` 收——其余七个码的正文由事实生成。 */
  readonly detail?: string;
}

type Facts = Omit<GenerationProblem, "code" | "retryable" | "charged" | "next">;

/**
 * 构造器的入参：每个码各自能带什么，**类型上**说死。`detail`（散文）只有 `parameter_not_allowed` 收——
 * 其余七个码写不进散文，正文只能由事实生成，于是「原因」不会再被一句手写的话盖掉。
 */
export type GenerationProblemInput =
  | ({ code: "unknown_model" } & Pick<Facts, "field" | "nearest"> & Pick<GenerationProblemModelFacts, "model">)
  | ({ code: "no_default_model" } & Required<Pick<Facts, "media">> & Pick<Facts, "field">)
  | ({ code: "mode_not_in_model" } & Pick<Facts, "field" | "allowed"> & Pick<GenerationProblemModelFacts, "model" | "value">)
  | ({ code: "ratio_not_in_mode" } & Pick<Facts, "field" | "allowed"> & Pick<GenerationProblemModelFacts, "model" | "value">)
  | ({ code: "duration_not_in_mode" } & Pick<Facts, "field" | "allowed" | "min" | "max"> & Pick<GenerationProblemModelFacts, "model" | "value">)
  | ({ code: "reference_over_capacity" } & Required<Pick<Facts, "max">> & Pick<Facts, "field"> & Pick<GenerationProblemModelFacts, "model" | "value">)
  | ({ code: "reference_role_not_in_mode" } & Pick<Facts, "field" | "allowed"> & Pick<GenerationProblemModelFacts, "model" | "value">)
  | ({ code: "parameter_not_allowed" } & Pick<Facts, "field" | "allowed"> & Required<Pick<GenerationProblemModelFacts, "detail">>);

/** 按码与事实定下一步。同一个码，事实不同，下一步不同。 */
function nextFor(input: GenerationProblemInput): GenerationProblemNext {
  switch (input.code) {
    case "unknown_model": return input.nearest ? "use_nearest_model" : "pick_from_list_models";
    case "no_default_model": return "set_default_model";
    case "mode_not_in_model": return input.allowed?.length ? "use_allowed_value" : "pick_from_list_models";
    case "ratio_not_in_mode": return input.allowed?.length ? "use_allowed_value" : "drop_field";
    case "duration_not_in_mode":
      return input.allowed?.length || input.min !== undefined || input.max !== undefined ? "use_allowed_value" : "drop_field";
    case "reference_over_capacity": return "reduce_references";
    case "reference_role_not_in_mode": return "use_allowed_value";
    case "parameter_not_allowed": return "fix_field";
  }
}

/** 公开那一份：只留事实，丢掉收到的值与散文。起草期的拒收一律可重试、没花钱。 */
export function generationProblemFrom(input: GenerationProblemInput): GenerationProblem {
  const facts = input as Partial<GenerationProblem>;
  return {
    code: input.code,
    ...(facts.field ? { field: facts.field } : {}),
    ...(facts.allowed?.length ? { allowed: [...facts.allowed] } : {}),
    ...(facts.nearest ? { nearest: facts.nearest } : {}),
    ...(facts.min !== undefined ? { min: facts.min } : {}),
    ...(facts.max !== undefined ? { max: facts.max } : {}),
    ...(facts.media ? { media: facts.media } : {}),
    next: nextFor(input),
    retryable: true,
    charged: false,
  };
}

const list = (values: readonly string[] | undefined): string => (values ?? []).join(", ");

/**
 * 给**模型**读的英文正文：由码与事实生成，不由抛出点手写（`parameter_not_allowed` 例外：它的 `detail` 就是正文）。
 * 每句都说清「是什么不行 · 合法的是什么 · 该怎么改」，并且绝不把「点名的 id 不存在」说成「没配置默认模型」。
 */
export function generationProblemModelText(input: GenerationProblemInput): string {
  switch (input.code) {
    case "unknown_model":
      return `${input.model ? `Model ${input.model}` : "The named model"} is not in the model catalog`
        + (input.nearest ? `; the closest one is ${input.nearest}.` : ".")
        + " Name a providerId/modelId exactly as list_models gives it"
        + (input.nearest ? ` (likely ${input.nearest})` : "")
        + ", or ask the user which model they mean. A default model is not the problem here.";
    case "no_default_model": {
      const kind = input.media === "video" ? "video" : "image";
      return `No ${kind} model was named and the user has no default ${kind} model. `
        + "Name one in this call (candidate: { providerId, modelId }, from list_models), "
        + `or ask the user to pick a default ${kind} model.`;
    }
    case "mode_not_in_model":
      return `${input.model ? `Model ${input.model}` : "This model"} cannot do ${input.value ?? "this mode"}.`
        + (input.allowed?.length ? ` It does: ${list(input.allowed)}.` : "")
        + ` Name a model that does ${input.value ?? "it"} (from list_models), or change the mode to one it does, or ask the user.`;
    case "ratio_not_in_mode":
      return input.allowed?.length
        ? `${input.model ?? "This model"} cannot make ${input.value ?? "this ratio"} in this mode. Its ratio choices: ${list(input.allowed)}. Pick one of them, or ask the user.`
        : `${input.model ?? "This model"} has no frame-ratio choice in this mode. Leave aspectRatio out, or ask the user.`;
    case "duration_not_in_mode":
      if (input.min !== undefined && input.max !== undefined) {
        return `${input.model ?? "This model"} takes a duration between ${input.min} and ${input.max} seconds in this mode`
          + `${input.value !== undefined ? `; got ${input.value}` : ""}. Use a duration in that range, or ask the user.`;
      }
      if (input.allowed?.length) {
        return `${input.model ?? "This model"} takes only these durations in this mode: ${list(input.allowed)} seconds`
          + `${input.value !== undefined ? `; got ${input.value}` : ""}. Use one of them, or ask the user.`;
      }
      return `${input.model ?? "This model"} has no duration setting in this mode; the model decides the length. `
        + "Leave durationSec out; if the user needs this length, switch to a model that takes a duration, or ask the user.";
    case "reference_over_capacity":
      return `${input.model ?? "This mode"} takes at most ${input.max} reference${input.max === 1 ? "" : "s"} in this mode`
        + `${input.value !== undefined ? `; got ${input.value}` : ""}. Keep the ones that matter most, or ask the user which to drop.`;
    case "reference_role_not_in_mode":
      return `${input.model ?? "This mode"} does not take a reference used as ${input.value ?? "this role"} in this mode.`
        + (input.allowed?.length ? ` It takes: ${list(input.allowed)}.` : "")
        + " Change the reference's role, or ask the user.";
    case "parameter_not_allowed":
      return input.detail;
  }
}

/** 给模型读的 `Next:`，按动作词表出。`fix_field` 不在这里——它沿用准入层按字段码给的那句。 */
export const GENERATION_PROBLEM_NEXT_ACTION_EN: Readonly<Record<Exclude<GenerationProblemNext, "fix_field">, string>> = {
  use_nearest_model: "Call the same tool again with the closest model named above, if it is what the user meant; otherwise ask the user.",
  pick_from_list_models: "Call list_models, name a model from it exactly as listed, and call the same tool again.",
  set_default_model: "Name a model from list_models in this call, or ask the user to choose a default model in settings.",
  use_allowed_value: "Use one of the allowed values listed above and call the same tool again.",
  drop_field: "Leave that field out and call the same tool again.",
  reduce_references: "Send fewer references (at most the limit above) and call the same tool again.",
};

const stringList = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") ? value as string[] : undefined;

/** 从信封 / 遥测里读回问题。形状不对就当没有：老转录（0.24 及以前）根本没有这一格。 */
export function generationProblemOf(value: unknown): GenerationProblem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isGenerationProblemCode(record.code)) return undefined;
  const allowed = stringList(record.allowed);
  return {
    code: record.code,
    ...(typeof record.field === "string" && record.field ? { field: record.field } : {}),
    ...(allowed ? { allowed } : {}),
    ...(typeof record.nearest === "string" && record.nearest ? { nearest: record.nearest } : {}),
    ...(typeof record.min === "number" && Number.isFinite(record.min) ? { min: record.min } : {}),
    ...(typeof record.max === "number" && Number.isFinite(record.max) ? { max: record.max } : {}),
    ...(record.media === "image" || record.media === "video" ? { media: record.media } : {}),
    ...(typeof record.next === "string" && NEXTS.has(record.next) ? { next: record.next as GenerationProblemNext } : {}),
    retryable: record.retryable === true,
    charged: record.charged === true,
  };
}
