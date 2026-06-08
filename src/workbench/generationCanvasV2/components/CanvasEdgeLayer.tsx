import React from 'react'
import { IconScissors } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { EDGE_MODE_LABEL } from '../model/graphOps'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getNodeSize } from './generationCanvasGeometry'

export type ActiveEdge = {
  id: string
  position?: { x: number; y: number }
}

type CanvasEdgeLayerProps = {
  edges: GenerationCanvasEdge[]
  nodeById: Map<string, GenerationCanvasNode>
  activeEdge: ActiveEdge | null
  readOnly: boolean
  pendingConnectionSourceId: string
  pendingCursorPos: { x: number; y: number } | null
  onSetActiveEdge: (edge: ActiveEdge | null) => void
  onDisconnectEdge: (edgeId: string) => void
  getCanvasPointFromClientPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

// 节点连接线层（贝塞尔路径 + 命中区 + 断开剪刀 + 待连预览）。从 GenerationCanvas.tsx 抽出。
export default function CanvasEdgeLayer({
  edges,
  nodeById,
  activeEdge,
  readOnly,
  pendingConnectionSourceId,
  pendingCursorPos,
  onSetActiveEdge,
  onDisconnectEdge,
  getCanvasPointFromClientPoint,
}: CanvasEdgeLayerProps): JSX.Element {
  const activeEdgeId = activeEdge?.id ?? null
  return (
    <svg className="generation-canvas-v2__edges" aria-label="节点连接线">
      {edges.map((edge) => {
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        if (!source || !target) return null
        const sourceSize = source.size || { width: 300, height: 220 }
        const targetSize = target.size || { width: 300, height: 220 }
        const startX = source.position.x + sourceSize.width
        const startY = source.position.y + sourceSize.height / 2
        const endX = target.position.x
        const endY = target.position.y + targetSize.height / 2
        const control = Math.max(64, Math.min(140, Math.abs(endX - startX) * 0.45))
        const mode = edge.mode || 'reference'
        const midX = (startX + endX) / 2
        const midY = (startY + endY) / 2
        const path = `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`
        const isActiveEdge = activeEdgeId === edge.id
        const cutPosition = isActiveEdge && activeEdge?.position ? activeEdge.position : { x: midX, y: midY }
        return (
          <g key={edge.id} className="generation-canvas-v2__edge" data-mode={mode} data-active={isActiveEdge ? 'true' : undefined}>
            <path className="generation-canvas-v2__edge-path" d={path} />
            {!readOnly ? (
              <path
                className="generation-canvas-v2__edge-hit"
                d={path}
                role="button"
                tabIndex={0}
                aria-label={`选择连接线：${source.title} 到 ${target.title}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSetActiveEdge({
                    id: edge.id,
                    position: getCanvasPointFromClientPoint(event.clientX, event.clientY) ?? { x: midX, y: midY },
                  })
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onSetActiveEdge({ id: edge.id })
                }}
              />
            ) : null}
            {isActiveEdge && !readOnly ? (
              <foreignObject className="generation-canvas-v2__edge-cut-object" x={cutPosition.x - 18} y={cutPosition.y - 18} width="36" height="36">
                <div className={cn('generation-canvas-v2__edge-cut-wrap', 'grid w-9 h-9 place-items-center pointer-events-auto')}>
                  <button
                    type="button"
                    className={cn(
                      'generation-canvas-v2__edge-cut',
                      'inline-grid w-[30px] h-[30px] place-items-center p-0 border-0 rounded-full',
                      'bg-nomi-paper text-workbench-danger cursor-pointer',
                      'shadow-[0_8px_24px_rgba(18,24,38,0.18),0_0_0_1px_rgba(18,24,38,0.08)]',
                      'hover:bg-workbench-danger hover:text-nomi-paper',
                    )}
                    aria-label={`断开连接：${source.title} 到 ${target.title}`}
                    title={`断开连接：${EDGE_MODE_LABEL[mode]}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDisconnectEdge(edge.id)
                      onSetActiveEdge(null)
                    }}
                  >
                    <IconScissors size={16} stroke={2.2} aria-hidden="true" />
                  </button>
                </div>
              </foreignObject>
            ) : null}
          </g>
        )
      })}
      {(() => {
        if (!pendingConnectionSourceId || !pendingCursorPos) return null
        const sourceNode = nodeById.get(pendingConnectionSourceId)
        if (!sourceNode) return null
        const sourceSize = getNodeSize(sourceNode)
        const startX = sourceNode.position.x + sourceSize.width
        const startY = sourceNode.position.y + sourceSize.height / 2
        const endX = pendingCursorPos.x
        const endY = pendingCursorPos.y
        const ctrl = Math.max(40, Math.abs(endX - startX) * 0.45)
        return (
          <path
            className="generation-canvas-v2__edge-preview"
            d={`M ${startX} ${startY} C ${startX + ctrl} ${startY}, ${endX - ctrl} ${endY}, ${endX} ${endY}`}
          />
        )
      })()}
    </svg>
  )
}
