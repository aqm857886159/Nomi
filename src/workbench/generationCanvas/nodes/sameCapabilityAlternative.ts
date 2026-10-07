import type { ModelOption } from '../../../config/models'
import { findModelOptionByIdentifier } from '../adapters/modelOptionsAdapter'
import { findUpscaleModelOption } from '../quickActions/deriveFromNode'

/**
 * 同能力里此刻可用的另一个模型（纯函数；`useSameCapabilityAlternative` 用它）。
 * `options` 是节点模型下拉那一份清单（同种类、同请求类型、已只剩可用的，按偏好 / 健康排好）；取第一个不是当前模型、
 * 且「是不是放大模型」与当前一致的——放大只换放大，普通改图不拿放大模型顶。
 */
export function pickSameCapabilityAlternative(
  options: readonly ModelOption[],
  current: { modelKey?: string | null; vendorKey?: string | null },
): ModelOption | null {
  const currentOption = current.modelKey ? findModelOptionByIdentifier(options, current.modelKey, current.vendorKey ?? undefined) : null
  const wantsUpscale = Boolean(currentOption && findUpscaleModelOption([currentOption]))
  return options.find((candidate) => candidate !== currentOption
    && !(candidate.modelKey === current.modelKey && candidate.vendor === current.vendorKey)
    && Boolean(findUpscaleModelOption([candidate])) === wantsUpscale) ?? null
}
