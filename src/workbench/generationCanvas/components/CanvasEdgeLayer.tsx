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

// 同一 target 的「有类型标签」入边超过此数 → 标记 data-dense，标签默认收起、hover/激活才显（防糊）。
const EDGE_TAG_DENSE_THRESHOLD = 3

type CanvasEdgeLayerProps = {
  edges: GenerationCanvasEdge[]
  nodeById: Map<string, GenerationCanvasNode>
  /** 当前缩放：用于标签反缩放（scale(1/zoom)）保持恒定屏幕字号。 */
  zoom: number
  /** 视口裁剪：非空时只渲染两端任一在集内的边（虚拟化生效时由画布传入）；null = 渲染全部。 */
  visibleNodeIds: Set<string> | null
  /** 聚焦节点（当前单选）：其关联边点亮，其余边默认淡化——根治多锚点「毛线球」。null = 全部淡化。 */
  focusedNodeId: string | null
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
  zoom,
  visibleNodeIds,
  focusedNodeId,
  activeEdge,
  readOnly,
  pendingConnectionSourceId,
  pendingCursorPos,
  onSetActiveEdge,
  onDisconnectEdge,
  getCanvasPointFromClientPoint,
}: CanvasEdgeLayerProps): JSX.Element {
  const activeEdgeId = activeEdge?.id ?? null
  // 密度判定：按 target 统计「有类型标签」（非泛 reference）入边数，超阈值的 target 其标签默认收起。
  const labeledCountByTarget = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const edge of edges) {
      const mode = edge.mode || 'reference'
      if (mode === 'reference') continue
      counts.set(edge.target, (counts.get(edge.target) || 0) + 1)
    }
    return counts
  }, [edges])
  const tagScale = 1 / (zoom || 1)
  return (
    <svg className="generation-canvas-v2__edges" aria-label="节点连接线">
      {edges.map((edge) => {
        // 视口裁剪：两端都在可见集外的边不渲染（大图性能，B3）
        if (visibleNodeIds && !visibleNodeIds.has(edge.source) && !visibleNodeIds.has(edge.target)) return null
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
        const isTyped = mode !== 'reference'
        const isDense = (labeledCountByTarget.get(edge.target) || 0) > EDGE_TAG_DENSE_THRESHOLD
        const isIncident = focusedNodeId != null && (edge.source === focusedNodeId || edge.target === focusedNodeId)
        return (
          <g
            key={edge.id}
            className="generation-canvas-v2__edge"
            data-mode={mode}
            data-active={isActiveEdge ? 'true' : undefined}
            data-incident={isIncident ? 'true' : undefined}
            data-dense={isTyped && isDense ? 'true' : undefined}
          >
            <path className="generation-canvas-v2__edge-path" d={path} />
            <circle className="generation-canvas-v2__edge-dot" cx={endX} cy={endY} r={3.2} />
            {isTyped ? (
              <g className="generation-canvas-v2__edge-tag" transform={`translate(${midX} ${midY}) scale(${tagScale})`}>
                <foreignObject x={-46} y={-9} width={92} height={18} style={{ overflow: 'visible' }}>
                  <div className="flex w-full h-full items-center justify-center">
                    <span className="generation-canvas-v2__edge-tag-pill">{EDGE_MODE_LABEL[mode]}</span>
                  </div>
                </foreignObject>
              </g>
            ) : null}
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
