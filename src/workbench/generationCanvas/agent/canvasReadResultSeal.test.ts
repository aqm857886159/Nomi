import { describe, expect, it } from 'vitest'

import { projectCanvasRead } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { assertIssuedCanvasReadResult, captureCanvasReadResult } from './canvasReadResultSeal'

const rawSnapshot = () => ({
  nodes: [{
    id: 'node-a',
    kind: 'image',
    title: 'Launch A',
    prompt: 'full launch prompt',
    position: { x: 1, y: 2 },
    result: { id: 'result-a', url: 'https://secret.invalid/result.png', raw: { providerTaskId: 'secret' } },
  }],
  edges: [],
  groups: [],
  selectedNodeIds: ['node-a'],
})

describe('canvas read result seal', () => {
  it('captures one detached, deeply frozen canonical result for submit admission', () => {
    const source = rawSnapshot()
    const captured = captureCanvasReadResult(source)
    source.nodes[0]!.title = 'mutated'

    expect(captured).toEqual(projectCanvasRead(rawSnapshot()))
    expect(captured.nodes[0]?.title).toBe('Launch A')
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.nodes)).toBe(true)
    expect(Object.isFrozen(captured.nodes[0]?.position)).toBe(true)
    expect(captureCanvasReadResult(captured)).toBe(captured)
    expect(() => assertIssuedCanvasReadResult(captured)).not.toThrow()
  })

  it('rejects a structural clone that was not issued by the submit seal', () => {
    const copy = structuredClone(captureCanvasReadResult(rawSnapshot()))
    expect(() => assertIssuedCanvasReadResult(copy)).toThrowError(
      expect.objectContaining({ code: 'canvas_target_stale', message: 'canvas_target_stale' }),
    )
  })
})
