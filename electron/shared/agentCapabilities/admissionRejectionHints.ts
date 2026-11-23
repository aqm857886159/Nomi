// 「准入层的拒绝 → 模型下一步该怎么做」**按码的指引表，全仓唯一的一份**（2026-10-18）。
//
// 为什么它非存在不可：起草阶段的参数拒绝（`seed: "abc"`、`variant: "fast"`……）发生在**什么都没发出去**的时候，
// 模型当场就能改对再交。可是 lane 工具的失败一律挂着那句「Read the current project state … Do not repeat an unknown
// paid submission」——那是给「提交状态不明」那一类码写的。Agent 照着停下，面板出一张「这一步没做成」的报错卡，
// 而拒绝本身说得再清楚（合法键、最接近的键、合法取值）也没人用上。对外 MCP 那边早就按码给了恢复动作
// （`mcpToolErrorResults` 的 `ERROR_HINT`），两边各写各的，lane 这边一直是通用句。
//
// 现在两边读这一张表：MCP 渲染 zh/en 的人话与恢复动作，lane 用 `en` 那一半拼 `Next:`。
// 想改指引只改这里；`admissionRejectionHints.test.ts` 钉住「每个准入码都有 zh / en / 恢复动作、且都说了没提交没扣钱」。
export const ADMISSION_REJECTION_CODES = [
  "unknown_parameter", "parameter_type_mismatch", "parameter_not_in_enum",
  "parameter_out_of_range", "missing_required_parameter", "unknown_variant",
  "mode_input_missing",
] as const;
export type AdmissionRejectionCode = (typeof ADMISSION_REJECTION_CODES)[number];

type Line = { zh: string; en: string };

/** 起草阶段的拒绝：什么都没提交、没扣钱——所以该做的是改参数再调一次，不是去核对任务。 */
export const ADMISSION_NOTHING_SENT: Line = {
  zh: "什么都没提交，也没扣钱；按上面的说明改掉这些参数，再调一次同一个工具",
  en: "Nothing was submitted and nothing was charged; fix the parameters as described above and call the same tool again",
};

export const ADMISSION_REJECTION_HINTS: Readonly<Record<AdmissionRejectionCode, { zh: string; en: string; recover: readonly Line[] }>> = {
  unknown_parameter: {
    zh: "这个模型不接受你写的那个参数键",
    en: "This model does not accept the parameter key you sent",
    recover: [
      { zh: "改用 allowedKeys 里的键（有 closestKey 就用它）；如果 useField 指出它其实是起草的顶层字段，就把它放到那个字段，不要放进 parameters", en: "Use a key from allowedKeys (prefer closestKey when present); if useField names a draft field, put the value in that field instead of parameters" },
      ADMISSION_NOTHING_SENT,
    ],
  },
  parameter_type_mismatch: {
    zh: "参数类型不对",
    en: "The parameter value has the wrong type",
    recover: [
      { zh: "按 expectedType 改写该参数的值（数字写数字、布尔写 true / false，不要加引号；不想设就整个键去掉或写 null）", en: "Rewrite the value to match expectedType (a number as a number, a boolean as true / false, no quotes; to leave it unset drop the key or write null)" },
      ADMISSION_NOTHING_SENT,
    ],
  },
  parameter_not_in_enum: {
    zh: "参数取值不在这个模型的合法取值里",
    en: "The parameter value is not one this model allows",
    recover: [{ zh: "从 allowedValues 里挑一个", en: "Pick one of allowedValues" }, ADMISSION_NOTHING_SENT],
  },
  parameter_out_of_range: {
    zh: "参数取值超出这个模型声明的范围",
    en: "The parameter value is outside the range this model declares",
    recover: [{ zh: "取 min 与 max 之间的值", en: "Use a value between min and max" }, ADMISSION_NOTHING_SENT],
  },
  missing_required_parameter: {
    zh: "缺少这个模型的必填参数",
    en: "A parameter this model requires is missing",
    recover: [{ zh: "补上 at 指出的那个参数（必填参数不能写 null）", en: "Supply the parameter named in `at` (a required parameter cannot be null)" }, ADMISSION_NOTHING_SENT],
  },
  unknown_variant: {
    zh: "这个变体不属于该模型",
    en: "That variant does not belong to this model",
    recover: [
      { zh: "从 allowedVariantIds 里挑一个；为空表示该模型没有变体，别传 variantId", en: "Pick one of allowedVariantIds; empty means this model has no variants, so omit variantId" },
      ADMISSION_NOTHING_SENT,
    ],
  },
  mode_input_missing: {
    zh: "所选生成方式缺少必填参考素材",
    en: "This mode requires reference media that is missing from references",
    recover: [
      {
        zh: "先调用 look_at_media（或 look_at_canvas）获取素材 assetId 并传进 shots[].references，或去掉 modeId 改用文字生成",
        en: "Call look_at_media (or look_at_canvas) to get the asset ids and pass them in shots[].references, or omit modeId for text generation",
      },
      ADMISSION_NOTHING_SENT,
    ],
  },
};

/** 生成域「模型写的入参我们收不了」那一档的粗码（`transportFailure.ts` 的 `GENERATION_ARGUMENT_REFUSAL` 就是它）。 */
export const GENERATION_INPUT_INVALID_CODE = "generation_input_invalid";

/**
 * 粗码 `generation_input_invalid` 的指引（对外 MCP 读它，和 lane 的 `DRAFT_REFUSAL_NEXT_ACTION_EN` 是同一句意思）。
 * 它的正文是我们自己写的一句可行动的话（「素材不在库里」「模式与种类打架」……），所以 MCP 那边正文原样保留、
 * 只补这一份恢复动作：什么都没提交、没扣钱，按正文改了再调同一个工具。
 */
export const GENERATION_INPUT_INVALID_HINT: Readonly<{ zh: string; en: string; recover: readonly Line[] }> = {
  zh: "这次起草的入参我们收不了",
  en: "Nomi could not accept this draft as written",
  recover: [{ zh: "按上面那句话点名的字段改", en: "Change what the message above names" }, ADMISSION_NOTHING_SENT],
};

export function isAdmissionRejectionCode(code: unknown): code is AdmissionRejectionCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ADMISSION_REJECTION_HINTS, code);
}

/** lane 的 `Next:`（英文，给模型）。 */
export function admissionNextActionEn(code: AdmissionRejectionCode): string {
  return ADMISSION_REJECTION_HINTS[code].recover.map((line) => line.en).join(". ") + ".";
}

/**
 * 起草里**没有具体码**的拒绝（`generation_input_invalid`：我们自己写的一句可行动的话——素材不在库里、模式与种类打架……）。
 * 它同样发生在什么都没发出去的时候。
 */
export const DRAFT_REFUSAL_NEXT_ACTION_EN =
  "Nothing was submitted and nothing was charged. Fix what the message names and call the same tool again. Do not look for a task: this call never created one.";
