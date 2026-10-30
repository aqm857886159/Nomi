import { describe, expect, it } from 'vitest'
import { verifyGeneratedShots, type ShotVerifyDeps, type ShotVerifyInput } from './shotVerifyRunner'

// Acceptance: absent review evidence must never be indistinguishable from an assessed pass.
const shot: ShotVerifyInput = {
  shotNodeId: 'review-evidence-shot',
  shotTitle: 'A lamp on a table',
  shotPrompt: 'One clay lamp on a wooden table.',
  anchorDescriptions: [],
  frameSourceUrl: 'nomi-local://review-frame.png',
  isVideo: false,
}
const passingDeps = (): ShotVerifyDeps => ({
  extractFrame: async () => 'nomi-local://review-frame.png',
  judge: async () => JSON.stringify({ scores: { identity: 5, composition: 5 }, reason: 'Matches the requested frame.' }),
  visionAvailable: () => true,
})

describe('review evidence distinguishes unavailable assessment from pass', () => {
  it.each(['vision-unavailable', 'judge-rejected', 'invalid-json', 'video-extraction-rejected'] as const)(
    'retains an explicit unreviewed outcome for %s',
    async (failure) => {
      const deps = passingDeps()
      const input = { ...shot }
      if (failure === 'vision-unavailable') deps.visionAvailable = () => false
      if (failure === 'judge-rejected') deps.judge = async () => { throw new Error('provider unavailable') }
      if (failure === 'invalid-json') deps.judge = async () => 'not a review verdict'
      if (failure === 'video-extraction-rejected') {
        input.isVideo = true
        deps.extractFrame = async () => { throw new Error('frame extraction failed') }
      }
      const actualPass = await verifyGeneratedShots([shot], passingDeps())
      const missingEvidence = await verifyGeneratedShots([input], deps)
      expect(actualPass.deviations).toEqual([])
      expect(actualPass.assessments).toEqual([expect.objectContaining({ shotNodeId: shot.shotNodeId, assessed: true, dimensions: ['identity', 'composition'], scope: 'single-frame' })])
      expect(missingEvidence.deviations).toEqual([])
      expect(missingEvidence.assessments).toEqual([expect.objectContaining({ shotNodeId: shot.shotNodeId, assessed: false, dimensions: [] })])
    },
  )
})

it.each(['{}', '{"scores":{"identity":0,"composition":0}}', '{"scores":{"identity":null,"composition":"invalid"}}'])(
  'does not assess absent/zero/invalid dimensions: %s', async raw => {
    const result = await verifyGeneratedShots([shot], { ...passingDeps(), judge: async () => raw });
    expect(result.deviations).toEqual([]);
    expect(result.assessments).toEqual([expect.objectContaining({ assessed: false, dimensions: [] })]);
  }
);
it('records only the actually assessable dimensions without claiming temporal review', async () => {
  const result = await verifyGeneratedShots([shot], { ...passingDeps(), judge: async () => '{"scores":{"identity":0,"composition":5}}' });
  expect(result.assessments).toEqual([expect.objectContaining({ assessed: true, dimensions: ['composition'], scope: 'single-frame' })]);
});

it('retains successful and unavailable shots independently in a partial review', async () => {
  const result = await verifyGeneratedShots([shot, { ...shot, shotNodeId: 'no-frame', frameSourceUrl: '' }], passingDeps());
  expect(result.assessments).toEqual([expect.objectContaining({ shotNodeId: shot.shotNodeId, assessed: true }), expect.objectContaining({ shotNodeId: 'no-frame', assessed: false })]);
});
