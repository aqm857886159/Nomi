import { describe, expect, it } from 'vitest'
import {
  centerNodeOffset,
  getCanvasNodeVisualSize,
  getSelectedBounds,
  getCanvasGroupBoxes,
} from './generationCanvasGeometry'
import { getGenerationNodeDefaultSize } from '../model/generationNodeKinds'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

function makeNode(partial: Partial<GenerationCanvasNode> & Pick<GenerationCanvasNode, 'id' | 'kind'>): GenerationCanvasNode {
  return {
    title: partial.title ?? '',
    position: partial.position ?? { x: 0, y: 0 },
    ...partial,
  } as GenerationCanvasNode
}

describe('getCanvasNodeVisualSize — 渲染尺寸单一真相源', () => {
  it('媒体真实预览高覆盖过期持久化高度', () => {
    const node = makeNode({
      id: 'loaded-image',
      kind: 'image',
      size: { width: 360, height: 280 },
      meta: { previewHeight: 432 },
      result: { id: 'result-1', type: 'image', url: 'nomi-local://asset/image.jpg', createdAt: 1 },
    })
    expect(getCanvasNodeVisualSize(node)).toEqual({ width: 360, height: 432 })
  })

  it('卡片 renderKind 使用真实固定宽度', () => {
    const character = makeNode({ id: 'c', kind: 'character', size: { width: 300, height: 190 } })
    expect(getCanvasNodeVisualSize(character)).toEqual({ width: 200, height: 190 })
  })
})

describe('几何调用点使用真实渲染尺寸', () => {
  it('centerNodeOffset 按媒体真实预览高居中，不使用过期持久化高度', () => {
    const node = makeNode({
      id: 'loaded-image',
      kind: 'image',
      position: { x: 160, y: 140 },
      size: { width: 360, height: 280 },
      meta: { previewHeight: 432 },
      result: { id: 'result-1', type: 'image', url: 'nomi-local://asset/image.jpg', createdAt: 1 },
    })

    expect(centerNodeOffset(node, { width: 1040, height: 648 }, 1)).toEqual({ x: 180, y: -32 })
  })

  it('getSelectedBounds 用 per-kind 真实尺寸算包围盒（video 比 300×220 大）', () => {
    const size = getGenerationNodeDefaultSize('video')
    const node = makeNode({ id: 'v', kind: 'video', position: { x: 100, y: 0 }, size })
    const bounds = getSelectedBounds([node], ['v'])
    // 右/下边界 = position + registry size。旧实现内联 300×220 会算小。
    expect(bounds?.width).toBe(size.width)
    expect(bounds?.height).toBe(size.height)
  })

  it('getSelectedBounds 用真实渲染尺寸算卡片包围盒（character-card 实际宽 200）', () => {
    const node = makeNode({ id: 'c', kind: 'character', position: { x: 40, y: 50 }, size: getGenerationNodeDefaultSize('character') })
    const bounds = getSelectedBounds([node], ['c'])
    expect(bounds).toMatchObject({ minX: 40, minY: 50, width: 200, height: 190 })
  })

  it('getCanvasGroupBoxes 用真实渲染尺寸算成员包围盒', () => {
    const visualSize = { width: 520, height: 410 }
    const node = makeNode({ id: 'v', kind: 'video', position: { x: 0, y: 0 }, categoryId: 'shots', size: visualSize })
    const group: NodeGroup = {
      id: 'g1',
      name: 'G',
      categoryId: 'shots',
      nodeIds: ['v'],
      createdAt: 0,
      updatedAt: 0,
    }
    const [box] = getCanvasGroupBoxes([group], [node])
    // 包围盒 = 成员视觉尺寸 + 左右 padding(24*2)，高度再加顶部标签预留(28)。
    expect(box.width).toBe(visualSize.width + 48)
    expect(box.height).toBe(visualSize.height + 48 + 28)
  })
})
