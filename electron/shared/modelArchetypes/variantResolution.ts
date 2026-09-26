/**
 * 「这一次生成跑哪个变体」的唯一判定（owner）。
 *
 * 2026-09-26（v0.22.1 发版阻断）：Agent 付费卡写着 Seedance 2.0「Fast」，宿主却按 standard 派发——卡上一个价、
 * 扣的是更贵的另一个。渲染层落到默认变体，宿主拿目录模型名反推；目录行 `doubao-seedance-2.0` 恰好就是
 * standard 变体的 key，所以宿主永远推成 standard。两边各一个 owner、答案相反，另有六七份副本各算各的
 * （合同 docs/fixes/2026-09-26-generation-variant-single-owner.root-cause.json）。
 *
 * 现在画布节点、付费卡、宿主派发、推荐、准入、参数特化全部问这里，同一组输入永远同一个答案。
 * 规则照渲染层早就写着的那条（archetypeMeta.normalizeArchetypeVariantMeta：「绝不能用基础串反推变体」）：
 *   1. 显式请求的变体（精确 id 或档案声明的历史别名，大小写不敏感）；
 *   2. 模型名是某个变体的**专属** key，且不是基础 key → 那个变体；
 *   3. 默认变体 → 第一个变体。
 * 基础 key = `catalogModelKey`，没有就取默认变体的 key——目录只列这一行，它说明不了用户要哪个变体。
 *
 * 单开这个只依赖类型的叶子模块（经 `modelArchetypes/index.ts` 导出）：index 加载时就要读视频档案桶，
 * 而视频侧（registry / recommendation）也要调它，放进 index 会成环。
 */
import type { ModelArchetypeVariant } from "../videoCapabilities/types";

/** 判定只读档案上这四样（图片档案与视频档案两份类型结构相同，都能传进来）。 */
export type VariantBearingArchetype = Readonly<{
  variants?: readonly ModelArchetypeVariant[];
  defaultVariantId?: string;
  catalogModelKey?: string;
  variantIdAliases?: Readonly<Record<string, string>>;
}>;

const normalized = (value: unknown): string => (typeof value === "string" ? value.trim().toLowerCase() : "");

/** 有效变体 id：精确 id 或声明的历史别名（大小写不敏感）→ 档案声明的那个 id；认不出 / 没有变体 → 空串。 */
export function canonicalArchetypeVariantId(archetype: VariantBearingArchetype, requested: unknown): string {
  const wanted = normalized(requested);
  const variants = archetype.variants ?? [];
  if (!wanted || variants.length === 0) return "";
  const direct = variants.find((variant) => variant.id.toLowerCase() === wanted);
  if (direct) return direct.id;
  const aliasTarget = Object.entries(archetype.variantIdAliases ?? {}).find(([alias]) => alias.toLowerCase() === wanted)?.[1];
  return aliasTarget ? variants.find((variant) => variant.id === aliasTarget)?.id ?? "" : "";
}

/** 默认变体（`defaultVariantId` → 第一个）；没有变体 → null。 */
function defaultVariantOf(archetype: VariantBearingArchetype): ModelArchetypeVariant | null {
  const variants = archetype.variants ?? [];
  return variants.find((variant) => variant.id === archetype.defaultVariantId) ?? variants[0] ?? null;
}

/** 目录里列出的那一行（基础 key）：`catalogModelKey`，没有就取默认变体的 key；没有变体 → undefined。 */
export function archetypeBaseModelKey(archetype: VariantBearingArchetype): string | undefined {
  return archetype.catalogModelKey?.trim() || defaultVariantOf(archetype)?.modelKey;
}

/**
 * 模型名是某个变体的**专属** key（变体自己的 modelKey 或它声明的身份串）且不是基础 key → 那个变体；否则 null。
 * 基础 key 永远返回 null：目录只列这一行，拿它反推变体就是本次事故。
 */
export function archetypeVariantForModelId(archetype: VariantBearingArchetype, modelId: unknown): ModelArchetypeVariant | null {
  const wanted = normalized(modelId);
  if (!wanted || wanted === normalized(archetypeBaseModelKey(archetype))) return null;
  return (archetype.variants ?? []).find((variant) => normalized(variant.modelKey) === wanted
    || (variant.identifierPatterns ?? []).some((identity) => normalized(identity) === wanted)) ?? null;
}

/**
 * 这一次生成跑哪个变体。没有变体的档案 → null（UI 不显示变体段，传输不带变体 model）。
 * 认不出的显式请求不在这里拒——拒绝要带合法清单，那是调用方（宿主准入）的事；这里按没请求处理。
 */
export function resolveArchetypeVariant(
  archetype: VariantBearingArchetype,
  input: Readonly<{ variantId?: unknown; modelId?: unknown }> = {},
): ModelArchetypeVariant | null {
  const variants = archetype.variants ?? [];
  if (variants.length === 0) return null;
  const requested = canonicalArchetypeVariantId(archetype, input.variantId);
  return variants.find((variant) => variant.id === requested)
    ?? archetypeVariantForModelId(archetype, input.modelId)
    ?? defaultVariantOf(archetype);
}
