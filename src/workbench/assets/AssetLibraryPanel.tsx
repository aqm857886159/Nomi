/**
 * 素材库内容（唯一素材面 · 挂在左侧栏「素材库」tab）。
 *
 * 复用 useAssetPool（画布节点 + 项目文件去重合流，单一真相源），
 * 块复用 AssetThumb（形态自明：图=缩略图、视频=播放三角、音频=波形）。
 *
 * 右侧浮动抽屉壳已删（2026-07-22 方案一重执行）：`nomi-open-asset-library` 事件全仓无发送方，
 * 是素材库 v1 纯抽屉时代的孤儿面——素材库唯一的门＝侧栏 tab（一个能力一个门）。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconPhoto, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { useAssetPool } from './useAssetPool'
import { assetTimeValue, mergeAssetRefs, useAllProjectAssets } from './useAllProjectAssets'
import { assetsForFolderScope, folderCountsForAssets, useAssetFolderInteractions, useAssetFolders } from './useAssetFolders'
import { filterAssets, type AssetRef } from './assetTypes'
import { ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag } from './assetLibraryDrag'
import { importAudioFilesToLibrary, type AudioImportResult } from './importAudioToLibrary'
import type { GenerationAssetImportResult } from '../generationCanvas/adapters/assetImportAdapter'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { confirmDialog, DesignEmptyState, NomiLoadingMark, promptDialog, TooltipProvider } from '../../design'
import { FindReferenceSection } from './FindReferenceSection'
import type { ReferencePlatform } from '../../../electron/shared/contracts/referenceSearch'
import { acceptAttrForKinds, mediaKindFromExtension } from '../../../electron/assets/mediaTypes'
import { notify } from '../../ui/notificationPolicy'
import {
  AssetGridCell,
  FolderGridCell,
} from './AssetLibraryPanelParts'
import { AssetLibraryToolbar } from './AssetLibraryToolbar'
import { AssetPreviewDialog } from './AssetPreviewDialog'
import type { FilterValue } from './assetLibraryPanelFilters'
import { assetProvenanceOf, countAssetProvenance } from './assetProvenance'
import { useAssetLibraryFilters } from './useAssetLibraryFilters'
import { filterCanvasLibraryAssets, filterPlayableAssets } from './assetLibrarySources'
import { deleteAssetResult } from './deleteAssetResult'
import { addAssetToTimelineEnd } from '../timeline/addAssetToTimeline'
import { useAssetLibraryLocalImport } from './assetLibraryLocalImport'
import {
  assetToDragPayload,
  assetsForLibraryDrag,
  assetBelongsToProject,
  canManageAssetFolders,
  resolveAssetLibraryItemAction,
  shouldRunAssetItemAction,
  sourceOptionsForUsage,
  type AssetLibrarySourceFilter,
  type AssetLibraryUsageContext,
  type AssetGridActivationEvent,
} from './assetLibraryUsage'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from '../library/libraryDiscovery'
import { runPasteShareLinkImport } from './pasteShareLinkImport'

const DEFAULT_GRID_COLS = 3
const ESTIMATED_ROW_HEIGHT = 121
const COMPACT_ESTIMATED_ROW_HEIGHT = 113

// 从媒体类型单一真相源派生（通配 + 显式扩展名，见 mediaTypes.acceptAttrForKinds 注释）。
// 素材库三类：图 / 视频 / 音频。accept 放行的每个格式下游都接得住（同源,不再漂移）。
const UPLOAD_ACCEPT = acceptAttrForKinds(['image', 'video', 'audio'])

// 上传文件分流（纯函数便于单测）。kind 判定：MIME 优先，缺/不匹配回落扩展名——与音频分支对称，
// 修「空 MIME 的图/视频被静默丢」(Gap B)。图/视频走画布节点(可拖画布)，音频落项目文件进库。
export type UploadClassification = {
  mediaFiles: File[]   // image / video → 画布素材节点
  audioFiles: File[]   // audio → 项目文件源（音频 tab）
  unsupported: File[]  // 既非图/视频也非音频 → 跳过并提示
}

export function classifyUploadFiles(files: File[]): UploadClassification {
  const mediaFiles: File[] = []
  const audioFiles: File[] = []
  const unsupported: File[] = []
  for (const file of files) {
    const mime = (file.type || '').toLowerCase()
    const kind = mime.startsWith('image/') ? 'image'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('audio/') ? 'audio'
      : mediaKindFromExtension(file.name) // 空/未知 MIME → 扩展名兜底
    if (kind === 'image' || kind === 'video') mediaFiles.push(file)
    else if (kind === 'audio') audioFiles.push(file)
    else unsupported.push(file)
  }
  return { mediaFiles, audioFiles, unsupported }
}

// 导入结果 → 用户反馈（Gap C：此前计数全被丢弃，超大/重复/失败/超上限零提示）。
function reportMediaImport(result: GenerationAssetImportResult, present: (message: string) => void): void {
  const skipped: string[] = []
  if (result.skippedTooLargeCount) skipped.push(i18n.t('assetLibrary.skippedTooLarge', { count: result.skippedTooLargeCount }))
  if (result.skippedOverLimitCount) skipped.push(i18n.t('assetLibrary.skippedOverLimit', { count: result.skippedOverLimitCount }))
  if (result.skippedDuplicateCount) skipped.push(i18n.t('assetLibrary.skippedDuplicate', { count: result.skippedDuplicateCount }))
  if (result.failedCount) skipped.push(i18n.t('assetLibrary.skippedFailed', { count: result.failedCount }))
  if (skipped.length) present(i18n.t('assetLibrary.skippedSummary', { items: skipped.join(i18n.t('assetLibrary.listSeparator')) }))
}

function reportAudioImport(result: AudioImportResult, present: (message: string) => void): void {
  const skipped: string[] = []
  if (result.skippedTooLargeCount) skipped.push(i18n.t('assetLibrary.skippedTooLarge', { count: result.skippedTooLargeCount }))
  if (result.skippedDuplicateCount) skipped.push(i18n.t('assetLibrary.skippedDuplicate', { count: result.skippedDuplicateCount }))
  if (result.failedCount) skipped.push(i18n.t('assetLibrary.skippedFailed', { count: result.failedCount }))
  if (skipped.length) present(i18n.t('assetLibrary.skippedSummary', { items: skipped.join(i18n.t('assetLibrary.listSeparator')) }))
}

type AssetLibraryContentProps = {
  projectId: string | null
  compact?: boolean
  showHeader?: boolean
  /**
   * 放行音频素材（默认 false = 只列图/视频，生成页侧栏的既有行为）。
   * 剪辑页左栏传 true：音频是配乐来源——此前全 App 没有任何地方拖得出音频素材，
   * 时间轴那句「拖音频到此当配乐」等于无源（唯一现实路径是画布音频节点走节点把手）。
   */
  includeAudio?: boolean
  /** Explicit consumer semantics: asset management on canvas, direct placement in Preview. */
  usageContext?: AssetLibraryUsageContext
  onClose?: () => void
  className?: string
}

export function AssetLibraryContent({
  projectId,
  compact = false,
  showHeader = true,
  includeAudio = false,
  usageContext = 'canvas',
  onClose,
  className,
}: AssetLibraryContentProps): JSX.Element {
  const { t } = useTranslation()
  const [feedback, setFeedback] = React.useState<Record<string, string[]>>({})
  const feedbackOwner = projectId ?? ''
  const present = React.useCallback((message: string) => {
    setFeedback((current) => ({ ...current, [feedbackOwner]: message
      ? [...new Set([...(current[feedbackOwner] ?? []), message])] : [] }))
  }, [feedbackOwner])
  const report = React.useCallback((message: string, type: 'info' | 'warning' | 'error' = 'warning') => {
    notify({ identity: `asset-library:${feedbackOwner}`, reason: 'operation', message, type, level: 'inline', present })
  }, [feedbackOwner, present])
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const filterButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const filterMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [previewAsset, setPreviewAsset] = React.useState<AssetRef | null>(null)
  const [sourceFilter, setSourceFilter] = React.useState<AssetLibrarySourceFilter>('all')
  const filters = useAssetLibraryFilters()
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  // 文件夹（素材面收敛 2026-07-22 转正）：只在「项目素材」tab 生效,搜索时退成全量平铺。
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const usageVersion = useLibraryUsageVersion()
  const lastSelectedIdRef = React.useRef<string | null>(null)
  const selectedIdsRef = React.useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const sourceOptions = sourceOptionsForUsage(usageContext)

  const {
    canvasAssets,
    projectAssets: workspaceProjectAssets,
    refresh: refreshProjectAssets,
  } = useAssetPool(projectId)
  const {
    assets: allProjectAssets,
    loading: allProjectAssetsLoading,
    partial: allProjectAssetsPartial,
    refresh: refreshAllProjectAssets,
  } = useAllProjectAssets()
  const localImport = useAssetLibraryLocalImport({ projectId, refreshProjectAssets, refreshAllProjectAssets, present })
  const folderApi = useAssetFolders(projectId)
  const allSourceAssets = React.useMemo(
    () => (includeAudio ? filterPlayableAssets(allProjectAssets) : filterCanvasLibraryAssets(allProjectAssets)),
    [allProjectAssets, includeAudio],
  )
  const currentProjectAssets = React.useMemo(
    () => mergeAssetRefs(canvasAssets, workspaceProjectAssets),
    [canvasAssets, workspaceProjectAssets],
  )
  const projectSourceAssets = React.useMemo(
    () => (includeAudio ? filterPlayableAssets(currentProjectAssets) : filterCanvasLibraryAssets(currentProjectAssets)),
    [currentProjectAssets, includeAudio],
  )
  const sourceFilteredAssets = React.useMemo(
    () => {
      void usageVersion
      return sortByLibraryUsage(sourceFilter === 'project' ? projectSourceAssets : allSourceAssets, 'asset', (asset) => asset.id, assetTimeValue)
    },
    [allSourceAssets, projectSourceAssets, sourceFilter, usageVersion],
  )
  const filterBaseAssets = React.useMemo(
    () => filterAssets(sourceFilteredAssets, { query }),
    [sourceFilteredAssets, query],
  )
  const provenanceCounts = React.useMemo(() => countAssetProvenance(filterBaseAssets), [filterBaseAssets])
  const filterCounts = React.useMemo(() => {
    const next = new Map<FilterValue, number>()
    next.set('all', filterBaseAssets.length)
    for (const asset of filterBaseAssets) next.set(asset.kind, (next.get(asset.kind) ?? 0) + 1)
    return next
  }, [filterBaseAssets])

  // 素材回流：写入层（writeAsset/moveAssetFile）落盘即广播，捕捞/拖拽/上传/agent 任何导入路径
  // 都触发本面板刷新（原 M0 捕捞窗私有 onImported 的接任者，收敛后信号挂在唯一咽喉）。
  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.assets?.onUpdated) return
    return bridge.assets.onUpdated((payload) => {
      if ((payload as { projectId?: string } | null)?.projectId !== projectId) return
      refreshProjectAssets()
      refreshAllProjectAssets()
    })
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets])
  const visible = React.useMemo(
    () => filterBaseAssets.filter(
      (asset) => filters.visibleKinds.has(asset.kind) && filters.visibleProvenances.has(assetProvenanceOf(asset)),
    ),
    [filterBaseAssets, filters.visibleKinds, filters.visibleProvenances],
  )
  const itemAction = resolveAssetLibraryItemAction(
    usageContext,
    sourceFilter === 'project' ? 'project' : 'all',
  )
  const projectSelectionEnabled = itemAction === 'select'
  const folderManagementEnabled = canManageAssetFolders(usageContext)
  // 文件夹作用域：项目素材 tab + 无搜索词时生效（root=未分类;夹内=归属素材;搜索=全量平铺）。
  const folderViewActive = sourceFilter === 'project' && query.trim() === ''
  const scopedAssets = React.useMemo(
    () => (folderViewActive ? assetsForFolderScope(visible, folderApi.state.assignments, activeFolderId) : visible),
    [activeFolderId, folderApi.state.assignments, folderViewActive, visible],
  )
  const folderCounts = React.useMemo(
    () => folderCountsForAssets(projectSourceAssets, folderApi.state.assignments),
    [folderApi.state.assignments, projectSourceAssets],
  )
  const visibleFolders = folderViewActive && !activeFolderId ? folderApi.state.folders : []
  const activeFolder = activeFolderId ? folderApi.state.folders.find((folder) => folder.id === activeFolderId) ?? null : null
  React.useEffect(() => {
    if (activeFolderId && !activeFolder) setActiveFolderId(null)
  }, [activeFolder, activeFolderId])
  const visibleAssetsRef = React.useRef(scopedAssets)
  visibleAssetsRef.current = scopedAssets
  const visibleIds = React.useMemo(() => scopedAssets.map((asset) => asset.id), [scopedAssets])
  const selectedAssets = React.useMemo(
    () => scopedAssets.filter((asset) => selectedIds.has(asset.id)),
    [selectedIds, scopedAssets],
  )
  const selectedProjectAssets = React.useMemo(
    () => (projectSelectionEnabled ? selectedAssets : []),
    [projectSelectionEnabled, selectedAssets],
  )

  // 虚拟化：按行渲染，只挂当前视口内的格子（图多时不再一次性渲染上百个 DOM 节点）。
  //
  // 根因坑（实测定位）：滚动容器用 flex-1 取高度，面板刚打开时它高度还是 0，虚拟器此刻
  // 测到 scrollRect={0,0} → range=null → 一个格子都不挂；之后 flex 撑到 258px，但用对象
  // useRef 时「ref 挂载/尺寸变化不会触发 React 重渲」，虚拟器没机会重算，于是一直空白
  // （直到搜索等无关操作偶然触发重渲才恢复）。
  // 解法：滚动元素用「callback-ref 写进 state」——元素挂载那一刻就强制一次重渲，虚拟器
  // 立刻拿到带高度的元素重算。useState 的 setter 引用稳定，不会反复 detach/attach。
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
  const gridCols = compact ? 2 : DEFAULT_GRID_COLS
  const estimatedRowHeight = compact ? COMPACT_ESTIMATED_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT
  const rowCount = Math.ceil(scopedAssets.length / gridCols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  })

  const handleUploadFiles = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    present('')
    const all = Array.from(event.currentTarget.files || [])
    event.currentTarget.value = ''
    const { mediaFiles, audioFiles, unsupported } = classifyUploadFiles(all)
    if (mediaFiles.length) {
      void import('../generationCanvas/adapters/assetImportAdapter')
        .then(({ importLocalMediaFilesToGenerationCanvas }) =>
          importLocalMediaFilesToGenerationCanvas(mediaFiles, { basePosition: { x: 120, y: 90 } }))
        .then((result) => {
          refreshProjectAssets()
          refreshAllProjectAssets()
          reportMediaImport(result, report)
          // 落点可见性（2026-08-07 飞书反馈「上传传到另一个位置没看到」）：选中首个新节点 +
          // 请求画布 fit 平移视口过去（复用 Scene3DEditor 同款组合，不造第二套）。
          const firstNode = result.created[0]?.node
          if (firstNode) {
            useGenerationCanvasStore.getState().selectNode(firstNode.id)
            useWorkbenchStore.getState().requestCanvasFit()
          }
        })
        .catch((error) => {
          console.error('asset library upload failed', error)
          report(t('assetLibrary.importFailed'), 'error')
        })
    }
    if (audioFiles.length) {
      void importAudioFilesToLibrary(audioFiles, { projectId })
        .then((result) => {
          refreshProjectAssets()
          refreshAllProjectAssets()
          reportAudioImport(result, report)
        })
        .catch((error) => {
          console.error('asset library audio upload failed', error)
          report(t('assetLibrary.audioImportFailed'), 'error')
        })
    }
    if (unsupported.length) {
      report(t('assetLibrary.skippedUnsupported', { count: unsupported.length }), 'warning')
    }
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets, present, report, t])

  /** 工具栏那颗 🔗 = 「找参考」的家（一功能一个家）：开合内嵌面板，不弹层。 */
  const handleToggleFind = React.useCallback(() => {
    setImportedInFind(0)
    setFindOpen((open) => !open)
  }, [])

  // 贴链接导入（TikHub）：分享链接 → 无水印直链 → 落成项目视频素材。落库后回流刷新，
  // 素材即出现在库里供用户用现有节点拆解。失败态三段式在 pasteShareLinkImport 里。
  /**
   * 贴链接导入。`presetText` 有值时**跳过弹框**（用户已经在找参考面板里把链接输进来了）——
   * 这是卡点表「能不能少一步」砍掉的那一步：看到即可用，不再多开一层弹层。
   */
  const handlePasteLink = React.useCallback((presetText?: string) => {
    void runPasteShareLinkImport(projectId, {
      prompt: presetText ? async () => presetText : promptDialog,
      present,
      t,
      onImported: () => {
        refreshProjectAssets()
        refreshAllProjectAssets()
      },
      onNeedKey: () => {
        // TikHub 卡的家在设置「模型」tab 的「数据源」区（2026-09-01 归位：它是数据源接入，不是 AI 策略）。
        window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models', section: 'tikhub-connector' } }))
      },
    })
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets, present, t])

  const isEmpty = scopedAssets.length === 0 && visibleFolders.length === 0
  // 「找参考」面板：由工具栏那颗 🔗 开合。平台是**项目级设定**（设计拍板），
  // 当前先用会话态承载，接进项目设置是随后一步——UI 契约已经按「项目设定」画好。
  const [findOpen, setFindOpen] = React.useState(false)
  // 这一趟「找参考」拿了几条：决定返回条上写什么、以及回去后落在哪个筛选态。
  const [importedInFind, setImportedInFind] = React.useState(0)
  const [referencePlatform, setReferencePlatform] = React.useState<ReferencePlatform>('douyin')
  const sourceEmpty = sourceFilteredAssets.length === 0

  React.useEffect(() => {
    if (!filterOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (filterMenuRef.current?.contains(target)) return
      if (filterButtonRef.current?.contains(target)) return
      setFilterOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFilterOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [filterOpen])

  React.useEffect(() => {
    const visibleIdSet = new Set(visibleIds)
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIdSet.has(id)))
      return next.size === current.size ? current : next
    })
    if (lastSelectedIdRef.current && !visibleIdSet.has(lastSelectedIdRef.current)) lastSelectedIdRef.current = null
  }, [visibleIds])

  const selectAsset = React.useCallback((asset: AssetRef, event: AssetGridActivationEvent): void => {
    const visibleAssets = visibleAssetsRef.current
    const additive = event.metaKey || event.ctrlKey
    const anchorId = lastSelectedIdRef.current
    setSelectedIds((current) => {
      if (event.shiftKey && anchorId) {
        const anchorIndex = visibleAssets.findIndex((candidate) => candidate.id === anchorId)
        const targetIndex = visibleAssets.findIndex((candidate) => candidate.id === asset.id)
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex)
          const end = Math.max(anchorIndex, targetIndex)
          const next = additive ? new Set(current) : new Set<string>()
          for (let index = start; index <= end; index += 1) next.add(visibleAssets[index].id)
          return next
        }
      }
      if (additive) {
        const next = new Set(current)
        if (next.has(asset.id)) next.delete(asset.id)
        else next.add(asset.id)
        return next
      }
      if (current.size === 1 && current.has(asset.id)) return current
      return new Set([asset.id])
    })
    lastSelectedIdRef.current = asset.id
  }, [])

  const activateAsset = React.useCallback((asset: AssetRef, event: AssetGridActivationEvent): void => {
    if (!shouldRunAssetItemAction(itemAction, event.detail)) return
    if (itemAction === 'append') {
      // The all-project view is intentionally browse-only until a materialized
      // copy contract exists. Never write another project's URL into this
      // project's timeline; let the user inspect the source instead.
      if (!assetBelongsToProject(asset, projectId)) {
        setPreviewAsset(asset)
        return
      }
      void addAssetToTimelineEnd(asset).then((added) => {
        if (added) markLibraryUsed('asset', asset.id)
      })
      return
    }
    if (itemAction === 'preview') {
      setPreviewAsset(asset)
      if (assetBelongsToProject(asset, projectId)) markLibraryUsed('asset', asset.id)
      return
    }
    selectAsset(asset, event)
  }, [itemAction, projectId, selectAsset])


  const handleAssetDragStart = React.useCallback((asset: AssetRef, event: React.DragEvent<HTMLDivElement>): void => {
    if (!assetBelongsToProject(asset, projectId)) {
      event.preventDefault()
      return
    }
    const currentSelection = selectedIdsRef.current
    const selectedForDrag = assetsForLibraryDrag(visibleAssetsRef.current, currentSelection, asset)
      .filter((candidate) => assetBelongsToProject(candidate, projectId))
    if (!currentSelection.has(asset.id)) {
      setSelectedIds(new Set([asset.id]))
      lastSelectedIdRef.current = asset.id
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const dragAnchor = {
      xRatio: rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5,
      yRatio: rect.height > 0 ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5,
    }
    const payloads = selectedForDrag.map((candidate, index) =>
      assetToDragPayload(candidate, index === 0 ? dragAnchor : undefined),
    )
    event.dataTransfer.setData(ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag(payloads))
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', payloads.length > 1 ? `${payloads.length} 个素材` : asset.name)
  }, [projectId])

  // 项目素材 tab 的格子拖拽=归类进夹（独立 MIME,画布 drop 端不认识,不会误建重复节点）。
  // 三件套 handler 抽在 useAssetFolderInteractions（R9 防巨壳）。
  const { handleFolderAssignDragStart, handleFolderDropAssets, handleDeleteFolder } = useAssetFolderInteractions({
    folderApi,
    visibleAssetsRef,
    selectedIdsRef,
    setSelectedIds,
    lastSelectedIdRef,
    setActiveFolderId,
    collectSelection: assetsForLibraryDrag,
  })
  const assetDragHint = usageContext === 'timeline'
    ? t('timelineEditor.dragToTimeline')
    : projectSelectionEnabled
      ? t('assetLibrary.dragHintFolder')
      : undefined
  const assetPreviewAction = React.useMemo(() => itemAction === 'select' ? (asset: AssetRef) => {
    setPreviewAsset(asset)
    if (assetBelongsToProject(asset, projectId)) markLibraryUsed('asset', asset.id)
  } : undefined, [itemAction, projectId])
  const assetDragStartAction = React.useCallback((asset: AssetRef, event: React.DragEvent<HTMLDivElement>): void => {
    present('')
    if (!assetBelongsToProject(asset, projectId)) {
      event.preventDefault()
      report(t('assetLibrary.externalAssetHint'), 'info')
      return
    }
    if (projectSelectionEnabled) handleFolderAssignDragStart(asset, event)
    else handleAssetDragStart(asset, event)
  }, [handleAssetDragStart, handleFolderAssignDragStart, projectId, projectSelectionEnabled, present, report, t])

  const deleteSelectedProjectAssets = React.useCallback(async (): Promise<void> => {
    present('')
    if (!projectId) {
      report(t('assetLibrary.deleteNoProject'), 'warning')
      return
    }
    if (selectedProjectAssets.length === 0) {
      report(t('assetLibrary.selectToDelete'), 'warning')
      return
    }
    const confirmed = await confirmDialog({
      title: t('assetLibrary.confirmDeleteTitle', { count: selectedProjectAssets.length }),
      message: t('assetLibrary.confirmDeleteMessage'),
      confirmLabel: t('assetLibrary.delete'),
      danger: true,
    })
    if (!confirmed) return
    try {
      // 串行：同一关闭项目的多张结果必须一张张基于最新 record 改，Promise.all 会各读同一旧快照后互相覆盖。
      const outcomes: Awaited<ReturnType<typeof deleteAssetResult>>[] = []
      for (const asset of selectedProjectAssets) outcomes.push(await deleteAssetResult(asset, projectId))
      const removedCount = outcomes.reduce((total, outcome) => total + outcome.removedResultCount, 0)
      const deletedFileCount = outcomes.reduce((total, outcome) => total + outcome.deletedFileCount, 0)
      const failedFileCount = outcomes.reduce((total, outcome) => total + outcome.failedFileCount, 0)
      refreshProjectAssets()
      refreshAllProjectAssets()
      setSelectedIds(new Set())
      if (removedCount === 0 && deletedFileCount === 0 && failedFileCount === 0) report(t('assetLibrary.cannotDeleteSelected'), 'warning')
      if (failedFileCount > 0) report(t('assetLibrary.failedFiles', { count: failedFileCount }), 'warning')
    } catch (error) {
      console.error('delete project assets failed', error)
      report(t('assetLibrary.deleteFailed'), 'error')
    }
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets, selectedProjectAssets, present, report, t])

  const deleteOneAsset = React.useCallback(async (asset: AssetRef): Promise<void> => {
    present('')
    if (!assetBelongsToProject(asset, projectId)) {
      report(t('assetLibrary.externalAssetHint'), 'info')
      return
    }
    const confirmed = await confirmDialog({
      title: t('assetLibrary.confirmDeleteTitle', { count: 1 }),
      message: t('assetLibrary.confirmDeleteMessage'),
      confirmLabel: t('assetLibrary.delete'),
      danger: true,
    })
    if (!confirmed) return
    try {
      const outcome = await deleteAssetResult(asset, projectId || '')
      refreshProjectAssets()
      refreshAllProjectAssets()
      setPreviewAsset((current) => current?.id === asset.id ? null : current)
      if (outcome.failedFileCount > 0) report(t('assetLibrary.failedFiles', { count: outcome.failedFileCount }), 'warning')
    } catch (error) {
      console.error('delete asset result failed', error)
      report(t('assetLibrary.deleteFailed'), 'error')
    }
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets, present, report, t])

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <div tabIndex={0} onDragOver={localImport.onDragOver} onDragLeave={localImport.onDragLeave} onDrop={localImport.onDrop} onPaste={localImport.onPaste} className={cn('flex min-h-0 flex-1 flex-col overflow-hidden outline-none', className, localImport.isDragOver && 'ring-2 ring-inset ring-nomi-accent/50')}>
        {/* 头部 */}
        {showHeader ? (
          <div className={cn('flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-nomi-line')}>
            <b className={cn('text-title font-bold text-nomi-ink')}>{t('assetLibrary.title')}</b>
            <span className={cn('text-caption text-nomi-ink-40')}>· {scopedAssets.length}</span>
            <span className={cn('flex-1')} />
            {onClose ? (
              <button
                type="button"
                className={cn(
                  'w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent',
                  'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05',
                  'transition-[background,color] duration-nomi-fast ease-nomi-fast',
                )}
                aria-label={t('assetLibrary.close')}
                onClick={onClose}
              >
                <IconX size={16} stroke={2} />
              </button>
            ) : null}
          </div>
        ) : null}
        <input
          ref={uploadInputRef}
          className={cn('absolute w-px h-px overflow-hidden opacity-0 pointer-events-none')}
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          aria-label={t('assetLibrary.filePicker')}
          onChange={handleUploadFiles}
        />

        {(feedback[feedbackOwner] ?? []).length > 0 ? (
          <div role="status" aria-live="polite" className="shrink-0 border-b border-nomi-line px-3 py-2 text-caption text-nomi-ink-60" data-asset-library-feedback>
            {feedback[feedbackOwner].map((message) => <p key={message}>{message}</p>)}
          </div>
        ) : null}
        <AssetLibraryToolbar
          compact={compact}
          uploadInputRef={uploadInputRef}
          onPasteLink={handleToggleFind}
          findOpen={findOpen}
          sourceOptions={sourceOptions}
          sourceFilter={sourceFilter}
          onSourceFilterChange={setSourceFilter}
          onResetSelection={() => {
            setSelectedIds(new Set())
            lastSelectedIdRef.current = null
          }}
          onResetKinds={filters.showAllKinds}
          onCloseFilter={() => setFilterOpen(false)}
          onResetFolder={() => setActiveFolderId(null)}
          onCloseNewFolder={() => setNewFolderOpen(false)}
          query={query}
          onQueryChange={setQuery}
          projectSelectionEnabled={projectSelectionEnabled}
          selectedProjectAssetCount={selectedProjectAssets.length}
          onDeleteSelected={() => {
            void deleteSelectedProjectAssets()
          }}
          newFolderOpen={newFolderOpen}
          onOpenNewFolder={() => setNewFolderOpen(true)}
          onCreateFolder={folderApi.createFolder}
          filterButtonRef={filterButtonRef}
          filterMenuRef={filterMenuRef}
          visibleKinds={filters.visibleKinds}
          filterCounts={filterCounts}
          visibleProvenances={filters.visibleProvenances}
          provenanceCounts={provenanceCounts}
          filterOpen={filterOpen}
          filterActive={filters.filterActive}
          activeFilterLabel={filters.activeFilterLabel}
          onToggleFilter={() => setFilterOpen((open) => !open)}
          onToggleKind={filters.toggleVisibleKind}
          onShowAllKinds={filters.showAllKinds}
          onToggleProvenance={filters.toggleVisibleProvenance}
          folderViewActive={folderViewActive}
          activeFolder={activeFolder}
          folderManagementEnabled={folderManagementEnabled}
          scopedAssetCount={scopedAssets.length}
          onBackToAllAssets={() => setActiveFolderId(null)}
          onDropToFolder={handleFolderDropAssets}
        />

        {/* 09-08 用户裁决：找参考接管素材区；返回条保留已有素材上下文。详见 FindReferenceSection。 */}
        {findOpen ? (
          <FindReferenceSection
            projectId={projectId}
            platform={referencePlatform}
            assetCount={scopedAssets.length}
            importedCount={importedInFind}
            onPlatformChange={setReferencePlatform}
            onShareLink={handlePasteLink}
            onImported={() => {
              setImportedInFind((count) => count + 1)
              refreshProjectAssets()
              refreshAllProjectAssets()
            }}
            onNeedKey={() => {
              window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'models', section: 'tikhub-connector' } }))
            }}
            onBack={() => {
              // 拿完回到「只看参考」，否则保持原筛选。
              if (importedInFind > 0) {
                filters.focusReferenceOnly()
                setActiveFolderId(null)
                setQuery('')
              }
              setImportedInFind(0)
              setFindOpen(false)
            }}
          />
        ) : (
        <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-3.5 pb-4')}>
          {sourceFilter === 'all' && allProjectAssetsPartial ? (
            <div className="mb-2 rounded-nomi-sm border border-nomi-warning/25 bg-nomi-warning-soft px-2.5 py-2 text-micro text-nomi-warning" role="status">
              {t('assetLibrary.partialResults')}
            </div>
          ) : null}
          {visibleFolders.length > 0 ? (
            <div
              className="grid gap-2.5 pb-2.5"
              style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
              role="list"
              aria-label={t('assetLibrary.foldersAria')}
            >
              {visibleFolders.map((folder) => (
                <FolderGridCell
                  key={folder.id}
                  id={folder.id}
                  label={folder.label}
                  count={folderCounts.get(folder.id) ?? 0}
                  manageable={folderManagementEnabled}
                  onOpen={setActiveFolderId}
                  onDelete={handleDeleteFolder}
                  onDropAssets={(folderId, event) => handleFolderDropAssets(folderId, event)}
                />
              ))}
            </div>
          ) : null}
          {sourceFilter === 'all' && allProjectAssetsLoading && allProjectAssets.length === 0 ? (
            <div className="grid min-h-32 place-items-center gap-2 py-8 text-caption text-nomi-ink-40" role="status" aria-busy="true">
              <NomiLoadingMark size={24} label={t('assetLibrary.loading')} />
              <span>{t('assetLibrary.loading')}</span>
            </div>
          ) : isEmpty ? (
            <DesignEmptyState
              density="inline"
              icon={<IconPhoto size={34} stroke={1.4} className="text-nomi-ink-30" />}
              title={sourceEmpty ? (sourceFilter === 'project' ? t('assetLibrary.noProjectAssets') : t('assetLibrary.noAssets')) : t('assetLibrary.noMatches')}
              description={
                sourceEmpty
                  ? t('assetLibrary.findReference.emptyDesc', {
                      platform: t(`assetLibrary.findReference.platform.${referencePlatform}`),
                    })
                  : t('assetLibrary.noMatchesDescription')
              }
              action={
                !sourceEmpty && filters.filterActive ? (
                  // 卡点③：筛空了不能只留一句「没有匹配」——原因看不见，出口也得就手。
                  <button
                    type="button"
                    data-reset-filters
                    className="h-8 rounded-full border border-nomi-line bg-nomi-paper px-4 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
                    onClick={filters.showAll}
                  >
                    {t('assetLibrary.showAllFilters')}
                  </button>
                ) : sourceEmpty && !findOpen ? (
                  <button
                    type="button"
                    data-find-reference-cta
                    className="h-8 rounded-full bg-nomi-ink px-4 text-body-sm font-medium text-nomi-paper hover:bg-nomi-accent"
                    onClick={handleToggleFind}
                  >
                    {t('assetLibrary.findReference.entry')}
                  </button>
                ) : undefined
              }
            />
          ) : compact ? (
            <div style={{ columnCount: 3, columnGap: '10px' }}>
              {scopedAssets.map((asset) => (
                <AssetGridCell
                  key={asset.id}
                  asset={asset}
                  compact
                  selectable={projectSelectionEnabled}
                  draggable={(projectSelectionEnabled || assetBelongsToProject(asset, projectId)) && asset.kind !== 'model3d'}
                  selected={selectedIds.has(asset.id)}
                  dragHint={assetBelongsToProject(asset, projectId) ? assetDragHint : t('assetLibrary.externalAssetHint')}
                  onSelect={activateAsset}
                  onPreview={assetPreviewAction}
                  onDragStartAsset={assetDragStartAction}
                  onDelete={usageContext === 'canvas' && sourceFilter === 'all' && assetBelongsToProject(asset, projectId) ? (assetToDelete) => void deleteOneAsset(assetToDelete) : undefined}
                />
              ))}
            </div>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const start = virtualRow.index * gridCols
                const rowAssets = scopedAssets.slice(start, start + gridCols)
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    className={cn('grid gap-2.5 pb-2.5')}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                    }}
                  >
                    {rowAssets.map((asset) => (
                      <AssetGridCell
                        key={asset.id}
                        asset={asset}
                        selectable={projectSelectionEnabled}
                        draggable={(projectSelectionEnabled || assetBelongsToProject(asset, projectId)) && asset.kind !== 'model3d'}
                        selected={selectedIds.has(asset.id)}
                        dragHint={assetBelongsToProject(asset, projectId) ? assetDragHint : t('assetLibrary.externalAssetHint')}
                        onSelect={activateAsset}
                        onPreview={assetPreviewAction}
                        onDragStartAsset={assetDragStartAction}
                        onDelete={usageContext === 'canvas' && sourceFilter === 'all' && assetBelongsToProject(asset, projectId) ? (assetToDelete) => void deleteOneAsset(assetToDelete) : undefined}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}
      </div>
      {previewAsset ? (
        <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      ) : null}
    </TooltipProvider>
  )
}
