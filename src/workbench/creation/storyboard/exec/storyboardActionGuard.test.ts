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
