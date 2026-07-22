/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { IconCamera } from '@tabler/icons-react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconBox,
  IconExternalLink,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconStar,
  IconSearch,
  IconStarFilled,
  IconTrash,
  IconWorld,
  IconX,
} from '../../../vendor/tablerIcons'
import { BodyPortal, NomiLogoMark } from '../../../design'
import { cn } from '../../../utils/cn'
import { NomiBrowserAssetPopover } from '../popover/NomiBrowserAssetPopover'
import {
  BROWSER_START_SHORTCUTS,
  CAPTURE_FLYOUT_KEYFRAME_TIMES,
  MATERIAL_SITE_SHORTCUTS,
  PromptModeOption,
  TAB_CONTEXT_MENU_ITEM_CLASS,
  TAB_CONTEXT_MENU_WIDTH,
  TAB_LIMIT,
  TOOL_BUTTON_CLASS,
  captureFlyoutScale,
  TabFavicon,
  type BrowserBookmark,
  type BrowserCaptureFlyout,
  type BrowserTab,
} from './NomiBrowserDialogModel'

type NomiBrowserDialogViewProps = Record<string, any>

export function NomiBrowserDialogView({
  activeBookmarked,
  activeTab,
  activeTabId,
  addressValue,
  bookmarkContextMenu,
  bookmarkContextMenuRef,
  bookmarks,
  browserAssetPopoverOpen,
  browserBridge,
  browserCaptureRequest,
  browserResourceCaptureEnabled,
  browserViewHostRef,
  captureFlyouts,
  closeAllTabs,
  closeTab,
  contextMenuBookmark,
  contextMenuTab,
  contextMenuTabBookmarked,
  createTab,
  dialogTopOffset,
  dockPanelWidth,
  handleAddressBlur,
  handleAddressChange,
  handleAddressFocus,
  handleBrowserAssetPopoverOpenChange,
  handleBrowserAssetPopoverRectChange,
  handleDockResizeEnd,
  handleDockResizeMove,
  handleDockResizeStart,
  importBrowserAssetToAssetPopover,
  lastError,
  localBrowserAssetPopoverSplit,
  materialSitesOpen,
  materialSitesRef,
  navigateActiveTab,
  onClose,
  openBookmarkContextMenu,
  openBrowserScreenshotPromptModePicker,
  openTabContextMenu,
  promptModePicker,
  promptModePickerRef,
  removeBookmark,
  removeCaptureFlyout,
  renameBookmark,
  runBrowserScreenshotPrompt,
  saveBookmark,
  setActiveTabId,
  setAddressValue,
  setBookmarkContextMenu,
  setBrowserAssetPopoverDockMode,
  setMaterialSitesOpen,
  setTabContextMenu,
  tabContextMenu,
  tabContextMenuRef,
  tabs,
  toggleBrowserResourceCapture,
  useNativeBrowserAssetOverlay,
  webContainerRef,
  webContentBounds,
}: NomiBrowserDialogViewProps): JSX.Element {
  const browserAssetPopoverBounds = React.useMemo(() => {
    if (!localBrowserAssetPopoverSplit || !webContentBounds) return webContentBounds
    const width = Math.min(dockPanelWidth, webContentBounds.width)
    return {
      left: webContentBounds.right - width,
      top: webContentBounds.top,
      right: webContentBounds.right,
      bottom: webContentBounds.bottom,
      width,
      height: webContentBounds.height,
    }
  }, [dockPanelWidth, localBrowserAssetPopoverSplit, webContentBounds])

  return (
    <BodyPortal>
      <div
        className="nomi-browser-dialog-root fixed bottom-0 left-0 right-0 z-[520] bg-nomi-paper font-nomi-sans text-nomi-ink"
        style={{ top: dialogTopOffset }}
      >
        <section
          className="nomi-browser-dialog__panel absolute inset-0 flex h-full min-h-0 w-full flex-col overflow-hidden border-0 bg-nomi-paper shadow-none"
          role="dialog"
          aria-modal="true"
          aria-label="浏览器"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex min-h-11 shrink-0 items-end gap-1 border-b border-nomi-line-soft bg-nomi-bg px-3 pt-2">
            <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {tabs.map((tab: BrowserTab) => {
                const active = tab.id === activeTabId
                return (
                  <div
                    key={tab.id}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      'group grid h-9 min-w-20 max-w-[200px] flex-[0_1_200px] cursor-pointer grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-2 rounded-t-nomi border border-b-0 px-2 text-left',
                      active
                        ? 'border-nomi-line bg-nomi-paper text-nomi-ink shadow-nomi-sm'
                        : 'border-transparent bg-transparent text-nomi-ink-60 hover:bg-nomi-paper/70 hover:text-nomi-ink',
                    )}
                    title={tab.title}
                    onClick={() => {
                      setTabContextMenu(null)
                      setActiveTabId(tab.id)
                      setAddressValue(tab.url)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setTabContextMenu(null)
                      setActiveTabId(tab.id)
                      setAddressValue(tab.url)
                    }}
                    onContextMenu={(event) => openTabContextMenu(tab, event)}
                  >
                    <span className="grid size-4 place-items-center text-nomi-ink-40"><TabFavicon tab={tab} /></span>
                    <span className="min-w-0 truncate text-caption font-medium">
                      {tab.loading ? '加载中...' : tab.title}
                    </span>
                    <button
                      type="button"
                      className="grid size-5 cursor-pointer place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-40 opacity-70 hover:bg-nomi-ink-05 hover:text-nomi-ink group-hover:opacity-100"
                      aria-label={`关闭 ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setTabContextMenu(null)
                        closeTab(tab.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        setTabContextMenu(null)
                        closeTab(tab.id)
                      }}
                    >
                      <IconX size={13} stroke={1.9} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                className={cn(TOOL_BUTTON_CLASS, 'mb-0.5')}
                aria-label="新建标签页"
                disabled={tabs.length >= TAB_LIMIT}
                onClick={() => createTab()}
              >
                <IconPlus size={17} stroke={1.8} aria-hidden="true" />
              </button>
            </div>
            <span className="mx-1 h-5 w-px bg-nomi-line-soft" aria-hidden="true" />
            <button type="button" className={TOOL_BUTTON_CLASS} aria-label="关闭浏览器" onClick={onClose}>
              <IconX size={18} stroke={1.8} aria-hidden="true" />
            </button>
          </div>

          <form
            className="grid min-h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-nomi-line-soft bg-nomi-paper px-3"
            onSubmit={(event) => {
              event.preventDefault()
              navigateActiveTab()
            }}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={TOOL_BUTTON_CLASS}
                aria-label="后退"
                disabled={!activeTab?.canGoBack}
                onClick={() => activeTab?.viewId && browserBridge?.back({ viewId: activeTab.viewId })}
              >
                <IconArrowLeft size={17} stroke={1.8} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={TOOL_BUTTON_CLASS}
                aria-label="前进"
                disabled={!activeTab?.canGoForward}
                onClick={() => activeTab?.viewId && browserBridge?.forward({ viewId: activeTab.viewId })}
              >
                <IconArrowRight size={17} stroke={1.8} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={TOOL_BUTTON_CLASS}
                aria-label="刷新"
                disabled={!activeTab?.viewId}
                onClick={() => activeTab?.viewId && browserBridge?.reload({ viewId: activeTab.viewId })}
              >
                <IconRefresh size={17} stroke={1.8} aria-hidden="true" />
              </button>
            </div>
            <div className="flex h-8 min-w-0 items-center gap-2 rounded-pill border border-nomi-line bg-nomi-bg py-0 pl-3 pr-1 text-caption text-nomi-ink-60 focus-within:border-nomi-line focus-within:ring-0">
              <IconExternalLink size={14} stroke={1.7} className="shrink-0 text-nomi-ink-30" aria-hidden="true" />
              <input
                value={addressValue}
                onFocus={handleAddressFocus}
                onBlur={handleAddressBlur}
                onChange={handleAddressChange}
                placeholder="输入网址或搜索关键词"
                aria-label="地址栏"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-body-sm leading-8 text-nomi-ink outline-none ring-0 placeholder:text-nomi-ink-30 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
              />
              <button
                type="button"
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-pill border-0 bg-transparent',
                  'cursor-pointer text-nomi-ink-40 transition-colors duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05 hover:text-nomi-ink',
                  activeBookmarked && 'text-nomi-accent hover:text-nomi-accent',
                  (!activeTab?.url || activeBookmarked) && 'cursor-default',
                )}
                aria-label="保存为书签"
                aria-pressed={activeBookmarked}
                disabled={!activeTab?.url || activeBookmarked}
                onClick={() => saveBookmark(activeTab)}
              >
                {activeBookmarked ? (
                  <IconStarFilled size={15} aria-hidden="true" />
                ) : (
                  <IconStar size={15} stroke={1.8} aria-hidden="true" />
                )}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <div ref={materialSitesRef} className="relative">
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi-sm border-0 bg-transparent px-2',
                    'cursor-pointer text-caption font-semibold text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)]',
                    'hover:bg-nomi-ink-05 hover:text-nomi-ink',
                    materialSitesOpen && 'bg-nomi-ink-05 text-nomi-ink',
                  )}
                  aria-label="素材网站"
                  aria-haspopup="dialog"
                  aria-expanded={materialSitesOpen}
                  onClick={() => setMaterialSitesOpen((value: boolean) => !value)}
                >
                  <IconWorld size={16} stroke={1.8} aria-hidden="true" />
                  <span className="whitespace-nowrap">素材网站</span>
                </button>
                {materialSitesOpen ? (
                  <div
                    className="absolute right-0 top-[calc(100%+6px)] z-[12] w-[210px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg"
                    role="dialog"
                    aria-label="素材网站列表"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    {MATERIAL_SITE_SHORTCUTS.map((site) => (
                      <button
                        key={site.url}
                        type="button"
                        className="flex h-9 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2.5 text-left text-body-sm text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                        onClick={() => {
                          setMaterialSitesOpen(false)
                          void createTab(site.url)
                        }}
                      >
                        <IconWorld size={15} stroke={1.7} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{site.name}</span>
                        <IconExternalLink size={13} stroke={1.7} className="shrink-0 text-nomi-ink-30" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={TOOL_BUTTON_CLASS}
                aria-label="截图提取提示词"
                title="截图提取提示词"
                disabled={!activeTab?.viewId}
                onClick={openBrowserScreenshotPromptModePicker}
              >
                <IconCamera size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {/* 素材盒唯一入口（方案一 2026-07-12）：伴生收件箱只在浏览器语境出现，
                  顶栏常驻入口已删——找素材=浏览器，存素材=素材库。 */}
              <button
                type="button"
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi-sm border-0 bg-transparent px-2',
                  'cursor-pointer text-caption font-semibold text-nomi-ink-60 transition-[background,color] duration-[var(--nomi-transition-fast)]',
                  'hover:bg-nomi-ink-05 hover:text-nomi-ink',
                  browserAssetPopoverOpen && 'bg-nomi-ink-05 text-nomi-ink',
                )}
                aria-label={browserAssetPopoverOpen ? '收起素材盒' : '打开素材盒'}
                aria-pressed={browserAssetPopoverOpen}
                title="素材盒：捕捞收件箱，可多选拖上画布"
                onClick={() => handleBrowserAssetPopoverOpenChange(!browserAssetPopoverOpen)}
              >
                <IconBox size={16} stroke={1.8} aria-hidden="true" />
                <span className="whitespace-nowrap">素材盒</span>
              </button>
            </div>
          </form>

          <div className="flex min-h-9 shrink-0 items-center gap-1 overflow-hidden border-b border-nomi-line-soft bg-nomi-paper px-3">
            {bookmarks.slice(0, 10).map((bookmark: BrowserBookmark) => (
              <button
                key={bookmark.id}
                type="button"
                className="group inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-nomi-sm border-0 bg-transparent px-2 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
                title={bookmark.url}
                onClick={() => {
                  setBookmarkContextMenu(null)
                  void createTab(bookmark.url)
                }}
                onContextMenu={(event) => openBookmarkContextMenu(bookmark, event)}
              >
                <IconStar
                  size={13}
                  stroke={1.7}
                  className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent"
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{bookmark.title}</span>
              </button>
            ))}
            {bookmarks.length > 10 ? <span className="px-2 text-caption text-nomi-ink-30">···</span> : null}
            <span className="ml-auto shrink-0 text-micro text-nomi-ink-30">右键标签或书签打开菜单</span>
          </div>

          <main
            ref={webContainerRef}
            className={cn(
              'min-h-0 flex-1 overflow-hidden bg-nomi-bg',
              localBrowserAssetPopoverSplit ? 'flex flex-row' : 'relative',
            )}
            aria-label="网页内容"
          >
            <div
              ref={browserViewHostRef}
              className={cn(
                'relative overflow-hidden',
                localBrowserAssetPopoverSplit ? 'min-h-0 min-w-0 flex-1' : 'absolute inset-0',
              )}
            >
            {!activeTab?.viewId ? (
              <div className="absolute inset-0 grid place-items-center overflow-auto p-8">
                <div className="grid w-full max-w-[880px] gap-8">
                  <div className="text-center">
                    <div className="mx-auto mb-4 grid size-12 place-items-center">
                      <NomiLogoMark size={40} />
                    </div>
                    <h3 className="m-0 text-h2 font-semibold text-nomi-ink">打开网页参考</h3>
                    <p className="m-0 mt-2 text-body-sm text-nomi-ink-40">
                      输入网址直达，或用 Bing 搜索关键词
                    </p>
                  </div>
                  <form
                    className="mx-auto w-full max-w-[560px]"
                    onSubmit={(event) => {
                      event.preventDefault()
                      navigateActiveTab()
                    }}
                  >
                    <div className="flex items-center gap-2 rounded-pill border border-nomi-line bg-nomi-paper p-1.5 pl-5 shadow-nomi-sm transition-[border-color,box-shadow] focus-within:border-nomi-accent focus-within:shadow-nomi-md">
                      <IconSearch size={19} stroke={1.7} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
                      <input
                        value={addressValue}
                        onFocus={handleAddressFocus}
                        onBlur={handleAddressBlur}
                        onChange={handleAddressChange}
                        placeholder="搜 Bing 或输入网址"
                        aria-label="搜 Bing 或输入网址"
                        className="h-11 min-w-0 flex-1 border-0 bg-transparent text-body leading-[44px] outline-none ring-0 placeholder:text-nomi-ink-30 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                      />
                      <button
                        type="submit"
                        className="h-11 rounded-pill border-0 bg-nomi-ink px-5 text-body-sm font-semibold text-nomi-paper transition-colors hover:bg-nomi-accent"
                      >
                        打开
                      </button>
                    </div>
                  </form>
                  <div>
                    <div className="mb-3 text-caption font-semibold text-nomi-ink-40">常用参考站点</div>
                    <div
                      className="grid gap-2"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
                    >
                      {BROWSER_START_SHORTCUTS.map((site) => {
                        // 预设站图标不求第三方 favicon 服务（Google s2 对部分域 404、
                        // 中国网络下每次开浏览器都刷 console 错）——首字母瓷贴，零网络零 flake。
                        const initial = (site.label || '?').trim().slice(0, 1)
                        return (
                          <button
                            key={site.url}
                            type="button"
                            className={cn(
                              'group flex items-center gap-2.5 rounded-nomi border border-nomi-line bg-nomi-paper p-2.5 text-left',
                              'cursor-pointer transition-[background,border-color,transform,box-shadow] duration-[var(--nomi-transition-fast)]',
                              'hover:-translate-y-px hover:border-nomi-accent hover:shadow-nomi-md',
                            )}
                            onClick={() => {
                              void createTab(site.url)
                            }}
                            title={site.url}
                          >
                            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-nomi-sm bg-nomi-ink-05 text-caption font-bold text-nomi-ink-60 transition-colors group-hover:bg-nomi-accent-soft group-hover:text-nomi-accent">
                              {initial || <IconWorld size={15} stroke={1.7} aria-hidden="true" />}
                            </span>
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="truncate text-caption font-semibold text-nomi-ink">{site.label}</span>
                              <span className="truncate text-micro text-nomi-ink-40">{site.hint}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {lastError ? (
              <div className="absolute left-1/2 top-4 z-[2] -translate-x-1/2 rounded-pill border border-nomi-line bg-nomi-paper px-3 py-1.5 text-caption text-workbench-danger shadow-nomi-sm">
                {lastError}
              </div>
            ) : null}
            </div>
            {!useNativeBrowserAssetOverlay ? (
              <div
                className={cn(
                  localBrowserAssetPopoverSplit
                    ? 'relative shrink-0 border-l border-nomi-line-soft'
                    : 'absolute inset-0 pointer-events-none',
                )}
                style={localBrowserAssetPopoverSplit ? { width: dockPanelWidth } : undefined}
              >
                <NomiBrowserAssetPopover
                  surface="contained"
                  placement="absolute"
                  opened={browserAssetPopoverOpen}
                  boundsRect={browserAssetPopoverBounds}
                  showTrigger={false}
                  onOpenChange={handleBrowserAssetPopoverOpenChange}
                  onWindowRectChange={handleBrowserAssetPopoverRectChange}
                  onDockModeChange={setBrowserAssetPopoverDockMode}
                  dockPresentation={localBrowserAssetPopoverSplit ? 'split' : 'overlay'}
                  onImportRemoteAsset={importBrowserAssetToAssetPopover}
                  browserCaptureEnabled={browserResourceCaptureEnabled}
                  browserCaptureDisabled={!activeTab?.viewId || !browserBridge?.setResourceCapture}
                  browserCaptureRequest={browserCaptureRequest}
                  onBrowserCaptureToggle={toggleBrowserResourceCapture}
                />
                {localBrowserAssetPopoverSplit ? (
                  <div
                    className="absolute -left-1 top-0 z-[570] h-full w-2 cursor-ew-resize touch-none"
                    onPointerDown={handleDockResizeStart}
                    onPointerMove={handleDockResizeMove}
                    onPointerUp={handleDockResizeEnd}
                    onPointerCancel={handleDockResizeEnd}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            ) : null}
          </main>
        </section>
        {promptModePicker ? (
          <div
            ref={promptModePickerRef}
            className="fixed z-[575] w-56 rounded-nomi border border-nomi-line bg-nomi-paper p-1.5 shadow-nomi-lg"
            style={{ left: promptModePicker.x, top: promptModePicker.y }}
            role="menu"
            aria-label="选择提示词提取方式"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <PromptModeOption
              mode="replicate"
              onSelect={(mode) => runBrowserScreenshotPrompt(mode, promptModePicker.tab)}
            />
            <PromptModeOption
              mode="style"
              onSelect={(mode) => runBrowserScreenshotPrompt(mode, promptModePicker.tab)}
            />
          </div>
        ) : null}
        <AnimatePresence>
          {captureFlyouts.map((flyout: BrowserCaptureFlyout) => (
            <motion.div
              key={flyout.id}
              data-browser-capture-flyout=""
              className="pointer-events-none fixed left-0 top-0 z-[570] overflow-hidden rounded-nomi border border-nomi-accent bg-nomi-paper shadow-nomi-lg ring-2 ring-nomi-accent ring-offset-2 ring-offset-nomi-paper"
              initial={{
                x: flyout.sourceRect.left,
                y: flyout.sourceRect.top,
                width: flyout.sourceRect.width,
                height: flyout.sourceRect.height,
                opacity: 0.72,
                scale: 0.98,
              }}
              animate={{
                x: [
                  flyout.sourceRect.left,
                  flyout.sourceRect.left,
                  flyout.targetRect.left,
                ],
                y: [
                  flyout.sourceRect.top,
                  flyout.sourceRect.top,
                  flyout.targetRect.top,
                ],
                width: [
                  flyout.sourceRect.width,
                  flyout.sourceRect.width,
                  flyout.targetRect.width,
                ],
                height: [
                  flyout.sourceRect.height,
                  flyout.sourceRect.height,
                  flyout.targetRect.height,
                ],
                opacity: [0.78, 1, 0.08],
                scale: [0.98, 1.02, captureFlyoutScale(flyout.sourceRect, flyout.targetRect)],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.74, times: CAPTURE_FLYOUT_KEYFRAME_TIMES, ease: [0.22, 1, 0.36, 1] }}
              onAnimationComplete={() => removeCaptureFlyout(flyout.id)}
              aria-hidden="true"
            >
              {flyout.mediaType === 'video' ? (
                <>
                  <video src={flyout.url} muted playsInline className="block size-full bg-nomi-ink object-contain" />
                  <span className="absolute right-1 top-1 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro font-semibold leading-none text-nomi-paper shadow-nomi-sm">
                    视频
                  </span>
                </>
              ) : (
                <img src={flyout.url} alt="" draggable={false} className="block size-full object-contain" />
              )}
              <span className="absolute inset-0 rounded-nomi ring-1 ring-inset ring-nomi-paper/85" />
              <motion.span
                className="absolute inset-0 rounded-nomi bg-nomi-accent"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.28, 0] }}
                transition={{ duration: 0.42, times: [0, 0.28, 1], ease: 'easeOut' }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
        {contextMenuTab && tabContextMenu ? (
          <div
            ref={tabContextMenuRef}
            className="fixed z-[560] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y, width: TAB_CONTEXT_MENU_WIDTH }}
            role="menu"
            aria-label={`${contextMenuTab.title} 标签菜单`}
            data-nomi-browser-tab-menu="true"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={TAB_CONTEXT_MENU_ITEM_CLASS}
              role="menuitem"
              disabled={!contextMenuTab.url || contextMenuTabBookmarked}
              onClick={() => {
                saveBookmark(contextMenuTab)
                setTabContextMenu(null)
              }}
            >
              {contextMenuTabBookmarked ? (
                <IconStarFilled size={15} aria-hidden="true" className="shrink-0 text-nomi-accent" />
              ) : (
                <IconStar size={15} stroke={1.8} aria-hidden="true" className="shrink-0 text-nomi-ink-40" />
              )}
              <span className="min-w-0 flex-1 truncate">{contextMenuTabBookmarked ? '已收藏' : '收藏'}</span>
            </button>
            <button
              type="button"
              className={TAB_CONTEXT_MENU_ITEM_CLASS}
              role="menuitem"
              onClick={() => {
                closeTab(contextMenuTab.id)
                setTabContextMenu(null)
              }}
            >
              <IconX size={15} stroke={1.9} aria-hidden="true" className="shrink-0 text-nomi-ink-40" />
              <span className="min-w-0 flex-1 truncate">关闭标签</span>
            </button>
            {tabs.length > 1 ? (
              <>
                <div className="my-1 h-px bg-nomi-line-soft" aria-hidden="true" />
                <button
                  type="button"
                  className={cn(TAB_CONTEXT_MENU_ITEM_CLASS, 'text-workbench-danger hover:bg-workbench-danger-soft')}
                  role="menuitem"
                  onClick={closeAllTabs}
                >
                  <IconX size={15} stroke={1.9} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">关闭全部</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {contextMenuBookmark && bookmarkContextMenu ? (
          <div
            ref={bookmarkContextMenuRef}
            className="fixed z-[560] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg"
            style={{ left: bookmarkContextMenu.x, top: bookmarkContextMenu.y, width: TAB_CONTEXT_MENU_WIDTH }}
            role="menu"
            aria-label={`${contextMenuBookmark.title} 书签菜单`}
            data-nomi-browser-bookmark-menu="true"
            onContextMenu={(event) => event.preventDefault()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={TAB_CONTEXT_MENU_ITEM_CLASS}
              role="menuitem"
              onClick={() => {
                const bookmark = contextMenuBookmark
                setBookmarkContextMenu(null)
                window.setTimeout(() => renameBookmark(bookmark), 0)
              }}
            >
              <IconPencil size={15} stroke={1.8} aria-hidden="true" className="shrink-0 text-nomi-ink-40" />
              <span className="min-w-0 flex-1 truncate">重命名</span>
            </button>
            <button
              type="button"
              className={cn(TAB_CONTEXT_MENU_ITEM_CLASS, 'text-workbench-danger hover:bg-workbench-danger-soft')}
              role="menuitem"
              onClick={() => {
                removeBookmark(contextMenuBookmark.id)
                setBookmarkContextMenu(null)
              }}
            >
              <IconTrash size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">删除</span>
            </button>
          </div>
        ) : null}
      </div>
    </BodyPortal>
  )
}
