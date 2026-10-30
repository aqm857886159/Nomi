import { describe, expect, it } from 'vitest'
import { areRequestedShotsAssessed, isAssessedShotReview, unreviewedShot, type ShotReviewAssessment } from './shotReviewEvidence'

const assessed = (shotNodeId: string): ShotReviewAssessment => ({ shotNodeId, assessed: true, dimensions: ['composition'], unassessedDimensions: ['identity'], scope: 'single-frame' })
describe('shot review evidence admission', () => {
  it('requires nonempty declared assessed dimensions and an explicit limited scope', () => {
    expect(isAssessedShotReview(assessed('a'))).toBe(true)
    expect(isAssessedShotReview(undefined)).toBe(false)
    expect(isAssessedShotReview(unreviewedShot('a', 'unavailable'))).toBe(false)
    for (const patch of [{ dimensions: [] }, { dimensions: ['audio'] }, { dimensions: ['identity', 'identity'] }, { dimensions: ['identity'], unassessedDimensions: ['identity'] }]) {
      expect(isAssessedShotReview({ ...assessed('a'), ...patch })).toBe(false)
    }
  })
  it('rejects omitted, duplicate and unreviewed requested IDs and empty requests', () => {
    expect(areRequestedShotsAssessed([], [])).toBe(false)
    expect(areRequestedShotsAssessed(['a', 'b'], [assessed('a')])).toBe(false)
    expect(areRequestedShotsAssessed(['a'], [assessed('a'), assessed('a')])).toBe(false)
    expect(areRequestedShotsAssessed(['a'], [unreviewedShot('a', 'unavailable')])).toBe(false)
    expect(areRequestedShotsAssessed(['a', 'a'], [assessed('a')])).toBe(true)
  })
})
