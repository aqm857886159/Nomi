// 生成页「列表」视图：同一份镜头按镜号排好的大画面网格 + 侧滑检查器（拍板样张：设计画布板 E / F）。
// 数据一份：卡读画布 store 的节点（还没落画布的方案镜读分镜方案），投影只在 generationListModel.ts。
// 长列表按「分组头 / 一行卡 / 素材条」虚拟化（@tanstack/react-virtual，素材库同款），只挂视口里的那几行。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { openStoryboardPlanRow } from '../../creation/storyboard/openStoryboardPlanRow'
import { findGenerationListCard, type GenerationListCard, type GenerationListSection } from './generationListModel'
import { buildListRows, columnsFor, LEAD_INSET, useGenerationListModel, viewNodeInCanvas } from './generationListSource'
import { useGenerationViewStore } from './generationViewStore'
import {
  GenerationListAnchorStrip,
  GenerationListCardView,
  GenerationListEmpty,
  GenerationListSectionHeader,
  UnreferencedAssetStrip,
} from './GenerationListParts'
import { GenerationListInspector } from './GenerationListInspector'

function sectionTitleOf(t: (key: string, options?: Record<string, unknown>) => string, section: GenerationListSection | undefined): string {
  if (!section) return ''
  if (section.kind === 'storyboard') return t('generationList.storyboardSection', { title: section.title })
  if (section.kind === 'group') return t('generationList.groupSection', { name: section.title })
  return t('generationList.ungrouped')
}

export function GenerationListView({ sectionActions }: {
  /** 分组头右端的动作（「生成整组」，第二步接线）；未分组段不传。 */
  sectionActions?: (section: GenerationListSection) => React.ReactNode
} = {}): JSX.Element {
  const { t } = useTranslation()
  const model = useGenerationListModel()
  const inspectorKey = useGenerationViewStore((state) => state.inspectorKey)
  const setInspectorKey = useGenerationViewStore((state) => state.setInspectorKey)
  const filter = useGenerationViewStore((state) => state.listFilter)
  const clearListFilter = useGenerationViewStore((state) => state.clearListFilter)
  const setView = useGenerationViewStore((state) => state.setView)
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(1200)
  const card = inspectorKey ? findGenerationListCard(model, inspectorKey) : null
  const inspectorSection = card ? model.sections.find((section) => section.cards.includes(card)) : undefined
  const inspectorNodeTitle = useGenerationCanvasStore((state) => (inspectorKey ? state.nodes.find((node) => node.id === inspectorKey)?.title : undefined))
  // 只开着一张不在列表里的节点（参考素材、未引用素材）时，检查器用一张临时卡显示它。
  const inspectorCard: GenerationListCard | null = React.useMemo(() => card ?? (inspectorKey && inspectorNodeTitle !== undefined
    ? { key: inspectorKey, nodeId: inspectorKey, variant: 'generation', storyboardShotNumber: null, title: inspectorNodeTitle, status: null, planPrompt: null, anchor: null, referenceNodeIds: [], previous: null }
    : null), [card, inspectorKey, inspectorNodeTitle])

  // 筛选的方案被删了 → 回到全部；检查器那张卡不见了 → 收起。
  React.useEffect(() => { if (model.filterMissing) clearListFilter() }, [clearListFilter, model.filterMissing])
  React.useEffect(() => { if (inspectorKey && !inspectorCard) setInspectorKey(null) }, [inspectorCard, inspectorKey, setInspectorKey])
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspectorKey(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setInspectorKey])
  React.useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const columns = columnsFor(width - 64)
  const mediaHeight = columns >= 4 ? 180 : 220
  const rows = React.useMemo(() => buildListRows(model, columns, collapsed), [collapsed, columns, model])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === 'header' ? 60 : rows[index]?.kind === 'assets' ? 84 : mediaHeight + 112,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 4,
  })
  // 「在列表里看」：开到那一张时把它滚进视口。
  React.useEffect(() => {
    if (!inspectorKey) return
    const index = rows.findIndex((row) => row.kind === 'cards' && row.cards.some((candidate) => candidate.key === inspectorKey))
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' })
    // 只在换了那一张时滚，不在每次布局变化时抢滚动位置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectorKey])

  const filteredSection = filter ? model.sections.find((section) => section.storyboard?.designId === filter.designId) : undefined
  const openInspector = (key: string) => setInspectorKey(inspectorKey === key ? null : key)
  if (!model.sections.length && !filter) {
    return <div className="h-full bg-nomi-bg p-4"><GenerationListEmpty onBackToCanvas={() => setView('canvas')} /></div>
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-nomi-bg p-4" data-generation-list aria-label={t('generationList.aria')}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-sm">
        <GenerationListAnchorStrip anchors={model.anchors} onOpen={(nodeId) => setInspectorKey(nodeId)} lead />
        {filter ? (
          <div className={cn('flex items-center gap-2 border-b border-nomi-line py-2 pr-4', model.anchors.length ? 'pl-4' : LEAD_INSET)} data-list-filter={filter.designId}>
            <button type="button" onClick={clearListFilter} aria-label={t('generationList.clearFilter')} title={t('generationList.clearFilter')}
              className="inline-flex items-center gap-1 rounded-pill bg-nomi-accent-soft px-2 py-1 text-caption text-nomi-accent hover:bg-nomi-accent-soft/80">
              {t('generationList.filter', { title: filteredSection?.title ?? '' })}
              <IconX size={13} />
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-list-scroll>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index]
                if (!row) return null
                return (
                  <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="absolute left-0 top-0 w-full px-4" style={{ transform: `translateY(${item.start}px)` }}>
                    {row.kind === 'header' ? (
                      <div className={item.index === 0 ? 'pt-3' : 'pt-5'}>
                        <GenerationListSectionHeader
                          section={row.section}
                          collapsed={collapsed.has(row.section.key)}
                          onToggleCollapsed={() => setCollapsed((current) => {
                            const next = new Set(current)
                            if (next.has(row.section.key)) next.delete(row.section.key)
                            else next.add(row.section.key)
                            return next
                          })}
                          actions={row.section.kind !== 'ungrouped' ? sectionActions?.(row.section) : undefined}
                          lead={item.index === 0 && !model.anchors.length && !filter}
                        />
                      </div>
                    ) : row.kind === 'cards' ? (
                      <div className="grid items-start gap-x-8 gap-y-4 pb-4 pl-8" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {row.cards.map((rowCard) => (
                          <GenerationListCardView
                            key={rowCard.key}
                            card={rowCard}
                            selected={rowCard.key === inspectorKey}
                            mediaHeight={mediaHeight}
                            onSelect={() => openInspector(rowCard.key)}
                            onOpenInCanvas={() => rowCard.nodeId && viewNodeInCanvas(rowCard.nodeId)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="pb-4 pl-8"><UnreferencedAssetStrip nodeIds={row.nodeIds} onOpen={(nodeId) => setInspectorKey(nodeId)} /></div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {inspectorCard ? (
            <GenerationListInspector
              card={inspectorCard}
              sectionTitle={sectionTitleOf(t, inspectorSection)}
              narrow={width < 900}
              onClose={() => setInspectorKey(null)}
              onViewInCanvas={viewNodeInCanvas}
              {...(inspectorSection?.storyboard && !inspectorCard.nodeId
                ? { onEditInStoryboard: () => openStoryboardPlanRow(inspectorSection.storyboard!, inspectorCard.key.split(':').slice(2).join(':')) }
                : {})}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
