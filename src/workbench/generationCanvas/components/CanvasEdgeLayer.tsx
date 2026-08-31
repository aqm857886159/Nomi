import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronDown, IconScissors } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { availableEdgeModes } from './edgeModeMenu'

export type ActiveEdge = {
  id: string
  position?: { x: number; y: number }
}

type CanvasEdgeLayerProps = {
  edges: GenerationCanvasEdge[]
  nodeById: Map<string, GenerationCanvasNode>
  /** 当前缩放：用于标签反缩放（scale(1/zoom)）保持恒定屏幕字号。 */
  zoom: number
  /** 视口裁剪：非空时只渲染两端任一在集内的边（虚拟化生效时由画布传入）；null = 渲染全部。 */
  visibleNodeIds: Set<string> | null
  /** 大图/远缩放时只画线条，延后标签、命中热区、端点等重 UI。 */
  lightweight?: boolean
  /** 当前选中的节点：其关联边点亮并显示类型标签，其余边淡化且无标签——根治多锚点「毛线球」。 */
  selectedNodeIds: Set<string>
  activeEdge: ActiveEdge | null
  readOnly: boolean
  pendingConnectionSourceId: string
  pendingConnectionSourceSide: ConnectionAnchorSide
  pendingCursorPos: { x: number; y: number } | null
  onSetActiveEdge: (edge: ActiveEdge | null) => void
  onUpdateEdgeMode: (edgeId: string, mode: NonNullable<GenerationCanvasEdge['mode']>) => void
  onDisconnectEdge: (edgeId: string) => void
  getCanvasPointFromClientPoint: (clientX: number, clientY: number) => { x: number; y: number } | null
}

// 节点连接线层（贝塞尔路径 + 命中区 + 断开剪刀 + 待连预览）。从 GenerationCanvas.tsx 抽出。
// memo（P0-D）：平移不改本层 props（edges/nodeById/zoom 稳，offset 不传进来）→ 小/中图平移整层跳过；
// >50 节点时 visibleNodeIds 每帧变仍会重渲，但 edgeGeoms 已 memo 化故不重算 bezier。
//
// 标签（连线类型胶囊）的显示门 = **选中**（2026-08-08 用户拍板）：没选中任何节点时画布上一个标签都没有，
// 选中谁才浮出谁的入/出边类型。此前是「有类型就常显 + 超 3 条折叠 + hover 揭示」——三段补丁叠在一起，
// 既糊画面又要为 hover 维护一份 state（每次划过整层重渲）。选中门把这三段一起消掉（P1/P2）。
function CanvasEdgeLayer({
  edges,
  nodeById,
  zoom,
  visibleNodeIds,
  lightweight = false,
  selectedNodeIds,
  activeEdge,
  readOnly,
  pendingConnectionSourceId,
  pendingConnectionSourceSide,
  pendingCursorPos,
  onSetActiveEdge,
  onUpdateEdgeMode,
  onDisconnectEdge,
  getCanvasPointFromClientPoint,
}: CanvasEdgeLayerProps): JSX.Element {
  const { t } = useTranslation()
  const activeEdgeId = activeEdge?.id ?? null
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
    <>
      <svg className="generation-canvas-v2__edges" aria-label={t('generationCommon.canvas.edge.aria')}>
        {edgeGeoms.map(({ edge, source, target, endX, endY, midX, midY, path, mode }) => {
          // 视口裁剪：两端都在可见集外的边不渲染（大图性能，B3）
          if (visibleNodeIds && !visibleNodeIds.has(edge.source) && !visibleNodeIds.has(edge.target)) return null
          const isActiveEdge = activeEdgeId === edge.id
          const isIncident = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
          const renderInteractiveEdge = !lightweight || isActiveEdge || isIncident
          return (
            <g
              key={edge.id}
              className="generation-canvas-v2__edge"
              data-mode={mode}
              data-edge-id={edge.id}
              data-active={isActiveEdge ? 'true' : undefined}
              data-incident={isIncident ? 'true' : undefined}
            >
              <path className="generation-canvas-v2__edge-path" d={path} />
              {renderInteractiveEdge ? (
                <circle className="generation-canvas-v2__edge-dot" cx={endX} cy={endY} r={3.2} />
              ) : null}
              {!readOnly && renderInteractiveEdge ? (
                <path
                  className="generation-canvas-v2__edge-hit"
                  d={path}
                  role="button"
                  tabIndex={0}
                  aria-label={t('generationCommon.canvas.edge.select', {
                    source: source.title,
                    target: target.title,
                  })}
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
            </g>
          )
        })}
        {(() => {
          if (!pendingConnectionSourceId || !pendingCursorPos) return null
          const sourceNode = nodeById.get(pendingConnectionSourceId)
          if (!sourceNode) return null
          const sourceSize = resolveNodeVisualSize(sourceNode)
          const startX =
            pendingConnectionSourceSide === 'left' ? sourceNode.position.x : sourceNode.position.x + sourceSize.width
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
      <div
        className="absolute inset-0 z-[4] overflow-visible pointer-events-none"
        aria-hidden={readOnly && !edgeGeoms.some((geom) => geom.isTyped) ? 'true' : undefined}
      >
        {edgeGeoms.map(({ edge, source, target, midX, midY, mode, isTyped }) => {
          if (visibleNodeIds && !visibleNodeIds.has(edge.source) && !visibleNodeIds.has(edge.target)) return null
          const isActiveEdge = activeEdgeId === edge.id
          // 标签只给「选中节点的边」和「正在改模式的那条边」。没选中 = 一个标签都不画（也省掉整层的布局与合成）。
          const isIncident = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)
          if (!isActiveEdge && (!isIncident || !isTyped)) return null
          const modeLabel = t(`generationCommon.canvas.edge.modes.${mode}`)
          const position = isActiveEdge && activeEdge?.position ? activeEdge.position : { x: midX, y: midY }
          const selectableModes = isActiveEdge ? availableEdgeModes(source, target) : []
          const controlStyle: React.CSSProperties = {
            left: position.x,
            top: position.y,
            transform: `translate(-50%, -50%) scale(${tagScale})`,
            transformOrigin: 'center',
          }
          if (!isActiveEdge) {
            return (
              <div
                key={edge.id}
                className="generation-canvas-v2__edge-control absolute pointer-events-auto"
                style={controlStyle}
                data-edge-id={edge.id}
              >
                {readOnly ? (
                  <span className="generation-canvas-v2__edge-tag-pill inline-flex h-6 items-center rounded-pill border border-nomi-accent/40 bg-nomi-paper px-2 text-caption font-semibold leading-none whitespace-nowrap text-nomi-accent shadow-nomi-sm">
                    {modeLabel}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="generation-canvas-v2__edge-tag-pill inline-flex h-6 items-center gap-1 rounded-pill border border-nomi-accent/40 bg-nomi-paper px-2 text-caption font-semibold leading-none whitespace-nowrap text-nomi-accent shadow-nomi-sm cursor-pointer"
                    aria-label={t('generationCommon.canvas.edge.changeMode', { mode: modeLabel })}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSetActiveEdge({ id: edge.id, position: { x: midX, y: midY } })
                    }}
                  >
                    {modeLabel}
                    <IconChevronDown size={12} stroke={1.8} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          }
          if (readOnly) return null
          return (
            <div
              key={edge.id}
              className="generation-canvas-v2__edge-control generation-canvas-v2__edge-mode-control absolute flex w-[184px] justify-center pointer-events-auto"
              style={controlStyle}
              data-edge-id={edge.id}
              data-active="true"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onSetActiveEdge(null)
              }}
            >
              <button
                type="button"
                className="generation-canvas-v2__edge-tag-pill inline-flex h-6 items-center gap-1 rounded-pill border border-nomi-accent/40 bg-nomi-paper px-2 text-caption font-semibold leading-none whitespace-nowrap text-nomi-accent shadow-nomi-sm cursor-pointer"
                aria-haspopup="menu"
                aria-expanded="true"
                aria-label={t('generationCommon.canvas.edge.changeMode', { mode: modeLabel })}
                onClick={(event) => {
                  event.stopPropagation()
                  onSetActiveEdge(null)
                }}
              >
                {modeLabel}
                <IconChevronDown size={12} stroke={1.8} className="rotate-180" aria-hidden="true" />
              </button>
              <div
                className={cn(
                  'absolute top-8 left-1/2 z-[2] w-44 -translate-x-1/2 p-1',
                  'rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md',
                )}
                role="menu"
                aria-label={t('generationCommon.canvas.edge.modeMenu')}
              >
                {selectableModes.map((candidateMode) => {
                  const candidateLabel = t(`generationCommon.canvas.edge.modes.${candidateMode}`)
                  const selected = candidateMode === mode
                  return (
                    <button
                      key={candidateMode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={cn(
                        'flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 px-2.5',
                        'text-left text-caption cursor-pointer',
                        selected
                          ? 'bg-nomi-accent-soft text-nomi-accent'
                          : 'bg-transparent text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink',
                      )}
                      onClick={(event) => {
                        event.stopPropagation()
                        onUpdateEdgeMode(edge.id, candidateMode)
                        onSetActiveEdge(null)
                      }}
                    >
                      <span className="flex-1">{candidateLabel}</span>
                      {selected ? <IconCheck size={14} stroke={2} aria-hidden="true" /> : null}
                    </button>
                  )
                })}
                <div className="my-1 h-px bg-nomi-line" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2.5',
                    'text-caption text-workbench-danger cursor-pointer hover:bg-workbench-danger-soft',
                  )}
                  aria-label={t('generationCommon.canvas.edge.disconnect', {
                    source: source.title,
                    target: target.title,
                  })}
                  title={t('generationCommon.canvas.edge.disconnectMode', { mode: modeLabel })}
                  onClick={(event) => {
                    event.stopPropagation()
                    onDisconnectEdge(edge.id)
                    onSetActiveEdge(null)
                  }}
                >
                  <IconScissors size={14} stroke={1.8} aria-hidden="true" />
                  {t('generationCommon.canvas.edge.disconnectAction')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default React.memo(CanvasEdgeLayer)
