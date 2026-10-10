// 生成页「列表」视图（样张板 List / ListDetail，2026-10-08 22:40Z 拍板）。
//   - 不套框：卡片定宽 256，按可用宽度排列数，留白优先；分区标题一行；
//   - 只显示已落画布的节点，和画布一一对应；没有批量条、卡上没有勾选，批量只有分区头的「生成全部」；
//   - 点卡 = 大详情：左边收成 288 窄列（同一份列表，点别的镜即切换），右边大预览 + 生成框 + 「生成」。
// 数据只有画布 store 里那一份（投影见 generationListModel.ts）；改东西只在大详情里，改的就是那个节点。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'
import { planDefaultAspect } from '../../generationCanvas/agent/storyboardShotScope'
import { CARD_GAP, CARD_MEDIA_HEIGHT, CARD_WIDTH, SIDE_PADDING, buildListRows, columnsFor, useGenerationListModel, viewNodeInCanvas } from './generationListSource'
import { findGenerationListCard, type GenerationListCard, type GenerationListSection } from './generationListModel'
import { useGenerationViewStore } from './generationViewStore'
import { GenerationListCardView } from './GenerationListCard'
import { useModelLabels } from './generationListModelLabels'
import { DetailRail, GenerationListDetail } from './GenerationListDetail'
import { GenerationListEmpty, UnreferencedAssetStrip } from './GenerationListParts'
import { GenerationListSectionHeader } from './GenerationListSectionHeader'

/** 窗口窄到放不下窄列 + 详情时，窄列让位（详情独占，「返回」回列表）。 */
const RAIL_MIN_TOTAL_WIDTH = 760
/** 内容区顶 / 底的呼吸（「画布 | 列表」切换在 40px 顶栏里，时间轴收成底边窄条，都不压内容）。 */
const TOP_LEAD = 12
const BOTTOM_LEAD = 24

/** 每个分区的默认画幅（分镜分区 = 这份分镜的默认；其余分区 = 项目里第一份分镜的默认；都没有 = 不标）。 */
function useSectionDefaultAspects(sections: readonly GenerationListSection[]): Map<string, string | null> {
  const designsByDocumentId = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  return React.useMemo(() => {
    const designs = Object.values(designsByDocumentId).flat()
    const projectDefault = designs.length ? planDefaultAspect(designs[0]!.plan) || null : null
    const map = new Map<string, string | null>()
    for (const section of sections) {
      const design = section.storyboard ? designs.find((candidate) => candidate.id === section.storyboard!.designId) : undefined
      map.set(section.key, design ? planDefaultAspect(design.plan) || projectDefault : projectDefault)
    }
    return map
  }, [designsByDocumentId, sections])
}

export function GenerationListView(): JSX.Element {
  const { t } = useTranslation()
  const model = useGenerationListModel()
  const inspectorKey = useGenerationViewStore((state) => state.inspectorKey)
  const setInspectorKey = useGenerationViewStore((state) => state.setInspectorKey)
  const setView = useGenerationViewStore((state) => state.setView)
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(1200)
  const [rootWidth, setRootWidth] = React.useState(1200)
  const defaults = useSectionDefaultAspects(model.sections)
  const modelLabel = useModelLabels()
  const listed = inspectorKey ? findGenerationListCard(model, inspectorKey) : null
  const inspectorNodeTitle = useGenerationCanvasStore((state) => (inspectorKey ? state.nodes.find((node) => node.id === inspectorKey)?.title : undefined))
  // 只开着一张不在列表里的节点（参考素材、视觉锚）时，大详情用一张临时卡显示它。
  const card: GenerationListCard | null = React.useMemo(() => listed ?? (inspectorKey && inspectorNodeTitle !== undefined
    ? { key: inspectorKey, nodeId: inspectorKey, variant: 'generation', storyboardShotNumber: null, storyboardScope: null, title: inspectorNodeTitle, status: null, referenceNodeIds: [] }
    : null), [listed, inspectorKey, inspectorNodeTitle])

  // 大详情那张卡不见了（节点被删）→ 收起；Esc 回列表。
  React.useEffect(() => { if (inspectorKey && !card) setInspectorKey(null) }, [card, inspectorKey, setInspectorKey])
  React.useEffect(() => {
    if (!inspectorKey) return undefined
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (event.key !== 'Escape' || (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]'))) return
      setInspectorKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectorKey, setInspectorKey])
  React.useLayoutEffect(() => {
    const element = rootRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setRootWidth(element.clientWidth))
    observer.observe(element)
    setRootWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  React.useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [card, model.sections.length])

  const columns = columnsFor(width)
  const rows = React.useMemo(() => buildListRows(model, columns, collapsed), [collapsed, columns, model])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rows[index]?.kind === 'header' ? 56 : rows[index]?.kind === 'assets' ? 88 : CARD_MEDIA_HEIGHT + 96,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 4,
  })

  if (!model.sections.length && !card) {
    return <div ref={rootRef} className="h-full bg-nomi-paper p-4" data-generation-list data-list-layout="empty"><GenerationListEmpty onBackToCanvas={() => setView('canvas')} /></div>
  }

  if (card) {
    const showRail = rootWidth >= RAIL_MIN_TOTAL_WIDTH
    return (
      <div ref={rootRef} className="flex h-full min-h-0 bg-nomi-paper" data-generation-list data-list-layout="detail" aria-label={t('generationList.aria')}>
        {showRail ? <DetailRail sections={model.sections} activeKey={card.key} onSelect={(key) => setInspectorKey(key)} /> : null}
        <GenerationListDetail card={card} onBack={() => setInspectorKey(null)} />
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-nomi-paper" data-generation-list data-list-layout="grid" aria-label={t('generationList.aria')}>
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-list-scroll>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + TOP_LEAD + BOTTOM_LEAD }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start + TOP_LEAD}px)`, paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}
              >
                {row.kind === 'header' ? (
                  <div className={item.index === 0 ? 'pt-1' : 'pt-6'}>
                    <GenerationListSectionHeader
                      section={row.section}
                      collapsed={collapsed.has(row.section.key)}
                      onToggle={() => setCollapsed((current) => {
                        const next = new Set(current)
                        if (next.has(row.section.key)) next.delete(row.section.key)
                        else next.add(row.section.key)
                        return next
                      })}
                      onOpenAnchor={(nodeId) => setInspectorKey(nodeId)}
                    />
                  </div>
                ) : row.kind === 'cards' ? (
                  <div className="flex items-start pb-6 pt-3" style={{ gap: CARD_GAP }}>
                    {row.cards.map((rowCard) => (
                      <div key={rowCard.key} style={{ width: CARD_WIDTH }} className="shrink-0">
                        <GenerationListCardView
                          card={rowCard}
                          defaultAspect={defaults.get(row.section.key) ?? null}
                          modelLabel={modelLabel}
                          onSelect={() => setInspectorKey(rowCard.key)}
                          onOpenInCanvas={() => viewNodeInCanvas(rowCard.nodeId)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pb-4"><UnreferencedAssetStrip nodeIds={row.nodeIds} onOpen={(nodeId) => setInspectorKey(nodeId)} /></div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
