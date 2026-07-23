import { describe, expect, it } from 'vitest'
import { backfillShotIndexes, isShotNumberedNode, nextShotIndex } from './shotNumbering'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'

function makeNode(input: {
  id: string
  kind: GenerationNodeKind
  categoryId?: string
  x?: number
  y?: number
  shotIndex?: number
}): GenerationCanvasNode {
  return {
    id: input.id,
    kind: input.kind,
    title: input.id,
    position: { x: input.x ?? 0, y: input.y ?? 0 },
    prompt: '',
    references: [],
    history: [],
    status: 'idle',
    meta: {},
    categoryId: input.categoryId ?? 'shots',
    ...(input.shotIndex != null ? { shotIndex: input.shotIndex } : {}),
  } as GenerationCanvasNode
}

describe('shotNumbering（镜头编号 = 存储身份，审计 A2）', () => {
  it('只有分镜分类里的镜头内容 kind 参与编号；text/panorama/scene3d/output 永不编号', () => {
    for (const kind of ['image', 'video', 'shot', 'keyframe'] as const) {
      expect(isShotNumberedNode(makeNode({ id: kind, kind }))).toBe(true)
    }
    for (const kind of ['text', 'panorama', 'scene3d', 'output', 'character', 'scene'] as const) {
      expect(isShotNumberedNode(makeNode({ id: kind, kind }))).toBe(false)
    }
    // 同 kind 不在分镜分类 → 不编号
    expect(isShotNumberedNode(makeNode({ id: 'img', kind: 'image', categoryId: 'scene' }))).toBe(false)
  })

  it('身份标记不占号：referenceSheet（参考卡）与 storyboardKeyframe（图片+视频首帧图）都跳过', () => {
    const ref = { ...makeNode({ id: 'ref', kind: 'image' }), meta: { referenceSheet: true } }
    const keyframe = { ...makeNode({ id: 'kf', kind: 'image' }), meta: { storyboardKeyframe: true } }
    expect(isShotNumberedNode(ref)).toBe(false)
    expect(isShotNumberedNode(keyframe)).toBe(false)
  })

  it('nextShotIndex = 现存最大编号 + 1，删除留空号不复用', () => {
    expect(nextShotIndex([])).toBe(1)
    const nodes = [
      makeNode({ id: 'a', kind: 'image', shotIndex: 1 }),
      makeNode({ id: 'c', kind: 'video', shotIndex: 7 }),
    ]
    expect(nextShotIndex(nodes)).toBe(8)
  })

  it('backfill 幂等：已有编号原样保留，缺号按 (y,x,id) 确定性续编', () => {
    const nodes = [
      makeNode({ id: 'kept', kind: 'image', shotIndex: 3, x: 999, y: 999 }),
      makeNode({ id: 'b-row2', kind: 'video', x: 0, y: 100 }),
      makeNode({ id: 'a-row1-right', kind: 'image', x: 200, y: 0 }),
      makeNode({ id: 'a-row1-left', kind: 'image', x: 0, y: 0 }),
      makeNode({ id: 'txt', kind: 'text' }),
    ]
    const first = backfillShotIndexes(nodes)
    expect(first.changed).toBe(true)
    const byId = new Map(first.nodes.map((node) => [node.id, node.shotIndex]))
    expect(byId.get('kept')).toBe(3)
    expect(byId.get('a-row1-left')).toBe(4)
    expect(byId.get('a-row1-right')).toBe(5)
    expect(byId.get('b-row2')).toBe(6)
    expect(byId.get('txt')).toBeUndefined()

    const second = backfillShotIndexes(first.nodes)
    expect(second.changed).toBe(false)
  })

  it('store：加无关节点（text/panorama）不改写既有镜头编号——A2 的核心症状', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })

    const shot1 = useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots' })
    const shot2 = useGenerationCanvasStore.getState().addNode({ kind: 'video', categoryId: 'shots' })
    expect(shot1.shotIndex).toBe(1)
    expect(shot2.shotIndex).toBe(2)

    // 加 text 和 panorama（旧实现里它们会挤进编号序列并把既有编号顶后）
    useGenerationCanvasStore.getState().addNode({ kind: 'text', categoryId: 'shots' })
    useGenerationCanvasStore.getState().addNode({ kind: 'panorama' })

    const nodes = useGenerationCanvasStore.getState().nodes
    expect(nodes.find((n) => n.id === shot1.id)?.shotIndex).toBe(1)
    expect(nodes.find((n) => n.id === shot2.id)?.shotIndex).toBe(2)
    // 后续镜头继续顺延，不受无关节点影响
    const shot3 = useGenerationCanvasStore.getState().addNode({ kind: 'image', categoryId: 'shots' })
    expect(shot3.shotIndex).toBe(3)
  })
})
