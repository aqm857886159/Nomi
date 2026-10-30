/** Explicit evidence for the existing single-frame shot-review chain. */
export type ShotReviewAssessment = {
  shotNodeId: string
  assessed: boolean
  dimensions: string[]
  unassessedDimensions: string[]
  scope: 'single-frame'
  reason?: string
}

/** Missing or malformed evidence never establishes a passing/failed assessment. */
export function isAssessedShotReview(value: ShotReviewAssessment | undefined): boolean {
  const dimensions = new Set(['identity', 'composition', 'continuity'])
  return Boolean(value && value.assessed === true && value.scope === 'single-frame'
    && typeof value.shotNodeId === 'string' && value.shotNodeId.trim()
    && Array.isArray(value.dimensions) && value.dimensions.length > 0
    && value.dimensions.every(key => dimensions.has(key))
    && new Set(value.dimensions).size === value.dimensions.length
    && Array.isArray(value.unassessedDimensions)
    && value.unassessedDimensions.every(key => dimensions.has(key) && !value.dimensions.includes(key)))
}

export function areRequestedShotsAssessed(ids: readonly string[], assessments: readonly ShotReviewAssessment[]): boolean {
  const requested = [...new Set(ids)]
  return requested.length > 0 && requested.every(id => {
    const matching = assessments.filter(item => item.shotNodeId === id)
    return matching.length === 1 && isAssessedShotReview(matching[0])
  })
}

export function unreviewedShot(shotNodeId: string, reason: string): ShotReviewAssessment {
  return { shotNodeId, assessed: false, dimensions: [], unassessedDimensions: [], scope: 'single-frame', reason }
}
