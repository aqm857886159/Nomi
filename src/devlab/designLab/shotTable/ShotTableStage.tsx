import React from 'react'
import ShotTableNode from '../../../workbench/generationCanvas/nodes/shotTable/ShotTableNode'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import { createStoryboardShotTable, type ShotTableDocument, type ShotTableFactRow } from '../../../../electron/shared/canvas/shotTable'
import { createDeconstructionShotTable } from '../../../workbench/generationCanvas/nodes/shotTable/shotTableFacts'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../../workbench/workbenchTypes'

type Props = {
  density?: ShotTableDocument['view']['density']
  empty?: boolean
  selected?: boolean
  generating?: boolean
  failed?: boolean
  facts?: boolean
  deconstructing?: boolean
}

/** Real host stores and production node; the outer scale mimics the canvas, density is pinned on the document. */
export function ShotTableStage({ density = 'full', empty = false, selected = false, generating = false, failed = false, facts = false, deconstructing = false }: Props): JSX.Element {
  const [ready, setReady] = React.useState(false)
  const node = useGenerationCanvasStore(store => store.nodes.find(candidate => candidate.id === 'table-specimen'))
  const zoom = density === 'compact' ? 0.6 : density === 'card' ? 0.3 : 1
  React.useLayoutEffect(() => {
    const shots = empty ? [] : ['雨夜，街口的灯映在积水中', '女孩握紧旧照片，回头望向巷口', '一束车灯穿过薄雾', '两个人隔着斑马线停下', '风吹动纸页，镜头缓缓拉远'].map((prompt, i) => ({ index: i + 1, shotId: `shot-${i + 1}`, prompt, shotKind: 'image' as const, anchorIds: [], durationSec: 3 }))
    const design: StoryboardDesign = { id: 'table-design', documentId: 'table-document', title: '夜风计划 · 分镜表', plan: { title: '夜风计划', anchors: [], shots }, committed: false, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1 }
    const table = facts ? createDeconstructionShotTable('reference-specimen', '雨夜参考片 · 15s') : createStoryboardShotTable('table-document', design.id)
    table.updatedAt = '2026-09-10T00:00:00.000Z'
    table.view.selectedRowIds = selected ? ['shot-2', 'shot-3'] : []
    // 画布外的样张没有 React Flow 视口（缩放的唯一真相在那里，见 reactFlow/canvasViewportScale.ts）。
    // 密度档因此直接钉在文档字段上——那也是用户能手动钉住密度时走的同一条路。
    table.view.density = density
    if (table.source.kind === 'deconstruction' && 'columns' in table) {
      table.source.status = deconstructing ? 'running' : 'ready'
      table.source.phase = deconstructing ? 1 : undefined
      table.source.durationSeconds = 15
      table.columns.push({ columnId: 'selling-point', kind: 'custom', labelKey: '卖点', order: 6, visible: true, hint: '该镜的叙事用途' })
      table.rows = deconstructing ? [] : shots.map((shot, i): ShotTableFactRow => ({
        rowId: `fact-${i + 1}`, order: i + 1, startSeconds: i * 3, endSeconds: (i + 1) * 3, durationSeconds: 3,
        carriedOver: i === 2, visionFailed: i === 3,
        // Browser specimens do not invent project-local asset URLs; storyboard rows below show real fixture images.
        cells: i === 3 ? { dialogue: '你还记得这里吗？' } : {
          shotSize: i === 1 ? '特写' : '全景', motion: i === 1 ? '缓慢推近' : '定机位', visual: shot.prompt,
          dialogue: i === 2 ? '我一直在等你。' : '', onScreenText: i === 4 ? '夜风计划' : '', mood: i === 4 ? '释然' : '悬念',
          'selling-point': i === 0 ? '开场钩子' : '情绪递进',
        },
      }))
    }
    const tableNode: GenerationCanvasNode = { id: 'table-specimen', kind: 'shot_table', title: facts ? '拆解表 · 雨夜参考片' : design.title, position: { x: 0, y: 0 }, size: { width: 960, height: 420 }, status: 'idle', meta: { shotTable: table } }
    const shotNodes: GenerationCanvasNode[] = shots.map((shot, i) => ({
      id: `specimen-${shot.shotId}`, kind: 'image', title: shot.prompt, prompt: shot.prompt, position: { x: 0, y: 0 },
      status: generating && i === 1 ? 'running' : failed && i === 2 ? 'error' : i === 0 ? 'success' : 'idle',
      error: failed && i === 2 ? '生成失败' : undefined,
      ...(i === 0 ? { result: { id: 'specimen-frame', type: 'image' as const, url: '/fixtures/process-feedback-frame.svg', createdAt: 1 } } : {}),
      meta: { storyboardDesignId: design.id, shotId: shot.shotId },
    }))
    useWorkbenchStore.setState({ storyboardDesignsByDocumentId: { 'table-document': [design] } })
    useGenerationCanvasStore.setState({ nodes: [tableNode, ...shotNodes], edges: [] })
    setReady(true)
  }, [density, empty, selected, generating, failed, facts, deconstructing, zoom])
  return <div className="bg-nomi-bg p-4" style={{ width: 992, height: 452 }}><div style={{ width: 960, height: 420, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>{ready && node ? <ShotTableNode node={node} selected={selected} /> : null}</div></div>
}
