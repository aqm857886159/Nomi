import React from 'react'
import { getDesktopActiveProjectId, subscribeDesktopActiveProjectIdChange } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { NomiBrowserAsset, NomiBrowserAssetTab } from '../assets/browserAssetData'
import { dispatchBrowserAssetsImportToCanvas } from '../overlay/globalAssetPopoverEvents'
import {
  BROWSER_DIALOG_ROOT_SELECTOR,
  BROWSER_IMAGE_DRAG_MIME,
  CANVAS_IMPORT_TARGET_SELECTOR,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  NOMI_ASSET_DRAG_MIME,
  PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR,
} from './browserAssetPopoverConstants'
import {
  browserAssetToCanvasImportItem,
  getAssetGridColumnCount,
  isBrowserAssetCanvasImportItem,
  readBrowserImageDragPayload,
} from './browserAssetPopoverUtils'
import {
  createDefaultBrowserPromptExtractionTemplateSettings,
  normalizeBrowserPromptExtractionTemplateSettings,
} from '../prompt/browserPromptExtractionSettings'
import { useBrowserAssetPopoverWindow } from '../window/useBrowserAssetPopoverWindow'
import { useBrowserAssetMarquee } from './useBrowserAssetMarquee'
import { useBrowserAssetCaptureImport } from './useBrowserAssetCaptureImport'
import { useBrowserAssetLibraryModel } from './useBrowserAssetLibraryModel'
import { useBrowserAssetActions } from './useBrowserAssetActions'
import { BrowserAssetPopoverView } from './BrowserAssetPopoverView'
import type {
  AssetContextMenuState,
  AssetPopoverViewMode,
  BrowserPromptExtractionTemplateSettings,
  NomiBrowserAssetPopoverProps,
} from './browserAssetPopoverTypes'

export type {
  BrowserAssetCaptureRequest,
  BrowserAssetPopoverDockMode,
  BrowserAssetPromptCaptureRequest,
  BrowserAssetPromptCaptureRect,
  BrowserAssetPromptReference,
  BrowserAssetRemoteImportInput,
} from './browserAssetPopoverTypes'

export function NomiBrowserAssetPopover({
  className,
  placement = 'absolute',
  surface = 'floating',
  opened,
  anchorRect,
  boundsRect,
  dockable,
  dockPresentation = 'overlay',
  defaultOpened = false,
  defaultTab = 'all',
  libraryProjectId,
  onOpenChange,
  onWindowRectChange,
  onFullWindowModalChange,
  onDockModeChange,
  onImportRemoteAsset,
  browserCaptureEnabled = false,
  browserCaptureDisabled = false,
  browserCaptureRequest,
  onBrowserCaptureToggle,
}: NomiBrowserAssetPopoverProps): JSX.Element {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpened)
  const [activeTab, setActiveTab] = React.useState<NomiBrowserAssetTab>(defaultTab)
  const [query, setQuery] = React.useState('')
  const [localAssets, setLocalAssets] = React.useState<NomiBrowserAsset[]>([])
  // 捕捞临时卡（下载中/失败）不进 ready 素材网格——单列在弹层顶部状态条（审计 P1：错误项混进素材列表）。
  const captureTransients = React.useMemo(
    () => localAssets.filter((asset) => asset.status === 'loading' || asset.status === 'error'),
    [localAssets],
  )
  const readyLocalAssets = React.useMemo(
    () => localAssets.filter((asset) => asset.status !== 'loading' && asset.status !== 'error'),
    [localAssets],
  )
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<AssetPopoverViewMode>('grid')
  const [sortAscending, setSortAscending] = React.useState(false)
  const [dropActive, setDropActive] = React.useState(false)
  const [assetContextMenu, setAssetContextMenu] = React.useState<AssetContextMenuState | null>(null)
  const [promptExtractionSettingsOpen, setPromptExtractionSettingsOpen] = React.useState(false)
  // 删除确认弹窗（confirmDialog 宿主渲染 fixed 居中，溢出卡片矩形）。
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false)
  // 溢出整窗的模态（提示词提取设置 / 删除确认，fixed 居中）开合时通知承载方扩/缩可点热区，
  // 否则原生 overlay 承载态下它落在卡片外的死区，被点穿到网页。
  React.useEffect(() => {
    onFullWindowModalChange?.(promptExtractionSettingsOpen || deleteConfirmOpen)
  }, [deleteConfirmOpen, onFullWindowModalChange, promptExtractionSettingsOpen])
  const [canvasImportAvailable, setCanvasImportAvailable] = React.useState(false)
  const [promptExtractionSettings, setPromptExtractionSettings] = React.useState<BrowserPromptExtractionTemplateSettings>(
    () => createDefaultBrowserPromptExtractionTemplateSettings(),
  )
  const [promptExtractionSettingsProjectAvailable, setPromptExtractionSettingsProjectAvailable] = React.useState(false)
  const popoverOpen = opened ?? internalOpen
  const [currentProjectId, setCurrentProjectId] = React.useState(() => getDesktopActiveProjectId())
  const activeLibraryProjectId = libraryProjectId === undefined
    ? currentProjectId
    : typeof libraryProjectId === 'string'
      ? libraryProjectId.trim()
      : ''
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const {
    contained,
    canDock,
    dockMode,
    hostOrigin,
    splitDocked,
    edgeDocked,
    activeBounds,
    windowRect,
    isWindowInteracting,
    activeResizeEdges,
    startMove,
    startResize,
    toggleDockMode,
  } = useBrowserAssetPopoverWindow({
    surface,
    opened: popoverOpen,
    anchorRect,
    boundsRect,
    dockable,
    dockPresentation,
    rootRef,
    onWindowRectChange,
    onDockModeChange,
  })

  const compactToolbar = windowRect.width <= 560
  const listMode = viewMode === 'list'
  const gridCompact = compactToolbar
  const assetGridColumnCount = getAssetGridColumnCount(windowRect.width, gridCompact)
  const assetGridStyle = React.useMemo<React.CSSProperties | undefined>(
    () =>
      listMode
        ? undefined
        : {
            gridTemplateColumns: `repeat(${assetGridColumnCount}, minmax(0, 1fr))`,
          },
    [assetGridColumnCount, listMode],
  )
  const filterPopoverRef = React.useRef<HTMLDivElement | null>(null)
  const filterButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const assetContextMenuRef = React.useRef<HTMLDivElement | null>(null)
  const previewUrlsRef = React.useRef<string[]>([])

  const setPopoverOpen = React.useCallback(
    (nextOpen: boolean): void => {
      if (opened === undefined) setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [onOpenChange, opened],
  )

  React.useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      previewUrlsRef.current = []
    },
    [],
  )

  React.useEffect(() => {
    if (libraryProjectId !== undefined) return undefined
    return subscribeDesktopActiveProjectIdChange((projectId) => setCurrentProjectId(projectId.trim()))
  }, [libraryProjectId])

  React.useEffect(() => {
    if (popoverOpen && libraryProjectId === undefined) setCurrentProjectId(getDesktopActiveProjectId())
  }, [libraryProjectId, popoverOpen])

  React.useEffect(() => {
    setLocalAssets([])
    setSelectedIds(new Set())
    setAssetContextMenu(null)
  }, [activeLibraryProjectId])

  React.useEffect(() => {
    if (!popoverOpen || contained) return
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node
      const targetElement = target instanceof HTMLElement ? target : target.parentElement
      if (rootRef.current?.contains(target)) return
      if (targetElement?.closest(PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR)) return
      setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [contained, popoverOpen, setPopoverOpen])

  React.useEffect(() => {
    if (!popoverOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // 删除确认在场时整段吞掉 Esc：既不能关素材盒，也不能让外层浏览器 dialog 的
      // Esc 处理器把整个浏览器关掉（取消走弹窗的「取消」按钮/遮罩点击）。
      if (deleteConfirmOpen) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (filtersOpen) {
        setFiltersOpen(false)
        return
      }
      if (promptExtractionSettingsOpen) {
        setPromptExtractionSettingsOpen(false)
        return
      }
      if (assetContextMenu) {
        setAssetContextMenu(null)
        return
      }
      setPopoverOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [assetContextMenu, deleteConfirmOpen, filtersOpen, popoverOpen, promptExtractionSettingsOpen, setPopoverOpen])

  React.useEffect(() => {
    if (!popoverOpen) {
      setFiltersOpen(false)
      setAssetContextMenu(null)
      setPromptExtractionSettingsOpen(false)
      setCanvasImportAvailable(false)
    }
  }, [popoverOpen])

  React.useEffect(() => {
    if (!popoverOpen || contained || typeof document === 'undefined') {
      setCanvasImportAvailable(false)
      return undefined
    }
    const updateCanvasImportAvailability = (): void => {
      setCanvasImportAvailable(
        Boolean(document.querySelector(CANVAS_IMPORT_TARGET_SELECTOR)) &&
          !document.querySelector(BROWSER_DIALOG_ROOT_SELECTOR),
      )
    }
    updateCanvasImportAvailability()
    const observer = new MutationObserver(updateCanvasImportAvailability)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-nomi-generation-canvas-import-target'],
    })
    return () => observer.disconnect()
  }, [contained, popoverOpen])

  const loadPromptExtractionSettings = React.useCallback(async (): Promise<void> => {
    const projectId = getDesktopActiveProjectId()
    const browserBridge = getDesktopBridge()?.browser
    setPromptExtractionSettingsProjectAvailable(Boolean(projectId && browserBridge?.readPromptExtractionSettings))
    if (!projectId || !browserBridge?.readPromptExtractionSettings) {
      setPromptExtractionSettings(createDefaultBrowserPromptExtractionTemplateSettings())
      return
    }
    try {
      const result = await browserBridge.readPromptExtractionSettings({ projectId })
      const normalized = normalizeBrowserPromptExtractionTemplateSettings(result?.settings)
      setPromptExtractionSettings(normalized)
      if (!result?.settings && browserBridge.writePromptExtractionSettings) {
        void browserBridge.writePromptExtractionSettings({
          projectId,
          settings: normalized,
        }).catch(() => undefined)
      }
    } catch {
      setPromptExtractionSettings(createDefaultBrowserPromptExtractionTemplateSettings())
    }
  }, [])

  React.useEffect(() => {
    if (!popoverOpen) return
    void loadPromptExtractionSettings()
  }, [loadPromptExtractionSettings, popoverOpen])

  const savePromptExtractionSettings = React.useCallback(
    (settings: BrowserPromptExtractionTemplateSettings): void => {
      const normalized = normalizeBrowserPromptExtractionTemplateSettings(settings)
      setPromptExtractionSettings(normalized)
      setPromptExtractionSettingsOpen(false)
      const projectId = getDesktopActiveProjectId()
      const browserBridge = getDesktopBridge()?.browser
      setPromptExtractionSettingsProjectAvailable(Boolean(projectId && browserBridge?.writePromptExtractionSettings))
      if (!projectId || !browserBridge?.writePromptExtractionSettings) return
      void browserBridge.writePromptExtractionSettings({
        projectId,
        settings: normalized,
      }).catch(() => {
        // Best effort; in-memory settings remain active for the current session.
      })
    },
    [],
  )

  const {
    setPersistedAssets,
    refreshPersistedAssets,
    filterCounts,
    filteredAssets,
    visibleIdSet,
    selectedAssets,
    filterActive,
    emptyStateCopy,
  } = useBrowserAssetLibraryModel({
    projectId: activeLibraryProjectId,
    popoverOpen,
    localAssets: readyLocalAssets,
    activeTab,
    query,
    selectedIds,
    sortAscending,
  })
  const { importRemoteAssetToLibrary, retryCaptureImport, dismissCaptureTransient } = useBrowserAssetCaptureImport({
    browserCaptureRequest,
    onImportRemoteAsset,
    setActiveTab,
    setLocalAssets,
    setPersistedAssets,
    setSelectedIds,
  })
  const {
    gridRef,
    marquee,
    setAssetNode,
    handleGridPointerDown,
    handleGridPointerMove,
    handleGridPointerUp,
  } = useBrowserAssetMarquee({ popoverOpen, filteredAssets, setSelectedIds })
  const {
    addLocalFiles,
    selectAsset,
    openAssetContextMenu,
    deleteSelectedAssets,
    handleTileDragStart,
  } = useBrowserAssetActions({
    filteredAssets,
    selectedAssets,
    selectedIds,
    windowRect,
    popoverOpen,
    rootRef,
    previewUrlsRef,
    refreshPersistedAssets,
    setActiveTab,
    setSelectedIds,
    setLocalAssets,
    setPersistedAssets,
    setAssetContextMenu,
    setFiltersOpen,
    setDeleteConfirmOpen,
  })
  const selectedCanvasImportAssets = React.useMemo(
    () => selectedAssets.map(browserAssetToCanvasImportItem).filter(isBrowserAssetCanvasImportItem),
    [selectedAssets],
  )
  const canImportSelectedAssetsToCanvas = canvasImportAvailable && selectedCanvasImportAssets.length > 0
  const importSelectedAssetsToCanvas = React.useCallback((): void => {
    if (!canImportSelectedAssetsToCanvas) return
    setAssetContextMenu(null)
    dispatchBrowserAssetsImportToCanvas(selectedCanvasImportAssets)
  }, [canImportSelectedAssetsToCanvas, selectedCanvasImportAssets])

  React.useEffect(() => {
    if (!filtersOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (filterPopoverRef.current?.contains(target)) return
      if (filterButtonRef.current?.contains(target)) return
      setFiltersOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [filtersOpen])

  React.useEffect(() => {
    if (!assetContextMenu) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (assetContextMenuRef.current?.contains(target)) return
      setAssetContextMenu(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [assetContextMenu])

  React.useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIdSet.has(id)))
      return next.size === current.size ? current : next
    })
  }, [visibleIdSet])

  React.useEffect(() => {
    if (!assetContextMenu) return
    if (visibleIdSet.has(assetContextMenu.assetId)) return
    setAssetContextMenu(null)
  }, [assetContextMenu, visibleIdSet])

  const acceptsExternalAssetDrop = React.useCallback((dataTransfer: DataTransfer): boolean => {
    const types = Array.from(dataTransfer.types)
    if (types.includes(NOMI_ASSET_DRAG_MIME) || types.includes(LEGACY_BROWSER_ASSET_DRAG_MIME)) return false
    // 只有 Nomi 网页桥的确定媒体 payload 或真实文件才亮“松开保存”。普通文本/HTML
    // 在 dragover 阶段无法可靠解析，提前接纳会造成松手后静默无事发生。
    return types.includes(BROWSER_IMAGE_DRAG_MIME) || dataTransfer.files.length > 0
  }, [])

  const handleWindowDragEnter = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!acceptsExternalAssetDrop(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      setDropActive(true)
    },
    [acceptsExternalAssetDrop],
  )

  const handleWindowDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!acceptsExternalAssetDrop(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    },
    [acceptsExternalAssetDrop],
  )

  const handleWindowDragLeave = React.useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && event.currentTarget.contains(nextTarget)) return
    setDropActive(false)
  }, [])

  const handleWindowDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!acceptsExternalAssetDrop(event.dataTransfer)) return
      event.preventDefault()
      event.stopPropagation()
      setDropActive(false)

      const remoteAsset = readBrowserImageDragPayload(event.dataTransfer)
      if (remoteAsset) {
        void importRemoteAssetToLibrary(remoteAsset)
        return
      }

      const droppedFiles = Array.from(event.dataTransfer.files ?? [])
      if (droppedFiles.length > 0) addLocalFiles(droppedFiles)
    },
    [acceptsExternalAssetDrop, addLocalFiles, importRemoteAssetToLibrary],
  )

  const selectFilterTab = React.useCallback((tab: NomiBrowserAssetTab): void => {
    setActiveTab(tab)
    setFiltersOpen(false)
  }, [])

  const showAllFilters = React.useCallback((): void => {
    setActiveTab('all')
    setFiltersOpen(false)
  }, [])

  const handleHeaderPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (dockMode) return
      const target = event.target as HTMLElement | null
      if (target?.closest('button,input,textarea,select,[contenteditable="true"]')) return
      startMove(event)
    },
    [dockMode, startMove],
  )

  return (
    <BrowserAssetPopoverView
      {...{
        rootRef, className, contained, placement, surface, popoverOpen, setPopoverOpen, windowRect, hostOrigin, isWindowInteracting, dockMode,
        handleWindowDragEnter, handleWindowDragOver, handleWindowDragLeave, handleWindowDrop, splitDocked, edgeDocked, dropActive, handleHeaderPointerDown,
        compactToolbar, onBrowserCaptureToggle, browserCaptureEnabled, browserCaptureDisabled,
        promptExtractionSettingsOpen, setPromptExtractionSettingsOpen, canDock, activeBounds, toggleDockMode, query, setQuery,
        listMode, setViewMode, sortAscending, setSortAscending, filterButtonRef, filtersOpen, filterActive, setFiltersOpen,
        activeTab, filterCounts, filterPopoverRef, selectFilterTab, showAllFilters,
        gridRef, handleGridPointerDown, handleGridPointerMove, handleGridPointerUp, filteredAssets, emptyStateCopy, selectedIds, setAssetNode,
        selectAsset, openAssetContextMenu, handleTileDragStart, gridCompact, viewMode, assetGridStyle, marquee,
        promptExtractionSettings, promptExtractionSettingsProjectAvailable, savePromptExtractionSettings, activeResizeEdges, startResize,
        assetContextMenu, assetContextMenuRef, canImportSelectedAssetsToCanvas, importSelectedAssetsToCanvas, deleteSelectedAssets,
        captureTransients, retryCaptureImport, dismissCaptureTransient,
      }}
    />
  )
}
