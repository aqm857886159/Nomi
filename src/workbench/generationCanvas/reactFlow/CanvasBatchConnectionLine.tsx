import { getBezierPath, useReactFlow, type ConnectionLineComponentProps } from '@xyflow/react'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

export function CanvasBatchConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, fromNode, toNode }: ConnectionLineComponentProps): JSX.Element {
  const selected = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const flow = useReactFlow()
  // Body drops use the same selection semantics as handle drops. Ask RF for the
  // nodes under its flow-space endpoint; it remains the sole geometry owner.
  const overSelection = toNode ? selected.includes(toNode.id) : selected.length > 1 &&
    flow.getIntersectingNodes({ x: toX, y: toY, width: 1, height: 1 }, true).some((node) => selected.includes(node.id))
  const count = selected.includes(fromNode.id) || overSelection ? selected.length : 1
  const [path, x, y] = getBezierPath({ sourceX: fromX, sourceY: fromY, targetX: toX, targetY: toY, sourcePosition: fromPosition, targetPosition: toPosition })
  return <g>
    <path d={path} className="react-flow__connection-path" fill="none" />
    {count > 1 && <foreignObject x={x - 18} y={y - 12} width={36} height={24} className="pointer-events-none">
      <div data-batch-connection-count={count} className="rounded-nomi bg-nomi-paper text-nomi-ink text-caption text-center shadow-nomi-md">×{count}</div>
    </foreignObject>}
  </g>
}
