import { describe, expect, it } from 'vitest'
import { collectStructuralFailures, collectVendorCompatibilityFailures, toPublishedJsonSchema } from '../agentCapabilities/modelVisibleJsonSchema'
import { directorPlanModelSchema, directorPlanSchema, normalizeDirectorPlan, parseDirectorPlan } from './directorPlanSchema'

describe('director plan model projection', () => {
  it('is strict, described, and compatible with the shared model-schema rules', () => {
    const published = toPublishedJsonSchema(directorPlanModelSchema)
    const structural: string[] = []
    const vendor: string[] = []
    collectStructuralFailures(published, '', structural)
    collectVendorCompatibilityFailures(published, '', vendor)
    expect(structural).toEqual([])
    expect(vendor).toEqual([])
    expect(published.type).toBe('object')
    expect(published.additionalProperties).toBe(false)
    expect(published.anyOf).toBeUndefined()
    expect(published.const).toBeUndefined()
    const properties = published.properties as Record<string, { description?: string }>
    for (const field of ['version', 'scene', 'actors', 'blocking', 'shots'])
      expect(properties[field]?.description, field).toBeTruthy()
    const scene = properties.scene as unknown as { properties: Record<string, { description?: string }> }
    for (const field of ['tags', 'environment', 'template', 'dressing', 'setPieces'])
      expect(scene.properties[field]?.description, `scene.${field}`).toBeTruthy()
  })
})

const valid = { version: 2, scene: { tags: ['street'], environment: 'day', template: 'street', setPieces: [] }, actors: [{ id: 'hero', kind: 'person', desc: 'hero', placement: { relation: 'at', ref: 's1-street-ground' } }], blocking: [], shots: [{ id: 'shot-1', window: [0, 2], transitionIn: 'cut', subject: 'hero', size: '中景', angle: 'front', height: 'eye', move: { kind: 'static', speed: 'slow', easing: 'linear' } }] }

describe('director plan v2 schema', () => {
  it('accepts intent without coordinates', () => expect(directorPlanSchema.parse(valid).shots[0].size).toBe('中景'))
  it('rejects coordinates and reversed windows', () => {
    const bad = { ...valid, shots: [{ ...valid.shots[0], window: [2, 1], position: { x: 1, y: 2, z: 3 } }] }
    expect(directorPlanSchema.safeParse(bad).success).toBe(false)
  })
  it('rejects an unknown subject', () => expect(directorPlanSchema.safeParse({ ...valid, shots: [{ ...valid.shots[0], subject: 'missing' }] }).success).toBe(false))
  it('validates target switches', () => {
    expect(directorPlanSchema.safeParse({ ...valid, shots: [{ ...valid.shots[0], move: { ...valid.shots[0].move, kind: 'target_switch' } }] }).success).toBe(false)
  })
  it('normalizes target switch aliases', () => {
    const result = parseDirectorPlan({
      ...valid,
      actors: [valid.actors[0], { id: 'friend', kind: 'person', desc: 'friend', placement: { relation: 'in_front_of', ref: 'hero' } }],
      shots: [{ ...valid.shots[0], subjects: ['hero', 'friend'], move: { ...valid.shots[0].move, kind: 'target switch' } }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.shots[0].move.kind).toBe('target_switch')
  })
  it('normalizes mixed-language enum synonyms before validation', () => {
    const normalized = normalizeDirectorPlan({
      ...valid,
      scene: { ...valid.scene, environment: '白天', template: '室内' },
      actors: [{ ...valid.actors[0], kind: '人物', placement: { relation: '右侧', ref: 's1-room-floor' } }],
      shots: [{ ...valid.shots[0], size: 'medium', transitionIn: 'CUT', move: { ...valid.shots[0].move, kind: 'push' } }],
    })
    const result = parseDirectorPlan(normalized)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.shots[0].move.kind).toBe('push_in')
  })
  it('keeps unknown enum values visible to zod', () => {
    const result = parseDirectorPlan({ ...valid, scene: { ...valid.scene, environment: 'mars' } })
    expect(result.success).toBe(false)
  })
  it('does not guess lossy shot direction or size aliases', () => {
    const move = { ...valid.shots[0].move, kind: 'orbit' }
    expect(parseDirectorPlan({ ...valid, shots: [{ ...valid.shots[0], move }] }).success).toBe(false)
    expect(parseDirectorPlan({ ...valid, shots: [{ ...valid.shots[0], size: 'close' }] }).success).toBe(false)
    expect(parseDirectorPlan({ ...valid, shots: [{ ...valid.shots[0], size: 'wide' }] }).success).toBe(false)
  })
})
