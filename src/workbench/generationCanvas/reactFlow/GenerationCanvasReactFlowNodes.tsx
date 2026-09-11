import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  useStore,
  useViewport,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconChevronDown, IconPlus, IconScissors } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeComponentForNode } from '../nodes/renderRegistry'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { getNodeSizeBounds, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { availableEdgeModes } from '../components/edgeModeMenu'
import { LightweightGenerationNode } from '../components/LightweightGenerationNode'
import {
  retainLargeCanvasLightweightRendering,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRenderingForSelection,
} from '../components/canvasNodeLevelOfDetail'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { GenerationFlowNodeScope } from './generationFlowNodeContext'
import { resolveGenerationFlowConnectionAffordance } from './generationCanvasReactFlowVisualContract'
import { edgeLabelTransform, useCanvasLiveZoom } from './canvasViewportScale'
import type { CanvasPluginNodeState } from '../plugins/canvasPluginTypes'

const MAGNETIC_HANDLE_ICON_RADIUS = 14.5

function clampMagneticHandlePosition(value: number, max: number): number {
  return Math.min(
    Math.max(value, MAGNETIC_HANDLE_ICON_RADIUS),
    Math.max(MAGNETIC_HANDLE_ICON_RADIUS, max - MAGNETIC_HANDLE_ICON_RADIUS),
  )
}

function updateMagneticHandlePosition(event: React.PointerEvent<HTMLSpanElement>): void {
  const hitArea = event.currentTarget
  const rect = hitArea.getBoundingClientRect()
  const localWidth = hitArea.offsetWidth || rect.width || 1
  const localHeight = hitArea.offsetHeight || rect.height || 1
  const localX = rect.width > 0 ? (event.clientX - rect.left) * (localWidth / rect.width) : localWidth / 2
  const localY = rect.height > 0 ? (event.clientY - rect.top) * (localHeight / rect.height) : localHeight / 2
  hitArea.style.setProperty('--connection-handle-x', `${clampMagneticHandlePosition(localX, localWidth)}px`)
  hitArea.style.setProperty('--connection-handle-y', `${clampMagneticHandlePosition(localY, localHeight)}px`)
  hitArea.dataset.following = 'true'
}

function resetMagneticHandlePosition(event: React.PointerEvent<HTMLSpanElement>): void {
  const hitArea = event.currentTarget
  hitArea.style.setProperty('--connection-handle-x', hitArea.dataset.homeX || '50%')
  hitArea.style.setProperty('--connection-handle-y', '50%')
  hitArea.removeAttribute('data-following')
}

type GenerationFlowConnectionHandleProps = {
  side: 'left' | 'right'
  type: 'source' | 'target'
  affordance: 'dot' | 'magnetic' | 'hidden'
  active: boolean
  /** `null` = 没有连线在进行；`''` = 有连线但端点不在这张卡上；否则是这张卡上被吸住的把手 id。 */
  activeHandleId: string | null
  label: string
}

function GenerationFlowConnectionHandle({
  side,
  type,
  affordance,
  active,
  activeHandleId,
  label,
}: GenerationFlowConnectionHandleProps): JSX.Element {
  const position = side === 'left' ? Position.Left : Position.Right
  const id = `${type}-${side}`
  const connecting = activeHandleId !== null
  // 两件不同的事实，两个不同的属性。`data-active` =「有连线在进行、我是合法候选」——整段拖拽里
  // 每个候选都为真；`data-snapped` =「端点此刻就吸在我身上」——同一时刻只属于一个把手。
  // 它们曾共用 `data-active`，于是吸附不可观测：正向断言对任意候选都过（假绿），反向永远清不掉（真红）。
  const snapped = activeHandleId === id
  const homeX = side === 'left' ? 'calc(100% - 28px)' : '28px'
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      isConnectableStart={type === 'source'}
      isConnectableEnd={type === 'target'}
      aria-label={label}
      data-side={side}
      data-affordance={type === 'source' ? affordance : 'target'}
      data-active={active ? 'true' : undefined}
      data-snapped={snapped ? 'true' : undefined}
      // 拖拽中源把手让开：它和目标热区叠在同一条卡片边上，不让它抢走落点。
      style={type === 'source' && connecting ? { pointerEvents: 'none' } : undefined}
      className={cn(
        'generation-canvas-react-flow__handle',
        `generation-canvas-react-flow__handle--${type}`,
        type === 'source' && `generation-canvas-react-flow__handle--${affordance}`,
        // 目标侧外侧热区：伪元素命中返回 Handle 自身（XYHandle 优先 elementFromPoint），
        // 量出来的锚点仍是卡片边上那 1px。只在连线进行时开 pointer-events——空闲时是 none，
        // 于是画在节点层之下的连线照旧随处点得到（常驻带子把边吞掉正是被否掉的那版）。
        type === 'target' && 'after:absolute after:top-0 after:w-[112px] after:h-[min(168px,calc(var(--generation-flow-node-height)+28px))] after:-translate-y-1/2 after:content-[""]',
        type === 'target' && (side === 'left' ? 'after:right-0' : 'after:left-0'),
        type === 'target' && (connecting ? 'after:pointer-events-auto' : 'after:pointer-events-none'),
      )}
    >
      {type === 'source' && affordance !== 'hidden' ? (
        <span
          className="generation-canvas-react-flow__handle-hit"
          data-home-x={homeX}
          data-side={side}
          style={affordance === 'magnetic' ? {
            '--connection-handle-x': homeX,
            '--connection-handle-y': '50%',
          } as React.CSSProperties : undefined}
          onPointerMove={affordance === 'magnetic' ? updateMagneticHandlePosition : undefined}
          onPointerLeave={affordance === 'magnetic' ? resetMagneticHandlePosition : undefined}
          onPointerCancel={affordance === 'magnetic' ? resetMagneticHandlePosition : undefined}
        >
          <span className="generation-canvas-react-flow__handle-icon" aria-hidden="true">
            {affordance === 'magnetic' ? <IconPlus size={18} stroke={1.8} /> : null}
          </span>
        </span>
      ) : null}
    </Handle>
  )
}

export function GenerationFlowNodeView({ data, selected }: NodeProps<GenerationFlowNode>): JSX.Element {
  const { t } = useTranslation()
  const node = data.generationNode
  // 每张卡一个标量订阅：同一对把手之间的指针移动不会让它重渲染。
  const activeHandleId = useStore((state) => {
    const connection = state.connection
    if (!connection.inProgress) return null
    if (connection.fromHandle.nodeId === node.id) return connection.fromHandle.id ?? ''
    return connection.isValid && connection.toHandle?.nodeId === node.id ? connection.toHandle.id ?? '' : ''
  })
  const collapsedGroupProxy = node.meta?.collapsedGroupProxy === true
  const NodeComponent = getGenerationNodeComponentForNode(node)
  const size = resolveNodeVisualSize(node)
  const bounds = getNodeSizeBounds(node.kind)
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const nodeCount = useGenerationCanvasStore((state) => state.nodes.length)
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const multiSelectionActive = useStore((state) => state.multiSelectionActive && data.primarySelection)
  const { zoom } = useViewport()
  const primarySelection = data.primarySelection && !multiSelectionActive
  const retainedLightweightRef = React.useRef(false)
  retainedLightweightRef.current = retainLargeCanvasLightweightRendering({
    retained: retainedLightweightRef.current,
    nodeCount,
    selected,
    primarySelection,
  })
  const lightweightMode = retainedLightweightRef.current || shouldUseLightweightNodeRenderingForSelection({
    nodeCount,
    zoom,
    selected,
    primarySelection,
  })
  const connectionAffordance = collapsedGroupProxy
    ? 'hidden'
    : resolveGenerationFlowConnectionAffordance(node, primarySelection, pendingConnectionSourceId)
  const isPendingConnectionSource = pendingConnectionSourceId === node.id
  const isPendingConnectionTarget = Boolean(pendingConnectionSourceId && !isPendingConnectionSource)
  const startConnectionLabel = t('generationCommon.node.startConnection')
  const targetConnectionLabel = t('generationCommon.node.connectHere')
  const pluginManifest = node.pluginState ? canvasPluginRegistry.getManifest(node.pluginState.pluginId) : undefined
  const pluginHost = node.typeId && pluginManifest ? {
    hasPermission: (permission: 'canvas.read' | 'canvas.write' | 'workflow.read' | 'workflow.write') => pluginManifest.permissions.includes(permission),
    requestNodePatch: ({ pluginState }: { pluginState: CanvasPluginNodeState }) => {
      if (
        pluginState.pluginId !== node.pluginState?.pluginId ||
        pluginState.typeId !== node.typeId
      ) return
      updateNode(node.id, { pluginState }, { history: true })
    },
  } : undefined

  return (
    <div
      className="generation-canvas-react-flow__node-shell"
      style={{
        width: size.width,
        height: size.height,
        pointerEvents: collapsedGroupProxy ? 'none' : undefined,
        '--generation-flow-node-height': `${size.height}px`,
      } as React.CSSProperties}
      aria-hidden={collapsedGroupProxy || undefined}
    >
      <NodeResizer
        isVisible={selected && !data.readOnly}
        minWidth={bounds.minWidth}
        minHeight={bounds.minHeight}
        maxWidth={bounds.maxWidth}
        maxHeight={bounds.maxHeight}
        lineStyle={{ borderColor: 'transparent' }}
        handleStyle={{
          width: 16,
          height: 16,
          border: 0,
          borderRadius: 0,
          background: 'transparent',
          boxShadow: 'none',
        }}
        onResizeStart={() => captureHistory()}
        onResize={(_event, params) => {
          updateNode(node.id, {
            position: { x: params.x, y: params.y },
            size: { width: params.width, height: params.height },
            meta: { ...(node.meta || {}), userResized: true, previewHeight: params.height },
          }, { persist: false, emit: false, history: false })
        }}
        onResizeEnd={() => {
          const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)
          if (latest) {
            emitCanvasGesture([{
              type: 'canvas.node.updated',
              payload: {
                nodeId: node.id,
                patch: { position: latest.position, size: latest.size, meta: latest.meta },
              },
            }])
          }
          commitPersistedChange()
        }}
      />
      {!data.readOnly ? (
        <>
          <GenerationFlowConnectionHandle activeHandleId={activeHandleId} side="left" type="target" affordance="hidden" active={isPendingConnectionTarget} label={targetConnectionLabel} />
          <GenerationFlowConnectionHandle activeHandleId={activeHandleId} side="right" type="target" affordance="hidden" active={isPendingConnectionTarget} label={targetConnectionLabel} />
        </>
      ) : null}
      {!collapsedGroupProxy ? (
        <GenerationFlowNodeScope>
          {shouldRenderFullNodeContent({ lightweightMode, selected: primarySelection, focusFlash: data.focusFlash }) ? (
            // 节点渲染器按种类懒加载（renderRegistry 的 React.lazy）。第一次建某种节点时 chunk 还没到，
            // 若没有就近的 Suspense 边界，React 会把最近那层（NomiStudioApp 包住整个画布的那个）
            // 已提交的内容整体 display:none 直到 chunk 到达：画布闪黑一帧，而且 React Flow 缓存的
            // pane extent 在那一帧被 ResizeObserver 记成 0×0，接下来任何一次 d3 过渡都算出 NaN 视口。
            // 就地兜底成轻量卡（同尺寸壳），让「加载中」只影响这一张卡。
            <React.Suspense
              fallback={
                <LightweightGenerationNode
                  node={node}
                  appear={data.appear}
                  selected={selected}
                  readOnly={data.readOnly}
                />
              }
            >
              <NodeComponent
                node={node}
                selected={selected}
                readOnly={data.readOnly}
                focusFlash={data.focusFlash}
                appear={data.appear}
                host={pluginHost}
              />
            </React.Suspense>
          ) : (
            <LightweightGenerationNode
              node={node}
              appear={data.appear}
              selected={selected}
              readOnly={data.readOnly}
            />
          )}
        </GenerationFlowNodeScope>
      ) : null}
      {!data.readOnly ? (
        <>
          <GenerationFlowConnectionHandle activeHandleId={activeHandleId} side="left" type="source" affordance={connectionAffordance} active={isPendingConnectionSource} label={startConnectionLabel} />
          <GenerationFlowConnectionHandle activeHandleId={activeHandleId} side="right" type="source" affordance={connectionAffordance} active={isPendingConnectionSource} label={startConnectionLabel} />
        </>
      ) : null}
    </div>
  )
}

/**
 * 边模式胶囊的壳：落点 + 恒定屏幕尺寸。
 *
 * **落点**（2026-09-11 拍板，迁移等价审计 §③ 行 11）：胶囊恒落在贝塞尔中点，
 * 而不是旧版的「用户点下去的那一点」。中点是这条边的身份位置——同一条边无论从哪里点开，
 * 标签都在同一处，多条边同时亮起时也不会挤成一堆；代价是点长边的一端时菜单弹在边中间。
 * 有意保留，不必再改。
 *
 * **尺寸**：`EdgeLabelRenderer` 把内容 portal 进 `.react-flow__edgelabel-renderer`，
 * 那个容器在 `.react-flow__viewport` 里面，**跟着视口一起缩放**——固定 12px 字号于是
 * 缩到 30% 小得看不清、放到 300% 大得离谱（迁移前旧边层用 `scale(1/zoom)` 抵消过）。
 * 这里用同一条：`edgeLabelTransform` 反缩放回恒定屏幕尺寸。
 *
 * 订阅收在这一层（而不是提到 `GenerationFlowEdgeView`）是刻意的：
 * 胶囊只给「选中节点的边」画，缩放时因此只重渲这几条，不惊动整张图的边。
 */
function EdgeModeLabelLayer({ id, labelX, labelY, children }: {
  id: string
  labelX: number
  labelY: number
  children: React.ReactNode
}): JSX.Element {
  const zoom = useCanvasLiveZoom()
  return (
    <EdgeLabelRenderer>
      <div
        className="generation-canvas-react-flow__edge-label generation-canvas-v2__edge-control"
        style={{ transform: edgeLabelTransform(labelX, labelY, zoom) }}
        data-edge-id={id}
      >
        {children}
      </div>
    </EdgeLabelRenderer>
  )
}

export function GenerationFlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<GenerationFlowEdge>): JSX.Element {
  const { t } = useTranslation()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const edge = data?.generationEdge
  const readOnly = Boolean(data?.readOnly)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const updateEdgeMode = useGenerationCanvasStore((state) => state.updateEdgeMode)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const source = data?.sourceNode
  const target = data?.targetNode
  const modes = source && target ? availableEdgeModes(source, target) : []
  const incident = Boolean(data?.incident)
  const mode = edge?.mode || 'reference'
  const aggregateLabel = data?.aggregateDirection
    ? t(`generationCommon.canvas.group.aggregate${data.aggregateDirection === 'input' ? 'Input' : 'Output'}`)
    : null
  const showLabel = !readOnly && (menuOpen || (mode !== 'reference' && (incident || selected)))

  return (
    <g
      className="generation-canvas-v2__edge"
      data-mode={mode}
      data-edge-id={id}
      data-aggregate-group={data?.aggregateGroupId}
      data-active={selected ? 'true' : undefined}
      data-incident={incident ? 'true' : undefined}
    >
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={30}
        className={cn('generation-canvas-v2__edge-path', selected ? 'generation-canvas-react-flow__edge--selected' : undefined)}
      />
      {!readOnly ? (
        <path
          className="generation-canvas-v2__edge-hit"
          d={path}
          fill="none"
          stroke="rgba(18, 24, 38, 0.001)"
          strokeWidth={30}
          role="button"
          tabIndex={0}
          aria-label={t('generationCommon.canvas.edge.select', {
            source: source?.title || edge?.source || '',
            target: target?.title || edge?.target || '',
          })}
          onPointerDown={(event) => {
            event.stopPropagation()
            setMenuOpen(true)
          }}
          onClick={(event) => {
            event.stopPropagation()
            setMenuOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setMenuOpen(true)
          }}
        />
      ) : null}
      <circle className="generation-canvas-v2__edge-dot" cx={targetX} cy={targetY} r={3.2} />
      {showLabel ? (
        <EdgeModeLabelLayer id={id} labelX={labelX} labelY={labelY}>
            <button
              type="button"
              className="generation-canvas-react-flow__edge-label-button generation-canvas-v2__edge-tag-pill"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('generationCommon.canvas.edge.changeMode', {
                mode: t(`generationCommon.canvas.edge.modes.${mode}`),
              })}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setMenuOpen((open) => !open)
              }}
            >
              <span>{aggregateLabel || t(`generationCommon.canvas.edge.modes.${mode}`)}</span>
              <IconChevronDown size={12} stroke={1.8} className={menuOpen ? 'rotate-180' : undefined} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div
                className="generation-canvas-react-flow__edge-menu"
                role="menu"
                aria-label={t('generationCommon.canvas.edge.modeMenu')}
              >
                {modes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mode === edge?.mode}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (edge) updateEdgeMode(edge.id, mode)
                      setMenuOpen(false)
                    }}
                  >
                    <span>{t(`generationCommon.canvas.edge.modes.${mode}`)}</span>
                    {mode === edge?.mode ? <IconCheck size={14} stroke={2} aria-hidden="true" /> : null}
                  </button>
                ))}
                <button
                  type="button"
                  className="generation-canvas-react-flow__edge-menu-delete"
                  role={data?.aggregateDirection ? 'button' : 'menuitem'}
                  aria-label={data?.aggregateDirection
                    ? t('generationCommon.canvas.group.disconnectAggregate')
                    : t('generationCommon.canvas.edge.disconnect', {
                      source: source?.title || edge?.source || '',
                      target: target?.title || edge?.target || '',
                    })}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (edge) disconnectEdge(edge.id)
                    setMenuOpen(false)
                  }}
                >
                  <IconScissors size={14} stroke={1.8} aria-hidden="true" />
                  <span>{t('generationCommon.canvas.edge.disconnectAction')}</span>
                </button>
              </div>
            ) : null}
        </EdgeModeLabelLayer>
      ) : null}
    </g>
  )
}

export const nodeTypes = { generation: GenerationFlowNodeView }
export const edgeTypes = { generation: GenerationFlowEdgeView }
