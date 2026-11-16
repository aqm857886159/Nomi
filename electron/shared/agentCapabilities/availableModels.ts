import type { ModelParameterControl, ArchetypeReferenceSlotKind } from "../videoCapabilities/types";

/** 该模式声明的一个参考槽——agent 据此知道这个模式吃哪些参考、各能吃几张，从而只连模型真支持的边。 */
export type AgentModelSlot = {
  kind: ArchetypeReferenceSlotKind;
  /** 模型自己的槽名（vendor 原词，如「角色参考」「首帧」）。 */
  label: string;
  max?: number;
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
  /** Derived by the archetype policy owner; never recomputed by the prompt layer. */
  consumesAnchors?: readonly string[];
};

/** 档案声明的一个变体（`Seedance 2.0` 的 standard/fast/mini 这种）。 */
export type AgentModelVariant = {
  /** 下单时填进 `variantId` 的那个词。 */
  id: string;
  label: string;
  /** 这个变体在供应商那边的真实模型名（诊断用；下单不填它）。 */
  modelKey?: string;
};

export type AgentModelEntry = {
  /**
   * 目录里这个模型的 id。**模型面与宿主面同名**（`draft_shots` 的 `shots[].modelId`、
   * `candidate.modelId`、宿主候选的 `modelId` 全是这一个词）——2026-09-18 之前这里叫 `modelKey`，
   * 而 `list_models` 把这份条目原样 JSON 给模型看（`laneModelRead.mts`），于是模型**读到 `modelKey`、
   * 必须填 `modelId`**：一个名字出来、另一个名字进去，中间没有任何提示。那正是当天挖到的 D 类。
   * 画布节点 meta 与目录状态（`CatalogState.models[].modelKey`）仍叫 `modelKey`：它们是宿主自己的
   * 持久化字段，落在 `project.json` 里，不是模型看的那一面。
   */
  modelId: string;
  modelAlias: string | null;
  vendor: string | null;
  label: string;
  /**
   * 用户在界面上看到的这个模型的名字（卡上、模型框、设置里同一个，按界面语言翻好）。**Agent 对用户提到模型时只许说它**，
   * `modelId` / `vendor` 是给工具参数用的内部标识，用户不认。缺席 = 渲染层没给，Agent 退回 `label`。
   */
  displayName?: string;
  kind: "text" | "image" | "video" | "audio" | "model3d";
  /** Media models have a stable archetype; chat models are catalog-defined and need none. */
  archetypeId?: string;
  defaultModeId: string;
  modes: AgentModelMode[];
  /**
   * 这个模型的变体。2026-09-22 之前**根本不投**，而准入层已经会拒未知 `variantId`
   * ——即「可被拒、不可发现」：模型被要求填一个它无从知道的值（验收实测 P01「用 Seedance 2.0
   * 的 Mini 档」两次都写不出 `variantId:"mini"`）。这正是 OpenAI 那条
   * *"Don't make the model fill arguments you already know"* 的反面。
   */
  variants?: AgentModelVariant[];
  /** 不填 `variantId` 时落到哪个（模型据此知道默认是什么，不必猜）。 */
  defaultVariantId?: string;
};

/** Shared instruction text for the full catalog and the stable discovery index. */
export const MODEL_ANCHOR_GUIDANCE = [
  "引用视觉锚就必须显式选择能吃图片的模式，模型和模式都不能留空；未指定时优先该模型吃得下锚的模式。",
  "用户点名 t2v 就听用户，不自动改模式或删锚；方案摘要必须说明哪些镜的参考图不会被使用，并给出换同模型 i2v / 去掉视觉锚的纠正。",
] as const;

/** 把可选模型清单格式化成注入 agent 用户消息的紧凑文本。空清单返回 ''（不注入）。 */
export function formatAvailableModelsForPrompt(entries: readonly AgentModelEntry[]): string {
  if (entries.length === 0) return "";
  const lines = [...entries].sort((a, b) => a.kind.localeCompare(b.kind) || a.modelId.localeCompare(b.modelId) || (a.vendor ?? "").localeCompare(b.vendor ?? "")).map((entry) => {
    const modes = entry.modes
      .map((m) => {
        // 每个模式带它的参考槽——agent 据此知道这个模式吃哪些参考、各能吃几张，只连模型真支持的边。
        const slots = m.slots.length
          ? `[参考槽:${m.slots.map((s) => `${s.label}${s.max !== undefined && s.max > 1 ? `×${s.max}` : ""}`).join("/")}]`
          : "[纯文生,不接参考边]";
        return `${m.modeId}(${m.vendorTerm})${m.consumesAnchors ? `[consumesAnchors:${m.consumesAnchors.join(",")}]` : ""}${slots}`;
      })
      .join(" / ");
    const params =
      entry.modes[0]?.params
        .map((p) => {
          const opts = p.options?.map((o) => o.value).join(",");
          return opts ? `${p.key}[${opts}]` : p.key;
        })
        .join(" ") ?? "";
    return `- modelId=${entry.modelId}（${entry.label}，${entry.kind}）模式: ${modes}；参数: ${params}`;
  });
  return [
    "可用模型（为每个分镜/节点选一个）：",
    ...lines,
    ...MODEL_ANCHOR_GUIDANCE,
    "规则：modelId 必须用上面列出的；modeId 用该模型的模式 id；params 用对应模型/模式支持的取值（如 aspect_ratio=9:16）。用户会在确认卡上调整，配错会被自动纠正。",
    "连参考边只连目标模型支持的：character_ref/style_ref/composition_ref 需要目标模式有图片参考槽（角色参考/参考图/输入图）；first_frame/last_frame 需要对应的首/尾帧槽；纯文生模式（无参考槽）不要连任何参考边。文本/镜头/输出节点不能作参考源（它们没有可参考的产物）。配错的边会被跳过并在 skippedEdges 里告知原因。",
  ].join("\n");
}
