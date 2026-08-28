import { describe, expect, it } from 'vitest'

import {
  findMatchingCandidateStoryboard,
  storyboardDesignNeedsSync,
  storyboardPlanContentHash,
  storyboardPlanSourceMatchesApprovedScript,
} from './storyboardPlanGuards'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

const plan = {
  sourceScriptArtifactId: 'artifact-script-v2',
  sourceScriptVersion: 2,
  sourceScriptHash: 'hash-v2',
}

describe('StoryboardPlanEditor provenance guard', () => {
  it('accepts the exact currently adopted script', () => {
    expect(storyboardPlanSourceMatchesApprovedScript(plan, [
      { artifactId: 'artifact-script-v2', kind: 'script', status: 'adopted', version: 2, contentHash: 'hash-v2' },
    ])).toBe(true)
  })

  it('rejects a plan after the script is revised, before creating canvas nodes', () => {
    expect(storyboardPlanSourceMatchesApprovedScript(plan, [
      { artifactId: 'artifact-script-v3', kind: 'script', status: 'adopted', version: 3, contentHash: 'hash-v3' },
    ])).toBe(false)
  })

  it('rejects when a provenance-bearing plan has no approved script', () => {
    expect(storyboardPlanSourceMatchesApprovedScript(plan, [])).toBe(false)
  })

  it('does not require provenance for a local, pre-production plan', () => {
    expect(storyboardPlanSourceMatchesApprovedScript({}, [])).toBe(true)
  })

  it('matches only the candidate artifact with the exact storyboard content hash', async () => {
    const fullPlan: StoryboardPlan = { title: '版本 B', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'B' }] }
    const hash = await storyboardPlanContentHash(fullPlan)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(findMatchingCandidateStoryboard(fullPlan, [
      { artifactId: 'artifact-a', kind: 'storyboard', status: 'candidate', contentHash: '0'.repeat(64) },
      { artifactId: 'artifact-b', kind: 'storyboard', status: 'candidate', contentHash: hash! },
    ])).resolves.toMatchObject({ artifactId: 'artifact-b' })
  })

  it('does not bind a local design to an unrelated production candidate', async () => {
    const fullPlan: StoryboardPlan = { title: '本地版', anchors: [], shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: 'local' }] }
    await expect(findMatchingCandidateStoryboard(fullPlan, [
      { artifactId: 'artifact-other', kind: 'storyboard', status: 'candidate', contentHash: 'f'.repeat(64) },
    ])).resolves.toBeUndefined()
  })

  it('treats a newer source document as needing synchronization', () => {
    expect(storyboardDesignNeedsSync(11, 10)).toBe(true)
    expect(storyboardDesignNeedsSync(10, 10)).toBe(false)
  })
})
