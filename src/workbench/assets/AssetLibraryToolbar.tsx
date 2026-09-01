import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronLeft, IconFilter, IconFolderPlus, IconLink, IconPlus, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignSearchInput } from '../../design'
import { AssetKindFilterMenu, NewFolderInput } from './AssetLibraryPanelParts'
import type { FilterValue } from './assetLibraryPanelFilters'
import type { AssetKind } from './assetTypes'
import type { AssetLibrarySourceFilter } from './assetLibraryUsage'

type SourceOption = {
  value: AssetLibrarySourceFilter
  labelKey: string
}

export type AssetLibraryToolbarProps = {
  compact: boolean
  uploadInputRef: React.RefObject<HTMLInputElement | null>
  /** 贴分享链接导入（TikHub 解析无水印直链 → 落项目视频素材）。 */
  onPasteLink: () => void
  sourceOptions: readonly SourceOption[]
  sourceFilter: AssetLibrarySourceFilter
  onSourceFilterChange: (value: AssetLibrarySourceFilter) => void
  onResetSelection: () => void
  onResetKinds: () => void
  onCloseFilter: () => void
  onResetFolder: () => void
  onCloseNewFolder: () => void
  query: string
  onQueryChange: (value: string) => void
  projectSelectionEnabled: boolean
  selectedProjectAssetCount: number
  onDeleteSelected: () => void
  newFolderOpen: boolean
  onOpenNewFolder: () => void
  onCreateFolder: (label: string) => void
  filterButtonRef: React.MutableRefObject<HTMLButtonElement | null>
  filterMenuRef: React.MutableRefObject<HTMLDivElement | null>
  visibleKinds: ReadonlySet<AssetKind>
  filterCounts: ReadonlyMap<FilterValue, number>
  filterOpen: boolean
  filterActive: boolean
  activeFilterLabel: string
  onToggleFilter: () => void
  onToggleKind: (kind: AssetKind) => void
  onShowAllKinds: () => void
  folderViewActive: boolean
  activeFolder: { label: string } | null
  folderManagementEnabled: boolean
  scopedAssetCount: number
  onBackToAllAssets: () => void
  onDropToFolder: (folderId: string | null, event: React.DragEvent<HTMLElement>) => void
}

/**
 * 素材库工具行。它只负责筛选/搜索/文件夹入口的布局，状态仍由面板持有。
 * 抽出后保持每个消费场景共用同一套控制，不引入第二套资源行为。
 */
export function AssetLibraryToolbar({
  compact,
  uploadInputRef,
  onPasteLink,
  sourceOptions,
  sourceFilter,
  onSourceFilterChange,
  onResetSelection,
  onResetKinds,
  onCloseFilter,
  onResetFolder,
  onCloseNewFolder,
  query,
  onQueryChange,
  projectSelectionEnabled,
  selectedProjectAssetCount,
  onDeleteSelected,
  newFolderOpen,
  onOpenNewFolder,
  onCreateFolder,
  filterButtonRef,
  filterMenuRef,
  visibleKinds,
  filterCounts,
  filterOpen,
  filterActive,
  activeFilterLabel,
  onToggleFilter,
  onToggleKind,
  onShowAllKinds,
  folderViewActive,
  activeFolder,
  folderManagementEnabled,
  scopedAssetCount,
  onBackToAllAssets,
  onDropToFolder,
}: AssetLibraryToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const uploadButton = (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-full cursor-pointer',
        'bg-nomi-ink text-nomi-paper text-caption font-semibold border-0',
        'transition-[background] duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-80',
        compact ? 'h-[30px] px-2.5 shrink-0' : 'h-7 px-3',
      )}
      aria-label={t('assetLibrary.uploadAssets')}
      onClick={() => uploadInputRef.current?.click()}
    >
      <IconPlus size={compact ? 12 : 13} stroke={2} />
      {t('assetLibrary.upload')}
    </button>
  )

  const pasteLinkButton = (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-nomi-line bg-nomi-paper',
        'cursor-pointer text-nomi-ink-65 transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
        'hover:border-nomi-ink-20 hover:bg-nomi-ink-05 hover:text-nomi-ink',
        compact ? 'h-[30px] w-[30px]' : 'h-7 w-7',
      )}
      aria-label={t('assetLibrary.pasteLink.button')}
      title={t('assetLibrary.pasteLink.button')}
      onClick={onPasteLink}
    >
      <IconLink size={compact ? 14 : 15} stroke={1.8} aria-hidden="true" />
    </button>
  )

  const deleteSelectedButton = projectSelectionEnabled ? (
    <button
      type="button"
      className={cn(
        'inline-flex h-8 min-w-10 shrink-0 items-center justify-center gap-1.5 rounded-nomi-sm border text-caption font-semibold tabular-nums',
        'transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
        selectedProjectAssetCount > 0
          ? 'cursor-pointer border-workbench-danger/20 bg-workbench-danger-soft px-2 text-workbench-danger hover:bg-workbench-danger-soft/80'
          : 'cursor-default border-nomi-line bg-nomi-ink-05 px-2 text-nomi-ink-30',
      )}
      disabled={selectedProjectAssetCount === 0}
      aria-disabled={selectedProjectAssetCount === 0}
      aria-label={selectedProjectAssetCount > 0 ? t('assetLibrary.deleteSelection', { count: selectedProjectAssetCount }) : t('assetLibrary.deleteProjectAsset')}
      title={selectedProjectAssetCount > 0 ? t('assetLibrary.deleteSelection', { count: selectedProjectAssetCount }) : t('assetLibrary.selectProjectAssetFirst')}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onDeleteSelected}
    >
      <IconTrash size={15} stroke={2} aria-hidden="true" />
      <span>{selectedProjectAssetCount}</span>
    </button>
  ) : null

  const sourceTabs = (
    <div
      className={cn(
        'inline-flex bg-nomi-ink-05 rounded-full p-0.5',
        compact ? 'min-w-0 flex-1' : 'shrink-0',
      )}
      role="tablist"
      aria-label={t('assetLibrary.sourceFilter')}
    >
      {sourceOptions.map((option) => {
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
              onSourceFilterChange(option.value)
              onResetSelection()
              onResetKinds()
              onCloseFilter()
              onResetFolder()
              onCloseNewFolder()
            }}
          >
            {t(option.labelKey)}
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
        aria-label={t('assetLibrary.categoryFilter')}
        aria-haspopup="dialog"
        aria-expanded={filterOpen}
        aria-pressed={filterActive}
        title={t('assetLibrary.categoryTitle', { label: activeFilterLabel })}
        onClick={onToggleFilter}
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
          onToggleKind={onToggleKind}
          onShowAll={onShowAllKinds}
        />
      ) : null}
    </div>
  )

  return (
    <div className={cn('grid gap-2', compact ? 'px-3 py-3' : 'px-3 py-2.5')}>
      <div className={cn('flex min-w-0 items-center gap-2')}>
        {sourceTabs}
        {pasteLinkButton}
        {uploadButton}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <DesignSearchInput className="min-w-0 flex-1" placeholder={t('assetLibrary.search')} ariaLabel={t('assetLibrary.searchAria')} value={query} onChange={onQueryChange} />
        {deleteSelectedButton}
        {projectSelectionEnabled ? (
          newFolderOpen ? (
            <NewFolderInput onCreate={onCreateFolder} onCancel={onCloseNewFolder} />
          ) : (
            <button
              type="button"
              className={cn(
                'inline-flex h-8 shrink-0 items-center justify-center rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                'cursor-pointer text-nomi-ink-65 transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
                'hover:border-nomi-ink-20 hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              aria-label={t('assetLibrary.newFolder')}
              title={t('assetLibrary.newFolder')}
              onClick={onOpenNewFolder}
            >
              <IconFolderPlus size={15} stroke={1.8} aria-hidden="true" />
            </button>
          )
        ) : null}
        {categoryFilterButton}
      </div>
      {folderViewActive && activeFolder ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-nomi-sm border-0 bg-transparent px-1.5 py-1',
              'cursor-pointer text-caption text-nomi-accent transition-colors duration-[var(--nomi-transition-fast)] hover:bg-nomi-ink-05',
            )}
            aria-label={t('assetLibrary.backToAllAssets')}
            title={t(folderManagementEnabled ? 'assetLibrary.backDropToRemove' : 'assetLibrary.backToAllAssets')}
            onClick={onBackToAllAssets}
            onDragOver={folderManagementEnabled ? (event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            } : undefined}
            onDrop={folderManagementEnabled ? (event) => onDropToFolder(null, event) : undefined}
          >
            <IconChevronLeft size={14} stroke={2} aria-hidden="true" />
            {t('common.back')}
          </button>
          <span className="min-w-0 truncate text-caption text-nomi-ink-40">／ {activeFolder.label} · {scopedAssetCount}</span>
        </div>
      ) : null}
    </div>
  )
}
