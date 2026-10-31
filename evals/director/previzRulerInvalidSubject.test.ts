import { describe, expect, it } from 'vitest'
import { parseDirectorCard } from './cardSchema'
import { scoreCard } from './scorer'
import { rightTrackProject } from './previzRulerFixture'
import { normalizeDirectorProject } from '../../src/workbench/generationCanvas/nodes/director/model/directorProject'
import { sampleDirectorProject } from '../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'
import { subjectAt } from '../../src/workbench/generationCanvas/nodes/director/model/directorShotSubject'
import { summarizeDirectorShots } from '../../src/workbench/generationCanvas/nodes/director/model/directorShotSummaries'

const offset = { x: 0, y: 1, z: 0 }
const size = { x: 0.18, y: 0.18, z: 0.18 }
const hand = { name: 'hand', offset, size }
const card = parseDirectorCard({ id: 'invalid-subject', prompt: 'far on hero', duration: { total: 2 }, actors: [{ id: 'hero', category: 'person' }], shots: [{ t: [0, 2], subject: 'hero', size: '远景' }] })

function persistedSubject(subject: unknown) {
  const project = rightTrackProject()
  return normalizeDirectorProject({ ...project, scenes: [{ ...project.scenes[0], cameras: [{ ...project.scenes[0].cameras[0], measurementSubject: subject }] }] })
}

describe('persisted measurement identity fails closed', () => {
  it('a hand with zero width cannot silently become the whole person', () => {
    // The acceptance reproduction: a JSON round trip, normalize, then the real summary and scorer.
    const subject = JSON.parse(JSON.stringify({ objectId: 'hero', anchor: { ...hand, size: { ...size, x: 0 } } }))
    const project = persistedSubject(subject)
    expect(summarizeDirectorShots(project)[0].shotSize, '合同：锚点规格失效应不可测，不能静默改量整个人').toBeNull()
    expect(project.scenes[0].cameras[0].measurementSubject).toEqual({ objectId: 'hero', anchor: null })
    expect(scoreCard(card, project).scores.L2).toBe(0)
  })

  it.each([
    ['zero height', { ...hand, size: { ...size, y: 0 } }],
    ['zero depth', { ...hand, size: { ...size, z: 0 } }],
    ['negative size', { ...hand, size: { ...size, x: -1 } }],
    ['non-finite size', { ...hand, size: { ...size, z: Infinity } }],
    ['missing size axis', { ...hand, size: { x: 0.18, y: 0.18 } }],
    ['missing offset axis', { ...hand, offset: { x: 0, y: 1 } }],
    ['non-finite offset', { ...hand, offset: { ...offset, x: NaN } }],
    ['string offset', { ...hand, offset: { ...offset, x: '0' } }],
    ['missing offset', { name: 'hand', size }],
    ['missing size', { name: 'hand', offset }],
    ['missing name', { offset, size }],
    ['empty name', { ...hand, name: '' }],
    ['null anchor', null],
    ['non-object anchor', 'hand'],
  ])('%s retains an invalid anchor through repeated persistence', (_, anchor) => {
    const normalized = persistedSubject({ objectId: 'hero', anchor })
    const project = normalizeDirectorProject(JSON.parse(JSON.stringify(normalized)))
    expect(project.scenes[0].cameras[0].measurementSubject).toEqual({ objectId: 'hero', anchor: null })
    const frame = sampleDirectorProject(project, { fps: 1 }).frames[1]
    expect(frame.objects.hero.projection?.inFrame).toBe(true)
    expect(subjectAt(project, frame)).toBeNull()
    expect(summarizeDirectorShots(project)[0].shotSize).toBeNull()
    expect(scoreCard(card, project).scores.L2).toBe(0)
  })

  it.each([null, 'hero', {}, { objectId: 123 }, { objectId: '' }])('invalid binding %j cannot become a manual camera', (subject) => {
    const normalized = persistedSubject(subject)
    const project = normalizeDirectorProject(JSON.parse(JSON.stringify(normalized)))
    expect(project.scenes[0].cameras[0].measurementSubject).toBeNull()
    expect(subjectAt(project, sampleDirectorProject(project).frames[0])).toBeNull()
    expect(summarizeDirectorShots(project)[0].shotSize).toBeNull()
    expect(scoreCard(card, project).scores.L2).toBe(0)
  })

  it('distinguishes absent bindings, whole objects and valid anchor specifications', () => {
    const manual = normalizeDirectorProject(rightTrackProject())
    const body = persistedSubject({ objectId: 'hero' })
    const anchor = persistedSubject({ objectId: 'hero', anchor: hand })
    expect(manual.scenes[0].cameras[0].measurementSubject).toBeUndefined()
    expect(summarizeDirectorShots(manual)[0].shotSize).toBe('远景')
    expect(scoreCard(card, body).scores.L2).toBe(1)
    expect(anchor.scenes[0].cameras[0].measurementSubject).toEqual({ objectId: 'hero', anchor: hand })
    expect(subjectAt(anchor, sampleDirectorProject(anchor).frames[0])).toBe('hero.hand')
    expect(summarizeDirectorShots(anchor)[0].shotSize).not.toBeNull()
  })
})
