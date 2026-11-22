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
import { resolveArchetypeVariant, resolveModelArchetype } from "../modelArchetypes";
import { modelHandleOf } from "./modelHandle";
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
 * 两个模型面各自的**身份头**（2026-11-15，协调拍板方案 A：一份事实、两个身份头）：
 *   · `lane`：应用内 Agent。只有一个完整名字 `model`（`模型id@供应商`），它原样抄回 `draft_shots`；
 *   · `mcp`：对外 MCP。`modelId` + `vendor` 两件，对外已发布的形状逐字节不变（外部生成面收编那一刀再改）。
 * 差别**只**在 `modelSpecIdentity` 这一个函数里；共享事实那一半只有 `modelSpecFacts` 一处生成。
 */
export type ModelSpecFace = "lane" | "mcp";
type LaneIdentity = { model: string };
type McpIdentity = { modelId: string; vendor: string | null };
type IdentityOf<F extends ModelSpecFace> = F extends "lane" ? LaneIdentity : McpIdentity;

/**
 * 薄名单一行里两面共享的事实：**只够选型**。
 * 没有 params、没有 slots、没有每个 mode 的说明——那些在详情那一档。
 */
type ModelSpecFacts = Partial<ModelAvailabilityFacts> & {
  label: string;
  kind: AgentModelEntry["kind"];
  /** 有哪些模式（只给 id，够模型判断「这个模型有没有图生视频」）。 */
  modeIds: string[];
  /** 有哪些变体（只给 id）。不投就是「可被拒、不可发现」。 */
  variantIds?: string[];
  /** 能力位：这个模型**任一模式**吃不吃图/视频/音频参考。连边与选型都靠它先筛一轮。 */
  accepts: { image: boolean; video: boolean; audio: boolean; multiImage: boolean };
};
/** 薄名单的一行 = 身份头 + 共享事实。缺省是对外那一面（对外调用方一个字不用改）。 */
export type ModelSpecRow<F extends ModelSpecFace = "mcp"> = IdentityOf<F> & ModelSpecFacts;

/** 单模型详情：薄名单那一行 + 全部模式、参数、参考槽、变体。 */
export type ModelSpecDetail<F extends ModelSpecFace = "mcp"> = ModelSpecRow<F> & {
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
function acceptsOf(entry: AgentModelEntry): ModelSpecFacts["accepts"] {
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
export function modelSpecRow<F extends ModelSpecFace>(entry: AgentModelEntry, face: F, availability?: ModelAvailabilityFacts): ModelSpecRow<F> {
  return withIdentity(entry, face, modelSpecFacts(entry, availability));
}

/** 身份头在前、事实在后（对外那一面的字段顺序就是今天的顺序：modelId, vendor, label, …）。 */
function withIdentity<F extends ModelSpecFace, T extends object>(entry: AgentModelEntry, face: F, facts: T): IdentityOf<F> & T {
  return Object.assign(modelSpecIdentity(entry, face), facts);
}

/**
 * **唯一**按「哪一面」分支的地方。别处不许再问「是不是对外」：要不同的身份写法，改这里。
 * 应用内的名字由 `modelHandleOf` 生成（全仓一处），这里不拼字符串。
 */
function modelSpecIdentity<F extends ModelSpecFace>(entry: AgentModelEntry, face: F): IdentityOf<F> {
  const identity: LaneIdentity | McpIdentity = face === "lane"
    ? { model: modelHandleOf(entry) }
    : { modelId: entry.modelId, vendor: entry.vendor };
  return identity as IdentityOf<F>;
}

function modelSpecFacts(entry: AgentModelEntry, availability?: ModelAvailabilityFacts): ModelSpecFacts {
  return {
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
  // 每一档的参数都问唯一入口（以前这里自己串「按 id 找 → 供应商 → 档」）。名单层给的方式是全部档的并集，这一刀不变。
  const model = { modelKey: entry.modelId, modelAlias: entry.modelAlias, vendorKey: entry.vendor, meta: { archetypeId: entry.archetypeId } };
  const archetypeFor = (variant: { variantId: string | undefined; modelId: string | undefined }) => {
    const archetype = resolveModelArchetype(model, { variant });
    // User-declared models without a registered archetype own their supplied controls (an unknown id must not fall back to name matching).
    return archetype?.id === entry.archetypeId ? archetype : null;
  };
  const defaultArchetype = archetypeFor({ variantId: undefined, modelId: entry.modelId });
  if (!defaultArchetype) return unmodified;
  const defaultVariantId = resolveArchetypeVariant(defaultArchetype, { modelId: entry.modelId })?.id;
  const modes = entry.modes.map((mode) => {
    const params = defaultArchetype.modes.find((item) => item.id === mode.modeId)?.params;
    return params ? { ...mode, params } : mode;
  });
  const variants = entry.variants.map((variant) => {
    if (variant.id === defaultVariantId) return variant;
    const selected = archetypeFor({ variantId: variant.id, modelId: undefined });
    if (!selected) return variant;
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

export function modelSpecDetail<F extends ModelSpecFace>(entry: AgentModelEntry, face: F, availability?: ModelAvailabilityFacts): ModelSpecDetail<F> {
  return withIdentity(entry, face, {
    ...modelSpecFacts(entry, availability),
    ...(entry.archetypeId ? { archetypeId: entry.archetypeId } : {}),
    modelAlias: entry.modelAlias,
    defaultModeId: entry.defaultModeId,
    ...variantDetails(entry),
  });
}

// 写下的模型名 → 哪一个说明书：不在这里认。2026-11-17 起名字只在 `modelHandle.ts` 的名字主人认
// （`resolveModelIdentity`），外部读详情（`modelSpecRead.requireModelSpecDetail`）直接问它、按原码包装。
// 以前这里的 `resolveModelEntry` 是第三个认名字的地方：大小写 / 别名认，近似写法不认，和起草那条路各说各的。
