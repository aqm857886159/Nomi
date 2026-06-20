/**
 * 提示词库面板。借鉴 infinite-canvas 的提示词库,但瘦身:库只管「靠封面挑起点 → 送上画布」,
 * AI 优化下沉到节点 composer(不在库内重复)。居中大画廊 + 遮罩;点卡片 FLIP 放大浮到中央预览。
 * 数据由主进程聚合公开仓库(图/视频)+1h 缓存,渲染层取全量后本地过滤(usePromptLibrary)。
 */
import React from 'react'
import { Portal } from '@mantine/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconSearch, IconX, IconBulb, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiLoadingMark, NomiWordmark } from '../../design'
import { showUndoToast } from '../../utils/showUndoToast'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { filterPrompts, type LibraryPrompt, type PromptCategory } from '../api/promptLibraryApi'
import { usePromptLibrary } from './usePromptLibrary'
import { PromptCard } from './PromptCard'
import { PromptPreviewOverlay } from './PromptPreviewOverlay'

const GRID_COLS = 4
const ESTIMATED_ROW_HEIGHT = 188

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
  const [category, setCategory] = React.useState<PromptCategory>('all')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Selected | null>(null)
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)

  const { items, loading, error, reload } = usePromptLibrary(opened)
  const visible = React.useMemo(() => filterPrompts(items, category, query), [items, category, query])

  const rowCount = Math.ceil(visible.length / GRID_COLS)
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 3,
  })

  React.useEffect(() => {
    if (!opened) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [opened, onClose, selected])

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

  if (!opened) return null

  return (
    <Portal>
      <div
        className={cn('fixed inset-0 grid place-items-center p-6')}
        style={{ zIndex: 4000, background: 'oklch(0.2 0.01 80 / 0.34)', animation: 'nomi-fade 140ms cubic-bezier(.2,.7,.3,1)' }}
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
            <span className={cn('text-caption text-nomi-ink-40')}>· {items.length}</span>
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
            <div className={cn('flex-1 inline-flex items-center gap-1.5 h-[30px] px-2.5', 'border border-nomi-line rounded-full text-nomi-ink-40 focus-within:border-nomi-accent')}>
              <IconSearch size={13} stroke={1.8} />
              <input
                className={cn('flex-1 min-w-0 bg-transparent border-0 outline-none text-caption text-nomi-ink placeholder:text-nomi-ink-40')}
                type="text"
                value={query}
                placeholder="搜提示词…"
                aria-label="搜索提示词"
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </div>
          </div>

          {/* 网格 / 状态 */}
          <div ref={setScrollEl} className={cn('flex-1 overflow-y-auto px-5 pb-5')}>
            {loading && !items.length ? (
              <div className={cn('flex flex-col items-center justify-center gap-3 py-20 text-nomi-ink-40')}>
                <NomiLoadingMark size={28} />
                <span className={cn('text-caption')}>正在从公开库拉取提示词…</span>
              </div>
            ) : error && !items.length ? (
              <div className={cn('flex flex-col items-center justify-center gap-3 py-20 text-center')}>
                <div className={cn('text-body font-semibold text-nomi-ink')}>没拉到提示词</div>
                <div className={cn('text-caption text-nomi-ink-40 max-w-[320px]')}>{error}</div>
                <button type="button" onClick={reload} className={cn('inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full cursor-pointer', 'border border-nomi-line bg-transparent text-nomi-ink-80 text-caption hover:bg-nomi-ink-05')}>
                  <IconRefresh size={14} stroke={1.8} />重试
                </button>
              </div>
            ) : !visible.length ? (
              <div className={cn('flex flex-col items-center justify-center gap-2 py-20 text-center')}>
                <div className={cn('text-body font-semibold text-nomi-ink')}>没有匹配的提示词</div>
                <div className={cn('text-caption text-nomi-ink-40')}>换个筛选或搜索词试试。</div>
              </div>
            ) : (
              <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const start = virtualRow.index * GRID_COLS
                  const rowItems = visible.slice(start, start + GRID_COLS)
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      className={cn('grid grid-cols-4 gap-3 pb-3')}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
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
