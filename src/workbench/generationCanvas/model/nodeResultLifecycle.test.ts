import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import { listNodeMediaResults, listStableNodeMediaResults, removeNodeResult, resultIdentity } from './nodeResultLifecycle'

const image = (id: string, url: string): GenerationNodeResult => ({
  id,
  type: 'image',
  url,
  createdAt: 1,
})

const node = (result: GenerationNodeResult, history: GenerationNodeResult[]): GenerationCanvasNode => ({
  id: 'node-1',
  kind: 'image',
  title: '结果',
  position: { x: 0, y: 0 },
  status: 'success',
  result,
  history,
})

describe('node result lifecycle', () => {
  it('deduplicates primary and history while preserving their display order', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    expect(listNodeMediaResults(node(a, [a, b])).map(resultIdentity)).toEqual(['a', 'b'])
  })

  it('publishes audio and 3D results to assets without adding them to the visual version tray', () => {
    const audio = { id: 'audio', type: 'audio', url: 'audio.mp3', createdAt: 1 } as GenerationNodeResult
    const model = { id: 'mesh', type: 'model3d', url: 'mesh.glb', createdAt: 2 } as GenerationNodeResult
    const mixed = node(model, [audio, model])

    expect(listNodeMediaResults(mixed).map(resultIdentity)).toEqual(['mesh', 'audio'])
    expect(listStableNodeMediaResults(mixed)).toEqual([])
  })

  it('keeps the tray order stable when the current result pointer changes', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const c = image('c', 'c.png')
    const original = node(c, [c, b, a])
    const switched = { ...original, result: a }

    expect(listStableNodeMediaResults(original).map(resultIdentity)).toEqual(['c', 'b', 'a'])
    expect(listStableNodeMediaResults(switched).map(resultIdentity)).toEqual(['c', 'b', 'a'])
  })

  it('removes only the requested result and promotes the next result when needed', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const patch = removeNodeResult(node(a, [a, b]), 'a')
    expect(patch?.result?.id).toBe('b')
    expect(patch?.history?.map(resultIdentity)).toEqual(['b'])
    expect(patch?.status).toBe('success')
  })

  it('preserves non-media history when removing one image', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text, b]), 'a')

    expect(patch?.result).toBe(b)
    expect(patch?.history).toEqual([b, text])
    expect(patch?.status).toBe('success')
  })

  it('keeps non-media history instead of resetting the node when deleting its last image', () => {
    const a = image('a', 'a.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text]), 'a')

    expect(patch).toMatchObject({ result: undefined, history: [text], status: 'idle', error: undefined })
  })

  it('returns the node to idle after its last result is removed', () => {
    const a = image('a', 'a.png')
    const patch = removeNodeResult(node(a, [a]), 'a')
    expect(patch).toMatchObject({ result: undefined, history: [], status: 'idle', error: undefined })
  })
})
