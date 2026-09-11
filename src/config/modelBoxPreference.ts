// 「模型框里显示哪些、排在哪、这一行默认走哪家」的**唯一**解析点。
//
// 为什么必须只有这一处：下游不止一个模型框——画布节点参数条、分镜镜头条、批量「统一模型」、
// 设计实验室的取景台，各自都要回答同样三个问题。各滤各的排各的，就一定有一处漏掉
// （仓库在「这家能不能跑」上已经吃过一次，教训写在 `modelCatalogCache.keepRunnableVendorOptions`
// 的文件头：闸开在派生层，不开在各个 picker 里）。
//
// 这里只做「用户说了算」那一级；「能不能跑」在更早的 catalog 派生层已经筛过，
// 「同一个模型先走哪家」的默认排序仍是 `sortModelProviders`（本文件不重复那套判据）。
import type { DedupedModel, ModelProviderRef } from './modelIdentity'
import type { ModelBoxPreferenceSettings } from '../../electron/shared/contracts/modelBoxPreference'

/** 供应商 key 一律不分大小写比较——catalog 里 key 由 Base URL 派生，大小写并不稳定。 */
function sameVendor(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left || '').trim().toLowerCase() === (right || '').trim().toLowerCase()
}

export type ModelBoxPartition = {
  /** 进模型框的行，已按用户手排的顺序排好。 */
  visible: DedupedModel[]
  /** 用户藏起来的行（设置里「已隐藏 · N」那一组用它，模型框只用它的条数）。 */
  hidden: DedupedModel[]
}

/**
 * 隐藏 + 排序一次做完。
 *
 * 排序是**插在原排序前面多一级**，不是取代：排过的按用户的顺序，没排过的保持传进来的顺序
 * （那已经是 `sortModelsByCatalogLifecycle` 排好的 flagship → value → companion → legacy）。
 * 这样新接进来的模型不会因为「用户没排过」就掉到列表最后、像是消失了。
 */
export function partitionByModelBoxPreference(
  models: readonly DedupedModel[],
  preference?: ModelBoxPreferenceSettings | null,
): ModelBoxPartition {
  if (!preference) return { visible: [...models], hidden: [] }
  const hiddenIds = new Set(preference.hiddenModelIds)
  const rank = new Map(preference.modelOrder.map((id, index) => [id, index]))
  const visible: DedupedModel[] = []
  const hidden: DedupedModel[] = []
  for (const model of models) {
    if (hiddenIds.has(model.canonicalId)) hidden.push(model)
    else visible.push(model)
  }
  const ordered = visible
    .map((model, index) => ({ model, index, rank: rank.get(model.canonicalId) ?? Number.MAX_SAFE_INTEGER }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ model }) => model)
  return { visible: ordered, hidden }
}

/**
 * 这个模型上用户手点过的那家——**且它现在还在**。
 *
 * 记住的家后来被禁用/删掉时返回 null，调用方据此优雅回落到全局顺序（方案 §7 卡点表③）：
 * 记忆是偏好不是约束，供应商没了就该当没记过，不该报错也不该把行卡住。
 */
export function rememberedVendorFor(
  model: DedupedModel,
  preference?: ModelBoxPreferenceSettings | null,
): string | null {
  const remembered = preference?.preferredVendorByModel?.[model.canonicalId]
  if (!remembered) return null
  const hit = model.providers.find((provider) => sameVendor(provider.vendor, remembered))
  return hit ? (hit.vendor || null) : null
}

/** 记住的那家在这一串供应商里的下标（没记过 / 记的家没了 → -1）。chip 高亮与自动选家共用它。 */
export function rememberedProviderIndex(
  providers: readonly ModelProviderRef[],
  rememberedVendor: string | null,
): number {
  if (!rememberedVendor) return -1
  return providers.findIndex((provider) => sameVendor(provider.vendor, rememberedVendor))
}
