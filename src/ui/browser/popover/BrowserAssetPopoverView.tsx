/* eslint-disable @typescript-eslint/no-explicit-any */
import { ScrollArea } from '@mantine/core'
import { motion } from 'framer-motion'
import { IconLayoutSidebarLeftExpand, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconZoomScan, IconAdjustmentsHorizontal } from '@tabler/icons-react'
import {
  IconArrowForwardUp,
  IconCards,
  IconFilter,
  IconLayoutGrid,
  IconList,
  IconMinus,
  IconSortAscending2,
  IconSortDescending2,
  IconTrash,
} from '../../../vendor/tablerIcons'
import { DesignEmptyState, DesignSearchInput } from '../../../design'
import { cn } from '../../../utils/cn'
import { NOMI_BROWSER_ASSET_TABS } from '../assets/browserAssetData'
import { BrowserAssetFilterPopover, BrowserAssetTile } from './BrowserAssetPopoverParts'
import { BrowserPromptExtractionSettingsModal } from '../prompt/BrowserPromptExtractionSettingsModal'
import {
  ASSET_CONTEXT_MENU_WIDTH,
  RESIZE_HANDLE_CLASS,
  TOOL_BUTTON_CLASS,
} from './browserAssetPopoverConstants'
import { browserAssetDisplaySubtitle, normalizeMarqueeRect } from './browserAssetPopoverUtils'
import type { FloatingWindowResizeEdge } from '../window/useResizableFloatingWindow'

type BrowserAssetPopoverViewProps = Record<string, any>

function resizeHandleClass(edge: FloatingWindowResizeEdge, edgeDocked: boolean): string {
  if (!edgeDocked) return RESIZE_HANDLE_CLASS[edge]
  if (edge === 'w') return 'left-0 top-0 h-full w-3 cursor-ew-resize'
  if (edge === 'e') return 'right-0 top-0 h-full w-3 cursor-ew-resize'
  return RESIZE_HANDLE_CLASS[edge]
}

export function BrowserAssetPopoverView(props: BrowserAssetPopoverViewProps): JSX.Element {
  const {
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
  } = props

  const popoverX = contained ? windowRect.left - (hostOrigin?.left ?? 0) : windowRect.left
  const popoverY = contained ? windowRect.top - (hostOrigin?.top ?? 0) : windowRect.top
  const containedEntryRightEdge = activeBounds
    ? activeBounds.right - (hostOrigin?.left ?? activeBounds.left)
    : (hostOrigin?.width ?? (typeof window === 'undefined' ? popoverX + windowRect.width : window.innerWidth))
  const containedInitialX = Math.max(popoverX + 24, containedEntryRightEdge + 18)

  return (
    <div
      ref={rootRef}
      className={cn(
        'nomi-browser-asset-popover-host font-nomi-sans text-nomi-ink',
        contained
          ? 'absolute inset-0 z-[560] overflow-hidden pointer-events-none'
          : [
              'z-[2] max-[760px]:bottom-3 max-[760px]:right-3',
              placement === 'fixed' ? 'fixed' : 'absolute',
              'bottom-[18px] right-[18px]',
            ],
        className,
      )}
      data-placement={placement}
      data-surface={surface}
    >
      {popoverOpen ? (
        <motion.div
          className={cn(
            'nomi-browser-asset-popover z-[1]',
            contained ? 'absolute left-0 top-0 pointer-events-auto' : 'fixed left-0 top-0',
          )}
          style={{ width: windowRect.width, height: windowRect.height }}
          initial={contained ? { opacity: 0, x: containedInitialX, y: popoverY, scale: 0.985 } : undefined}
          animate={{
            x: popoverX,
            y: popoverY,
            ...(contained ? { opacity: 1, scale: 1 } : null),
          }}
          transition={
            isWindowInteracting
              ? { duration: 0 }
              : contained
                ? { duration: 0.16, ease: 'easeOut' }
                : { type: 'spring', stiffness: 420, damping: 30, mass: 0.8 }
          }
          role="dialog"
          aria-label="素材盒"
          data-dock-mode={dockMode ?? 'floating'}
          onMouseDown={(event) => event.stopPropagation()}
          onDragEnter={handleWindowDragEnter}
          onDragOver={handleWindowDragOver}
          onDragLeave={handleWindowDragLeave}
          onDrop={handleWindowDrop}
        >
          <div
            className={cn(
              'relative flex size-full flex-col overflow-hidden rounded-nomi-lg border bg-nomi-paper shadow-nomi-lg',
              (splitDocked || edgeDocked) && 'shadow-none',
              splitDocked && 'border-0',
              dropActive
                ? 'border-nomi-accent ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper'
                : 'border-nomi-line',
            )}
          >
            <div
              className={cn(
                'flex min-h-12 shrink-0 select-none items-center gap-2.5 border-b border-nomi-line-soft px-4',
                dockMode ? 'cursor-default' : isWindowInteracting ? 'cursor-grabbing' : 'cursor-grab',
                compactToolbar && 'min-h-11 px-3.5',
              )}
              onPointerDown={handleHeaderPointerDown}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="truncate text-body-sm font-bold text-nomi-ink">素材盒</div>
                <span className="inline-flex h-5 shrink-0 items-center rounded-pill bg-nomi-ink-05 px-2 text-micro font-semibold text-nomi-ink-55">
                  捕捞收件箱
                </span>
              </div>
              {onBrowserCaptureToggle ? (
                <button type="button" className={cn(TOOL_BUTTON_CLASS, browserCaptureEnabled && 'bg-nomi-accent-soft text-nomi-accent hover:text-nomi-accent')} aria-label={browserCaptureEnabled ? '关闭资源捕捞' : '开启资源捕捞'} aria-pressed={browserCaptureEnabled} title={browserCaptureEnabled ? '关闭资源捕捞' : '资源捕捞：悬停资源后按 Ctrl+C 保存'} disabled={browserCaptureDisabled} onClick={onBrowserCaptureToggle}>
                  <IconZoomScan size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : null}
              <button type="button" className={cn(TOOL_BUTTON_CLASS, promptExtractionSettingsOpen && 'bg-nomi-ink-05 text-nomi-ink')} aria-label="提示词提取设置" title="提示词提取设置" aria-pressed={promptExtractionSettingsOpen} onClick={() => setPromptExtractionSettingsOpen(true)}>
                <IconAdjustmentsHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {canDock ? (
                <button type="button" className={TOOL_BUTTON_CLASS} aria-label={dockMode ? '恢复浮动素材盒' : '并排显示素材盒'} title={dockMode ? '恢复浮动' : '并排显示'} disabled={!activeBounds} onClick={toggleDockMode}>
                  {dockMode === 'left' ? (
                    <IconLayoutSidebarLeftExpand size={17} strokeWidth={1.8} aria-hidden="true" />
                  ) : dockMode === 'right' ? (
                    <IconLayoutSidebarRightExpand size={17} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <IconLayoutSidebarRightCollapse size={17} strokeWidth={1.8} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              <button type="button" className={TOOL_BUTTON_CLASS} aria-label="收起素材盒" title="收起素材盒" onClick={() => setPopoverOpen(false)}>
                <IconMinus size={17} stroke={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className={cn('relative grid shrink-0 items-center gap-2.5 border-b border-nomi-line-soft/60 bg-nomi-bg/45 px-4 py-3', compactToolbar ? 'grid-cols-1 px-3.5' : 'grid-cols-[minmax(0,1fr)_auto]')}>
              <DesignSearchInput value={query} onChange={setQuery} placeholder="搜索素材" ariaLabel="搜索素材" size="sm" className="min-w-0 w-full bg-nomi-paper" />
              <div className={cn('flex shrink-0 items-center gap-1 rounded-nomi bg-nomi-ink-05/70 p-0.5', compactToolbar && 'justify-self-end')}>
                <button type="button" className={cn(TOOL_BUTTON_CLASS, listMode && 'bg-nomi-ink-05 text-nomi-ink')} aria-label="切换素材布局" aria-pressed={listMode} onClick={() => setViewMode((value: string) => (value === 'grid' ? 'list' : 'grid'))}>
                  {listMode ? <IconLayoutGrid size={17} stroke={1.8} aria-hidden="true" /> : <IconList size={17} stroke={1.8} aria-hidden="true" />}
                </button>
                <button type="button" className={cn(TOOL_BUTTON_CLASS, !sortAscending && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={sortAscending ? '最早优先' : '最新优先'} title={sortAscending ? '最早优先' : '最新优先'} aria-pressed={!sortAscending} onClick={() => setSortAscending((value: boolean) => !value)}>
                  {sortAscending ? <IconSortAscending2 size={17} stroke={1.8} aria-hidden="true" /> : <IconSortDescending2 size={17} stroke={1.8} aria-hidden="true" />}
                </button>
                <div className="relative">
                  <button type="button" ref={filterButtonRef} className={cn(TOOL_BUTTON_CLASS, (filtersOpen || filterActive) && 'bg-nomi-ink-05 text-nomi-ink')} aria-label="筛选分类" aria-haspopup="dialog" aria-expanded={filtersOpen} aria-pressed={filterActive} onClick={() => setFiltersOpen((value: boolean) => !value)}>
                    <IconFilter size={17} stroke={1.8} aria-hidden="true" />
                  </button>
                  {filtersOpen ? (
                    <BrowserAssetFilterPopover activeTab={activeTab} counts={filterCounts} tabs={NOMI_BROWSER_ASSET_TABS} setNodeRef={(node) => { filterPopoverRef.current = node }} onSelectTab={selectFilterTab} onShowAll={showAllFilters} />
                  ) : null}
                </div>
              </div>
            </div>

            {/* 捕捞临时条：下载中/失败卡不混进 ready 素材网格（审计 P1）——失败给唯一下一步 [重试]/[移除] */}
            {(captureTransients?.length ?? 0) > 0 ? (
              <div className="mx-3 mt-2 grid gap-1.5" aria-label="捕捞进行中或失败">
                {captureTransients.map((asset: any) => (
                  <div
                    key={asset.id}
                    className={cn(
                      'flex min-w-0 items-center gap-2 rounded-nomi-sm border px-2.5 py-1.5',
                      asset.status === 'error' ? 'border-workbench-danger/30 bg-nomi-ink-05/60' : 'border-nomi-ink-10 bg-nomi-ink-05/60',
                    )}
                  >
                    <span className={cn('block h-1.5 w-1.5 shrink-0 rounded-pill', asset.status === 'error' ? 'bg-workbench-danger' : 'animate-pulse bg-nomi-accent')} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="block truncate text-caption font-medium text-nomi-ink-80">{asset.title}</span>
                      <span className={cn('block truncate text-micro', asset.status === 'error' ? 'text-workbench-danger' : 'text-nomi-ink-40')}>
                        {browserAssetDisplaySubtitle(asset)}
                      </span>
                    </span>
                    {asset.status === 'error' ? (
                      <>
                        <button type="button" className="shrink-0 rounded-nomi-sm px-1.5 py-0.5 text-micro font-semibold text-nomi-accent hover:bg-nomi-ink-05" onClick={() => retryCaptureImport?.(asset.id)}>重试</button>
                        <button type="button" className="shrink-0 rounded-nomi-sm px-1.5 py-0.5 text-micro text-nomi-ink-40 hover:bg-nomi-ink-05" onClick={() => dismissCaptureTransient?.(asset.id)}>移除</button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <ScrollArea className="min-h-0 flex-1" viewportRef={gridRef} type="hover" scrollbars="y" scrollbarSize={6} offsetScrollbars="y" scrollHideDelay={500} overscrollBehavior="contain" classNames={{ viewport: 'relative', scrollbar: 'rounded-pill bg-transparent p-0.5', thumb: 'rounded-pill bg-nomi-ink-20 hover:bg-nomi-ink-30' }} viewportProps={{ onPointerDown: handleGridPointerDown, onPointerMove: handleGridPointerMove, onPointerUp: handleGridPointerUp, onPointerCancel: handleGridPointerUp }}>
              <div className={cn('px-4 pb-5 pt-4', compactToolbar && 'px-4 pt-4')}>
                {filteredAssets.length === 0 ? (
                  <DesignEmptyState density="inline" icon={<IconCards size={32} stroke={1.45} className="text-nomi-ink-30" aria-hidden="true" />} title={emptyStateCopy.title} description={emptyStateCopy.description} className="min-h-[220px] rounded-nomi bg-nomi-ink-05/40" />
                ) : (
                  <div className={cn('w-full select-none', listMode ? 'grid gap-1.5' : 'grid auto-rows-max content-start gap-x-3 gap-y-4')} style={assetGridStyle} aria-label={listMode ? '素材列表' : '素材网格'}>
                    {filteredAssets.map((asset: any) => (
                      <BrowserAssetTile key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} compact={gridCompact} viewMode={viewMode} setNodeRef={(node) => setAssetNode(asset.id, node)} onClick={(event) => selectAsset(asset, event)} onContextMenu={(event) => openAssetContextMenu(asset, event)} onDragStart={(event) => handleTileDragStart(asset, event)} />
                    ))}
                  </div>
                )}
              </div>

              {marquee ? <div className="pointer-events-none absolute z-[2] rounded-nomi-sm border border-nomi-accent bg-nomi-accent-soft/70" style={normalizeMarqueeRect(marquee)} aria-hidden="true" /> : null}
            </ScrollArea>
            {dropActive ? <div className="pointer-events-none absolute inset-2 z-[8] grid place-items-center rounded-nomi border border-dashed border-nomi-accent bg-nomi-accent-soft/75 text-caption font-semibold text-nomi-accent">松开以保存到素材盒</div> : null}
            {promptExtractionSettingsOpen ? <BrowserPromptExtractionSettingsModal settings={promptExtractionSettings} projectAvailable={promptExtractionSettingsProjectAvailable} onSave={savePromptExtractionSettings} onClose={() => setPromptExtractionSettingsOpen(false)} /> : null}
          </div>
          {(activeResizeEdges as readonly FloatingWindowResizeEdge[]).map((edge) => (
            <div key={edge} data-nomi-window-resize-handle="true" className={cn('absolute z-[7] touch-none', resizeHandleClass(edge, Boolean(edgeDocked)))} onPointerDown={(event) => startResize(edge, event)} aria-hidden="true" />
          ))}
          {assetContextMenu && selectedIds.size > 0 ? (
            <div ref={assetContextMenuRef} className="absolute z-[9] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" style={{ left: assetContextMenu.x, top: assetContextMenu.y, width: ASSET_CONTEXT_MENU_WIDTH }} role="menu" aria-label="素材操作" onContextMenu={(event) => event.preventDefault()} onMouseDown={(event) => event.stopPropagation()}>
              {canImportSelectedAssetsToCanvas ? (
                <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-nomi-ink-80 transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:bg-nomi-ink-05 focus-visible:outline-none')} role="menuitem" onClick={importSelectedAssetsToCanvas}>
                  <IconArrowForwardUp size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">导入画布</span>
                </button>
              ) : null}
              <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-workbench-danger transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-workbench-danger-soft focus-visible:bg-workbench-danger-soft focus-visible:outline-none')} role="menuitem" onClick={deleteSelectedAssets}>
                <IconTrash size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">删除</span>
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  )
}
