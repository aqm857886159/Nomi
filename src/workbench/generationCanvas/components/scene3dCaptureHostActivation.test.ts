import { describe, expect, it } from 'vitest'
import {
  hasPendingScene3DCameraMoveCapture,
  hasPendingScene3DStagingCapture,
} from './scene3dCaptureHostActivation'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'node-1',
    kind: 'image',
    title: 'node',
    prompt: '',
    position: { x: 0, y: 0 },
    status: 'idle',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as GenerationCanvasNode
}

describe('scene3dCaptureHostActivation', () => {
  it('does not activate capture hosts for ordinary scene3d nodes', () => {
    const nodes = [
      node({ kind: 'scene3d', meta: { scene3dState: {} } }),
      node({ id: 'node-2', kind: 'video' }),
    ]

    expect(hasPendingScene3DStagingCapture(nodes)).toBe(false)
    expect(hasPendingScene3DCameraMoveCapture(nodes)).toBe(false)
  })

  it('activates staging capture only when a scene3d node has a staging auto-capture flag', () => {
    expect(hasPendingScene3DStagingCapture([
      node({ kind: 'image', meta: { stagingAutoCapture: { targetNodeId: 'shot-1' } } }),
    ])).toBe(false)
    expect(hasPendingScene3DStagingCapture([
      node({ kind: 'scene3d', meta: { stagingAutoCapture: { targetNodeId: 'shot-1' } } }),
    ])).toBe(true)
  })

  it('activates camera move capture only when a scene3d node has a camera move flag', () => {
    expect(hasPendingScene3DCameraMoveCapture([
      node({ kind: 'scene3d', meta: { cameraMoveAutoCapture: { targetNodeId: 'shot-1' } } }),
    ])).toBe(true)
  })
})
