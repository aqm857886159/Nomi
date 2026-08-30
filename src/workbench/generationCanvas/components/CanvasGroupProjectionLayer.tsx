import React from 'react'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { CanvasGroupBox } from './GroupFrame'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import { GroupFrameList } from './GroupFrame'
import { CollapsedGroupCard } from './CollapsedGroupCard'

type GroupPointerDown = (
  event: React.PointerEvent<HTMLDivElement>,
  groupId: string,
  options?: { selectMembers?: boolean },
) => void

export function CanvasGroupProjectionLayer({
  boxes,
  cards,
  readOnly,
  pendingConnection,
  pendingConnectionSourceId,
  pendingConnectionSourceKind,
  pendingConnectionSide,
  onPointerDown,
  onConnectToGroup,
  onStartGroupConnection,
  onSetCollapsed,
}: {
  boxes: readonly CanvasGroupBox[]
  cards: readonly CollapsedGroupCardProjection[]
  readOnly: boolean
  pendingConnection: boolean
  pendingConnectionSourceId: string
  pendingConnectionSourceKind: 'node' | 'group'
  pendingConnectionSide: ConnectionAnchorSide
  onPointerDown: GroupPointerDown
  onConnectToGroup: (groupId: string) => void
  onStartGroupConnection: (event: React.PointerEvent<HTMLElement>, groupId: string, side: ConnectionAnchorSide) => void
  onSetCollapsed: (groupId: string, collapsed: boolean) => void
}): JSX.Element {
  return (
    <>
      <GroupFrameList
        boxes={boxes}
        onPointerDown={onPointerDown}
        pendingConnection={pendingConnection && pendingConnectionSourceKind === 'node'}
        pendingConnectionSide={pendingConnectionSide}
        onConnectToGroup={onConnectToGroup}
        onCollapse={readOnly ? undefined : (groupId) => onSetCollapsed(groupId, true)}
      />
      {cards.map((card) => (
        <CollapsedGroupCard
          key={card.groupId}
          card={card}
          readOnly={readOnly}
          pendingConnection={
            pendingConnection
            && (pendingConnectionSourceKind === 'node' || pendingConnectionSourceId === card.groupId)
          }
          pendingConnectionSource={pendingConnectionSourceKind === 'group' && pendingConnectionSourceId === card.groupId}
          pendingConnectionSide={pendingConnectionSide}
          onPointerDown={(event, groupId) => onPointerDown(event, groupId, { selectMembers: false })}
          onExpand={(groupId) => onSetCollapsed(groupId, false)}
          onStartConnection={onStartGroupConnection}
          onCompleteConnection={onConnectToGroup}
        />
      ))}
    </>
  )
}
