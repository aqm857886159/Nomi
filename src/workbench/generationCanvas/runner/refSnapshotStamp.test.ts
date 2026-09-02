// 提交时上游版本戳（分镜 v5「参考已变」写边界）：跑之前把「这次用了上游哪个 result」
// 记进 meta.refSnapshot——只在真开跑处打（取消花钱确认不打戳），其余 meta 原样保留。
import { beforeEach, describe, expect, it } from 'vitest'
import { stampUpstreamRefSnapshot } from './refSnapshotStamp'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'

function nodeOf(partial: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return { kind: 'video', title: '', position: { x: 0, y: 0 }, ...partial } as GenerationCanvasNode
}

function seed(nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[]): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges, selectedNodeIds: [], groups: [] })
}

function metaOf(id: string): Record<string, unknown> | undefined {
  return useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)?.meta as Record<string, unknown> | undefined
}

describe('stampUpstreamRefSnapshot', () => {
  beforeEach(() => {
    setCanvasEventSinkForTests(() => {})
    seed([], [])
  })

  it('入边上游有 result → 记 sourceNodeId→resultId；没出图的上游不记；其余 meta 原样', () => {
    seed(
      [
        nodeOf({ id: 'anchor', result: { id: 'r-a', type: 'image', url: 'nomi-local://a.png', createdAt: 1 } }),
        nodeOf({ id: 'bare' }),
        nodeOf({ id: 'shot', meta: { shotId: 'shot-1', frozen: { at: 1, by: 'user' } } }),
      ],
      [
        { id: 'e1', source: 'anchor', target: 'shot', mode: 'character_ref' },
        { id: 'e2', source: 'bare', target: 'shot', mode: 'reference' },
      ],
    )
    stampUpstreamRefSnapshot('shot', useGenerationCanvasStore.getState())
    expect(metaOf('shot')).toMatchObject({
      shotId: 'shot-1',
      frozen: { at: 1, by: 'user' },
      refSnapshot: { anchor: 'r-a' },
    })
  })

  it('无上游版本且无旧戳 → 不写 meta（零 churn）；有旧戳但边已断 → 删戳（诚实）', () => {
    seed([nodeOf({ id: 'solo' })], [])
    stampUpstreamRefSnapshot('solo', useGenerationCanvasStore.getState())
    expect(metaOf('solo')).toBeUndefined()

    seed([nodeOf({ id: 'orphan', meta: { refSnapshot: { gone: 'r-x' }, keep: 1 } })], [])
    stampUpstreamRefSnapshot('orphan', useGenerationCanvasStore.getState())
    expect(metaOf('orphan')).toEqual({ keep: 1 })
  })
})
