import { describe, expect, it } from 'vitest'
import {
  getNodeSize,
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

describe('getNodeSize — 单一尺寸真相源', () => {
  it('显式 size 直接返回（不被回退覆盖）', () => {
    const node = makeNode({ id: 'a', kind: 'image', size: { width: 555, height: 333 } })
    expect(getNodeSize(node)).toEqual({ width: 555, height: 333 })
  })

  it('无 size 时回退到 registry 的 per-kind 默认尺寸，而非裸 320/360 或 300/220', () => {
    // character 在 registry 里是 300×190；旧的 geometry 回退把它算成 320×360（DEFAULT_NODE_SIZE）
    // 或命中判定把它算成 300×220 —— 都和真相源不一致。
    const character = makeNode({ id: 'c', kind: 'character' })
    expect(getNodeSize(character)).toEqual(getGenerationNodeDefaultSize('character'))
    expect(getNodeSize(character)).not.toEqual({ width: 320, height: 360 })
    expect(getNodeSize(character)).not.toEqual({ width: 300, height: 220 })

    // video 在 registry 里是 420×340；旧的 300×220 命中框比真实窄一大截 → 框选选不中。
    const video = makeNode({ id: 'v', kind: 'video' })
    expect(getNodeSize(video)).toEqual(getGenerationNodeDefaultSize('video'))
    expect(getNodeSize(video).width).toBe(420)
    expect(getNodeSize(video).height).toBe(340)
  })

  it('每个 kind 的回退都等于其 registry defaultSize（无第二份真相源）', () => {
    for (const kind of ['text', 'character', 'scene', 'image', 'keyframe', 'video', 'shot', 'output', 'panorama', 'scene3d', 'asset'] as const) {
      const node = makeNode({ id: `n-${kind}`, kind })
      expect(getNodeSize(node)).toEqual(getGenerationNodeDefaultSize(kind))
    }
  })
})

describe('几何调用点使用真实渲染尺寸', () => {
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
