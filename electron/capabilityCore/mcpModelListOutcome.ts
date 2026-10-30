// Model-list text and structured counts project the same canonical usability rows.
import type { ResultLocale, ToolOutcome } from './mcpToolResults'
type Ctx = { locale: ResultLocale }
const L = (ctx: Ctx, zh: string, en: string): string => ctx.locale === 'en' ? en : zh
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const KEY_STATUS_LABEL: Record<string, { zh: string; en: string }> = {
  ok: { zh: "可用", en: "usable" },
  missing: { zh: "未配 Key", en: "no API key" },
  locked: { zh: "Key 解不开", en: "key locked" },
};

/** 一个模型的参考能力压成一句短标签（只在真能带参考时出，纯文生模型不占字）。 */
/** 薄名单那一行的能力位 → 一小截人话（这个模型吃不吃图/视频/音频参考）。 */
function acceptsTag(ctx: Ctx, accepts: Record<string, unknown>): string {
  const kinds: string[] = [];
  if (accepts.image)
    kinds.push(L(ctx, accepts.multiImage ? "多图" : "图", accepts.multiImage ? "multi-image" : "image"));
  if (accepts.video) kinds.push(L(ctx, "视频", "video"));
  if (accepts.audio) kinds.push(L(ctx, "音频", "audio"));
  return kinds.length ? `${L(ctx, "参考", "refs")}:${kinds.join("+")}` : "";
}

/** 交付1 · 模型清单 → 双语转述（按 keyStatus 分组，只有 ok 说可用）+ 结构化透传（模型精确读）。 */
export function buildListModelsOutcome(ctx: Ctx, value: Record<string, unknown>): ToolOutcome {
  const models = Array.isArray(value.models) ? (value.models as Array<Record<string, unknown>>) : [];
  if (models.length === 0) {
    return {
      text: L(
        ctx,
        "没有已启用的模型。请先在 Nomi 应用的模型接入里添加并配置 API Key。",
        "No enabled models. Add and configure one in Nomi settings first.",
      ),
      outcome: { kind: "model_list", total: 0, usable: 0, models: [] },
    };
  }
  const line = (m: Record<string, unknown>): string => {
    const status = str(m.keyStatus) || "missing";
    const label = m.usable !== true && status === "ok"
      ? { zh: "不可用", en: "unavailable" }
      : KEY_STATUS_LABEL[status] || KEY_STATUS_LABEL.missing;
    const modes = Array.isArray(m.modeIds) && m.modeIds.length ? `@${(m.modeIds as string[]).join("/")}` : "";
    const refTag = acceptsTag(ctx, rec(m.accepts)) + modes;
    const variants =
      Array.isArray(m.variantIds) && m.variantIds.length
        ? ` · ${L(ctx, "变体", "variants")}:${(m.variantIds as string[]).join("/")}`
        : "";
    const head = `${str(m.vendor)} · ${str(m.modelId)}（${str(m.label)}, ${str(m.kind)}）${variants}`;
    const tail =
      m.usable === true
        ? `✓ ${L(ctx, label.zh, label.en)}${refTag ? " · " + refTag : ""}`
        : `✗ ${L(ctx, label.zh, label.en)}——${str(m.statusReason)}`;
    return `  ${head} ${tail}`;
  };
  const usable = models.filter((m) => m.usable === true);
  const blocked = models.filter((m) => m.usable !== true);
  const needsCredentials = blocked.some((m) => str(m.keyStatus) !== "ok");
  const text = [
    L(
      ctx,
      `可用模型 ${usable.length} 个（usable=true，选型只挑这些）。要参数/取值/参考槽，用 nomi_read{target:"model", modelId} 查那一个：`,
      `${usable.length} usable model(s) (usable=true — pick from these). For parameters, values and reference slots call nomi_read{target:"model", modelId}:`,
    ),
    ...(usable.length
      ? usable.map(line)
      : [needsCredentials
        ? L(ctx, "  （无——请先配置 API Key）", "  (none — configure an API key first)")
        : L(ctx, "  （无——请检查模型接入状态）", "  (none — inspect model setup)")]),
    ...(blocked.length
      ? [
          L(
            ctx,
            `另有 ${blocked.length} 个已列出但暂不可用（原因见各模型）：`,
            `${blocked.length} listed but not usable (see each model’s reason):`,
          ),
          ...blocked.map(line),
        ]
      : []),
  ].join("\n");
  return {
    text,
    outcome: {
      kind: "model_list",
      total: models.length,
      usable: usable.length,
      // 结构化原样透传逐模型真话字段（模型精确读，不必从文本抠）。
      // 薄名单**原样透传**：这一层不再自己挑字段重投一遍（那是第三份手写投影，
      // 2026-09-22 之前它还在用已经不存在的 modelKey/references 两个字段）。
      models,
      nextActions: usable.length ? ["pick_model"] : needsCredentials ? ["configure_api_key"] : ["inspect_model"],
    },
  };
}
