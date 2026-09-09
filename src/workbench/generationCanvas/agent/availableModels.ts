import { getVendorPreference } from "../../api/vendorPreferenceApi";
import { orderByVendorPreference } from "../../../../electron/shared/contracts/vendorPreference";
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
import { parseModelParameterControls } from "../../../config/modelCatalogMeta";
import { resolveArchetypeForModel } from "../../../config/modelArchetypes";
import { preloadModelOptions } from "../../../config/modelCatalogCache";
import i18n from "../../../i18n";

import type { AgentModelEntry } from "../../../../electron/shared/agentCapabilities/availableModels";
export type { AgentModelEntry, AgentModelMode, AgentModelSlot } from "../../../../electron/shared/agentCapabilities/availableModels";

/**
 * 把 catalog 的 ModelOption[] join 档案后 flatten 成 agent 可选模型清单。纯函数，可单测。
 * 无档案的模型直接跳过。
 *
 * **去重键是 `(vendor, modelKey)`，不是 modelKey**——模型身份的唯一键包含供应商。
 * 2026-08-18 曾按 modelKey 去重（「首家胜出」），后果是两家供应商提供同名模型时身份坍缩：
 * 用户选 APIMart 的 Qwen-Image，请求实际发去 code-newcli-com（2026-09-03 真实付费闭环走查
 * 实测 HTTP 400 阻断，见 docs/plan/2026-09-03-storyboard-entry-vendor-identity.md §1 Bug 3）。
 * image/video 两边真正的重复由 `(vendor, modelKey, kind)` 之外的同源条目负责，不靠丢 vendor 实现。
 */
export function buildAgentModelEntries(options: readonly ModelOption[]): AgentModelEntry[] {
  const entries: AgentModelEntry[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const modelKey = option.modelKey ?? option.value;
    // 身份键含 vendor：同名模型来自不同供应商是**两个模型**，不是重复项。
    const identity = `${option.vendor ?? ""}::${modelKey}`;
    if (!modelKey || seen.has(identity)) continue;
    const archetype = resolveArchetypeForModel({
      modelKey: option.modelKey ?? option.value,
      modelAlias: option.modelAlias,
      vendorKey: option.vendor,
      meta: option.meta,
    });
    // Text/chat models deliberately have no media archetype. Their catalog kind
    // plus the published `chat` mode is sufficient to preserve an explicit
    // user/agent selection; dropping them here silently changes the request to
    // whatever default model happens to be mounted on the node.
    const kind = archetype?.kind ?? option.kind;
    if (!kind || (!archetype && kind !== "text")) continue;
    const modes = archetype
      ? archetype.modes.map((mode) => ({
          modeId: mode.id,
          vendorTerm: mode.vendorTerm,
          intent: mode.intent,
          hint: mode.hint,
          consumesAnchors: mode.consumesAnchors,
          params: mode.params,
          slots: mode.slots.map((slot) => ({
            kind: slot.kind,
            label: slot.label,
            max: slot.max,
            ...(slot.characterIndexed ? { characterIndexed: true as const } : {}),
          })),
        }))
      : [{
          modeId: "chat",
          vendorTerm: "对话",
          intent: "生成或改写文本",
          hint: i18n.t("generationCommon.agentRuntime.textModelHint"),
          params: parseModelParameterControls(option.meta),
          slots: [],
        }];
    seen.add(identity);
    entries.push({
      modelKey,
      modelAlias: option.modelAlias ?? null,
      vendor: option.vendor ?? null,
      label: option.label,
      kind,
      ...(archetype ? { archetypeId: archetype.id } : {}),
      defaultModeId: archetype?.defaultModeId ?? "chat",
      modes,
    });
  }
  return entries;
}

/** 拉取 image+video 两类真实可用模型，join 档案生成 agent 可选清单（渲染层，走 catalog IPC）。 */
export async function listAvailableModelsForAgent(): Promise<AgentModelEntry[]> {
  const [options, preference] = await Promise.all([
    Promise.all([
      preloadModelOptions("text", "chat"),
      preloadModelOptions("image"),
      preloadModelOptions("imageEdit"),
      preloadModelOptions("video"),
      preloadModelOptions("video", "image_to_video"),
    ]),
    getVendorPreference(),
  ]);
  return orderByVendorPreference(buildAgentModelEntries(options.flat()), preference.orderedVendorKeys, (row) => row.vendor);
}

/** Shared model identity preference for storyboard drafts and materialization. */
export function pickStoryboardDefaultModel(entries: readonly AgentModelEntry[], kind: 'image' | 'video'): AgentModelEntry | undefined {
  const candidates = entries.filter(entry => entry.kind === kind)
  const byName = (re: RegExp) => candidates.find(entry => re.test(`${entry.modelKey} ${entry.modelAlias ?? ''} ${entry.label}`))
  return kind === 'image'
    ? byName(/gpt[\s-]?image/i) ?? byName(/nano[\s-]?banana/i) ?? candidates[0]
    : byName(/seedance/i) ?? candidates[0]
}

/**
 * 分镜方案落画布时给镜头/定妆卡选的默认图片模型 + 两个模式（用户拍板 2026-06-15：image-first）。
 * 通用解析（不硬编码 vendor 目录，P4）：偏好 GPT Image → Nano Banana → 第一个可用图片模型
 * （总能给个默认；用户在画布上仍可自己换，不强制不禁用）。返回两个模式供调用方逐节点选：
 * - `modeId`：默认模式（纯文生，无必填输入图）——给定妆卡、以及**没有任何参考入边**的镜头用。
 * - `refModeId`：声明了 image_ref 槽的**图生图**模式——给**有参考入边**的镜头用（定妆卡→镜头、
 *   镜头→镜头的参考才喂得进，T8 能力校验）。GPT Image 2 的 i2i 输入图槽 `min:1`，故只给真有
 *   入边的镜头用，无入边的镜头用 `modeId` 免触发「必须≥1 张输入图」。无图生图模式 → `refModeId`
 *   省略（参考边在生成期按能力降级跳过，不假装喂入）。
 * 无任何可用图片模型 → 全空，节点不带模型、用户自己选。
 */
export async function resolveStoryboardImageDefault(): Promise<{ modelKey?: string; modelVendor?: string; modeId?: string; refModeId?: string }> {
  let entries: AgentModelEntry[]
  try {
    entries = await listAvailableModelsForAgent()
  } catch {
    return {}
  }
  const prefer = pickStoryboardDefaultModel(entries, 'image')
  if (!prefer) return {}
  const plainMode = prefer.modes.find((m) => m.modeId === prefer.defaultModeId) ?? prefer.modes[0]
  const refMode = prefer.modes.find((m) => m.slots.some((s) => s.kind === 'image_ref'))
  return {
    modelKey: prefer.modelKey,
    // vendor 与 key 一起返回：调用方据此写节点，避免落地时按 key 反查命中别家（身份唯一键）。
    ...(prefer.vendor ? { modelVendor: prefer.vendor } : {}),
    ...(plainMode ? { modeId: plainMode.modeId } : {}),
    ...(refMode ? { refModeId: refMode.modeId } : {}),
  }
}

/**
 * 分镜方案落画布时给镜头选的默认视频模型 + 模式（用户拍板 B-clean：有时长就是视频）。
 * 通用解析（不硬编码 vendor 目录，P4）：偏好 Seedance → 第一个可用视频模型。镜头会连定妆卡参考
 * （图→视频），故模式优先挑带 image_ref / first_frame 槽的 i2v（参考才喂得进），否则默认模式。
 * 无任何可用视频模型 → 全空，镜头不带模型、用户在画布上自己选；编辑器为某镜选了模型则覆盖本默认。
 */
export async function resolveStoryboardVideoDefault(): Promise<{ modelKey?: string; modelVendor?: string; modeId?: string }> {
  let entries: AgentModelEntry[]
  try {
    entries = await listAvailableModelsForAgent()
  } catch {
    return {}
  }
  const prefer = pickStoryboardDefaultModel(entries, 'video')
  if (!prefer) return {}
  const refMode = prefer.modes.find((m) => m.slots.some((s) => s.kind === 'image_ref' || s.kind === 'first_frame'))
  const mode = refMode ?? prefer.modes.find((m) => m.modeId === prefer.defaultModeId) ?? prefer.modes[0]
  return {
    modelKey: prefer.modelKey,
    // vendor 与 key 一起返回（身份唯一键）——见 buildAgentModelEntries 去重键的注释。
    ...(prefer.vendor ? { modelVendor: prefer.vendor } : {}),
    ...(mode ? { modeId: mode.modeId } : {}),
  }
}
