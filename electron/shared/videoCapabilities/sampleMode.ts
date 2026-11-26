// 样片两步流程（先出低清样片、满意再拿样片号出成片）的通用部分：由父档案推出样片档案、出高清方式、约价改写。
// 只认父档案的 `sampleMode` 声明，不写任何供应商名、型号名；具体哪个模型有样片模式，由它自己的档案声明。
import type { ArchetypeMode, ArchetypeSampleSpec, ModelArchetype, ModelParameterControl } from "./types";

/** 出高清这一步的方式 id（不在 `modes` 里，方式菜单不列它）。 */
export const SAMPLE_FINAL_MODE_ID = "sample-final";

function narrowResolution(params: ModelParameterControl[], spec: ArchetypeSampleSpec, where: string): ModelParameterControl[] {
  return params.map((param) => {
    if (param.key !== "resolution") return param;
    const options = param.options.filter((option) => String(option.value) === spec.draftResolution);
    if (options.length !== 1) throw new Error(`${where}: resolution options lack the sample tier ${spec.draftResolution}`);
    return { ...param, options: options.map((option) => ({ ...option })), defaultValue: spec.draftResolution };
  });
}

function finalMode(spec: ArchetypeSampleSpec): ArchetypeMode {
  return {
    id: SAMPLE_FINAL_MODE_ID,
    intent: "single",
    vendorTerm: "出高清",
    hint: "用样片号出成片，不重发提示词和参考",
    promptRequired: false,
    transportTaskKind: "text_to_video",
    slots: [],
    params: [
      { key: "draft_task_id", label: "样片任务号", type: "text", options: [] },
      { key: "resolution", label: "清晰度", type: "select", options: spec.finalResolutions.map((value) => ({ value, label: value })), defaultValue: spec.finalResolutions[0] },
    ],
  };
}

/**
 * 由父档案推出样片档案：方式、参考槽、其它参数全跟父档案（同一份对象推出来，父改子跟）；
 * 只把清晰度收窄成样片档，再挂上样片规格和出高清方式。不许另抄一份完整档案（两份并行的真相）。
 */
export function deriveSampleArchetype(parent: ModelArchetype, input: {
  id: string;
  label: string;
  identifierPatterns: string[];
  /** 同一家里父模型的目录行：样片和出高清都按它约价。 */
  billedAs: { modelKey: string };
}): ModelArchetype {
  const spec = parent.sampleMode;
  if (!spec) throw new Error(`${parent.id} declares no sample spec (sampleMode)`);
  if (!spec.finalResolutions.length) throw new Error(`${parent.id}: sample spec has no final resolutions`);
  const { sampleMode: _parentOnly, legacyIds: _ownIds, ...shared } = parent;
  return {
    ...shared,
    id: input.id,
    label: input.label,
    identifierPatterns: input.identifierPatterns,
    modes: parent.modes.map((mode) => ({
      ...mode,
      params: narrowResolution(mode.params, spec, `${parent.id}/${mode.id}`),
      ...(mode.vendorParams
        ? { vendorParams: Object.fromEntries(Object.entries(mode.vendorParams).map(([vendor, params]) => [vendor, narrowResolution(params, spec, `${parent.id}/${mode.id}@${vendor}`)])) }
        : {}),
    })),
    sampleOf: { parentId: parent.id, spec, final: finalMode(spec), billedAs: { ...input.billedAs } },
  };
}

/** 档案里按 id 找方式：`modes` 之外，样片档案还认出高清方式。 */
export function findArchetypeMode<M extends ArchetypeMode>(archetype: { modes: readonly M[]; sampleOf?: { final: ArchetypeMode } }, modeId: string | null | undefined): M | undefined {
  if (!modeId) return undefined;
  const found = archetype.modes.find((mode) => mode.id === modeId);
  if (found) return found;
  return archetype.sampleOf && archetype.sampleOf.final.id === modeId ? (archetype.sampleOf.final as M) : undefined;
}

type BillableRequest = { kind: string; prompt?: string; extras?: Record<string, unknown> | null };

/**
 * 样片的约价请求 = 父行的同一请求（文档：样片按普通 480p 计费，成片按所请求的清晰度计费）。
 * - 发样片：传这次要发的请求（清晰度已是样片档），只把型号和档案换成父行；
 * - 出高清：传样片当时冻结的请求（来历里的 extras），再给成片清晰度——时长、音频等计价项都取样片那次的。
 * 发送键、出高清按钮、确认框都从这里取；不是样片档案的请求原样返回 null（调用方照常约价）。
 */
export function sampleBillingRequest<T extends BillableRequest>(request: T, archetype: ModelArchetype | null | undefined, finalResolution?: string): T | null {
  const sample = archetype?.sampleOf;
  const extras = request.extras;
  if (!sample || !extras) return null;
  const selection = extras.archetype && typeof extras.archetype === "object" ? (extras.archetype as Record<string, unknown>) : {};
  if (selection.id !== archetype!.id) return null;
  if (finalResolution && !sample.spec.finalResolutions.includes(finalResolution)) return null;
  const { draft_task_id: _final, ...priced } = extras;
  return {
    ...request,
    extras: {
      ...priced,
      modelKey: sample.billedAs.modelKey,
      modelAlias: sample.billedAs.modelKey,
      archetype: { ...selection, id: sample.parentId },
      ...(finalResolution ? { resolution: finalResolution } : {}),
    },
  };
}
