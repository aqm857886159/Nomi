/**
 * 提示词库面板。借鉴 infinite-canvas 的提示词库,但瘦身:库只管「靠封面挑起点 → 送上画布」,
 * AI 优化下沉到节点 composer(不在库内重复)。居中大画廊 + 遮罩;点卡片 FLIP 放大浮到中央预览。
 * 双来源:Nomi 精选(外部公开仓库,主进程聚合+1h 缓存+打包快照兜底,只读)/ 我的库(用户级·跨项目,手写可改可删)。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconX, IconBulb, IconRefresh, IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiLoadingMark, NomiWordmark, DesignEmptyState, TooltipProvider } from '../../design'
import { showUndoToast } from '../../utils/showUndoToast'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { filterPrompts, promptSourceOptions, PROMPT_SOURCE_ALL, type LibraryPrompt, type PromptCategory } from '../api/promptLibraryApi'
import { usePromptLibrary } from './usePromptLibrary'
import { useUserPrompts } from './useUserPrompts'
import { PromptCard } from './PromptCard'
import { UserPromptCard } from './UserPromptCard'
import { UserPromptComposer } from './UserPromptComposer'
import { PromptPreviewOverlay } from './PromptPreviewOverlay'
import { promptDisplayTitle } from './promptDisplay'
import { markLibraryUsed, sortByLibraryUsage, useLibraryUsageVersion } from '../library/libraryDiscovery'
import { LibraryDiscoveryToolbar } from '../library/LibraryDiscoveryToolbar'

const GRID_GAP = 12 // gap-3
const MIN_CARD_WIDTH = 200 // 卡片最小宽,据此推列数(窄窗自动减列,不再写死 4 列挤压)
const COMPACT_CARD_WIDTH = 180
const CARD_ASPECT = 3 / 4 // PromptCard 为 aspect-[4/3]，行高由实际卡宽推出，不再写死 188

type Source = 'nomi' | 'mine'

const SOURCE_OPTIONS: { value: Source; labelKey: 'libraries.prompt.source.mine' | 'libraries.prompt.source.nomi' }[] = [
  { value: 'mine', labelKey: 'libraries.prompt.source.mine' },
  { value: 'nomi', labelKey: 'libraries.prompt.source.nomi' },
]

const CATEGORY_OPTIONS: { value: PromptCategory; labelKey: 'libraries.prompt.category.all' | 'libraries.prompt.category.image' | 'libraries.prompt.category.video' }[] = [
  { value: 'all', labelKey: 'libraries.prompt.category.all' },
  { value: 'image', labelKey: 'libraries.prompt.category.image' },
  { value: 'video', labelKey: 'libraries.prompt.category.video' },
]

type PromptLibraryContentProps = {
  active: boolean
  compact?: boolean
  showHeader?: boolean
  onClose?: () => void
  className?: string
}

type Selected = { prompt: LibraryPrompt; rect: DOMRect }

export function PromptLibraryContent({
  active,
  compact = false,
  showHeader = true,
  onClose,
  className,
}: PromptLibraryContentProps): JSX.Element {
  const { t } = useTranslation()
  const [source, setSource] = React.useState<Source>('nomi')
  const [category, setCategory] = React.useState<PromptCategory>('all')
  // 精选条目按「来源」分类导航（GPT Image 2 / Sora 2…）——治「一大片无分类难找」。默认「全部来源」。
  const [sourceFilter, setSourceFilter] = React.useState<string>(PROMPT_SOURCE_ALL)
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Selected | null>(null)
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [editing, setEditing] = React.useState<LibraryPrompt | null>(null)
  const usageVersion = useLibraryUsageVersion()

  const { items, loading, error, reload } = usePromptLibrary(active)
  const user = useUserPrompts(active)
  const isMine = source === 'mine'
  const activeItems = React.useMemo(
    () => {
      // See ProjectLibraryPage: usageVersion invalidates recency after a use.
      void usageVersion
      return sortByLibraryUsage(
        isMine ? user.items : items,
        'prompt',
        (prompt) => prompt.id,
        (prompt) => prompt.updatedAt ? Date.parse(prompt.updatedAt) : undefined,
      )
    },
    [isMine, items, user.items, usageVersion],
  )
  // 来源分类只对精选列表有意义（我的库来源统一为「我的」）；按当前类型筛选后的集合派生来源项，
  // 这样切「视频」时来源行只列出真有视频的来源，不出空类。
  const sourceOptions = React.useMemo(
    () => (isMine ? [] : promptSourceOptions(activeItems.filter((p) => category === 'all' || p.promptType === category))),
    [isMine, activeItems, category],
  )
  // 当前来源筛选若因切类型/切来源不再存在，回落到「全部来源」，避免筛出空列表还高亮着不存在的项。
  React.useEffect(() => {
    if (sourceFilter !== PROMPT_SOURCE_ALL && !sourceOptions.includes(sourceFilter)) setSourceFilter(PROMPT_SOURCE_ALL)
  }, [sourceOptions, sourceFilter])
  const effectiveSource = isMine ? PROMPT_SOURCE_ALL : sourceFilter
  const visible = React.useMemo(
    () => filterPrompts(activeItems, category, query, effectiveSource),
    [activeItems, category, query, effectiveSource],
  )

  // 响应式列数 + 由实际卡宽推出的行高（替代写死的 grid-cols-4 / 188），窄窗也不挤压、滚动不跳。
  const [contentWidth, setContentWidth] = React.useState(0)
  React.useEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setContentWidth(w)
    })
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl])

  const width = contentWidth || (compact ? 416 : 920) // 测量前的合理回退（库侧栏 / 960 面板）
  const minCardWidth = compact ? COMPACT_CARD_WIDTH : MIN_CARD_WIDTH
  const minCols = compact ? 1 : 2
  const maxCols = compact ? 2 : 5
  const cols = Math.max(minCols, Math.min(maxCols, Math.floor((width + GRID_GAP) / (minCardWidth + GRID_GAP))))
  const cardWidth = (width - (cols - 1) * GRID_GAP) / cols
  const rowHeight = cardWidth * CARD_ASPECT + GRID_GAP

  const rowCount = Math.ceil(visible.length / cols)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    overscan: 3,
  })

  // 列数/行高变化（窗口缩放）后重新测量，避免虚拟化用旧行高错位。
  React.useEffect(() => {
    rowVirtualizer.measure()
  }, [rowVirtualizer, rowHeight, cols])

  React.useEffect(() => {
    if (!active || !onClose) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onClose, selected])

  // 切来源时收起编辑/新建态(避免在 Nomi 精选上下文里残留我的库表单)，并重置来源分类筛选。
  const switchSource = React.useCallback((next: Source) => {
    setSource(next)
    setSourceFilter(PROMPT_SOURCE_ALL)
    if (next !== 'mine') { setComposing(false); setEditing(null) }
  }, [])

  const handleSelect = React.useCallback((prompt: LibraryPrompt, rect: DOMRect) => {
    setSelected({ prompt, rect })
  }, [])

  // 送上画布:按提示词类型建图/视频节点(都落分镜),prompt 直接灌入;撤销 toast 可删。
  const handleSendToCanvas = React.useCallback((prompt: LibraryPrompt) => {
    const store = useGenerationCanvasStore.getState()
    const node = store.addNode({
      kind: prompt.promptType === 'video' ? 'video' : 'image',
      prompt: prompt.prompt,
      select: true,
    })
    showUndoToast({
      message: t('libraries.prompt.sentToCanvas', { kind: prompt.promptType === 'video' ? t('libraries.prompt.category.video') : t('libraries.prompt.storyboard') }),
      onUndo: () => useGenerationCanvasStore.getState().deleteNode(node.id),
    })
    markLibraryUsed('prompt', prompt.id)
  }, [t])

  const handleNew = React.useCallback(() => { setEditing(null); setComposing(true) }, [])
  const handleEdit = React.useCallback((prompt: LibraryPrompt) => { setComposing(false); setEditing(prompt) }, [])
  const handleDelete = React.useCallback((prompt: LibraryPrompt) => {
    void user.remove(prompt.id)
    showUndoToast({
      message: t('libraries.prompt.removedFromMine', { title: promptDisplayTitle(prompt) }),
      onUndo: () => void user.add({ title: prompt.title, prompt: prompt.prompt, promptType: prompt.promptType }),
    })
  }, [user, t])

  const showComposer = isMine && (composing || editing !== null)
  const showNewTile = isMine && !showComposer

  const sourceTabs = (
    <div
      className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5', compact ? 'w-full' : 'shrink-0')}
      role="tablist"
      aria-label={t('libraries.prompt.sourceAria')}
    >
      {SOURCE_OPTIONS.map((option) => {
        const activeOption = source === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activeOption}
            className={cn(
              'rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap',
              'transition-[background,color] duration-[var(--nomi-transition-fast)]',
              compact ? 'min-w-0 flex-1 px-2 py-1' : 'px-3 py-1',
              activeOption
                ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                : 'text-nomi-ink-60 hover:text-nomi-ink',
            )}
            onClick={() => switchSource(option.value)}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )

  const categoryTabs = (
    <div
      className={cn('inline-flex bg-nomi-ink-05 rounded-full p-0.5', compact ? 'w-full' : 'shrink-0')}
      role="tablist"
      aria-label={t('libraries.prompt.categoryAria')}
    >
      {CATEGORY_OPTIONS.map((option) => {
        const activeOption = category === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={activeOption}
            className={cn(
              'rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap',
              'transition-[background,color] duration-[var(--nomi-transition-fast)]',
              compact ? 'min-w-0 flex-1 px-2 py-1' : 'px-3 py-1',
              activeOption
                ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm'
                : 'text-nomi-ink-60 hover:text-nomi-ink',
            )}
            onClick={() => setCategory(option.value)}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )

  // 来源分类导航（仅精选、且来源多于一个时才显）：横向可滚动的 chip 行，「全部来源」+ 各真实来源名。
  const sourceChips = !isMine && sourceOptions.length > 1 ? (
    <div
      className={cn('flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', compact ? 'px-3 pb-2 -mt-0.5' : 'px-5 pb-2 -mt-1')}
      role="tablist"
      aria-label={t('libraries.prompt.sourceFilterAria')}
    >
      {[PROMPT_SOURCE_ALL, ...sourceOptions].map((value) => {
        const activeChip = sourceFilter === value
        const label = value === PROMPT_SOURCE_ALL ? t('libraries.prompt.allSources') : value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            // 非「全部来源」的 chip，其 label 就是远端来源名（表情预设 / Sora 官方…）：
            // 远端策展内容，不归 i18n 网管。「全部来源」走 t()，故不标、继续被抓。
            data-remote-content={value === PROMPT_SOURCE_ALL ? undefined : ''}
            aria-selected={activeChip}
            className={cn(
              'shrink-0 rounded-full text-caption cursor-pointer border px-2.5 py-0.5 whitespace-nowrap',
              'transition-[background,color,border-color] duration-[var(--nomi-transition-fast)]',
              activeChip
                ? 'bg-nomi-ink text-nomi-paper border-nomi-ink font-medium'
                : 'bg-transparent text-nomi-ink-60 border-nomi-line hover:text-nomi-ink hover:border-nomi-ink-20',
            )}
            onClick={() => setSourceFilter(value)}
          >
            {label}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={80}>
      <>
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
          {/* 头部 */}
          {showHeader ? (
            <div className={cn('flex items-center gap-2 px-5 pt-4 pb-3 border-b border-nomi-line')}>
              <IconBulb size={18} stroke={1.6} className={cn('text-nomi-accent')} />
              <b className={cn('text-title font-bold text-nomi-ink')}>{t('libraries.prompt.title')}</b>
              <NomiWordmark fontSize={13} className={cn('text-nomi-ink-40')} />
              <span className={cn('text-caption text-nomi-ink-40')}>· {activeItems.length}</span>
              <span className={cn('flex-1')} />
              {onClose ? (
                <button
                  type="button"
                  className={cn('w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent', 'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
                  aria-label={t('libraries.prompt.closeAria')}
                  onClick={onClose}
                >
                  <IconX size={16} stroke={2} />
                </button>
              ) : null}
            </div>
          ) : null}

          {/* 工具行 */}
          <LibraryDiscoveryToolbar
            className={compact ? 'px-3 py-3' : 'px-5 py-2.5'}
            compact={compact}
            query={query}
            onQueryChange={setQuery}
            placeholder={t('libraries.prompt.searchPlaceholder')}
            ariaLabel={t('libraries.prompt.searchAria')}
            leading={<>{sourceTabs}{categoryTabs}</>}
          />

          {/* 来源分类导航（精选）：治「一大片无分类难找」，按数据里的来源分类。 */}
          {sourceChips}

          {/* 网格 / 状态 */}
          <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-5 pb-5')}>
            {showComposer ? (
              <UserPromptComposer
                initial={editing}
                onSubmit={async (draft) => {
                  if (editing) await user.update(editing.id, draft)
                  else await user.add(draft)
                  setComposing(false)
                  setEditing(null)
                }}
                onCancel={() => { setComposing(false); setEditing(null) }}
              />
            ) : null}

            {isMine ? (
              <div className={cn('grid gap-3')} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {showNewTile ? (
                  <button
                    type="button"
                    onClick={handleNew}
                    className={cn('flex flex-col items-center justify-center gap-1.5 w-full aspect-[4/3] cursor-pointer', 'rounded-nomi border border-dashed border-nomi-line bg-transparent text-nomi-ink-40', 'hover:border-nomi-accent hover:text-nomi-accent transition-colors')}
                  >
                    <IconPlus size={22} stroke={1.6} />
                    <span className={cn('text-caption')}>{t('libraries.prompt.create')}</span>
                  </button>
                ) : null}
                {visible.map((prompt) => (
                  <UserPromptCard key={prompt.id} prompt={prompt} onSelect={handleSelect} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
                {!visible.length && !user.loading && (query || category !== 'all') ? (
                  <div className={cn('col-span-full py-10')}>
                    <DesignEmptyState title={t('libraries.prompt.noMatch')} description={t('libraries.prompt.tryAnotherFilter')} />
                  </div>
                ) : null}
              </div>
            ) : loading && !items.length ? (
              <div className={cn('flex flex-col items-center justify-center gap-3 py-20 text-nomi-ink-40')}>
                <NomiLoadingMark size={28} />
                <span className={cn('text-caption')}>{t('libraries.prompt.fetching')}</span>
              </div>
            ) : error && !items.length ? (
              <DesignEmptyState
                title={t('libraries.prompt.fetchFailed')}
                description={error}
                action={
                  <button type="button" onClick={reload} className={cn('inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer', 'border border-nomi-line bg-transparent text-nomi-ink-80 text-caption hover:bg-nomi-ink-05')}>
                    <IconRefresh size={14} stroke={1.8} />{t('common.retry')}
                  </button>
                }
              />
            ) : !visible.length ? (
              <DesignEmptyState title={t('libraries.prompt.noMatch')} description={t('libraries.prompt.tryAnotherFilter')} />
            ) : (
              <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const start = virtualRow.index * cols
                  const rowItems = visible.slice(start, start + cols)
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      className={cn('grid gap-3 pb-3')}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                    >
                      {rowItems.map((prompt) => (
                        <PromptCard key={prompt.id} prompt={prompt} onSelect={handleSelect} />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {selected ? (
          <PromptPreviewOverlay
            prompt={selected.prompt}
            originRect={selected.rect}
            onClose={() => setSelected(null)}
            onSendToCanvas={handleSendToCanvas}
          />
        ) : null}
      </>
    </TooltipProvider>
  )
}

// 注：这里原本还有一个 PromptLibraryPanel（960px 全屏 modal 壳）。它只监听 nomi-open-prompt-library，
// 全仓零 dispatch —— 永远打不开，用户从没见过（活的是侧栏用的 Content 版）。
// 2026-08-02 §1.5 清死码时删除，并焊了 src/customEventWiring.test.ts 防同类复发。
