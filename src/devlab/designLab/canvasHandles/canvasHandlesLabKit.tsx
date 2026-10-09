// 设计实验室 · 屏「画布 · 左右拉环与空节点『试试』」的取景台（10-08 用户拍板，实现后改挂生产）。
//
// 这一屏现在**只挂生产**：真 React Flow 内核 + 生产 nodeTypes（拉环两侧由种类定义的 `connects` 决定、点「+」出菜单、
// 空节点「试试」都是节点本体自己画的）；菜单是生产 `NodeDeriveMenu`，判据是生产 `connectionMenuVerdicts`，
// 打开它走的是生产把手的点击（取景台在把手上点一下，和用户一样）；点选模式是生产 `CanvasPickModeLayer` /
// `CanvasPickModeDim` + `pickCanvasInputFor`；空画布那格挂现役 `GenerationCanvas` 本体。取景台不再改 DOM、不留提案版。
import React, { type JSX } from 'react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import { nodeTypes, edgeTypes } from '../../../workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes'
import { toGenerationFlowNodes } from '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter'
import { GenerationFlowHandleMenuScope, type GenerationFlowHandleMenuRequest } from '../../../workbench/generationCanvas/reactFlow/generationFlowNodeContext'
import { connectionMenuVerdicts } from '../../../workbench/generationCanvas/quickActions/connectionMenuModel'
import GenerationCanvas from '../../../workbench/generationCanvas/components/GenerationCanvas'
import { CanvasPickModeDim, CanvasPickModeLayer } from '../../../workbench/generationCanvas/components/CanvasPickModeLayer'
import { NodeDeriveMenu } from '../../../workbench/generationCanvas/quickActions/NodeDeriveMenu'
import { pickCanvasInputFor } from '../../../workbench/generationCanvas/quickActions/nodeInputActions'
import { cancelCanvasPickMode } from '../../../workbench/generationCanvas/store/canvasPickMode'
import type { GenerationCanvasNode, GenerationNodeKind } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { STREET_FRAME } from '../nodeQuickActions/nodeQuickActionsLabKit'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'

export const CANVAS_HANDLES_CELL_WIDTH = 1100
export const CANVAS_HANDLES_CELL_HEIGHT = 620

export type LabLocale = 'zh-CN' | 'en'
const noop = (): void => undefined

// ── 夹具 ─────────────────────────────────────────────────────────────────────

const PORTRAIT_FRAME = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#d9cfc0"/><rect y="250" width="640" height="110" fill="#b9a68c"/>
  <circle cx="320" cy="130" r="54" fill="#e6c3a0"/><path d="M226 330 q94 -150 188 0 z" fill="#5a6b7d"/>
  <path d="M266 110 q54 -80 108 0 q-8 -50 -54 -54 q-46 4 -54 54z" fill="#3a2b22"/></svg>`)

type Fixture = { id: string; kind: GenerationNodeKind; x: number; y: number; title: string; frame?: string; resultType?: 'image' | 'video'; width?: number; height?: number }

function fixtureNode(input: Fixture): GenerationCanvasNode {
  const result = input.frame
    ? { id: `${input.id}-r`, type: input.resultType ?? 'image', url: input.frame, thumbnailUrl: input.frame, createdAt: 1 }
    : undefined
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    categoryId: 'shots',
    position: { x: input.x, y: input.y },
    size: { width: input.width ?? 300, height: input.height ?? 169 },
    status: result ? 'success' : 'idle',
    prompt: '',
    ...(result ? { result, history: [result] } : {}),
    meta: input.kind === 'image' || input.kind === 'asset' ? { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9 } : {},
  } as unknown as GenerationCanvasNode
}

/** 框外标签行的标题（按 id，中 / 英）。剪辑与文本卡的标题在卡头里自带，不在这张表里。 */
const TITLES: Record<string, [string, string]> = {
  'h-gen': ['镜头 1 · 雨夜街口', 'Shot 1 · Rainy street'],
  'h-asset': ['主角定妆照', 'Lead portrait'],
  'h-empty-image': ['镜头 2', 'Shot 2'],
  'h-empty-video': ['镜头 3', 'Shot 3'],
}

export const FIXTURES = {
  genImage: (x = 150, y = 150) => fixtureNode({ id: 'h-gen', kind: 'image', x, y, title: '', frame: STREET_FRAME }),
  asset: (x = 640, y = 150) => fixtureNode({ id: 'h-asset', kind: 'asset', x, y, title: '', frame: PORTRAIT_FRAME }),
  emptyImage: (x = 380, y = 110) => fixtureNode({ id: 'h-empty-image', kind: 'image', x, y, title: '', width: 340, height: 191 }),
  emptyVideo: (x = 380, y = 110) => fixtureNode({ id: 'h-empty-video', kind: 'video', x, y, title: '', width: 340, height: 191 }),
  emptyText: (x = 360, y = 120) => fixtureNode({ id: 'h-empty-text', kind: 'text', x, y, title: '', width: 320, height: 220 }),
  emptyClip: (x = 260, y = 140) => fixtureNode({ id: 'h-empty-clip', kind: 'clip', x, y, title: '', width: 560, height: 240 }),
}

/** 每帧试一次 `apply`，直到它说「好了」；期间按住实验室就绪旗。 */
function useWhenMounted(apply: (() => boolean) | null, deps: readonly unknown[]): void {
  React.useLayoutEffect(() => {
    if (!apply) return undefined
    const release = holdDesignLabReady('canvas-handles:dom')
    let frame = 0
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (apply()) { requestAnimationFrame(() => requestAnimationFrame(release)); return }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelled = true; cancelAnimationFrame(frame); release() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方给（与 apply 的闭包同源）
  }, deps)
}

const nodeEl = (root: HTMLElement | null, id: string): HTMLElement | null =>
  root?.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) ?? null

// ── 节点取景台 ────────────────────────────────────────────────────────────────

export type HandlesStageProps = {
  locale?: LabLocale
  nodes: GenerationCanvasNode[]
  selectedId?: string
  /** 像用户一样在选中卡这一侧的「+」上点一下（走生产把手的点击 → 生产菜单）。 */
  menu?: 'left' | 'right'
  /** 对这张卡进「在画布上点选」（生产 pickCanvasInputFor）。 */
  pickFor?: string
  width?: number
  height?: number
}

export function HandlesStage({ locale = 'zh-CN', nodes, selectedId, menu, pickFor, width = CANVAS_HANDLES_CELL_WIDTH, height = CANVAS_HANDLES_CELL_HEIGHT }: HandlesStageProps): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const localeReady = useLabLocale(locale)
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    const release = holdDesignLabReady('canvas-handles:composer')
    void COMPOSER_CHUNK.then(() => { setChunkReady(true); release() })
    return release
  }, [])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    const zh = locale === 'zh-CN'
    useGenerationCanvasStore.setState({ nodes: nodes.map((node) => ({ ...node, title: node.title || (zh ? TITLES[node.id]?.[0] : TITLES[node.id]?.[1]) || '' })), edges: [], selectedNodeIds: selectedId ? [selectedId] : [] })
    setSeeded(true)
  }, [locale, nodes, selectedId])
  const liveNodes = useGenerationCanvasStore((state) => state.nodes)
  const selectedIds = React.useMemo(() => new Set(selectedId ? [selectedId] : []), [selectedId])
  const flowNodes = React.useMemo(() => toGenerationFlowNodes(liveNodes, selectedIds, false), [liveNodes, selectedIds])
  const ready = seeded && localeReady && chunkReady

  const rootRef = React.useRef<HTMLDivElement>(null)
  const [opened, setOpened] = React.useState<GenerationFlowHandleMenuRequest | null>(null)
  React.useEffect(() => () => { cancelCanvasPickMode() }, [])

  useWhenMounted(ready ? () => {
    const root = rootRef.current
    if (!root || nodes.some((node) => !nodeEl(root, node.id))) return false
    if (menu && selectedId && !opened) {
      const hit = nodeEl(root, selectedId)?.querySelector<HTMLElement>(`.generation-canvas-react-flow__handle--source[data-side="${menu}"] .generation-canvas-react-flow__handle-hit`)
      if (!hit || hit.getBoundingClientRect().width === 0) return false
      hit.click()
      return false
    }
    if (pickFor) pickCanvasInputFor(pickFor)
    return true
  } : null, [ready, menu, selectedId, nodes, opened, pickFor])

  const openedNode = opened ? liveNodes.find((node) => node.id === opened.nodeId) : undefined
  return (
    <div
      ref={rootRef}
      data-design-lab-stage="canvas-handles"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width, height }}
    >
      {ready ? (
        <ReactFlowProvider>
          <GenerationFlowHandleMenuScope open={setOpened}>
            <div className="generation-canvas-react-flow generation-canvas-v2__stage group/canvas relative h-full w-full bg-workbench-bg text-workbench-ink">
              <ReactFlow
                nodes={flowNodes}
                edges={[]}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                nodesDraggable={false}
                panOnDrag={false}
                zoomOnScroll={false}
                zoomOnDoubleClick={false}
                elevateNodesOnSelect={false}
                proOptions={{ hideAttribution: true }}
              >
                <CanvasPickModeDim />
              </ReactFlow>
              <CanvasPickModeLayer />
            </div>
          </GenerationFlowHandleMenuScope>
        </ReactFlowProvider>
      ) : null}
      {opened && openedNode ? (
        <NodeDeriveMenu
          side={opened.side}
          target={opened.side === 'left' ? openedNode : undefined}
          verdicts={connectionMenuVerdicts({ nodeId: opened.nodeId, side: opened.side, sourceKind: 'node' })}
          point={{ x: opened.clientX, y: opened.clientY }}
          onPick={noop}
          onFromAssets={noop}
          onPickOnCanvas={noop}
          onClose={noop}
        />
      ) : null}
    </div>
  )
}

// ── 空画布：现役 GenerationCanvas 本体（空态 = 一排任务卡，生产 CanvasEmptyState）─────────────────

export function EmptyCanvasStage({ locale = 'zh-CN' }: { locale?: LabLocale }): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const localeReady = useLabLocale(locale)
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots', categoryViewports: { shots: { zoom: 1, offset: { x: 0, y: 0 } } } as never })
    useGenerationCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: [], isReady: true })
    setSeeded(true)
  }, [])
  return (
    <div data-design-lab-stage="canvas-handles-empty" className="relative overflow-hidden rounded-nomi border border-nomi-line" style={{ width: CANVAS_HANDLES_CELL_WIDTH, height: CANVAS_HANDLES_CELL_HEIGHT }}>
      {seeded && localeReady ? <GenerationCanvas /> : null}
    </div>
  )
}
