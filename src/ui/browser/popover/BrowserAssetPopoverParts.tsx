import React from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../../i18n'
import { IconCheck, IconPhoto, IconPlayerPlayFilled, IconVideo } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { NomiBrowserAsset, NomiBrowserAssetTab, NomiBrowserAssetTabDefinition } from '../assets/browserAssetData'
import { browserAssetDisplaySubtitle, isBrowserAssetDraggable } from './browserAssetPopoverUtils'

type AssetTileProps = {
  asset: NomiBrowserAsset
  selected: boolean
  compact: boolean
  viewMode: 'grid' | 'list'
  setNodeRef: (node: HTMLDivElement | null) => void
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
}

type FilterPopoverProps = {
  activeTab: NomiBrowserAssetTab
  counts: ReadonlyMap<NomiBrowserAssetTab, number>
  tabs: readonly NomiBrowserAssetTabDefinition[]
  setNodeRef: (node: HTMLDivElement | null) => void
  onSelectTab: (tab: NomiBrowserAssetTab) => void
  onShowAll: () => void
}

function getAssetTypeLabel(asset: NomiBrowserAsset, t: typeof i18n.t = i18n.t): string {
  return asset.type === 'image' ? t('browserAssets.image') : t('browserAssets.video')
}

function renderAssetFallbackIcon(asset: NomiBrowserAsset, size = 26): JSX.Element {
  if (asset.type === 'video') return <IconVideo size={size} stroke={1.5} />
  return <IconPhoto size={size} stroke={1.5} />
}

function renderAssetPreview(asset: NomiBrowserAsset, className: string): JSX.Element | null {
  if (!asset.previewUrl) return null
  if (asset.type === 'video' || asset.previewMediaType === 'video') {
    return <video src={asset.previewUrl} muted playsInline preload="metadata" draggable={false} className={className} />
  }
  return <img src={asset.previewUrl} alt="" draggable={false} className={className} />
}

export const BrowserAssetTile = React.memo(function BrowserAssetTile({
  asset,
  selected,
  compact,
  viewMode,
  setNodeRef,
  onClick,
  onContextMenu,
  onDragStart,
}: AssetTileProps): JSX.Element {
  const { t } = useTranslation()
  const hasVisualPreview = Boolean(asset.previewUrl)
  const loading = asset.status === 'loading'
  const failed = asset.status === 'error'
  const subtitle = browserAssetDisplaySubtitle(asset)
  const listMeta = asset.duration || getAssetTypeLabel(asset, t)
  const isVideo = asset.type === 'video' || asset.previewMediaType === 'video'

  const commonProps = {
    ref: setNodeRef,
    role: 'button',
    tabIndex: 0,
    draggable: isBrowserAssetDraggable(asset),
    'data-browser-asset-tile': 'true',
    'data-asset-id': asset.id,
    'aria-label': asset.title,
    'aria-selected': selected,
    'aria-grabbed': selected,
    title: asset.subtitle ? `${asset.title} · ${asset.subtitle}` : asset.title,
    onClick,
    onContextMenu,
    onDragStart,
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.currentTarget.click()
      }
    },
  }

  if (viewMode === 'list') {
    return (
      <div
        {...commonProps}
        className={cn(
          'group relative flex h-11 min-w-0 items-center gap-2 rounded-nomi-sm border px-2 outline-none',
          'cursor-pointer select-none transition-[background,border-color,box-shadow,color] duration-[var(--nomi-transition-fast)]',
          selected
            ? 'border-nomi-accent-soft bg-nomi-accent-soft text-nomi-ink shadow-nomi-sm'
            : 'border-transparent text-nomi-ink-80 hover:border-nomi-line-soft hover:bg-nomi-ink-05 focus-visible:border-nomi-accent focus-visible:bg-nomi-ink-05',
          failed && 'text-workbench-danger',
        )}
      >
        {selected ? (
          <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-pill bg-nomi-accent" />
        ) : null}
        <span
          className={cn(
            'relative grid size-8 place-items-center overflow-hidden rounded-nomi-sm border bg-nomi-ink-05 text-nomi-ink-40',
            selected ? 'border-nomi-accent-soft bg-nomi-paper text-nomi-accent' : 'border-nomi-line-soft',
          )}
          aria-hidden="true"
        >
          {hasVisualPreview && !failed
            ? renderAssetPreview(asset, 'absolute inset-0 block size-full object-contain pointer-events-none')
            : renderAssetFallbackIcon(asset, 17)}
          {loading ? (
              <span className="absolute inset-0 grid place-items-center bg-nomi-paper/70">
              <span className="size-3.5 animate-spin rounded-pill border-2 border-nomi-ink-20 border-t-nomi-accent" />
            </span>
          ) : null}
          {selected ? (
            <span className="absolute right-0.5 top-0.5 grid size-3.5 place-items-center rounded-pill bg-nomi-accent text-nomi-paper">
              <IconCheck size={9} stroke={2.3} />
            </span>
          ) : null}
          {isVideo && !loading && !failed ? (
            <span className="absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded-pill bg-nomi-accent text-nomi-paper shadow-nomi-sm ring-1 ring-nomi-paper/80">
              <IconPlayerPlayFilled size={8} aria-hidden="true" />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-body-sm leading-[1.15]',
              selected ? 'font-semibold text-nomi-ink' : 'font-medium text-nomi-ink-80',
            )}
          >
            {asset.title}
          </span>
          <span className={cn('mt-0.5 block truncate text-micro leading-none', failed ? 'text-workbench-danger' : 'text-nomi-ink-40')}>
            {subtitle}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-nomi-sm px-1.5 py-0.5 text-micro leading-none',
            selected
              ? 'bg-nomi-paper/80 text-nomi-accent'
              : 'bg-nomi-ink-05 text-nomi-ink-40 group-hover:bg-nomi-paper',
          )}
        >
          {loading ? '...' : failed ? '!' : listMeta}
        </span>
      </div>
    )
  }

  return (
    <div
      {...commonProps}
      className={cn(
        'group relative isolate min-w-0 select-none rounded-nomi p-1 outline-none',
        'cursor-pointer transition-[background,box-shadow,transform] duration-[var(--nomi-transition-fast)]',
        'hover:bg-nomi-ink-05 focus-visible:bg-nomi-ink-05',
        selected && 'bg-nomi-accent-soft/55 shadow-nomi-sm',
      )}
    >
      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-nomi border bg-nomi-ink-05',
          selected
            ? 'border-nomi-accent ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper'
            : 'border-nomi-line group-hover:border-nomi-ink-20',
        )}
      >
        {asset.previewUrl
          ? renderAssetPreview(asset, 'absolute inset-0 block size-full object-contain')
          : null}
        {!hasVisualPreview ? (
          <div className="absolute inset-0 grid place-items-center text-nomi-ink-40">
            {renderAssetFallbackIcon(asset)}
          </div>
        ) : null}
        {loading ? (
          <div
            className="absolute inset-0 grid place-items-center bg-nomi-paper/70 text-nomi-ink-40 backdrop-blur-[1px]"
            aria-label={t('browserAssets.downloading')}
          >
            <span
              className="size-5 animate-spin rounded-pill border-2 border-nomi-ink-20 border-t-nomi-accent"
              aria-hidden="true"
            />
          </div>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 grid place-items-center bg-workbench-danger-soft text-workbench-danger">
            {asset.type === 'video' ? (
              <IconVideo size={26} stroke={1.6} aria-hidden="true" />
            ) : (
              <IconPhoto size={26} stroke={1.6} aria-hidden="true" />
            )}
          </div>
        ) : null}
        {isVideo ? (
          <span className="absolute inset-0 bg-[oklch(0.2_0.01_80/0.16)]" aria-hidden="true" />
        ) : null}
        {isVideo && !failed ? (
          <span className="absolute right-1 top-1 inline-flex h-4 items-center gap-0.5 rounded-pill bg-nomi-accent px-1 text-micro font-semibold leading-none text-nomi-paper shadow-nomi-sm ring-1 ring-nomi-paper/80">
            <IconPlayerPlayFilled size={9} aria-hidden="true" />
            {t('browserAssets.video')}
          </span>
        ) : null}
        {asset.duration ? (
          <span className="absolute bottom-1 right-1 rounded-nomi-sm bg-nomi-overlay-chip-strong px-1.5 py-0.5 text-micro leading-none text-nomi-paper">
            {asset.duration}
          </span>
        ) : null}
        {selected ? (
          <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-pill bg-nomi-accent text-nomi-paper shadow-nomi-sm">
            <IconCheck size={13} stroke={2.2} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className={cn('min-w-0 px-0.5 pb-0.5 pt-2', compact && 'pt-1.5')}>
        <div
          className={cn(
            'truncate text-caption leading-[1.2]',
            selected ? 'font-semibold text-nomi-ink' : 'font-medium text-nomi-ink-80',
          )}
        >
          {asset.title}
        </div>
        <div className="mt-1 truncate text-micro leading-none text-nomi-ink-40">
          {subtitle}
        </div>
      </div>
    </div>
  )
})

export const BrowserAssetFilterPopover = React.memo(function BrowserAssetFilterPopover({
  activeTab,
  counts,
  tabs,
  setNodeRef,
  onSelectTab,
  onShowAll,
}: FilterPopoverProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute right-0 top-[calc(100%+6px)] z-[5] w-[240px] overflow-hidden rounded-nomi border border-nomi-line',
        'bg-nomi-paper p-2 shadow-nomi-lg',
      )}
      role="dialog"
      aria-label={t('browserAssets.assetCategoryFilter')}
    >
      <div className="mb-1 flex h-7 items-center justify-between px-1.5">
        <span className="text-micro font-semibold uppercase text-nomi-ink-40">{t('browserAssets.show')}</span>
        <button
          type="button"
          className={cn(
            'h-6 rounded-nomi-sm border-0 bg-transparent px-1.5 text-micro text-nomi-ink-60',
            'cursor-pointer hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}
          onClick={onShowAll}
        >
          {t('browserAssets.showAll')}
        </button>
      </div>
      <div className="grid gap-0.5" role="listbox" aria-label={t('browserAssets.assetCategories')}>
        {tabs
          .filter((tab) => tab.key !== 'all')
          .map((tab) => {
            const Icon = tab.icon
            const count = counts.get(tab.key) ?? 0
            const active = activeTab === tab.key
            const disabled = !active && count === 0
            return (
              <button
                key={tab.key}
                type="button"
                role="option"
                aria-selected={active}
                disabled={disabled}
                className={cn(
                  'grid h-8 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-nomi-sm border-0 px-1.5',
                  'bg-transparent text-left text-caption transition-colors duration-[var(--nomi-transition-fast)]',
                  disabled
                    ? 'cursor-default text-nomi-ink-30'
                    : 'cursor-pointer text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                  active && 'bg-nomi-accent-soft font-semibold text-nomi-accent',
                )}
                onClick={() => onSelectTab(tab.key)}
                >
                  <Icon size={15} stroke={1.8} aria-hidden="true" />
                  <span className="min-w-0 truncate">{t(tab.labelKey)}</span>
                  <span
                    className={cn(
                      'justify-self-end rounded-nomi-sm px-1.5 py-0.5 text-micro leading-none tabular-nums',
                      active
                        ? 'bg-nomi-paper text-nomi-accent'
                        : disabled
                          ? 'text-nomi-ink-30'
                          : 'bg-nomi-ink-05 text-nomi-ink-40',
                    )}
                  >
                    {count}
                  </span>
              </button>
            )
          })}
      </div>
    </div>
  )
})
