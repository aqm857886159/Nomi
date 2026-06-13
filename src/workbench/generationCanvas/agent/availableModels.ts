// 可用模型清单生成器：把 catalog 真实可用的模型 join 上各自档案（archetype），
// flatten 成 agent 可读 / 计划清单卡可渲染的清单。
//
// 两条关键约束（来自 bug① spike）：
//  1. 只收**有档案**的模型——agent 只对有 archetype 的模型选模型/配参数，避免对缺档案的模型
//     手配漂移（同 onboarding「缺 archetype 先补再配」纪律）。
//  2. 只暴露**真实可用**的 modelKey（来自 catalog 实际接入），避开 useNodeModelAutoSelect 的
//     effect3（供应商断开自愈）覆盖 agent 选择。
//
// 参数随 (model × mode × vendor) 三元组变：每个 model 带 modes[]，每个 mode 带自己的 params
// （resolveArchetypeForModel 内部已按 vendor 特化）。agent 必须同时选 modelKey + modeId。
import type { ModelOption } from "../../../config/models";
import type { ModelParameterControl } from "../../../config/modelCatalogMeta";
import type { ArchetypeReferenceSlotKind } from "../../../config/modelArchetypes";
import { resolveArchetypeForModel } from "../../../config/modelArchetypes";
import { preloadModelOptions } from "../../../config/modelCatalogCache";

/** 该模式声明的一个参考槽——agent 据此知道这个模式吃哪些参考、各能吃几张，从而只连模型真支持的边。 */
export type AgentModelSlot = {
  kind: ArchetypeReferenceSlotKind;
  /** 模型自己的槽名（vendor 原词，如「角色参考」「首帧」）。 */
  label: string;
  max: number;
  /** 角色参考（按序对应 prompt 的 character1..N）。 */
  characterIndexed?: boolean;
};

export type AgentModelMode = {
  modeId: string;
  /** 模型自己的叫法（vendor 原词，如「全能参考」）——计划卡副标签 + agent 提示用真名。 */
  vendorTerm: string;
  intent: string;
  hint: string;
  params: ModelParameterControl[];
  /** 该模式支持的参考槽（空=纯文生，不接任何参考边）。喂给 agent 让它按模型真实能力连边（T8）。 */
  slots: AgentModelSlot[];
};

export type AgentModelEntry = {
  modelKey: string;
  modelAlias: string | null;
  vendor: string | null;
  label: string;
  kind: "image" | "video";
  archetypeId: string;
  defaultModeId: string;
  modes: AgentModelMode[];
};

/**
 * 把 catalog 的 ModelOption[] join 档案后 flatten 成 agent 可选模型清单。纯函数，可单测。
 * 无档案的模型直接跳过；同一 modelKey 去重（image/video 两边可能重复）。
 */
export function buildAgentModelEntries(options: readonly ModelOption[]): AgentModelEntry[] {
  const entries: AgentModelEntry[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const modelKey = option.modelKey ?? option.value;
    if (!modelKey || seen.has(modelKey)) continue;
    const archetype = resolveArchetypeForModel({
      modelKey: option.modelKey ?? option.value,
      modelAlias: option.modelAlias,
      vendorKey: option.vendor,
      meta: option.meta,
    });
    if (!archetype) continue;
    seen.add(modelKey);
    entries.push({
      modelKey,
      modelAlias: option.modelAlias ?? null,
      vendor: option.vendor ?? null,
      label: option.label,
      kind: archetype.kind,
      archetypeId: archetype.id,
      defaultModeId: archetype.defaultModeId,
      modes: archetype.modes.map((mode) => ({
        modeId: mode.id,
        vendorTerm: mode.vendorTerm,
        intent: mode.intent,
        hint: mode.hint,
        params: mode.params,
        slots: mode.slots.map((slot) => ({
          kind: slot.kind,
          label: slot.label,
          max: slot.max,
          ...(slot.characterIndexed ? { characterIndexed: true as const } : {}),
        })),
      })),
    });
  }
  return entries;
}

/** 拉取 image+video 两类真实可用模型，join 档案生成 agent 可选清单（渲染层，走 catalog IPC）。 */
export async function listAvailableModelsForAgent(): Promise<AgentModelEntry[]> {
  const [imageOptions, videoOptions] = await Promise.all([
    preloadModelOptions("image"),
    preloadModelOptions("video"),
  ]);
  return buildAgentModelEntries([...imageOptions, ...videoOptions]);
}

/** 从一个模式的 duration 参数取最大时长（number 型取 max；select 型取选项最大值）。无则 undefined。 */
function maxDurationFromMode(mode: AgentModelMode): number | undefined {
  const dur = mode.params.find((param) => param.key === 'duration')
  if (!dur) return undefined
  if (typeof dur.max === 'number') return dur.max
  const nums = (dur.options ?? []).map((opt) => Number(opt.value)).filter((n) => Number.isFinite(n))
  return nums.length ? Math.max(...nums) : undefined
}

/**
 * 分镜方案落画布时给视频镜头选的默认模型 + 模式 + 时长上限（S4）。
 * 通用解析（不硬编码某 vendor，P4）：偏好名字含 seedance 的视频模型，否则取第一个可用视频模型；
 * 模式选**声明了 image_ref 槽的那个**——角色/场景参考边（character_ref/style_ref→image_ref）
 * 才连得上、喂得进（Seedance 即「全能参考」omni 模式）；无则回退默认模式。无可用视频模型 → 全空。
 */
export async function resolveStoryboardVideoDefault(): Promise<{ modelKey?: string; modeId?: string; maxDurationSec?: number }> {
  let entries: AgentModelEntry[] = []
  try {
    entries = await listAvailableModelsForAgent()
  } catch {
    return {}
  }
  const videos = entries.filter((entry) => entry.kind === 'video')
  if (videos.length === 0) return {}
  const prefer =
    videos.find((entry) => /seedance/i.test(`${entry.modelKey} ${entry.modelAlias ?? ''} ${entry.label}`)) ?? videos[0]
  const refMode =
    prefer.modes.find((mode) => mode.slots.some((slot) => slot.kind === 'image_ref')) ??
    prefer.modes.find((mode) => mode.modeId === prefer.defaultModeId) ??
    prefer.modes[0]
  return {
    modelKey: prefer.modelKey,
    ...(refMode ? { modeId: refMode.modeId, maxDurationSec: maxDurationFromMode(refMode) } : {}),
  }
}

/**
 * 分镜方案落画布时给定妆卡/场景卡选的默认图片模型（用户拍板：推荐而非强制锁）。
 * 偏好级联（通用解析，不硬编码 vendor 目录，P4）：GPT Image → 没有则 Nano Banana →
 * 再没有则取第一个可用图片模型（总能给个默认；用户在画布上仍可自己换，不强制不禁用）。
 * 无任何可用图片模型 → 全空，节点不带模型、用户自己选。
 */
export async function resolveStoryboardImageDefault(): Promise<{ modelKey?: string; modeId?: string }> {
  let entries: AgentModelEntry[] = []
  try {
    entries = await listAvailableModelsForAgent()
  } catch {
    return {}
  }
  const images = entries.filter((entry) => entry.kind === 'image')
  if (images.length === 0) return {}
  const byName = (re: RegExp) =>
    images.find((entry) => re.test(`${entry.modelKey} ${entry.modelAlias ?? ''} ${entry.label}`))
  const prefer = byName(/gpt[\s-]?image/i) ?? byName(/nano[\s-]?banana/i) ?? images[0]
  const mode = prefer.modes.find((m) => m.modeId === prefer.defaultModeId) ?? prefer.modes[0]
  return { modelKey: prefer.modelKey, ...(mode ? { modeId: mode.modeId } : {}) }
}

/** 把可选模型清单格式化成注入 agent 系统提示词的紧凑文本。空清单返回 ''（不注入）。 */
export function formatAvailableModelsForPrompt(entries: readonly AgentModelEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((entry) => {
    const modes = entry.modes
      .map((m) => {
        // 每个模式带它的参考槽——agent 据此知道这个模式吃哪些参考、各能吃几张，只连模型真支持的边。
        const slots = m.slots.length
          ? `[参考槽:${m.slots.map((s) => `${s.label}${s.max > 1 ? `×${s.max}` : ""}`).join("/")}]`
          : "[纯文生,不接参考边]";
        return `${m.modeId}(${m.vendorTerm})${slots}`;
      })
      .join(" / ");
    const params =
      entry.modes[0]?.params
        .map((p) => {
          const opts = p.options?.map((o) => o.value).join(",");
          return opts ? `${p.key}[${opts}]` : p.key;
        })
        .join(" ") ?? "";
    return `- modelKey=${entry.modelKey}（${entry.label}，${entry.kind}）模式: ${modes}；参数: ${params}`;
  });
  return [
    "可用模型（为每个节点选一个，在 create_canvas_nodes 的节点里给出 modelKey、可选 modeId、params）：",
    ...lines,
    "规则：modelKey 必须用上面列出的；modeId 用该模型的模式 id；params 用对应模型/模式支持的取值（如 aspect_ratio=9:16）。用户会在确认卡上调整，配错会被自动纠正。",
    "连参考边只连目标模型支持的：character_ref/style_ref/composition_ref 需要目标模式有图片参考槽（角色参考/参考图/输入图）；first_frame/last_frame 需要对应的首/尾帧槽；纯文生模式（无参考槽）不要连任何参考边。文本/镜头/输出节点不能作参考源（它们没有可参考的产物）。配错的边会被跳过并在 skippedEdges 里告知原因。",
  ].join("\n");
}
