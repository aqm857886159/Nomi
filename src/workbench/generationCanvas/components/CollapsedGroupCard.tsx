import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import { CardStackPeeks } from './CardStackPeeks'
import { COLLAPSED_GROUP_CARD_SIZE } from '../model/canvasCardStackModel'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'
import { groupColorStyle } from '../model/groupColor'

type Props = {
  card: CollapsedGroupCardProjection
  readOnly: boolean
  /**
   * 这张折叠卡就是当前选区（点它 = 选中这个编组，走框选中态 useCanvasFrameActions.selectFrame）。
   * 选中时边框亮 accent，左右「+」圈由画布内核里的编组端口节点画（model/groupPort.ts），不在这张卡上。
   */
  selected: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  onExpand: (groupId: string) => void
}

function coverUrl(card: CollapsedGroupCardProjection): string {
  const result = card.coverNode?.result
  if (result?.type === 'image') return result.thumbnailUrl || result.url || ''
  if (result?.type === 'video') return result.thumbnailUrl || ''
  return ''
}

export function CollapsedGroupCard({
  card,
  readOnly,
  selected,
  onPointerDown,
  onExpand,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const imageUrl = coverUrl(card)
  const countLabel = t('generationCommon.canvas.group.nodeStackCount', { count: card.memberCount })
  const colorStyle = groupColorStyle(card.color)

  return (
    <article
      className="absolute isolate z-[3] select-none overflow-visible"
      data-collapsed-group-id={card.groupId}
      data-group-id={card.groupId}
      style={{
        transform: `translate(${card.position.x}px, ${card.position.y}px)`,
        width: COLLAPSED_GROUP_CARD_SIZE,
        height: COLLAPSED_GROUP_CARD_SIZE,
      }}
    >
      <CardStackPeeks
        count={card.memberCount}
        label={countLabel}
        expanded={false}
        onToggle={() => onExpand(card.groupId)}
        tone="group"
        disabled={readOnly}
      />
      <div
        className={cn(
          // 这张卡住在画布内核的 ViewportPortal 里，那一层整体 pointer-events:none——卡身必须自己打开，
          // 否则点它、拖它都穿到画布平面上（2026-09-24 真机：点折叠卡命中的是 react-flow__pane）。
          'absolute inset-0 z-[2] flex flex-col overflow-hidden rounded-nomi-lg border',
          readOnly ? 'pointer-events-none' : 'pointer-events-auto cursor-grab active:cursor-grabbing',
        GROUP_VISUAL_CLASS.collapsedCard,
        selected ? 'border-nomi-accent' : null,
      )}
        style={{ borderColor: selected ? undefined : colorStyle.borderColor }}
        data-frame-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={t('generationCommon.canvas.group.collapsedAria', { name: card.name, count: card.memberCount })}
        onPointerDown={(event) => onPointerDown(event, card.groupId)}
      >
        <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-nomi-ink-05">
          {imageUrl ? (
            <img src={imageUrl} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <span className={cn('grid size-14 place-items-center rounded-nomi-lg', GROUP_VISUAL_CLASS.emptyIcon)} aria-hidden="true">
              <IconStack2 size={28} stroke={1.7} />
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-nomi-line px-3 py-2.5" style={{ borderTopColor: colorStyle.borderColor }}>
          <div className="min-w-0">
            <div className="truncate text-body-sm font-semibold text-nomi-ink">{card.name}</div>
            <div className="text-micro text-nomi-ink-60">{countLabel}</div>
          </div>
          <span className="shrink-0 text-micro text-nomi-ink-40">{t('generationCommon.canvas.group.dragWhole')}</span>
        </div>
      </div>
    </article>
  )
}
