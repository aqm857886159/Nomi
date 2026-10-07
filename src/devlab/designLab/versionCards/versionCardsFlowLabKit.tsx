// 设计实验室 · 版本卡片入口方案 A 的取景台：节点挂在**真的 React Flow 画布内核**里。
//
// 为什么不用 versionCardsLabKit 那种「裸节点」取景：连线把手（左右小圆点 / 选中后的「+」吸附区）是内核的 Handle，
// 离开 <ReactFlow> 渲染不出来——上一版样张就是因为没有把手，叠卡往右露、正好压在把手上的冲突没暴露（10-06 真画布实测）。
// 这里节点外壳、把手、选中后的生成框都是现役组件；只多一层**标注**（虚线框 + 小字），标出把手的吸附区和叠卡入口各占哪块，
// 标注只在实验室画，产品里没有。
import React, { type JSX } from 'react'
import { ReactFlow, ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css'
import '../../../workbench/generationCanvas/styles/generationCanvas.css'
import i18n from '../../../i18n'
import { nodeTypes, edgeTypes } from '../../../workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes'
import { toGenerationFlowNodes } from '../../../workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { VERSION_CARDS_CELL_HEIGHT, VERSION_CARDS_CELL_WIDTH } from './versionCardsLabKit'


const NO_EDGES: never[] = []

function frame(versionNo: number): string {
  const hue = [210, 28, 160, 330][(versionNo - 1) % 4]
  const body = `
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 32%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 35% 18%)"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="40" y="96" width="120" height="200" fill="hsl(${hue} 20% 14%)"/>
    <rect x="456" y="70" width="140" height="220" fill="hsl(${hue} 18% 12%)"/>
    <circle cx="322" cy="110" r="38" fill="hsl(${(hue + 180) % 360} 70% 78%)" opacity=".85"/>
    <rect y="290" width="640" height="70" fill="hsl(${hue} 25% 10%)"/>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`)
}

function result(nodeId: string, versionNo: number): GenerationNodeResult {
  const url = frame(versionNo)
  return { id: `${nodeId}-v${versionNo}`, type: 'image', url, thumbnailUrl: url, createdAt: versionNo, versionNo }
}

function sourceNode(input: { size: { width: number; height: number }; count: number; title: string }): GenerationCanvasNode {
  const history = Array.from({ length: input.count }, (_, index) => result('vc-entry', input.count - index))
  return {
    id: 'vc-entry',
    kind: 'image',
    title: input.title,
    categoryId: 'shots',
    position: { x: 200, y: 120 },
    size: { ...input.size },
    status: 'success',
    prompt: '',
    result: history[0],
    history,
    resultVersionMax: input.count,
    meta: { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9 },
  } as GenerationCanvasNode
}

function useLabLocale(locale: 'zh-CN' | 'en'): boolean {
  const [ready, setReady] = React.useState(i18n.language === locale)
  React.useLayoutEffect(() => {
    if (i18n.language === locale) { setReady(true); return undefined }
    const release = holdDesignLabReady(`version-entry:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setReady(true); release() })
    return release
  }, [locale])
  return ready
}

type Box = { left: number; top: number; width: number; height: number; tone: 'handle' | 'entry'; label: string }

/** 量出把手吸附区与叠卡入口的实际命中框（相对取景台），画成标注。只读 DOM，不改它。 */
function useAnnotations(rootRef: React.RefObject<HTMLDivElement | null>, ready: boolean, zh: boolean): Box[] {
  const [boxes, setBoxes] = React.useState<Box[]>([])
  React.useEffect(() => {
    if (!ready) return undefined
    const release = holdDesignLabReady('version-entry:annotate')
    let frameId = 0
    let tries = 0
    const tick = (): void => {
      tries += 1
      const root = rootRef.current
      const origin = root?.getBoundingClientRect()
      const hits = [...(root?.querySelectorAll<HTMLElement>('.generation-canvas-react-flow__handle--source .generation-canvas-react-flow__handle-hit') ?? [])]
      const entry = root?.querySelector<HTMLElement>('[data-version-stack-handle]')
      if (origin && entry && hits.length > 0) {
        const rel = (rect: DOMRect): Omit<Box, 'tone' | 'label'> => ({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height })
        setBoxes([
          ...hits.map((hit) => ({ ...rel(hit.getBoundingClientRect()), tone: 'handle' as const, label: zh ? '连线把手命中区' : 'Connect handle hit area' })),
          { ...rel(entry.getBoundingClientRect()), tone: 'entry', label: zh ? '版本入口（点这里铺开）' : 'Versions entry (click to lay out)' },
        ])
        release()
        return
      }
      if (tries > 120) { release(); return }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frameId); release() }
  }, [ready, rootRef, zh])
  return boxes
}

/** 挂载后用真实指针事件悬停叠卡入口（React 的 enter/leave 由 pointerover 推导），摆好才举就绪旗。 */
function useHoverEntry(rootRef: React.RefObject<HTMLDivElement | null>, ready: boolean, enabled: boolean): void {
  React.useEffect(() => {
    if (!ready || !enabled) return undefined
    const release = holdDesignLabReady('version-entry:hover')
    let frameId = 0
    let tries = 0
    const tick = (): void => {
      tries += 1
      const entry = rootRef.current?.querySelector<HTMLElement>('[data-version-stack-handle]')
      entry?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      if (rootRef.current?.querySelector('[data-version-stack-count]') || tries > 120) { release(); return }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frameId); release() }
  }, [enabled, ready, rootRef])
}

export type VersionEntryStageProps = {
  locale?: 'zh-CN' | 'en'
  count?: number
  selected?: boolean
  hover?: boolean
  /** 节点尺寸：常规 320×180；小节点 240×135（选中后吸附区上下都超出节点）。 */
  small?: boolean
  annotate?: boolean
}

export function VersionEntryStage({ locale = 'zh-CN', count = 4, selected = false, hover = false, small = false, annotate = true }: VersionEntryStageProps): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const localeReady = useLabLocale(locale)
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    const release = holdDesignLabReady('version-entry:composer')
    void COMPOSER_CHUNK.then(() => { setChunkReady(true); release() })
    return release
  }, [])
  const zh = locale === 'zh-CN'
  const node = React.useMemo(() => sourceNode({
    size: small ? { width: 240, height: 135 } : { width: 320, height: 180 },
    count,
    title: zh ? '镜头 1 · 雨夜入场' : 'Shot 1 · Night entrance',
  }), [count, small, zh])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    useWorkbenchStore.setState({ activeCategoryId: 'shots' })
    useGenerationCanvasStore.setState({ nodes: [node], edges: [], selectedNodeIds: selected ? [node.id] : [] })
    setSeeded(true)
  }, [node, selected])
  const liveNodes = useGenerationCanvasStore((state) => state.nodes)
  const selectedIds = React.useMemo(() => new Set(selected ? [node.id] : []), [node.id, selected])
  const flowNodes = React.useMemo(() => toGenerationFlowNodes(liveNodes, selectedIds, false), [liveNodes, selectedIds])
  const ready = seeded && localeReady && chunkReady
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  useHoverEntry(rootRef, ready, hover)
  const boxes = useAnnotations(rootRef, ready && annotate, zh)
  return (
    <div
      ref={rootRef}
      data-design-lab-stage="version-entry"
      className="relative overflow-hidden rounded-nomi border border-nomi-line"
      style={{ width: VERSION_CARDS_CELL_WIDTH, height: VERSION_CARDS_CELL_HEIGHT }}
    >
      {ready ? (
        <ReactFlowProvider>
          <div className="generation-canvas-react-flow generation-canvas-v2__stage group/canvas relative h-full w-full bg-workbench-bg text-workbench-ink">
            <ReactFlow
              nodes={flowNodes}
              edges={NO_EDGES}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              nodesDraggable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              elevateNodesOnSelect={false}
              proOptions={{ hideAttribution: true }}
            />
          </div>
        </ReactFlowProvider>
      ) : null}
      {boxes.map((box, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={box.tone === 'handle'
            ? 'pointer-events-none absolute z-[30] rounded-nomi-sm border border-dashed border-nomi-danger/70 bg-nomi-danger-soft/30'
            : 'pointer-events-none absolute z-[30] rounded-nomi-sm border-2 border-dashed border-nomi-accent bg-nomi-accent-soft/40'}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <span className={box.tone === 'handle'
            ? 'absolute left-1 top-1 whitespace-nowrap rounded-nomi-sm bg-nomi-paper px-1 text-micro text-nomi-danger'
            : 'absolute left-0 top-[calc(100%+4px)] whitespace-nowrap rounded-nomi-sm bg-nomi-paper px-1 text-micro font-semibold text-nomi-accent'}
          >
            {box.label}
          </span>
        </div>
      ))}
    </div>
  )
}
