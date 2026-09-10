import { describe, expect, it } from 'vitest'
import { hasPendingDirectorCameraMoveCapture, hasPendingDirectorStagingCapture } from './directorCaptureHostActivation'
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

describe('directorCaptureHostActivation', () => {
  it('普通 director 节点不挂出片 Host', () => {
    const nodes = [node({ kind: 'director', meta: { directorProject: {} } }), node({ id: 'node-2', kind: 'video' })]
    expect(hasPendingDirectorStagingCapture(nodes)).toBe(false)
    expect(hasPendingDirectorCameraMoveCapture(nodes)).toBe(false)
  })

  it('只有 director 节点带 stagingAutoCapture 才挂站位 Host（image 节点带同名标志不算）', () => {
    expect(hasPendingDirectorStagingCapture([node({ kind: 'image', meta: { stagingAutoCapture: { targetNodeId: 'shot-1' } } })])).toBe(false)
    expect(hasPendingDirectorStagingCapture([node({ kind: 'director', meta: { stagingAutoCapture: { targetNodeId: 'shot-1' } } })])).toBe(true)
  })

  it('只有 director 节点带 cameraMoveAutoCapture 才挂运镜 Host', () => {
    expect(hasPendingDirectorCameraMoveCapture([node({ kind: 'director', meta: { cameraMoveAutoCapture: { targetNodeId: 'shot-1' } } })])).toBe(true)
    expect(hasPendingDirectorCameraMoveCapture([node({ kind: 'director', meta: { cameraMoveAutoCapture: 'x' } })])).toBe(false)
  })
})
