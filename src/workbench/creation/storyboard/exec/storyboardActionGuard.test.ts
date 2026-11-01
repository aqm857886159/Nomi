import { beforeEach, expect, it } from 'vitest'
import { createStoryboardActionGuard } from './storyboardActionGuard'
import { autoReferenceFromCanvas } from './storyboardAutoReference'
import { useGenerationCanvasStore } from '../../../generationCanvas/store/generationCanvasStore'
import { useGenerationQueueStore } from '../../../generationCanvas/runner/generationQueueStore'
import type { StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'

const plan = (): StoryboardPlan => ({ title: 'Story', anchors: [{ id: 'a', name: 'Actor', kind: 'character', carrier: 'visual', description: 'Actor' }],
  shots: [1, 2, 3].map(index => ({ index, shotId: `s${index}`, shotKind: index === 3 ? 'video' : 'image', ...(index === 3 ? { keyframe: { enabled: true } } : {}), anchorIds: ['a'], durationSec: 2, prompt: 'Actor walks', modelKey: 'seedance-2-5', modelVendor: 'kie', modeId: 't2v' })) })
const nodes = (): GenerationCanvasNode[] => [
  { id: 'anchor', kind: 'image', title: 'Actor', position: { x: 0, y: 0 }, meta: { anchorId: 'a', storyboardDesignId: 'design' }, result: { id: 'r', type: 'image', url: 'https://fixture.invalid/actor.png', createdAt: 1 } },
  ...[1, 2, 3].map(index => ({ id: `n${index}`, kind: 'image' as const, title: 'Shot', position: { x: 0, y: 0 }, meta: { storyboardDesignId: 'design', shotId: `s${index}` } })),
  { id: 'keyframe', kind: 'image', title: 'Frame', position: { x: 0, y: 0 }, meta: { storyboardDesignId: 'design', shotId: 's3', storyboardKeyframe: true } },
]
beforeEach(() => {
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: nodes(), edges: [], groups: [], selectedNodeIds: [] })
})
it('A9/A10: approval scopes global fields and references plus selected shots; runtime scopes only its own row, including keyframes', async () => {
  let current = plan()
  const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: ['s1'], readPlan: async () => current, writePlan: next => { current = next } })
  current = { ...current, shots: current.shots.map(s => s.shotId === 's3' ? { ...s, prompt: 'Changed' } : s) }
  await expect(guard.assertCurrent()).resolves.toBeUndefined()
  const graph = { nodes: nodes(), edges: [] }
  await expect(guard.assertAuthorCurrent(graph, 'n1')).resolves.toBeUndefined()
  await expect(guard.assertAuthorCurrent(graph, 'n3')).rejects.toThrow('storyboard_content_conflict')
  await expect(guard.assertAuthorCurrent(graph, 'keyframe')).rejects.toThrow('storyboard_content_conflict')
  await expect(guard.assertAuthorCurrent(graph, 'unknown')).resolves.toBeUndefined()
  current = { ...current, title: 'Global changed' }
  await expect(guard.assertCurrent()).rejects.toThrow('storyboard_content_conflict')
})
it('A7: queued main or keyframe nodes stay unchanged; explicit phase refresh is idempotent with the editor effect', async () => {
  let current = plan()
  useGenerationQueueStore.getState().enqueueBatch([['n2', 'keyframe']], 'p')
  const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: ['s1', 's2', 's3'], readPlan: async () => current, writePlan: next => { current = next } })
  const next = await guard.refreshReferences()
  expect(next.shots[0].referenceBindings?.image_ref).toHaveLength(1)
  expect(next.shots[0].modeId).toBe('omni')
  expect(next.shots[1].prompt).toBe('Actor walks')
  expect(next.shots[2].prompt).toBe('Actor walks')
  expect(autoReferenceFromCanvas(current, 'design', nodes(), useGenerationQueueStore.getState().entries)).toBe(current)
  await expect(guard.assertCurrent()).resolves.toBeUndefined()
})

it.each(['selected-spend', 'prompt-only', 'reverse-assets', 'unselected-spend'] as const)('A11: %s is compared after both plans receive automatic references', async change => {
  let current = plan()
  current.anchors.push({ id: 'b', name: 'Shop', kind: 'scene', carrier: 'visual', description: 'Shop' })
  current.shots = current.shots.map(s => ({ ...s, prompt: 'Actor walks into Shop', anchorIds: ['a', 'b'] }))
  const graph = nodes()
  graph.push({ ...graph[0], id: 'shop', meta: { anchorId: 'b', storyboardDesignId: 'design' }, result: { ...graph[0].result!, id: 'shop-result', url: 'https://fixture.invalid/shop.png' } })
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: graph, edges: [], groups: [], selectedNodeIds: [] })
  const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: ['s1', 's2'], readPlan: async () => current, writePlan: next => { current = next } })
  if (change === 'reverse-assets') {
    current = autoReferenceFromCanvas(current, 'design', graph.filter(n => n.id !== 'anchor'), [])
    current = autoReferenceFromCanvas(current, 'design', graph, [])
    expect(current.shots[0].modeId).toBe('omni')
  } else current = { ...current, shots: current.shots.map(s => s.shotId === (change === 'unselected-spend' ? 's3' : 's2')
    ? change === 'prompt-only' ? { ...s, prompt: 'Actor now reads in Shop' } : { ...s, modelKey: 'new-model', params: { resolution: '4k' } } : s) }
  await guard.refreshReferences()
  expect(guard.hasSpendChanges(['s1', 's2'])).toBe(change === 'selected-spend')
  expect(current.shots[1].prompt).toContain(change === 'prompt-only' ? 'now reads' : 'walks')
})

it('A11: exclusion-based comparison includes new shot fields and all global fields except anchors/shots', async () => {
  let current = plan()
  const guard = createStoryboardActionGuard({ plan: current, designId: 'design', shotIds: ['s1'], readPlan: async () => current, writePlan: next => { current = next } })
  current = { ...current, shots: current.shots.map(s => s.shotId === 's1' ? { ...s, futureSpendField: 2 } : s) }
  await guard.refreshReferences()
  expect(guard.hasSpendChanges(['s1'])).toBe(true)
  current = { ...plan(), title: 'New global' }
  await guard.refreshReferences()
  expect(guard.hasSpendChanges(['s1'])).toBe(true)
})
