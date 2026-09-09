// 素材「来源」维度 —— 纯函数，供素材库漏斗多一条筛选轴（2026-09-08）。
//
// 为什么按路径判、而不是给 AssetRef 加字段：来源在落盘那一刻就已经是**结构事实**
// （`assets/reference/…` vs 其它，见 electron/assets/assetPaths.ts 的 AssetBucket），
// 目录遍历天然带着它。再拉一条 sidecar→WorkspaceFileNode→AssetRef 的投影管线，
// 只是把同一个事实抄第二遍（R14.1：同一语义只留一个 owner）。
import type { AssetRef } from './assetTypes'

export type AssetProvenance = 'mine' | 'reference'

export const ASSET_PROVENANCE_VALUES: AssetProvenance[] = ['mine', 'reference']

// labelKey → assetLibrary.* i18n 键；在 render 时用 t() 解析（随语言切换重渲）。
export const ASSET_PROVENANCE_OPTIONS: { value: AssetProvenance; labelKey: string }[] = [
  { value: 'mine', labelKey: 'assetLibrary.provenanceMine' },
  { value: 'reference', labelKey: 'assetLibrary.provenanceReference' },
]

const REFERENCE_PATH_PREFIX = 'assets/reference/'

/** 画布产出与用户自己的文件都算「我的素材」；只有从外部平台拿回来的落进 reference 桶。 */
export function assetProvenanceOf(asset: AssetRef): AssetProvenance {
  if (asset.origin.source !== 'project') return 'mine'
  return asset.origin.relativePath.startsWith(REFERENCE_PATH_PREFIX) ? 'reference' : 'mine'
}

export function countAssetProvenance(assets: readonly AssetRef[]): Map<AssetProvenance, number> {
  const counts = new Map<AssetProvenance, number>(ASSET_PROVENANCE_VALUES.map((value) => [value, 0]))
  for (const asset of assets) {
    const provenance = assetProvenanceOf(asset)
    counts.set(provenance, (counts.get(provenance) ?? 0) + 1)
  }
  return counts
}

/**
 * 取消勾选后的下一个集合。**最后一项取消不掉**——三个都关掉只会得到一片空列表
 * 加一个看不见的原因，用户只会以为素材没了（卡点表 ③「空了看到什么」）。
 */
export function toggleAssetProvenance(
  current: ReadonlySet<AssetProvenance>,
  value: AssetProvenance,
): Set<AssetProvenance> {
  const next = new Set(current)
  if (!next.has(value)) {
    next.add(value)
    return next
  }
  if (next.size <= 1) return next
  next.delete(value)
  return next
}
