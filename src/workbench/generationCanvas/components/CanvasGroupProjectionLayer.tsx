import React from 'react'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { CanvasFrameInteraction, CanvasGroupBox } from './GroupFrame'
import type { CanvasFrameRect } from '../model/canvasFrameBounds'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'
import { cn } from '../../../utils/cn'
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
  frame,
  drawPreview,
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
  frame?: CanvasFrameInteraction
  /** 正在拖出来的那个框（画布坐标）。和框体同一层渲染，所以缩放/平移天然对齐。 */
  drawPreview?: CanvasFrameRect | null
}): JSX.Element {
  return (
    <>
      {drawPreview ? (
        <div
          className={cn(
            'generation-canvas-v2__frame-draw-preview',
            'pointer-events-none absolute rounded-nomi-lg border-[1.5px] border-dashed',
            GROUP_VISUAL_CLASS.dropTarget,
          )}
          style={{ left: drawPreview.x, top: drawPreview.y, width: drawPreview.w, height: drawPreview.h }}
          data-frame-draw-preview="true"
          aria-hidden="true"
        />
      ) : null}
      <GroupFrameList
        boxes={boxes}
        frame={frame}
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
