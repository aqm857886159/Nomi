import { beforeEach, expect, it, vi } from 'vitest'
import { runStoryboardBatch, regenerateShotRow, generateShotRow, generateAnchorCard } from './storyboardRowActions'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../../../generationCanvas/spend/spendConfirm'
import { getActiveCanvasGestureContext, withCanvasGestureContext, type CanvasGestureContext } from '../../../generationCanvas/events/canvasGestureContext'
import { deriveStoryboardRowRuntimes } from './storyboardRowStatus'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { buildAgentModelEntries } from '../../../generationCanvas/agent/availableModels'
import type { ModelOption } from '../../../../config/models'

const calls = vi.hoisted(() => ({ gestures: [] as unknown[], confirm: vi.fn(), single: vi.fn(), regenerate: vi.fn(), onDefaults: vi.fn(), catalog: [] as unknown[] }))
vi.mock('../../../generationCanvas/components/batchPlanPreview', () => ({ confirmAndRunPlan: calls.confirm }))
vi.mock('../../../generationCanvas/runner/generationRunController', () => ({ confirmAndRunNode: calls.single, regenerateNodeInPlace: calls.regenerate }))
vi.mock('../../../generationCanvas/agent/availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('../../../generationCanvas/agent/availableModels')>(),
  resolveStoryboardImageDefault: async () => { calls.onDefaults(); return {} }, resolveStoryboardVideoDefault: async () => ({}), listAvailableModelsForAgent: async () => calls.catalog,
}))
vi.mock('../../../generationCanvas/agent/applyCanvasToolCall', () => ({
  applyCanvasToolCall: async (_tool: string, args: { nodes: { clientId: string; storyboardKeyframe?: boolean; metadata?: Record<string, unknown> }[] }, gesture?: CanvasGestureContext) => {
    calls.gestures.push(gesture)
    expect(getActiveCanvasGestureContext()).toBeNull()
    const write = () => {
      const clientIdToNodeId: Record<string, string> = {}
      for (const node of args.nodes) {
        clientIdToNodeId[node.clientId] = useGenerationCanvasStore.getState().addNode({ kind: 'image', meta: { ...node.metadata, ...(node.storyboardKeyframe ? { storyboardKeyframe: true } : {}) } }).id
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
  calls.single.mockReset()
  calls.regenerate.mockReset()
  calls.onDefaults.mockReset()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useSpendConfirmStore.setState({ pending: null, queue: [], requestConfirm: async () => true })
})

it('does not materialize or dispatch anything when the batch confirmation is cancelled', async () => {
  useSpendConfirmStore.setState({ requestConfirm: async () => {
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
    return false
  } })
  const shot = { index: 1, shotId: 'cancelled', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }
  const outcome = await runStoryboardBatch(
    { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] } },
    runtimeRows([shot]),
  )
  expect(outcome).toBe('declined')
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(calls.gestures).toHaveLength(0)
})

it('does not dispatch an item removed from the confirmation checklist', async () => {
  useSpendConfirmStore.setState({ requestConfirm: async (request) => {
    const firstShot = request.planRows?.find((row) => row.id?.startsWith('shot:'))
    if (firstShot) request.onPlanToggle?.(firstShot, false)
    return true
  } })
  const shots = [1, 2].map((index) => ({ index, shotId: `unchecked-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }))
  await runStoryboardBatch(
    { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots } },
    runtimeRows(shots),
  )
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.confirm.mock.calls[0][0].waves.flat()).toHaveLength(1)
})

it('stops before shot dispatch when a selected reference card has no result', async () => {
  const anchor = { id: 'actor', kind: 'character' as const, carrier: 'visual' as const, name: 'Actor', description: 'Actor' }
  const shot = { index: 1, shotId: 'needs-actor', shotKind: 'image' as const, durationSec: 2, anchorIds: ['actor'], prompt: 'Door' }
  await runStoryboardBatch(
    { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [anchor], shots: [shot] } },
    runtimeRows([shot]),
  )
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  expect(calls.confirm).toHaveBeenCalledOnce()
  expect(calls.confirm.mock.calls[0][0].waves.flat()).toHaveLength(1)
})

it('dispatches selected reference cards before the shots that consume them', async () => {
  const anchor = { id: 'actor', kind: 'character' as const, carrier: 'visual' as const, name: 'Actor', description: 'Actor' }
  const shot = { index: 1, shotId: 'ordered-shot', shotKind: 'image' as const, durationSec: 2, anchorIds: ['actor'], prompt: 'Door' }
  calls.confirm.mockImplementation(async (request: { waves: readonly (readonly string[])[] }) => {
    const node = useGenerationCanvasStore.getState().nodes.find((candidate) => (candidate.meta as Record<string, unknown>).anchorId === 'actor')
    if (node) useGenerationCanvasStore.getState().updateNode(node.id, { result: { id: 'actor-result', createdAt: 1, type: 'image', url: 'https://fixture.invalid/actor.png' } })
    return 'started'
  })
  await runStoryboardBatch(
    { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [anchor], shots: [shot] } },
    runtimeRows([shot]),
  )
  expect(calls.confirm).toHaveBeenCalledTimes(2)
  expect(calls.confirm.mock.calls[0][0].waves.flat()).toHaveLength(1)
  expect(calls.confirm.mock.calls[1][0].waves.flat()).toHaveLength(1)
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
})

it('lands selected rows under one explicit transaction, groups them and undoes the whole batch', async () => {
  const shots = [1, 2].map(index => ({ index, shotId: `fact-source-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }))
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots } },
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
  await expect(runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] } },
    runtimeRows([shot]), { groupTitle: 'Reference' })).rejects.toThrow()
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('preserves existing user groups when selecting previously materialized rows', async () => {
  const shots = [1, 2].map(index => ({ index, shotId: `existing-${index}`, shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }))
  const store = useGenerationCanvasStore.getState()
  const nodes = shots.map(shot => store.addNode({ kind: 'image', meta: { storyboardDesignId: 'design', shotId: shot.shotId } }))
  const groups = nodes.map((node, index) => store.createGroup('shots', `User group ${index}`, { nodeIds: [node.id] })!)
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots } },
    runtimeRows(shots), { groupTitle: 'Reference' })
  expect(useGenerationCanvasStore.getState().groups.map(group => ({ id: group.id, nodeIds: group.nodeIds })))
    .toEqual(groups.map(group => ({ id: group.id, nodeIds: group.nodeIds })))
})

it('explicit placement is free and repeating it preserves user edits, results and groups', async () => {
  const shot = { index: 1, shotId: 'placed', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }
  const ctx = { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] } }
  const placement = { groupTitle: 'Reference', placementOnly: true }
  await runStoryboardBatch(ctx, runtimeRows([shot]), placement)
  expect(calls.confirm).not.toHaveBeenCalled()
  const store = useGenerationCanvasStore.getState()
  const id = store.nodes[0].id
  store.updateNode(id, { prompt: 'User edit', result: { id: 'fixture-result', createdAt: 1, type: 'image', url: 'https://fixture.invalid/result.png' } })
  const before = structuredClone({ nodes: useGenerationCanvasStore.getState().nodes, groups: useGenerationCanvasStore.getState().groups })
  await runStoryboardBatch(ctx, runtimeRows([shot]), placement)
  expect({ nodes: useGenerationCanvasStore.getState().nodes, groups: useGenerationCanvasStore.getState().groups }).toEqual(before)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it.each([0,1])('placement includes unused visual anchors with %i shots in the same group and one undo restores the empty canvas', async (shotCount) => {
  const shots = shotCount ? [{ index: 1, shotId: 'one', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }] : []
  const plan = { title: 'Reference', anchors: [{ id: 'anchor', kind: 'character' as const, carrier: 'visual' as const, name: 'Actor', description: 'Actor' }], shots }
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan }, runtimeRows(shots), { groupTitle: plan.title, placementOnly: true })
  const store = useGenerationCanvasStore.getState()
  expect(store.nodes).toHaveLength(shotCount + 1)
  expect(store.groups[0].nodeIds).toHaveLength(shotCount + 1)
  expect(calls.confirm).not.toHaveBeenCalled()
  store.undo()
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(useGenerationCanvasStore.getState().groups).toHaveLength(0)
})

it('placement respects the captured project guard across model lookup', async () => {
  const shot = { index: 1, shotId: 'one', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Door' }
  let current = true
  calls.onDefaults.mockImplementationOnce(() => { current = false })
  await expect(runStoryboardBatch({ documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] }, gesture: { source: 'user', txnId: 'origin', canWrite: () => current } },
    runtimeRows([shot]), { groupTitle: 'Reference', placementOnly: true })).rejects.toThrow()
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(0)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('placement fills a missing keyframe without duplicating or rewriting its existing shot', async () => {
  const shot = { index: 1, shotId: 'video', shotKind: 'video' as const, keyframe: { enabled: true }, durationSec: 5, anchorIds: [], prompt: 'Original' }
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'video', prompt: 'User edited', meta: { storyboardDesignId: 'design', shotId: 'video' } })
  const before = structuredClone(useGenerationCanvasStore.getState().nodes.find(value => value.id === node.id))
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'design', plan: { title: 'Reference', anchors: [], shots: [shot] } }, runtimeRows([shot]), { groupTitle: 'Reference', placementOnly: true })
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(2)
  expect(useGenerationCanvasStore.getState().nodes.find(value => value.id === node.id)).toEqual(before)
  expect(calls.confirm).not.toHaveBeenCalled()
})


it('reuses the node already bound to this plan instead of duplicating it', async () => {
  const shot = { index: 1, shotId: 'run-shot', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Author' }
  useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'Canvas override', meta: { storyboardDesignId: 'run', shotId: 'run-shot' } })
  const before = structuredClone(useGenerationCanvasStore.getState().nodes)
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [], shots: [shot] } }, runtimeRows([shot]), { groupTitle: 'Run', placementOnly: true })
  expect(useGenerationCanvasStore.getState().nodes).toEqual(before)
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('keeps the bound node and its canvas override across repeated placements', async () => {
  const shot = { index: 1, shotId: 'durable-shot', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Original author' }
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'Canvas override', meta: { storyboardDesignId: 'run', shotId: shot.shotId } })
  const plan = { title: 'Run', anchors: [], shots: [shot] }
  const rows = deriveStoryboardRowRuntimes({ plan, designId: 'run', nodes: useGenerationCanvasStore.getState().nodes, imageModelOptions: [], videoModelOptions: [] })
  expect(rows[0].exec.node?.id).toBe(node.id)
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan }, rows, { groupTitle: 'Run', placementOnly: true })
  await runStoryboardBatch({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan }, rows, { groupTitle: 'Run', placementOnly: true })
  expect(useGenerationCanvasStore.getState().nodes.map(value => value.id)).toEqual([node.id])
  expect(useGenerationCanvasStore.getState().nodes[0].prompt).toBe('Canvas override')
  expect(calls.confirm).not.toHaveBeenCalled()
})

it('finds a newly materialized shot through its own metadata on the next call', async () => {
  const shot = { index: 1, shotId: 'new-run-shot', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Author' }
  const plan = { title: 'Run', anchors: [], shots: [shot] }
  const rows = deriveStoryboardRowRuntimes({ plan, designId: 'run', nodes: [], imageModelOptions: [], videoModelOptions: [] })
  const context = { initiator: 'user' as const, documentId: 'doc', designId: 'run', plan }
  await runStoryboardBatch(context, rows, { groupTitle: 'Run', placementOnly: true })
  const first = useGenerationCanvasStore.getState().nodes[0].id
  await runStoryboardBatch(context, rows, { groupTitle: 'Run', placementOnly: true })
  expect(useGenerationCanvasStore.getState().nodes.map(value => value.id)).toEqual([first])
})


it('bound row actions keep single-shot and regeneration on the original runner', async () => {
  const shot = { index: 1, shotId: 'action-shot', shotKind: 'image' as const, durationSec: 2, anchorIds: [], prompt: 'Updated author prompt' }
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'Old prompt', meta: { storyboardDesignId: 'run', shotId: 'action-shot' } })
  const assertCurrent = vi.fn().mockResolvedValue(undefined)
  const context = { initiator: 'user' as const, assertCurrent, assertAuthorCurrent: assertCurrent, documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [], shots: [shot] } }
  await generateShotRow(context, shot, null)
  await regenerateShotRow(context, shot, node, null)
  expect(calls.single).toHaveBeenCalledWith(node.id, { assertCurrent, assertAuthorCurrent: assertCurrent, initiator: 'user' })
  expect(calls.regenerate).toHaveBeenCalledWith(node.id, { assertCurrent, assertAuthorCurrent: assertCurrent, initiator: 'user' })
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  expect(useGenerationCanvasStore.getState().nodes[0].prompt).toContain('Updated author prompt')
})

it('a bound anchor action reuses that anchor node and the original single runner', async () => {
  const anchor = { id: 'actor', kind: 'character' as const, carrier: 'visual' as const, name: 'Actor', description: 'New description' }
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'Old description', meta: { storyboardDesignId: 'run', anchorId: 'actor' } })
  await generateAnchorCard({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [anchor], shots: [] } }, anchor)
  expect(calls.single).toHaveBeenCalledWith(node.id, { initiator: 'user' })
  expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  // Agent 替他点的同一张锚卡（presentStoryboard 的 gesture.source='agent'）：来源必须原样报给付费判据，
  // 否则「单个节点不弹窗」会把 Agent 的付费也放过去。
  calls.single.mockClear()
  await generateAnchorCard({ documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [anchor], shots: [] },
    gesture: { source: 'agent', txnId: 'agent-present', canWrite: () => true } }, anchor)
  expect(calls.single).toHaveBeenCalledWith(node.id, { initiator: 'agent' })
  expect(useGenerationCanvasStore.getState().nodes[0].prompt).toContain('New description')
})

it('参考卡改了模型 / 参数再生成：节点跟着用卡上选的模型与参数（审计 A2：界面说的 = 发出的）', async () => {
  const anchor = {
    id: 'hero', kind: 'character' as const, carrier: 'visual' as const, name: 'Hero', description: 'Short hair',
    modelKey: 'gpt-image-2', modelVendor: 'apimart', params: { aspect_ratio: '3:4' },
  }
  const node = useGenerationCanvasStore.getState().addNode({
    kind: 'image', prompt: 'Old', meta: { storyboardDesignId: 'run', anchorId: 'hero', modelKey: 'nano-banana-2', modelVendor: 'kie' },
  })
  calls.catalog = buildAgentModelEntries([{ value: 'gpt-image-2', label: 'GPT Image 2', vendor: 'apimart', modelKey: 'gpt-image-2', kind: 'image' } as ModelOption])
  try {
    await generateAnchorCard({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [anchor], shots: [] } }, anchor)
  } finally { calls.catalog = [] }
  const meta = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!.meta as Record<string, unknown>
  expect(meta.modelKey).toBe('gpt-image-2')
  expect(meta.modelVendor).toBe('apimart')
  expect(meta.aspect_ratio).toBe('3:4')
  expect(meta.anchorId).toBe('hero')
})

it('参考卡换成「只靠目录元数据认档案」的模型（自建中转 / 导入 / 回环夹具）再重试：节点也跟着换（2026-10-06 真 App 审计走查实测）', async () => {
  const anchor = {
    id: 'hero', kind: 'character' as const, carrier: 'visual' as const, name: 'Hero', description: 'Short hair',
    modelKey: 'relay-image', modelVendor: 'my-relay',
  }
  const node = useGenerationCanvasStore.getState().addNode({
    kind: 'image', prompt: 'Old', meta: { storyboardDesignId: 'run', anchorId: 'hero', modelKey: 'gpt-image-2', modelVendor: 'apimart' },
  })
  // 档案只能从目录行的 meta.archetypeId 认出来：拿 (modelKey, vendor) 现拼一条认不出，写回会是空的。
  calls.catalog = buildAgentModelEntries([{ value: 'relay-image', label: 'Relay Image', vendor: 'my-relay', modelKey: 'relay-image', kind: 'image', meta: { archetypeId: 'agnes-image' } } as ModelOption])
  expect(calls.catalog).toHaveLength(1)
  try {
    await generateAnchorCard({ initiator: 'user' as const, documentId: 'doc', designId: 'run', plan: { title: 'Run', anchors: [anchor], shots: [] } }, anchor)
  } finally { calls.catalog = [] }
  const meta = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === node.id)!.meta as Record<string, unknown>
  expect(meta.modelKey).toBe('relay-image')
  expect(meta.modelVendor).toBe('my-relay')
  expect((meta.archetype as { id: string }).id).toBe('agnes-image')
})
