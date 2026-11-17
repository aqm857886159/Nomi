import { isGenerationNodeBusy, normalizeCanvasBatchConcurrency } from './canvasProductionScope'
import { useGenerationQueueStore } from '../runner/generationQueueStore'
import { describe, expect, it } from 'vitest'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { hasSelectableCanvasScope, planCanvasGenerationScope } from '../runner/generationScopeFacts'

function node(id: string, kind: GenerationCanvasNode['kind'], status: GenerationCanvasNode['status']): GenerationCanvasNode {
  return { ...createGenerationNode({ id, kind }), status, categoryId: 'shots' }
}

/** 组生成默认勾上的那几个（原 groupEligibleNodeIds：工具条可用态与派发共用，现在都问共用主人）。 */
const groupMembers = (ids: readonly string[], nodes: readonly GenerationCanvasNode[]) =>
  planCanvasGenerationScope('group', ids, { nodes, edges: [] }, { runs: {} }).members

describe('组生成的默认成员（共用主人 group 意图）', () => {
  it('没生成的、失败的默认勾；已生成的不勾；生成中 / 可找回 / 不能生成的不是成员', () => {
    const nodes = [
      node('idle-image', 'image', 'idle'),
      node('error-video', 'video', 'error'),
      node('success', 'image', 'success'),
      node('queued', 'video', 'queued'),
      node('running', 'text', 'running'),
      node('recoverable', 'audio', 'recoverable'),
      node('non-generation', 'whiteboard', 'idle'),
    ]
    expect(groupMembers(nodes.map((item) => item.id), nodes)).toEqual(['idle-image', 'error-video'])
  })

  it('按入口给的顺序，不认识的 id 跳过', () => {
    const nodes = [node('a', 'image', 'idle'), node('b', 'video', 'error'), node('c', 'image', 'idle')]
    expect(groupMembers(['c', 'missing', 'a'], nodes)).toEqual(['c', 'a'])
  })

  it('工具条可用态：有能勾的才可用；空组 / 全在生成中不可用', () => {
    const nodes = [node('a', 'image', 'running'), node('b', 'image', 'recoverable'), node('c', 'image', 'success')]
    expect(hasSelectableCanvasScope('group', ['a', 'b'], nodes, { runs: {} })).toBe(false)
    expect(hasSelectableCanvasScope('group', ['a', 'c'], nodes, { runs: {} })).toBe(true)
    expect(hasSelectableCanvasScope('group', [], nodes, { runs: {} })).toBe(false)
  })
})

describe('canvas batch concurrency', () => {
  it.each([
    [undefined, 6],
    [Number.NaN, 6],
    [0, 1],
    [9, 8],
    [4.9, 4],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCanvasBatchConcurrency(input)).toBe(expected)
  })
})

it('E4: a queued idle node is busy and excluded from both group/list quotes', async () => {
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  const queued = node('queue-actual', 'image', 'idle')
  const batchId = useGenerationQueueStore.getState().enqueueBatch([[queued.id]], 'test-project')
  expect(isGenerationNodeBusy(queued)).toBe(true)
  expect(groupMembers([queued.id], [queued])).toEqual([])
  useGenerationQueueStore.getState().cancelEntry(batchId, queued.id)
  expect(isGenerationNodeBusy(queued)).toBe(false)
  useGenerationQueueStore.setState({ entries: [], batches: {} })
})
