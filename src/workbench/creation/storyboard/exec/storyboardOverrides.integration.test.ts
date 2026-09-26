import { applyProposalBatch } from '../../../generationCanvas/agent/proposalTxn'
import { setCanvasEventSinkForTests } from '../../../generationCanvas/events/canvasEventEmitter'
import { applyCanvasEvent } from '../../../generationCanvas/events/canvasEventReducer'
import { useWorkbenchStore } from '../../../workbenchStore'
import { resolveStoryboardOverride } from './storyboardOverrideActions'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { applyCanvasToolCall } from '../../../generationCanvas/agent/applyCanvasToolCall'
import { generateShotRow, materializeShotRow } from './storyboardRowActions'
import { effectiveShotValue } from '../shotRow/shotRowModel'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'

vi.mock('../../../generationCanvas/agent/availableModels', () => ({
  buildAgentModelEntries: () => [],
  listAvailableModelsForAgent: async () => [],
  resolveStoryboardImageDefault: async () => ({}),
  resolveStoryboardVideoDefault: async () => ({}),
}))
const submitted = vi.hoisted(() => ({ prompts: [] as string[] }))
vi.mock('../../../generationCanvas/runner/generationRunController', () => ({
  confirmAndRunNode: async (nodeId: string) => {
    submitted.prompts.push(useGenerationCanvasStore.getState().nodes.find(node => node.id === nodeId)?.prompt ?? '')
  },
  confirmAndRunNodeVariants: vi.fn(),
  regenerateNodeInPlace: vi.fn(),
}))
const shot: PlanShot = { index: 3, shotId: 's3', prompt: '傍晚', durationSec: 5, anchorIds: [] }
const plan: StoryboardPlan = { title: '故事', anchors: [], shots: [shot] }
const ctx = { initiator: 'user' as const, documentId: 'doc', designId: 'design', plan }
function node() { return useGenerationCanvasStore.getState().nodes[0] }
beforeEach(() => {
  submitted.prompts = []
  useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: '故事', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'doc')
  useWorkbenchStore.getState().hydrateStoryboardDesigns({ doc: [{ id: 'design', documentId: 'doc', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ id: 'n3', kind: 'video', title: '第三镜', position: { x: 0, y: 0 }, prompt: '傍晚', meta: { shotId: 's3', storyboardDesignId: 'design' } }], edges: [], groups: [], selectedNodeIds: [] })
})
describe('plan truth and canvas overrides', () => {
  it('Agent edit then generate keeps night instead of silently restoring dusk', async () => {
    await applyCanvasToolCall('set_node_prompt', { nodeId: 'n3', prompt: '夜景' })
    expect(node().meta?.overriddenFields).toEqual(['prompt'])
    await generateShotRow(ctx, shot, null)
    expect(submitted.prompts).toEqual(['夜景'])
    expect(node().prompt).toBe('夜景')
    expect(effectiveShotValue(shot, node(), 'prompt')).toBe('夜景')
  })
  it('manual edits use the same boundary; variants and clamped duration do not override', () => {
    useGenerationCanvasStore.getState().updateNode('n3', { prompt: '夜景' })
    expect(node().meta?.overriddenFields).toEqual(['prompt'])
    useGenerationCanvasStore.getState().updateNode('n3', { meta: { ...node().meta, duration: 4 } })
    expect(node().meta?.overriddenFields).toEqual(['prompt'])
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [{ ...node(), id: 'variant', regeneratedFrom: 'n3', meta: { shotId: 's3', storyboardDesignId: 'design' } }], edges: [], groups: [], selectedNodeIds: [] })
    useGenerationCanvasStore.getState().updateNode('variant', { prompt: '晴天' })
    expect(node().meta?.overriddenFields).toBeUndefined()
  })
  it('an unmarked node is a projection even if its previous prompt differs', async () => {
    expect(effectiveShotValue(shot, node(), 'prompt')).toBe('傍晚')
    await materializeShotRow(ctx, { ...shot, prompt: '清晨' }, null)
    expect(node().prompt).toContain('清晨')
    expect(node().meta?.overriddenFields ?? []).toEqual([])
  })
})

it('plan edits project immediately except marked fields; discard is undoable and adopt clears one field', () => {
  const store = useWorkbenchStore.getState()
  store.setStoryboardPlan({ ...plan, shots: [{ ...shot, prompt: '清晨' }] }, 'doc', 'design')
  expect(node().prompt).toContain('清晨')
  useGenerationCanvasStore.getState().updateNode('n3', { prompt: '夜景' })
  store.setStoryboardPlan(plan, 'doc', 'design')
  expect(node().prompt).toBe('夜景')
  resolveStoryboardOverride('n3', 'prompt', 'discard')
  expect(node().prompt).toContain('傍晚')
  expect(node().meta?.overriddenFields).toEqual([])
  useGenerationCanvasStore.getState().undo()
  expect(node().prompt).toBe('夜景')
  expect(node().meta?.overriddenFields).toEqual(['prompt'])
  resolveStoryboardOverride('n3', 'prompt', 'adopt')
  expect(useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc[0].plan.shots[0].prompt).toBe('夜景')
  expect(node().meta?.overriddenFields).toEqual([])
})

it('aborted Agent edits restore field ownership as well as the prompt', async () => {
  const result = await applyProposalBatch([
    { toolCallId: 'edit', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'n3', prompt: '夜景' } },
    { toolCallId: 'fail', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'missing', prompt: 'x' } },
  ])
  expect(result.status).toBe('aborted')
  expect(node().prompt).toBe('傍晚')
  expect(node().meta?.overriddenFields ?? []).not.toContain('prompt')
})
it('prompt event replay retains the same override ownership as the live node', async () => {
  let replay = { nodes: [structuredClone(node())], edges: [], groups: [] } as Parameters<typeof applyCanvasEvent>[0]
  setCanvasEventSinkForTests(events => { for (const event of events) replay = applyCanvasEvent(replay, event) })
  try {
    await applyCanvasToolCall('set_node_prompt', { nodeId: 'n3', prompt: '夜景' })
    expect(replay.nodes[0].meta).toEqual(node().meta)
  } finally { setCanvasEventSinkForTests(null) }
})

it('plan-bound nodes retain later canvas prompt overrides when the original row generates', async () => {
  const store = useGenerationCanvasStore.getState()
  store.restoreSnapshot({ nodes: [{ id: 'run-node', kind: 'video', title: 'Run shot', position: { x: 0, y: 0 }, prompt: '傍晚', meta: { storyboardDesignId: 'run', shotId: 's3' } }], edges: [], groups: [], selectedNodeIds: [] })
  store.updateNode('run-node', { prompt: '用户画布夜景' })
  await generateShotRow({ ...ctx, designId: 'run' }, shot, null)
  expect(submitted.prompts).toEqual(['用户画布夜景'])
  expect(node().meta?.overriddenFields).toContain('prompt')
})

it('an existing shot materializes and connects a newly referenced visual anchor before generation', async () => {
  const updatedShot = { ...shot, anchorIds: ['new-actor'] }
  const updatedPlan = { ...plan, anchors: [{ id: 'new-actor', kind: 'character' as const, carrier: 'visual' as const, name: 'Actor', description: 'New actor' }], shots: [updatedShot] }
  const mode = null
  await materializeShotRow({ ...ctx, plan: updatedPlan }, updatedShot, mode)
  const canvas = useGenerationCanvasStore.getState()
  const anchorNode = canvas.nodes.find(value => value.meta?.anchorId === 'new-actor')
  expect(anchorNode).toBeDefined()
  expect(canvas.edges.some(edge => edge.source === anchorNode?.id && edge.target === 'n3')).toBe(true)
})

it('Run identity does not grant override ownership to variants, derived nodes, keyframes or partial identities', () => {
  const store = useGenerationCanvasStore.getState()
  for (const spec of [
    { meta: { productionRunId: 'run' } },
    { meta: { productionRunId: 'run', productionShotId: 's3' }, regeneratedFrom: 'original' },
    { meta: { productionRunId: 'run', productionShotId: 's3' }, derivedFrom: 'original' },
    { meta: { productionRunId: 'run', productionShotId: 's3', storyboardKeyframe: true } },
  ]) {
    store.restoreSnapshot({ nodes: [{ id: 'branch', kind: 'video', title: 'Shot 3', position: { x: 0, y: 0 }, prompt: 'Original', ...spec }], edges: [], groups: [], selectedNodeIds: [] })
    store.updateNode('branch', { prompt: 'Independent edit' })
    expect(node().meta?.overriddenFields).toBeUndefined()
  }
})
