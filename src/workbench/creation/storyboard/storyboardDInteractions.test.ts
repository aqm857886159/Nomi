import { describe, expect, it } from 'vitest'
import { DEFAULT_IMAGE_SECONDS } from '../../generationCanvas/model/buildClipFromGenerationNode'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import type { StoryboardRowRuntime } from './exec/storyboardRowStatus'
import { buildStoryboardPlaybackQueue, filterPlanByAnchor, hiddenGeneratingCount, positionsForAnchorFilter } from './storyboardDInteractions'

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

function row(position: number, status: StoryboardRowRuntime['exec']['status'], url?: string): StoryboardRowRuntime {
  return {
    shot: plan.shots[position],
    mode: null,
    exec: {
      status,
      node: url ? { id: `node-${position}`, status: 'succeeded', result: { id: `result-${position}`, type: plan.shots[position].shotKind === 'image' ? 'image' : 'video', url, createdAt: 1 } } as never : null,
      keyframeNode: null,
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

  it('builds an ordered queue, skips incomplete rows, and uses the shared image default', () => {
    const queue = buildStoryboardPlaybackQueue([row(0, 'done', 'image://1'), row(1, 'ready'), row(2, 'locked', 'video://3')])
    expect(queue.map((item) => item.mediaUrl)).toEqual(['image://1', 'video://3'])
    expect(queue[0].durationSec).toBe(DEFAULT_IMAGE_SECONDS)
    expect(queue[1].durationSec).toBe(4)
  })
})
