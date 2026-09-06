import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import { CardStackPeeks } from './CardStackPeeks'
import { MagneticConnectionHandle } from '../nodes/NodeConnectionHandles'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { COLLAPSED_GROUP_CARD_SIZE } from '../model/canvasCardStackModel'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'

type Props = {
  card: CollapsedGroupCardProjection
  readOnly: boolean
  pendingConnection: boolean
  pendingConnectionSource: boolean
  pendingConnectionSide?: ConnectionAnchorSide
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  onExpand: (groupId: string) => void
  onStartConnection: (event: React.PointerEvent<HTMLElement>, groupId: string, side: ConnectionAnchorSide) => void
  onCompleteConnection: (groupId: string) => void
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
  pendingConnection,
  pendingConnectionSource,
  pendingConnectionSide,
  onPointerDown,
  onExpand,
  onStartConnection,
  onCompleteConnection,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const imageUrl = coverUrl(card)
  const countLabel = t('generationCommon.canvas.group.nodeStackCount', { count: card.memberCount })

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
      {!readOnly ? (
        <>
          <MagneticConnectionHandle
            side="left"
            active={pendingConnectionSource ? pendingConnectionSide === 'left' : pendingConnection}
            pendingTarget={pendingConnection && !pendingConnectionSource}
            ariaLabel={t('generationCommon.canvas.group.connectInput')}
            onStart={(event, side) => onStartConnection(event, card.groupId, side)}
            onComplete={() => onCompleteConnection(card.groupId)}
          />
          <MagneticConnectionHandle
            side="right"
            active={pendingConnectionSource ? pendingConnectionSide === 'right' : pendingConnection}
            pendingTarget={pendingConnection && !pendingConnectionSource}
            ariaLabel={t('generationCommon.canvas.group.connectOutput')}
            onStart={(event, side) => onStartConnection(event, card.groupId, side)}
            onComplete={() => onCompleteConnection(card.groupId)}
          />
        </>
      ) : null}
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
          'absolute inset-0 z-[2] flex cursor-grab flex-col overflow-hidden rounded-nomi-lg border active:cursor-grabbing',
          GROUP_VISUAL_CLASS.collapsedCard,
        )}
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
        <div className="flex items-center justify-between gap-3 border-t border-nomi-line px-3 py-2.5">
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
