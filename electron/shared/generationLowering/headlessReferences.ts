/**
 * 没有档案模式可读时（headless / MCP、Run 没带 modeId）的放置：**按 body 推一份声明**，再交给唯一的降级函数。
 *
 * 以前这一段是 taskParams 里的 headless 投影自己挑键、自己定形状、自己写值——三份拼法之一。
 * 现在它只回答「这条 body 有哪几个参考位、各收什么」（推导只读 shared 的键声明表：族、多值、形状、帧意图，
 * 不按键名猜），放进去的那一步交给 `lowerGenerationIntent`，与画布、Run 同一个函数。
 *
 * 推导规则（与旧行为逐字节一致，S3 的验收就是逐格请求体比较）：
 *  · 帧意图优先：调用方明确给了首帧 / 尾帧，且 body 有声明为该帧的空位 → 放那里，并从族池里取走这张；
 *  · 每族至多一个位：优先多值键（扁平列表的天然去处），没有才用单值键（单值位只放第一张）；
 *  · 跳过对象形态键（角色数组 / content 项）与派生载体：它们只有拿得到模式的那一层才造得对；
 *  · 既有值优先：键上已经有值（调用方显式给，或画布已放好）→ 不碰；
 *  · 画布已经放好、且没有另外的平铺来源 → 这一族不再放第二个键。
 *
 * 不读盘、不认供应商名。读「携带了哪些参考」是调用方的事（taskParams），这里只收读好的结果。
 */
import { bodyReferencedParamKeys } from "../../catalog/paramTranslate";
import {
  referenceFrameKindFor,
  referenceKeyCapacityDeclarationFor,
  referenceKeyShapeFor,
  type ReferenceFamily,
  type ReferenceFrameKind,
  type ReferenceModelContext,
} from "../modelArchetypes/referenceKeys";
import type { ArchetypeReferenceSlotKind } from "../videoCapabilities/types";
import { lowerGenerationIntent, type IntentReference, type LoweringSlot } from "./lowerGenerationIntent";

type FamilyUrls = Readonly<Record<ReferenceFamily, readonly string[]>>;

/** 调用方读好的参考来源。 */
export type HeadlessReferenceSources = Readonly<{
  /** 每族携带的全部参考（标准输入键 + 画布已放好的 + 声明的 Comfy 参考）。 */
  carried: FamilyUrls;
  /** 同上，但不含画布已放好的那一份。 */
  flat: FamilyUrls;
  /** 画布已经放好的那一份（`archetypeInput`）。 */
  placedByCanvas: FamilyUrls;
  /** 调用方明确说了「这一张是首帧 / 尾帧」。 */
  frames: Readonly<Partial<Record<ReferenceFrameKind, string>>>;
  /** 这个键上已经有值 → 不覆盖。 */
  occupied: (key: string) => boolean;
  /** 标准聚合位 `reference_images` 由模板参数层自己从 `referenceImages` 造，这里不再放一份。 */
  standardAggregateCarried: boolean;
}>;

export type HeadlessCapacityProblem = Readonly<{ family: ReferenceFamily; max: number; count: number }>;

const ARRAY_KIND_FOR_FAMILY: Readonly<Record<ReferenceFamily, ArchetypeReferenceSlotKind>> = {
  image: "image_ref",
  video: "video_ref",
  audio: "audio_ref",
};
const FAMILY_FOR_KIND: Readonly<Partial<Record<ArchetypeReferenceSlotKind, ReferenceFamily>>> = {
  first_frame: "image", last_frame: "image", image_ref: "image", video_ref: "video", audio_ref: "audio",
};
const FAMILIES: readonly ReferenceFamily[] = ["image", "video", "audio"];

/**
 * 按 body 推声明并降级。返回新放的参数（调用方并进 extras），和超过声明张数的问题（调用方在花钱前拒）。
 */
export function lowerHeadlessReferences(
  createBody: unknown,
  sources: HeadlessReferenceSources,
  context?: ReferenceModelContext,
): { bodyParams: Record<string, unknown>; problems: readonly HeadlessCapacityProblem[] } {
  if (FAMILIES.every((family) => sources.carried[family].length === 0)) return { bodyParams: {}, problems: [] };
  const bodyKeys = bodyReferencedParamKeys(createBody);
  const slots: LoweringSlot[] = [];
  const intent: IntentReference[] = [];
  const consumed = new Set<string>();
  const used = new Set<string>();

  for (const frame of ["first_frame", "last_frame"] as const) {
    const url = sources.frames[frame]?.trim();
    if (!url) continue;
    const key = bodyKeys.find((candidate) => {
      const declaration = referenceKeyCapacityDeclarationFor(candidate, context);
      if (!declaration || referenceFrameKindFor(candidate) !== frame) return false;
      const shape = referenceKeyShapeFor(candidate, declaration.multiImage);
      return shape !== "role-objects" && shape !== "content-items" && !sources.occupied(candidate);
    });
    if (!key) continue;
    intent.push({ url, slot: slots.length });
    slots.push({ kind: frame, inputKey: key, asArray: false });
    consumed.add(url);
    used.add(key);
  }
  const pool = (urls: readonly string[]) => urls.filter((url) => !consumed.has(url));

  const chosen: Partial<Record<ReferenceFamily, { key: string; list: boolean; max?: number }>> = {};
  for (const key of bodyKeys) {
    if (used.has(key)) continue;
    const declaration = referenceKeyCapacityDeclarationFor(key, context);
    if (!declaration) continue;
    const shape = referenceKeyShapeFor(key, declaration.multiImage);
    if (shape !== "single" && shape !== "list") continue;
    if (pool(sources.carried[declaration.family]).length === 0) continue;
    if (key === "reference_images" && sources.standardAggregateCarried) continue;
    if (sources.occupied(key)) continue;
    const current = chosen[declaration.family];
    if (!current || (shape === "list" && !current.list)) {
      chosen[declaration.family] = { key, list: shape === "list", ...(declaration.max === undefined ? {} : { max: declaration.max }) };
    }
  }

  for (const family of Object.keys(chosen) as ReferenceFamily[]) {
    const placed = sources.placedByCanvas[family];
    const hasDistinctFlatSource = pool(sources.flat[family]).some((url) => !placed.includes(url));
    if (placed.length > 0 && !hasDistinctFlatSource) continue;
    const target = chosen[family]!;
    const urls = pool(sources.carried[family]);
    const slot = slots.length;
    // 单值位只放第一张（沿用 firstReferenceImage 的优先级）；张数上限仍按全部携带的数（超了就拒，不静默截）。
    if (target.max !== undefined && urls.length > target.max) {
      return { bodyParams: {}, problems: [{ family, max: target.max, count: urls.length }] };
    }
    slots.push({ kind: ARRAY_KIND_FOR_FAMILY[family], inputKey: target.key, asArray: target.list });
    for (const url of target.list ? urls : urls.slice(0, 1)) intent.push({ url, slot });
  }

  const lowered = lowerGenerationIntent(
    { slots, combine: null, joinsCombine: slots.map(() => false) },
    { references: intent },
  );
  const problems = lowered.problems.flatMap((problem) => problem.code === "reference_over_capacity"
    ? [{ family: FAMILY_FOR_KIND[problem.kind] ?? "image", max: problem.max, count: problem.count }]
    : []);
  return { bodyParams: lowered.bodyParams, problems };
}
