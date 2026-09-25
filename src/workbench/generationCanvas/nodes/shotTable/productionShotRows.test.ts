import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { createProductionShotTable } from '../../../../../electron/shared/canvas/shotTable'
import { selectShotTableRows } from './selectShotTableRows'

// 分镜表 = Run 落地节点的表格表示版：行从节点 derive（制作的运行状态由主进程投影进节点自己的运行记录）。

function node(id: string, meta: Record<string, unknown>, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: `prompt ${id}`, categoryId: 'shots', meta, ...extra }
}
const landed = (id: string, extra: Partial<GenerationCanvasNode> = {}, role: 'shot' | 'anchor' = 'shot') =>
  node(id, { productionRunId: 'run-1', productionShotId: id, productionShotRole: role, materializationOperationId: 'canvas-landing:run-1' }, extra)

const table = createProductionShotTable('run-1', 'canvas-landing:run-1')
const rows = (nodes: GenerationCanvasNode[]) =>
  selectShotTableRows({ table, designs: {}, nodes, imageModelOptions: [], videoModelOptions: [] })

describe('selectShotTableRows · production source', () => {
  it('rows are the run\'s shot nodes in canvas order; anchors, other runs and derived copies are not rows', () => {
    const view = rows([
      landed('a1', {}, 'anchor'),
      landed('s1'),
      node('foreign', { productionRunId: 'run-2', productionShotId: 'x' }),
      landed('s2'),
      landed('s2-copy', { derivedFrom: 's2' }),
      node('user-card', {}),
    ])
    expect(view.map((row) => [row.id, row.index, row.prompt])).toEqual([['s1', 1, 'prompt s1'], ['s2', 2, 'prompt s2']])
  })

  it('status and thumbnail come from the node: result → done, node running → generating, error → failed, nothing → ready', () => {
    const view = rows([
      landed('done', { result: { id: 'r', type: 'image', url: 'nomi-local://done.png', createdAt: 1 } }),
      landed('busy', { status: 'running', progress: { percent: 40, updatedAt: 1 } }),
      landed('broken', { status: 'error', error: '上游拒了' }),
      landed('fresh'),
    ])
    expect(view.map((row) => [row.id, row.exec?.status, row.thumbnail ?? null, row.exec?.progressPercent ?? null])).toEqual([
      ['done', 'done', 'nomi-local://done.png', null],
      ['busy', 'generating', null, 40],
      ['broken', 'failed', null, null],
      ['fresh', 'ready', null, null],
    ])
    expect(view[2].exec?.errorMessage).toBe('上游拒了')
  })

  it('duration reads the node\'s declared duration and never invents one; a still frame has **no** duration, not zero', () => {
    const view = rows([
      landed('v', { kind: 'video', meta: { productionRunId: 'run-1', productionShotRole: 'shot', duration: 5 } }),
      landed('i'),
    ])
    // 静帧那行是 undefined 而不是 0：表里因此显示「—」而不是「0s」。
    // 2026-09-18 金路径真机截图上三行静帧全写着「0s」，读起来像「时长为零」——
    // 「没有」和「零」挤进同一个表示，读者就分不开（这一批合同里最常见的那个形状）。
    expect(view.map((row) => row.duration)).toEqual([5, undefined])
  })
})
