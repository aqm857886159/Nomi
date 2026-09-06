import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_SECONDS } from '../../generationCanvas/model/buildClipFromGenerationNode'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { buildStoryboardPlaybackQueue, filterPlanByAnchor, hiddenGeneratingCount, positionsForAnchorFilter, resolveResultTargetShotIndex } from './storyboardDInteractions'
import { duplicateShotAt, insertShotAt } from '../../generationCanvas/agent/storyboardPlanEdits'

const plan: StoryboardPlan = {
  title: 'test',
  anchors: [{ id: 'hero', kind: 'character', name: 'Hero', description: 'hero', carrier: 'visual' }],
  shots: [
    { shotId: 'shot-1', index: 1, sceneId: 'scene-1', durationSec: 0, shotKind: 'image', anchorIds: ['hero'], prompt: 'one' },
    { shotId: 'shot-2', index: 2, sceneId: 'scene-1', durationSec: 6, shotKind: 'video', anchorIds: [], prompt: 'two' },
    { shotId: 'shot-3', index: 3, sceneId: 'scene-1', durationSec: 4, shotKind: 'image', anchorIds: ['hero'], prompt: 'three' },
  ],
  scenes: [{ id: 'scene-1', title: 'Scene' }],
}

function row(position: number, status: StoryboardRowRuntime['exec']['status'], url?: string, audioUrl?: string): StoryboardRowRuntime {
  return {
    shot: plan.shots[position],
    mode: null,
    exec: {
      status,
      node: url ? { id: `node-${position}`, status: 'succeeded', result: { id: `result-${position}`, type: plan.shots[position].shotKind === 'image' ? 'image' : 'video', url, createdAt: 1 }, ...(audioUrl ? { history: [{ id: `audio-${position}`, type: 'audio', url: audioUrl, createdAt: 2 }] } : {}) } as never : null,
      keyframeNode: null,
      recoverableNode: null,
      waitingRefs: [],
      unlockedRefs: [],
      missingSlots: [],
      changedRefs: [],
      resultUrl: url ?? null,
      progressPercent: null,
      progressMessage: null,
      errorMessage: null,
      locked: status === 'locked',
    },
  }
}

describe('storyboard D interaction pure functions', () => {
  it('filters positions by anchor without renumbering the source plan', () => {
    expect(positionsForAnchorFilter(plan, 'hero')).toEqual([0, 2])
    expect(filterPlanByAnchor(plan, 'hero').shots.map((shot) => shot.shotId)).toEqual(['shot-1', 'shot-3'])
    expect(filterPlanByAnchor(plan, 'hero').shots.map((shot) => shot.index)).toEqual([1, 3])
  })

  it('counts generating rows hidden by the active filter', () => {
    expect(hiddenGeneratingCount([row(0, 'ready'), row(1, 'generating'), row(2, 'done', 'image://3')], [0, 2])).toBe(1)
  })

  it('builds an ordered queue with gray placeholders and shared image defaults', () => {
    const queue = buildStoryboardPlaybackQueue([row(0, 'done', 'image://1'), row(1, 'ready'), row(2, 'locked', 'video://3')])
    expect(queue.map((item) => item.mediaUrl)).toEqual(['image://1', null, 'video://3'])
    expect(queue.map((item) => item.playable)).toEqual([true, false, true])
    expect(queue[0].durationSec).toBe(DEFAULT_IMAGE_SECONDS)
    expect(queue[2].durationSec).toBe(4)
  })

  it('keeps a generated audio result attached to the same shot for simultaneous playback', () => {
    const queue = buildStoryboardPlaybackQueue([row(1, 'done', 'video://1', 'audio://1')])
    expect(queue[0]).toMatchObject({ mediaKind: 'video', mediaUrl: 'video://1', audioUrl: 'audio://1', playable: true })
  })

  it('keeps an all-unavailable list as non-playable rows for the empty state', () => {
    const queue = buildStoryboardPlaybackQueue([row(0, 'ready'), row(1, 'failed')])
    expect(queue).toHaveLength(2)
    expect(queue.every((item) => !item.playable)).toBe(true)
  })

  it('resolves the next shot by default but accepts any other shot as target', () => {
    expect(resolveResultTargetShotIndex(plan.shots, 0)).toBe(1)
    expect(resolveResultTargetShotIndex(plan.shots, 0, 2)).toBe(2)
    expect(resolveResultTargetShotIndex(plan.shots, 2)).toBeNull()
  })

  it('inserts a blank shot with the previous shot generation settings and duplicates content with a new identity', () => {
    const inserted = insertShotAt(plan, 1)
    expect(inserted.shots[1]).toMatchObject({ shotKind: 'image', durationSec: DEFAULT_IMAGE_SECONDS, sceneId: 'scene-1', prompt: '' })
    expect(inserted.shots).toHaveLength(4)
    const duplicated = duplicateShotAt(plan, 0)
    expect(duplicated.shots[1]).toMatchObject({ prompt: 'one', anchorIds: ['hero'] })
    expect(duplicated.shots[1].shotId).toBeUndefined()
  })
})
