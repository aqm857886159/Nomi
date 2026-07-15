import React from 'react'
import { IconCheck, IconFileText, IconFolder, IconPhoto, IconPlayerPlayFilled, IconPlus, IconVideo } from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { NomiBrowserAsset, NomiBrowserAssetTab, NomiBrowserAssetTabDefinition } from '../assets/browserAssetData'

type AssetTileProps = {
  asset: NomiBrowserAsset
  selected: boolean
  compact: boolean
  viewMode: 'grid' | 'list'
  /** 文件夹重命名态：标题原位变输入框（右键「重命名」或新建文件夹进入）。 */
  renaming?: boolean
  setNodeRef: (node: HTMLDivElement | null) => void
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onRenameCommit?: (title: string) => void
  onRenameCancel?: () => void
}

/** 原位重命名输入框：挂载即聚焦全选；Enter/失焦提交，Esc 取消（外层 Esc capture 优先，这里兜底）。 */
function TileRenameInput({
  initialTitle,
  className,
  onCommit,
  onCancel,
}: {
  initialTitle: string
  className?: string
  onCommit?: (title: string) => void
  onCancel?: () => void
}): JSX.Element {
  const [value, setValue] = React.useState(initialTitle)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const doneRef = React.useRef(false)
  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const finish = (commit: boolean): void => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) onCommit?.(value)
    else onCancel?.()
  }
  return (
    <input
      ref={inputRef}
      value={value}
      aria-label="重命名文件夹"
      className={cn(
        'w-full min-w-0 rounded-nomi-sm border border-nomi-accent bg-nomi-paper px-1 py-0.5',
        'text-caption font-medium leading-[1.2] text-nomi-ink outline-none',
        className,
      )}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
    />
  )
}

type FilterPopoverProps = {
  activeTab: NomiBrowserAssetTab
  counts: ReadonlyMap<NomiBrowserAssetTab, number>
  tabs: readonly NomiBrowserAssetTabDefinition[]
  setNodeRef: (node: HTMLDivElement | null) => void
  onSelectTab: (tab: NomiBrowserAssetTab) => void
  onShowAll: () => void
}

type PromptCategoryFilterPopoverProps = {
  activeCategoryId: string
  categories: readonly { id: string; label: string }[]
  counts: ReadonlyMap<string, number>
  setNodeRef: (node: HTMLDivElement | null) => void
  onSelectCategory: (categoryId: string) => void
  onAddCategory: (label: string) => void
  onShowAll: () => void
}

const FOLDER_SHAPE_PATH =
  'M4 9 Q4 6 7 6 H38 Q40 6 41 8 L44 16 Q45 18 47 18 H96 Q98 18 98 20 V52 Q98 55 95 55 H5 Q2 55 2 52 V12 Q2 9 4 9 Z'

function FolderShape({ selected }: { selected: boolean }): JSX.Element {
  return (
    <svg
      className="absolute inset-0 z-0 size-full overflow-hidden"
      viewBox="0 0 100 56"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {selected ? (
        <path
          d={FOLDER_SHAPE_PATH}
          style={{
            fill: 'color-mix(in oklch, var(--nomi-snap) 16%, var(--nomi-paper))',
            stroke: 'var(--nomi-snap)',
          }}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ) : (
        <>
          <path
            d={FOLDER_SHAPE_PATH}
            style={{ fill: '#2f2e2a', stroke: 'rgba(255,255,255,0.1)' }}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={FOLDER_SHAPE_PATH}
            className="opacity-0 transition-opacity duration-[var(--nomi-transition-fast)] group-hover:opacity-100"
            style={{ fill: '#3a3934', stroke: 'rgba(255,255,255,0.18)' }}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

function getAssetTypeLabel(asset: NomiBrowserAsset): string {
  if (asset.type === 'folder') return '文件夹'
  if (asset.type === 'image') return '图片'
  if (asset.type === 'video') return '视频'
  return '提示词'
}

function renderAssetFallbackIcon(asset: NomiBrowserAsset, size = 26): JSX.Element {
  if (asset.type === 'folder') return <IconFolder size={size} stroke={1.7} />
  if (asset.type === 'image') return <IconPhoto size={size} stroke={1.5} />
  if (asset.type === 'video') return <IconVideo size={size} stroke={1.5} />
  return <IconFileText size={size} stroke={1.5} />
}

function renderAssetPreview(asset: NomiBrowserAsset, className: string): JSX.Element | null {
  if (asset.previewUrl) {
    if (asset.type === 'video' || asset.previewMediaType === 'video') {
      return <video src={asset.previewUrl} muted playsInline preload="metadata" draggable={false} className={className} />
    }
    return <img src={asset.previewUrl} alt="" draggable={false} className={className} />
  }
  if (asset.preview) return <div className={className} style={{ background: asset.preview }} />
  return null
}

export const BrowserAssetTile = React.memo(function BrowserAssetTile({
  asset,
  selected,
  compact,
  viewMode,
  renaming = false,
  setNodeRef,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onRenameCommit,
  onRenameCancel,
}: AssetTileProps): JSX.Element {
  const hasVisualPreview = Boolean(asset.preview || asset.previewUrl)
  const isFolder = asset.type === 'folder'
  const folderHasPreview = isFolder && hasVisualPreview && (asset.count ?? 0) > 0
  const loading = asset.status === 'loading'
  const failed = asset.status === 'error'
  const isPromptCard = Boolean(asset.promptCard)
  const subtitle = loading
    ? isPromptCard
      ? '提取中...'
      : '下载中...'
    : failed
      ? isPromptCard
        ? '提取失败'
        : '下载失败'
      : asset.subtitle || getAssetTypeLabel(asset)
  const listMeta = isFolder ? '文件夹' : asset.duration || getAssetTypeLabel(asset)
  const isVideo = asset.type === 'video' || asset.previewMediaType === 'video'

  const commonProps = {
    ref: setNodeRef,
    role: 'button',
    tabIndex: 0,
    // 重命名时禁拖拽：否则输入框里选中文字的拖动会触发 tile 拖拽。
    draggable: !renaming,
    'data-browser-asset-tile': 'true',
    'data-asset-id': asset.id,
    'aria-label': asset.title,
    'aria-selected': selected,
    'aria-grabbed': selected,
    title: asset.subtitle ? `${asset.title} · ${asset.subtitle}` : asset.title,
    onClick,
    onDoubleClick,
    onContextMenu,
    onDragStart,
    onDragOver,
    onDrop,
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
            : 'border-transparent text-nomi-ink-70 hover:border-nomi-line-soft hover:bg-nomi-ink-05 focus-visible:border-nomi-accent focus-visible:bg-nomi-ink-05',
          failed && 'text-workbench-danger',
        )}
      >
        {selected ? (
          <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-pill bg-nomi-accent" />
        ) : null}
        <span
          className={cn(
            'relative grid size-8 place-items-center overflow-hidden rounded-nomi-sm border bg-nomi-ink-05 text-nomi-ink-45',
            selected ? 'border-nomi-accent-soft bg-nomi-paper text-nomi-accent' : 'border-nomi-line-soft',
            isFolder && !selected && 'bg-nomi-paper text-nomi-ink-50',
          )}
          aria-hidden="true"
        >
          {!isFolder && hasVisualPreview && !failed
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
          {renaming ? (
            <TileRenameInput initialTitle={asset.title} className="text-body-sm" onCommit={onRenameCommit} onCancel={onRenameCancel} />
          ) : (
            <span
              className={cn(
                'block truncate text-body-sm leading-[1.15]',
                selected ? 'font-semibold text-nomi-ink' : 'font-medium text-nomi-ink-80',
              )}
            >
              {asset.title}
            </span>
          )}
          <span className={cn('mt-0.5 block truncate text-micro leading-none', failed ? 'text-workbench-danger' : 'text-nomi-ink-40')}>
            {subtitle}
          </span>
        </span>
        {!isFolder || loading || failed ? (
          <span
            className={cn(
              'shrink-0 rounded-nomi-sm px-1.5 py-0.5 text-micro leading-none',
              selected
                ? 'bg-nomi-paper/80 text-nomi-accent'
                : 'bg-nomi-ink-05 text-nomi-ink-45 group-hover:bg-nomi-paper',
            )}
          >
            {loading ? '...' : failed ? '!' : listMeta}
          </span>
        ) : null}
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
        selected && !isFolder && 'bg-nomi-accent-soft/55 shadow-nomi-sm',
      )}
    >
      {isFolder ? (
        <div className="relative isolate aspect-video overflow-hidden rounded-nomi-sm">
          <FolderShape selected={selected} />
          {folderHasPreview ? (
            <div className="absolute bottom-[9%] left-[6%] right-[6%] top-[34%] z-[1] overflow-hidden rounded-nomi-sm bg-nomi-ink-05">
              {renderAssetPreview(asset, 'block size-full object-contain')}
            </div>
          ) : null}
        </div>
      ) : (
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
          {asset.preview && !asset.previewUrl && !loading ? (
            <div className="absolute inset-0" style={{ background: asset.preview }} />
          ) : null}
          {!hasVisualPreview ? (
            <div className="absolute inset-0 grid place-items-center text-nomi-ink-40">
              {renderAssetFallbackIcon(asset)}
            </div>
          ) : null}
          {loading ? (
            <div
              className="absolute inset-0 grid place-items-center bg-nomi-paper/70 text-nomi-ink-40 backdrop-blur-[1px]"
              aria-label={isPromptCard ? '提取中' : '下载中'}
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
              视频
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
      )}
      <div className={cn('min-w-0 px-0.5 pb-0.5 pt-2', compact && 'pt-1.5')}>
        {renaming ? (
          <TileRenameInput initialTitle={asset.title} onCommit={onRenameCommit} onCancel={onRenameCancel} />
        ) : (
          <div
            className={cn(
              'truncate text-caption leading-[1.2]',
              selected ? 'font-semibold text-nomi-ink' : 'font-medium text-nomi-ink-80',
            )}
          >
            {asset.title}
          </div>
        )}
        {!isFolder ? (
          <div className="mt-1 truncate text-micro leading-none text-nomi-ink-40">
            {subtitle}
          </div>
        ) : null}
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
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute right-0 top-[calc(100%+6px)] z-[5] w-[240px] overflow-hidden rounded-nomi border border-nomi-line',
        'bg-nomi-paper p-2 shadow-nomi-lg',
      )}
      role="dialog"
      aria-label="素材分类筛选"
    >
      <div className="mb-1 flex h-7 items-center justify-between px-1.5">
        <span className="text-micro font-semibold uppercase text-nomi-ink-40">显示</span>
        <button
          type="button"
          className={cn(
            'h-6 rounded-nomi-sm border-0 bg-transparent px-1.5 text-micro text-nomi-ink-60',
            'cursor-pointer hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}
          onClick={onShowAll}
        >
          显示全部
        </button>
      </div>
      <div className="grid gap-0.5" role="listbox" aria-label="素材分类">
        {tabs
          .filter((tab) => tab.key !== 'all' && tab.key !== 'prompt')
          .map((tab) => {
            const Icon = tab.icon
            const count = counts.get(tab.key) ?? 0
            const active = activeTab === tab.key
            const disabled = tab.key !== 'all' && !active && count === 0
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
                  <span className="min-w-0 truncate">{tab.label}</span>
                  <span
                    className={cn(
                      'justify-self-end rounded-nomi-sm px-1.5 py-0.5 text-micro leading-none tabular-nums',
                      active
                        ? 'bg-nomi-paper text-nomi-accent'
                        : disabled
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
})

export const BrowserPromptCategoryFilterPopover = React.memo(function BrowserPromptCategoryFilterPopover({
  activeCategoryId,
  categories,
  counts,
  setNodeRef,
  onSelectCategory,
  onAddCategory,
  onShowAll,
}: PromptCategoryFilterPopoverProps): JSX.Element {
  const [draft, setDraft] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!adding) return
    inputRef.current?.focus()
  }, [adding])

  const submit = React.useCallback((event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const label = draft.trim()
    if (!label) return
    onAddCategory(label)
    setDraft('')
    setAdding(false)
  }, [draft, onAddCategory])

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'absolute right-0 top-[calc(100%+6px)] z-[5] w-[252px] overflow-hidden rounded-nomi border border-nomi-line',
        'bg-nomi-paper p-2 shadow-nomi-lg',
      )}
      role="dialog"
      aria-label="提示词分类筛选"
    >
      <div className="mb-1 flex h-7 items-center justify-between px-1.5">
        <span className="text-micro font-semibold uppercase text-nomi-ink-40">提示词分类</span>
        <button
          type="button"
          className={cn(
            'h-6 rounded-nomi-sm border-0 bg-transparent px-1.5 text-micro text-nomi-ink-60',
            'cursor-pointer hover:bg-nomi-ink-05 hover:text-nomi-ink',
          )}
          onClick={onShowAll}
        >
          显示全部
        </button>
      </div>
      <div className="grid gap-0.5" role="listbox" aria-label="提示词分类">
        {categories.map((category) => {
          const count = counts.get(category.id) ?? 0
          const active = activeCategoryId === category.id
          const disabled = !active && count === 0
          return (
            <button
              key={category.id}
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
              onClick={() => onSelectCategory(category.id)}
            >
              <IconFileText size={15} stroke={1.8} aria-hidden="true" />
              <span className="min-w-0 truncate">{category.label}</span>
              <span
                className={cn(
                  'justify-self-end rounded-nomi-sm px-1.5 py-0.5 text-micro leading-none tabular-nums',
                  active
                    ? 'bg-nomi-paper text-nomi-accent'
                    : disabled
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
      {adding ? (
        <form className="mt-2 flex items-center gap-1 border-t border-nomi-line-soft pt-2" onSubmit={submit}>
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1 text-caption text-nomi-ink outline-none"
            value={draft}
            placeholder="输入分类名称"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              setDraft('')
              setAdding(false)
            }}
          />
          <button
            type="submit"
            className="grid size-7 place-items-center rounded-nomi-sm border-0 bg-nomi-ink-05 text-nomi-ink-60 hover:bg-nomi-accent-soft hover:text-nomi-accent"
            aria-label="确认添加提示词分类"
          >
            <IconPlus size={15} stroke={1.8} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <button
          type="button"
          className={cn(
            'mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-nomi-sm border border-dashed border-nomi-line-soft',
            'bg-transparent text-caption font-semibold text-nomi-ink-55 transition-colors duration-[var(--nomi-transition-fast)]',
            'hover:border-nomi-accent-soft hover:bg-nomi-accent-soft hover:text-nomi-accent',
          )}
          onClick={() => setAdding(true)}
        >
          <IconPlus size={15} stroke={1.8} aria-hidden="true" />
          <span>添加分类</span>
        </button>
      )}
    </div>
  )
})
