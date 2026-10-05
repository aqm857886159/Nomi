import React, { type JSX } from 'react'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import type { CanvasFrameInteraction, CanvasGroupBox } from './GroupFrame'
import type { CanvasFrameRect } from '../model/canvasFrameBounds'
import { GROUP_VISUAL_CLASS } from './groupVisualContract'
import { cn } from '../../../utils/cn'
import type { CollapsedGroupCardProjection } from '../model/canvasCardStackModel'
import { GroupFrameList } from './GroupFrame'
import { CollapsedGroupCard } from './CollapsedGroupCard'
import { CanvasGroupToolbar } from './CanvasGroupToolbar'
import type { GroupArrangeMode } from '../model/groupArrange'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { GroupColorId } from '../model/groupColor'

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
  pendingConnectionSourceKind,
  pendingConnectionSide,
  onPointerDown,
  onConnectToGroup,
  onSetCollapsed,
  frame,
  drawPreview,
  toolbar,
}: {
  boxes: readonly CanvasGroupBox[]
  cards: readonly CollapsedGroupCardProjection[]
  readOnly: boolean
  pendingConnection: boolean
  pendingConnectionSourceKind: 'node' | 'group'
  pendingConnectionSide: ConnectionAnchorSide
  onPointerDown: GroupPointerDown
  onConnectToGroup: (groupId: string) => void
  onSetCollapsed: (groupId: string, collapsed: boolean) => void
  frame?: CanvasFrameInteraction
  /** 正在拖出来的那个框（画布坐标）。和框体同一层渲染，所以缩放/平移天然对齐。 */
  drawPreview?: CanvasFrameRect | null
  toolbar?: {
    group: NodeGroup
    memberCount: number
    canGenerate: boolean
    canSendToTimeline: boolean
    canDownload: boolean
    onGenerate: () => void
    onSendToTimeline: () => void
    onDissolve: () => void
    onArrange: (mode: GroupArrangeMode) => void
    onColor: (color: GroupColorId) => void
    onDownload: () => void
    onClearSelection: () => void
  }
}): JSX.Element {
  const toolbarBox = toolbar ? boxes.find((box) => box.group.id === toolbar.group.id) : null
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
      {toolbar && toolbarBox ? (
        <div className="pointer-events-none absolute" style={{ left: toolbarBox.left, top: toolbarBox.top }}>
          <div className="pointer-events-auto">
            <CanvasGroupToolbar {...toolbar} />
          </div>
        </div>
      ) : null}
      {cards.map((card) => (
        <CollapsedGroupCard
          key={card.groupId}
          card={card}
          readOnly={readOnly}
          selected={frame?.selectedGroupId === card.groupId}
          onPointerDown={(event, groupId) => onPointerDown(event, groupId, { selectMembers: false })}
          onExpand={(groupId) => onSetCollapsed(groupId, false)}
        />
      ))}
    </>
  )
}
