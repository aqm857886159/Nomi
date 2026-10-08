import React, { type JSX } from 'react'
import ShotTableNode from '../../../workbench/generationCanvas/nodes/shotTable/ShotTableNode'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import type { ShotTableFactRow } from '../../../../electron/shared/canvas/shotTable'
import { createDeconstructionShotTable } from '../../../workbench/generationCanvas/nodes/shotTable/shotTableFacts'
import type { GenerationCanvasNode } from '../../../workbench/generationCanvas/model/generationCanvasTypes'

type Props = { deconstructing?: boolean }

const PROMPTS = ['雨夜，街口的灯映在积水中', '女孩握紧旧照片，回头望向巷口', '一束车灯穿过薄雾', '两个人隔着斑马线停下', '风吹动纸页，镜头缓缓拉远']

/** Real host store and production node（拆解表是画布上仅存的表）。密度钉在文档字段上：样张没有 React Flow 视口。 */
export function ShotTableStage({ deconstructing = false }: Props): JSX.Element {
  const [ready, setReady] = React.useState(false)
  const node = useGenerationCanvasStore(store => store.nodes.find(candidate => candidate.id === 'table-specimen'))
  React.useLayoutEffect(() => {
    const table = createDeconstructionShotTable('reference-specimen', '雨夜参考片 · 15s')
    table.updatedAt = '2026-09-10T00:00:00.000Z'
    table.view.selectedRowIds = []
    table.view.density = 'full'
    table.source.status = deconstructing ? 'running' : 'ready'
    table.source.phase = deconstructing ? 1 : undefined
    table.source.durationSeconds = 15
    table.columns.push({ columnId: 'selling-point', kind: 'custom', labelKey: '卖点', order: 6, visible: true, hint: '该镜的叙事用途' })
    table.rows = deconstructing ? [] : PROMPTS.map((prompt, i): ShotTableFactRow => ({
      rowId: `fact-${i + 1}`, order: i + 1, startSeconds: i * 3, endSeconds: (i + 1) * 3, durationSeconds: 3,
      carriedOver: i === 2, visionFailed: i === 3,
      cells: i === 3 ? { dialogue: '你还记得这里吗？' } : {
        shotSize: i === 1 ? '特写' : '全景', motion: i === 1 ? '缓慢推近' : '定机位', visual: prompt,
        dialogue: i === 2 ? '我一直在等你。' : '', onScreenText: i === 4 ? '夜风计划' : '', mood: i === 4 ? '释然' : '悬念',
        'selling-point': i === 0 ? '开场钩子' : '情绪递进',
      },
    }))
    const tableNode: GenerationCanvasNode = { id: 'table-specimen', kind: 'shot_table', title: '拆解表 · 雨夜参考片', position: { x: 0, y: 0 }, size: { width: 960, height: 420 }, status: 'idle', meta: { shotTable: table } }
    useGenerationCanvasStore.setState({ nodes: [tableNode], edges: [] })
    setReady(true)
  }, [deconstructing])
  return <div className="bg-nomi-bg p-4" style={{ width: 992, height: 452 }}><div style={{ width: 960, height: 420 }}>{ready && node ? <ShotTableNode node={node} selected={false} /> : null}</div></div>
}
