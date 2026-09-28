import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { readNodeMediaAspectRatio, resolveNodeVisualSize } from '../nodes/nodeSizing'
import { nodeRunOutcomePatch } from './nodeRunOutcome'
import { removeNodeResult } from '../model/nodeResultLifecycle'

const imageResult: GenerationNodeResult = {
  id: 'result-1',
  type: 'image',
  url: 'nomi-local://asset/project/image.png',
  thumbnailUrl: 'nomi-local://asset/project/image.preview.jpg',
  createdAt: Date.now(),
}

function node(): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: 'image',
    prompt: '',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 340 },
    meta: {},
    result: undefined,
    history: [],
    status: 'idle',
  } as GenerationCanvasNode
}

describe('nodeRunOutcomePatch intrinsic media dimensions', () => {
  it('writes original landing dimensions even when the node renders a thumbnail', () => {
    const patch = nodeRunOutcomePatch(node(), {
      kind: 'result',
      result: imageResult,
      mediaDimensions: { width: 1600, height: 900 },
    })

    const landed = { ...node(), ...patch, meta: patch.meta ?? {} } as GenerationCanvasNode
    expect(readNodeMediaAspectRatio(landed)).toBeCloseTo(16 / 9)
    expect(resolveNodeVisualSize(landed).height).toBeCloseTo(resolveNodeVisualSize(landed).width / (16 / 9))
    expect(landed.meta).toMatchObject({ imageWidth: 1600, imageHeight: 900, imageAspectRatio: 16 / 9 })
  })

  it('deduplicates asset-only results through the shared identity owner and keeps monotonic numbers', () => {
    const first = { ...imageResult, id: '', url: undefined, thumbnailUrl: undefined, assetId: 'asset-1', assetRefId: undefined }
    const second = { ...first, createdAt: Date.now() + 1 }
    const withHistory = { ...node(), result: first, history: [first], status: 'success' as const }
    const patch = nodeRunOutcomePatch(withHistory, { kind: 'result', result: second })
    expect(patch.history).toHaveLength(1)
    expect(patch.history?.[0].versionNo).toBe(1)
  })

  it('keeps version numbers monotonic across deletion', () => {
    const make = (id: string): GenerationNodeResult => ({ id, type: 'image', url: `nomi-local://asset/${id}.png`, createdAt: Number(id.slice(1)) })
    let current = node()
    for (const id of ['r1', 'r2', 'r3']) current = { ...current, ...nodeRunOutcomePatch(current, { kind: 'result', result: make(id) }) }
    expect(current.history?.map((entry) => entry.versionNo)).toEqual([3, 2, 1])
    const afterDelete = removeNodeResult(current, 'r2')
    expect(afterDelete?.history?.map((entry) => entry.versionNo)).toEqual([3, 1])
    const afterRegenerate = { ...current, ...afterDelete }
    const next = nodeRunOutcomePatch(afterRegenerate, { kind: 'result', result: make('r4') })
    expect(next.history?.map((entry) => entry.versionNo)).toEqual([4, 3, 1])
  })
})
