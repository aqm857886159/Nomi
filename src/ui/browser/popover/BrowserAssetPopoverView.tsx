/* eslint-disable @typescript-eslint/no-explicit-any */
import { ScrollArea } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { IconLayoutSidebarLeftExpand, IconLayoutSidebarRightCollapse, IconLayoutSidebarRightExpand, IconZoomScan, IconAdjustmentsHorizontal } from '@tabler/icons-react'
import {
  IconArrowForwardUp,
  IconArrowLeft,
  IconCards,
  IconChevronRight,
  IconDotsVertical,
  IconFilter,
  IconFolderOpen,
  IconFolderPlus,
  IconLayoutGrid,
  IconList,
  IconMinus,
  IconPencil,
  IconSortAscending2,
  IconSortDescending2,
  IconTrash,
  IconUpload,
} from '../../../vendor/tablerIcons'
import { DesignEmptyState, DesignSearchInput } from '../../../design'
import { cn } from '../../../utils/cn'
import { BrowserAssetFilterPopover, BrowserAssetTile, BrowserPromptCategoryFilterPopover } from './BrowserAssetPopoverParts'
import { BrowserPromptAssetTile, BrowserPromptDetailModal } from '../prompt/BrowserPromptAssetCards'
import { BrowserPromptExtractionSettingsModal } from '../prompt/BrowserPromptExtractionSettingsModal'
import {
  ASSET_CONTEXT_MENU_WIDTH,
  BLANK_CONTEXT_MENU_WIDTH,
  RESIZE_HANDLE_CLASS,
  TOOL_BUTTON_CLASS,
  TOOL_BUTTON_COMPACT_CLASS,
} from './browserAssetPopoverConstants'
import { normalizeMarqueeRect } from './browserAssetPopoverUtils'
import type { FloatingWindowResizeEdge } from '../window/useResizableFloatingWindow'

type BrowserAssetPopoverViewProps = Record<string, any>

function resizeHandleClass(edge: FloatingWindowResizeEdge, edgeDocked: boolean): string {
  if (!edgeDocked) return RESIZE_HANDLE_CLASS[edge]
  if (edge === 'w') return 'left-0 top-0 h-full w-3 cursor-ew-resize'
  if (edge === 'e') return 'right-0 top-0 h-full w-3 cursor-ew-resize'
  return RESIZE_HANDLE_CLASS[edge]
}

export function BrowserAssetPopoverView(props: BrowserAssetPopoverViewProps): JSX.Element {
  const { t } = useTranslation()
  const {
    rootRef, className, contained, placement, surface, showTrigger, popoverOpen, setPopoverOpen, windowRect, hostOrigin, isWindowInteracting, dockMode, handleWindowDragEnter, handleWindowDragOver, handleWindowDragLeave, handleWindowDrop, splitDocked, edgeDocked, dropActive, handleHeaderPointerDown, compactToolbar, sourceTabs, activeSource, selectAssetSource, onBrowserCaptureToggle, toolbarButtonClass, browserCaptureEnabled, browserCaptureDisabled, promptExtractionSettingsOpen, setPromptExtractionSettingsOpen, canDock, activeBounds, toggleDockMode, query, setQuery, singleTileToolbar, sourceTabGridStyle,
    actionsButtonRef, actionsOpen, setActionsOpen, actionsPopoverRef, listMode, setViewMode, sortAscending, setSortAscending, filterButtonRef, filtersOpen, filterActive, setFiltersOpen, showingPromptLibrary, activePromptCategory, promptCategories, promptCategoryCounts, filterPopoverRef, selectPromptCategory, addPromptCategory, showAllFilters, activeTab, filterCounts, tabs, selectFilterTab, uploadInputRef, createFolder, handleUploadFiles, currentFolder, exitCurrentFolder, activeSourceLabel, openAssetRoot, folderBreadcrumbs, openFolder,
    gridRef, handleGridPointerDown, handleGridPointerMove, handleGridPointerUp, openBlankContextMenu, filteredAssets, emptyStateCopy, promptMasonryStyle, selectedIds, setAssetNode, selectAsset, openPromptDetail, openAssetContextMenu, handleTileDragStart, gridCompact, viewMode, handleTileDragOver, handleTileDrop, assetGridStyle, marquee, promptDetailAsset, setPromptDetailAssetId, promptExtractionSettings, promptExtractionSettingsProjectAvailable, savePromptExtractionSettings, activeResizeEdges, startResize, assetContextMenu, assetContextMenuRef, canImportSelectedAssetsToCanvas, importSelectedAssetsToCanvas, deleteSelectedAssets, blankContextMenu, blankContextMenuRef,
    renamingAssetId, canRenameSelectedFolder, beginRenameSelectedFolder, commitRenameFolder, cancelRenameFolder,
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
      {showTrigger ? (
        <button
          type="button"
          className={cn(
            'nomi-browser-asset-popover__floating inline-grid size-11 place-items-center rounded-pill border border-nomi-line',
            'cursor-pointer bg-nomi-ink text-nomi-paper shadow-nomi-md',
            'transition-[background,transform] duration-[var(--nomi-transition-fast)] hover:-translate-y-px hover:bg-nomi-accent',
          )}
          aria-label={t('browserAssets.openAssetBox')}
          aria-expanded={popoverOpen}
          onClick={() => setPopoverOpen(!popoverOpen)}
        >
          <IconCards size={20} stroke={1.8} aria-hidden="true" />
        </button>
      ) : null}

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
          aria-label={t('browserAssets.assetBox')}
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
              {compactToolbar ? (
                <div className="min-w-0 flex-1 truncate text-body-sm font-bold text-nomi-ink">{t('browserAssets.assetBox')}</div>
              ) : (
                <div className="flex min-w-0 shrink-0 items-center gap-3">
                  <div className="shrink-0 text-body-sm font-bold text-nomi-ink">{t('browserAssets.assetBox')}</div>
                  <div className="inline-flex min-w-0 items-center gap-0.5 rounded-nomi bg-nomi-ink-05 p-0.5" role="tablist" aria-label={t('browserAssets.assetSources')}>
                    {sourceTabs.map((source: any) => {
                      const active = activeSource === source.key
                      return (
                        <button key={source.key} type="button" role="tab" aria-selected={active} className={cn('h-8 rounded-nomi-sm border-0 bg-transparent px-3 text-caption font-semibold', 'cursor-pointer whitespace-nowrap transition-[background,color,box-shadow] duration-[var(--nomi-transition-fast)]', active ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink')} onClick={() => selectAssetSource(source.key)}>
                          {source.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <span className="ml-auto" aria-hidden="true" />
              {onBrowserCaptureToggle ? (
                <button type="button" className={cn(toolbarButtonClass, browserCaptureEnabled && 'bg-nomi-accent-soft text-nomi-accent hover:text-nomi-accent')} aria-label={browserCaptureEnabled ? t('browserAssets.disableCapture') : t('browserAssets.enableCapture')} aria-pressed={browserCaptureEnabled} title={browserCaptureEnabled ? t('browserAssets.disableCapture') : t('browserAssets.captureHint')} disabled={browserCaptureDisabled} onClick={onBrowserCaptureToggle}>
                  <IconZoomScan size={17} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : null}
              <button type="button" className={cn(toolbarButtonClass, promptExtractionSettingsOpen && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.promptExtractionSettings')} title={t('browserAssets.promptExtractionSettings')} aria-pressed={promptExtractionSettingsOpen} onClick={() => setPromptExtractionSettingsOpen(true)}>
                <IconAdjustmentsHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
              </button>
              {canDock ? (
                <button type="button" className={toolbarButtonClass} aria-label={dockMode ? t('browserAssets.restoreFloatingAssetBox') : t('browserAssets.showSideBySideAssetBox')} title={dockMode ? t('browserAssets.restoreFloating') : t('browserAssets.showSideBySide')} disabled={!activeBounds} onClick={toggleDockMode}>
                  {dockMode === 'left' ? (
                    <IconLayoutSidebarLeftExpand size={17} strokeWidth={1.8} aria-hidden="true" />
                  ) : dockMode === 'right' ? (
                    <IconLayoutSidebarRightExpand size={17} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <IconLayoutSidebarRightCollapse size={17} strokeWidth={1.8} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              <button type="button" className={toolbarButtonClass} aria-label={t('browserAssets.collapseAssetBox')} title={t('browserAssets.collapseAssetBox')} onClick={() => setPopoverOpen(false)}>
                <IconMinus size={17} stroke={1.8} aria-hidden="true" />
              </button>
            </div>

            <div className={cn('relative grid shrink-0 items-center gap-2.5 border-b border-nomi-line-soft/60 bg-nomi-bg/45 px-4 py-3', compactToolbar && 'grid-cols-1 gap-2.5 px-3.5 py-3', singleTileToolbar && 'gap-2', !compactToolbar && 'grid-cols-[minmax(0,1fr)_auto]')}>
              <DesignSearchInput value={query} onChange={setQuery} placeholder={t('browserAssets.searchAssets')} ariaLabel={t('browserAssets.searchAssets')} size="sm" className="min-w-0 w-full bg-nomi-paper" />
              <div className={cn('flex min-w-0 items-center gap-2', compactToolbar ? singleTileToolbar ? 'flex-col items-stretch gap-2' : 'flex-row justify-between' : 'justify-end')}>
                {compactToolbar ? (
                  <div className={cn('grid min-w-0 gap-0.5 rounded-nomi bg-nomi-ink-05 p-0.5', !singleTileToolbar && 'flex-1')} style={sourceTabGridStyle} role="tablist" aria-label={t('browserAssets.assetSources')}>
                    {sourceTabs.map((source: any) => {
                      const active = activeSource === source.key
                      return (
                        <button key={source.key} type="button" role="tab" aria-selected={active} className={cn('h-8 min-w-0 rounded-nomi-sm border-0 bg-transparent px-2.5 text-caption font-semibold', 'cursor-pointer truncate transition-[background,color,box-shadow] duration-[var(--nomi-transition-fast)]', active ? 'bg-nomi-paper text-nomi-ink shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink')} onClick={() => selectAssetSource(source.key)}>
                          {source.label}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                <div className={cn('flex shrink-0 items-center gap-1 rounded-nomi bg-nomi-ink-05/70 p-0.5', compactToolbar && (singleTileToolbar ? 'justify-end self-end' : 'self-auto'))}>
                  <button type="button" className={toolbarButtonClass} aria-label={t('browserAssets.uploadAssets')} onClick={() => uploadInputRef.current?.click()}>
                    <IconUpload size={17} stroke={1.8} aria-hidden="true" />
                  </button>
                  <button type="button" className={toolbarButtonClass} aria-label={t('browserAssets.newFolder')} onClick={createFolder}>
                    <IconFolderPlus size={17} stroke={1.8} aria-hidden="true" />
                  </button>
                  {compactToolbar ? (
                    <div className="relative">
                      <button type="button" ref={actionsButtonRef} className={cn(TOOL_BUTTON_COMPACT_CLASS, actionsOpen && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.moreTools')} aria-haspopup="dialog" aria-expanded={actionsOpen} onClick={() => setActionsOpen((value: boolean) => !value)}>
                        <IconDotsVertical size={17} stroke={1.8} aria-hidden="true" />
                      </button>
                      {actionsOpen ? (
                        <div ref={actionsPopoverRef} className="absolute right-0 top-[calc(100%+6px)] z-[6] flex items-center gap-1 rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" role="dialog" aria-label={t('browserAssets.moreTools')}>
                          <button type="button" className={cn(TOOL_BUTTON_COMPACT_CLASS, listMode && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.switchLayout')} aria-pressed={listMode} onClick={() => setViewMode((value: string) => (value === 'grid' ? 'list' : 'grid'))}>
                            {listMode ? <IconLayoutGrid size={17} stroke={1.8} aria-hidden="true" /> : <IconList size={17} stroke={1.8} aria-hidden="true" />}
                          </button>
                          <button type="button" className={cn(TOOL_BUTTON_COMPACT_CLASS, !sortAscending && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={sortAscending ? t('browserAssets.oldestFirst') : t('browserAssets.newestFirst')} title={sortAscending ? t('browserAssets.oldestFirst') : t('browserAssets.newestFirst')} aria-pressed={!sortAscending} onClick={() => setSortAscending((value: boolean) => !value)}>
                            {sortAscending ? <IconSortAscending2 size={17} stroke={1.8} aria-hidden="true" /> : <IconSortDescending2 size={17} stroke={1.8} aria-hidden="true" />}
                          </button>
                          <div className="relative">
                            <button type="button" ref={filterButtonRef} className={cn(TOOL_BUTTON_COMPACT_CLASS, (filtersOpen || filterActive) && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.filterCategories')} aria-haspopup="dialog" aria-expanded={filtersOpen} aria-pressed={filterActive} onClick={() => setFiltersOpen((value: boolean) => !value)}>
                              <IconFilter size={17} stroke={1.8} aria-hidden="true" />
                            </button>
                            {filtersOpen ? (
                              showingPromptLibrary ? (
                                <BrowserPromptCategoryFilterPopover activeCategoryId={activePromptCategory} categories={promptCategories} counts={promptCategoryCounts} setNodeRef={(node) => { filterPopoverRef.current = node }} onSelectCategory={selectPromptCategory} onAddCategory={addPromptCategory} onShowAll={showAllFilters} />
                              ) : (
                                <BrowserAssetFilterPopover activeTab={activeTab} counts={filterCounts} tabs={tabs} setNodeRef={(node) => { filterPopoverRef.current = node }} onSelectTab={selectFilterTab} onShowAll={showAllFilters} />
                              )
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <button type="button" className={cn(TOOL_BUTTON_CLASS, listMode && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.switchLayout')} aria-pressed={listMode} onClick={() => setViewMode((value: string) => (value === 'grid' ? 'list' : 'grid'))}>
                        {listMode ? <IconLayoutGrid size={17} stroke={1.8} aria-hidden="true" /> : <IconList size={17} stroke={1.8} aria-hidden="true" />}
                      </button>
                      <button type="button" className={cn(TOOL_BUTTON_CLASS, !sortAscending && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={sortAscending ? t('browserAssets.oldestFirst') : t('browserAssets.newestFirst')} title={sortAscending ? t('browserAssets.oldestFirst') : t('browserAssets.newestFirst')} aria-pressed={!sortAscending} onClick={() => setSortAscending((value: boolean) => !value)}>
                        {sortAscending ? <IconSortAscending2 size={17} stroke={1.8} aria-hidden="true" /> : <IconSortDescending2 size={17} stroke={1.8} aria-hidden="true" />}
                      </button>
                      <div className="relative">
                        <button type="button" ref={filterButtonRef} className={cn(TOOL_BUTTON_CLASS, (filtersOpen || filterActive) && 'bg-nomi-ink-05 text-nomi-ink')} aria-label={t('browserAssets.filterCategories')} aria-haspopup="dialog" aria-expanded={filtersOpen} aria-pressed={filterActive} onClick={() => setFiltersOpen((value: boolean) => !value)}>
                          <IconFilter size={17} stroke={1.8} aria-hidden="true" />
                        </button>
                        {filtersOpen ? (
                          showingPromptLibrary ? (
                            <BrowserPromptCategoryFilterPopover activeCategoryId={activePromptCategory} categories={promptCategories} counts={promptCategoryCounts} setNodeRef={(node) => { filterPopoverRef.current = node }} onSelectCategory={selectPromptCategory} onAddCategory={addPromptCategory} onShowAll={showAllFilters} />
                          ) : (
                            <BrowserAssetFilterPopover activeTab={activeTab} counts={filterCounts} tabs={tabs} setNodeRef={(node) => { filterPopoverRef.current = node }} onSelectTab={selectFilterTab} onShowAll={showAllFilters} />
                          )
                        ) : null}
                      </div>
                    </>
                  )}
                  <input ref={uploadInputRef} type="file" className="sr-only" multiple accept="image/*,video/*,.txt,.md" aria-label={t('browserAssets.chooseAssetFiles')} onChange={handleUploadFiles} />
                </div>
              </div>
            </div>

            {!showingPromptLibrary ? (
              <div className="flex min-h-9 shrink-0 items-center gap-2 bg-nomi-paper px-4 text-caption text-nomi-ink-60">
                {currentFolder ? (
                  <button type="button" className={cn(toolbarButtonClass, 'shrink-0')} aria-label={t('browserAssets.parentFolder')} onClick={exitCurrentFolder}>
                    <IconArrowLeft size={17} stroke={1.8} aria-hidden="true" />
                  </button>
                ) : null}
                <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" aria-label={t('browserAssets.folderPath')}>
                  <IconFolderOpen size={15} stroke={1.7} className="shrink-0 text-nomi-ink-40" aria-hidden="true" />
                  <ol className="flex min-w-0 flex-1 items-center overflow-hidden">
                    <li className={cn('flex min-w-0 items-center gap-1', currentFolder ? 'shrink-0' : 'flex-1')}>
                      {currentFolder ? (
                        <button type="button" className={cn('max-w-28 truncate rounded-nomi-sm border-0 bg-transparent px-1 py-0.5 text-caption', 'cursor-pointer font-semibold text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink')} title={activeSourceLabel} onClick={openAssetRoot}>
                          {activeSourceLabel}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate font-semibold text-nomi-ink-80" aria-current="page" title={activeSourceLabel}>{activeSourceLabel}</span>
                      )}
                    </li>
                    {folderBreadcrumbs.map((folder: any, index: number) => {
                      const current = index === folderBreadcrumbs.length - 1
                      return (
                        <li key={folder.id} className={cn('flex min-w-0 items-center gap-1', current ? 'flex-1' : 'shrink-0')}>
                          <IconChevronRight size={13} stroke={1.8} className="shrink-0 text-nomi-ink-30" aria-hidden="true" />
                          {current ? (
                            <span className="min-w-0 truncate font-semibold text-nomi-ink-80" aria-current="page" title={folder.title}>{folder.title}</span>
                          ) : (
                            <button type="button" className={cn('max-w-28 truncate rounded-nomi-sm border-0 bg-transparent px-1 py-0.5 text-caption', 'cursor-pointer font-semibold text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink')} title={folder.title} onClick={() => openFolder(folder)}>{folder.title}</button>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                </nav>
              </div>
            ) : null}

            <ScrollArea className="min-h-0 flex-1" viewportRef={gridRef} type="hover" scrollbars="y" scrollbarSize={6} offsetScrollbars="y" scrollHideDelay={500} overscrollBehavior="contain" classNames={{ viewport: 'relative', scrollbar: 'rounded-pill bg-transparent p-0.5', thumb: 'rounded-pill bg-nomi-ink-20 hover:bg-nomi-ink-30' }} viewportProps={{ onPointerDown: handleGridPointerDown, onPointerMove: handleGridPointerMove, onPointerUp: handleGridPointerUp, onPointerCancel: handleGridPointerUp, onContextMenu: openBlankContextMenu }}>
              <div className={cn('px-4 pb-5 pt-4', compactToolbar && 'px-4 pt-4')}>
                {filteredAssets.length === 0 ? (
                  <DesignEmptyState density="inline" icon={<IconCards size={32} stroke={1.45} className="text-nomi-ink-30" aria-hidden="true" />} title={emptyStateCopy.title} description={emptyStateCopy.description} className="min-h-[220px] rounded-nomi bg-nomi-ink-05/40" />
                ) : showingPromptLibrary ? (
                  <div className="w-full select-none" style={promptMasonryStyle} aria-label={t('browserAssets.promptWaterfall')}>
                    {filteredAssets.map((asset: any) =>
                      asset.promptCard ? (
                        <BrowserPromptAssetTile key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} setNodeRef={(node) => setAssetNode(asset.id, node)} onClick={(event) => selectAsset(asset, event)} onDoubleClick={(event) => { event.preventDefault(); openPromptDetail(asset) }} onContextMenu={(event) => openAssetContextMenu(asset, event)} onDragStart={(event) => handleTileDragStart(asset, event)} />
                      ) : (
                        <BrowserAssetTile key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} compact={gridCompact} viewMode={viewMode} renaming={renamingAssetId === asset.id} setNodeRef={(node) => setAssetNode(asset.id, node)} onClick={(event) => selectAsset(asset, event)} onDoubleClick={(event) => { event.preventDefault(); if (asset.type === 'folder') openFolder(asset) }} onContextMenu={(event) => openAssetContextMenu(asset, event)} onDragStart={(event) => handleTileDragStart(asset, event)} onDragOver={(event) => handleTileDragOver(asset, event)} onDrop={(event) => handleTileDrop(asset, event)} onRenameCommit={(title) => commitRenameFolder(asset.id, title)} onRenameCancel={cancelRenameFolder} />
                      ),
                    )}
                  </div>
                ) : (
                  <div className={cn('w-full select-none', listMode ? 'grid gap-1.5' : 'grid auto-rows-max content-start gap-x-3 gap-y-4')} style={assetGridStyle} aria-label={listMode ? t('browserAssets.assetList') : t('browserAssets.assetGrid')}>
                    {filteredAssets.map((asset: any) => (
                      <BrowserAssetTile key={asset.id} asset={asset} selected={selectedIds.has(asset.id)} compact={gridCompact} viewMode={viewMode} renaming={renamingAssetId === asset.id} setNodeRef={(node) => setAssetNode(asset.id, node)} onClick={(event) => selectAsset(asset, event)} onDoubleClick={(event) => { event.preventDefault(); if (asset.promptCard) openPromptDetail(asset); else if (asset.type === 'folder') openFolder(asset) }} onContextMenu={(event) => openAssetContextMenu(asset, event)} onDragStart={(event) => handleTileDragStart(asset, event)} onDragOver={(event) => handleTileDragOver(asset, event)} onDrop={(event) => handleTileDrop(asset, event)} onRenameCommit={(title) => commitRenameFolder(asset.id, title)} onRenameCancel={cancelRenameFolder} />
                    ))}
                  </div>
                )}
              </div>

              {marquee ? <div className="pointer-events-none absolute z-[2] rounded-nomi-sm border border-nomi-accent bg-nomi-accent-soft/70" style={normalizeMarqueeRect(marquee)} aria-hidden="true" /> : null}
            </ScrollArea>
            {dropActive ? <div className="pointer-events-none absolute inset-2 z-[8] grid place-items-center rounded-nomi border border-dashed border-nomi-accent bg-nomi-accent-soft/75 text-caption font-semibold text-nomi-accent">{t('browserAssets.dropToSave')}</div> : null}
            {promptDetailAsset ? <BrowserPromptDetailModal asset={promptDetailAsset} promptCategories={promptCategories} onClose={() => setPromptDetailAssetId(null)} /> : null}
            {promptExtractionSettingsOpen ? <BrowserPromptExtractionSettingsModal settings={promptExtractionSettings} projectAvailable={promptExtractionSettingsProjectAvailable} onSave={savePromptExtractionSettings} onClose={() => setPromptExtractionSettingsOpen(false)} /> : null}
          </div>
          {(activeResizeEdges as readonly FloatingWindowResizeEdge[]).map((edge) => (
            <div key={edge} data-nomi-window-resize-handle="true" className={cn('absolute z-[7] touch-none', resizeHandleClass(edge, Boolean(edgeDocked)))} onPointerDown={(event) => startResize(edge, event)} aria-hidden="true" />
          ))}
          {assetContextMenu && selectedIds.size > 0 ? (
            <div ref={assetContextMenuRef} className="absolute z-[9] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" style={{ left: assetContextMenu.x, top: assetContextMenu.y, width: ASSET_CONTEXT_MENU_WIDTH }} role="menu" aria-label={t('browserAssets.assetActions')} onContextMenu={(event) => event.preventDefault()} onMouseDown={(event) => event.stopPropagation()}>
              {canImportSelectedAssetsToCanvas ? (
                <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-nomi-ink-80 transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:bg-nomi-ink-05 focus-visible:outline-none')} role="menuitem" onClick={importSelectedAssetsToCanvas}>
                  <IconArrowForwardUp size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t('browserAssets.importToCanvas')}</span>
                </button>
              ) : null}
              {canRenameSelectedFolder ? (
                <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-nomi-ink-80 transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:bg-nomi-ink-05 focus-visible:outline-none')} role="menuitem" onClick={beginRenameSelectedFolder}>
                  <IconPencil size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t('browserAssets.rename')}</span>
                </button>
              ) : null}
              <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-workbench-danger transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-workbench-danger-soft focus-visible:bg-workbench-danger-soft focus-visible:outline-none')} role="menuitem" onClick={deleteSelectedAssets}>
                <IconTrash size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('browserAssets.delete')}</span>
              </button>
            </div>
          ) : null}
          {blankContextMenu ? (
            <div ref={blankContextMenuRef} className="absolute z-[9] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg" style={{ left: blankContextMenu.x, top: blankContextMenu.y, width: BLANK_CONTEXT_MENU_WIDTH }} role="menu" aria-label={t('browserAssets.blankAreaActions')} onContextMenu={(event) => event.preventDefault()} onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className={cn('flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left', 'cursor-pointer text-caption text-nomi-ink-80 transition-colors duration-[var(--nomi-transition-fast)]', 'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:bg-nomi-ink-05 focus-visible:outline-none')} role="menuitem" onClick={createFolder}>
                <IconFolderPlus size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('browserAssets.newFolder')}</span>
              </button>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  )
}
