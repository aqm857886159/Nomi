/**
 * 档案模式 → 绑定声明（`lowerGenerationIntent.ts` 只认绑定）。
 *
 * 一个参考槽编译成一个绑定，绑定序 = 槽序（画布的意图按槽序号指绑定）：
 *  · 不进合并的槽 → `declared`：键 = 槽的 inputKey（缺省按槽种），形状按槽种 + `asArray` + `max`（`slotBinding`）；
 *  · 进合并的槽 → `combined`：并进合并键，扁平通道是 URL 数组，否则每条带这一槽的线上 role。
 * 再加上模式的 `fixedParams`。
 * 给了 `createBody`（主进程拿得到这条 mapping 真正渲染的 body）时多守一条：模式声明了合并键、
 * body 却根本不读它 → 合并发不出去 → 各槽留在自己的键上（`combineChannelForBody`，与 Run 路入口同一个判据）。
 * 渲染层拿不到 body，按模式声明合并；内置 body 都读自己的合并键，两边结果相同（官方字段矩阵逐格核）。
 */
import type { ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind } from "../videoCapabilities/types";
import {
  combineChannelForBody,
  combineChannelForMode,
  REFERENCE_ROLE_FOR_KIND,
  slotJoinsCombine,
  type ReferenceCombineChannel,
} from "../videoCapabilities/referenceChannels";
import type { BindingEncoding, GenerationDeclaration, ReferenceBinding } from "./lowerGenerationIntent";
import { loweringAsArray, loweringInputKey } from "./slotInputKeys";

/** 编译绑定要读的槽字段（档案槽的子集；按 body 推出来的位也只填这些）。 */
export type LoweringSlot = Pick<ArchetypeReferenceSlot, "kind" | "inputKey" | "asArray" | "max" | "roleName">;

type ModeDeclarationShape = Pick<ArchetypeMode, "slots" | "combineSlotsInto" | "fixedParams">;

const ARRAY_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(["image_ref", "video_ref", "audio_ref"]);

// 火山方舟 content[] 载体：键名就是声明里的 inputKey（seedanceVolcengine*.ts），不认供应商名。
// 调用时才读 role 表（与档案注册表同在一张加载图里，不在模块加载期取值）。
function contentEncoding(key: string, array: boolean): BindingEncoding | null {
  const roles = REFERENCE_ROLE_FOR_KIND;
  if (array) {
    if (key === "volcengine_image_contents") return { shape: "content-items", media: "image", role: roles.image_ref ?? "reference_image" };
    if (key === "volcengine_video_contents") return { shape: "content-items", media: "video", role: roles.video_ref ?? "reference_video" };
    if (key === "volcengine_audio_contents") return { shape: "content-items", media: "audio", role: roles.audio_ref ?? "reference_audio" };
    return null;
  }
  if (key === "volcengine_first_image_content" || key === "volcengine_first_role_image_content") {
    return { shape: "content-item", role: roles.first_frame ?? "first_frame" };
  }
  if (key === "volcengine_last_role_image_content") return { shape: "content-item", role: roles.last_frame ?? "last_frame" };
  return null;
}

/**
 * 一个槽自己的键与形状。数组槽种：声明 `asArray:false` 的单值数组槽（Agnes i2v 的 image）发单图字符串，
 * 没写 max 的单值槽（按 body 推出来的位，见 headlessReferences）同样只发一张；其余发 URL 数组。
 * 单值槽种：一格，声明 `asArray` 的装进只有一张的数组。
 */
export function slotBinding(slot: LoweringSlot): ReferenceBinding {
  const key = loweringInputKey(slot);
  const array = ARRAY_SLOT_KINDS.has(slot.kind);
  const encoding: BindingEncoding = contentEncoding(key, array) ?? (array
    ? (!loweringAsArray(slot) && (slot.max === undefined || slot.max === 1) ? { shape: "url", pick: "first" } : { shape: "url-list" })
    : (loweringAsArray(slot) ? { shape: "url-in-list" } : { shape: "url", pick: "first" }));
  return { kind: slot.kind, target: { select: "declared", key }, encoding, ...(slot.max === undefined ? {} : { max: slot.max }) };
}

/** 这一档模式在这条 body 上的合并通道（没给 body = 按模式声明）。Run 路按它分「合并里没有这种参考」。 */
export function combineForMode(mode: ModeDeclarationShape, createBody?: unknown): ReferenceCombineChannel {
  return createBody === undefined ? combineChannelForMode(mode) : combineChannelForBody(mode, createBody);
}

export function declarationForMode(mode: ModeDeclarationShape, createBody?: unknown): GenerationDeclaration {
  const combine = combineForMode(mode, createBody);
  let order = 0;
  const bindings = mode.slots.map((slot): ReferenceBinding => {
    if (!combine || !slotJoinsCombine(mode, slot)) return slotBinding(slot);
    const role = combine.roleSlots[order++]!.role;
    return {
      kind: slot.kind,
      target: { select: "combined", key: combine.key, role },
      encoding: combine.flat ? { shape: "url-list" } : { shape: "role-objects" },
      ...(slot.max === undefined ? {} : { max: slot.max }),
    };
  });
  return {
    bindings,
    // 档案槽的目标都是自己的键或合并键，不按 body 选。
    readKeys: [],
    ...(mode.fixedParams ? { fixedParams: mode.fixedParams } : {}),
  };
}
