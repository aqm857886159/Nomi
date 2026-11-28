// 「新建节点默认用哪个模型」的纯判定层（真值表靠单测钉死，hook 只负责副作用）。
//
// 两件事收在这里：
//   ① 这张卡属于哪类任务 / 哪类媒介（决定读 `byKind` 里的 `image` 还是 `video`）；
//   ② 用户在设置页显式设过的固定模型此刻还能不能跑这个任务（不能跑就让位给 `resolveAutoGenerationModel`）。

import type { ModelOption } from '../../../config/models'
import {
  mediaKindForTaskKind,
  type GenerationDefaultMediaKind,
  type GenerationDefaultTaskKind,
} from '../../../../electron/shared/contracts/generationModelDefaultsContract'
import type { GenerationModelDefaultMap } from '../model/generationModelDefaults'

type TaskKindInput = {
  isImageLike: boolean
  isVideoLike: boolean
  /** 卡片已经拿到参考图（连线进来的或上传的）——有参考才算「编辑 / 图生视频」。 */
  hasImageReference: boolean
}

/**
 * 这张卡此刻对应的生成任务（四类之一）。既不是图也不是视频的卡（文本 / 剪辑 / 3D 等）返回 null。
 * 视频优先于图片判断：视频卡同时吃图，先判视频才不会把「图生视频」错当「图片编辑」。
 */
export function deriveGenerationDefaultTaskKind({
  isImageLike,
  isVideoLike,
  hasImageReference,
}: TaskKindInput): GenerationDefaultTaskKind | null {
  if (isVideoLike) return hasImageReference ? 'image_to_video' : 'text_to_video'
  if (isImageLike) return hasImageReference ? 'image_edit' : 'text_to_image'
  return null
}

export function deriveGenerationDefaultMediaKind({
  isImageLike,
  isVideoLike,
}: Pick<TaskKindInput, 'isImageLike' | 'isVideoLike'>): GenerationDefaultMediaKind | null {
  if (isVideoLike) return 'video'
  if (isImageLike) return 'image'
  return null
}

function optionModelKey(option: ModelOption): string {
  return (option.modelKey || option.value || '').trim()
}

function optionVendorKey(option: ModelOption): string {
  return (typeof option.vendor === 'string' ? option.vendor : '').trim()
}

/**
 * 按用户在设置里显式设过的默认挑模型。
 * - `options` 已经是按当前所需模式（如 `text_to_image` vs `image_edit`）筛好的可用候选；
 * - 若用户没设（自动），或设的是单能力模型此刻跑不了当前模式（如设了 Z-Image Turbo 后往卡上加了参考图切改图），
 *   返回 `undefined`，由调用方落到唯一真源 `resolveAutoGenerationModel`（对应 `edge.single-capability-pick`）。
 */
export function resolveDefaultModelOption(
  options: readonly ModelOption[],
  defaults: GenerationModelDefaultMap,
  taskKind: GenerationDefaultTaskKind | null,
): ModelOption | undefined {
  if (!taskKind) return undefined
  const preferred = defaults[mediaKindForTaskKind(taskKind)]
  if (!preferred) return undefined
  return options.find(
    (option) =>
      optionVendorKey(option) === preferred.vendorKey && optionModelKey(option) === preferred.modelKey,
  )
}

/** 节点 meta 上是否已经有参考图。用于把一张卡归到「编辑 / 图生视频」而不是「文生」。 */
export function nodeHasImageReference(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false
  for (const key of ['referenceImages', 'referenceImageUrls', 'upstreamResultUrls'] as const) {
    const value = meta[key]
    if (Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim())) return true
  }
  const firstFrame = meta.firstFrameUrl
  return typeof firstFrame === 'string' && Boolean(firstFrame.trim())
}
