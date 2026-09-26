import React from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { MantineProvider, Slider } from '@mantine/core'
import { ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, applyNodeChanges, type Node, type NodeProps } from '@xyflow/react'
import '@mantine/core/styles.css'
import '@xyflow/react/dist/style.css'
import { AnchoredPopover } from '../../../src/design/AnchoredPopover'
import { NomiSelect } from '../../../src/design/NomiSelect'
import { lazyWithChunkBoundary } from '../../../src/ui/chunkBoundary'
import { useGenerationCanvasReactFlowPointer } from '../../../src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowPointer'
import { beginCanvasDragging, cancelCanvasDraggingWithin, CANVAS_DRAGGING_OWNER } from '../../../src/workbench/generationCanvas/components/canvasDraggingFlag'
import { composerCanvasPlacement } from '../../../src/workbench/generationCanvas/nodes/composerCanvasPlacement'
import { useWorkbenchStore } from '../../../src/workbench/workbenchStore'
import { useNodeResultHistory } from '../../../src/workbench/generationCanvas/nodes/useNodeResultHistory'

import { syncCanvasNodeProjection } from '../../../src/workbench/generationCanvas/reactFlow/canvasNodeProjectionSync'
import { applyCanvasDragKernelPositionChanges } from '../../../src/workbench/generationCanvas/reactFlow/canvasDragDraft'
import type { GenerationFlowNode, GenerationFlowEdge } from '../../../src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter'

let loaded = false
let reloads = 0
let calls = 0
let failFirstImport: (() => void) | undefined
Object.assign(window, { nomiDesktop: { app: { hardReloadWindow: () => { reloads++ } } } })
const Composer = lazyWithChunkBoundary('composer', () => {
  calls++
  if (calls === 1) return new Promise<{ default: () => JSX.Element }>((_, reject) => { failFirstImport = () => reject(new TypeError('Failed to fetch dynamically imported module')) })
  return loaded ? Promise.resolve({ default: () => <span data-loaded>composer ready</span> }) : Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
})
const gestureState = { remembers: 0, viewport: { x: 0, y: 0, zoom: 1 } }
const flow = { getViewport: () => gestureState.viewport, setViewport: async (next: typeof gestureState.viewport) => { gestureState.viewport = next; return true } }
const remember = () => { gestureState.remembers++ }
const setViewport = () => {}
function PanHarness({ readOnly }: { readOnly: boolean }) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const pan = useGenerationCanvasReactFlowPointer({ readOnly, hostRef, flow, activeCategoryId: 'fixture', rememberCategoryViewport: remember, setLiveViewport: setViewport })
  return <div id="stage" className="generation-canvas-v2__stage" ref={hostRef}
    onPointerDownCapture={pan.handleCanvasPointerDownCapture} onPointerDown={pan.handleCanvasPointerDown}
    onPointerMoveCapture={pan.handleCanvasPointerMoveCapture} onPointerMove={pan.handleCanvasPointerMove}
    onPointerUp={pan.handleCanvasPointerEnd} onPointerCancel={pan.handleCanvasPointerEnd} onWheelCapture={pan.handleCanvasWheelCapture}>
    <div className="react-flow__pane" style={{ width: 400, height: 200 }}>pan fixture</div>
  </div>
}
function GestureHarness() {
  const [readOnly, setReadOnly] = React.useState(false)
  const [mounted, setMounted] = React.useState(true)
  const [hidden, setHidden] = React.useState(false)
  // 和 WorkbenchShell 的 WorkspaceSlot 同一段：槽位藏起来 = 里面的手势被打断，
  // 由**宿主**显式喊一声（画布那边因此不用给每次手势装一个扫祖先链的 MutationObserver）。
  const slot = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (hidden) cancelCanvasDraggingWithin(slot.current) }, [hidden])
  return <><button id="readonly" onClick={() => setReadOnly(value => !value)}>readonly</button>
    <button id="unmount" onClick={() => setMounted(value => !value)}>mount</button>
    <button id="hidden" onClick={() => setHidden(value => !value)}>hidden</button>
    <div ref={slot} hidden={hidden}>{mounted && <PanHarness readOnly={readOnly} />}</div></>
}
const TOOLBAR_HEIGHT = 40
function PlacementHarness() {
  const zoom = useWorkbenchStore((state) => state.categoryViewports[state.activeCategoryId]?.zoom ?? 1)
  const placement = composerCanvasPlacement({ width: 320, height: 200 }, zoom)
  // 节点靠底 / 挂上浮动工具条：2026-09-25 起浮框对这两件都**不**做反应（钉在节点下、被挡就挡）。
  const [toolbar, setToolbar] = React.useState(false)
  return <div className="workbench-generation">
    <button id="geometry-toolbar" onClick={() => setToolbar(value => !value)}>toolbar</button>
    <div id="geometry-stage" className="generation-canvas-v2__stage" style={{ position: 'relative', width: 1000, height: 800 }}>
    <div className="generation-canvas-v2-node" style={{ position: 'absolute', left: 100, top: 100, width: 320, height: 200, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
      {toolbar ? <div data-node-floating-toolbar="true" style={{ position: 'absolute', left: 0, top: -TOOLBAR_HEIGHT, width: 320, height: TOOLBAR_HEIGHT }}>toolbar</div> : null}
      <div style={{ position: 'absolute', ...placement }}>
        <div id="geometry-card" className="generation-canvas-v2-node__composer-card" style={{ width: '100%', height: 200, position: 'relative' }}>controls<button id="geometry-action" style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: 32 }} onClick={event => { event.currentTarget.dataset.clicks = String(Number(event.currentTarget.dataset.clicks ?? 0) + 1) }}>parameter action</button></div>
      </div>
    </div>
  </div></div>
}
type EscapeFixtureNode = Node<Record<string, never>, 'escape-fixture'>
function EscapeNode({ selected }: NodeProps<EscapeFixtureNode>) {
  const [open, setOpen] = React.useState(false)
  const [documentChild, setDocumentChild] = React.useState<'menu' | 'dialog' | null>(null)
  const [choice, setChoice] = React.useState('one')
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  const popoverRef = React.useRef<HTMLDivElement>(null)
  const close = React.useCallback(() => {
    setOpen(false)
    anchorRef.current?.focus()
  }, [])
  React.useEffect(() => {
    if (!documentChild) return undefined
    const closeChild = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setDocumentChild(null)
    }
    document.addEventListener('keydown', closeChild)
    return () => document.removeEventListener('keydown', closeChild)
  }, [documentChild])
  return <div data-escape-node data-selected={selected ? 'true' : 'false'}>
    {selected ? <div data-escape-composer>
      <button ref={anchorRef} type="button" data-escape-anchor onClick={() => setOpen(true)}>open popover</button>
      {open ? <AnchoredPopover anchorRef={anchorRef} onClose={close}>
        <div ref={popoverRef} role="dialog" aria-label="escape fixture" data-escape-popover>
          <input data-escape-input autoFocus aria-label="popover input" />
          <button type="button" data-escape-button>portal button</button>
          <button type="button" data-open-document-menu onClick={() => setDocumentChild('menu')}>open document menu</button>
          <button type="button" data-open-higher-dialog onClick={() => setDocumentChild('dialog')}>open higher dialog</button>
          <button type="button" data-escape-prevent onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault()
          }}>child owns escape</button>
          <NomiSelect
            ariaLabel="nested select"
            searchable
            portalTarget={popoverRef}
            value={choice}
            options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]}
            onChange={setChoice}
          />
        </div>
      </AnchoredPopover> : null}
    </div> : null}
    {documentChild ? createPortal(<div role={documentChild} data-document-child={documentChild}
      style={{ position: 'fixed', zIndex: 9300, top: 0, left: 0, width: 100, height: 100 }}>child layer</div>, document.body) : null}
  </div>
}
const escapeNodeTypes = { 'escape-fixture': EscapeNode }
function EscapeOwnershipHarness() {
  const [hostEscapes, setHostEscapes] = React.useState(0)
  const [nodes, setNodes] = React.useState<EscapeFixtureNode[]>([
    { id: 'escape-node', type: 'escape-fixture', position: { x: 80, y: 60 }, data: {}, selected: true },
  ])
  return <MantineProvider>
    <button type="button" data-escape-outside>outside focus</button>
    <div data-escape-host onKeyDown={(event) => {
    if (event.key === 'Escape') setHostEscapes((count) => count + 1)
  }}>
    <output data-host-escapes>{hostEscapes}</output>
    <div style={{ width: 640, height: 360 }}>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={escapeNodeTypes}
        onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        deleteKeyCode={null} fitView />
    </div>
    </div>
  </MantineProvider>
}

function ProjectionSliderNode({ data }: NodeProps<GenerationFlowNode>) {
  return <div className="nokey"><Slider thumbLabel="projection duration" min={4} max={15} step={1}
    value={Number(data.generationNode.meta?.duration)}
    onChange={(duration) => (data as typeof data & { change: (value: number) => void }).change(duration)} /></div>
}
const projectionNodeTypes = { generation: ProjectionSliderNode }
function ProjectionKeyboardHarness() {
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const store = useStoreApi<GenerationFlowNode, GenerationFlowEdge>()
  const [duration, setDuration] = React.useState(5)
  const nodes = React.useMemo<GenerationFlowNode[]>(() => [{ id: 'projection-node', type: 'generation',
    position: { x: 40, y: 40 }, selected: true, style: { width: 240 },
    data: { generationNode: { id: 'projection-node', kind: 'video', title: 'video', position: { x: 40, y: 40 }, meta: { duration } },
      readOnly: false, primarySelection: true, appear: false, focusFlash: false, change: setDuration } }], [duration])
  React.useEffect(() => {
    Object.assign(window, { projectionSnapshot: () => {
      const state = store.getState()
      return { ownsNodes: state.hasDefaultNodes, position: state.nodeLookup.get('projection-node')?.position }
    } })
  }, [store])
  const previous = React.useRef<readonly GenerationFlowNode[] | null>(null)
  React.useEffect(() => syncCanvasNodeProjection(flow, nodes, previous, false), [flow, nodes])
  return <><output data-projection-duration>{duration}</output><div style={{ width: 640, height: 240 }}>
    <ReactFlow defaultNodes={nodes} nodeTypes={projectionNodeTypes}
      onNodesChange={(changes) => applyCanvasDragKernelPositionChanges(store, changes)} />
  </div></>
}


type HistoryProjectionData = GenerationFlowNode['data'] & { choose: (id: string) => void; available: boolean }
function ProjectedHistoryNode({ id, data, selected }: NodeProps<GenerationFlowNode>) {
  const historyData = data as HistoryProjectionData
  const [open, setOpen] = useNodeResultHistory({ id, kind: data.generationNode.kind, selected: Boolean(selected), available: historyData.available })
  return <div data-projected-history={id} data-selected={String(selected)}>
    <button data-history-trigger onPointerDown={event => event.stopPropagation()} onClick={event => {
      event.stopPropagation()
      if (!open) historyData.choose(id)
      setOpen(!open)
    }}>versions</button>
    {open ? <div data-projected-tray>history</div> : null}
  </div>
}
const historyProjectionNodeTypes = { generation: ProjectedHistoryNode }
function HistoryProjectionHarness() {
  const flow = useReactFlow<GenerationFlowNode, GenerationFlowEdge>()
  const [selectedId, choose] = React.useState('')
  const [available, setAvailable] = React.useState(true)
  const nodes = React.useMemo<GenerationFlowNode[]>(() => ['history-a', 'history-b'].map((id, index) => ({
    id, type: 'generation', position: { x: 30 + index * 250, y: 30 }, selected: selectedId === id,
    data: { generationNode: { id, kind: 'video', title: id, position: { x: 30 + index * 250, y: 30 } },
      readOnly: false, primarySelection: selectedId === id, appear: false, focusFlash: false, choose, available },
  })), [selectedId, available])
  const previous = React.useRef<readonly GenerationFlowNode[] | null>(null)
  React.useEffect(() => syncCanvasNodeProjection(flow, nodes, previous, false), [flow, nodes])
  return <><button data-history-availability onClick={() => setAvailable(value => !value)}>availability</button>
    <button data-history-deselect onClick={() => choose('')}>deselect</button>
    <div style={{ width: 640, height: 200 }}><ReactFlow defaultNodes={nodes} nodeTypes={historyProjectionNodeTypes} /></div></>
}

function Harness() {
  const [selected, select] = React.useState(true)
  const [available, availability] = React.useState(true)
  const [kind, type] = React.useState('image')
  const [id, identity] = React.useState('a')
  const [open, setOpen] = useNodeResultHistory({ id, kind, available, selected })
  return <>
    <input id="unpublished-draft" defaultValue="unpublished" />
    <button id="select" onClick={() => select(value => !value)}>selection</button>
    <button id="available" onClick={() => availability(value => !value)}>results</button>
    <button id="kind" onClick={() => type('video')}>type</button>
    <button id="identity" onClick={() => identity(value => value === 'a' ? 'b' : 'a')}>identity</button>
    <button id="history" onClick={() => { select(true); setOpen(true) }}>{open ? 'history' : 'composer'}</button>
    <React.Suspense fallback={<span role="status">pending</span>}><Composer /></React.Suspense>
    <GestureHarness />
    <PlacementHarness />
    <EscapeOwnershipHarness />
    <ReactFlowProvider><HistoryProjectionHarness /></ReactFlowProvider>
    <MantineProvider><ReactFlowProvider><ProjectionKeyboardHarness /></ReactFlowProvider></MantineProvider>
  </>
}
Object.assign(window, { composerFixture: { fail: () => failFirstImport?.(), load: () => { loaded = true }, snapshot: () => ({ calls, reloads }), gesture: () => gestureState,
  zoom: (zoom: number) => useWorkbenchStore.setState(state => ({ categoryViewports: { ...state.categoryViewports, [state.activeCategoryId]: { zoom, offset: { x: 0, y: 0 } } } })),
  holdOther: () => {
    const stage = document.createElement('div'); stage.id = 'other-stage'; stage.className = 'generation-canvas-v2__stage'; document.body.append(stage)
    const lease = beginCanvasDragging(stage, CANVAS_DRAGGING_OWNER.node)
    return () => lease.release()
  } } })
createRoot(document.getElementById('root')!).render(<Harness />)
