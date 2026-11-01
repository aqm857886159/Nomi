// Camera-space ruler census: non-cardinal views plus the mirrored direction of each view.
// Test inputs use independent geometry in rightTrackProject; scorer must consume the product verdict.
import { describe, expect, it } from 'vitest'
import { parseDirectorCard } from '../../evals/director/cardSchema.ts'
import { scoreCard } from '../../evals/director/scorer.ts'
import { rightTrackProject } from '../../evals/director/previzRulerFixture.ts'
import { summarizeDirectorShots } from '../../src/workbench/generationCanvas/nodes/director/model/directorShotSummaries.ts'

const ROWS = [0, 37, 145, 218, 309].flatMap((yaw) => [
  { yaw, sign: 1, direction: 'right', opposite: 'left' },
  { yaw, sign: -1, direction: 'left', opposite: 'right' },
])

describe('preview ruler ownership matrix', () => {
  it.each(ROWS)('$direction at start-camera yaw $yaw stays consistent across product and evaluation', ({ yaw, sign, direction, opposite }) => {
    const project = rightTrackProject(yaw, sign)
    const card = parseDirectorCard({ id: `ruler-${yaw}-${direction}`, prompt: `track ${direction}`, duration: { total: 2 }, actors: [{ id: 'hero', category: 'person' }], shots: [{ t: [0, 2], subject: 'hero', size: '远景', move: 'truck', direction }] })
    const score = scoreCard(card, project)
    expect(score.scores.L2, score.reasons.join('; ')).toBe(1)
    expect(summarizeDirectorShots(project)[0].move).toBe(`track_${direction}`)
    expect(scoreCard({ ...card, shots: [{ ...card.shots[0], direction: opposite }] }, project).scores.L2).toBeLessThan(1)
  })
})
