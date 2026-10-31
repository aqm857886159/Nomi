import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { createEmptyStoryboardPlan, type StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import { addAnchor, updateAnchor, validatePlan } from '../generationCanvas/agent/storyboardPlanEdits'
import { setPlanDefaultAspect } from '../generationCanvas/agent/storyboardShotScope'
import { parseStoryboardPlan } from '../generationCanvas/agent/storyboardPlanSchema'
import { readCurrentWorkbenchProjectPayload } from './workbenchProjectSession'
import { normalizePayload, normalizeRecord } from './projectNormalize'
import { assertWorkbenchProjectMediaUrlsPersistable } from './projectMediaMigration'

const summary = { id: 'draft-contract', name: 'Draft', createdAt: 1, updatedAt: 1 }
beforeEach(() => {
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: '', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
})

function persist(plan: StoryboardPlan) {
  useWorkbenchStore.getState().setStoryboardPlan(plan)
  const payload = normalizePayload(readCurrentWorkbenchProjectPayload())
  const record = { ...summary, version: 1 as const, payload }
  assertWorkbenchProjectMediaUrlsPersistable(record)
  const reopened = normalizeRecord(summary, JSON.parse(JSON.stringify(record)))
  expect(reopened.payload.storyboardDesignsByDocumentId).toEqual(payload.storyboardDesignsByDocumentId)
  expect(reopened.payload.storyboardDesignsByDocumentId?.doc[0].plan).toEqual(JSON.parse(JSON.stringify(plan)))
}

describe('editor drafts use the real store and persistence boundary', () => {
  const fresh = () => addAnchor(createEmptyStoryboardPlan())
  it.each([
    ['new unnamed character', fresh],
    ['cleared name', () => { const p = fresh(); return updateAnchor(updateAnchor(p, p.anchors[0].id, { name: 'Hero' }), p.anchors[0].id, { name: '' }) }],
    ['default film aspect', () => setPlanDefaultAspect(setPlanDefaultAspect(createEmptyStoryboardPlan(), '16:9'), '')],
  ] as const)('%s survives JSON and normalizeRecord', (_name, make) => persist(make()))
  it.each(['character', 'scene', 'prop', 'style'] as const)('unnamed %s is still rejected at model and Agent plan admission', kind => {
    const plan = addAnchor(createEmptyStoryboardPlan(), kind)
    expect(() => parseStoryboardPlan(plan)).toThrow()
    if (kind !== 'style') expect(validatePlan(plan)).toContainEqual({ kind: 'anchor-no-name', anchorId: plan.anchors[0].id })
  })
  it.each(['single', 'map'] as const)('legacy %s draft migration preserves empty content', shape => {
    const { storyboardDesignsByDocumentId: _owner, ...base } = readCurrentWorkbenchProjectPayload()
    const plan = setPlanDefaultAspect(fresh(), '')
    const legacyKey = ['storyboard', shape === 'map' ? 'Plans' : 'Plan'].join('')
    const value = shape === 'map' ? { doc: { plan, committed: false } } : plan
    const out = normalizePayload({ ...base, [legacyKey]: value })
    expect(out.storyboardDesignsByDocumentId?.doc[0].plan).toEqual(plan)
  })
  it('strict plan admission still rejects the default empty aspect', () => {
    expect(() => parseStoryboardPlan(setPlanDefaultAspect(createEmptyStoryboardPlan(), ''))).toThrow()
  })
  it('rejects malformed shape and reports only schema field paths, never record keys or content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const plan = fresh()
      useWorkbenchStore.getState().setStoryboardPlan(plan)
      const payload = readCurrentWorkbenchProjectPayload()
      const designs = payload.storyboardDesignsByDocumentId!.doc
      const malformed = { ...payload, storyboardDesignsByDocumentId: { 'private-document-key': [{ ...designs[0], plan: { ...plan, anchors: [{ ...plan.anchors[0], carrier: 'private-content' }] } }] } }
      expect(() => normalizePayload(malformed)).toThrow()
      expect(JSON.stringify(warn.mock.calls)).toContain('storyboardDesignsByDocumentId.*.0.plan.anchors.0.carrier')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-document-key')
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private-content')
    } finally { warn.mockRestore() }
  })
  it('the persistence boundary rejects nonfinite duration instead of letting JSON turn it into null', () => {
    const plan = createEmptyStoryboardPlan()
    plan.shots[0].durationSec = Infinity
    expect(() => persist(plan)).toThrow()
  })
})
