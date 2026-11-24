// 「新建卡片默认模型」的纯判定层（真值表靠单测钉死，hook 只负责副作用）。
//
// 两件事收在这里：
//   ① 这张卡属于四类任务里的哪一类（决定读哪一条偏好）；
//   ② 偏好指向的模型此刻还能不能用（不能用就让位给原有的健康挑选策略）。
//
// 为什么②必须在这层判而不是信任设置文件：设置文件只存 `(vendorKey, modelKey)` 两段身份，
// 不存模型死活——用户可能把那个供应商删了、把模型禁用了、或者换了台机器没有那个本地工作流。
// 此时**必须回退**到自动挑选，而不是让卡片钉在一个跑不了的模型上（生成钮一直灰）。

import type { ModelOption } from '../../../config/models'
import type { GenerationDefaultTaskKind } from '../../../../electron/shared/contracts/generationModelDefaultsContract'
import type { GenerationModelDefaultMap } from '../model/generationModelDefaults'

type TaskKindInput = {
  isImageLike: boolean
  isVideoLike: boolean
  /** 卡片已经拿到参考图（连线进来的或上传的）——有参考才算「编辑 / 图生视频」。 */
  hasImageReference: boolean
}

/**
 * 这张卡该读哪一条默认模型偏好。既不是图也不是视频的卡（文本 / 剪辑 / 3D 等）返回 null——
 * 它们不在这四类里，不该被这套偏好碰。
 *
 * 视频优先于图片判断：视频卡同时满足 isImageLike 的实现存在（视频卡也吃图），
 * 先判视频才不会把「图生视频」错读成「图片编辑」。
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

/** ModelOption 的模型段身份。目录里 modelKey 缺席时 value 就是它的身份。 */
function optionModelKey(option: ModelOption): string {
  return (option.modelKey || option.value || '').trim()
}

function optionVendorKey(option: ModelOption): string {
  return (typeof option.vendor === 'string' ? option.vendor : '').trim()
}

/**
 * 按用户偏好挑一个模型。挑不到（没设 / 设了但此刻不可用）返回 undefined，
 * 由调用方回退到原有的健康挑选策略。
 *
 * **两段都必须对上**：只比 modelKey 会串台——两个中转站提供同名模型时，
 * 用户选的是 A 家的，落到卡片上却可能是 B 家的，账单和结果都不对。
 */
export function resolveDefaultModelOption(
  options: readonly ModelOption[],
  defaults: GenerationModelDefaultMap,
  taskKind: GenerationDefaultTaskKind | null,
): ModelOption | undefined {
  if (!taskKind) return undefined
  const preferred = defaults[taskKind]
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
