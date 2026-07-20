import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { IconCheck, IconEye, IconEyeOff, IconMusic, IconPhoto, IconPlayerPlayFilled } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import { AssetThumb } from './AssetTile'
import type { AssetKind, AssetRef } from './assetTypes'
import { ASSET_KIND_FILTER_VALUES, FILTER_OPTIONS, type FilterValue } from './assetLibraryPanelFilters'

function kindLabel(kind: AssetKind, t: TFunction): string {
  if (kind === 'image') return t('assetLibrary.image')
  if (kind === 'video') return t('assetLibrary.video')
  return t('assetLibrary.audio')
}

const KIND_ICON: Record<AssetKind, typeof IconPhoto> = {
  image: IconPhoto,
  video: IconPlayerPlayFilled,
  audio: IconMusic,
}

function AssetKindBadge({ kind, compact = false }: { kind: AssetKind; compact?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const Icon = KIND_ICON[kind]
  return (
    <span
      className={cn(
        'absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full',
        'bg-nomi-ink text-nomi-paper shadow-nomi-sm',
        compact ? 'px-1.5 py-0.5 text-micro leading-none' : 'px-2 py-0.5 text-micro leading-none',
      )}
    >
      <Icon size={compact ? 10 : 11} stroke={1.8} aria-hidden="true" />
      {kindLabel(kind, t)}
    </span>
  )
}

export function AssetKindFilterMenu({
  selectedKinds,
  counts,
  setNodeRef,
  onToggleKind,
  onShowAll,
}: {
  selectedKinds: ReadonlySet<AssetKind>
  counts: ReadonlyMap<FilterValue, number>
  setNodeRef: (node: HTMLDivElement | null) => void
  onToggleKind: (kind: AssetKind) => void
  onShowAll: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const allSelected = ASSET_KIND_FILTER_VALUES.every((kind) => selectedKinds.has(kind))

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute right-0 top-[calc(100%+6px)] z-[5] rounded-nomi border border-nomi-line bg-nomi-paper',
        'p-2 shadow-nomi-lg',
      )}
      style={{ width: 176 }}
      role="dialog"
      aria-label={t('assetLibrary.kindFilter')}
    >
      <div className="grid gap-0.5" role="listbox" aria-label={t('assetLibrary.kinds')} aria-multiselectable="true">
        {FILTER_OPTIONS.map((option) => {
          const kind = option.value === 'all' ? null : option.value
          const count = counts.get(option.value) ?? 0
          const selected = kind === null ? allSelected : selectedKinds.has(kind)
          const EyeIcon = selected ? IconEye : IconEyeOff
          const muted = count === 0 && !selected
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={selected}
              className={cn(
                'grid h-8 items-center gap-2 rounded-nomi-sm border-0 px-1.5',
                'bg-transparent text-left text-caption transition-colors duration-[var(--nomi-transition-fast)]',
                'cursor-pointer text-nomi-ink-65 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                muted && 'text-nomi-ink-35',
                selected && 'bg-nomi-accent-soft font-semibold text-nomi-accent',
              )}
              style={{ gridTemplateColumns: '20px minmax(42px, 1fr) auto' }}
              onClick={kind === null ? onShowAll : () => onToggleKind(kind)}
            >
              <EyeIcon size={15} stroke={1.8} aria-hidden="true" />
              <span className="min-w-0 whitespace-nowrap">
                {option.value === 'all' ? t('assetLibrary.all') : kindLabel(option.value, t)}
              </span>
              <span
                className={cn(
                  'min-w-7 justify-self-end rounded-nomi-sm px-1.5 py-0.5 text-center text-micro leading-none tabular-nums',
                  selected
                    ? 'bg-nomi-paper text-nomi-accent'
                    : muted
                      ? 'text-nomi-ink-30'
                      : 'bg-nomi-ink-05 text-nomi-ink-45',
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
}

export const AssetGridCell = React.memo(function AssetGridCell({
  asset,
  compact = false,
  selected = false,
  selectable = false,
  draggable = true,
  onSelect,
  onDragStartAsset,
}: {
  asset: AssetRef
  compact?: boolean
  selected?: boolean
  selectable?: boolean
  draggable?: boolean
  onSelect?: (asset: AssetRef, event: React.MouseEvent<HTMLDivElement>) => void
  onDragStartAsset?: (asset: AssetRef, event: React.DragEvent<HTMLDivElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!draggable || !onDragStartAsset) {
      event.preventDefault()
      return
    }
    onDragStartAsset(asset, event)
  }, [asset, draggable, onDragStartAsset])
  const handleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    onSelect?.(asset, event)
  }, [asset, onSelect])
  const dragHint = draggable
    ? asset.kind === 'audio' ? t('assetLibrary.dragAudio') : t('assetLibrary.dragCanvas')
    : t('assetLibrary.selectableProjectAsset')
  const check = selectable ? (
    <span
      className={cn(
        'absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-pill border shadow-nomi-sm',
        selected
          ? 'border-nomi-accent bg-nomi-accent text-nomi-paper'
          : 'border-nomi-line bg-nomi-paper/85 text-transparent group-hover:text-nomi-ink-40',
      )}
      aria-hidden="true"
    >
      <IconCheck size={12} stroke={2.4} />
    </span>
  ) : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {compact ? (
          <div
            draggable={draggable}
            onClick={selectable ? handleClick : undefined}
            onDragStart={handleDragStart}
            className={cn(
              'group relative mb-2.5 inline-block w-full overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper align-top',
              'shadow-nomi-sm transition-[border-color,box-shadow,transform] duration-[var(--nomi-transition-fast)]',
              'hover:border-nomi-ink-20 hover:shadow-nomi-md',
              draggable ? 'cursor-grab active:cursor-grabbing' : selectable ? 'cursor-pointer' : 'cursor-default',
              selected && 'border-nomi-accent shadow-nomi-md ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper',
            )}
            style={{ breakInside: 'avoid' }}
            aria-selected={selected}
          >
            <div className="relative overflow-hidden bg-nomi-ink-05">
              {asset.kind === 'image' ? (
                <NomiImage className="block h-auto w-full object-contain" thumbnailSrc={asset.thumbUrl} src={asset.renderUrl} alt={asset.name} />
              ) : asset.kind === 'video' ? (
                <div className="relative min-h-[86px]">
                  {asset.thumbUrl ? (
                    <NomiImage className="block h-auto min-h-[86px] w-full object-cover" src={asset.thumbUrl} alt={asset.name} />
                  ) : (
                    <div className="h-[96px] bg-nomi-ink-05" />
                  )}
                  <span className="absolute inset-0 bg-[oklch(0.2_0.01_80/0.22)]" aria-hidden />
                  <span className="absolute inset-0 grid place-items-center text-nomi-paper drop-shadow-[0_1px_2px_oklch(0_0_0/0.55)]" aria-hidden>
                    <IconPlayerPlayFilled size={22} />
                  </span>
                </div>
              ) : (
                <div className="flex h-[92px] items-center justify-center bg-nomi-ink-05">
                  <AssetThumb asset={asset} />
                </div>
              )}
              <AssetKindBadge kind={asset.kind} compact />
              {check}
            </div>
          </div>
        ) : (
          <div
            draggable={draggable}
            onClick={selectable ? handleClick : undefined}
            onDragStart={handleDragStart}
            className={cn(
              'group relative flex aspect-square items-center justify-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05',
              draggable ? 'cursor-grab active:cursor-grabbing' : selectable ? 'cursor-pointer' : 'cursor-default',
              selected && 'border-nomi-accent ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper',
            )}
            aria-selected={selected}
          >
            <AssetThumb asset={asset} />
            <AssetKindBadge kind={asset.kind} />
            {check}
            <span className="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-[oklch(0_0_0/0.6)] to-transparent px-1.5 pb-1 pt-2.5 text-micro text-nomi-paper">
              {asset.name}
            </span>
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-56 whitespace-normal leading-snug">
        {asset.name} · {dragHint}
      </TooltipContent>
    </Tooltip>
  )
})
