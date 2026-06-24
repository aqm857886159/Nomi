import React from 'react'
import { IconBrush, IconCopy } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { WorkbenchButton } from '../../../../design'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { useNodeDragResize } from '../useNodeDragResize'
import {
  FOCUS_GENERATION_NODE_EVENT,
  RESIZE_DIRECTIONS,
  getNodeSizeBounds,
} from '../nodeSizing'
import { completeNodeConnection } from '../completeNodeConnection'
import WhiteboardModal from './WhiteboardModal'
import { readWhiteboardState } from './whiteboardState'

type WhiteboardCardNodeProps = {
  node: GenerationCanvasNode
  selected: boolean
  readOnly?: boolean
  focusFlash?: boolean
  appear?: boolean
}

function WhiteboardCardNodeImpl({
  node,
  selected,
  readOnly = false,
  focusFlash = false,
  appear = false,
}: WhiteboardCardNodeProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const openPointerRef = React.useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const isMultiSelectActive = useGenerationCanvasStore((state) => state.selectedNodeIds.length > 1)
  const isPendingConnectionSource = useGenerationCanvasStore((state) => state.pendingConnectionSourceId === node.id)
  const isPendingConnectionTarget = useGenerationCanvasStore(
    (state) => state.pendingConnectionSourceId !== '' && state.pendingConnectionSourceId !== node.id,
  )
  const sourceNodeTitle = useGenerationCanvasStore((state) => {
    if (!node.derivedFrom) return undefined
    return state.nodes.find((candidate) => candidate.id === node.derivedFrom)?.title
  })
  const sourceNodeExists = useGenerationCanvasStore((state) => {
    if (!node.derivedFrom) return false
    return state.nodes.some((candidate) => candidate.id === node.derivedFrom)
  })

  const sizeBounds = getNodeSizeBounds(node.kind)
  const visualSize = {
    width: Math.max(sizeBounds.minWidth, node.size?.width || 320),
    height: Math.max(sizeBounds.minHeight, node.size?.height || 240),
  }
  const { handlePointerDown, handlePointerMove, handlePointerUp, handleResizePointerDown } = useNodeDragResize({
    node,
    selected,
    readOnly,
    isMultiSelectActive,
    sizeBounds,
    visualSize,
    selectNode,
    captureHistory,
    moveNode,
    moveSelectedNodes,
    updateNode,
    commitPersistedChange,
  })

  const handleFocusSourceNode = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!node.derivedFrom || typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: node.derivedFrom } }))
  }, [node.derivedFrom])

  const handleOpen = React.useCallback((event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (readOnly) return
    selectNode(node.id)
    setOpen(true)
  }, [node.id, readOnly, selectNode])

  const shouldIgnoreOpenPointer = React.useCallback((target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(target.closest(
      'button, input, textarea, select, [contenteditable="true"], .generation-canvas-v2-node__handle, .generation-canvas-v2-node__resize-zone',
    ))
  }, [])

  const handleCardPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    openPointerRef.current = event.button === 0 && !shouldIgnoreOpenPointer(event.target)
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      : null
    handlePointerDown(event)
  }, [handlePointerDown, shouldIgnoreOpenPointer])

  const handleCardPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const started = openPointerRef.current
    handlePointerUp(event)
    openPointerRef.current = null
    if (!started || started.pointerId !== event.pointerId || readOnly) return
    const moved = Math.hypot(event.clientX - started.x, event.clientY - started.y)
    if (moved <= 3 && !shouldIgnoreOpenPointer(event.target)) {
      selectNode(node.id)
      setOpen(true)
    }
  }, [handlePointerUp, node.id, readOnly, selectNode, shouldIgnoreOpenPointer])

  return (
    <>
      <article
        className={cn(
          'generation-canvas-v2-node absolute block overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none',
          'cursor-grab touch-none select-none data-[selected=true]:z-[5]',
        )}
        data-node-id={node.id}
        data-kind={node.kind}
        data-expanded={selected ? 'true' : 'false'}
        data-selected={selected ? 'true' : 'false'}
        data-focus-flash={focusFlash ? 'true' : 'false'}
        data-appear={appear ? 'true' : undefined}
        data-status={node.status || 'idle'}
        style={{
          transform: `translate(${node.position.x}px, ${node.position.y}px)`,
          width: visualSize.width,
          height: visualSize.height,
          willChange: 'transform',
        }}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handleCardPointerUp}
      >
        {!readOnly ? (
          <>
            <WorkbenchButton
              className={cn(
                'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--input',
                'absolute left-[-14px] top-1/2 inline-grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border-0 bg-transparent p-0',
                'cursor-crosshair opacity-80 transition-opacity duration-150 hover:opacity-100 data-[active=true]:opacity-100',
              )}
              aria-label="连接到此节点"
              data-active={isPendingConnectionTarget ? 'true' : 'false'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                completeNodeConnection(node.id)
              }}
            >
              <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
            </WorkbenchButton>
            <WorkbenchButton
              className={cn(
                'generation-canvas-v2-node__handle generation-canvas-v2-node__handle--output',
                'absolute right-[-14px] top-1/2 inline-grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border-0 bg-transparent p-0',
                'cursor-crosshair opacity-80 transition-opacity duration-150 hover:opacity-100 data-[active=true]:opacity-100',
              )}
              aria-label="从此节点开始连线"
              data-active={isPendingConnectionSource ? 'true' : 'false'}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (typeof event.currentTarget.releasePointerCapture === 'function') {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                startConnection(node.id)
              }}
            >
              <span className="generation-canvas-v2-node__handle-dot" aria-hidden="true" />
            </WorkbenchButton>
          </>
        ) : null}

        <div
          role="button"
          tabIndex={0}
          className={cn(
            'relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-nomi',
            'border border-nomi-line bg-nomi-paper shadow-nomi-md ring-1 ring-inset ring-nomi-line',
            'text-nomi-ink cursor-pointer hover:border-nomi-ink-20 hover:bg-nomi-ink-05',
          )}
          onClick={handleOpen}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            handleOpen()
          }}
        >
          <span className="grid size-14 place-items-center rounded-full bg-nomi-ink text-nomi-paper">
            <IconBrush size={28} stroke={1.55} />
          </span>
          <span className="grid gap-1 text-center">
            <span className="text-body font-semibold">{node.title || '画板'}</span>
            <span className="text-caption text-nomi-ink-60">点击打开画板</span>
          </span>
          {node.derivedFrom ? (
            <button
              type="button"
              className="generation-canvas-v2-node__derived-badge absolute left-3 top-3"
              aria-label={sourceNodeExists ? `定位源节点：${sourceNodeTitle || node.derivedFrom}` : '源节点已不存在'}
              title={sourceNodeExists ? `独立副本（来自 ${sourceNodeTitle || node.derivedFrom}）` : '独立副本（源节点已不存在）'}
              disabled={!sourceNodeExists}
              onClick={handleFocusSourceNode}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <IconCopy size={13} stroke={1.8} aria-hidden="true" />
              <span>独立副本</span>
            </button>
          ) : null}
        </div>

        {selected && !readOnly
          ? RESIZE_DIRECTIONS.map((direction) => (
            <WorkbenchButton
              key={direction}
              className={cn(
                'generation-canvas-v2-node__resize-zone',
                `generation-canvas-v2-node__resize-zone--${direction}`,
                'absolute z-[6] border-0 bg-transparent p-0',
                'focus-visible:outline-2 focus-visible:outline-nomi-accent focus-visible:outline-offset-2',
                (direction === 'n' || direction === 's') && 'left-[10px] h-[10px] w-[calc(100%-20px)] cursor-ns-resize',
                direction === 'n' && 'top-[-5px]',
                direction === 's' && 'bottom-[-5px]',
                (direction === 'e' || direction === 'w') && 'top-[10px] h-[calc(100%-20px)] w-[10px] cursor-ew-resize',
                direction === 'e' && 'right-[-5px]',
                direction === 'w' && 'left-[-5px]',
                (direction === 'ne' || direction === 'nw' || direction === 'se' || direction === 'sw') && 'h-4 w-4',
                (direction === 'ne' || direction === 'sw') && 'cursor-nesw-resize',
                (direction === 'nw' || direction === 'se') && 'cursor-nwse-resize',
                direction === 'ne' && 'right-[-8px] top-[-8px]',
                direction === 'nw' && 'left-[-8px] top-[-8px]',
                direction === 'se' && 'bottom-[-8px] right-[-8px]',
                direction === 'sw' && 'bottom-[-8px] left-[-8px]',
              )}
              aria-label={`从${direction}方向调整节点尺寸`}
              title="调整节点尺寸"
              onPointerDown={handleResizePointerDown(direction)}
            />
          ))
          : null}
      </article>
      {open ? (
        <WhiteboardModal
          nodeId={node.id}
          sourceKind="whiteboard"
          nodeTitle={node.title || '画板'}
          initialState={readWhiteboardState(node)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

const WhiteboardCardNode = React.memo(
  WhiteboardCardNodeImpl,
  (prev, next) =>
    prev.node === next.node &&
    prev.selected === next.selected &&
    prev.readOnly === next.readOnly &&
    prev.focusFlash === next.focusFlash &&
    prev.appear === next.appear,
)
WhiteboardCardNode.displayName = 'WhiteboardCardNode'

export default WhiteboardCardNode
