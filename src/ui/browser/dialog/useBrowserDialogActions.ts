/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React from 'react'
import { getDesktopActiveProjectId } from '../../../desktop/activeProject'
import {
  type DesktopBrowserChromeMenuItem,
  type DesktopBrowserPromptCaptureEvent,
  type DesktopBrowserTextPromptSaveEvent,
} from '../../../desktop/bridge'
import { toast } from '../../toast'
import { browserUrlDisplayTitle, normalizeBrowserInput } from './browserUrl'
import {
  type BrowserAssetPromptCaptureRequest,
  type BrowserAssetRemoteImportInput,
} from '../popover/NomiBrowserAssetPopover'
import { BROWSER_PROMPT_EXTRACTION_MODE_LABELS, type BrowserPromptExtractionMode } from '../prompt/browserPromptExtraction'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import { saveBrowserPromptCard } from '../assets/browserAssetLibraryStorage'
import type { FloatingWindowBoundsRect } from '../window/useResizableFloatingWindow'
import {
  PROMPT_MODE_PICKER_ESTIMATED_HEIGHT,
  PROMPT_MODE_PICKER_MARGIN,
  PROMPT_MODE_PICKER_WIDTH,
  TAB_CONTEXT_MENU_WIDTH,
  TAB_LIMIT,
  browserAssetFromDesktopAsset,
  canDownloadFromBrowserView,
  clampNumber,
  clampTabContextMenuPosition,
  createBlankTab,
  createTabId,
  promptCaptureRequestFromBrowserEvent,
  sameBoundsRect,
  writeBookmarks,
  type BrowserBookmark,
  type BrowserTab,
} from './NomiBrowserDialogModel'

type UseBrowserDialogActionsArgs = {
  activeTab: BrowserTab | null
  activeTabIdRef: React.MutableRefObject<string>
  addressEditingRef: React.MutableRefObject<boolean>
  addressValue: string
  bookmarks: BrowserBookmark[]
  browserBridge: any
  openNativeAssetPopover: (captureRequest?: any, promptRequest?: BrowserAssetPromptCaptureRequest) => boolean
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>
  setAddressValue: React.Dispatch<React.SetStateAction<string>>
  setBookmarkContextMenu: (value: any) => void
  setBookmarks: React.Dispatch<React.SetStateAction<BrowserBookmark[]>>
  setBrowserAssetPopoverDockMode: (value: any) => void
  setBrowserAssetPopoverOpen: (value: boolean) => void
  setBrowserAssetPopoverRect: React.Dispatch<React.SetStateAction<FloatingWindowBoundsRect | null>>
  setBrowserPromptCaptureRequest: (value: BrowserAssetPromptCaptureRequest | null) => void
  setBrowserResourceCaptureEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setLastError: (value: string | null) => void
  setMaterialSitesOpen: (value: boolean) => void
  setPromptModePicker: (value: any) => void
  setTabContextMenu: (value: any) => void
  setTabs: React.Dispatch<React.SetStateAction<BrowserTab[]>>
  tabsRef: React.MutableRefObject<BrowserTab[]>
}

export function useBrowserDialogActions({
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
  setBrowserPromptCaptureRequest,
  setBrowserResourceCaptureEnabled,
  setLastError,
  setMaterialSitesOpen,
  setPromptModePicker,
  setTabContextMenu,
  setTabs,
  tabsRef,
}: UseBrowserDialogActionsArgs): Record<string, any> {
  const createTab = React.useCallback(
    async (input?: string): Promise<void> => {
      if (tabsRef.current.length >= TAB_LIMIT) {
        setLastError(`最多只能打开 ${TAB_LIMIT} 个标签页`)
        return
      }
      const tabId = createTabId()
      const url = input ? normalizeBrowserInput(input) : ''
      let viewId: number | null = null
      if (url) {
        try {
          if (browserBridge) {
            const result = await browserBridge.createView({
              tabId,
            })
            viewId = result.viewId
            browserBridge.navigate({ viewId, url })
          }
          setLastError(null)
        } catch (error) {
          setLastError(error instanceof Error ? error.message : '浏览器视图创建失败')
        }
      }
      const tab: BrowserTab = {
        id: tabId,
        viewId,
        title: url ? browserUrlDisplayTitle(url) : '新建标签页',
        url,
        canGoBack: false,
        canGoForward: false,
        loading: Boolean(viewId),
      }
      setTabs((current) => [...current, tab])
      setActiveTabId(tab.id)
      setAddressValue(url)
    },
    [browserBridge],
  )

  const navigateTab = React.useCallback(
    async (tabId: string, input: string): Promise<void> => {
      if (tabsRef.current.length >= TAB_LIMIT) {
        const target = tabsRef.current.find((tab) => tab.id === tabId)
        if (!target) return
      }
      const url = normalizeBrowserInput(input)
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return
      let viewId = tab.viewId
      try {
        if (browserBridge && viewId === null) {
          const result = await browserBridge.createView({
            tabId,
          })
          viewId = result.viewId
        }
        if (browserBridge && viewId !== null) {
          browserBridge.navigate({ viewId, url })
        }
        setLastError(null)
      } catch (error) {
        setLastError(error instanceof Error ? error.message : '浏览器视图创建失败')
      }
      setTabs((current) =>
        current.map((item) =>
          item.id === tabId
            ? {
                ...item,
                viewId,
                title: browserUrlDisplayTitle(url),
                url,
                loading: Boolean(viewId),
              }
            : item,
        ),
      )
      setActiveTabId(tabId)
      setAddressValue(url)
    },
    [browserBridge],
  )

  const navigateActiveTab = React.useCallback((): void => {
    addressEditingRef.current = false
    const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
    if (!tab) {
      createTab(addressValue)
      return
    }
    void navigateTab(tab.id, addressValue)
  }, [addressValue, createTab, navigateTab])

  const handleAddressFocus = React.useCallback((): void => {
    addressEditingRef.current = true
  }, [])

  const handleAddressBlur = React.useCallback((): void => {
    addressEditingRef.current = false
  }, [])

  const handleAddressChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    addressEditingRef.current = true
    setAddressValue(event.currentTarget.value)
  }, [])

  const closeTab = React.useCallback(
    (tabId: string): void => {
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === tabId)
      const closing = current[index]
      if (!closing) return
      if (closing.viewId !== null) browserBridge?.destroyView({ viewId: closing.viewId })
      const next = current.filter((tab) => tab.id !== tabId)
      const normalizedNext = next.length > 0 ? next : [createBlankTab()]
      setTabs(normalizedNext)
      if (activeTabIdRef.current === tabId) {
        const replacement = normalizedNext[Math.max(0, index - 1)] ?? normalizedNext[0]
        setActiveTabId(replacement.id)
        setAddressValue(replacement.url)
      }
    },
    [browserBridge],
  )

  const closeAllTabs = React.useCallback((): void => {
    tabsRef.current.forEach((tab) => {
      if (tab.viewId !== null) browserBridge?.destroyView({ viewId: tab.viewId })
    })
    const blankTab = createBlankTab()
    setTabs([blankTab])
    setActiveTabId(blankTab.id)
    setAddressValue('')
    setTabContextMenu(null)
  }, [browserBridge])

  const saveBookmark = React.useCallback((tab: BrowserTab | null): void => {
    if (!tab) return
    setBookmarks((current) => {
      if (current.some((bookmark) => bookmark.url === tab.url)) return current
      const next = [
        ...current,
        {
          id: `bookmark-${Date.now()}`,
          title: tab.title || browserUrlDisplayTitle(tab.url),
          url: tab.url,
          favicon: tab.favicon,
          createdAt: Date.now(),
        },
      ]
      writeBookmarks(next)
      return next
    })
  }, [])

  const removeBookmark = React.useCallback((bookmarkId: string): void => {
    setBookmarks((current) => {
      const next = current.filter((bookmark) => bookmark.id !== bookmarkId)
      writeBookmarks(next)
      return next
    })
  }, [])

  const renameBookmark = React.useCallback((bookmark: BrowserBookmark): void => {
    const nextTitle = window.prompt('重命名书签', bookmark.title)?.trim()
    if (!nextTitle || nextTitle === bookmark.title) return
    setBookmarks((current) => {
      const next = current.map((item) => (item.id === bookmark.id ? { ...item, title: nextTitle } : item))
      writeBookmarks(next)
      return next
    })
  }, [])

  const openBookmarkContextMenu = React.useCallback(
    (bookmark: BrowserBookmark, event: React.MouseEvent<HTMLButtonElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      const position = clampTabContextMenuPosition(event.clientX, event.clientY, 2)
      setPromptModePicker(null)
      setMaterialSitesOpen(false)
      setTabContextMenu(null)
      setBookmarkContextMenu({
        bookmarkId: bookmark.id,
        x: position.x,
        y: position.y,
      })
    },
    [],
  )

  const openTabContextMenu = React.useCallback((tab: BrowserTab, event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const itemCount = tabsRef.current.length > 1 ? 3 : 2
    const position = clampTabContextMenuPosition(event.clientX, event.clientY, itemCount)
    setPromptModePicker(null)
    setMaterialSitesOpen(false)
    setBookmarkContextMenu(null)
    const bookmarked = Boolean(tab.url && bookmarks.some((bookmark) => bookmark.url === tab.url))
    const items: DesktopBrowserChromeMenuItem[] = [
      {
        id: 'bookmark',
        label: bookmarked ? '已收藏' : '收藏',
        enabled: Boolean(tab.url && !bookmarked),
      },
      { id: 'close-tab', label: '关闭标签' },
      ...(tabsRef.current.length > 1
        ? [
            { type: 'separator' as const },
            { id: 'close-all', label: '关闭全部' },
          ]
        : []),
    ]
    if (browserBridge?.showChromeMenu) {
      setTabContextMenu(null)
      void (async () => {
        const result = await browserBridge.showChromeMenu?.({
          x: position.x,
          y: position.y,
          width: TAB_CONTEXT_MENU_WIDTH,
          items,
        })
        if (result?.id === 'bookmark') saveBookmark(tab)
        if (result?.id === 'close-tab') closeTab(tab.id)
        if (result?.id === 'close-all') closeAllTabs()
      })()
      return
    }
    setTabContextMenu({
      tabId: tab.id,
      x: position.x,
      y: position.y,
    })
  }, [bookmarks, browserBridge, closeAllTabs, closeTab, saveBookmark])

  const openPromptCaptureInAssetPopover = React.useCallback(
    (request: BrowserAssetPromptCaptureRequest): void => {
      setLastError(null)
      if (openNativeAssetPopover(undefined, request)) return
      setBrowserAssetPopoverOpen(true)
      setBrowserPromptCaptureRequest(request)
    },
    [openNativeAssetPopover],
  )

  React.useEffect(() => {
    if (!browserBridge?.onPromptCapture) return undefined
    return browserBridge.onPromptCapture((event: DesktopBrowserPromptCaptureEvent) => {
      if (event.tabId !== activeTabIdRef.current) return
      if (!event.ok) {
        setLastError(event.reason === 'empty' ? '没有找到可提取提示词的图片。' : event.message || '图片提示词提取入口失败')
        return
      }
      openPromptCaptureInAssetPopover(promptCaptureRequestFromBrowserEvent(event))
    })
  }, [browserBridge, openPromptCaptureInAssetPopover])

  React.useEffect(() => {
    if (!browserBridge?.onTextPromptSave) return undefined
    return browserBridge.onTextPromptSave((event: DesktopBrowserTextPromptSaveEvent) => {
      if (event.tabId !== activeTabIdRef.current) return
      if (!event.ok) {
        setLastError(event.message || '保存网页选中文字失败')
        return
      }
      const saved = saveBrowserPromptCard({
        projectId: getDesktopActiveProjectId(),
        prompt: event.prompt,
        promptType: event.promptType,
        title: event.pageTitle,
      })
      if (saved) toast('已保存到素材盒提示词库', 'success')
    })
  }, [browserBridge])

  const runBrowserScreenshotPrompt = React.useCallback(
    (mode: BrowserPromptExtractionMode, tabSnapshot: BrowserTab): void => {
      const viewId = tabSnapshot.viewId
      if (!viewId) {
        setLastError('打开网页后才能截图提取提示词。')
        return
      }
      setPromptModePicker(null)
      void (async () => {
        browserBridge?.assetOverlay?.close()
        setBrowserAssetPopoverOpen(false)
        setBrowserAssetPopoverRect(null)
        setBrowserAssetPopoverDockMode(null)
        setBrowserResourceCaptureEnabled(false)
        setBrowserPromptCaptureRequest(null)
        await new Promise((resolve) => window.setTimeout(resolve, 80))
        const selection = await browserBridge?.selectPromptScreenshot?.({ viewId })
        if (!selection) {
          setLastError('当前浏览器不支持选区截图。')
          return
        }
        if (!selection.ok) {
          if (selection.reason === 'error') setLastError(selection.message || '选区截图失败')
          return
        }
        setLastError(null)
        openPromptCaptureInAssetPopover({
          requestId: `browser-prompt-screenshot-${viewId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sourceType: 'screenshot',
          extractionMode: mode,
          viewId,
          title: tabSnapshot.title || (mode === 'style' ? '网页选区风格' : '网页选区提示词'),
          fileName: `browser-selection-${Date.now()}.png`,
          pageUrl: tabSnapshot.url || undefined,
          pageTitle: tabSnapshot.title || undefined,
          sourceRect: selection.rect,
        })
      })()
    },
    [browserBridge, openPromptCaptureInAssetPopover],
  )

  const openBrowserScreenshotPromptModePicker = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      if (!activeTab?.viewId) {
        setLastError('打开网页后才能截图提取提示词。')
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const x = Math.round(
        clampNumber(
          rect.right - PROMPT_MODE_PICKER_WIDTH,
          PROMPT_MODE_PICKER_MARGIN,
          Math.max(PROMPT_MODE_PICKER_MARGIN, window.innerWidth - PROMPT_MODE_PICKER_WIDTH - PROMPT_MODE_PICKER_MARGIN),
        ),
      )
      const y = Math.round(
        clampNumber(
          rect.bottom + PROMPT_MODE_PICKER_MARGIN,
          PROMPT_MODE_PICKER_MARGIN,
          Math.max(PROMPT_MODE_PICKER_MARGIN, window.innerHeight - PROMPT_MODE_PICKER_ESTIMATED_HEIGHT - PROMPT_MODE_PICKER_MARGIN),
        ),
      )
      setLastError(null)
      setTabContextMenu(null)
      if (browserBridge?.showChromeMenu) {
        setPromptModePicker(null)
        void (async () => {
          const result = await browserBridge.showChromeMenu?.({
            x,
            y,
            width: PROMPT_MODE_PICKER_WIDTH,
            items: [
              {
                id: 'replicate',
                label: BROWSER_PROMPT_EXTRACTION_MODE_LABELS.replicate,
                description: '还原主体、构图、光影和细节',
              },
              {
                id: 'style',
                label: BROWSER_PROMPT_EXTRACTION_MODE_LABELS.style,
                description: '提取配色、字体、构图、效果 JSON',
              },
            ],
          })
          if (result?.id === 'replicate' || result?.id === 'style') {
            runBrowserScreenshotPrompt(result.id, activeTab)
          }
        })()
        return
      }
      setPromptModePicker({
        x,
        y,
        tab: activeTab,
      })
    },
    [activeTab, browserBridge, runBrowserScreenshotPrompt],
  )

  // 开合的唯一门：native overlay 模式下必须真的叫 openNativeAssetPopover/close，
  // 只翻 React 状态弹层永远不会出现（工具条素材盒按钮点不开的根因，2026-07-13 用户抓出）。
  const handleBrowserAssetPopoverOpenChange = React.useCallback((nextOpen: boolean): void => {
    if (nextOpen && openNativeAssetPopover()) return
    if (!nextOpen) browserBridge?.assetOverlay?.close()
    setBrowserAssetPopoverOpen(nextOpen)
    if (!nextOpen) {
      setBrowserAssetPopoverRect(null)
      setBrowserAssetPopoverDockMode(null)
      setBrowserResourceCaptureEnabled(false)
      setBrowserPromptCaptureRequest(null)
    }
  }, [browserBridge, openNativeAssetPopover])

  const handleBrowserAssetPopoverRectChange = React.useCallback((nextRect: FloatingWindowBoundsRect | null): void => {
    setBrowserAssetPopoverRect((current) => (sameBoundsRect(current, nextRect) ? current : nextRect))
  }, [])

  const toggleBrowserResourceCapture = React.useCallback((): void => {
    if (!activeTab?.viewId || !browserBridge?.setResourceCapture) {
      setLastError('打开网页后才能使用资源捕捞。')
      return
    }
    setLastError(null)
    if (openNativeAssetPopover()) return
    setBrowserAssetPopoverOpen(true)
    setBrowserResourceCaptureEnabled((enabled) => !enabled)
  }, [activeTab?.viewId, browserBridge, openNativeAssetPopover])

  const importBrowserAssetToAssetPopover = React.useCallback(
    async (input: BrowserAssetRemoteImportInput): Promise<NomiBrowserAsset> => {
      const projectId = getDesktopActiveProjectId()
      if (!projectId) throw new Error('projectId is required')
      const tab = tabsRef.current.find((item) => item.id === activeTabIdRef.current)
      const fallbackTitle = input.title || input.fileName || (input.mediaType === 'video' ? '网页视频' : '网页图片')
      if (!tab?.viewId || !browserBridge?.importMedia || !canDownloadFromBrowserView(input.url)) {
        throw new Error('来源页面会话已失效，请回到原网页重新拖入')
      }
      const asset = await browserBridge.importMedia({
        viewId: tab.viewId,
        projectId,
        url: input.url,
        fileName: input.fileName,
        title: input.title,
        mediaType: input.mediaType,
      })
      return browserAssetFromDesktopAsset(asset, fallbackTitle)
    },
    [browserBridge],
  )


  return {
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
  }
}
