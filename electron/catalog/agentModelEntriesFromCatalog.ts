// 主进程侧的 `AgentModelEntry` 派生——**与渲染层同一条投影链**，不是第二份。
//
// 这份东西能存在的前提是 2026-09-22 的档案归一三期：image/audio/3D 档案搬进
// `electron/shared/modelArchetypes` 之后，主进程才 import 得到它们。在那之前对外 MCP 面
// 只能投 `ModelListingEntry`（vendor/modelKey/kind/label，**没有参数**），
// 于是外部宿主每个参数都是猜的——验收实测那一面 8 个 run 0 个走到建草稿。
//
// 与渲染层 `buildAgentModelEntries` 的关系：两边都是「目录行 + 档案 → AgentModelEntry」这**同一个**
// 投影，只是取目录行的方式不同（渲染层走 catalog IPC 的 ModelOption，这里直接读 CatalogState）。
// 投影的形状与字段由 `AgentModelEntry` 一处定义，两边都不许各加各的字段。
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import type { AgentModelEntry } from "../shared/agentCapabilities/availableModels";
import type { ModelAvailabilityFacts } from "../shared/agentCapabilities/modelSpecProjection";
import { missingDeclaredCapabilityFields } from "../shared/customCapabilityContract";
import { createCatalogAvailability } from "./catalogModelAvailability";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";
import { deriveModelListing } from "./modelCatalogListing";
import type { CatalogState } from "./types";
import type { KeyStatusProbe } from "./secrets";

export type CatalogAgentModel = { entry: AgentModelEntry; availability: ModelAvailabilityFacts };

/**
 * 目录 → `AgentModelEntry` + 可用性。没有档案的媒体模型照列但不给虚构模式（文本保持 chat），理由与渲染层一致：漏掉它等于让模型以为这个模型不存在，而它在界面里选得到。
 */
export function agentModelEntriesFromCatalog(
  state: CatalogState,
  deps: { keyStatusProbe?: KeyStatusProbe } = {},
): CatalogAgentModel[] {
  const out: CatalogAgentModel[] = [];
  const seen = new Set<string>();
  const rows = deriveModelListing(state, deps);
  const availability = createCatalogAvailability(state, deps.keyStatusProbe);
  for (const model of state.models) {
    const missing = missingDeclaredCapabilityFields(model.meta);
    if (!missing.length || rows.some((row) => row.vendor === model.vendorKey && row.modelKey === model.modelKey)) continue;
    rows.push({ vendor: model.vendorKey, vendorName: state.vendors.find((v) => v.key === model.vendorKey)?.name || model.vendorKey,
      modelKey: model.modelKey, moduleId: SINGLE_SHOT_GENERATION_MODULE_ID, kind: model.kind, label: model.labelZh || model.modelKey,
      keyStatus: availability.credentialStatusFor(model.vendorKey), usable: false,
      statusReason: `声明不完整，需要重新读文档交卡 / Incomplete declaration: read the documentation and resubmit. Missing: ${missing.join(", ")}`,
      references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } });
  }
  for (const row of rows) {
    // 身份唯一键含 vendor：同名模型来自两家是**两个模型**（与 buildAgentModelEntries 同一条规则）。
    const identity = `${row.vendor}::${row.modelKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const model = state.models.find((item) => item.vendorKey === row.vendor && item.modelKey === row.modelKey);
    const archetype = missingDeclaredCapabilityFields(model?.meta).length ? null : resolveArchetypeForModel({
      modelKey: row.modelKey,
      modelAlias: model?.modelAlias ?? null,
      vendorKey: row.vendor,
      meta: model?.meta,
    });
    const entry: AgentModelEntry = {
      modelId: row.modelKey,
      modelAlias: model?.modelAlias ?? null,
      vendor: row.vendor,
      label: row.label,
      kind: (archetype?.kind ?? row.kind) as AgentModelEntry["kind"],
      ...(archetype ? { archetypeId: archetype.id } : {}),
      defaultModeId: archetype?.defaultModeId ?? (row.kind === "text" ? "chat" : ""),
      modes: archetype
        ? archetype.modes.map((mode) => ({
            modeId: mode.id,
            vendorTerm: mode.vendorTerm,
            intent: mode.intent,
            hint: mode.hint,
            ...(mode.consumesAnchors ? { consumesAnchors: mode.consumesAnchors } : {}),
            params: mode.params,
            slots: mode.slots.map((slot) => ({
              kind: slot.kind,
              label: slot.label,
              ...(slot.max !== undefined ? { max: slot.max } : {}),
              ...(slot.characterIndexed ? { characterIndexed: true as const } : {}),
            })),
          }))
        : row.kind === "text" ? [{ modeId: "chat", vendorTerm: "chat", intent: "generate or rewrite text", hint: "", params: [], slots: [] }] : [],
      ...(archetype?.variants?.length
        ? {
            variants: archetype.variants.map((variant) => ({
              id: variant.id,
              label: variant.label,
              ...(variant.modelKey ? { modelKey: variant.modelKey } : {}),
            })),
            ...(archetype.defaultVariantId ? { defaultVariantId: archetype.defaultVariantId } : {}),
          }
        : {}),
    };
    // 可用性那三样 `ModelListingEntry` 已经算好，取出来即可，不重算。
    out.push({ entry, availability: { keyStatus: row.keyStatus, usable: row.usable, statusReason: row.statusReason } });
  }
  return out;
}
