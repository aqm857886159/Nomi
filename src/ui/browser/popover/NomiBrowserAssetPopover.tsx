import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopActiveProjectId, subscribeDesktopActiveProjectIdChange } from '../../../desktop/activeProject'
import { getDesktopBridge } from '../../../desktop/bridge'
import {
  NOMI_BROWSER_ASSETS,
  NOMI_BROWSER_ASSET_SOURCES,
  NOMI_BROWSER_ASSET_TABS,
  type NomiBrowserAsset,
  type NomiBrowserAssetSource,
  type NomiBrowserAssetTab,
} from '../assets/browserAssetData'
import {
  createBrowserPromptCategory,
} from '../assets/browserAssetLibraryStorage'
import { dispatchBrowserAssetsImportToCanvas } from '../overlay/globalAssetPopoverEvents'
import {
  BROWSER_DIALOG_ROOT_SELECTOR,
  BROWSER_IMAGE_DRAG_MIME,
  CANVAS_IMPORT_TARGET_SELECTOR,
  LEGACY_BROWSER_ASSET_DRAG_MIME,
  NOMI_ASSET_DRAG_MIME,
  PROMPT_EXTRACTION_SETTINGS_DIALOG_SELECTOR,
  PROMPT_MASONRY_COLUMN_GAP,
  TOOL_BUTTON_CLASS,
  TOOL_BUTTON_COMPACT_CLASS,
} from './browserAssetPopoverConstants'
import {
  browserAssetToCanvasImportItem,
  getAssetGridColumnCount,
  getPromptMasonryColumnCount,
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
  BlankContextMenuState,
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
  defaultSource = 'my',
  defaultTab = 'all',
  showTrigger = true,
  libraryProjectId,
  assets = NOMI_BROWSER_ASSETS,
  tabs = NOMI_BROWSER_ASSET_TABS,
  sourceTabs = NOMI_BROWSER_ASSET_SOURCES,
  onOpenChange,
  onWindowRectChange,
  onFullWindowModalChange,
  onDockModeChange,
  onAssetSelect,
  onCreateFolder,
  onImportRemoteAsset,
  browserCaptureEnabled = false,
  browserCaptureDisabled = false,
  browserCaptureRequest,
  browserPromptCaptureRequest,
  onBrowserCaptureToggle,
}: NomiBrowserAssetPopoverProps): JSX.Element {
  const { t } = useTranslation()
  const localizedTabs = React.useMemo(
    () => tabs.map((tab) => ({ ...tab, label: tab.labelKey ? t(tab.labelKey as 'browserAssets.all') : tab.label })),
    [t, tabs],
  )
  const localizedSourceTabs = React.useMemo(
    () =>
      sourceTabs.map((source) => ({
        ...source,
        label: source.labelKey ? t(source.labelKey as 'browserAssets.projectAssets') : source.label,
      })),
    [sourceTabs, t],
  )
  const [internalOpen, setInternalOpen] = React.useState(defaultOpened)
  const [activeSource, setActiveSource] = React.useState<NomiBrowserAssetSource>(defaultSource)
  const [activeTab, setActiveTab] = React.useState<NomiBrowserAssetTab>(defaultTab)
  const [activePromptCategory, setActivePromptCategory] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [localAssets, setLocalAssets] = React.useState<NomiBrowserAsset[]>([])
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const [viewMode, setViewMode] = React.useState<AssetPopoverViewMode>('grid')
  const [sortAscending, setSortAscending] = React.useState(false)
  const [dropActive, setDropActive] = React.useState(false)
  const [assetContextMenu, setAssetContextMenu] = React.useState<AssetContextMenuState | null>(null)
  const [blankContextMenu, setBlankContextMenu] = React.useState<BlankContextMenuState | null>(null)
  const [renamingAssetId, setRenamingAssetId] = React.useState<string | null>(null)
  const [promptDetailAssetId, setPromptDetailAssetId] = React.useState<string | null>(null)
  const [promptExtractionSettingsOpen, setPromptExtractionSettingsOpen] = React.useState(false)
  // 提示词提取设置是唯一 fixed inset-0 溢出整窗的模态——它开合时通知承载方扩/缩可点热区，
  // 否则原生 overlay 承载态下它落在卡片外的死区，被点穿到网页（提示词详情用 absolute 不受影响）。
  React.useEffect(() => {
    onFullWindowModalChange?.(promptExtractionSettingsOpen)
  }, [onFullWindowModalChange, promptExtractionSettingsOpen])
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
  const singleTileToolbar = windowRect.width <= 220
  const listMode = viewMode === 'list'
  const gridCompact = compactToolbar
  const assetGridColumnCount = getAssetGridColumnCount(windowRect.width, gridCompact)
  const promptMasonryColumnCount = getPromptMasonryColumnCount(windowRect.width)
  const sourceTabGridStyle = React.useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${Math.max(localizedSourceTabs.length, 1)}, minmax(0, 1fr))` }),
    [localizedSourceTabs.length],
  )
  const assetGridStyle = React.useMemo<React.CSSProperties | undefined>(
    () =>
      listMode
        ? undefined
        : {
            gridTemplateColumns: `repeat(${assetGridColumnCount}, minmax(0, 1fr))`,
          },
    [assetGridColumnCount, listMode],
  )
  const promptMasonryStyle = React.useMemo<React.CSSProperties>(
    () => ({
      columnCount: promptMasonryColumnCount,
      columnGap: PROMPT_MASONRY_COLUMN_GAP,
    }),
    [promptMasonryColumnCount],
  )
  const toolbarButtonClass = compactToolbar ? TOOL_BUTTON_COMPACT_CLASS : TOOL_BUTTON_CLASS
  const filterPopoverRef = React.useRef<HTMLDivElement | null>(null)
  const filterButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const actionsPopoverRef = React.useRef<HTMLDivElement | null>(null)
  const actionsButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const assetContextMenuRef = React.useRef<HTMLDivElement | null>(null)
  const blankContextMenuRef = React.useRef<HTMLDivElement | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
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
    setActiveFolderId(null)
    setPromptDetailAssetId(null)
    setAssetContextMenu(null)
    setBlankContextMenu(null)
    setRenamingAssetId(null)
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
      event.preventDefault()
      event.stopImmediatePropagation()
      if (actionsOpen || filtersOpen) {
        setActionsOpen(false)
        setFiltersOpen(false)
        return
      }
      if (promptExtractionSettingsOpen) {
        setPromptExtractionSettingsOpen(false)
        return
      }
      if (promptDetailAssetId) {
        setPromptDetailAssetId(null)
        return
      }
      // 重命名输入框优先：Esc 只取消重命名，不关素材盒（capture 先于 input 自身的 keydown）。
      if (renamingAssetId) {
        setRenamingAssetId(null)
        return
      }
      if (assetContextMenu) {
        setAssetContextMenu(null)
        return
      }
      if (blankContextMenu) {
        setBlankContextMenu(null)
        return
      }
      setPopoverOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [actionsOpen, assetContextMenu, blankContextMenu, filtersOpen, popoverOpen, promptDetailAssetId, promptExtractionSettingsOpen, renamingAssetId, setPopoverOpen])

  React.useEffect(() => {
    if (!popoverOpen) {
      setFiltersOpen(false)
      setActionsOpen(false)
      setAssetContextMenu(null)
      setBlankContextMenu(null)
      setPromptDetailAssetId(null)
      setPromptExtractionSettingsOpen(false)
      setCanvasImportAvailable(false)
      setRenamingAssetId(null)
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
    libraryState,
    setPersistedAssets,
    updateLibraryState,
    mergedAssets,
    currentFolder,
    folderBreadcrumbs,
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
  } = useBrowserAssetLibraryModel({
    projectId: activeLibraryProjectId,
    popoverOpen,
    assets,
    localAssets,
    sourceTabs: localizedSourceTabs,
    activeSource,
    activeTab,
    activePromptCategory,
    activeFolderId,
    promptDetailAssetId,
    query,
    selectedIds,
    sortAscending,
    setActiveFolderId,
  })
  const { importRemoteAssetToLibrary } = useBrowserAssetCaptureImport({
    activeFolderId,
    promptExtractionSettings,
    browserCaptureRequest,
    browserPromptCaptureRequest,
    onImportRemoteAsset,
    setPopoverOpen,
    setActiveSource,
    setActiveTab,
    setActiveFolderId,
    setLocalAssets,
    setPersistedAssets,
    setSelectedIds,
    updateLibraryState,
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
    createFolder,
    beginRenameFolder,
    commitRenameFolder,
    cancelRenameFolder,
    addLocalFiles,
    handleUploadFiles,
    selectAsset,
    openAssetContextMenu,
    openBlankContextMenu,
    openPromptDetail,
    openFolder,
    openAssetRoot,
    exitCurrentFolder,
    selectAssetSource,
    deleteSelectedAssets,
    handleTileDragStart,
    handleTileDragOver,
    handleTileDrop,
  } = useBrowserAssetActions({
    activeFolderId,
    currentFolder,
    libraryState,
    promptLibrarySourceKey,
    assetById,
    mergedAssets,
    filteredAssets,
    selectedAssets,
    selectedIds,
    windowRect,
    popoverOpen,
    rootRef,
    previewUrlsRef,
    onCreateFolder,
    onAssetSelect,
    updateLibraryState,
    setActiveSource,
    setActiveTab,
    setActivePromptCategory,
    setActiveFolderId,
    setSelectedIds,
    setLocalAssets,
    setPersistedAssets,
    setAssetContextMenu,
    setBlankContextMenu,
    setFiltersOpen,
    setActionsOpen,
    setPromptDetailAssetId,
    setRenamingAssetId,
  })
  // 右键菜单「重命名」只对**单选文件夹**出现（多选/普通素材不给，避免歧义）。
  const renameTargetFolder = selectedAssets.length === 1 && selectedAssets[0].type === 'folder' ? selectedAssets[0] : null
  const canRenameSelectedFolder = Boolean(renameTargetFolder)
  const beginRenameSelectedFolder = React.useCallback((): void => {
    if (renameTargetFolder) beginRenameFolder(renameTargetFolder.id)
  }, [beginRenameFolder, renameTargetFolder])
  const selectedCanvasImportAssets = React.useMemo(
    () => selectedAssets.map(browserAssetToCanvasImportItem).filter(isBrowserAssetCanvasImportItem),
    [selectedAssets],
  )
  const canImportSelectedAssetsToCanvas = canvasImportAvailable && selectedCanvasImportAssets.length > 0
  const importSelectedAssetsToCanvas = React.useCallback((): void => {
    if (!canImportSelectedAssetsToCanvas) return
    setAssetContextMenu(null)
    setBlankContextMenu(null)
    dispatchBrowserAssetsImportToCanvas(selectedCanvasImportAssets)
  }, [canImportSelectedAssetsToCanvas, selectedCanvasImportAssets])

  React.useEffect(() => {
    if (localizedSourceTabs.some((source) => source.key === activeSource)) return
    const fallbackSource = localizedSourceTabs[0]?.key
    if (fallbackSource) setActiveSource(fallbackSource)
  }, [activeSource, localizedSourceTabs])

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
    if (!actionsOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (actionsPopoverRef.current?.contains(target)) return
      if (actionsButtonRef.current?.contains(target)) return
      setActionsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [actionsOpen])

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
    if (!blankContextMenu) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (blankContextMenuRef.current?.contains(target)) return
      setBlankContextMenu(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [blankContextMenu])

  React.useEffect(() => {
    if (!compactToolbar) setActionsOpen(false)
  }, [compactToolbar])

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
    setActionsOpen(false)
  }, [])

  const selectPromptCategory = React.useCallback((categoryId: string): void => {
    setActivePromptCategory(categoryId)
    setFiltersOpen(false)
    setActionsOpen(false)
  }, [])

  const addPromptCategory = React.useCallback((label: string): void => {
    const category = createBrowserPromptCategory(activeLibraryProjectId, label)
    if (category) setActivePromptCategory(category.id)
  }, [activeLibraryProjectId])

  const showAllFilters = React.useCallback((): void => {
    setActiveTab('all')
    setActivePromptCategory('all')
    setFiltersOpen(false)
    setActionsOpen(false)
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
        rootRef, className, contained, placement, surface, showTrigger, popoverOpen, setPopoverOpen, windowRect, hostOrigin, isWindowInteracting, dockMode,
        handleWindowDragEnter, handleWindowDragOver, handleWindowDragLeave, handleWindowDrop, splitDocked, edgeDocked, dropActive, handleHeaderPointerDown,
        compactToolbar, sourceTabs: localizedSourceTabs, activeSource, selectAssetSource, onBrowserCaptureToggle, toolbarButtonClass, browserCaptureEnabled, browserCaptureDisabled,
        promptExtractionSettingsOpen, setPromptExtractionSettingsOpen, canDock, activeBounds, toggleDockMode, query, setQuery, singleTileToolbar, sourceTabGridStyle,
        actionsButtonRef, actionsOpen, setActionsOpen, actionsPopoverRef, listMode, setViewMode, sortAscending, setSortAscending, filterButtonRef, filtersOpen,
        filterActive, setFiltersOpen, showingPromptLibrary, activePromptCategory, promptCategories, promptCategoryCounts, filterPopoverRef, selectPromptCategory,
        addPromptCategory, showAllFilters, activeTab, filterCounts, tabs: localizedTabs, selectFilterTab, uploadInputRef, createFolder, handleUploadFiles, currentFolder,
        exitCurrentFolder, activeSourceLabel, openAssetRoot, folderBreadcrumbs, openFolder, gridRef, handleGridPointerDown, handleGridPointerMove, handleGridPointerUp,
        openBlankContextMenu, filteredAssets, emptyStateCopy, promptMasonryStyle, selectedIds, setAssetNode, selectAsset, openPromptDetail, openAssetContextMenu,
        handleTileDragStart, gridCompact, viewMode, handleTileDragOver, handleTileDrop, assetGridStyle, marquee, promptDetailAsset, setPromptDetailAssetId,
        promptExtractionSettings, promptExtractionSettingsProjectAvailable, savePromptExtractionSettings, activeResizeEdges, startResize, assetContextMenu,
        assetContextMenuRef, canImportSelectedAssetsToCanvas, importSelectedAssetsToCanvas, deleteSelectedAssets, blankContextMenu, blankContextMenuRef,
        renamingAssetId, canRenameSelectedFolder, beginRenameSelectedFolder, commitRenameFolder, cancelRenameFolder,
      }}
    />
  )
}
