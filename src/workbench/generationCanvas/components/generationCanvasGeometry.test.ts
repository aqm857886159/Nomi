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

describe('getCanvasGroupBoxes — 框的边界是 union(用户画的矩形, 成员矩形)', () => {
  function frameGroup(partial: Partial<NodeGroup> & Pick<NodeGroup, 'id' | 'nodeIds'>): NodeGroup {
    return { name: partial.id, categoryId: 'shots', createdAt: 1, updatedAt: 1, ...partial } as NodeGroup
  }

  it('空框（有画的矩形、零成员）照样出框，并标成 empty', () => {
    // 2026-09-06 之前这里是 `if (!members.length) return []`——用户画完一个空框会看不见它。
    const bounds = { x: 40, y: 60, w: 600, h: 400 }
    const boxes = getCanvasGroupBoxes([frameGroup({ id: 'f', nodeIds: [], frameBounds: bounds })], [])
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ left: 40, top: 60, width: 600, height: 400, memberCount: 0, empty: true })
  })

  it('成员都在框内时框保持用户画的大小；探出去时框跟着长', () => {
    const bounds = { x: 0, y: 0, w: 900, h: 700 }
    const inside = makeNode({ id: 'in', kind: 'image', position: { x: 200, y: 200 }, size: { width: 200, height: 160 } })
    const outside = makeNode({ id: 'out', kind: 'image', position: { x: 1200, y: 200 }, size: { width: 200, height: 160 } })
    const group = frameGroup({ id: 'f', nodeIds: ['in', 'out'], frameBounds: bounds })

    const [snug] = getCanvasGroupBoxes([{ ...group, nodeIds: ['in'] }], [inside])
    expect(snug).toMatchObject({ left: 0, top: 0, width: 900, height: 700, empty: false })

    const [grown] = getCanvasGroupBoxes([group], [inside, outside])
    expect(grown.left).toBe(0)
    expect(grown.width).toBeGreaterThan(900)
  })

  it('既没画过也没成员 → 不画（旧数据里成员全被删光的空组不该留下幽灵框）', () => {
    expect(getCanvasGroupBoxes([frameGroup({ id: 'ghost', nodeIds: [] })], [])).toEqual([])
  })
})
