/**
 * 参考槽的缺省 API 输入键与「一格还是一袋」——**唯一一份**（以前渲染层、referenceReachability、referenceKeys 各抄一份）。
 * 叶子模块、只有类型 import：声明表（referenceKeys）在模块加载时就要读它，放在降级函数里会和档案注册表绕成环。
 */
import type { ArchetypeReferenceSlotKind } from "../videoCapabilities/types";

/** 缺省 API 输入键（模型契约，供应商无关）。`slot.inputKey` 逐槽覆盖。 */
export const DEFAULT_LOWERING_INPUT_KEY: Readonly<Record<ArchetypeReferenceSlotKind, string>> = {
  first_frame: "first_frame_url",
  last_frame: "last_frame_url",
  image_ref: "reference_image_urls",
  video_ref: "reference_video_urls",
  audio_ref: "reference_audio_urls",
  source_video: "video_url",
};

/** 一格还是一袋的缺省：帧 / 源视频一格，参考数组一袋。声明的 `asArray` 优先。 */
export const DEFAULT_LOWERING_AS_ARRAY: Readonly<Record<ArchetypeReferenceSlotKind, boolean>> = {
  first_frame: false,
  last_frame: false,
  source_video: false,
  image_ref: true,
  video_ref: true,
  audio_ref: true,
};

export function loweringInputKey(slot: { kind: ArchetypeReferenceSlotKind; inputKey?: string }): string {
  return slot.inputKey ?? DEFAULT_LOWERING_INPUT_KEY[slot.kind];
}

export function loweringAsArray(slot: { kind: ArchetypeReferenceSlotKind; asArray?: boolean }): boolean {
  return slot.asArray ?? DEFAULT_LOWERING_AS_ARRAY[slot.kind];
}
