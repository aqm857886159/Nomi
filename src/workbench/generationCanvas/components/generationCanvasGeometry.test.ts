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

describe('几何调用点收口到 getNodeSize', () => {
  it('getSelectedBounds 用 per-kind 真实宽算右边界（video 比 300 宽）', () => {
    const node = makeNode({ id: 'v', kind: 'video', position: { x: 100, y: 0 } })
    const bounds = getSelectedBounds([node], ['v'])
    // 右边界 = x + width(420)。旧实现内联 300 会得到 300。
    expect(bounds?.width).toBe(getGenerationNodeDefaultSize('video').width)
  })

  it('getCanvasGroupBoxes 用 per-kind 真实尺寸算成员包围盒', () => {
    const node = makeNode({ id: 'v', kind: 'video', position: { x: 0, y: 0 }, categoryId: 'shots' })
    const group: NodeGroup = {
      id: 'g1',
      name: 'G',
      categoryId: 'shots',
      nodeIds: ['v'],
      createdAt: 0,
      updatedAt: 0,
    }
    const [box] = getCanvasGroupBoxes([group], [node])
    const size = getGenerationNodeDefaultSize('video')
    // 包围盒宽 = 成员宽 + 2*padding(24)。验证用的是 video 真实宽 420 而非 320。
    expect(box.width).toBe(size.width + 48)
  })
})
