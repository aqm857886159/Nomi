import React from 'react'
import { useTranslation } from 'react-i18next'
import { Icon3dCubeSphere, IconCheck, IconEye, IconEyeOff, IconFolder, IconMusic, IconPhoto, IconPlayerPlayFilled, IconTrash } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../design'
import { AssetThumb } from './AssetTile'
import { AssetVideoCover } from './AssetVideoCover'
import { assetAspectRatio, type AssetKind, type AssetRef } from './assetTypes'
import { isAssetGridActivationKey, type AssetGridActivationEvent } from './assetLibraryUsage'
import { ASSET_KIND_FILTER_VALUES, FILTER_OPTIONS, type FilterValue } from './assetLibraryPanelFilters'

const KIND_LABEL_KEY: Record<AssetKind, string> = {
  image: 'assetLibrary.image',
  video: 'assetLibrary.video',
  audio: 'assetLibrary.audio',
  model3d: 'assetLibrary.model3d',
}

const KIND_ICON: Record<AssetKind, typeof IconPhoto> = {
  image: IconPhoto,
  video: IconPlayerPlayFilled,
  audio: IconMusic,
  model3d: Icon3dCubeSphere,
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
      {t(KIND_LABEL_KEY[kind])}
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
                'cursor-pointer text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                muted && 'text-nomi-ink-40',
                selected && 'bg-nomi-accent-soft font-semibold text-nomi-accent',
              )}
              style={{ gridTemplateColumns: '20px minmax(42px, 1fr) auto' }}
              onClick={kind === null ? onShowAll : () => onToggleKind(kind)}
            >
              <EyeIcon size={15} stroke={1.8} aria-hidden="true" />
              <span className="min-w-0 whitespace-nowrap">{t(option.labelKey)}</span>
              <span
                className={cn(
                  'min-w-7 justify-self-end rounded-nomi-sm px-1.5 py-0.5 text-center text-micro leading-none tabular-nums',
                  selected
                    ? 'bg-nomi-paper text-nomi-accent'
                    : muted
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
}

// 文件夹瓦片（素材面收敛 2026-07-22 转正）：排网格最前,点击进入;素材拖到瓦片上=归属进夹。
export function FolderGridCell({
  id,
  label,
  count,
  compact = false,
  manageable = true,
  onOpen,
  onDelete,
  onDropAssets,
}: {
  id: string
  label: string
  count: number
  compact?: boolean
  manageable?: boolean
  onOpen: (folderId: string) => void
  onDelete: (folderId: string) => void
  onDropAssets: (folderId: string, event: React.DragEvent<HTMLDivElement>) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [dragOver, setDragOver] = React.useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('assetLibrary.openFolder', { label })}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-nomi-sm border bg-nomi-paper',
        'cursor-pointer transition-[border-color,background,box-shadow] duration-[var(--nomi-transition-fast)]',
        compact ? 'mb-2.5 h-[92px] w-full' : 'aspect-square',
        dragOver ? 'border-nomi-accent bg-nomi-accent-soft shadow-nomi-md' : 'border-nomi-line hover:border-nomi-ink-20 hover:bg-nomi-ink-05',
      )}
      style={compact ? { breakInside: 'avoid' } : undefined}
      onClick={() => onOpen(id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(id)
      }}
      onDragOver={(event) => {
        if (!manageable) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        if (!manageable) return
        setDragOver(false)
        onDropAssets(id, event)
      }}
    >
      <IconFolder size={compact ? 22 : 26} stroke={1.6} className={cn(dragOver ? 'text-nomi-accent' : 'text-nomi-ink-40')} aria-hidden="true" />
      <span className="max-w-[90%] truncate text-caption text-nomi-ink">{label}</span>
      <span className="text-micro tabular-nums text-nomi-ink-40">{count}</span>
      {manageable ? <button
        type="button"
        className={cn(
          'absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-nomi-sm border-0 bg-transparent',
          'cursor-pointer text-transparent transition-colors duration-[var(--nomi-transition-fast)]',
          'hover:bg-workbench-danger-soft hover:text-workbench-danger group-hover:text-nomi-ink-40',
        )}
        aria-label={t('assetLibrary.deleteFolder', { label })}
        title={t('assetLibrary.deleteFolderHint')}
        onClick={(event) => {
          event.stopPropagation()
          onDelete(id)
        }}
      >
        <IconTrash size={13} stroke={2} aria-hidden="true" />
      </button> : null}
    </div>
  )
}

// 新建文件夹内联输入（Enter 建 / Esc 收）——Electron 无 window.prompt,就地小表单。
export function NewFolderInput({
  onCreate,
  onCancel,
}: {
  onCreate: (label: string) => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={t('assetLibrary.newFolderPlaceholder')}
      aria-label={t('assetLibrary.newFolderNameAria')}
      className={cn(
        'h-8 w-36 rounded-nomi-sm border border-nomi-accent bg-nomi-paper px-2 text-caption text-nomi-ink outline-none',
      )}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          const value = event.currentTarget.value.trim()
          if (value) onCreate(value)
          onCancel()
        }
        if (event.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
    />
  )
}

export const AssetGridCell = React.memo(function AssetGridCell({
  asset,
  compact = false,
  selected = false,
  selectable = false,
  draggable = true,
  dragHint: dragHintProp,
  onSelect,
  onDragStartAsset,
  onPreview,
  onDelete,
}: {
  asset: AssetRef
  compact?: boolean
  selected?: boolean
  selectable?: boolean
  draggable?: boolean
  dragHint?: string
  onSelect?: (asset: AssetRef, event: AssetGridActivationEvent) => void
  onDragStartAsset?: (asset: AssetRef, event: React.DragEvent<HTMLDivElement>) => void
  /** 双击放大预览（#52）；缺省则不响应双击。 */
  onPreview?: (asset: AssetRef) => void
  /** 结果级删除；只删这一张/这一段，不删除承载它的画布节点。 */
  onDelete?: (asset: AssetRef) => void
}): JSX.Element {
  const { t } = useTranslation()
  const canDrag = draggable && asset.kind !== 'model3d'
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canDrag || !onDragStartAsset) {
      event.preventDefault()
      return
    }
    onDragStartAsset(asset, event)
  }, [asset, canDrag, onDragStartAsset])
  const handleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    onSelect?.(asset, event)
  }, [asset, onSelect])
  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect || !isAssetGridActivationKey(event.key)) return
    event.preventDefault()
    onSelect(asset, {
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      detail: 1,
    })
  }, [asset, onSelect])
  const handleDoubleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
    onPreview?.(asset)
  }, [asset, onPreview])
  const dragHint = dragHintProp ?? (canDrag
    ? asset.kind === 'audio' ? t('assetLibrary.dragAudio') : t('assetLibrary.dragCanvas')
    : asset.kind === 'model3d' ? t('assetLibrary.previewModel3d') : t('assetLibrary.selectableProjectAsset'))
  const mediaAspectRatio = assetAspectRatio(asset)
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
  const deleteButton = onDelete ? (
    <button
      type="button"
      className={cn(
        'absolute right-1.5 top-1.5 z-[2] grid size-6 place-items-center rounded-nomi-sm border border-workbench-danger/20',
        'bg-nomi-paper text-workbench-danger shadow-nomi-sm opacity-0 transition-[opacity,background] duration-[var(--nomi-transition-fast)]',
        'hover:bg-workbench-danger-soft focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workbench-danger/25',
        'group-hover:opacity-100',
      )}
      aria-label={t('assetLibrary.deleteNamed', { name: asset.name })}
      title={t('assetLibrary.deleteProjectAsset')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onDelete(asset)
      }}
    >
      <IconTrash size={13} stroke={2} aria-hidden="true" />
    </button>
  ) : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {compact ? (
          <div
            draggable={canDrag}
            onClick={onSelect ? handleClick : undefined}
            onKeyDown={onSelect ? handleKeyDown : undefined}
            onDoubleClick={onPreview ? handleDoubleClick : undefined}
            onDragStart={handleDragStart}
            className={cn(
              'group relative mb-2.5 inline-block w-full overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper align-top',
              'shadow-nomi-sm transition-[border-color,box-shadow,transform] duration-[var(--nomi-transition-fast)]',
              'hover:border-nomi-ink-20 hover:shadow-nomi-md',
              canDrag ? 'cursor-grab active:cursor-grabbing' : onPreview || selectable ? 'cursor-pointer' : 'cursor-default',
              selected && 'border-nomi-accent shadow-nomi-md ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper',
            )}
            style={{ breakInside: 'avoid' }}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? asset.name : undefined}
            aria-selected={selectable ? selected : undefined}
          >
            <div
              className={cn(
                'relative overflow-hidden bg-nomi-ink-05',
                asset.kind === 'video' && !mediaAspectRatio && 'h-[96px] min-h-[86px]',
              )}
              style={mediaAspectRatio ? { aspectRatio: mediaAspectRatio } : undefined}
            >
              {asset.kind === 'image' ? (
                <NomiImage
                  className={cn('block w-full object-contain', mediaAspectRatio ? 'h-full' : 'h-auto')}
                  thumbnailSrc={asset.thumbUrl}
                  src={asset.renderUrl}
                  alt={asset.name}
                />
              ) : asset.kind === 'video' ? (
                <div className="relative h-full w-full">
                  <AssetVideoCover asset={asset} />
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
              {deleteButton}
            </div>
            <div className="min-w-0 truncate px-1.5 py-1 text-micro text-nomi-ink-60" title={asset.name}>
              {asset.name}
            </div>
          </div>
        ) : (
          <div
            draggable={canDrag}
            onClick={onSelect ? handleClick : undefined}
            onKeyDown={onSelect ? handleKeyDown : undefined}
            onDoubleClick={onPreview ? handleDoubleClick : undefined}
            onDragStart={handleDragStart}
            className={cn(
              'group relative flex aspect-square items-center justify-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-ink-05',
              canDrag ? 'cursor-grab active:cursor-grabbing' : onPreview || selectable ? 'cursor-pointer' : 'cursor-default',
              selected && 'border-nomi-accent ring-2 ring-nomi-accent ring-offset-1 ring-offset-nomi-paper',
            )}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={onSelect ? asset.name : undefined}
            aria-selected={selectable ? selected : undefined}
          >
            <AssetThumb asset={asset} />
            <AssetKindBadge kind={asset.kind} />
            {check}
            {deleteButton}
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
