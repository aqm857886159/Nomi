import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import type { ModelRequestBodyOverrides } from "./modelDeclaration";
import type { CatalogState, Model } from "./types";

/**
 * 文本模型行能力声明的**初值**（设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★2）。
 * 只有写入口调用：`applyModelUpsert`（设置页、导入包、接入向导、声明卡登记、AI 接入、改类型、Antigravity 同步都走它）、
 * 种子对账、下面那次一次性数据修正。运行时不许调——运行时只经 `readModelDeclaration` 读写好的值。
 *
 * 下面两张按名字认模型的表是从运行时搬来的（原 `electron/ai/modelProfiles.ts`、`agentUserContent.ts` 的 PDF 名单），
 * 只留在请求里真有效果的几条，模块私有、不导出：
 *   · `requestBodyOverrides`：每次写入按当时的名字（别名优先）重算——名字改了跟着变，和今天运行时现猜一样；
 *   · `inputModalities`：只补缺。显式 `supportsPdfInput` 布尔优先（Antigravity 同步写 `false`），其次 PDF 名单。
 * 协议、推理三格一律不写：没声明 = 连接的协议、不推理，老用户的请求和升级前一样。
 */
const REQUEST_BODY_RULES: ReadonlyArray<{ match: RegExp; overrides: ModelRequestBodyOverrides }> = [
  // OpenAI o1 / o3 只收 temperature 1。
  { match: /^(o1|o3)(-|$)/i, overrides: { temperature: 1 } },
  // Kimi K2：温度 1 + `enable_thinking: false`（上游不一定认，照旧发，保持请求不变）。
  { match: /^kimi-k2/i, overrides: { temperature: 1, enable_thinking: false } },
];

/** 已知能原样收 PDF 文件块的模型族（Anthropic claude-3.5+ / OpenAI gpt-4o、4.1、o 系 / Google gemini）。 */
const PDF_INPUT_NAMES = /claude-3-5|claude-3-7|claude-opus-4|claude-sonnet-4|claude-haiku-4|gpt-4o|gpt-4\.1|o1|o3|o4-mini|gemini/i;

type DeclarationRow = Pick<Model, "kind" | "modelKey" | "modelAlias" | "meta">;

/** 写入口算一次初值，返回这一行该落盘的 `meta`。不是文本行、或没什么要补，原样返回同一个对象。 */
export function withModelDeclarationDefaults(row: DeclarationRow): unknown {
  if (row.kind !== "text") return row.meta;
  const meta: JsonRecord = isJsonRecord(row.meta) ? row.meta : {};
  const next: JsonRecord = { ...meta };
  if (!("inputModalities" in meta)) {
    const explicit = meta.supportsPdfInput;
    const pdf = typeof explicit === "boolean" ? explicit : PDF_INPUT_NAMES.test(`${row.modelKey || ""} ${row.modelAlias || ""}`);
    if (typeof explicit === "boolean" || pdf) next.inputModalities = pdf ? ["pdf"] : [];
  }
  const modelId = (row.modelAlias || row.modelKey || "").trim();
  const overrides = REQUEST_BODY_RULES.find((rule) => rule.match.test(modelId))?.overrides;
  if (overrides) next.requestBodyOverrides = { ...overrides };
  else delete next.requestBodyOverrides;
  return JSON.stringify(next) === JSON.stringify(meta) ? row.meta : next;
}

/**
 * 一次性数据修正，不升目录版本号（照 `repairUnverifiedUsable`）：升级读目录时给已有的每行文本模型补上同一个初值函数算出来的值，
 * 落一枚收据，之后不再跑（以后行上的声明由写入口维护，创作者 / 声明卡改过的不会被这里改回去）。
 */
export function repairModelDeclarationDefaults(state: CatalogState): CatalogState {
  if (state.modelDeclarationDefaultsApplied) return state;
  const models = state.models.map((model) => {
    const meta = withModelDeclarationDefaults(model);
    return meta === model.meta ? model : { ...model, meta };
  });
  return { ...state, modelDeclarationDefaultsApplied: true, models };
}
