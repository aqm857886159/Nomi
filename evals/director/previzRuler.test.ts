import { describe, expect, it } from 'vitest'
import { parseDirectorCard } from './cardSchema'
import { scoreCard } from './scorer'
import { rightTrackProject } from './previzRulerFixture'
import { summarizeDirectorShots } from '../../src/workbench/generationCanvas/nodes/director/model/directorShotSummaries'

describe('product/evaluator camera-space ruler', () => {
  it.each([0, 90, 180, 270])('screen-right at yaw %s has identical product label and evaluator verdict', (yaw) => {
    const project = rightTrackProject(yaw)
    const card = parseDirectorCard({ id: 'screen-right', prompt: 'track right', duration: { total: 2 }, actors: [{ id: 'hero', category: 'person' }], shots: [{ t: [0, 2], subject: 'hero', size: '远景', move: 'truck', direction: 'right' }] })
    const result = scoreCard(card, project)
    expect(result.scores.L2, result.reasons.join('; ')).toBe(1)
    expect(summarizeDirectorShots(project)[0].move).toBe('track_right')
    const wrong = scoreCard({ ...card, shots: [{ ...card.shots[0], direction: 'left' }] }, project)
    expect(wrong.scores.L2).toBeLessThan(1)
  })

  it.each([0, 90, 180, 270])('screen-left at yaw %s is the mirror case', (yaw) => {
    const project = rightTrackProject(yaw, -1)
    const card = parseDirectorCard({ id: 'screen-left', prompt: 'track left', duration: { total: 2 }, actors: [{ id: 'hero', category: 'person' }], shots: [{ t: [0, 2], subject: 'hero', size: '远景', move: 'truck', direction: 'left' }] })
    const result = scoreCard(card, project)
    expect(result.scores.L2, result.reasons.join('; ')).toBe(1)
    expect(summarizeDirectorShots(project)[0].move).toBe('track_left')
  })
  it('the evaluator measures the recorded subject even when its card expects another actor', () => {
    const project = rightTrackProject()
    const scene = project.scenes[0]
    const prop = { ...scene.objects[0], id: 'prop', name: 'prop', type: 'cube' as const, scale: { x: 4, y: 4, z: 4 }, position: { x: 0, y: 1, z: -12 } }
    scene.objects.push(prop)
    scene.cameras[0].measurementSubject = { objectId: 'prop' }
    const card = parseDirectorCard({ id: 'recorded-subject', prompt: 'wide on hero', duration: { total: 2 }, actors: [{ id: 'hero', category: 'person' }], shots: [{ t: [0, 2], subject: 'hero', size: '远景' }] })
    expect(summarizeDirectorShots(project)[0].shotSize).not.toBe('远景')
    expect(scoreCard(card, project).scores.L2).toBeLessThan(1)
  })

})
