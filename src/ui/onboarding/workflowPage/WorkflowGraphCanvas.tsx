/**
 * 只读节点图画布：SVG 连线层 + 绝对定位的节点卡 + 缩放/适应 + 拖动平移。
 * plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
 *
 * 这是 onboarding 独立的只读工作流图，不复用生成画布的交互状态或渲染器；它使用 CSS
 * transform + 绝对定位 div + SVG 连线层保持静态拓扑和节点卡对齐：
 * 一层 transform: translate() scale() 包住「连线 svg + 节点 div」，两者共用同一套内容坐标，
 * 于是缩放/平移只动一个 transform，连线和节点永远对得齐。
 *
 * 兜底（图放不下时）：几十上百个节点的图，缩到能看全就糊成灰条了。给一个「显示完整节点列表」——
 * 同样能点、同样能指定角色，只是不画位置。**不是降级提示，是等价的第二条路**。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
// 图/列表这对图标取「同一份东西的两个视图」的隐喻（board ↔ list），且都已在
// src/vendor/tablerIcons.ts 那份精选清单里——不为一个切换钮往控包体的白名单里加新图标。
import { IconLayoutBoard, IconLayoutList, IconMaximize, IconMinus, IconPlus } from '@tabler/icons-react'
import { resolveWheelIntent, useCanvasGestureScheme } from '../../../utils/canvasGesturePreference'
import { cn } from '../../../utils/cn'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'
import { getWheelZoomFactor } from '../../../utils/wheelZoom'
import {
  buildGraphGeometry,
  clampZoom,
  fitOffset,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_HEIGHT,
  zoomGraphAtPoint,
  type PositionedNode,
} from '../comfyuiGraphGeometry'
import type { GraphView } from '../comfyuiWorkflowGraphView'
import WorkflowNodeCard from './WorkflowNodeCard'
import { MENU_WIDTH, WorkflowNodeMenu } from './WorkflowNodeMenu'
import { ROLE_TONES } from './roleTone'
import type { FieldChoice, RoleChoice, WorkflowCandidate, WorkflowRole } from '../comfyuiWorkflowBinding'

const ZOOM_STEP = 0.2
const MENU_GAP = 6
/** 超过这个节点数默认直接进列表——图太大时先给能读的那个形态，别让人先看一眼糊墙再自己找出口。 */
const LIST_DEFAULT_NODE_COUNT = 60

type WorkflowGraphCanvasProps = {
  view: GraphView
  roleChoicesFor: (nodeId: string) => RoleChoice[]
  fieldChoicesFor: (nodeId: string) => FieldChoice[]
  onPickRole: (nodeId: string, choice: RoleChoice) => void
  onClearRole: (role: Exclude<WorkflowRole, 'output'>) => void
  onToggleField: (candidate: WorkflowCandidate) => void
}

export function WorkflowGraphCanvas({
  view,
  roleChoicesFor,
  fieldChoicesFor,
  onPickRole,
  onClearRole,
  onToggleField,
}: WorkflowGraphCanvasProps): JSX.Element {
  const { t } = useTranslation()
  const gestureScheme = useCanvasGestureScheme()
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const [{ zoom, offset }, setViewport] = React.useState({ zoom: 1, offset: { x: 0, y: 0 } })
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const [asList, setAsList] = React.useState(view.nodes.length > LIST_DEFAULT_NODE_COUNT)

  const geometry = React.useMemo(() => buildGraphGeometry(view), [view])
  const bindableIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const node of view.nodes) {
      if (roleChoicesFor(node.nodeId).length > 0 || fieldChoicesFor(node.nodeId).length > 0) ids.add(node.nodeId)
    }
    return ids
  }, [view.nodes, roleChoicesFor, fieldChoicesFor])

  const fit = React.useCallback(() => {
    const box = viewportRef.current?.getBoundingClientRect()
    if (!box) return
    const viewport = { width: box.width, height: box.height }
    const next = fitZoom(geometry, viewport)
    setViewport({ zoom: next, offset: fitOffset(geometry, viewport, next) })
  }, [geometry])

  // 换一条工作流 / 图变了 → 重新适应一次。否则上一条图的缩放位移留在这儿，新图可能整个在视口外。
  React.useEffect(() => {
    setSelectedNodeId(null)
    setAsList(view.nodes.length > LIST_DEFAULT_NODE_COUNT)
  }, [geometry, view.nodes.length])

  // The list unmounts the viewport. Fit only after the graph is actually mounted.
  React.useEffect(() => {
    if (asList) return
    const frame = window.requestAnimationFrame(fit)
    return () => window.cancelAnimationFrame(frame)
  }, [asList, fit])

  const hasNodes = view.nodes.length > 0
  React.useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      // Node cards are buttons: don't exclude buttons generally. Menus/fields own their scrolling.
      if (event.target instanceof Element && event.target.closest('[role="menu"], [role="listbox"], input, textarea, select, [contenteditable="true"]')) return
      event.preventDefault()
      if (resolveWheelIntent(gestureScheme, event) === 'pan') {
        const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
        const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
        if (!dx && !dy) return
        setSelectedNodeId(null)
        setViewport((current) => ({ ...current, offset: { x: current.offset.x - dx, y: current.offset.y - dy } }))
        return
      }
      if (!event.deltaY) return
      const rect = element.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = getWheelZoomFactor(event)
      setSelectedNodeId(null)
      setViewport((current) => zoomGraphAtPoint(current, current.zoom * factor, point))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [asList, gestureScheme, hasNodes])

  const zoomBy = (delta: number): void => {
    setViewport((current) => ({ ...current, zoom: clampZoom(Number((current.zoom + delta).toFixed(2))) }))
  }

  // 拖动平移：pointer capture，指针出界也不掉。
  //
  // ⚠️ 只能在**空白处**起手。setPointerCapture 会把后续 pointerup 重定向到本容器，
  // 于是起手点上那颗按钮的 click 根本不触发——表现是「点节点完全没反应」（走查实锤抓到）。
  // 守卫放在这里而不是让每个子元素自己 stopPropagation：那样每加一个可交互元素就要记得加一次，
  // 漏一个就复现同一个 bug。这里一次判定，覆盖以后加进画布的任何控件（P2 修在根因层）。
  const drag = React.useRef<{ id: number; x: number; y: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement | null)?.closest('button, a, input, textarea, select, [role="menu"]')) return
    setSelectedNodeId(null)
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const state = drag.current
    if (!state || state.id !== event.pointerId) return
    // Incremental pan composes with wheel zoom; an absolute drag baseline would undo its anchor.
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    state.x = event.clientX
    state.y = event.clientY
    setViewport((current) => ({ ...current, offset: { x: current.offset.x + dx, y: current.offset.y + dy } }))
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const selectedNode = selectedNodeId ? geometry.nodes.find((n) => n.nodeId === selectedNodeId) ?? null : null
  const menuPosition = selectedNode
    ? {
        x: Math.max(8, Math.min(
          selectedNode.x * zoom + offset.x,
          (viewportRef.current?.clientWidth ?? MENU_WIDTH) - MENU_WIDTH - 8,
        )),
        y: selectedNode.y * zoom + offset.y + NODE_HEIGHT * zoom + MENU_GAP,
      }
    : null

  const menu = selectedNode && menuPosition ? (
    <WorkflowNodeMenu
      nodeId={selectedNode.nodeId}
      position={menuPosition}
      roleChoices={roleChoicesFor(selectedNode.nodeId)}
      fieldChoices={fieldChoicesFor(selectedNode.nodeId)}
      onPickRole={(choice) => onPickRole(selectedNode.nodeId, choice)}
      onClearRole={onClearRole}
      onToggleField={onToggleField}
      onClose={() => setSelectedNodeId(null)}
    />
  ) : null

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-nomi bg-nomi-bg" data-workflow-graph={asList ? 'list' : 'graph'}>
      {view.nodes.length === 0 ? (
        <div className="grid h-full place-items-center text-caption text-nomi-ink-40">{t('comfyuiWorkflowPage.graph.empty')}</div>
      ) : asList ? (
        <NodeList
          nodes={geometry.nodes}
          bindableIds={bindableIds}
          selectedNodeId={selectedNodeId}
          onSelect={(id) => setSelectedNodeId((current) => (current === id ? null : id))}
          roleChoicesFor={roleChoicesFor}
          fieldChoicesFor={fieldChoicesFor}
          onPickRole={onPickRole}
          onClearRole={onClearRole}
          onToggleField={onToggleField}
          onCloseMenu={() => setSelectedNodeId(null)}
        />
      ) : (
        <div
          ref={viewportRef}
          className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          role="application"
          aria-label={t('comfyuiWorkflowPage.graph.aria')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            className="relative origin-top-left"
            style={{
              width: geometry.width,
              height: geometry.height,
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0 overflow-visible"
              width={geometry.width}
              height={geometry.height}
              aria-label={t('comfyuiWorkflowPage.graph.edgesAria')}
            >
              {geometry.edges.map((edge) => (
                <g key={edge.key}>
                  <path d={edge.path} fill="none" stroke="var(--nomi-line)" strokeWidth={1.5} />
                  <circle cx={edge.endX} cy={edge.endY} r={2.6} fill="var(--nomi-line)" />
                </g>
              ))}
            </svg>
            {geometry.nodes.map((node) => (
              <WorkflowNodeCard
                key={node.nodeId}
                node={node}
                bindable={bindableIds.has(node.nodeId)}
                selected={selectedNodeId === node.nodeId}
                onSelect={(id) => setSelectedNodeId((current) => (current === id ? null : id))}
              />
            ))}
          </div>
          {menu}
        </div>
      )}

      {view.nodes.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
          <button
            type="button"
            onClick={() => { setSelectedNodeId(null); setAsList((v) => !v) }}
            className={cn(
              'pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-nomi-line bg-nomi-paper px-2.5',
              'text-micro text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent',
            )}
          >
            {asList
              ? <><IconLayoutBoard size={13} stroke={1.7} aria-hidden="true" />{t('comfyuiWorkflowPage.graph.showGraph')}</>
              : <><IconLayoutList size={13} stroke={1.7} aria-hidden="true" />{t('comfyuiWorkflowPage.graph.showList')}</>}
          </button>

          {asList ? null : (
            <div className="pointer-events-auto inline-flex h-7 items-center gap-0.5 rounded-full border border-nomi-line bg-nomi-paper px-1.5">
              <button
                type="button"
                onClick={() => zoomBy(-ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                title={zoom <= MIN_ZOOM ? t('comfyuiWorkflowPage.graph.showList') : undefined}
                aria-label={t('comfyuiWorkflowPage.graph.zoomOut')}
                className="grid size-5 place-items-center rounded-full text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40"
              >
                <IconMinus size={12} stroke={2} aria-hidden="true" />
              </button>
              <span className="min-w-[34px] text-center font-nomi-mono text-micro tabular-nums text-nomi-ink-60">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => zoomBy(ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                aria-label={t('comfyuiWorkflowPage.graph.zoomIn')}
                className="grid size-5 place-items-center rounded-full text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40"
              >
                <IconPlus size={12} stroke={2} aria-hidden="true" />
              </button>
              <span className="mx-0.5 h-3 w-px bg-nomi-line" aria-hidden="true" />
              <button
                type="button"
                onClick={fit}
                className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-micro text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink"
              >
                <IconMaximize size={12} stroke={1.8} aria-hidden="true" />{t('comfyuiWorkflowPage.graph.fit')}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 图放不下时的等价第二条路：同样可点、同样能指定角色，只是不画位置。 */
function NodeList({
  nodes,
  bindableIds,
  selectedNodeId,
  onSelect,
  roleChoicesFor,
  fieldChoicesFor,
  onPickRole,
  onClearRole,
  onToggleField,
  onCloseMenu,
}: {
  nodes: PositionedNode[]
  bindableIds: Set<string>
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
  roleChoicesFor: (nodeId: string) => RoleChoice[]
  fieldChoicesFor: (nodeId: string) => FieldChoice[]
  onPickRole: (nodeId: string, choice: RoleChoice) => void
  onClearRole: (role: Exclude<WorkflowRole, 'output'>) => void
  onToggleField: (candidate: WorkflowCandidate) => void
  onCloseMenu: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="h-full overflow-y-auto p-2.5 pb-12" aria-label={t('comfyuiWorkflowPage.graph.listAria')}>
      <div className="flex flex-col gap-1">
        {nodes.map((node) => {
          const tone = node.role ? ROLE_TONES[node.role] : null
          const bindable = bindableIds.has(node.nodeId)
          const selected = selectedNodeId === node.nodeId
          const row = (
            <>
              <span className="w-14 shrink-0 font-nomi-mono text-micro text-nomi-ink-40">#{node.nodeId}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-nomi-ink">{translateModelDisplayText(node.title)}</span>
              <span className="hidden min-w-0 shrink-[2] truncate font-nomi-mono text-micro text-nomi-ink-40 sm:block">{node.classType}</span>
              {node.exposedCount > 0 ? (
                <span className="shrink-0 rounded-full bg-nomi-accent-soft px-1.5 text-micro font-semibold text-nomi-accent">
                  {t('comfyuiWorkflowPage.graph.exposedBadge', { count: node.exposedCount })}
                </span>
              ) : null}
              {tone ? (
                <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-micro font-semibold', tone.soft, tone.text)}>
                  <tone.Icon size={11} stroke={2} aria-hidden="true" />{t(tone.labelKey)}
                </span>
              ) : null}
            </>
          )
          return (
            <div key={node.nodeId} className="relative">
              {bindable ? (
                <button
                  type="button"
                  data-node-id={node.nodeId}
                  onClick={() => onSelect(node.nodeId)}
                  aria-haspopup="menu"
                  aria-expanded={selected}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-nomi-sm border px-2 py-1.5 text-left',
                    selected ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line bg-nomi-paper hover:border-nomi-accent',
                  )}
                >
                  {row}
                </button>
              ) : (
                <div
                  data-node-id={node.nodeId}
                  title={t('comfyuiWorkflowPage.graph.unbindableTitle')}
                  className="flex w-full items-center gap-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1.5 opacity-60"
                >
                  {row}
                </div>
              )}
              {selected ? (
                <WorkflowNodeMenu
                  nodeId={node.nodeId}
                  position={{ x: 8, y: 34 }}
                  roleChoices={roleChoicesFor(node.nodeId)}
                  fieldChoices={fieldChoicesFor(node.nodeId)}
                  onPickRole={(choice) => onPickRole(node.nodeId, choice)}
                  onClearRole={onClearRole}
                  onToggleField={onToggleField}
                  onClose={onCloseMenu}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
