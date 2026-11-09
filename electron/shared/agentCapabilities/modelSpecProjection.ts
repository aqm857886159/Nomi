// 「模型说明书」的**唯一投影**：薄名单一档、单模型详情一档，两个模型面共用这一份。
//
// 为什么要它（2026-09-21 用户拍板：「MCP 不能重造一套，而是复用」「分级披露，里外都要做」）：
// 在这之前，应用内 Agent 的 `list_models` 返回完整 `AgentModelEntry`（modes/params/slots），
// 而对外 MCP 面的 `nomi_read{target:"models"}` 只有 vendor/modelKey/kind/label —— **没有参数名**。
// 验收实测：外部面 8 个 run **0 个**走到建草稿，模型拿不到参数名时连计划都提不出来。
// 同一件事，两个入口差了一个数量级。
//
// 分级的形状不是自创：MCP 2026-07-28 规范本身**没有**「工具结果内部再分级」的机制
// （https://modelcontextprotocol.io/specification/2026-07-28/server/tools ，2026-09-21 读全文），
// 分级披露是**规范之上的设计模式**——Solo.io 的 agentgateway 把上游工具表换成
// `get_tool` / `invoke_tool` 两个元工具「so clients see only a lightweight index」
// （https://www.solo.io/blog/mcp-progressive-disclosure ，同日读全文）。
// 本仓早有同形状的先例：`skills.list`（元数据，不含正文）/ `skills.read`（正文），
// `dispatcher.ts` 那行注释原话就是「渐进披露，不含正文」。模型目录照抄它，不发明第三种。
//
// 为什么薄的那一档必须真薄：108 个模型的完整说明书是十万字量级，塞进每一回合就是把
// 上下文烧光、把工具写对率拖垮。薄名单只留**选型需要的最少字段**，选定之后再查那一个。
import type { AgentModelEntry, AgentModelVariant } from "./availableModels";
import { getArchetypeById, resolveArchetypeVariant, specializeArchetypeForVariant, specializeArchetypeForVendor } from "../modelArchetypes";
import type { ModelParameterControl } from "../videoCapabilities/types";

/** 这个模型此刻能不能用——与 Nomi 自己界面里的下拉读的是同一个答案。 */
export type ModelAvailabilityFacts = {
  /** ok / missing / locked / needs_resave。 */
  keyStatus: string;
  usable: boolean;
  /** 一句人话：可用就报可用，不可用各报缺口 + 该干什么。 */
  statusReason: string;
};

/**
 * 薄名单的一行：**只够选型**。
 * 没有 params、没有 slots、没有每个 mode 的说明——那些在详情那一档。
 */
export type ModelSpecRow = Partial<ModelAvailabilityFacts> & {
  modelId: string;
  vendor: string | null;
  label: string;
  kind: AgentModelEntry["kind"];
  /** 有哪些模式（只给 id，够模型判断「这个模型有没有图生视频」）。 */
  modeIds: string[];
  /** 有哪些变体（只给 id）。不投就是「可被拒、不可发现」。 */
  variantIds?: string[];
  /** 能力位：这个模型**任一模式**吃不吃图/视频/音频参考。连边与选型都靠它先筛一轮。 */
  accepts: { image: boolean; video: boolean; audio: boolean; multiImage: boolean };
};

/** 单模型详情：薄名单那一行 + 全部模式、参数、参考槽、变体。 */
export type ModelSpecDetail = ModelSpecRow & {
  archetypeId?: string;
  modelAlias: string | null;
  defaultModeId: string;
  defaultVariantId?: string;
  modes: AgentModelEntry["modes"];
  /** Mode parameters are for the default variant. Apply these differences for a named variant. */
  variants?: Array<AgentModelVariant & { parameterOverridesByMode?: Record<string, Record<string, ModelParameterControl | null>> }>;
};

const IMAGE_SLOTS = new Set(["image_ref", "first_frame", "last_frame"]);

/** 这个模型任一模式吃哪些参考——从档案声明的槽 derive，不另立一份判据。 */
function acceptsOf(entry: AgentModelEntry): ModelSpecRow["accepts"] {
  const slots = entry.modes.flatMap((mode) => mode.slots);
  const kinds = new Set(slots.map((slot) => slot.kind));
  return {
    image: [...kinds].some((kind) => IMAGE_SLOTS.has(kind)),
    video: kinds.has("video_ref") || kinds.has("source_video"),
    audio: kinds.has("audio_ref"),
    // 能不能一次吃多张图：看声明的槽容量，不另立判据。
    multiImage: slots.some((slot) => IMAGE_SLOTS.has(slot.kind) && (slot.max ?? 1) > 1),
  };
}

/**
 * `availability` 可缺省：应用内那一面的清单是渲染层按「此刻可用」筛过再推上来的，
 * 少数装配路径（测试夹具、还没接目录的宿主）拿不到那三样。**缺就不写**，不编一个 `usable: true`
 * ——「不知道」和「可用」是两件事。生产两面都由目录注入，故两面都有。
 */
export function modelSpecRow(entry: AgentModelEntry, availability?: ModelAvailabilityFacts): ModelSpecRow {
  return {
    modelId: entry.modelId,
    vendor: entry.vendor,
    label: entry.label,
    kind: entry.kind,
    modeIds: entry.modes.map((mode) => mode.modeId),
    ...(entry.variants?.length ? { variantIds: entry.variants.map((variant) => variant.id) } : {}),
    accepts: acceptsOf(entry),
    ...availability,
  };
}

/** A variant may remove a control (null), add one, or narrow its allowed values. */
function changedParameters(base: ModelParameterControl[], selected: ModelParameterControl[]): Record<string, ModelParameterControl | null> {
  const changes: Record<string, ModelParameterControl | null> = {};
  for (const control of selected) {
    const previous = base.find((item) => item.key === control.key);
    if (previous !== control && JSON.stringify(previous) !== JSON.stringify(control)) changes[control.key] = control;
  }
  for (const control of base) {
    if (!selected.some((item) => item.key === control.key)) changes[control.key] = null;
  }
  return changes;
}

/** Thin lists and renderer callers keep their original entries. Specialize only the requested model. */
function variantDetails(entry: AgentModelEntry): Pick<ModelSpecDetail, "modes" | "variants" | "defaultVariantId"> {
  const unmodified = { modes: entry.modes, ...(entry.variants?.length ? { variants: entry.variants } : {}),
    ...(entry.defaultVariantId ? { defaultVariantId: entry.defaultVariantId } : {}) };
  if (!entry.variants?.length || !entry.archetypeId) return unmodified;
  const base = getArchetypeById(entry.archetypeId);
  if (!base) return unmodified; // User-declared models without a registered archetype own their supplied controls.
  const scoped = specializeArchetypeForVendor(base, entry.vendor);
  const defaultVariantId = resolveArchetypeVariant(scoped, { modelId: entry.modelId })?.id;
  const defaultArchetype = specializeArchetypeForVariant(scoped, defaultVariantId);
  const modes = entry.modes.map((mode) => {
    const params = defaultArchetype.modes.find((item) => item.id === mode.modeId)?.params;
    return params ? { ...mode, params } : mode;
  });
  const variants = entry.variants.map((variant) => {
    if (variant.id === defaultVariantId) return variant;
    const selected = specializeArchetypeForVariant(scoped, variant.id);
    const byMode: Record<string, Record<string, ModelParameterControl | null>> = {};
    for (const mode of modes) {
      const params = selected.modes.find((item) => item.id === mode.modeId)?.params;
      if (!params || params === mode.params) continue;
      const changes = changedParameters(mode.params, params);
      if (Object.keys(changes).length) byMode[mode.modeId] = changes;
    }
    return Object.keys(byMode).length ? { ...variant, parameterOverridesByMode: byMode } : variant;
  });
  return { modes, variants, defaultVariantId };
}

export function modelSpecDetail(entry: AgentModelEntry, availability?: ModelAvailabilityFacts): ModelSpecDetail {
  return {
    ...modelSpecRow(entry, availability),
    ...(entry.archetypeId ? { archetypeId: entry.archetypeId } : {}),
    modelAlias: entry.modelAlias,
    defaultModeId: entry.defaultModeId,
    ...variantDetails(entry),
  };
}

/**
 * 按标识解析一个模型（大小写不敏感）。**三种结果，没有第四种「悄悄挑一个」**：
 *
 *  · 正好一个 → `{ ok: true }`；
 *  · 给了 `vendor` 却没有哪一家匹配 → `not_found`；
 *  · **没给 `vendor`，而这个 modelId 名下有 ≥2 家** → `ambiguous`。
 *
 * 第三条是 2026-09-22 主管自查点出来的同类尾巴：旧实现 `if (!vendor) return matches[0]`
 * 在两个面上都**悄悄返回第一家的说明书**，调用方以为拿到的是它要的那家，
 * 然后照另一家的参数表去下单。与「vendor 不匹配时静默回退」是同一个毛病——
 * 同名模型跨供应商在本仓是**两个模型**（身份唯一键 (vendor, modelId)）。
 */
export type ModelEntryLookup =
  | { ok: true; entry: AgentModelEntry }
  | { ok: false; reason: "not_found" | "ambiguous"; vendors: string[] };

export function resolveModelEntry(
  entries: readonly AgentModelEntry[],
  modelId: string,
  vendor?: string | null,
): ModelEntryLookup {
  const matches = entriesWithId(entries, modelId);
  const vendors = [...new Set(matches.map((entry) => entry.vendor).filter((v): v is string => Boolean(v)))];
  if (vendor) {
    const exact = matches.find((entry) => entry.vendor === vendor);
    return exact ? { ok: true, entry: exact } : { ok: false, reason: "not_found", vendors };
  }
  if (matches.length === 0) return { ok: false, reason: "not_found", vendors };
  if (vendors.length > 1) return { ok: false, reason: "ambiguous", vendors };
  return { ok: true, entry: matches[0]! };
}

/** 只要那一个（拿不到就 undefined）。歧义与找不到的区分请用 `resolveModelEntry`。 */
export function findModelEntry(
  entries: readonly AgentModelEntry[],
  modelId: string,
  vendor?: string | null,
): AgentModelEntry | undefined {
  const found = resolveModelEntry(entries, modelId, vendor);
  return found.ok ? found.entry : undefined;
}

function entriesWithId(entries: readonly AgentModelEntry[], modelId: string): AgentModelEntry[] {
  const wanted = modelId.trim().toLowerCase();
  return entries.filter((entry) =>
    entry.modelId.toLowerCase() === wanted || (entry.modelAlias ?? "").toLowerCase() === wanted);
}

/** 这个 modelId 名下有哪几家供应商——拒绝时点名它们，调用方才知道该补哪个 vendor。 */
export function vendorsCarrying(entries: readonly AgentModelEntry[], modelId: string): string[] {
  return [...new Set(entriesWithId(entries, modelId).map((entry) => entry.vendor).filter((v): v is string => Boolean(v)))];
}
