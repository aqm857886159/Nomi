/**
 * 提示词库面板。借鉴 infinite-canvas 的提示词库,但瘦身:库只管「靠封面挑起点 → 送上画布」,
 * AI 优化下沉到节点 composer(不在库内重复)。居中大画廊 + 遮罩;点卡片 FLIP 放大浮到中央预览。
 * 双来源:Nomi 精选(外部公开仓库,主进程聚合+1h 缓存+打包快照兜底,只读)/ 我的库(用户级·跨项目,手写可改可删)。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconX, IconBulb, IconRefresh, IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiLoadingMark, NomiWordmark, DesignEmptyState, DesignSearchInput } from '../../design'
import { showUndoToast } from '../../utils/showUndoToast'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { filterPrompts, type LibraryPrompt, type PromptCategory } from '../api/promptLibraryApi'
import { usePromptLibrary } from './usePromptLibrary'
import { useUserPrompts } from './useUserPrompts'
import { PromptCard } from './PromptCard'
import { UserPromptCard } from './UserPromptCard'
import { UserPromptComposer } from './UserPromptComposer'
import { PromptPreviewOverlay } from './PromptPreviewOverlay'

const GRID_GAP = 12 // gap-3
const MIN_CARD_WIDTH = 200 // 卡片最小宽,据此推列数(窄窗自动减列,不再写死 4 列挤压)
const CARD_ASPECT = 3 / 4 // PromptCard 为 aspect-[4/3]，行高由实际卡宽推出，不再写死 188

type Source = 'nomi' | 'mine'

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'mine', label: '我的库' },
  { value: 'nomi', label: 'Nomi 精选' },
]

const CATEGORY_OPTIONS: { value: PromptCategory; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

type Props = {
  opened: boolean
  onClose: () => void
}

type Selected = { prompt: LibraryPrompt; rect: DOMRect }

export function PromptLibraryPanel({ opened, onClose }: Props): JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [source, setSource] = React.useState<Source>('nomi')
  const [category, setCategory] = React.useState<PromptCategory>('all')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Selected | null>(null)
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [editing, setEditing] = React.useState<LibraryPrompt | null>(null)

  const { items, loading, error, reload } = usePromptLibrary(opened)
  const user = useUserPrompts(opened)
  const isMine = source === 'mine'
  const activeItems = isMine ? user.items : items
  const visible = React.useMemo(() => filterPrompts(activeItems, category, query), [activeItems, category, query])

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

  const width = contentWidth || 920 // 测量前的合理回退（960 面板 - 左右内边距）
  const cols = Math.max(2, Math.min(5, Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))))
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
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose, selected])

  // 切来源时收起编辑/新建态(避免在 Nomi 精选上下文里残留我的库表单)。
  const switchSource = React.useCallback((next: Source) => {
    setSource(next)
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
      message: `已送上画布 · ${prompt.promptType === 'video' ? '视频' : '分镜'}节点`,
      onUndo: () => useGenerationCanvasStore.getState().deleteNode(node.id),
    })
  }, [])

  const handleNew = React.useCallback(() => { setEditing(null); setComposing(true) }, [])
  const handleEdit = React.useCallback((prompt: LibraryPrompt) => { setComposing(false); setEditing(prompt) }, [])
  const handleDelete = React.useCallback((prompt: LibraryPrompt) => {
    void user.remove(prompt.id)
    showUndoToast({
      message: `已从我的库删除 · ${prompt.title}`,
      onUndo: () => void user.add({ title: prompt.title, prompt: prompt.prompt, promptType: prompt.promptType }),
    })
  }, [user])

  if (!opened) return null

  const showComposer = isMine && (composing || editing !== null)
  const showNewTile = isMine && !showComposer

  return (
    <Portal>
      <div
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4000, background: 'var(--nomi-scrim)', animation: 'nomi-fade 140ms cubic-bezier(.2,.7,.3,1)' }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-label="提示词库"
          className={cn('w-[960px] max-w-full h-[86vh] flex flex-col overflow-hidden', 'bg-nomi-paper border border-nomi-line rounded-nomi-lg shadow-nomi-lg')}
          style={{ animation: 'nomi-panel-pop 160ms cubic-bezier(.2,.7,.3,1)' }}
        >
          {/* 头部 */}
          <div className={cn('flex items-center gap-2 px-5 pt-4 pb-3 border-b border-nomi-line')}>
            <IconBulb size={18} stroke={1.6} className={cn('text-nomi-accent')} />
            <b className={cn('text-title font-bold text-nomi-ink')}>提示词库</b>
            <NomiWordmark fontSize={13} className={cn('text-nomi-ink-40')} />
            <span className={cn('text-caption text-nomi-ink-40')}>· {activeItems.length}</span>
            <span className={cn('flex-1')} />
            <button
              type="button"
              className={cn('w-7 h-7 grid place-items-center rounded-nomi-sm cursor-pointer border-0 bg-transparent', 'text-nomi-ink-40 hover:text-nomi-ink hover:bg-nomi-ink-05')}
              aria-label="关闭提示词库"
              onClick={onClose}
            >
              <IconX size={16} stroke={2} />
            </button>
          </div>

          {/* 工具行 */}
          <div className={cn('flex items-center gap-2 px-5 py-2.5')}>
            <div className={cn('shrink-0 inline-flex bg-nomi-ink-05 rounded-full p-0.5')} role="tablist" aria-label="提示词来源">
              {SOURCE_OPTIONS.map((option) => {
                const active = source === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={cn('px-3 py-1 rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap', 'transition-[background,color] duration-[var(--nomi-transition-fast)]', active ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink')}
                    onClick={() => switchSource(option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div className={cn('shrink-0 inline-flex bg-nomi-ink-05 rounded-full p-0.5')} role="tablist" aria-label="提示词类型筛选">
              {CATEGORY_OPTIONS.map((option) => {
                const active = category === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={cn('px-3 py-1 rounded-full text-caption cursor-pointer border-0 bg-transparent whitespace-nowrap', 'transition-[background,color] duration-[var(--nomi-transition-fast)]', active ? 'bg-nomi-paper text-nomi-ink font-semibold shadow-nomi-sm' : 'text-nomi-ink-60 hover:text-nomi-ink')}
                    onClick={() => setCategory(option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <DesignSearchInput className="flex-1" placeholder="搜提示词…" ariaLabel="搜索提示词" value={query} onChange={setQuery} />
          </div>

          {/* 网格 / 状态 */}
          <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto px-5 pb-5')}>
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
                    <span className={cn('text-caption')}>新建</span>
                  </button>
                ) : null}
                {visible.map((prompt) => (
                  <UserPromptCard key={prompt.id} prompt={prompt} onSelect={handleSelect} onEdit={handleEdit} onDelete={handleDelete} />
                ))}
                {!visible.length && !user.loading && (query || category !== 'all') ? (
                  <div className={cn('col-span-full py-10')}>
                    <DesignEmptyState title="没有匹配的提示词" description="换个筛选或搜索词试试。" />
                  </div>
                ) : null}
              </div>
            ) : loading && !items.length ? (
              <div className={cn('flex flex-col items-center justify-center gap-3 py-20 text-nomi-ink-40')}>
                <NomiLoadingMark size={28} />
                <span className={cn('text-caption')}>正在从公开库拉取提示词…</span>
              </div>
            ) : error && !items.length ? (
              <DesignEmptyState
                title="没拉到提示词"
                description={error}
                action={
                  <button type="button" onClick={reload} className={cn('inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer', 'border border-nomi-line bg-transparent text-nomi-ink-80 text-caption hover:bg-nomi-ink-05')}>
                    <IconRefresh size={14} stroke={1.8} />重试
                  </button>
                }
              />
            ) : !visible.length ? (
              <DesignEmptyState title="没有匹配的提示词" description="换个筛选或搜索词试试。" />
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

        <style>{`
          @keyframes nomi-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes nomi-panel-pop { from { opacity: 0; transform: translateY(-6px) scale(0.99) } to { opacity: 1; transform: translateY(0) scale(1) } }
        `}</style>
      </div>

      {selected ? (
        <PromptPreviewOverlay
          prompt={selected.prompt}
          originRect={selected.rect}
          onClose={() => setSelected(null)}
          onSendToCanvas={handleSendToCanvas}
        />
      ) : null}
    </Portal>
  )
}
