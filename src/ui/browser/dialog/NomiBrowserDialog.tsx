import React from 'react'
import {
  getDesktopBridge,
  type DesktopBrowserAssetOverlayCaptureRequest,
  type DesktopBrowserAssetOverlayDockMode,
  type DesktopBrowserViewBounds,
  type DesktopBrowserResourceCaptureEvent,
  type DesktopBrowserViewState,
} from '../../../desktop/bridge'
import { browserUrlDisplayTitle } from './browserUrl'
import { type BrowserAssetCaptureRequest } from '../popover/NomiBrowserAssetPopover'
import { NomiBrowserDialogView } from './NomiBrowserDialogView'
import type { FloatingWindowBoundsRect } from '../window/useResizableFloatingWindow'
import { useBrowserDialogActions } from './useBrowserDialogActions'

import {
  BROWSER_VIEW_POPOVER_GAP,
  USE_NATIVE_BROWSER_ASSET_OVERLAY,
  browserBoundsFromRect,
  browserViewRectAroundPopover,
  captureFlyoutTargetRectFromPopover,
  createFallbackAssetPopoverRect,
  createBlankTab,
  createTabId,
  fallbackCaptureFlyoutSourceRect,
  fitCaptureFlyoutSourceRect,
  measureBrowserDialogTopOffset,
  overlayCaptureRequestFromBrowserEvent,
  readBookmarks,
  sameBoundsRect,
  sameBrowserViewBounds,
  toViewportRect,
  viewportRectFromEdges,
  type BrowserBookmark,
  type BrowserBookmarkContextMenu,
  type BrowserCaptureFlyout,
  type BrowserPromptModePickerState,
  type BrowserTab,
  type BrowserTabContextMenu,
  type NomiBrowserDialogProps,
} from './NomiBrowserDialogModel'
export function NomiBrowserDialog({ opened, onClose }: NomiBrowserDialogProps): JSX.Element | null {
  const browserBridge = getDesktopBridge()?.browser
  const [tabs, setTabs] = React.useState<BrowserTab[]>(() => {
    const tab = createBlankTab()
    return [tab]
  })
  const [activeTabId, setActiveTabId] = React.useState<string>(() => tabs[0]?.id ?? createTabId())
  const [addressValue, setAddressValue] = React.useState('')
  const [bookmarks, setBookmarks] = React.useState<BrowserBookmark[]>(() => readBookmarks())
  const [browserAssetPopoverOpen, setBrowserAssetPopoverOpen] = React.useState(false)
  const [browserAssetPopoverRect, setBrowserAssetPopoverRect] = React.useState<FloatingWindowBoundsRect | null>(null)
  const [browserAssetPopoverDockMode, setBrowserAssetPopoverDockMode] =
    React.useState<DesktopBrowserAssetOverlayDockMode>(null)
  const [dockPanelWidth, setDockPanelWidth] = React.useState(500)
  const [webContentBounds, setWebContentBounds] = React.useState<FloatingWindowBoundsRect | null>(null)
  const dockResizingRef = React.useRef<{ startX: number; startWidth: number } | null>(null)
  const [browserResourceCaptureEnabled, setBrowserResourceCaptureEnabled] = React.useState(false)
  const [browserCaptureRequest, setBrowserCaptureRequest] = React.useState<BrowserAssetCaptureRequest | null>(null)
  const [tabContextMenu, setTabContextMenu] = React.useState<BrowserTabContextMenu | null>(null)
  const [bookmarkContextMenu, setBookmarkContextMenu] = React.useState<BrowserBookmarkContextMenu | null>(null)
  const [lastError, setLastError] = React.useState<string | null>(null)
  const [promptModePicker, setPromptModePicker] = React.useState<BrowserPromptModePickerState | null>(null)
  const [materialSitesOpen, setMaterialSitesOpen] = React.useState(false)
  const [dialogTopOffset, setDialogTopOffset] = React.useState(0)
  const [captureFlyouts, setCaptureFlyouts] = React.useState<BrowserCaptureFlyout[]>([])
  const webContainerRef = React.useRef<HTMLDivElement | null>(null)
  const browserViewHostRef = React.useRef<HTMLDivElement | null>(null)
  const tabContextMenuRef = React.useRef<HTMLDivElement | null>(null)
  const bookmarkContextMenuRef = React.useRef<HTMLDivElement | null>(null)
  const promptModePickerRef = React.useRef<HTMLDivElement | null>(null)
  const materialSitesRef = React.useRef<HTMLDivElement | null>(null)
  const tabsRef = React.useRef(tabs)
  const activeTabIdRef = React.useRef(activeTabId)
  const escapeLayerRef = React.useRef({ materialSitesOpen, promptModePicker, tabContextMenu, bookmarkContextMenu })
  const addressEditingRef = React.useRef(false)
  const pendingCaptureFlyoutRef = React.useRef<Extract<DesktopBrowserResourceCaptureEvent, { ok: true }> | null>(null)
  const lastShownBrowserViewIdRef = React.useRef<number | null>(null)
  const lastBrowserViewBoundsRef = React.useRef<{ viewId: number; bounds: DesktopBrowserViewBounds } | null>(null)
  const lastBrowserAssetOverlayHostRef = React.useRef<{ viewId: number | null; bounds: DesktopBrowserViewBounds } | null>(null)

  escapeLayerRef.current = { materialSitesOpen, promptModePicker, tabContextMenu, bookmarkContextMenu }

  React.useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  React.useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  React.useEffect(() => {
    if (!promptModePicker) return undefined
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (promptModePickerRef.current?.contains(target)) return
      setPromptModePicker(null)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPromptModePicker(null)
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [promptModePicker])

  React.useEffect(() => {
    if (!materialSitesOpen) return undefined
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (materialSitesRef.current?.contains(target)) return
      setMaterialSitesOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMaterialSitesOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, { capture: true })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [materialSitesOpen])

  React.useEffect(() => {
    setPromptModePicker(null)
    setMaterialSitesOpen(false)
    setBookmarkContextMenu(null)
  }, [activeTabId, opened])

  React.useLayoutEffect(() => {
    if (!opened) return undefined
    const updateDialogTopOffset = (): void => {
      setDialogTopOffset(measureBrowserDialogTopOffset())
    }
    updateDialogTopOffset()
    window.addEventListener('resize', updateDialogTopOffset)
    const frame = window.requestAnimationFrame(updateDialogTopOffset)
    return () => {
      window.removeEventListener('resize', updateDialogTopOffset)
      window.cancelAnimationFrame(frame)
    }
  }, [opened])

  const activeTab = React.useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs])
  const activeBookmarked = React.useMemo(
    () => Boolean(activeTab?.url && bookmarks.some((bookmark) => bookmark.url === activeTab.url)),
    [activeTab, bookmarks],
  )
  const contextMenuTab = React.useMemo(
    () => tabs.find((tab) => tab.id === tabContextMenu?.tabId) ?? null,
    [tabContextMenu?.tabId, tabs],
  )
  const contextMenuBookmark = React.useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === bookmarkContextMenu?.bookmarkId) ?? null,
    [bookmarkContextMenu?.bookmarkId, bookmarks],
  )
  const contextMenuTabBookmarked = React.useMemo(
    () => Boolean(contextMenuTab?.url && bookmarks.some((bookmark) => bookmark.url === contextMenuTab.url)),
    [bookmarks, contextMenuTab],
  )
  const useNativeBrowserAssetOverlay = Boolean(USE_NATIVE_BROWSER_ASSET_OVERLAY && browserBridge?.assetOverlay)

  const syncWebContentBounds = React.useCallback((): void => {
    const node = webContainerRef.current
    if (!node) {
      setWebContentBounds((current) => (current === null ? current : null))
      return
    }
    const rect = toViewportRect(node.getBoundingClientRect())
    setWebContentBounds((current) => (sameBoundsRect(current, rect) ? current : rect))
  }, [])

  const hideTabView = React.useCallback(
    (tab: BrowserTab): void => {
      if (tab.viewId === null) return
      browserBridge?.hide({ viewId: tab.viewId })
      if (lastShownBrowserViewIdRef.current === tab.viewId) lastShownBrowserViewIdRef.current = null
    },
    [browserBridge],
  )

  const removeCaptureFlyout = React.useCallback((flyoutId: string): void => {
    setCaptureFlyouts((current) => current.filter((flyout) => flyout.id !== flyoutId))
  }, [])

  const startCaptureFlyout = React.useCallback(
    (event: Extract<DesktopBrowserResourceCaptureEvent, { ok: true }>): boolean => {
      const targetRect = captureFlyoutTargetRectFromPopover(browserAssetPopoverRect)
      if (!targetRect) return false
      const rawSourceRect = event.sourceRect
        ? {
            left: event.sourceRect.left,
            top: event.sourceRect.top,
            width: event.sourceRect.width,
            height: event.sourceRect.height,
          }
        : fallbackCaptureFlyoutSourceRect(webContainerRef.current)
      if (!rawSourceRect) return false
      const flyout: BrowserCaptureFlyout = {
        id: `capture-flyout-${event.viewId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: event.url,
        mediaType: event.mediaType,
        sourceRect: fitCaptureFlyoutSourceRect(rawSourceRect),
        targetRect,
      }
      setCaptureFlyouts((current) => [...current.slice(-2), flyout])
      return true
    },
    [browserAssetPopoverRect],
  )

  React.useEffect(() => {
    if (!browserAssetPopoverRect || !pendingCaptureFlyoutRef.current) return
    const pending = pendingCaptureFlyoutRef.current
    if (startCaptureFlyout(pending)) pendingCaptureFlyoutRef.current = null
  }, [browserAssetPopoverRect, startCaptureFlyout])

  const syncActiveViewBounds = React.useCallback((): void => {
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
    const node = webContainerRef.current
    if (!browserBridge || !tab?.viewId || !node) {
      if (tab) hideTabView(tab)
      return
    }
    const containerRect = toViewportRect(node.getBoundingClientRect())
    const localAssetPopoverOpen = browserAssetPopoverOpen && !useNativeBrowserAssetOverlay
    const localSplitDocked =
      localAssetPopoverOpen && Boolean(browserAssetPopoverDockMode)
    const nativeSplitDocked =
      browserAssetPopoverOpen && Boolean(browserAssetPopoverDockMode) && useNativeBrowserAssetOverlay
    const popoverRect = nativeSplitDocked
      ? browserAssetPopoverRect ?? createFallbackAssetPopoverRect(containerRect)
      : null
    const browserRect = localSplitDocked
      ? browserViewHostRef.current
        ? toViewportRect(browserViewHostRef.current.getBoundingClientRect())
        : viewportRectFromEdges(containerRect.left, containerRect.top, containerRect.right - dockPanelWidth, containerRect.bottom)
      : popoverRect
        ? browserViewRectAroundPopover(containerRect, popoverRect, nativeSplitDocked ? 0 : BROWSER_VIEW_POPOVER_GAP)
        : containerRect
    if (!browserRect || browserRect.width < 1 || browserRect.height < 1) {
      hideTabView(tab)
      return
    }
    const bounds = browserBoundsFromRect(browserRect)
    const lastBounds = lastBrowserViewBoundsRef.current
    const boundsChanged =
      !lastBounds || lastBounds.viewId !== tab.viewId || !sameBrowserViewBounds(lastBounds.bounds, bounds)
    if (boundsChanged) {
      browserBridge.resize({
        viewId: tab.viewId,
        bounds,
      })
      lastBrowserViewBoundsRef.current = { viewId: tab.viewId, bounds }
    }
    if (lastShownBrowserViewIdRef.current !== tab.viewId || boundsChanged) {
      browserBridge.show({ viewId: tab.viewId })
      lastShownBrowserViewIdRef.current = tab.viewId
    }
  }, [
    browserAssetPopoverDockMode,
    browserAssetPopoverOpen,
    browserAssetPopoverRect,
    browserBridge,
    dockPanelWidth,
    hideTabView,
    useNativeBrowserAssetOverlay,
  ])

  const syncBrowserAssetOverlayHost = React.useCallback((): void => {
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
    const node = webContainerRef.current
    if (!browserBridge?.assetOverlay) return
    if (!tab || !node) {
      lastBrowserAssetOverlayHostRef.current = null
      browserBridge.assetOverlay.close()
      return
    }
    const viewId = tab.viewId ?? null
    const bounds = browserBoundsFromRect(toViewportRect(node.getBoundingClientRect()))
    const lastHost = lastBrowserAssetOverlayHostRef.current
    if (lastHost?.viewId === viewId && sameBrowserViewBounds(lastHost.bounds, bounds)) return
    lastBrowserAssetOverlayHostRef.current = { viewId, bounds }
    browserBridge.assetOverlay.updateHost({ viewId, bounds })
  }, [browserBridge])

  const openNativeAssetPopover = React.useCallback(
    (captureRequest?: DesktopBrowserAssetOverlayCaptureRequest): boolean => {
      const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
      const node = webContainerRef.current
      if (!useNativeBrowserAssetOverlay || !browserBridge?.assetOverlay || !tab || !node) return false
      const wasPopoverOpen = browserAssetPopoverOpen
      const bounds = browserBoundsFromRect(toViewportRect(node.getBoundingClientRect()))
      browserBridge.assetOverlay.open({
        viewId: tab.viewId ?? null,
        bounds,
        ...(captureRequest ? { captureRequest } : {}),
      })
      setBrowserAssetPopoverOpen(true)
      if (!wasPopoverOpen) {
        setBrowserAssetPopoverDockMode(null)
        setBrowserAssetPopoverRect(null)
      }
      return true
    },
    [browserAssetPopoverOpen, browserBridge, useNativeBrowserAssetOverlay],
  )

  React.useEffect(() => {
    if (!opened) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      const layer = escapeLayerRef.current
      if (layer.materialSitesOpen) {
        setMaterialSitesOpen(false)
        return
      }
      if (layer.promptModePicker) {
        setPromptModePicker(null)
        return
      }
      if (layer.tabContextMenu) {
        setTabContextMenu(null)
        return
      }
      if (layer.bookmarkContextMenu) {
        setBookmarkContextMenu(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, opened])

  React.useEffect(() => {
    if (!tabContextMenu) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (tabContextMenuRef.current?.contains(target)) return
      setTabContextMenu(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [tabContextMenu])

  React.useEffect(() => {
    if (!bookmarkContextMenu) return
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (bookmarkContextMenuRef.current?.contains(target)) return
      setBookmarkContextMenu(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [bookmarkContextMenu])

  React.useEffect(() => {
    if (!tabContextMenu) return
    if (tabs.some((tab) => tab.id === tabContextMenu.tabId)) return
    setTabContextMenu(null)
  }, [tabContextMenu, tabs])

  React.useEffect(() => {
    if (!bookmarkContextMenu) return
    if (bookmarks.some((bookmark) => bookmark.id === bookmarkContextMenu.bookmarkId)) return
    setBookmarkContextMenu(null)
  }, [bookmarkContextMenu, bookmarks])

  React.useEffect(() => {
    if (!browserBridge) return undefined
    return browserBridge.onState((event: DesktopBrowserViewState) => {
      setTabs((current) => {
        let changed = false
        const nextTabs = current.map((tab) => {
          if (tab.viewId !== event.viewId) return tab
          const nextTab = {
            ...tab,
            title: event.title || browserUrlDisplayTitle(event.url),
            url: event.url || tab.url,
            favicon: event.favicon || tab.favicon,
            canGoBack: event.canGoBack,
            canGoForward: event.canGoForward,
            loading: event.loading,
          }
          if (
            tab.title === nextTab.title &&
            tab.url === nextTab.url &&
            tab.favicon === nextTab.favicon &&
            tab.canGoBack === nextTab.canGoBack &&
            tab.canGoForward === nextTab.canGoForward &&
            tab.loading === nextTab.loading
          ) {
            return tab
          }
          changed = true
          return nextTab
        })
        return changed ? nextTabs : current
      })
      if (event.tabId === activeTabIdRef.current && event.url && !addressEditingRef.current) {
        setAddressValue(event.url)
      }
    })
  }, [browserBridge])

  React.useEffect(() => {
    if (!USE_NATIVE_BROWSER_ASSET_OVERLAY || !browserBridge?.assetOverlay?.onState) return undefined
    return browserBridge.assetOverlay.onState((state) => {
      if (!useNativeBrowserAssetOverlay) return
      const nextOpened = Boolean(state.opened)
      const nextDockMode = nextOpened ? (state.dockMode ?? null) : null
      const nextPopoverRect = nextOpened ? (state.popoverRect ?? null) : null
      const nextCaptureEnabled = Boolean(nextOpened && state.captureEnabled)
      setBrowserAssetPopoverOpen((current) => (current === nextOpened ? current : nextOpened))
      setBrowserAssetPopoverDockMode((current) => (current === nextDockMode ? current : nextDockMode))
      setBrowserAssetPopoverRect((current) => (sameBoundsRect(current, nextPopoverRect) ? current : nextPopoverRect))
      setBrowserResourceCaptureEnabled((current) =>
        current === nextCaptureEnabled ? current : nextCaptureEnabled,
      )
      if (!state.opened) {
        setBrowserCaptureRequest(null)
      }
    })
  }, [browserBridge, useNativeBrowserAssetOverlay])

  React.useEffect(() => {
    if (USE_NATIVE_BROWSER_ASSET_OVERLAY || !browserAssetPopoverOpen) return
    browserBridge?.assetOverlay?.close()
  }, [browserAssetPopoverOpen, browserBridge])

  React.useEffect(() => {
    if (!browserBridge?.onResourceCapture) return undefined
    return browserBridge.onResourceCapture((event: DesktopBrowserResourceCaptureEvent) => {
      if (event.tabId !== activeTabIdRef.current) return
      if (!event.ok) {
        setLastError(
          event.reason === 'empty'
            ? '先将鼠标悬停在图片或视频上，再按 Ctrl+C 保存。'
            : event.message || '网页素材捕捞失败',
        )
        return
      }
      setLastError(null)
      const request = overlayCaptureRequestFromBrowserEvent(event)
      if (openNativeAssetPopover(request)) return
      setBrowserAssetPopoverOpen(true)
      if (!startCaptureFlyout(event)) pendingCaptureFlyoutRef.current = event
      setBrowserCaptureRequest({
        requestId: request.requestId,
        url: event.url,
        mediaType: event.mediaType,
        title: event.title || event.pageTitle || undefined,
        fileName: event.fileName || undefined,
      })
    })
  }, [browserBridge, openNativeAssetPopover, startCaptureFlyout])

  React.useEffect(() => {
    const viewId =
      browserAssetPopoverOpen && browserResourceCaptureEnabled && activeTab?.viewId ? activeTab.viewId : null
    if (!browserBridge?.setResourceCapture || viewId === null) return undefined
    browserBridge.setResourceCapture({ viewId, enabled: true })
    return () => browserBridge.setResourceCapture?.({ viewId, enabled: false })
  }, [activeTab?.viewId, browserAssetPopoverOpen, browserBridge, browserResourceCaptureEnabled])

  React.useEffect(() => {
    if (
      !browserAssetPopoverOpen ||
      !browserResourceCaptureEnabled ||
      !activeTab?.viewId ||
      !browserBridge?.captureResource
    ) {
      return undefined
    }
    const viewId = activeTab.viewId
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (event.key.toLowerCase() !== 'c') return
      if (!event.ctrlKey && !event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      browserBridge.captureResource?.({ viewId })
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [activeTab?.viewId, browserAssetPopoverOpen, browserBridge, browserResourceCaptureEnabled])

  React.useEffect(() => {
    if (!opened) return undefined
    const node = webContainerRef.current
    if (!node) return undefined
    const syncViews = (): void => {
      syncWebContentBounds()
      syncActiveViewBounds()
      syncBrowserAssetOverlayHost()
    }
    const observer = new ResizeObserver(syncViews)
    observer.observe(node)
    window.addEventListener('resize', syncViews)
    const frame = window.requestAnimationFrame(syncViews)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncViews)
      window.cancelAnimationFrame(frame)
    }
  }, [opened, syncActiveViewBounds, syncBrowserAssetOverlayHost, syncWebContentBounds])

  React.useEffect(() => {
    syncWebContentBounds()
    syncActiveViewBounds()
    syncBrowserAssetOverlayHost()
  }, [dialogTopOffset, syncActiveViewBounds, syncBrowserAssetOverlayHost, syncWebContentBounds])

  React.useEffect(() => {
    if (!opened) return
    syncWebContentBounds()
    syncActiveViewBounds()
    syncBrowserAssetOverlayHost()
  }, [opened, syncActiveViewBounds, syncBrowserAssetOverlayHost, syncWebContentBounds])

  React.useEffect(() => {
    if (opened) return
    tabsRef.current.forEach(hideTabView)
    browserBridge?.assetOverlay?.close()
    setWebContentBounds(null)
    setBrowserAssetPopoverOpen(false)
    setBrowserAssetPopoverRect(null)
    setBrowserAssetPopoverDockMode(null)
    setBrowserResourceCaptureEnabled(false)
    lastShownBrowserViewIdRef.current = null
    lastBrowserViewBoundsRef.current = null
    lastBrowserAssetOverlayHostRef.current = null
    setTabContextMenu(null)
    setCaptureFlyouts((current) => (current.length === 0 ? current : []))
  }, [browserBridge, hideTabView, opened])

  const handleDockResizeStart = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dockResizingRef.current = { startX: event.clientX, startWidth: dockPanelWidth }
  }, [dockPanelWidth])

  const handleDockResizeMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dockResizingRef.current) return
    const node = webContainerRef.current
    const maxWidth = node ? Math.floor(node.getBoundingClientRect().width * 0.75) : 800
    const dx = dockResizingRef.current.startX - event.clientX
    setDockPanelWidth(Math.max(220, Math.min(maxWidth, dockResizingRef.current.startWidth + dx)))
  }, [])

  const handleDockResizeEnd = React.useCallback((): void => {
    dockResizingRef.current = null
  }, [])

  React.useEffect(() => {
    tabs.forEach((tab) => {
      if (tab.id === activeTabId) return
      hideTabView(tab)
    })
    syncActiveViewBounds()
    syncBrowserAssetOverlayHost()
  }, [activeTabId, hideTabView, syncActiveViewBounds, syncBrowserAssetOverlayHost, tabs])

  React.useEffect(
    () => () => {
      tabsRef.current.forEach((tab) => {
        if (tab.viewId !== null) browserBridge?.destroyView({ viewId: tab.viewId })
      })
    },
    [browserBridge],
  )

  const {
    closeAllTabs,
    closeTab,
    createTab,
    handleAddressBlur,
    handleAddressChange,
    handleAddressFocus,
    handleBrowserAssetPopoverOpenChange,
    handleBrowserAssetPopoverRectChange,
    importBrowserAssetToAssetPopover,
    navigateActiveTab,
    openBookmarkContextMenu,
    openBrowserScreenshotPromptModePicker,
    openTabContextMenu,
    removeBookmark,
    renameBookmark,
    runBrowserScreenshotPrompt,
    saveBookmark,
    toggleBrowserResourceCapture,
  } = useBrowserDialogActions({
    activeTab,
    activeTabIdRef,
    addressEditingRef,
    addressValue,
    bookmarks,
    browserBridge,
    openNativeAssetPopover,
    setActiveTabId,
    setAddressValue,
    setBookmarkContextMenu,
    setBookmarks,
    setBrowserAssetPopoverDockMode,
    setBrowserAssetPopoverOpen,
    setBrowserAssetPopoverRect,
    setBrowserResourceCaptureEnabled,
    setLastError,
    setMaterialSitesOpen,
    setPromptModePicker,
    setTabContextMenu,
    setTabs,
    tabsRef,
  })

  const localBrowserAssetPopoverSplit = Boolean(browserAssetPopoverDockMode && !useNativeBrowserAssetOverlay)

  if (!opened) return null

  return (
    <NomiBrowserDialogView
      activeBookmarked={activeBookmarked}
      activeTab={activeTab}
      activeTabId={activeTabId}
      addressValue={addressValue}
      bookmarkContextMenu={bookmarkContextMenu}
      bookmarkContextMenuRef={bookmarkContextMenuRef}
      bookmarks={bookmarks}
      browserAssetPopoverOpen={browserAssetPopoverOpen}
      browserBridge={browserBridge}
      browserCaptureRequest={browserCaptureRequest}
      browserResourceCaptureEnabled={browserResourceCaptureEnabled}
      browserViewHostRef={browserViewHostRef}
      captureFlyouts={captureFlyouts}
      closeAllTabs={closeAllTabs}
      closeTab={closeTab}
      contextMenuBookmark={contextMenuBookmark}
      contextMenuTab={contextMenuTab}
      contextMenuTabBookmarked={contextMenuTabBookmarked}
      createTab={createTab}
      dialogTopOffset={dialogTopOffset}
      dockPanelWidth={dockPanelWidth}
      handleAddressBlur={handleAddressBlur}
      handleAddressChange={handleAddressChange}
      handleAddressFocus={handleAddressFocus}
      handleBrowserAssetPopoverOpenChange={handleBrowserAssetPopoverOpenChange}
      handleBrowserAssetPopoverRectChange={handleBrowserAssetPopoverRectChange}
      handleDockResizeEnd={handleDockResizeEnd}
      handleDockResizeMove={handleDockResizeMove}
      handleDockResizeStart={handleDockResizeStart}
      importBrowserAssetToAssetPopover={importBrowserAssetToAssetPopover}
      lastError={lastError}
      localBrowserAssetPopoverSplit={localBrowserAssetPopoverSplit}
      materialSitesOpen={materialSitesOpen}
      materialSitesRef={materialSitesRef}
      navigateActiveTab={navigateActiveTab}
      onClose={onClose}
      openBookmarkContextMenu={openBookmarkContextMenu}
      openBrowserScreenshotPromptModePicker={openBrowserScreenshotPromptModePicker}
      openTabContextMenu={openTabContextMenu}
      promptModePicker={promptModePicker}
      promptModePickerRef={promptModePickerRef}
      removeBookmark={removeBookmark}
      removeCaptureFlyout={removeCaptureFlyout}
      renameBookmark={renameBookmark}
      runBrowserScreenshotPrompt={runBrowserScreenshotPrompt}
      saveBookmark={saveBookmark}
      setActiveTabId={setActiveTabId}
      setAddressValue={setAddressValue}
      setBookmarkContextMenu={setBookmarkContextMenu}
      setBrowserAssetPopoverDockMode={setBrowserAssetPopoverDockMode}
      setMaterialSitesOpen={setMaterialSitesOpen}
      setTabContextMenu={setTabContextMenu}
      tabContextMenu={tabContextMenu}
      tabContextMenuRef={tabContextMenuRef}
      tabs={tabs}
      toggleBrowserResourceCapture={toggleBrowserResourceCapture}
      useNativeBrowserAssetOverlay={useNativeBrowserAssetOverlay}
      webContainerRef={webContainerRef}
      webContentBounds={webContentBounds}
    />
  )
}
