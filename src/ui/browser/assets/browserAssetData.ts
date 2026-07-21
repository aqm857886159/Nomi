import {
  IconFolder,
  IconFileText,
  IconLayoutGrid,
  IconPhoto,
  IconVideo,
  type Icon as TablerIcon,
} from '../../../vendor/tablerIcons'
import i18n from '../../../i18n'

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
  labelKey?: string
  icon: TablerIcon
}

export type NomiBrowserAssetSourceDefinition = {
  key: NomiBrowserAssetSource
  label: string
  labelKey?: string
}

export const NOMI_BROWSER_ASSET_TABS: readonly NomiBrowserAssetTabDefinition[] = [
  { key: 'all', label: '', labelKey: 'browserAssets.all', icon: IconLayoutGrid },
  { key: 'image', label: '', labelKey: 'browserAssets.image', icon: IconPhoto },
  { key: 'video', label: '', labelKey: 'browserAssets.video', icon: IconVideo },
  { key: 'prompt', label: '', labelKey: 'browserAssets.prompt', icon: IconFileText },
  { key: 'folder', label: '', labelKey: 'browserAssets.folder', icon: IconFolder },
]

export const NOMI_BROWSER_ASSET_SOURCES: readonly NomiBrowserAssetSourceDefinition[] = [
  { key: 'my', label: '', labelKey: 'browserAssets.projectAssets' },
  { key: 'transcript', label: '', labelKey: 'browserAssets.promptLibrary' },
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
      promptCard?.extractionMode === 'style'
        ? i18n.t('browserAssets.extraction.style')
        : promptCard?.extractionMode === 'replicate'
          ? i18n.t('browserAssets.extraction.replicate')
          : '',
      ...(promptCard?.referenceImages.map((reference) => `${reference.title ?? ''} ${reference.sourceUrl ?? ''}`) ?? []),
      ...(asset.tags ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}
