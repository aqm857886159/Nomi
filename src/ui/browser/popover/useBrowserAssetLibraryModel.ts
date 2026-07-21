import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  filterNomiBrowserAssets,
  type NomiBrowserAsset,
  type NomiBrowserAssetSource,
  type NomiBrowserAssetSourceDefinition,
  type NomiBrowserAssetTab,
} from '../assets/browserAssetData'
import {
  BROWSER_ASSET_LIBRARY_UPDATED_EVENT,
  defaultBrowserPromptCategories,
  EMPTY_BROWSER_ASSET_LIBRARY_STATE,
  readBrowserAssetLibraryState,
  writeBrowserAssetLibraryState,
  type BrowserAssetLibraryState,
} from '../assets/browserAssetLibraryStorage'
import { PERSISTED_ASSET_PAGE_LIMIT } from './browserAssetPopoverConstants'
import {
  browserAssetFromDesktopAsset,
  browserAssetStorageKey,
  browserAssetTimeValue,
  mergeBrowserAssetGroups,
} from './browserAssetPopoverUtils'

type UseBrowserAssetLibraryModelOptions = {
  projectId: string
  popoverOpen: boolean
  assets: readonly NomiBrowserAsset[]
  localAssets: readonly NomiBrowserAsset[]
  sourceTabs: readonly NomiBrowserAssetSourceDefinition[]
  activeSource: NomiBrowserAssetSource
  activeTab: NomiBrowserAssetTab
  activePromptCategory: string
  activeFolderId: string | null
  promptDetailAssetId: string | null
  query: string
  selectedIds: ReadonlySet<string>
  sortAscending: boolean
  setActiveFolderId: React.Dispatch<React.SetStateAction<string | null>>
}

export function useBrowserAssetLibraryModel({
  projectId,
  popoverOpen,
  assets,
  localAssets,
  sourceTabs,
  activeSource,
  activeTab,
  activePromptCategory,
  activeFolderId,
  promptDetailAssetId,
  query,
  selectedIds,
  sortAscending,
  setActiveFolderId,
}: UseBrowserAssetLibraryModelOptions): {
  libraryState: BrowserAssetLibraryState
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  updateLibraryState: (updater: (current: BrowserAssetLibraryState) => BrowserAssetLibraryState) => void
  mergedAssets: NomiBrowserAsset[]
  currentFolder: NomiBrowserAsset | null
  folderBreadcrumbs: NomiBrowserAsset[]
  folderScopedAssets: NomiBrowserAsset[]
  promptLibrarySourceKey: NomiBrowserAssetSource
  showingPromptLibrary: boolean
  promptCategories: { id: string; label: string }[]
  filterCounts: Map<NomiBrowserAssetTab, number>
  promptCategoryCounts: Map<string, number>
  filteredAssets: NomiBrowserAsset[]
  visibleIdSet: Set<string>
  selectedAssets: NomiBrowserAsset[]
  assetById: Map<string, NomiBrowserAsset>
  promptDetailAsset: NomiBrowserAsset | null
  activeSourceLabel: string
  filterActive: boolean
  emptyStateCopy: { title: string; description: string }
} {
  const { t } = useTranslation()
  const [persistedAssets, setPersistedAssets] = React.useState<NomiBrowserAsset[]>([])
  const [libraryState, setLibraryState] = React.useState<BrowserAssetLibraryState>(EMPTY_BROWSER_ASSET_LIBRARY_STATE)
  const activeProjectId = projectId.trim()

  const updateLibraryState = React.useCallback(
    (updater: (current: BrowserAssetLibraryState) => BrowserAssetLibraryState): void => {
      setLibraryState((current) => {
        const next = updater(current)
        writeBrowserAssetLibraryState(activeProjectId, next)
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, { detail: { projectId: activeProjectId } }))
        }, 0)
        return next
      })
    },
    [activeProjectId],
  )

  React.useEffect(() => {
    if (!popoverOpen) return undefined
    let cancelled = false
    const loadPersistedAssets = async (): Promise<void> => {
      const desktop = getDesktopBridge()
      const nextLibraryState = readBrowserAssetLibraryState(activeProjectId)
      if (!cancelled) {
        setPersistedAssets([])
        setLibraryState(nextLibraryState)
        if (activeFolderId && !nextLibraryState.folders.some((folder) => folder.id === activeFolderId)) setActiveFolderId(null)
      }
      if (!activeProjectId || !desktop?.assets?.list) {
        if (!cancelled) setPersistedAssets([])
        return
      }
      try {
        const loaded: NomiBrowserAsset[] = []
        let cursor: string | null = null
        do {
          const page = await desktop.assets.list({ projectId: activeProjectId, cursor, limit: PERSISTED_ASSET_PAGE_LIMIT })
          for (const asset of page.items) {
            const mapped = browserAssetFromDesktopAsset(asset)
            if (mapped) loaded.push(mapped)
          }
          cursor = page.cursor
        } while (cursor)
        if (!cancelled) setPersistedAssets(mergeBrowserAssetGroups(loaded))
      } catch {
        if (!cancelled) setPersistedAssets([])
      }
    }
    void loadPersistedAssets()
    return () => {
      cancelled = true
    }
  }, [activeFolderId, activeProjectId, popoverOpen, setActiveFolderId])

  React.useEffect(() => {
    const handleLibraryUpdated = (event: Event): void => {
      const eventProjectId =
        event instanceof CustomEvent && typeof event.detail?.projectId === 'string'
          ? event.detail.projectId
          : activeProjectId
      if (eventProjectId && eventProjectId !== activeProjectId) return
      const nextLibraryState = readBrowserAssetLibraryState(activeProjectId)
      setLibraryState(nextLibraryState)
      if (activeFolderId && !nextLibraryState.folders.some((folder) => folder.id === activeFolderId)) setActiveFolderId(null)
    }
    window.addEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, handleLibraryUpdated)
    return () => window.removeEventListener(BROWSER_ASSET_LIBRARY_UPDATED_EVENT, handleLibraryUpdated)
  }, [activeFolderId, activeProjectId, setActiveFolderId])

  const deletedAssetKeySet = React.useMemo(() => new Set(libraryState.deletedAssetKeys), [libraryState.deletedAssetKeys])
  const mergedAssets = React.useMemo(
    () =>
      mergeBrowserAssetGroups(libraryState.folders, libraryState.promptCards, localAssets, persistedAssets, assets)
        .filter((asset) => !deletedAssetKeySet.has(browserAssetStorageKey(asset)))
        .map((asset) => {
          if (asset.type === 'folder') return { ...asset, parentFolderId: asset.parentFolderId ?? null }
          const assignedFolderId = libraryState.folderAssignments[browserAssetStorageKey(asset)]
          return { ...asset, parentFolderId: assignedFolderId === undefined ? (asset.parentFolderId ?? null) : assignedFolderId }
        }),
    [assets, deletedAssetKeySet, libraryState.folderAssignments, libraryState.folders, libraryState.promptCards, localAssets, persistedAssets],
  )
  const allFolderIds = React.useMemo(() => new Set(mergedAssets.filter((asset) => asset.type === 'folder').map((asset) => asset.id)), [mergedAssets])
  React.useEffect(() => {
    if (!activeFolderId || allFolderIds.has(activeFolderId)) return
    setActiveFolderId(null)
  }, [activeFolderId, allFolderIds, setActiveFolderId])

  const assetsWithFolderSummaries = React.useMemo(() => {
    const childMap = new Map<string, NomiBrowserAsset[]>()
    for (const asset of mergedAssets) {
      const parentFolderId = asset.parentFolderId ?? null
      if (!parentFolderId) continue
      const children = childMap.get(parentFolderId)
      if (children) children.push(asset)
      else childMap.set(parentFolderId, [asset])
    }
    return mergedAssets.map((asset) => {
      if (asset.type !== 'folder') return asset
      const children = (childMap.get(asset.id) ?? []).filter((child) => child.source === activeSource)
      const previewChild = children.find((child) => child.previewUrl || child.preview)
      const previewMediaType: NomiBrowserAsset['previewMediaType'] =
        previewChild?.previewMediaType ??
        (previewChild?.type === 'video' ? 'video' : previewChild?.type === 'image' || previewChild?.promptCard ? 'image' : undefined)
      return {
        ...asset,
        count: children.length,
        subtitle: t('browserAssets.folder'),
        previewUrl: previewChild?.previewUrl,
        preview: previewChild?.preview,
        previewMediaType,
      }
    })
  }, [activeSource, mergedAssets, t])

  const currentFolder = React.useMemo(
    () => assetsWithFolderSummaries.find((asset) => asset.type === 'folder' && asset.id === activeFolderId) ?? null,
    [activeFolderId, assetsWithFolderSummaries],
  )
  const folderBreadcrumbs = React.useMemo(() => {
    if (!currentFolder) return []
    const folderById = new Map<string, NomiBrowserAsset>()
    for (const asset of assetsWithFolderSummaries) if (asset.type === 'folder') folderById.set(asset.id, asset)
    const breadcrumbs: NomiBrowserAsset[] = []
    const seenIds = new Set<string>()
    let folder: NomiBrowserAsset | null = currentFolder
    while (folder && !seenIds.has(folder.id)) {
      breadcrumbs.unshift(folder)
      seenIds.add(folder.id)
      const parentFolderId: string | null = folder.parentFolderId ?? null
      folder = parentFolderId ? (folderById.get(parentFolderId) ?? null) : null
    }
    return breadcrumbs
  }, [assetsWithFolderSummaries, currentFolder])
  const folderScopedAssets = React.useMemo(
    () => assetsWithFolderSummaries.filter((asset) => (asset.parentFolderId ?? null) === activeFolderId),
    [activeFolderId, assetsWithFolderSummaries],
  )
  const promptLibrarySourceKey = React.useMemo(
    () => sourceTabs.find((source) => source.key === 'transcript')?.key ?? 'transcript',
    [sourceTabs],
  )
  const showingPromptLibrary = activeSource === promptLibrarySourceKey
  const promptCategories = (() => {
    const defaults = defaultBrowserPromptCategories()
    const seen = new Set(defaults.map((category) => category.id))
    return [
      ...defaults,
      ...libraryState.promptCategories.filter((category) => {
        if (seen.has(category.id)) return false
        seen.add(category.id)
        return true
      }),
    ]
  })()
  const filterBaseAssets = React.useMemo(
    () => filterNomiBrowserAssets(folderScopedAssets, { source: activeSource, activeTab: 'all', query }),
    [activeSource, folderScopedAssets, query],
  )
  const filterCounts = React.useMemo(() => {
    const next = new Map<NomiBrowserAssetTab, number>()
    next.set('all', filterBaseAssets.length)
    for (const asset of filterBaseAssets) next.set(asset.type, (next.get(asset.type) ?? 0) + 1)
    return next
  }, [filterBaseAssets])
  const promptCategoryCounts = React.useMemo(() => {
    const next = new Map<string, number>()
    const promptAssets = filterNomiBrowserAssets(folderScopedAssets, { source: 'transcript', activeTab: 'prompt', query })
    next.set('all', promptAssets.length)
    for (const asset of promptAssets) {
      const promptType = asset.promptCard?.promptType || 'image'
      next.set(promptType, (next.get(promptType) ?? 0) + 1)
    }
    return next
  }, [folderScopedAssets, query])
  const filteredAssets = React.useMemo(() => {
    const visible = showingPromptLibrary
      ? filterNomiBrowserAssets(folderScopedAssets, { source: 'transcript', activeTab: 'prompt', query })
          .filter((asset) => activePromptCategory === 'all' || (asset.promptCard?.promptType || 'image') === activePromptCategory)
      : filterNomiBrowserAssets(folderScopedAssets, { source: activeSource, activeTab, query })
    return [...visible].sort((left, right) => {
      const folderBias = Number(right.type === 'folder') - Number(left.type === 'folder')
      if (folderBias !== 0) return folderBias
      const result = browserAssetTimeValue(left) - browserAssetTimeValue(right)
      if (result !== 0) return sortAscending ? result : -result
      const titleResult = left.title.localeCompare(right.title, 'zh-CN')
      if (titleResult !== 0) return titleResult
      const idResult = left.id.localeCompare(right.id)
      if (idResult !== 0) return idResult
      return 0
    })
  }, [activePromptCategory, activeSource, activeTab, folderScopedAssets, query, showingPromptLibrary, sortAscending])
  const visibleIdSet = React.useMemo(() => new Set(filteredAssets.map((asset) => asset.id)), [filteredAssets])
  const selectedAssets = React.useMemo(() => mergedAssets.filter((asset) => selectedIds.has(asset.id)), [mergedAssets, selectedIds])
  const assetById = React.useMemo(() => {
    const next = new Map<string, NomiBrowserAsset>()
    for (const asset of mergedAssets) next.set(asset.id, asset)
    return next
  }, [mergedAssets])
  const promptDetailAsset = React.useMemo(() => {
    if (!promptDetailAssetId) return null
    const asset = assetById.get(promptDetailAssetId)
    return asset?.promptCard ? asset : null
  }, [assetById, promptDetailAssetId])
  const activeSourceLabel = React.useMemo(
    () => sourceTabs.find((source) => source.key === activeSource)?.label || t('browserAssets.asset'),
    [activeSource, sourceTabs, t],
  )
  const filterActive = showingPromptLibrary ? activePromptCategory !== 'all' : activeTab !== 'all'
  const emptyStateCopy = React.useMemo(() => {
    const filtered = Boolean(query.trim()) || filterActive
    if (filtered) {
      return { title: t('browserAssets.empty.noMatchTitle'), description: t('browserAssets.empty.noMatchDescription') }
    }
    if (currentFolder) {
      return { title: t('browserAssets.empty.folderTitle'), description: t('browserAssets.empty.folderDescription') }
    }
    if (showingPromptLibrary) {
      return { title: t('browserAssets.empty.promptTitle'), description: t('browserAssets.empty.promptDescription') }
    }
    return { title: t('browserAssets.empty.assetTitle'), description: t('browserAssets.empty.assetDescription') }
  }, [currentFolder, filterActive, query, showingPromptLibrary, t])

  return {
    libraryState,
    setPersistedAssets,
    updateLibraryState,
    mergedAssets,
    currentFolder,
    folderBreadcrumbs,
    folderScopedAssets,
    promptLibrarySourceKey,
    showingPromptLibrary,
    promptCategories,
    filterCounts,
    promptCategoryCounts,
    filteredAssets,
    visibleIdSet,
    selectedAssets,
    assetById,
    promptDetailAsset,
    activeSourceLabel,
    filterActive,
    emptyStateCopy,
  }
}
