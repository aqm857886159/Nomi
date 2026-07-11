/**
 * 素材库面板（真实库）。
 *
 * 「素材库」从前只是个上传按钮（名不副实）。这里把它做成真正的库：
 * 右侧浮动抽屉，复用 useAssetPool（画布节点 + 项目文件去重合流，单一真相源），
 * 块复用 AssetThumb（形态自明：图=缩略图、视频=播放三角、音频=波形）。
 *
 * 挂载/关闭仿 OnboardingFloatingPanel：Mantine Portal 固定面板 + Escape / 点外关闭。
 * v1 范围：浏览 + 分段筛选 + 搜索 + 上传。拖到画布 / 删除留 v1.1（pool 合并源，删哪个源要单独想）。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconFilter, IconPhoto, IconPlus, IconTrash, IconWorld, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { useAssetPool } from './useAssetPool'
import { useAllProjectAssets } from './useAllProjectAssets'
import { filterAssets, type AssetKind, type AssetRef } from './assetTypes'
import { ASSET_LIBRARY_DRAG_MIME, serializeAssetLibraryDrag, type AssetLibraryDragPayload } from './assetLibraryDrag'
import { importAudioFilesToLibrary, type AudioImportResult } from './importAudioToLibrary'
import type { GenerationAssetImportResult } from '../generationCanvas/adapters/assetImportAdapter'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { confirmDialog, DesignEmptyState, DesignSearchInput, TooltipProvider } from '../../design'
import { acceptAttrForKinds, mediaKindFromExtension } from '../../../electron/assets/mediaTypes'
import { toast } from '../../ui/toast'
import {
  AssetGridCell,
  AssetKindFilterMenu,
} from './AssetLibraryPanelParts'
import { ASSET_KIND_FILTER_VALUES, FILTER_OPTIONS, type FilterValue } from './assetLibraryPanelFilters'
import { buildAssetLibraryDeletePlan, filterImageVideoAssets } from './assetLibrarySources'

const DEFAULT_GRID_COLS = 3
const ESTIMATED_ROW_HEIGHT = 121
const COMPACT_ESTIMATED_ROW_HEIGHT = 113

const PANEL_WIDTH = 380
const TOP_OFFSET = 64
const RIGHT_OFFSET = 12

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
function reportMediaImport(result: GenerationAssetImportResult): void {
  if (result.created.length) toast(`已导入 ${result.created.length} 个素材`, 'success')
  const skipped: string[] = []
  if (result.skippedTooLargeCount) skipped.push(`${result.skippedTooLargeCount} 个过大`)
  if (result.skippedOverLimitCount) skipped.push(`${result.skippedOverLimitCount} 个超单次上限`)
  if (result.skippedDuplicateCount) skipped.push(`${result.skippedDuplicateCount} 个重复`)
  if (result.failedCount) skipped.push(`${result.failedCount} 个失败`)
  if (skipped.length) toast(`已跳过：${skipped.join('、')}`, result.failedCount ? 'error' : 'warning')
}

function reportAudioImport(result: AudioImportResult): void {
  if (result.uploadedCount) toast(`已导入 ${result.uploadedCount} 个音频`, 'success')
  const skipped: string[] = []
  if (result.skippedTooLargeCount) skipped.push(`${result.skippedTooLargeCount} 个过大`)
  if (result.skippedDuplicateCount) skipped.push(`${result.skippedDuplicateCount} 个重复`)
  if (result.failedCount) skipped.push(`${result.failedCount} 个失败`)
  if (skipped.length) toast(`已跳过：${skipped.join('、')}`, result.failedCount ? 'error' : 'warning')
}

type SourceFilterValue = 'all' | 'project'

const SOURCE_OPTIONS: { value: SourceFilterValue; label: string }[] = [
  { value: 'all', label: '全部素材' },
  { value: 'project', label: '项目素材' },
]

const FILTER_LABEL_BY_VALUE = new Map<FilterValue, string>(
  FILTER_OPTIONS.map((option) => [option.value, option.label]),
)

function assetToDragPayload(asset: AssetRef, dragAnchor?: AssetLibraryDragPayload['dragAnchor']): AssetLibraryDragPayload {
  return {
    kind: asset.kind,
    name: asset.name,
    renderUrl: asset.renderUrl,
    origin: asset.origin,
    ...(dragAnchor ? { dragAnchor } : {}),
  }
}

export function assetsForLibraryDrag(
  visibleAssets: readonly AssetRef[],
  selectedIds: ReadonlySet<string>,
  draggedAsset: AssetRef,
): AssetRef[] {
  if (!selectedIds.has(draggedAsset.id)) return [draggedAsset]
  return [
    draggedAsset,
    ...visibleAssets.filter((asset) => asset.id !== draggedAsset.id && selectedIds.has(asset.id)),
  ]
}

type AssetLibraryContentProps = {
  projectId: string | null
  compact?: boolean
  showHeader?: boolean
  onClose?: () => void
  className?: string
}

type Props = {
  opened: boolean
  onClose: () => void
  projectId: string | null
}

export function AssetLibraryContent({
  projectId,
  compact = false,
  showHeader = true,
  onClose,
  className,
}: AssetLibraryContentProps): JSX.Element {
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const filterButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const filterMenuRef = React.useRef<HTMLDivElement | null>(null)
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilterValue>('all')
  const [visibleKinds, setVisibleKinds] = React.useState<Set<AssetKind>>(() => new Set(ASSET_KIND_FILTER_VALUES))
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const lastSelectedIdRef = React.useRef<string | null>(null)
  const selectedIdsRef = React.useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const {
    canvasAssets,
    refresh: refreshProjectAssets,
  } = useAssetPool(projectId)
  const { assets: allProjectAssets, refresh: refreshAllProjectAssets } = useAllProjectAssets()
  const allSourceAssets = React.useMemo(
    () => filterImageVideoAssets(allProjectAssets),
    [allProjectAssets],
  )
  const projectSourceAssets = React.useMemo(
    () => filterImageVideoAssets(canvasAssets),
    [canvasAssets],
  )

  const sourceFilteredAssets = React.useMemo(
    () => (sourceFilter === 'project' ? projectSourceAssets : allSourceAssets),
    [allSourceAssets, projectSourceAssets, sourceFilter],
  )
  const filterBaseAssets = React.useMemo(
    () => filterAssets(sourceFilteredAssets, { query }),
    [sourceFilteredAssets, query],
  )
  const filterCounts = React.useMemo(() => {
    const next = new Map<FilterValue, number>()
    next.set('all', filterBaseAssets.length)
    for (const asset of filterBaseAssets) next.set(asset.kind, (next.get(asset.kind) ?? 0) + 1)
    return next
  }, [filterBaseAssets])

  // 网页捕捞回流：捕捞窗把素材写进项目后广播 → 这里刷新列表（本面板是唯一消费者，无并行真相源）。
  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.browserCapture) return
    return bridge.browserCapture.onImported((payload) => {
      if (payload.projectId !== projectId) return
      refreshProjectAssets()
      refreshAllProjectAssets()
      toast(`已捕捞进素材库：${payload.name}`, 'success')
    })
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets])
  const visible = React.useMemo(
    () => filterBaseAssets.filter((asset) => visibleKinds.has(asset.kind)),
    [filterBaseAssets, visibleKinds],
  )
  const visibleAssetsRef = React.useRef(visible)
  visibleAssetsRef.current = visible
  const selectedKindValues = React.useMemo(
    () => ASSET_KIND_FILTER_VALUES.filter((kind) => visibleKinds.has(kind)),
    [visibleKinds],
  )
  const allKindsSelected = selectedKindValues.length === ASSET_KIND_FILTER_VALUES.length
  const filterActive = !allKindsSelected
  const projectSelectionEnabled = sourceFilter === 'project'
  const visibleIds = React.useMemo(() => visible.map((asset) => asset.id), [visible])
  const selectedAssets = React.useMemo(
    () => visible.filter((asset) => selectedIds.has(asset.id)),
    [selectedIds, visible],
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
  const rowCount = Math.ceil(visible.length / gridCols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => estimatedRowHeight,
    overscan: 3,
  })

  const handleUploadFiles = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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
          reportMediaImport(result)
        })
        .catch((error) => {
          console.error('asset library upload failed', error)
          toast('素材导入失败，请重试', 'error')
        })
    }
    if (audioFiles.length) {
      void importAudioFilesToLibrary(audioFiles, { projectId })
        .then((result) => {
          refreshProjectAssets()
          refreshAllProjectAssets()
          reportAudioImport(result)
        })
        .catch((error) => {
          console.error('asset library audio upload failed', error)
          toast('音频导入失败，请重试', 'error')
        })
    }
    if (unsupported.length) {
      toast(`已跳过 ${unsupported.length} 个不支持的文件`, 'warning')
    }
  }, [projectId, refreshAllProjectAssets, refreshProjectAssets])

  const isEmpty = visible.length === 0
  const sourceEmpty = sourceFilteredAssets.length === 0
  const activeFilterLabel = allKindsSelected
    ? '全部'
    : selectedKindValues.length > 0
      ? selectedKindValues.map((kind) => FILTER_LABEL_BY_VALUE.get(kind) ?? kind).join('、')
      : '无分类'

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

  const selectAsset = React.useCallback((asset: AssetRef, event: React.MouseEvent<HTMLDivElement>): void => {
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

  const showAllAssetKinds = React.useCallback((): void => {
    setVisibleKinds(new Set(ASSET_KIND_FILTER_VALUES))
  }, [])

  const toggleVisibleKind = React.useCallback((kind: AssetKind): void => {
    setVisibleKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  const handleAssetDragStart = React.useCallback((asset: AssetRef, event: React.DragEvent<HTMLDivElement>): void => {
    const currentSelection = selectedIdsRef.current
    const selectedForDrag = assetsForLibraryDrag(visibleAssetsRef.current, currentSelection, asset)
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
  }, [])

  const deleteSelectedProjectAssets = React.useCallback(async (): Promise<void> => {
    if (!projectId) {
      toast('删除失败：当前没有打开的项目', 'warning')
      return
    }
    if (selectedProjectAssets.length === 0) {
      toast('请先选中要删除的项目素材', 'warning')
      return
    }
    const canvasStore = useGenerationCanvasStore.getState()
    const deletePlan = buildAssetLibraryDeletePlan({
      selectedAssets: selectedProjectAssets,
      canvasNodes: canvasStore.nodes,
      allProjectAssets,
      currentProjectId: projectId,
    })
    if (deletePlan.nodeIds.length === 0) {
      toast('选中的素材暂时无法删除', 'warning')
      return
    }
    const confirmed = await confirmDialog({
      title: `删除 ${deletePlan.nodeIds.length} 个项目素材？`,
      message: '对应画布节点与「全部素材」中的落盘文件会同步删除。项目文件会移到系统回收站。',
      confirmLabel: '删除',
      danger: true,
    })
    if (!confirmed) return
    const bridge = getDesktopBridge()
    const deleteFiles = bridge?.workspace?.deleteFiles
    if (deletePlan.fileTargets.length > 0 && !deleteFiles) {
      toast('当前运行环境不支持删除项目素材', 'error')
      return
    }
    try {
      let deletedFileCount = 0
      let failedFileCount = 0
      if (deletePlan.fileTargets.length > 0 && deleteFiles) {
        const pathsByProject = new Map<string, string[]>()
        for (const target of deletePlan.fileTargets) {
          const paths = pathsByProject.get(target.projectId)
          if (paths) paths.push(target.relativePath)
          else pathsByProject.set(target.projectId, [target.relativePath])
        }
        const results = await Promise.all([...pathsByProject].map(([targetProjectId, relativePaths]) =>
          deleteFiles({ projectId: targetProjectId, relativePaths }),
        ))
        deletedFileCount = results.reduce((total, result) => total + result.deletedCount, 0)
        failedFileCount = results.reduce((total, result) => total + result.failedCount, 0)
      }
      const latestCanvasStore = useGenerationCanvasStore.getState()
      const existingCanvasIds = new Set(latestCanvasStore.nodes.map((node) => node.id))
      const deletableCanvasNodeIds = deletePlan.nodeIds.filter((nodeId) => existingCanvasIds.has(nodeId))
      if (deletableCanvasNodeIds.length > 0) {
        latestCanvasStore.selectNodes(deletableCanvasNodeIds)
        latestCanvasStore.deleteSelectedNodes()
      }
      refreshProjectAssets()
      refreshAllProjectAssets()
      setSelectedIds(new Set())
      if (deletableCanvasNodeIds.length > 0) toast(`已删除 ${deletableCanvasNodeIds.length} 个项目素材`, 'success')
      if (deletedFileCount > 0 && deletableCanvasNodeIds.length === 0) toast(`已删除 ${deletedFileCount} 个落盘素材`, 'success')
      if (failedFileCount > 0) toast(`${failedFileCount} 个落盘素材删除失败`, 'warning')
    } catch (error) {
      console.error('delete project assets failed', error)
      toast('删除项目素材失败，请检查文件权限', 'error')
    }
  }, [allProjectAssets, projectId, refreshAllProjectAssets, refreshProjectAssets, selectedProjectAssets])

  const uploadButton = (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full cursor-pointer',
        'bg-nomi-ink text-nomi-paper text-caption font-semibold border-0',
        'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-80',
        compact ? 'h-[30px] px-2.5 shrink-0' : 'h-7 px-3',
      )}
      aria-label="上传素材"
      onClick={() => uploadInputRef.current?.click()}
    >
      <IconPlus size={compact ? 12 : 13} stroke={2} />
      上传
    </button>
  )

  const deleteSelectedButton = projectSelectionEnabled ? (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-nomi-sm border text-caption font-semibold tabular-nums',
        'transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
        selectedProjectAssets.length > 0
          ? 'cursor-pointer border-workbench-danger/20 bg-workbench-danger-soft px-2 text-workbench-danger hover:bg-workbench-danger-soft/80'
          : 'cursor-default border-nomi-line bg-nomi-ink-05 px-2 text-nomi-ink-30',
      )}
      disabled={selectedProjectAssets.length === 0}
      aria-disabled={selectedProjectAssets.length === 0}
      aria-label={selectedProjectAssets.length > 0 ? `删除 ${selectedProjectAssets.length} 个项目素材` : '删除项目素材'}
      title={selectedProjectAssets.length > 0 ? `删除 ${selectedProjectAssets.length} 个项目素材` : '请先选择项目素材'}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => {
        void deleteSelectedProjectAssets()
      }}
    >
      <IconTrash size={15} stroke={2} aria-hidden="true" />
      <span>{selectedProjectAssets.length}</span>
    </button>
  ) : null

  const sourceTabs = (
    <div
      className={cn(
        'inline-flex bg-nomi-ink-05 rounded-full p-0.5',
        compact ? 'min-w-0 flex-1' : 'shrink-0',
      )}
      role="tablist"
      aria-label="素材来源筛选"
    >
      {SOURCE_OPTIONS.map((option) => {
        const active = sourceFilter === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap',
              'transition-[background,color] duration-[var(--nomi-transition-fast)]',
              compact ? 'min-w-0 flex-1 px-1.5 py-1' : 'px-2.5 py-1',
              active
                ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                : 'text-nomi-ink-60 hover:text-nomi-ink',
            )}
            onClick={() => {
              setSourceFilter(option.value)
              setSelectedIds(new Set())
              lastSelectedIdRef.current = null
              showAllAssetKinds()
              setFilterOpen(false)
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )

  const categoryFilterButton = (
    <div className="relative shrink-0">
      <button
        ref={filterButtonRef}
        type="button"
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
          'cursor-pointer text-caption text-nomi-ink-65 transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
          'hover:border-nomi-ink-20 hover:bg-nomi-ink-05 hover:text-nomi-ink',
          compact ? 'h-8 px-2.5' : 'h-8 px-3',
          (filterOpen || filterActive) && 'border-nomi-ink-20 bg-nomi-ink-05 text-nomi-ink',
        )}
        aria-label="筛选素材分类"
        aria-haspopup="dialog"
        aria-expanded={filterOpen}
        aria-pressed={filterActive}
        title={`分类：${activeFilterLabel}`}
        onClick={() => setFilterOpen((open) => !open)}
      >
        <IconFilter size={15} stroke={1.8} aria-hidden="true" />
        {!compact ? <span>{activeFilterLabel}</span> : null}
      </button>
      {filterOpen ? (
        <AssetKindFilterMenu
          selectedKinds={visibleKinds}
          counts={filterCounts}
          setNodeRef={(node) => {
            filterMenuRef.current = node
          }}
          onToggleKind={toggleVisibleKind}
          onShowAll={showAllAssetKinds}
        />
      ) : null}
    </div>
  )

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
        {/* 头部 */}
        {showHeader ? (
          <div className={cn('flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-nomi-line')}>
            <b className={cn('text-title font-bold text-nomi-ink')}>素材库</b>
            <span className={cn('text-caption text-nomi-ink-40')}>· {sourceFilteredAssets.length}</span>
            <span className={cn('flex-1')} />
            <button
              type="button"
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-full border border-nomi-line bg-nomi-paper px-3',
                'cursor-pointer text-caption font-semibold text-nomi-ink transition-[background] duration-[var(--nomi-transition-fast)]',
                'hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:opacity-40',
              )}
              disabled={!projectId}
              aria-label="网页捕捞"
              title="打开捕捞窗：右键网页图片即可存进素材库"
              onClick={() => {
                if (projectId) void getDesktopBridge()?.browserCapture?.open({ projectId })
              }}
            >
              <IconWorld size={13} stroke={2} aria-hidden="true" />
              网页捕捞
            </button>
            {onClose ? (
              <button
                type="button"
                className={cn(
                  'w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent',
                  'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05',
                  'transition-[background,color] duration-[var(--nomi-transition-fast)]',
                )}
                aria-label="关闭素材库"
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
          aria-label="素材文件选择器"
          onChange={handleUploadFiles}
        />

        {/* 工具行：筛选 + 搜索 */}
        <div className={cn('grid gap-2', compact ? 'px-3 py-3' : 'px-3 py-2.5')}>
          <div className={cn('flex min-w-0 items-center gap-2')}>
            {sourceTabs}
            {uploadButton}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <DesignSearchInput className="min-w-0 flex-1" placeholder="搜索素材…" ariaLabel="搜索素材" value={query} onChange={setQuery} />
            {deleteSelectedButton}
            {categoryFilterButton}
          </div>
        </div>

        {/* 网格 / 空态 */}
        <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-3.5 pb-4')}>
          {isEmpty ? (
            <DesignEmptyState
              density="inline"
              icon={<IconPhoto size={34} stroke={1.4} className="text-nomi-ink-30" />}
              title={sourceEmpty ? (sourceFilter === 'project' ? '还没有项目素材' : '还没有素材') : '没有匹配的素材'}
              description={
                sourceEmpty
                  ? '点「上传」导入图片、视频或音频，或在生成区生成后会自动出现在这里。'
                : '换个筛选或搜索词试试。'
              }
            />
          ) : compact ? (
            <div style={{ columnCount: 3, columnGap: '10px' }}>
              {visible.map((asset) => (
                <AssetGridCell
                  key={asset.id}
                  asset={asset}
                  compact
                  selectable
                  draggable={!projectSelectionEnabled}
                  selected={selectedIds.has(asset.id)}
                  onSelect={selectAsset}
                  onDragStartAsset={projectSelectionEnabled ? undefined : handleAssetDragStart}
                />
              ))}
            </div>
          ) : (
            <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const start = virtualRow.index * gridCols
                const rowAssets = visible.slice(start, start + gridCols)
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
                        selectable
                        draggable={!projectSelectionEnabled}
                        selected={selectedIds.has(asset.id)}
                        onSelect={selectAsset}
                        onDragStartAsset={projectSelectionEnabled ? undefined : handleAssetDragStart}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

export function AssetLibraryPanel({ opened, onClose, projectId }: Props): JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null)

  // ESC 关闭
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose])

  // 点击外部关闭（避开 Mantine 浮层 / 文件对话框）
  React.useEffect(() => {
    if (!opened) return
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return
      const target = e.target as Element | null
      if (!target) return
      if (panelRef.current.contains(target)) return
      if (target.closest(
        '.mantine-Modal-root, .mantine-Modal-overlay, .mantine-Modal-content,' +
        '.mantine-Drawer-root, .mantine-Drawer-overlay,' +
        '.mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Tooltip-tooltip,' +
        '[role="dialog"]'
      )) return
      onClose()
    }
    const id = window.requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      window.cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [opened, onClose])

  if (!opened) return null

  return (
    <Portal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="素材库"
        className={cn(
          'fixed flex flex-col overflow-hidden',
          'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg',
        )}
        style={{
          top: TOP_OFFSET,
          right: RIGHT_OFFSET,
          width: PANEL_WIDTH,
          height: `calc(100vh - ${TOP_OFFSET + 16}px)`,
          maxHeight: `calc(100vh - ${TOP_OFFSET + 16}px)`,
          zIndex: 4000,
          animation: 'nomi-panel-pop 140ms cubic-bezier(.2, .7, .3, 1)',
        }}
      >
        <AssetLibraryContent projectId={projectId} onClose={onClose} />
        <style>{`
          @keyframes nomi-panel-pop {
            from { opacity: 0; transform: translateY(-4px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>
      </div>
    </Portal>
  )
}
