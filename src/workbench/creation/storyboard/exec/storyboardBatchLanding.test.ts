import { beforeEach, expect, it, vi } from 'vitest'
import { runStoryboardBatch } from './storyboardRowActions'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { getActiveCanvasGestureContext, withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'

const calls = vi.hoisted(() => ({ gestures: [] as unknown[], confirm: vi.fn(), onDefaults: vi.fn() }))
vi.mock('../../../generationCanvas/components/batchPlanPreview', () => ({ confirmAndRunPlan: calls.confirm }))
vi.mock('../../../generationCanvas/agent/availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('../../../generationCanvas/agent/availableModels')>(),
  resolveStoryboardImageDefault: async () => { calls.onDefaults(); return {} }, resolveStoryboardVideoDefault: async () => ({}), listAvailableModelsForAgent: async () => [],
}))
vi.mock('../../../generationCanvas/agent/applyCanvasToolCall', () => ({
  applyCanvasToolCall: async (_tool: string, args: { nodes: { clientId: string; metadata?: Record<string, unknown> }[] }, gesture?: CanvasGestureContext) => {
    calls.gestures.push(gesture)
    expect(getActiveCanvasGestureContext()).toBeNull()
    const write = () => {
      const clientIdToNodeId: Record<string, string> = {}
      for (const node of args.nodes) {
        clientIdToNodeId[node.clientId] = useGenerationCanvasStore.getState().addNode({ kind: 'image', meta: node.metadata }).id
      }
      return { clientIdToNodeId }
    }
    return gesture ? withCanvasGestureContext(gesture, write) : write()
  },
}))

function runtimeRows(shots: PlanShot[]) {
  return deriveStoryboardRowRuntimes({ plan: { title: 'Reference', anchors: [], shots }, designId: 'design',
    nodes: useGenerationCanvasStore.getState().nodes, imageModelOptions: [], videoModelOptions: [] })
}

beforeEach(() => {
  calls.gestures.length = 0
  calls.confirm.mockReset()
  calls.onDefaults.mockReset()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})

it('lands selected rows under one explicit transaction, groups them and undoes the whole batch', async () => {
  const shots = [1, 2].map(index => ({ index, shotId: `fact-source-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }))
  await runStoryboardBatch({ documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots } },
    runtimeRows(shots), { groupTitle: 'Reference' })
  const state = useGenerationCanvasStore.getState()
  expect(state.nodes).toHaveLength(2)
  expect(state.groups).toHaveLength(1)
  expect(state.groups[0].nodeIds).toHaveLength(2)
  expect(new Set(calls.gestures.map(value => (value as CanvasGestureContext).txnId)).size).toBe(1)
  expect(calls.gestures.every(value => (value as CanvasGestureContext).suppressUndoBarriers)).toBe(true)
  expect(calls.confirm).toHaveBeenCalledOnce()
  state.undo()
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(useGenerationCanvasStore.getState().groups).toHaveLength(0)
})


it('does not write into a replacement canvas while awaiting defaults', async () => {
  const shot = { index: 1, shotId: 'one', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }
  calls.onDefaults.mockImplementationOnce(() => useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }))
  await expect(runStoryboardBatch({ documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] } },
    runtimeRows([shot]), { groupTitle: 'Reference' })).rejects.toThrow()
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('preserves existing user groups when selecting previously materialized rows', async () => {
  const shots = [1, 2].map(index => ({ index, shotId: `existing-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }))
  const store = useGenerationCanvasStore.getState()
  const nodes = shots.map(shot => store.addNode({ kind: 'image', meta: { storyboardDesignId: 'design', shotId: shot.shotId } }))
  const groups = nodes.map((node, index) => store.createGroup('shots', `User group ${index}`, { nodeIds: [node.id] })!)
  await runStoryboardBatch({ documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots } },
    runtimeRows(shots), { groupTitle: 'Reference' })
  expect(useGenerationCanvasStore.getState().groups.map(group => ({ id: group.id, nodeIds: group.nodeIds })))
    .toEqual(groups.map(group => ({ id: group.id, nodeIds: group.nodeIds })))
})
