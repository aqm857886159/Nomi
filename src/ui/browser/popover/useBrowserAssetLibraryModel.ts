// 托盘数据模型（素材面收敛 2026-07-22 切片D：纯捕捞收件箱）。
// 只合并两桶：persisted assets（desktop.assets.list 当前项目落盘）+ localAssets（会话内 pending/error 卡）。
// localStorage 私账（旧文件夹/提示词卡/软删名单）已随 B/C/D 三切片全部退役。
import React from 'react'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  filterNomiBrowserAssets,
  type NomiBrowserAsset,
  type NomiBrowserAssetTab,
} from '../assets/browserAssetData'
import { PERSISTED_ASSET_PAGE_LIMIT } from './browserAssetPopoverConstants'
import {
  browserAssetFromDesktopAsset,
  browserAssetTimeValue,
  mergeBrowserAssetGroups,
} from './browserAssetPopoverUtils'

type UseBrowserAssetLibraryModelOptions = {
  projectId: string
  popoverOpen: boolean
  localAssets: readonly NomiBrowserAsset[]
  activeTab: NomiBrowserAssetTab
  query: string
  selectedIds: ReadonlySet<string>
  sortAscending: boolean
}

export function useBrowserAssetLibraryModel({
  projectId,
  popoverOpen,
  localAssets,
  activeTab,
  query,
  selectedIds,
  sortAscending,
}: UseBrowserAssetLibraryModelOptions): {
  setPersistedAssets: React.Dispatch<React.SetStateAction<NomiBrowserAsset[]>>
  refreshPersistedAssets: () => Promise<void>
  mergedAssets: NomiBrowserAsset[]
  filterCounts: Map<NomiBrowserAssetTab, number>
  filteredAssets: NomiBrowserAsset[]
  visibleIdSet: Set<string>
  selectedAssets: NomiBrowserAsset[]
  filterActive: boolean
  emptyStateCopy: { title: string; description: string }
} {
  const [persistedAssets, setPersistedAssets] = React.useState<NomiBrowserAsset[]>([])
  const activeProjectId = projectId.trim()
  // 单调递增序号防竞态：真删后手动重拉 与 开盒自动加载 可能并发，只认最后一次发起的结果。
  const loadSeqRef = React.useRef(0)

  const refreshPersistedAssets = React.useCallback(async (): Promise<void> => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    const desktop = getDesktopBridge()
    if (!activeProjectId || !desktop?.assets?.list) {
      if (loadSeqRef.current === seq) setPersistedAssets([])
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
      if (loadSeqRef.current === seq) setPersistedAssets(mergeBrowserAssetGroups(loaded))
    } catch {
      if (loadSeqRef.current === seq) setPersistedAssets([])
    }
  }, [activeProjectId])

  React.useEffect(() => {
    if (!popoverOpen) return
    setPersistedAssets([])
    void refreshPersistedAssets()
  }, [popoverOpen, refreshPersistedAssets])

  const mergedAssets = React.useMemo(
    () => mergeBrowserAssetGroups(localAssets, persistedAssets),
    [localAssets, persistedAssets],
  )
  const filterBaseAssets = React.useMemo(
    () => filterNomiBrowserAssets(mergedAssets, { activeTab: 'all', query }),
    [mergedAssets, query],
  )
  const filterCounts = React.useMemo(() => {
    const next = new Map<NomiBrowserAssetTab, number>()
    next.set('all', filterBaseAssets.length)
    for (const asset of filterBaseAssets) next.set(asset.type, (next.get(asset.type) ?? 0) + 1)
    return next
  }, [filterBaseAssets])
  const filteredAssets = React.useMemo(() => {
    const visible = filterNomiBrowserAssets(mergedAssets, { activeTab, query })
    return [...visible].sort((left, right) => {
      const result = browserAssetTimeValue(left) - browserAssetTimeValue(right)
      if (result !== 0) return sortAscending ? result : -result
      const titleResult = left.title.localeCompare(right.title, 'zh-CN')
      if (titleResult !== 0) return titleResult
      return left.id.localeCompare(right.id)
    })
  }, [activeTab, mergedAssets, query, sortAscending])
  const visibleIdSet = React.useMemo(() => new Set(filteredAssets.map((asset) => asset.id)), [filteredAssets])
  const selectedAssets = React.useMemo(() => mergedAssets.filter((asset) => selectedIds.has(asset.id)), [mergedAssets, selectedIds])
  const filterActive = activeTab !== 'all'
  const emptyStateCopy = React.useMemo(() => {
    if (Boolean(query.trim()) || filterActive) return { title: '没有匹配的素材', description: '换个分类或搜索词试试。' }
    return { title: '还没有捕捞素材', description: '开启捕捞后悬停网页素材按 Ctrl+C，或把图片、视频直接拖进来。' }
  }, [filterActive, query])

  return {
    setPersistedAssets,
    refreshPersistedAssets,
    mergedAssets,
    filterCounts,
    filteredAssets,
    visibleIdSet,
    selectedAssets,
    filterActive,
    emptyStateCopy,
  }
}
