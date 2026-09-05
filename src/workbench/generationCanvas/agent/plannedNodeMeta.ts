// 把 agent 建议的 modelKey/modeId/params 校验+补全成可写入 node.meta 的对象。
//
// 关键约束（bug① spike）：agent 一旦写了 modelKey，useNodeModelAutoSelect 的 effect1（只在
// modelKey 空时跑）就不会再自动补 vendor/label/默认参数——所以这里必须**自铺全**：
// modelVendor / modelLabel / archetype.{id,modeId} / 该 mode 的默认参数，再用 agent 的合法参数覆盖。
import type { AgentModelEntry } from "./availableModels";
import type { ModelParameterControl } from "../../../config/modelCatalogMeta";
import {
  resolveArchetypeForModel,
  specializeArchetypeForVariant,
  type ModelArchetype,
} from "../../../config/modelArchetypes";

export type PlannedNodeModelInput = {
  modelKey?: unknown;
  /** Canonical catalog vendor identity selected alongside modelKey. */
  vendor?: unknown;
  /** Backward-compatible wire alias for vendor (normalised before persistence). */
  modelVendor?: unknown;
  modeId?: unknown;
  /** Model-archetype variant identity (for example `fast` or `mini`). */
  variantId?: unknown;
  params?: unknown;
};

function nonBlankString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** Resolve the curated archetype again at the write boundary so variant
 * parameter narrowing and the persisted `{ id, modeId, variantId }` namespace
 * use the same source as the canvas composer. */
function entryArchetype(entry: AgentModelEntry): ModelArchetype | null {
  if (!entry.archetypeId) return null;
  return resolveArchetypeForModel({
    modelKey: entry.modelKey,
    modelAlias: entry.modelAlias,
    vendorKey: entry.vendor,
    meta: { archetypeId: entry.archetypeId },
  });
}

function canonicalVariantId(archetype: ModelArchetype, value: unknown): string {
  const requested = nonBlankString(value);
  if (!requested || !archetype.variants?.length) return "";
  if (archetype.variants.some((variant) => variant.id === requested)) return requested;
  const alias = archetype.variantIdAliases?.[requested];
  return alias && archetype.variants.some((variant) => variant.id === alias) ? alias : "";
}

// 单字段校验（跨字段互斥/依赖留二期）：select 取值必须在 options；number 在 min-max；boolean 是布尔。
function isValidParamValue(
  control: ModelParameterControl,
  value: string | number | boolean,
): boolean {
  if (control.options.length > 0) {
    return control.options.some((option) => String(option.value) === String(value));
  }
  if (control.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (control.min !== undefined && value < control.min) return false;
    if (control.max !== undefined && value > control.max) return false;
    return true;
  }
  if (control.type === "boolean") return typeof value === "boolean";
  return true;
}

/**
 * 模型清单索引：**同时**含 `vendor::modelKey` 与裸 `modelKey` 两种键。
 * 前者是身份唯一键（同名模型来自不同供应商是两个模型）；后者供旧计划/无 vendor 的目录行回落。
 * 裸键取**第一次出现**的条目（后来者不覆盖），避免「索引里最后写入的那家」这种随机身份。
 * 两处落地路径（applyCanvasToolCall / storyboardRowActions）共用本构造器，不各写一份（P1）。
 */
export function buildModelEntryIndex(entries: readonly AgentModelEntry[]): Map<string, AgentModelEntry> {
  const index = new Map<string, AgentModelEntry>();
  for (const entry of entries) {
    if (entry.vendor) index.set(`${entry.vendor}::${entry.modelKey}`, entry);
    if (!index.has(entry.modelKey)) index.set(entry.modelKey, entry);
  }
  return index;
}

export function buildPlannedNodeMeta(
  planned: PlannedNodeModelInput,
  entryByKey: ReadonlyMap<string, AgentModelEntry>,
): Record<string, unknown> | undefined {
  const modelKey = typeof planned.modelKey === "string" ? planned.modelKey.trim() : "";
  if (!modelKey) return undefined;
  // 身份唯一键是 (vendor, modelKey)——先按带 vendor 的键查，查不到才回落裸 key（旧计划/无 vendor 目录行）。
  // 只按裸 key 查会在两家供应商提供同名模型时拿到「索引里最后写入的那家」，
  // 与用户所选无关（2026-09-03 真实付费走查实测：选 APIMart 却发去 code-newcli-com）。
  const declaredVendor = nonBlankString(planned.vendor) || nonBlankString(planned.modelVendor);
  const entry = (declaredVendor ? entryByKey.get(`${declaredVendor}::${modelKey}`) : undefined)
    ?? entryByKey.get(modelKey);
  // 模型不在可用清单 → 不写模型 meta，回退原自动选（避开 effect3 供应商断开自愈覆盖）。
  if (!entry) return undefined;

  // A proposal may carry both the model key and an explicit vendor selected in
  // the approval card. Never combine a catalog entry from one vendor with a
  // caller-declared identity from another; that would make the visible choice
  // differ from the request that reaches the provider. The model list is the
  // authority, while a vendor-less entry may still accept an explicit vendor
  // for legacy/custom catalog rows.
  const vendor = nonBlankString(planned.vendor);
  const modelVendor = nonBlankString(planned.modelVendor);
  // The two spellings are aliases on the wire, not two independent routing
  // choices. Reject a contradictory direct renderer call just as the shared
  // capability schema does for the Host transport.
  if (vendor && modelVendor && vendor !== modelVendor) return undefined;
  const requestedVendor = vendor || modelVendor;
  if (requestedVendor && entry.vendor && requestedVendor !== entry.vendor) return undefined;
  const persistedVendor = requestedVendor || entry.vendor || "";

  const archetype = entryArchetype(entry);
  const requestedVariant = nonBlankString(planned.variantId);
  const variantId = archetype ? canonicalVariantId(archetype, requestedVariant) : "";
  // Only an explicit, valid variant changes the parameter surface. Omitting a
  // variant preserves the pre-existing default behavior; an invalid one is
  // ignored and therefore cannot smuggle unsupported parameters through.
  const effectiveArchetype = archetype && variantId
    ? specializeArchetypeForVariant(archetype, variantId)
    : archetype;

  const wantModeId = typeof planned.modeId === "string" ? planned.modeId.trim() : "";
  // Normalize the renderer-facing and agent-facing mode shapes before the
  // common parameter pass. This keeps the write boundary independent of which
  // catalog projection supplied the entry.
  const archetypeMode =
    effectiveArchetype?.modes.find((candidate) => candidate.id === wantModeId) ??
    effectiveArchetype?.modes.find((candidate) => candidate.id === entry.defaultModeId);
  const entryMode =
    entry.modes.find((candidate) => candidate.modeId === wantModeId) ??
    entry.modes.find((candidate) => candidate.modeId === entry.defaultModeId) ??
    entry.modes[0];
  const mode = archetypeMode
    ? { modeId: archetypeMode.id, params: archetypeMode.params }
    : entryMode;

  const meta: Record<string, unknown> = {
    modelKey,
    modelLabel: entry.label,
    // Chat models are catalog-defined and intentionally have no media
    // archetype. Do not invent one: the explicit model identity itself is the
    // contract that keeps text generation from silently falling back.
    ...(effectiveArchetype
      ? {
          archetype: {
            id: effectiveArchetype.id,
            modeId: mode?.modeId ?? effectiveArchetype.defaultModeId,
            ...(variantId ? { variantId } : {}),
          },
        }
      : {}),
  };
  if (persistedVendor) {
    // Canvas generation nodes have historically exposed both keys to the
    // runner. They are aliases of one value, written together so the selected
    // provider survives reloads and evidence capture.
    meta.modelVendor = persistedVendor;
    meta.vendor = persistedVendor;
  }
  if (!mode) return meta;

  // 1) 铺 mode 默认参数
  for (const control of mode.params) {
    if (control.defaultValue !== undefined) meta[control.key] = control.defaultValue;
  }
  // 2) agent 的合法参数覆盖（非法值丢弃，保留默认）
  const rawParams =
    planned.params && typeof planned.params === "object" && !Array.isArray(planned.params)
      ? (planned.params as Record<string, unknown>)
      : {};
  for (const control of mode.params) {
    const value = rawParams[control.key];
    if (value === undefined) continue;
    if (
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
      isValidParamValue(control, value)
    ) {
      meta[control.key] = value;
    }
  }
  return meta;
}

const RESERVED_META_KEYS = new Set(["modelKey", "modelLabel", "archetype", "modelVendor", "vendor"]);

/**
 * 把一个 planned node 的 modelKey/modeId/params 解析成「执行后会真正写入的值」——与
 * buildPlannedNodeMeta 同源（执行端也用它）。在**批准时**对计划这样解析一遍，就能让
 * 「你批准的」≡「实际执行的」，从根上消灭对账「执行与批准有出入」（参数被档案回退/模型被换/
 * 非法值被丢这一整类，每次换个字段冒出来）。
 *
 * - 模型合法：modelKey/modeId 对齐解析结果，params 替换成「mode 默认 + 合法覆盖」的最终值
 *   （如 agent 给 Hailuo duration:5 非法 → 这里就变成默认 6，与执行一致）。
 * - 模型不可用/未配：剥掉 modelKey/modeId/params（执行会回退自动选、不写模型 meta，二者一致）。
 */
export function resolvePlannedNodeArgs(
  node: Record<string, unknown>,
  entryByKey: ReadonlyMap<string, AgentModelEntry>,
): Record<string, unknown> {
  if (typeof node.modelKey !== "string" || !node.modelKey.trim()) return node;
  const meta = buildPlannedNodeMeta(node as PlannedNodeModelInput, entryByKey);
  if (!meta) {
    const {
      modelKey: _mk,
      modeId: _md,
      params: _p,
      vendor: _vendor,
      modelVendor: _modelVendor,
      variantId: _variantId,
      ...rest
    } = node;
    return rest;
  }
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!RESERVED_META_KEYS.has(key)) params[key] = value;
  }
  const archetype = meta.archetype as { modeId?: string } | undefined;
  return {
    ...node,
    modelKey: meta.modelKey,
    ...(archetype?.modeId ? { modeId: archetype.modeId } : {}),
    params,
  };
}
