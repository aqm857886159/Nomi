// 设计实验室 · 屏「视频节点的下一步」· 结果落在画布上的几格（真画布本体）。
//
// 这一族挂的是现役 `GenerationCanvas`（React Flow 内核 + 生产节点 / 连线 / 编组框 / 错误卡 / 处理中遮罩），
// 数据是种进 store 的夹具节点——和用户点了「截当前帧 / 确认剪辑 / 拆成视频片段」之后画布里真会出现的东西同一个形状：
//   · 新卡落在原视频右侧（`extractVideoFrameToNode` 的落位：源右缘 + 64），连一根线，原视频原样不动；
//   · 拆成视频片段：一组卡 + 现役编组框，位置用生产的 `shotCutNodePositions`；
//   · 失败：新卡是 `status: 'error'` 的卡，错误卡是生产的 `NodeErrorReport`；
//   · 处理中：新卡顶上一条进度 + 取消，是深度提取同一条（`GeneratingOverlay` 顶条，生产已有）。
//
// 视频卡没选中时画布只画封面（生产的 `NodeVideoPlaybackGuard`），所以这些卡不需要真视频文件。
import React, { type JSX } from 'react'
import GenerationCanvas from '../../../workbench/generationCanvas/components/GenerationCanvas'
import { shotCutNodePositions } from '../../../workbench/generationCanvas/nodes/shotCutSelection'
import { videoDepthProgressPhase } from '../../../workbench/generationCanvas/videoDepth/videoDepthProgressPhase'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useNodeLivePreviewStore } from '../../../workbench/generationCanvas/store/nodeLivePreviewStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { useLabLocale } from '../versionCards/versionCardsFlowLabKit'
import { COPY, timecode, type VnLocale } from './videoNodeNextCopy'
import { CUT_SECONDS, DURATION_SECONDS, FRAME, PLAYHEAD_SECONDS, SEGMENT_POSTERS, TRIM_IN_SECONDS, TRIM_OUT_SECONDS, VIDEO } from './videoNodeNextFixtures'

export type CanvasScene = 'frame-done' | 'frame-failed' | 'trim-running' | 'trim-done' | 'trim-failed' | 'split-done'

const SIZE = { width: 340, height: 191 } as const
const SOURCE_AT = { x: 70, y: 180 } as const
/** 落位：源右缘 + 64（与 extractVideoFrameToNode 同）。 */
const RESULT_AT = { x: SOURCE_AT.x + SIZE.width + 64, y: SOURCE_AT.y } as const

function videoNode(input: { id: string; title: string; position: { x: number; y: number }; poster: string; extra?: Partial<GenerationCanvasNode> }): GenerationCanvasNode {
  return {
    id: input.id,
    kind: 'video',
    title: input.title,
    categoryId: 'shots',
    position: input.position,
    size: { ...SIZE },
    status: 'success',
    meta: { videoWidth: 640, videoHeight: 360, videoAspectRatio: 16 / 9 },
    result: { id: `${input.id}-r`, type: 'video', url: VIDEO, thumbnailUrl: input.poster, createdAt: 1 },
    ...input.extra,
  } as GenerationCanvasNode
}

function imageNode(input: { id: string; title: string; position: { x: number; y: number }; extra?: Partial<GenerationCanvasNode> }): GenerationCanvasNode {
  return {
    id: input.id,
    kind: 'image',
    title: input.title,
    categoryId: 'shots',
    position: input.position,
    size: { ...SIZE },
    status: 'success',
    meta: { imageWidth: 480, imageHeight: 270, imageAspectRatio: 16 / 9 },
    ...input.extra,
  } as GenerationCanvasNode
}

type Seed = { nodes: GenerationCanvasNode[]; edges: { id: string; source: string; target: string }[]; groupOf?: { name: string; memberIds: string[] } }

function seedFor(scene: CanvasScene, locale: VnLocale): Seed {
  const c = COPY[locale]
  const source = videoNode({ id: 'vn-source', title: c.sourceTitle, position: SOURCE_AT, poster: FRAME.current })
  const link = (target: string) => ({ id: `vn-edge-${target}`, source: 'vn-source', target })
  switch (scene) {
    case 'frame-done': {
      const frame = imageNode({
        id: 'vn-frame',
        title: c.frameTitle(c.sourceTitle, timecode(PLAYHEAD_SECONDS)),
        position: RESULT_AT,
        extra: { result: { id: 'vn-frame-r', type: 'image', url: FRAME.current, thumbnailUrl: FRAME.current, createdAt: 2 } as never },
      })
      return { nodes: [source, frame], edges: [link('vn-frame')] }
    }
    case 'frame-failed': {
      const frame = imageNode({
        id: 'vn-frame',
        title: c.frameTitle(c.sourceTitle, timecode(PLAYHEAD_SECONDS)),
        position: RESULT_AT,
        extra: { status: 'error', error: c.frameFailed },
      })
      return { nodes: [source, frame], edges: [link('vn-frame')] }
    }
    case 'trim-running': {
      const clip = videoNode({
        id: 'vn-clip',
        title: c.trimTitleCard(c.sourceTitle, timecode(TRIM_IN_SECONDS), timecode(TRIM_OUT_SECONDS)),
        position: RESULT_AT,
        poster: FRAME.trimIn,
        extra: {
          status: 'running',
          result: undefined,
          progress: { percent: 62, message: `${c.trimming} · 62%`, phase: videoDepthProgressPhase('processing') },
        } as never,
      })
      return { nodes: [source, clip], edges: [link('vn-clip')] }
    }
    case 'trim-done': {
      const clip = videoNode({
        id: 'vn-clip',
        title: c.trimTitleCard(c.sourceTitle, timecode(TRIM_IN_SECONDS), timecode(TRIM_OUT_SECONDS)),
        position: RESULT_AT,
        poster: FRAME.trimIn,
      })
      return { nodes: [source, clip], edges: [link('vn-clip')] }
    }
    case 'trim-failed': {
      const clip = videoNode({
        id: 'vn-clip',
        title: c.trimTitleCard(c.sourceTitle, timecode(TRIM_IN_SECONDS), timecode(TRIM_OUT_SECONDS)),
        position: RESULT_AT,
        poster: FRAME.trimIn,
        extra: { status: 'error', error: c.trimFailed, result: undefined } as never,
      })
      return { nodes: [source, clip], edges: [link('vn-clip')] }
    }
    case 'split-done': {
      // 五段：0 → 第一个切点，切点 → 下一个切点，最后一个切点 → 片尾；落位 = 生产的成组紧凑布局（源右侧起、4 列）。
      const starts = [0, ...CUT_SECONDS]
      const ends = [...CUT_SECONDS, DURATION_SECONDS]
      const positions = shotCutNodePositions({ origin: { x: SOURCE_AT.x, y: SOURCE_AT.y - 100 }, sourceSize: SIZE, count: starts.length })
      const clips = starts.map((from, index) => videoNode({
        id: `vn-seg-${index + 1}`,
        title: `${c.segmentTitle(c.sourceTitle, index + 1)} · ${timecode(from)}–${timecode(ends[index] ?? from)}`,
        position: positions[index] ?? RESULT_AT,
        poster: SEGMENT_POSTERS[index] ?? FRAME.first,
      }))
      return {
        nodes: [source, ...clips],
        edges: clips.map((clip) => link(clip.id)),
        groupOf: { name: locale === 'zh-CN' ? `拆自 ${c.sourceTitle}` : `Split from ${c.sourceTitle}`, memberIds: clips.map((clip) => clip.id) },
      }
    }
  }
}

const ORIGIN = { x: 0, y: 0 }

export const SCENE_STAGE = { width: 1180, height: 560 } as const

export function SceneStage({ locale, scene, zoom = 1, width = SCENE_STAGE.width, height = SCENE_STAGE.height, offset = ORIGIN }: {
  locale: VnLocale
  scene: CanvasScene
  zoom?: number
  width?: number
  height?: number
  offset?: { x: number; y: number }
}): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const localeReady = useLabLocale(locale)
  const [chunkReady, setChunkReady] = React.useState(false)
  // 一把贯穿到底的 hold：从挂载一直握到整屏画好。中途「放手再登记」会留一个空档，就绪旗正好在空档里举起来。
  const releaseRef = React.useRef<(() => void) | null>(null)
  React.useLayoutEffect(() => {
    releaseRef.current = holdDesignLabReady('video-node-next:canvas')
    return () => { releaseRef.current?.(); releaseRef.current = null }
  }, [])
  React.useEffect(() => { void COMPOSER_CHUNK.then(() => setChunkReady(true)) }, [])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    const seed = seedFor(scene, locale)
    useWorkbenchStore.setState({ activeCategoryId: 'shots', categoryViewports: { shots: { zoom, offset } } as never })
    useGenerationCanvasStore.setState({
      nodes: seed.nodes,
      edges: seed.edges.map((edge) => ({ ...edge, mode: 'reference' })) as never,
      groups: [],
      selectedNodeIds: [],
      isReady: true,
    })
    if (seed.groupOf) {
      const group = useGenerationCanvasStore.getState().createGroup('shots', seed.groupOf.name, { nodeIds: seed.groupOf.memberIds })
      if (group) useGenerationCanvasStore.getState().selectNodes([])
    }
    // 剪辑进行中：新卡先用入点那一帧占位（生产里「活预览」就是这条通道，提取深度逐帧回传也走它）。
    if (scene === 'trim-running') useNodeLivePreviewStore.getState().setPreview('vn-clip', FRAME.trimIn)
    setSeeded(true)
    return () => { useNodeLivePreviewStore.getState().clearPreview('vn-clip') }
  }, [locale, offset, scene, zoom])
  const ready = seeded && localeReady && chunkReady
  // 画布本体是懒加载的分包：挂上去不等于画好了。等到 React Flow 把每张卡都画出来再放行就绪旗。
  const rootRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!ready) return undefined
    const release = (): void => { releaseRef.current?.(); releaseRef.current = null }
    const expected = seedFor(scene, locale).nodes.length
    let frame = 0
    let tries = 0
    const tick = (): void => {
      tries += 1
      const drawn = rootRef.current?.querySelectorAll('.react-flow__node').length ?? 0
      // 每种节点的渲染器是按种类懒加载的分包：到之前画的是同尺寸的轻量壳（data-render-mode=lightweight），要等它换成整卡。
      const settled = !rootRef.current?.querySelector('[data-render-mode="lightweight"]')
      if (drawn >= expected && settled) { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => release()) }); return }
      if (tries > 600) { release(); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [locale, ready, scene])
  return (
    <div ref={rootRef} data-design-lab-stage="video-node-next-canvas" className="relative overflow-hidden rounded-nomi border border-nomi-line" style={{ width, height }}>
      {ready ? <GenerationCanvas /> : null}
    </div>
  )
}
