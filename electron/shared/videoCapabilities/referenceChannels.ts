/**
 * 参考素材走哪条线缆通道 —— **由档案模式决定，不由 mapping body 猜**（唯一 owner）。
 *
 * ── 为什么必须是模式说了算 ──────────────────────────────────────────────────────
 * 同一条 create mapping 常常同时声明两条**互斥**的参考通道。Seedance 2.5 的 i2v body 里
 * `image_urls`（全能参考）与 `image_with_roles`（首帧 / 首尾帧）并排站着，官方按哪一族
 * 收素材，取决于用户选的是「首帧」还是「全能参考」——**body 本身答不出这个问题**。
 * 档案模式的 `combineSlotsInto` 就是这个答案的声明处（`seedance25Apimart.ts:66/82`）。
 *
 * 渲染层一直是这么做的（`archetypeMeta.ts buildArchetypeInputParams` 的合并槽那一段读
 * `mode.combineSlotsInto`）；Run 路径此前只看「body 里有没有 image_with_roles」
 * （`apimartGenerationProjection.ts` 旧的 `channels.has("image_with_roles")`），于是
 * 同一张参考图、同一个模型、同一次提交，两条路把它放进了**不同的 wire 键**
 * （对等矩阵 NEW-1 ×10）。这里把那句判断收成一个纯函数，两路同吃。
 *
 * ── 没有 modeId 时为什么答「不合并」而不是猜一个 ──────────────────────────────
 * headless 路（`catalog/taskParams.ts` 的 `projectReferencesOntoBodyKeys`）明确**跳过
 * 对象形态键**：`image_with_roles` 这种 `[{url, role}]` 只有拿得到模式的那一层才构造得对。
 * 所以「没有模式」的正确答案就是扁平族键（`image_urls` / `video_urls` / `audio_urls`），
 * 与手动路逐字节相同；猜一个模式正是 NEW-1 那条 bug 的形状。
 */
import { bodyReferencedParamKeys } from "../../catalog/paramTranslate";
import { parseCustomCapabilityContract } from "../customCapabilityContract";
import type { ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind, ModelArchetype } from "./types";
import { sourceBackedVideoProfiles } from "./registry";

/**
 * 参考槽种 → 供应商角色词的**唯一表**。画布路（`archetypeMeta.ts buildArchetypeInputParams`）和
 * Run 路（`apimartGenerationProjection.ts projectReferenceUrls`）都从这里取。
 * 五个值来自方舟 content[].role 官方字段表（first_frame / last_frame / reference_image / reference_video / reference_audio）。
 * 2026-11-07 从渲染层搬来：以前这张表只在渲染层有，Run 路把合同角色词（reference / character）直接
 * 当线上角色发，Wan 2.7 角色参考经 MCP / ProductionRun 发出 role "reference"，官方要 "reference_image"。
 */
export const REFERENCE_ROLE_FOR_KIND: Readonly<Partial<Record<ArchetypeReferenceSlotKind, string>>> = {
  first_frame: "first_frame",
  last_frame: "last_frame",
  image_ref: "reference_image",
  video_ref: "reference_video",
  audio_ref: "reference_audio",
};

/** 槽进角色数组时的线上 role：`slot.roleName` 覆盖，缺省按槽种派生；undefined = 这个槽种没有角色词。 */
export function combineRoleForSlot(slot: Pick<ArchetypeReferenceSlot, "kind" | "roleName">): string | undefined {
  return slot.roleName ?? REFERENCE_ROLE_FOR_KIND[slot.kind];
}

/** 参与合并的一个槽（按模式里的声明顺序）：它的槽种与线上 role。 */
export type CombineRoleSlot = { kind: ArchetypeReferenceSlotKind; role: string };

/**
 * 合并槽：本模式的参考槽序列化进**同一个** body 键。`flat` = 纯 URL 数组，否则 `[{url, role}]`。
 * `roleSlots`：真正并进去的槽（声明顺序；扁平通道只消费位置，不发送 role）；`combineSlotsInto.kinds` 声明了的，
 * 只并这几种，其余槽留在自己的扁平键上。
 */
export type ReferenceCombineChannel = { key: string; flat: boolean; roleSlots: readonly CombineRoleSlot[] } | null;

type CombineModeShape = Pick<ArchetypeMode, "combineSlotsInto"> & {
  slots?: ReadonlyArray<Pick<ArchetypeReferenceSlot, "kind" | "roleName">>;
};

/** 这个槽在本模式的合并里吗（flat 不看角色；非 flat 要有角色词；声明了 kinds 的只收那几种）。 */
export function slotJoinsCombine(mode: CombineModeShape, slot: Pick<ArchetypeReferenceSlot, "kind" | "roleName">): boolean {
  const declared = mode.combineSlotsInto;
  if (!declared) return false;
  if (declared.kinds && !declared.kinds.includes(slot.kind)) return false;
  return declared.flat === true || Boolean(combineRoleForSlot(slot));
}

/** 模式声明的合并槽（唯一读点；别在别处展开 `mode.combineSlotsInto`）。 */
export function combineChannelForMode(
  mode: CombineModeShape | null | undefined,
): ReferenceCombineChannel {
  const declared = mode?.combineSlotsInto;
  const key = typeof declared?.key === "string" ? declared.key.trim() : "";
  if (!mode || !key) return null;
  const flat = declared?.flat === true;
  const roleSlots = (mode.slots ?? []).flatMap((slot) => {
    const role = combineRoleForSlot(slot);
    return slotJoinsCombine(mode, slot) ? [{ kind: slot.kind, role: role ?? "" }] : [];
  });
  return { key, flat, roleSlots };
}

/** Encode one channel in declared slot order, preserving the order of references within each slot. */
export function lowerCombinedReferences(
  channel: NonNullable<ReferenceCombineChannel>,
  entries: ReadonlyArray<{ order: number; url: string }>,
): string[] | Array<{ url: string; role: string }> {
  const ordered = [...entries].sort((a, b) => a.order - b.order);
  return channel.flat ? ordered.map(({ url }) => url)
    : ordered.map(({ order, url }) => ({ url, role: channel.roleSlots[order]!.role }));
}

/**
 * Run 路：合同里的一条参考（素材种类 + 合同角色词）该落进哪个参与合并的槽、带哪个线上 role。
 * 合同角色词不是线上角色词：reference / character 都是图片参考槽，线上要发 reference_image。
 * 返回 null = 这一档模式的合并里没有收这种参考的槽（调用方决定走扁平键还是拒发）。
 */
export function combineRoleForContractReference(
  channel: ReferenceCombineChannel,
  reference: { kind?: string; role?: string },
): { role: string; order: number } | null {
  if (!channel) return null;
  const kind: ArchetypeReferenceSlotKind = reference.kind === "video" ? "video_ref"
    : reference.kind === "audio" ? "audio_ref"
      : reference.role === "first_frame" ? "first_frame"
        : reference.role === "last_frame" ? "last_frame"
          : "image_ref";
  const order = channel.roleSlots.findIndex((slot) => slot.kind === kind);
  return order < 0 ? null : { role: channel.roleSlots[order]!.role, order };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 模型 meta 上显式登记的档案 id（与 `capabilityModeManifest.explicitArchetypeId` 同口径）。 */
function explicitArchetypeId(meta: unknown): string {
  const metadata = record(meta);
  if (!metadata) return "";
  return trim(metadata.archetypeId) || trim(record(metadata.archetype)?.id);
}

function builtInArchetypeById(archetypeId: string): ModelArchetype | null {
  if (!archetypeId) return null;
  return sourceBackedVideoProfiles().find((profile) => profile.id === archetypeId
    || profile.legacyIds?.includes(archetypeId)) ?? null;
}

/** 这个模型的这一档模式（用户自写契约优先，其次内置档案）；找不到 → null。 */
export function archetypeModeForModel(input: {
  meta: unknown;
  kind?: string;
  modeId?: string;
}): ArchetypeMode | null {
  const modeId = trim(input.modeId);
  if (!modeId) return null;
  const contract = parseCustomCapabilityContract(input.meta);
  if (contract && (!input.kind || contract.kind === trim(input.kind))) {
    return contract.modes.find((mode) => mode.id === modeId) ?? null;
  }
  const archetype = builtInArchetypeById(explicitArchetypeId(input.meta));
  return archetype?.modes.find((mode) => mode.id === modeId) ?? null;
}

/**
 * 这次提交的参考素材走哪条通道。`createBody` 是这条 mapping 真正会渲染的 body：
 * 模式声明了合并槽、但这条渠道的 body 根本不引用那个键时，合并槽发不出去 → 退回扁平族键。
 */
export function referenceCombineChannelFor(input: {
  meta: unknown;
  kind?: string;
  modeId?: string;
  createBody: unknown;
}): ReferenceCombineChannel {
  const channel = combineChannelForMode(archetypeModeForModel(input));
  if (!channel) return null;
  return bodyReferencedParamKeys(input.createBody).includes(channel.key) ? channel : null;
}
