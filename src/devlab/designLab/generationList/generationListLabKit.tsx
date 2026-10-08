// 生成页列表视图的实验室取景台：把夹具灌进**现役** store（画布 + 工作台 + 视图），渲染**现役**
// GenerationListView / GenerationViewToggle——格子里没有一件样张自己画的零件。
// 夹具覆盖画布上的**每一种节点**（生成节点 / 工具节点 / 素材与参考），以及每种的空 / 失败 / 生成中态。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../../workbench/workbenchTypes'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { useGenerationViewStore, type GenerationListFilter } from '../../../workbench/generation/list/generationViewStore'
import { GenerationListView } from '../../../workbench/generation/list/GenerationListView'
import { GenerationViewToggle } from '../../../workbench/generation/list/GenerationViewToggle'
import { holdDesignLabReady } from '../labReadyHold'
import { COMPOSER_CHUNK, installCatalogBridge } from '../nodeComposerBar/nodeComposerBarLabKit'
import { ART_LIN_WEI, ART_PENDING, ART_STORE_NEON, ART_WATCH, shotArt } from './generationListArt'

export const GENERATION_LIST_CELL_WIDTH = 1440
export const GENERATION_LIST_CELL_HEIGHT = 900

const VIDEO_URL = '/fixtures/node-label-video.mp4'
const DESIGN_ID = 'lab-storyboard'
const DOCUMENT_ID = 'lab-document'

type Locale = 'zh-CN' | 'en'
const L = (locale: Locale, zh: string, en: string) => (locale === 'en' ? en : zh)

function videoMeta(ratio: string, duration = 5): Record<string, unknown> {
  return { modelKey: 'seedance-2', modelVendor: 'apimart', aspect_ratio: ratio, duration, resolution: '1080p' }
}
function imageMeta(ratio: string): Record<string, unknown> {
  return { modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: ratio, resolution: '2K' }
}
function node(partial: Partial<GenerationCanvasNode> & Pick<GenerationCanvasNode, 'id' | 'kind'>): GenerationCanvasNode {
  return { title: '', prompt: '', position: { x: 0, y: 0 }, status: 'idle', categoryId: 'shots', ...partial } as GenerationCanvasNode
}
const imageResult = (id: string, url: string) => ({ result: { id: `${id}-r`, type: 'image' as const, url, createdAt: 1 } })
// 视频结果带首帧缩略图（真实生成落地时由取片写进 thumbnailUrl）。
const videoResult = (id: string, poster: string) => ({ result: { id: `${id}-r`, type: 'video' as const, url: VIDEO_URL, thumbnailUrl: poster, createdAt: 1 } })

const TEXT_DOC = (lines: string[]) => ({ type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) })

export type GenerationListFixture = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  designs: Record<string, StoryboardDesign[]>
}

/** 每一种画布节点都在：分镜 3 镜（一镜还没落画布）、一个画布分组、未分组里每种生成节点与工具节点，加素材。 */
export function kindsFixture(locale: Locale): GenerationListFixture {
  const design: StoryboardDesign = {
    id: DESIGN_ID, documentId: DOCUMENT_ID, title: L(locale, '雨夜便利店', 'Rainy convenience store'), committed: true, status: 'draft',
    createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
    plan: {
      title: L(locale, '雨夜便利店', 'Rainy convenience store'),
      anchors: [
        { id: 'lin', kind: 'character', name: L(locale, '林薇', 'Lin Wei'), description: '', carrier: 'visual' },
        { id: 'look', kind: 'character', name: L(locale, '雨夜妆造', 'Rain look'), description: '', carrier: 'visual' },
      ],
      shots: [
        { shotId: 's1', index: 1, shotKind: 'video', durationSec: 5, anchorIds: ['lin'], prompt: L(locale, '远景，雨后便利店门口，林薇站在雨棚边', 'Wide shot, Lin Wei by the store awning after rain') },
        { shotId: 's2', index: 2, shotKind: 'video', durationSec: 5, anchorIds: ['lin'], prompt: L(locale, '近景，林薇侧脸，水珠沿发梢滑下', 'Close-up, Lin Wei in profile, droplets run from her hair') },
        { shotId: 's3', index: 3, shotKind: 'video', durationSec: 5, anchorIds: ['look'], prompt: L(locale, '俯拍，湿漉漉的车道与霓虹几何线条', 'Top down, wet lanes under neon geometry') },
      ],
    },
  }
  const nodes: GenerationCanvasNode[] = [
    // 参考（锚卡）
    node({ id: 'ref-lin', kind: 'character', title: L(locale, '林薇', 'Lin Wei'), status: 'success', meta: { referenceSheet: true, storyboardDesignId: DESIGN_ID, anchorId: 'lin' }, ...imageResult('ref-lin', ART_LIN_WEI) }),
    node({ id: 'ref-look', kind: 'character', title: L(locale, '雨夜妆造', 'Rain look'), meta: { referenceSheet: true, storyboardDesignId: DESIGN_ID, anchorId: 'look' } }),
    // 分镜镜头（前两镜落了画布）
    node({ id: 'shot-1', kind: 'video', title: '', prompt: design.plan.shots[0].prompt, status: 'success', meta: { ...videoMeta('16:9'), storyboardDesignId: DESIGN_ID, shotId: 's1' }, ...videoResult('shot-1', shotArt(1, '16:9', '#384d67|#111827')) }),
    node({ id: 'shot-2', kind: 'video', title: '', prompt: design.plan.shots[1].prompt, status: 'running', progress: { percent: 40 } as never, meta: { ...videoMeta('9:16'), storyboardDesignId: DESIGN_ID, shotId: 's2' } }),
    // 画布分组：海报试稿
    node({ id: 'poster-1', kind: 'image', title: L(locale, '海报 01', 'Poster 01'), prompt: L(locale, '竖版海报，便利店霓虹与积水倒影', 'Vertical poster, store neon and puddle reflections'), status: 'success', meta: imageMeta('9:16'), ...imageResult('poster-1', shotArt(11, '9:16', '#5d526f|#1b1726')) }),
    node({ id: 'poster-2', kind: 'image', title: L(locale, '海报 02', 'Poster 02'), prompt: L(locale, '方形海报，怀表落在积水里', 'Square poster, a pocket watch in a puddle'), status: 'error', error: L(locale, '生成失败', 'Generation failed'), meta: imageMeta('1:1') }),
    // 未分组：每种生成节点
    node({ id: 'video-done', kind: 'video', title: L(locale, '街口推近', 'Street push-in'), prompt: L(locale, '雨夜街口，镜头缓缓推近', 'Rainy street corner, slow push-in'), status: 'success', meta: videoMeta('16:9', 8), ...videoResult('video-done', shotArt(5, '16:9', '#506a63|#162622')) }),
    node({ id: 'video-empty', kind: 'video', title: L(locale, '空的视频', 'Empty video'), meta: videoMeta('16:9') }),
    node({ id: 'audio-done', kind: 'audio', title: L(locale, '旁白 · 开场', 'Voiceover · opening'), prompt: L(locale, '低声说：那晚的雨一直没停', 'Whispered: the rain never stopped that night'), status: 'success', categoryId: 'audio', meta: { durationSec: 12 }, result: { id: 'audio-r', type: 'audio', url: 'nomi-local://lab/voiceover.mp3', createdAt: 1 } as never }),
    node({ id: 'audio-failed', kind: 'audio', title: L(locale, '环境声', 'Ambience'), prompt: L(locale, '雨声与远处车流', 'Rain and distant traffic'), status: 'error', error: 'x', categoryId: 'audio' }),
    node({ id: 'text-done', kind: 'text', title: L(locale, '分镜说明', 'Shot notes'), status: 'success', contentJson: TEXT_DOC(L(locale, '第一场：雨夜便利店。\n林薇推门进来，抖落伞上的水。\n店员抬头，认出了她。\n远处传来一声汽笛。', 'Scene one: a rainy convenience store.\nLin Wei pushes the door open and shakes out her umbrella.\nThe clerk looks up and recognises her.\nA horn sounds in the distance.').split('\n')) as never, result: { id: 'text-r', type: 'text', text: 'notes', createdAt: 1 } as never }),
    node({ id: 'text-empty', kind: 'text', title: L(locale, '空的文本', 'Empty text') }),
    node({ id: 'image-empty', kind: 'image', title: L(locale, '素材 03', 'Asset 03'), meta: imageMeta('1:1') }),
    node({ id: 'image-asset-use', kind: 'image', title: L(locale, '怀表特写', 'Watch close-up'), prompt: L(locale, '怀表特写，表链缠在指间', 'Pocket watch close-up, chain around fingers'), status: 'success', meta: imageMeta('1:1'), ...imageResult('image-asset-use', shotArt(4, '1:1', '#87613e|#2b1c12')) }),
    // 工具节点
    node({ id: 'tool-director', kind: 'director', title: L(locale, '导演台 · 预演', 'Director desk · previz') }),
    node({ id: 'tool-clip', kind: 'clip', title: L(locale, '剪辑 · 粗剪', 'Clip · rough cut') }),
    node({ id: 'tool-model3d', kind: 'model3d', title: L(locale, '3D · 便利店', '3D · Store') }),
    node({ id: 'tool-panorama', kind: 'panorama', title: L(locale, '全景 · 街口', 'Panorama · Corner') }),
    node({ id: 'tool-whiteboard', kind: 'whiteboard', title: L(locale, '白板 · 走位', 'Whiteboard · blocking') }),
    node({ id: 'tool-output', kind: 'output', title: L(locale, '输出', 'Output') }),
    node({ id: 'tool-artifact', kind: 'agent-artifact', title: L(locale, '色彩板', 'Colour board') }),
    // 素材：一张被引用（怀表 → 怀表特写）、一张没人引用、一张场景卡没人引用
    node({ id: 'asset-watch', kind: 'asset', title: L(locale, '怀表.png', 'watch.png'), status: 'success', ...imageResult('asset-watch', ART_WATCH) }),
    node({ id: 'asset-loose', kind: 'asset', title: L(locale, '便利店照片.png', 'store-photo.png'), status: 'success', ...imageResult('asset-loose', ART_STORE_NEON) }),
    node({ id: 'scene-card', kind: 'scene', title: L(locale, '场景 · 后巷', 'Scene · back alley'), categoryId: 'scene', status: 'success', ...imageResult('scene-card', ART_PENDING) }),
  ]
  const edges: GenerationCanvasEdge[] = [
    { id: 'e-lin-1', source: 'ref-lin', target: 'shot-1', mode: 'reference', order: 0 },
    { id: 'e-lin-2', source: 'ref-lin', target: 'shot-2', mode: 'reference', order: 0 },
    { id: 'e-1-2', source: 'shot-1', target: 'shot-2', mode: 'first_frame' },
    { id: 'e-watch', source: 'asset-watch', target: 'image-asset-use', mode: 'reference', order: 0 },
  ]
  const groups: NodeGroup[] = [{ id: 'group-poster', name: L(locale, '海报试稿', 'Poster pass'), categoryId: 'shots', nodeIds: ['poster-1', 'poster-2'], createdAt: 1, updatedAt: 1 }]
  return { nodes, edges, groups, designs: { [DOCUMENT_ID]: [design] } }
}

/** 30 镜分镜（长列表 / 虚拟化取景）。 */
export function longFixture(locale: Locale): GenerationListFixture {
  const ratios = ['16:9', '9:16', '1:1']
  const tones = ['#384d67|#111827', '#704b45|#201312', '#5d526f|#1b1726', '#506a63|#162622', '#87613e|#2b1c12', '#476274|#121c26']
  const shots = Array.from({ length: 30 }, (_, index) => ({ shotId: `l${index + 1}`, index: index + 1, shotKind: 'image' as const, durationSec: 3, anchorIds: [], prompt: L(locale, `第 ${index + 1} 镜：雨夜街景，霓虹倒影`, `Shot ${index + 1}: rainy street, neon reflections`) }))
  const design: StoryboardDesign = { id: DESIGN_ID, documentId: DOCUMENT_ID, title: L(locale, '雨夜便利店 · 长片', 'Rainy store · long cut'), committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1, plan: { title: '', anchors: [], shots } }
  const nodes = shots.map((shot, index) => node({
    id: `long-${index + 1}`, kind: 'image', prompt: shot.prompt, status: index === 1 ? 'running' : index === 6 ? 'error' : 'success',
    meta: { ...imageMeta(ratios[index % 3]), storyboardDesignId: DESIGN_ID, shotId: shot.shotId },
    ...(index === 1 || index === 6 ? {} : imageResult(`long-${index + 1}`, shotArt(index + 1, ratios[index % 3] as '16:9', tones[index % 6]))),
  }))
  return { nodes, edges: [], groups: [], designs: { [DOCUMENT_ID]: [design] } }
}

export type GenerationListStageProps = {
  fixture: 'kinds' | 'long' | 'empty'
  locale?: Locale
  inspectorKey?: string
  filter?: boolean
  height?: number
}

function useLabLocale(locale: Locale): boolean {
  const { i18n } = useTranslation()
  const [applied, setApplied] = React.useState(i18n.language === locale)
  React.useEffect(() => {
    if (i18n.language === locale) { setApplied(true); return undefined }
    const release = holdDesignLabReady(`generation-list:locale:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setApplied(true); release() })
    return release
  }, [i18n, locale])
  return applied
}

/** 一格 = 生成页画布区那一块：左上「画布 | 列表」+ 现役列表视图。 */
export function GenerationListStage({ fixture, locale = 'zh-CN', inspectorKey, filter = false, height = GENERATION_LIST_CELL_HEIGHT }: GenerationListStageProps): JSX.Element {
  React.useMemo(() => installCatalogBridge(), [])
  const languageReady = useLabLocale(locale)
  const [chunkReady, setChunkReady] = React.useState(false)
  React.useEffect(() => {
    const release = holdDesignLabReady('generation-list:composer')
    void Promise.all([COMPOSER_CHUNK, document.fonts?.ready]).then(() => { setChunkReady(true); release() })
    return release
  }, [])
  const [seeded, setSeeded] = React.useState(false)
  React.useLayoutEffect(() => {
    const data = fixture === 'empty' ? { nodes: [], edges: [], groups: [], designs: {} } : fixture === 'long' ? longFixture(locale) : kindsFixture(locale)
    useWorkbenchStore.setState({ activeCategoryId: 'shots', storyboardDesignsByDocumentId: data.designs })
    useGenerationCanvasStore.setState({ nodes: data.nodes, edges: data.edges, groups: data.groups, selectedNodeIds: [] })
    const listFilter: GenerationListFilter = filter ? { documentId: DOCUMENT_ID, designId: DESIGN_ID } : null
    useGenerationViewStore.setState({ view: 'list', listFilter, inspectorKey: inspectorKey ?? null })
    setSeeded(true)
  }, [filter, fixture, inspectorKey, locale])
  return (
    <div data-design-lab-stage="generation-list" className="relative overflow-hidden bg-nomi-bg" style={{ width: GENERATION_LIST_CELL_WIDTH, height }}>
      {seeded && chunkReady && languageReady ? (
        <>
          <div className="absolute inset-0"><GenerationListView /></div>
          <GenerationViewToggle />
        </>
      ) : null}
    </div>
  )
}
