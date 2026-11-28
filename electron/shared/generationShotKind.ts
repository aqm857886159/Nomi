// 一镜是图还是视频，只有一个答案（2026-09-30 付费卡① 第 9 条）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 用户让 Agent「做一个封面，3:4」：画布上建的是视频节点、卡标题写「生成这 1 段视频？」，卡体却是图片模型和图片尺寸，
// 而且改不了；点下去才说「这一步没成」。根是两件事：
//   ① 种类是**猜**的——按提示词里的关键词（「镜头」「视频」…）判，不看点名的是图片模型还是视频模型；
//   ② 卡标题、卡体、画布节点、派发**各读各的**（模式字符串、模型自己的种类、节点种类、候选）。
//
// 现在只有一条路：种类只从「点名的模型 + 明写的模式」来，在建镜头那一刻定下（`resolveShotTaskKind`，
// 由 `semanticGenerationCandidate` 调用，矛盾的当场拒绝）；建好之后它就是候选上的 `mode`，四处都读
// `generationShotKind`——同一个函数、同一份输入。模式 → 媒体种类的映射本身住在 `capabilityModeManifest`
// （`modelKindForTaskKind`，模型准入用的也是它），这里不另抄一张表。
import type { BillingModelKind } from "../catalog/types";
import { modelKindForTaskKind } from "./capabilityModeManifest";
import type { GenerationDefaultTaskKind } from "./contracts/generationModelDefaultsContract";
import { isGenerationDefaultTaskKind } from "./contracts/generationModelDefaultsContract";
import { everyBuiltInArchetype, modeTransportFor, resolveModelArchetype } from "./modelArchetypes";
import { statedMode } from "./modelArchetypes/modeForInputs";
import { sourceBackedVideoProfiles } from "./videoCapabilities/registry";

/** 一镜出来的是图片还是视频。 */
export type GenerationShotKind = Extract<BillingModelKind, "image" | "video">;

/**
 * 这一镜是图还是视频（卡标题、卡体、画布节点、派发都读这一个）。
 *
 * 参考卡（anchor）恒为图片——它是定形象用的那张图；其余的镜按候选上的模式（建镜头时已经和点名的模型对过账）。
 * 认不出的模式（旧数据里不是四种生成任务之一的字符串）照旧按视频算：这是画布落地一直以来的兜底，
 * 现在所有读者共用这一个兜底，不会再有人说图片、有人说视频。
 */
export function generationShotKind(shot: Readonly<{ role?: string; candidate: Readonly<{ mode?: string }> }>): GenerationShotKind {
  if (shot.role === "anchor") return "image";
  return modelKindForTaskKind(shot.candidate.mode ?? "") === "image" ? "image" : "video";
}

/** 建一镜时种类定不下来的原因（调用方据此说人话）。 */
export type ShotTaskKindRefusal =
  /** 没写要哪一种，点名的模型也认不出（没点名，或目录里没有它）：不许按提示词猜。 */
  | Readonly<{ reason: "kind_unspecified" }>
  /**
   * 点名的模型做不了：写明了这一种它不做（`requested`），或者它根本不出图也不出视频（没有 `requested`）。
   * `declared` 是它在目录里声明的全部模式，拒绝时照实列出。
   */
  | Readonly<{ reason: "model_cannot_do"; requested?: GenerationDefaultTaskKind; declared: readonly string[] }>
  /** 点名的模型既能出图也能出视频，又没写要哪一种。 */
  | Readonly<{ reason: "model_ambiguous"; supported: readonly GenerationDefaultTaskKind[] }>;

export type ShotTaskKindVerdict =
  | Readonly<{ ok: true; taskKind: GenerationDefaultTaskKind }>
  | Readonly<{ ok: false; refusal: ShotTaskKindRefusal }>;

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]/g, "_");
}

/**
 * 建一镜时它要哪一种生成任务。**只看两样**：明写的种类（`taskKind` / 模式 / 模式 id 推出来的，调用方先归成一个），
 * 和点名的模型在目录里声明了哪些模式（`modelModes`，没点名或目录里没有它 = undefined）。提示词一个字都不看。
 *
 *   · 写明了：点名的模型做得了就用它，做不了当场拒绝（说清它能做什么）；没点名模型时照单收下（默认模型按它挑）。
 *   · 没写明：点名的模型只做一种媒体 → 就是那一种；同一种里有「带参考」与「不带参考」两档时，有参考图选前者——
 *     这是这一镜自己带没带参考图，不是猜；既做图又做视频 → 拒绝，请写明；没点名模型 → 拒绝，请写明或点名。
 */
export function resolveShotTaskKind(input: Readonly<{
  explicit?: GenerationDefaultTaskKind;
  modelModes?: readonly string[];
  hasReferences: boolean;
}>): ShotTaskKindVerdict {
  const declared = input.modelModes;
  const supported = declared ? [...new Set(declared.map(canonical).filter(isGenerationDefaultTaskKind))] : undefined;
  if (input.explicit) {
    if (declared && supported && !supported.includes(input.explicit)) {
      return { ok: false, refusal: { reason: "model_cannot_do", requested: input.explicit, declared } };
    }
    return { ok: true, taskKind: input.explicit };
  }
  if (!declared || !supported) return { ok: false, refusal: { reason: "kind_unspecified" } };
  if (supported.length === 0) return { ok: false, refusal: { reason: "model_cannot_do", declared } };
  const kinds = new Set(supported.map((taskKind) => modelKindForTaskKind(taskKind)));
  if (kinds.size > 1) return { ok: false, refusal: { reason: "model_ambiguous", supported } };
  const withInput = supported.find((taskKind) => taskKind === "image_edit" || taskKind === "image_to_video");
  const withoutInput = supported.find((taskKind) => taskKind === "text_to_image" || taskKind === "text_to_video");
  const chosen = input.hasReferences ? withInput ?? withoutInput : withoutInput ?? withInput;
  return chosen ? { ok: true, taskKind: chosen } : { ok: false, refusal: { reason: "kind_unspecified" } };
}

/**
 * 由明确的 `modeId` 推导它所属的 `GenerationDefaultTaskKind`（与画布 `modeForInputs` + `modeTransportFor` 同源，覆盖图/视全量档案）。
 * 点名了模型时优先在该模型的档案上查 `statedMode` → `modeTransportFor`；未点名模型时在全量内置档案上查唯一一致的 transport。
 */
export function taskKindForModeId(
  modeId: string,
  modelContext?: Readonly<{
    modelId?: string;
    vendor?: string | null;
    modelAlias?: string | null;
    meta?: unknown;
    variantId?: string;
  }>,
): GenerationDefaultTaskKind | undefined {
  const trimmed = modeId.trim();
  if (!trimmed) return undefined;
  const modelKey = modelContext?.modelId?.trim();
  const vendorKey = modelContext?.vendor?.trim() || undefined;
  if (modelKey) {
    const archetype = resolveModelArchetype(
      { modelKey, modelAlias: modelContext?.modelAlias ?? null, vendorKey, meta: modelContext?.meta },
      { variant: { variantId: modelContext?.variantId, modelId: modelKey } },
    );
    const mode = archetype ? statedMode(archetype, trimmed) : undefined;
    const transport = archetype && mode ? modeTransportFor(mode, archetype, vendorKey) : undefined;
    const mapped = transport ? canonical(transport) : "";
    if (isGenerationDefaultTaskKind(mapped)) return mapped;
  }
  // 未指定具体 modelId 时，统一扫描图/视等全量内置档案：只读模式自身声明的 transportTaskKind（及图像档案按有无参考槽对应的
  // image_edit / text_to_image），不把某家把全模式并进单端点的默认桶当成模式语义分歧；仅当全目录唯一无歧义（distinct.size === 1）
  // 时反推，像 "edit"（图改图 vs 视频编辑）或 "omni"（跨档案分属 text_to_video / image_to_video）返回 undefined。
  const distinct = new Set<GenerationDefaultTaskKind>();
  for (const archetype of [...everyBuiltInArchetype(), ...sourceBackedVideoProfiles()]) {
    const mode = statedMode(archetype, trimmed);
    if (!mode) continue;
    const raw = mode.transportTaskKind?.trim()
      || (archetype.kind === "image" ? (mode.slots.length > 0 ? "image_edit" : "text_to_image") : undefined);
    const mapped = raw ? canonical(raw) : "";
    if (isGenerationDefaultTaskKind(mapped)) distinct.add(mapped);
  }
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

/**
 * 一镜**明写**的种类：明确的 `modeId` 最具体（模式定了任务桶就定了，不再因冗余/惯性写的 `taskKind` 自相矛盾），
 * 其次是 `taskKind`，或者一个本身就是任务名的 `mode`。三种写法归成一个；一个都没写 = undefined（不按提示词猜）。
 */
export function statedShotTaskKind(
  written: Readonly<{ taskKind?: unknown; mode?: unknown; modeId?: unknown; modelId?: unknown; providerId?: unknown; variantId?: unknown }>,
): GenerationDefaultTaskKind | undefined {
  const modeId = typeof written.modeId === "string" ? written.modeId.trim() : "";
  const byModeId = modeId
    ? taskKindForModeId(modeId, {
        ...(typeof written.modelId === "string" ? { modelId: written.modelId } : {}),
        ...(typeof written.providerId === "string" ? { vendor: written.providerId } : {}),
        ...(typeof written.variantId === "string" ? { variantId: written.variantId } : {}),
      })
    : undefined;
  if (byModeId) return byModeId;
  if (typeof written.taskKind === "string" && isGenerationDefaultTaskKind(written.taskKind)) return written.taskKind;
  const mode = typeof written.mode === "string" ? canonical(written.mode) : "";
  if (isGenerationDefaultTaskKind(mode)) return mode;
  return undefined;
}
