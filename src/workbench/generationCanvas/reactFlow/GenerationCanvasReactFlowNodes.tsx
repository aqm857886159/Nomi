import { isCardRenderKind, resolveNodeRenderKind } from '../nodes/resolveRenderKind'
import React, { type JSX } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  useStore,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { IconPlus, IconX } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { getGenerationNodeComponentForNode } from '../nodes/renderRegistry'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { CARD_FIXED_WIDTH, getNodeResizeBounds, readNodeMediaAspectRatio, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { LightweightGenerationNode } from '../components/LightweightGenerationNode'
import {
  isLargeCanvas,
  isZoomedOutForLightweight,
  retainLargeCanvasLightweightRendering,
  shouldRenderFullNodeContent,
  shouldUseLightweightNodeRenderingForSelection,
} from '../components/canvasNodeLevelOfDetail'
import type { GenerationFlowEdge, GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { selectFlowZoom } from './canvasViewportScale'
import { GenerationFlowNodeScope, useGenerationFlowHandleMenu } from './generationFlowNodeContext'
import { handleMenuAnchor } from './connectionMenuModel'
import { useCanvasPickNodeState } from '../store/canvasPickMode'
import { readGroupPort } from '../model/groupPort'
import { sameGenerationFlowNodeRender } from '../nodes/flowNodeRenderGate'
import { resolveGenerationFlowConnectionAffordance, type GenerationFlowConnectionAffordance } from './generationCanvasReactFlowVisualContract'
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
  nodeId: string
  side: 'left' | 'right'
  type: 'source' | 'target'
  affordance: GenerationFlowConnectionAffordance
  active: boolean
  /** `null` = 没有连线在进行；`''` = 有连线但端点不在这张卡上；否则是这张卡上被吸住的把手 id。 */
  activeHandleId: string | null
  label: string
}

function GenerationFlowConnectionHandle({
  nodeId,
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
  const openHandleMenu = useGenerationFlowHandleMenu()
  // 点一下「+」（不拖）= 出这一侧的菜单，锚在圈下（bug ①：以前把手没有点击，xyflow 要移动 >1px 才起线，纯点击什么都不发生）。
  // 拖线照旧归 xyflow：移动过阈值才会起线，此时不会再有 click。
  const handleRingClick = type === 'source' && affordance === 'magnetic' && openHandleMenu
    ? (event: React.MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        const ring = event.currentTarget.querySelector('.generation-canvas-react-flow__handle-icon')?.getBoundingClientRect()
        const anchor = ring ? handleMenuAnchor(ring) : { x: event.clientX, y: event.clientY }
        openHandleMenu({ nodeId, side, clientX: anchor.x, clientY: anchor.y })
      }
    : undefined
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      isConnectableStart={type === 'source'}
      isConnectableEnd={type === 'target'}
      aria-label={label}
      // 用不上的那一侧（拉环只出现在用得上的一侧）：把手元素挂着只为画旧边，对读屏也不存在。
      aria-hidden={type === 'source' && affordance === 'hidden' ? true : undefined}
      data-side={side}
      data-affordance={type === 'source' ? affordance : 'target'}
      data-active={active ? 'true' : undefined}
      data-snapped={snapped ? 'true' : undefined}
      // 拖拽中源把手让开：它和目标热区叠在同一条卡片边上，不让它抢走落点。
      // `hidden` 档（没选中的编组端口）同样不接指针：把手在，只为让挂在它上面的边画得出来。
      style={type === 'source' && (connecting || affordance === 'hidden') ? { pointerEvents: 'none' } : undefined}
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
          onClick={handleRingClick}
        >
          <span className="generation-canvas-react-flow__handle-icon" aria-hidden="true">
            {affordance === 'magnetic' ? <IconPlus size={18} stroke={1.8} /> : null}
          </span>
        </span>
      ) : null}
    </Handle>
  )
}

/**
 * 卡片上只有显式标了 draggable 的元素（拖进时间轴的把手、版本托盘条目）能起原生拖放。文字选区、图片这类隐式拖放
 * 一旦开始，浏览器就不再派发 pointerup / mouseup，React Flow 的节点拖动收不到松手（2026-09-25 粘鼠标实测）。
 */
function blockImplicitNativeDrag(event: React.DragEvent<HTMLDivElement>): void {
  if (event.target instanceof Element && event.target.closest('[draggable="true"]')) return
  event.preventDefault()
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
  // 编组端口节点（model/groupPort.ts）：不画卡面，只挂把手。左右收 / 发两对把手都要渲染——折叠编组的
  // 聚合边就挂在它们上面，没有把手 React Flow 不画这条边；没选中时源把手只是不可见、不接指针（见下）。
  const groupPort = Boolean(readGroupPort(node))
  const NodeComponent = getGenerationNodeComponentForNode(node)
  const size = resolveNodeVisualSize(node)
  const bounds = getNodeResizeBounds(node)
  const keepMediaAspect = Boolean(readNodeMediaAspectRatio(node)) && !isCardRenderKind(resolveNodeRenderKind(node))
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const largeCanvas = useGenerationCanvasStore((state) => isLargeCanvas(state.nodes.length))
  const pendingConnectionSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const multiSelectionActive = useStore((state) => state.multiSelectionActive && data.primarySelection)
  const zoomedOut = useStore((state) => isZoomedOutForLightweight(selectFlowZoom(state)))
  const primarySelection = data.primarySelection && !multiSelectionActive
  const retainedLightweightRef = React.useRef(false)
  retainedLightweightRef.current = retainLargeCanvasLightweightRendering({
    retained: retainedLightweightRef.current,
    largeCanvas,
    selected,
    primarySelection,
  })
  const lightweightMode = retainedLightweightRef.current || shouldUseLightweightNodeRenderingForSelection({
    largeCanvas,
    zoomedOut,
    selected,
    primarySelection,
  })
  const leftAffordance = resolveGenerationFlowConnectionAffordance(node, 'left', primarySelection, pendingConnectionSourceId)
  const rightAffordance = resolveGenerationFlowConnectionAffordance(node, 'right', primarySelection, pendingConnectionSourceId)
  // 卡面压不压自己的把手看「有没有一侧是磁吸」（见 CSS 同名选择器）。
  const connectionAffordance = leftAffordance === 'magnetic' || rightAffordance === 'magnetic' ? 'magnetic' : leftAffordance === 'dot' || rightAffordance === 'dot' ? 'dot' : 'hidden'
  // 「在画布上点选」进行中：可点的卡描边（悬停加粗）、其余变灰（含正在编辑的那张）——store/canvasPickMode。
  const pickState = useCanvasPickNodeState(node.id)
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
      className={cn(
        'generation-canvas-react-flow__node-shell',
        pickState === 'eligible' && 'cursor-pointer rounded-nomi ring-2 ring-nomi-accent/60 ring-offset-2 ring-offset-workbench-bg hover:ring-[3px] hover:ring-nomi-accent',
        pickState === 'ineligible' && 'opacity-40 grayscale',
      )}
      data-pick={pickState ?? undefined}
      onDragStart={blockImplicitNativeDrag}
      // 卡面与自己把手的上下层由把手档位派生（见 generationCanvasReactFlow.css 的同名选择器）：
      // 只有磁吸档才把卡面抬到带子之上，小圆点档的把手必须压在卡面上。
      data-connection-affordance={connectionAffordance}
      style={{
        width: size.width,
        height: size.height,
        pointerEvents: groupPort ? 'none' : undefined,
        '--generation-flow-node-height': `${size.height}px`,
      } as React.CSSProperties}
      aria-hidden={groupPort || undefined}
    >
      {/* 缩放把手只给「唯一选中」的那张卡：多选时每张卡各挂 8 个把手（全选 180 张 = 1440 个），每个都被浏览器
          提成一个合成层（实测 1137 层，拖动时每帧 Layerize 约 55ms）；多选时拖一张卡的角也只会缩那一张，不是用户要的。 */}
      <NodeResizer
        isVisible={data.primarySelection && !data.readOnly && CARD_FIXED_WIDTH[resolveNodeRenderKind(node) ?? ''] === undefined}
        keepAspectRatio={keepMediaAspect}
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
          <GenerationFlowConnectionHandle nodeId={node.id} activeHandleId={activeHandleId} side="left" type="target" affordance="hidden" active={isPendingConnectionTarget} label={targetConnectionLabel} />
          <GenerationFlowConnectionHandle nodeId={node.id} activeHandleId={activeHandleId} side="right" type="target" affordance="hidden" active={isPendingConnectionTarget} label={targetConnectionLabel} />
        </>
      ) : null}
      {!groupPort ? (
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
          <GenerationFlowConnectionHandle nodeId={node.id} activeHandleId={activeHandleId} side="left" type="source" affordance={leftAffordance} active={isPendingConnectionSource} label={startConnectionLabel} />
          <GenerationFlowConnectionHandle nodeId={node.id} activeHandleId={activeHandleId} side="right" type="source" affordance={rightAffordance} active={isPendingConnectionSource} label={startConnectionLabel} />
        </>
      ) : null}
    </div>
  )
}

/**
 * 连线「×」（断开）的壳：落在贝塞尔中点 + 恒定屏幕尺寸。
 *
 * 连线只表达「谁连到谁」；它的用途（首帧 / 尾帧 / 参考）由目标节点自己的参考槽显示和设置（2026-10-08 用户：
 * 「删掉连线中间的标签吗，没有作用」），所以这里只剩一个断开的小按钮。
 *
 * **尺寸**：`EdgeLabelRenderer` 把内容 portal 进 `.react-flow__edgelabel-renderer`，
 * 那个容器在 `.react-flow__viewport` 里面，**跟着视口一起缩放**——固定尺寸于是
 * 缩到 30% 小得看不清、放到 300% 大得离谱。这里用 `edgeLabelTransform` 反缩放回恒定屏幕尺寸。
 *
 * 订阅收在这一层（而不是提到 `GenerationFlowEdgeView`）是刻意的：
 * 「×」只给选中或悬停的那一条边画，缩放时因此只重渲它，不惊动整张图的边。
 */
function EdgeDisconnectLayer({ id, labelX, labelY, onPointerEnter, onPointerLeave, children }: {
  id: string
  labelX: number
  labelY: number
  onPointerEnter: () => void
  onPointerLeave: () => void
  children: React.ReactNode
}): JSX.Element {
  const zoom = useCanvasLiveZoom()
  return (
    <EdgeLabelRenderer>
      <div
        className="generation-canvas-v2__edge-control absolute z-10 pointer-events-auto"
        style={{ transform: edgeLabelTransform(labelX, labelY, zoom) }}
        data-edge-id={id}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
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
  const [hovered, setHovered] = React.useState(false)
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const disconnectEdge = useGenerationCanvasStore((state) => state.disconnectEdge)
  const source = data?.sourceNode
  const target = data?.targetNode
  const incident = Boolean(data?.incident)
  const mode = edge?.mode || 'reference'
  const sourceLabel = source?.title || edge?.source || ''
  const targetLabel = target?.title || edge?.target || ''
  // 无障碍标签等文案按它们真正依赖的值缓存，拖动时每帧重渲不重新解析（2026-10-06 L-perf）。
  const selectLabel = React.useMemo(
    () => t('generationCommon.canvas.edge.select', { source: sourceLabel, target: targetLabel }),
    [sourceLabel, t, targetLabel],
  )
  const disconnectLabel = data?.aggregateDirection
    ? t('generationCommon.canvas.group.disconnectAggregate')
    : t('generationCommon.canvas.edge.disconnect', { source: sourceLabel, target: targetLabel })
  // 悬停从线移到「×」要穿过一小段空隙：离开延迟一拍再收，「×」自己也算悬停。
  const enter = React.useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    setHovered(true)
  }, [])
  const leave = React.useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setHovered(false), 160)
  }, [])
  React.useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current) }, [])
  const showDisconnect = !readOnly && Boolean(edge) && (Boolean(selected) || hovered)

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
          aria-label={selectLabel}
          onPointerEnter={enter}
          onPointerLeave={leave}
          onPointerDown={(event) => event.stopPropagation()}
          // 点线 = 选中（React Flow 的 onEdgeClick 接住并高亮），不弹任何菜单。
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          }}
        />
      ) : null}
      <circle className="generation-canvas-v2__edge-dot" cx={targetX} cy={targetY} r={3.2} />
      {showDisconnect ? (
        <EdgeDisconnectLayer id={id} labelX={labelX} labelY={labelY} onPointerEnter={enter} onPointerLeave={leave}>
          {/* 最小图标按钮（设计系统现成的 WorkbenchIconButton，不加额外样式）；最终样子等设计稿。 */}
          <WorkbenchIconButton
            size="sm"
            data-edge-disconnect=""
            icon={<IconX size={12} stroke={2} aria-hidden="true" />}
            label={disconnectLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              if (edge) disconnectEdge(edge.id)
            }}
          />
        </EdgeDisconnectLayer>
      ) : null}
    </g>
  )
}

export const nodeTypes = { generation: React.memo(GenerationFlowNodeView, sameGenerationFlowNodeRender) }
export const edgeTypes = { generation: GenerationFlowEdgeView }
