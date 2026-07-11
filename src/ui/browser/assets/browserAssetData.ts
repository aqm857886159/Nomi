import {
  IconFolder,
  IconFileText,
  IconLayoutGrid,
  IconPhoto,
  IconVideo,
  type Icon as TablerIcon,
} from '../../../vendor/tablerIcons'

export type NomiBrowserAssetKind = 'image' | 'video' | 'prompt' | 'folder'
export type NomiBrowserAssetTab = 'all' | NomiBrowserAssetKind
export type NomiBrowserAssetSource = 'my' | 'transcript'

export type NomiBrowserAsset = {
  id: string
  type: NomiBrowserAssetKind
  source: NomiBrowserAssetSource
  title: string
  subtitle?: string
  duration?: string
  count?: number
  tags?: readonly string[]
  preview?: string
  previewUrl?: string
  previewMediaType?: 'image' | 'video'
  parentFolderId?: string | null
  status?: 'loading' | 'ready' | 'error'
  createdAt?: string
  updatedAt?: string
  promptCard?: {
    referenceImages: readonly {
      url: string
      title?: string
      sourceUrl?: string
    }[]
    prompt: string
    promptType: string
    extractionMode?: 'replicate' | 'style'
    savedAt: string
  }
}

export type NomiBrowserAssetTabDefinition = {
  key: NomiBrowserAssetTab
  label: string
  icon: TablerIcon
}

export type NomiBrowserAssetSourceDefinition = {
  key: NomiBrowserAssetSource
  label: string
}

export const NOMI_BROWSER_ASSET_TABS: readonly NomiBrowserAssetTabDefinition[] = [
  { key: 'all', label: '全部', icon: IconLayoutGrid },
  { key: 'image', label: '图片', icon: IconPhoto },
  { key: 'video', label: '视频', icon: IconVideo },
  { key: 'prompt', label: '提示词', icon: IconFileText },
  { key: 'folder', label: '文件夹', icon: IconFolder },
]

export const NOMI_BROWSER_ASSET_SOURCES: readonly NomiBrowserAssetSourceDefinition[] = [
  { key: 'my', label: '项目素材' },
  { key: 'transcript', label: '提示词库' },
]

export const NOMI_BROWSER_ASSETS: readonly NomiBrowserAsset[] = []

export type NomiBrowserAssetFilter = {
  source?: NomiBrowserAssetSource
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
    if (filter.source && asset.source !== filter.source) return false
    if (activeTab !== 'all' && asset.type !== activeTab) return false
    if (!normalizedQuery) return true
    const promptCard = asset.promptCard
    const haystack = [
      asset.title,
      asset.subtitle,
      asset.type,
      promptCard?.prompt,
      promptCard?.promptType,
      promptCard?.extractionMode,
      promptCard?.extractionMode === 'style' ? '画面风格' : promptCard?.extractionMode === 'replicate' ? '画面复刻' : '',
      ...(promptCard?.referenceImages.map((reference) => `${reference.title ?? ''} ${reference.sourceUrl ?? ''}`) ?? []),
      ...(asset.tags ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
