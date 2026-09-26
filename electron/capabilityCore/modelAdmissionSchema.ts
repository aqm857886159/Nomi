// 「这个模型此刻接受哪些参数、有哪些变体」——**全部 kind 的唯一准入判据**。
//
// 为什么这个文件今天才存在（2026-09-22 验收返工）：上一刀只给 video 接上了档案，
// 于是真实目录里 149/156（95.5%）个模块的 `parameterSchema` 是空的——image 58/61、
// audio 20/20、3d 5/5 全部落进准入层的「没有声明就放行」那条分支。实测同一批 82 个模型：
// main 静默丢弃 80/82 → 上一刀 82/82 **原样放行上 wire**，一次拒绝都没发生。
// 即那一刀对 95% 的模型只是把「静默丢」换成了「静默转发给供应商」。
//
// 根因不是准入层写错了，是**档案够不着**：image/audio/3D 的参数声明一直躺在渲染层
// （界面的参数面板就是照着它画的），主进程 import 不到。档案搬进
// `electron/shared/modelArchetypes` 之后，这份判据才真的能对全部 kind 成立。
//
// 与 video 的关系：video 走 `mcpGenerationVideoResolve` 那条更富的路（它还管 vendor 特化、
// 变体 modelKey 反查、多模式同 taskKind 的消歧），本文件**不重写它**，只在它认不出这个候选时
// 接手——即 image/audio/3D 以及「档案在、但不是视频候选」的那些。
import { resolveArchetypeForModel, resolveArchetypeVariant, specializeArchetypeForVariant } from "../shared/modelArchetypes";
import type { ArchetypeMode, ModelArchetype } from "../shared/modelArchetypes";
import type { ModelParameterControl } from "../shared/videoCapabilities/types";
import type { ExecutionContractCompileOptions, PlanCandidate } from "./executionContract";
import type { ParameterField } from "./moduleManifest";

/** 目录行里档案解析要用到的两样（`meta.archetypeId` 是非常规模型键钉档案的唯一凭据）。 */
export type CatalogRowIdentity = { modelAlias?: string | null; meta?: unknown };
/** 注入的「按 (providerId, modelId) 取目录行」缝——本模块不自己读目录（它是纯函数）。 */
export type CatalogRowLookup = (providerId: string, modelId: string) => CatalogRowIdentity | undefined;
let catalogRowLookup: CatalogRowLookup | undefined;
/** 装配期注入（见 `modelSpecRead.installCatalogRowLookup`）。不注入 = 退回「没有目录行」，行为与注入前一致。 */
export function setCatalogRowLookup(lookup: CatalogRowLookup | undefined): void { catalogRowLookup = lookup; }
export function catalogRowFor(providerId: string, modelId: string): CatalogRowIdentity | undefined {
  return catalogRowLookup?.(providerId, modelId);
}

const normalized = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : "";

/** 档案控件 → 准入字段。`select` 的选项集就是枚举；数值控件把声明过的范围带过来。 */
export function parameterFieldForControl(control: ModelParameterControl): ParameterField {
  const bounds = {
    ...(typeof control.min === "number" && Number.isFinite(control.min) ? { min: control.min } : {}),
    ...(typeof control.max === "number" && Number.isFinite(control.max) ? { max: control.max } : {}),
  };
  if (control.type === "select") {
    const values = control.options.map((option) => option.value);
    if (values.length > 0 && values.every((value) => typeof value === "string")) return { type: "enum", enum: values };
    if (values.length > 0 && values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return { type: "number", enum: values, ...bounds };
    }
    if (values.length > 0 && values.every((value) => typeof value === "boolean")) return { type: "boolean", enum: values };
    return control.options.some((option) => typeof option.value === "number") ? { type: "number", ...bounds } : { type: "string" };
  }
  if (control.type === "number") return { type: "number", ...bounds };
  if (control.type === "boolean") return { type: "boolean" };
  return { type: "string" };
}

/** 档案声明过的全部变体 id（含别名指向的 id，去重、保声明序）。 */
export function archetypeVariantIds(archetype: ModelArchetype): string[] {
  return [...new Set([
    ...(archetype.variants ?? []).map((variant) => variant.id),
    ...Object.values(archetype.variantIdAliases ?? {}),
  ])];
}

/**
 * 这个候选该按哪个模式校验。**认不出就返回 null**（宁可不判，也不拿错模式的参数表去拒人）：
 * 显式 `modeId` 最权威；否则按模式 id 或它的 transportTaskKind 对 `candidate.mode`；
 * 都对不上且该档案只有一个模式时用那一个（image 档案绝大多数如此）。
 */
export function archetypeModeForCandidate(archetype: ModelArchetype, candidate: PlanCandidate): ArchetypeMode | null {
  const modes = archetype.modes;
  const requestedModeId = normalized(candidate.modeId);
  if (requestedModeId) return modes.find((mode) => normalized(mode.id) === requestedModeId) ?? null;
  const wanted = normalized(candidate.mode);
  const byId = modes.find((mode) => normalized(mode.id) === wanted);
  if (byId) return byId;
  const byTask = modes.filter((mode) => normalized(mode.transportTaskKind ?? archetype.transportTaskKind) === wanted);
  if (byTask.length === 1) return byTask[0]!;
  if (byTask.length === 0 && modes.length === 1) return modes[0]!;
  return modes.find((mode) => normalized(mode.id) === normalized(archetype.defaultModeId)) ?? null;
}

/**
 * 非视频候选的准入选项（参数表 + 变体清单）。
 *
 * 认不出档案、或认不出该用哪个模式 → 返回 `{}`：那表示**这条路拿不到声明**，
 * 由准入层按「没有声明」处理（放行 + warning），而不是拿一份不确定的表去拒人。
 * 拿到了就是真判据：档案里声明了什么参数、什么取值，准入层照它判。
 */
export function archetypeCompileOptions(
  candidate: PlanCandidate,
  catalogRow?: CatalogRowIdentity,
): ExecutionContractCompileOptions {
  // `meta` / `modelAlias` **必须带上**：目录正是用 `meta.archetypeId` 给非常规键（`fal/...` 这种
  // 带斜杠的供应商键）钉档案的。2026-09-22 第二轮验收前这里写死 `meta: undefined`，
  // 于是 5 个 fal 模型在准入层「认不出档案」——而界面上它们的参数面板一直是满的。
  // 那不是固有缺口，是这两行丢了信息。
  const base = resolveArchetypeForModel({
    modelKey: candidate.modelId,
    modelAlias: catalogRow?.modelAlias ?? null,
    vendorKey: candidate.providerId,
    meta: catalogRow?.meta,
  });
  if (!base) return {};
  // 变体会覆盖参数（paramOverrides），所以先按候选选中的变体特化，再取模式参数。
  // 哪个变体问唯一 owner（带上模型名）：准入核的参数面必须就是派发那个变体的参数面。
  const archetype = specializeArchetypeForVariant(base, resolveArchetypeVariant(base, { variantId: candidate.variantId, modelId: candidate.modelId })?.id);
  const mode = archetypeModeForCandidate(archetype, candidate);
  if (!mode) return { allowedVariantIds: archetypeVariantIds(base) };
  return {
    parameterSchema: Object.fromEntries(mode.params.map((control) => [control.key, parameterFieldForControl(control)])),
    allowedVariantIds: archetypeVariantIds(base),
  };
}
