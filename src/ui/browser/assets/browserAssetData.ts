// 素材盒（捕捞收件箱）数据模型。素材面收敛 2026-07-22 切片D：
// 提示词卡已迁主提示词库、文件夹已转正素材库，托盘只剩图/视频两类捕捞产物；
// source tab（项目素材/提示词库）概念随之整个退役，'my' 是唯一来源。
import {
  IconLayoutGrid,
  IconPhoto,
  IconVideo,
  type Icon as TablerIcon,
} from '../../../vendor/tablerIcons'

export type NomiBrowserAssetKind = 'image' | 'video'
export type NomiBrowserAssetTab = 'all' | NomiBrowserAssetKind
export type NomiBrowserAssetSource = 'my'

export type NomiBrowserAsset = {
  id: string
  type: NomiBrowserAssetKind
  source: NomiBrowserAssetSource
  title: string
  subtitle?: string
  duration?: string
  tags?: readonly string[]
  previewUrl?: string
  previewMediaType?: 'image' | 'video'
  /** 项目内落盘相对路径（desktop.assets.list 带回）；真删走 workspace.deleteFiles 用它定位文件。 */
  relativePath?: string
  status?: 'loading' | 'ready' | 'error'
  createdAt?: string
  updatedAt?: string
}

export type NomiBrowserAssetTabDefinition = {
  key: NomiBrowserAssetTab
  label: string
  icon: TablerIcon
}

export const NOMI_BROWSER_ASSET_TABS: readonly NomiBrowserAssetTabDefinition[] = [
  { key: 'all', label: '全部', icon: IconLayoutGrid },
  { key: 'image', label: '图片', icon: IconPhoto },
  { key: 'video', label: '视频', icon: IconVideo },
]

export type NomiBrowserAssetFilter = {
  activeTab?: NomiBrowserAssetTab
  query?: string
}

export function filterNomiBrowserAssets(
  assets: readonly NomiBrowserAsset[],
  filter: NomiBrowserAssetFilter,
): NomiBrowserAsset[] {
  const activeTab = filter.activeTab ?? 'all'
  const query = filter.query ?? ''
  const normalizedQuery = query.trim().toLowerCase()
  return assets.filter((asset) => {
    if (activeTab !== 'all' && asset.type !== activeTab) return false
    if (!normalizedQuery) return true
    const haystack = [asset.title, asset.subtitle, asset.type, ...(asset.tags ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
