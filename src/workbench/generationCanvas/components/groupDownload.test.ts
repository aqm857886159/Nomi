import { describe, expect, it } from 'vitest'
import { groupDownloadTargets } from './groupDownload'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

describe('groupDownloadTargets', () => {
  it('keeps only generated media in group order', () => {
    const nodes = [
      { id: 'a', title: 'A', result: { url: 'nomi-local://a', type: 'image' } },
      { id: 'b', title: 'B', result: { url: 'nomi-local://b', type: 'text' } },
      { id: 'c', title: 'C' },
    ] as GenerationCanvasNode[]
    expect(groupDownloadTargets(nodes, ['c', 'a', 'b'])).toEqual([
      { nodeId: 'a', title: 'A', result: { url: 'nomi-local://a', type: 'image' } },
    ])
  })
})
