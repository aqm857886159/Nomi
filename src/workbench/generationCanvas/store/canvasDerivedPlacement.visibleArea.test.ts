import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { publishCanvasStageSize, visibleCanvasRect } from './canvasVisibleArea'
import { overlapsAny, rectOf, seed, videoBesideTallRow } from './derivedPlacement.testkit'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function derive(sourceNodeId: string, kind: 'shot-table', nodeKind: 'shot_table', position: { x: number; y: number }): GenerationCanvasNode {
  const created = useGenerationCanvasStore.getState().addDerivedOutput({ sourceNodeId, kind, node: { kind: nodeKind, categoryId: 'shots', position } })
  if (!created) throw new Error(`addDerivedOutput(${kind}) 返回 null`)
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === created.id)!
}


// 真机里画布已挂载、有可见区：addNode 先在可见区里找离期望点最近的空位（resolveInsertionPositionInAreaWith），
// 这条路也必须按渲染矩形避让——2026-10-18 走查的拆解表正是从这条路落到竖图上的。
// 舞台尺寸是模块级发布值、没有撤销入口，所以这组单独一个文件（每个测试文件各有一份模块状态）。
describe('派生节点落点 × 可见区', () => {
  beforeEach(() => {
    publishCanvasStageSize({ width: 1680, height: 1000 }, { left: 0, top: 0, width: 1680, height: 1000 })
    seed([])
  })

  it('夹具自检：舞台已发布，可见区存在', () => {
    expect(visibleCanvasRect('shots')).not.toBeNull()
  })

  it('shot-table：视频右侧一排竖图，可见区里找到的空位也不压它们', () => {
    seed(videoBesideTallRow())
    const created = derive('src', 'shot-table', 'shot_table', { x: 520, y: 160 })
    expect(overlapsAny(created).map((node) => node.id)).toEqual([])
    expect(rectOf(created).width).toBeGreaterThan(0)
  })

  it('可见区里没有空位时退回螺旋，仍然不压', () => {
    seed([...videoBesideTallRow(), ...[0, 1, 2, 3].map((index) => ({ ...videoBesideTallRow()[1], id: `fill-${index}`, position: { x: 200 + index * 380, y: 760 } }))])
    const created = derive('src', 'shot-table', 'shot_table', { x: 520, y: 160 })
    expect(overlapsAny(created).map((node) => node.id)).toEqual([])
    expect(useGenerationCanvasStore.getState().nodes.some((node) => node.id === created.id)).toBe(true)
  })
})
