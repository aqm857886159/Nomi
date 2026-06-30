import React from 'react'
import { IconScissors } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { EDGE_MODE_LABEL } from '../model/graphOps'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'

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
  /** 大图/远缩放时只画线条，延后标签、命中热区、端点等重 UI。 */
  lightweight?: boolean
  /** 聚焦节点（当前单选）：其关联边点亮，其余边默认淡化——根治多锚点「毛线球」。null = 全部淡化。 */
  focusedNodeId: string | null
  activeEdge: ActiveEdge | null
  readOnly: boolean
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  pendingCursorPos: { x: number; y: number } | null
  onSetActiveEdge: (edge: ActiveEdge | null) => void
  onDisconnectEdge: (edgeId: string) => void
  getCanvasPointFromClientPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

// 节点连接线层（贝塞尔路径 + 命中区 + 断开剪刀 + 待连预览）。从 GenerationCanvas.tsx 抽出。
// memo（P0-D）：平移不改本层 props（edges/nodeById/zoom 稳，offset 不传进来）→ 小/中图平移整层跳过；
// >50 节点时 visibleNodeIds 每帧变仍会重渲，但 edgeGeoms 已 memo 化故不重算 bezier。
function CanvasEdgeLayer({
  edges,
  nodeById,
  zoom,
  visibleNodeIds,
  lightweight = false,
  focusedNodeId,
  activeEdge,
  readOnly,
  pendingConnectionSourceId,
  pendingConnectionSourceSide,
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
  // P0-D 平移性能：边几何（bezier 路径 / 端点 / 中点）是节点坐标的纯函数，与 offset(平移)/zoom 无关。
  // 抽进 useMemo([edges, nodeById]) → 平移时不重算（即使外层因虚拟化 visibleNodeIds 变而重渲，
  // 也只重跑「裁剪过滤 + JSX」不再每帧重算 156 条 bezier 数学）。deps 仅在节点移动/连边增删时变。
  const edgeGeoms = React.useMemo(
    () =>
      edges
        .map((edge) => {
          const source = nodeById.get(edge.source)
          const target = nodeById.get(edge.target)
          if (!source || !target) return null
          // 锚点必须用「真实渲染尺寸」（卡片类固定宽 200/320…），不能用名义 node.size——否则
          // 起笔/落点会偏到节点框外（character-card 名义 300 实渲 200 → 连线飘在右侧 100px 外的根因）。
          const sourceSize = resolveNodeVisualSize(source)
          const targetSize = resolveNodeVisualSize(target)
          const targetIsLeft = target.position.x + targetSize.width / 2 < source.position.x + sourceSize.width / 2
          const startX = targetIsLeft ? source.position.x : source.position.x + sourceSize.width
          const startY = source.position.y + sourceSize.height / 2
          const endX = targetIsLeft ? target.position.x + targetSize.width : target.position.x
          const endY = target.position.y + targetSize.height / 2
          const control = Math.max(64, Math.min(140, Math.abs(endX - startX) * 0.45))
          const direction = targetIsLeft ? -1 : 1
          const mode = edge.mode || 'reference'
          const midX = (startX + endX) / 2
          const midY = (startY + endY) / 2
          const path = `M ${startX} ${startY} C ${startX + control * direction} ${startY}, ${endX - control * direction} ${endY}, ${endX} ${endY}`
          return { edge, source, target, endX, endY, midX, midY, path, mode, isTyped: mode !== 'reference' }
        })
        .filter((geom): geom is NonNullable<typeof geom> => geom !== null),
    [edges, nodeById],
  )
  return (
    <svg className="generation-canvas-v2__edges" aria-label="节点连接线">
      {edgeGeoms.map(({ edge, source, target, endX, endY, midX, midY, path, mode, isTyped }) => {
        // 视口裁剪：两端都在可见集外的边不渲染（大图性能，B3）
        if (visibleNodeIds && !visibleNodeIds.has(edge.source) && !visibleNodeIds.has(edge.target)) return null
        const isActiveEdge = activeEdgeId === edge.id
        const cutPosition = isActiveEdge && activeEdge?.position ? activeEdge.position : { x: midX, y: midY }
        const isDense = (labeledCountByTarget.get(edge.target) || 0) > EDGE_TAG_DENSE_THRESHOLD
        const isIncident = focusedNodeId != null && (edge.source === focusedNodeId || edge.target === focusedNodeId)
        const renderInteractiveEdge = !lightweight || isActiveEdge || isIncident
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
            {renderInteractiveEdge ? <circle className="generation-canvas-v2__edge-dot" cx={endX} cy={endY} r={3.2} /> : null}
            {renderInteractiveEdge && isTyped ? (
              <g className="generation-canvas-v2__edge-tag" transform={`translate(${midX} ${midY}) scale(${tagScale})`}>
                <foreignObject x={-46} y={-9} width={92} height={18} style={{ overflow: 'visible' }}>
                  <div className="flex w-full h-full items-center justify-center">
                    <span className="generation-canvas-v2__edge-tag-pill">{EDGE_MODE_LABEL[mode]}</span>
                  </div>
                </foreignObject>
              </g>
            ) : null}
            {!readOnly && renderInteractiveEdge ? (
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
                      'shadow-nomi-md',
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
                    <IconScissors size={16} stroke={1.6} aria-hidden="true" />
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
        const sourceSize = resolveNodeVisualSize(sourceNode)
        const startX = pendingConnectionSourceSide === 'left'
          ? sourceNode.position.x
          : sourceNode.position.x + sourceSize.width
        const startY = sourceNode.position.y + sourceSize.height / 2
        const endX = pendingCursorPos.x
        const endY = pendingCursorPos.y
        const ctrl = Math.max(40, Math.abs(endX - startX) * 0.45)
        const direction = pendingConnectionSourceSide === 'left' ? -1 : 1
        return (
          <path
            className="generation-canvas-v2__edge-preview"
            d={`M ${startX} ${startY} C ${startX + ctrl * direction} ${startY}, ${endX - ctrl * direction} ${endY}, ${endX} ${endY}`}
          />
        )
      })()}
    </svg>
  )
}

export default React.memo(CanvasEdgeLayer)
