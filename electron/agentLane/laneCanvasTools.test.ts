import { describe, expect, it } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context'
import { createCanvasLaneTools } from './laneCanvasTools'
import { createLaneTools } from './laneTools.mts'
import type { CanvasWriteResult } from '../shared/agentCapabilities/canvasWrite'

describe('canvas write tool result closure', () => {
  it('puts the applied changeId in the model-visible tool result so the next undo turn can settle', async () => {
    const receipt: CanvasWriteResult = {
      applied: true,
      proposalId: 'proposal-1',
      changeId: 'canvas:v1:proposal-1',
      operation: 'create_canvas_nodes',
      affectedNodeIds: ['node-1'],
      affectedEdgeIds: [],
      clientIdToNodeId: { artifact: 'node-1' },
      connectedCount: 0,
      skippedEdges: [],
      reconciliation: { ok: true, deviationCount: 0 },
    }
    const [canvasDescriptor] = createCanvasLaneTools({
      read: async () => ({ nodes: [], edges: [], groups: [] }),
      write: async () => receipt,
    }).filter(tool => tool.name === 'make_artifact')
    if (!canvasDescriptor) throw new Error('make_artifact descriptor missing')
    const [tool] = createLaneTools([canvasDescriptor])
    const result = await tool.execute('call-1', {
      fileType: 'text', title: 'R13_UNDO_CANVAS', content: '真实回合画布撤销',
    }, (() => undefined) as never, undefined, {} as never, BACKGROUND_CONTEXT)
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('')
    expect(text).toContain('changeId=canvas:v1:proposal-1')
    expect(result.details).toMatchObject({ changeId: 'canvas:v1:proposal-1' })
  })

})
