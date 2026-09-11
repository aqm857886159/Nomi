// 「模型框里显示哪些、排在哪」设置区的**行数据**（纯 derive，可单测）。
//
// 这里一行都不自己判「藏不藏 / 排第几 / 高亮哪家」——那三件事的唯一解析点是
// `src/config/modelBoxPreference.ts` + `sortModelProviders`，设置区和模型框读的是**同一份**结果。
// 设置里看到的顺序和真机下拉里的顺序因此不可能漂：它们是同一次计算的两个渲染。
import { sortModelProviders, type DedupedModel, type ModelProviderRef } from '../../config/modelIdentity'
import { partitionByModelBoxPreference, rememberedProviderIndex, rememberedVendorFor } from '../../config/modelBoxPreference'
import type { ModelBoxPreferenceSettings } from '../../../electron/shared/contracts/modelBoxPreference'

export type ModelBoxRowChip = { vendorKey: string; label: string; active: boolean }
export type ModelBoxRow = {
  canonicalId: string
  label: string
  /** 顺序=全局供应商顺序；active=这一行真正会走的那家（手点过的优先，否则第一家）。 */
  chips: ModelBoxRowChip[]
}
export type ModelBoxRows = { visible: ModelBoxRow[]; hidden: ModelBoxRow[] }

export function buildModelBoxRows(
  deduped: readonly DedupedModel[],
  preference: ModelBoxPreferenceSettings | null | undefined,
  orderedVendorKeys: readonly string[],
  labelOfProvider: (provider: ModelProviderRef) => string,
): ModelBoxRows {
  const toRow = (model: DedupedModel): ModelBoxRow => {
    const providers = sortModelProviders(model.providers, orderedVendorKeys)
    const unique = providers.filter((provider, index, all) =>
      all.findIndex((candidate) => (candidate.vendor || candidate.option.value) === (provider.vendor || provider.option.value)) === index)
    const activeIndex = Math.max(0, rememberedProviderIndex(unique, rememberedVendorFor(model, preference)))
    return {
      canonicalId: model.canonicalId,
      label: model.label,
      chips: unique.map((provider, index) => ({
        vendorKey: provider.vendor || provider.option.value,
        label: labelOfProvider(provider),
        active: index === activeIndex,
      })),
    }
  }
  const { visible, hidden } = partitionByModelBoxPreference(deduped, preference)
  return { visible: visible.map(toRow), hidden: hidden.map(toRow) }
}

/**
 * 把「这一类（图片/视频/音频）新排出来的顺序」并回那份**跨类共用**的 `modelOrder`。
 *
 * 为什么不能直接存新顺序：分段开关一次只显示一类，直接覆盖等于把另外两类排过的顺序悄悄抹掉
 * （用户排完图片再去排视频，回头发现图片又乱了——而且没有任何提示）。
 * 类与类之间的相对位置没有意义（每个模型框只列一类），所以并法就是：本类按新顺序放前面，
 * 其余原样保留在后面。
 */
export function mergeModelOrderForKind(
  previousOrder: readonly string[],
  kindOrder: readonly string[],
  kindIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of kindOrder) {
    if (seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  for (const id of previousOrder) {
    if (kindIds.has(id) || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next
}

/** 上移/下移一行，返回这一类的新 id 顺序（越界时原样返回——首尾两端的按钮本来就是禁用的）。 */
export function moveModelRow(ids: readonly string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids]
  const target = index + delta
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
