// 设计实验室 · 版本入口（右上角数字角标，用户 2026-10-07 拍板）的取景台：节点挂在**真的 React Flow 画布内核**里。
//
// 为什么不用 versionCardsLabKit 那种「裸节点」取景：连线把手（左右小圆点 / 选中后的「+」吸附区）是内核的 Handle，
// 离开 <ReactFlow> 渲染不出来——10-06 叠卡往右露、正好压在把手上的冲突，就是因为样张里没有把手才没暴露。
// 这里节点外壳、把手、选中后的浮条和生成框、铺开的宫格都是现役组件；夹具只给数据（几版、是不是视频、选没选中、铺没铺开）。
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

/** 每一版一个色调；`light` 版本是浅色画面，用来看角标在浅图上清不清楚。 */
function frame(versionNo: number, light: boolean): string {
  const hue = [210, 28, 160, 330, 260, 95][(versionNo - 1) % 6]
  const top = light ? `hsl(${hue} 40% 92%)` : `hsl(${hue} 45% 32%)`
  const bottom = light ? `hsl(${(hue + 40) % 360} 35% 80%)` : `hsl(${(hue + 40) % 360} 35% 18%)`
  const body = `
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect x="40" y="96" width="120" height="200" fill="hsl(${hue} 20% ${light ? 70 : 14}%)"/>
    <rect x="456" y="70" width="140" height="220" fill="hsl(${hue} 18% ${light ? 66 : 12}%)"/>
    <circle cx="322" cy="110" r="38" fill="hsl(${(hue + 180) % 360} 70% ${light ? 60 : 78}%)" opacity=".85"/>
    <rect y="290" width="640" height="70" fill="hsl(${hue} 25% ${light ? 74 : 10}%)"/>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">${body}</svg>`)
}

function result(nodeId: string, versionNo: number, kind: 'image' | 'video', light: boolean): GenerationNodeResult {
  const poster = frame(versionNo, light)
  // 视频版本：url 指向一个实验室里不存在的视频，节点和卡只用封面——实验室不依赖机器上的素材。
  return kind === 'video'
    ? { id: `${nodeId}-v${versionNo}`, type: 'video', url: `nomi-lab://video/${nodeId}-${versionNo}.mp4`, thumbnailUrl: poster, createdAt: versionNo, versionNo }
    : { id: `${nodeId}-v${versionNo}`, type: 'image', url: poster, thumbnailUrl: poster, createdAt: versionNo, versionNo }
}

function sourceNode(input: { count: number; title: string; kind: 'image' | 'video'; expanded: boolean; light: boolean }): GenerationCanvasNode {
  const history = Array.from({ length: input.count }, (_, index) => result('vc-entry', input.count - index, input.kind, input.light))
  return {
    id: 'vc-entry',
    kind: input.kind,
    title: input.title,
    categoryId: 'shots',
    position: { x: 160, y: 120 },
    size: { width: 320, height: 180 },
    status: 'success',
    prompt: '',
    result: history[0],
    history,
    resultVersionMax: input.count,
    ...(input.expanded ? { resultStackOpen: true, resultStackSide: 'right' as const } : {}),
    meta: input.kind === 'video'
      ? { videoWidth: 1280, videoHeight: 720, videoAspectRatio: 16 / 9 }
      : { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9 },
  } as GenerationCanvasNode
}

export function useLabLocale(locale: 'zh-CN' | 'en'): boolean {
  const [ready, setReady] = React.useState(i18n.language === locale)
  React.useLayoutEffect(() => {
    if (i18n.language === locale) { setReady(true); return undefined }
    const release = holdDesignLabReady(`version-entry:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setReady(true); release() })
    return release
  }, [locale])
  return ready
}

export type VersionEntryStageProps = {
  locale?: 'zh-CN' | 'en'
  count?: number
  kind?: 'image' | 'video'
  selected?: boolean
  expanded?: boolean
  /** 浅色画面：看角标在浅图上清不清楚。 */
  light?: boolean
}

export function VersionEntryStage({ locale = 'zh-CN', count = 4, kind = 'image', selected = false, expanded = false, light = false }: VersionEntryStageProps): JSX.Element {
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
    count,
    kind,
    expanded,
    light,
    title: kind === 'video' ? (zh ? '镜头 2 · 推近' : 'Shot 2 · Push in') : (zh ? '镜头 1 · 雨夜入场' : 'Shot 1 · Night entrance'),
  }), [count, expanded, kind, light, zh])
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
  return (
    <div
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
    </div>
  )
}
