// 「放错位置的字段」对照表（2026-10-18）：模型把起草的**顶层字段**写进了 `parameters`
// （真走查：`parameters.variant: "fast"`），而这个模型的参数表里本来没有那个键——
// 光说「不接受参数 variant、合法键是……」，模型看不出 variant 其实有个家（`variantId`）。
//
// 一张通用表，不是 variant 的特例：键 = 模型常写的名字（比较时去掉大小写与 `_` `-`），值 = `draft_shots` 每一镜
// **真实存在**的字段名（`draftShotSchema`）。`draftFieldAliases.test.ts` 逐个核「值都是 draft schema 里真有的字段」——
// 字段改名而这里没跟上，测试当场红。
export const DRAFT_FIELD_FOR_MISPLACED_PARAMETER: Readonly<Record<string, string>> = Object.freeze({
  variant: "variantId",
  variantid: "variantId",
  model: "model",
  modelid: "model",
  modelname: "model",
  vendor: "model",
  provider: "model",
  providerid: "model",
  mode: "modeId",
  modeid: "modeId",
  tasktype: "taskKind",
  taskkind: "taskKind",
  prompt: "prompt",
  title: "title",
  role: "role",
  references: "references",
  referenceimages: "references",
});

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, "");

/** 这个键是不是起草的顶层字段名 / 常见别名；是就返回它该放的字段。 */
export function draftFieldForMisplacedParameter(key: string): string | undefined {
  return DRAFT_FIELD_FOR_MISPLACED_PARAMETER[normalizeKey(key)];
}
