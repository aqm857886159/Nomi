import { afterEach, describe, expect, it } from 'vitest'
import { installDirector3DBoxFace, resetDirector3DBoxFaceForTests } from '../featureFlags/director3dboxFace'
import { projectCanvasRead } from './canvasRead'
import { formatCanvasForAgent } from './canvasReadCompact'

afterEach(() => resetDirector3DBoxFaceForTests())

const canvas = {
  nodes: [
    { id: 'node-v1', kind: 'video', title: '镜头 1', prompt: 'p', position: { x: 0, y: 0 } },
    {
      id: 'node-d1', kind: 'director', title: '3D-BOX 预演', prompt: '', position: { x: 1, y: 0 },
      meta: {
        directorProject: { scenes: [] },
        directorPlan: { revision: 'dplan-0123456789abcdef', issueCount: 2, plan: { scene: { setPieces: [{ id: 'door' }] }, actors: [{ id: 'reader' }, { id: 'friend' }], shots: [{ id: 'wide' }, { id: 'close' }] } },
        directorPreview: { status: 'rendering', targetNodeId: 'node-v1', revision: 'dplan-0123456789abcdef', updatedAt: 1 },
      },
    },
  ],
  edges: [], groups: [], selectedNodeIds: [],
}

describe('look_at_canvas on a 3D-BOX node', () => {
  it('gives revision, shot / actor / set-piece names, issue count and preview state in one line when the flag is on', () => {
    installDirector3DBoxFace(true)
    const result = projectCanvasRead(canvas)
    expect(result.nodes.find((node) => node.id === 'node-d1')?.director).toEqual({
      revision: 'dplan-0123456789abcdef', shots: ['wide', 'close'], actors: ['reader', 'friend'], setPieces: ['door'],
      issueCount: 2, preview: 'rendering', previewTargetNodeId: 'node-v1',
    })
    const line = formatCanvasForAgent(result).split('\n').find((text) => text.startsWith('- node-d1'))
    expect(line).toContain('3D-BOX revision=dplan-0123456789abcdef shots=wide,close actors=reader,friend setPieces=door issues=2 preview=rendering→node-v1')
    expect(line!.length).toBeLessThan(400)
  })

  it('adds nothing when the flag is off', () => {
    installDirector3DBoxFace(false)
    const result = projectCanvasRead(canvas)
    expect(result.nodes.every((node) => node.director === undefined)).toBe(true)
    expect(formatCanvasForAgent(result)).not.toContain('3D-BOX revision')
  })
})

describe('look_at_canvas gives the ready preview asset id', () => {
  it('shows previewAssetId only once the preview is ready', () => {
    installDirector3DBoxFace(true)
    const ready = structuredClone(canvas) as { nodes: Array<{ meta?: Record<string, unknown> }> }
    const meta = ready.nodes[1].meta!
    meta.directorPreview = { ...(meta.directorPreview as Record<string, unknown>), status: 'ready', assetId: 'asset-preview-1' }
    const result = projectCanvasRead(ready)
    expect(result.nodes.find((node) => node.id === 'node-d1')?.director?.previewAssetId).toBe('asset-preview-1')
    expect(formatCanvasForAgent(result)).toContain('preview=ready→node-v1 previewAssetId=asset-preview-1')
    resetDirector3DBoxFaceForTests()
    installDirector3DBoxFace(true)
    expect(projectCanvasRead(canvas).nodes.find((node) => node.id === 'node-d1')?.director?.previewAssetId).toBeUndefined()
  })
})
