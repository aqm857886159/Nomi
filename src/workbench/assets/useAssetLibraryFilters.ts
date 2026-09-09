// 素材漏斗状态 —— 从 AssetLibraryPanel 抽出（R9 分层，面板已到 800 行门岗）。
// 两条轴住在一起：种类（图片/视频/音频/3D）和来源（我的/找来的参考）。
// 它们是同一件事的两个维度——用户的问句都是「只看 X」——所以共用一个漏斗、一个状态、
// 一句按钮文案（§1.5 硬规则 2：一功能一个家）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetKind } from './assetTypes'
import { ASSET_KIND_FILTER_VALUES, FILTER_OPTIONS, type FilterValue } from './assetLibraryPanelFilters'
import {
  ASSET_PROVENANCE_OPTIONS,
  ASSET_PROVENANCE_VALUES,
  toggleAssetProvenance,
  type AssetProvenance,
} from './assetProvenance'

export type AssetLibraryFilters = {
  visibleKinds: ReadonlySet<AssetKind>
  visibleProvenances: ReadonlySet<AssetProvenance>
  filterActive: boolean
  /** 漏斗按钮上的字：必须说全「现在滤掉了什么」，否则来源筛选会变成看不见的状态。 */
  activeFilterLabel: string
  toggleVisibleKind: (kind: AssetKind) => void
  toggleVisibleProvenance: (provenance: AssetProvenance) => void
  showAllKinds: () => void
  showAll: () => void
  /** 「找参考」拿完东西回素材库时用：直接落在刚拿的那几条上。 */
  focusReferenceOnly: () => void
}

export function useAssetLibraryFilters(): AssetLibraryFilters {
  const { t } = useTranslation()
  const [visibleKinds, setVisibleKinds] = React.useState<Set<AssetKind>>(() => new Set(ASSET_KIND_FILTER_VALUES))
  // 默认全选：加一条筛选轴不能让老用户一打开就发现素材少了。
  const [visibleProvenances, setVisibleProvenances] = React.useState<Set<AssetProvenance>>(
    () => new Set(ASSET_PROVENANCE_VALUES),
  )

  const selectedKindValues = React.useMemo(
    () => ASSET_KIND_FILTER_VALUES.filter((kind) => visibleKinds.has(kind)),
    [visibleKinds],
  )
  const allKindsSelected = selectedKindValues.length === ASSET_KIND_FILTER_VALUES.length
  const allProvenancesSelected = visibleProvenances.size === ASSET_PROVENANCE_VALUES.length

  const filterLabelByValue = React.useMemo(
    () => new Map<FilterValue, string>(FILTER_OPTIONS.map((option) => [option.value, t(option.labelKey)])),
    [t],
  )
  const separator = t('assetLibrary.listSeparator')
  const activeKindLabel = allKindsSelected
    ? ''
    : selectedKindValues.length > 0
      ? selectedKindValues.map((kind) => filterLabelByValue.get(kind) ?? kind).join(separator)
      : t('assetLibrary.noCategories')
  const activeProvenanceLabel = allProvenancesSelected
    ? ''
    : ASSET_PROVENANCE_OPTIONS.filter((option) => visibleProvenances.has(option.value))
        .map((option) => t(option.labelKey))
        .join(separator)

  const showAllKinds = React.useCallback((): void => {
    setVisibleKinds(new Set(ASSET_KIND_FILTER_VALUES))
  }, [])

  const showAll = React.useCallback((): void => {
    setVisibleKinds(new Set(ASSET_KIND_FILTER_VALUES))
    setVisibleProvenances(new Set(ASSET_PROVENANCE_VALUES))
  }, [])

  const focusReferenceOnly = React.useCallback((): void => {
    setVisibleKinds(new Set(ASSET_KIND_FILTER_VALUES))
    setVisibleProvenances(new Set<AssetProvenance>(['reference']))
  }, [])

  const toggleVisibleKind = React.useCallback((kind: AssetKind): void => {
    setVisibleKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  const toggleVisibleProvenance = React.useCallback((provenance: AssetProvenance): void => {
    setVisibleProvenances((current) => toggleAssetProvenance(current, provenance))
  }, [])

  return {
    visibleKinds,
    visibleProvenances,
    filterActive: !allKindsSelected || !allProvenancesSelected,
    activeFilterLabel:
      [activeKindLabel, activeProvenanceLabel].filter(Boolean).join(separator) || t('assetLibrary.all'),
    toggleVisibleKind,
    toggleVisibleProvenance,
    showAllKinds,
    showAll,
    focusReferenceOnly,
  }
}
