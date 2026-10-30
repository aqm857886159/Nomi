import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import * as edits from '../generationCanvas/agent/storyboardPlanEdits'
import * as scope from '../generationCanvas/agent/storyboardShotScope'
import * as bulkParams from '../creation/storyboard/storyboardBulkParamScope'
import * as bulkModels from '../creation/storyboard/storyboardBulkModelScope'
import { createEmptyStoryboardPlan, type StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'
import { useWorkbenchStore } from '../workbenchStore'
import { readCurrentWorkbenchProjectPayload } from './workbenchProjectSession'
import { normalizePayload, normalizeRecord } from './projectNormalize'
import { assertWorkbenchProjectMediaUrlsPersistable } from './projectMediaMigration'
// UI options are the source of truth; the empty default must always be sampled.
import { storyboardBulkAspectOptions } from '../creation/storyboard/storyboardBulkAspectOptions'

type Args = { text: string; pick: number; aspect: string; kind: typeof edits.ANCHOR_KINDS[number]; shotKind: edits.ShotTypeValue; sec: number }
type Transform = (p: StoryboardPlan, a: Args) => StoryboardPlan
const anchorId = (p: StoryboardPlan, a: Args) => p.anchors[a.pick % (p.anchors.length || 1)]?.id ?? 'absent'
const sceneId = (p: StoryboardPlan, a: Args) => p.scenes?.[a.pick % (p.scenes.length || 1)]?.id ?? 'absent'
const pos = (p: StoryboardPlan, a: Args) => a.pick % (p.shots.length || 1)
const EDIT_REGISTRY: Record<string, Transform> = {
  updateTitle: (p, a) => edits.updateTitle(p, a.text),
  addAnchor: (p, a) => edits.addAnchor(p, a.kind),
  updateAnchor: (p, a) => edits.updateAnchor(p, anchorId(p, a), { name: a.text, description: a.text, staticFeatures: a.text, dynamicFeatures: a.text, variants: [a.text], modelKey: a.text, modelVendor: a.text, modeId: a.text, params: { text: a.text, number: a.sec } }),
  rememberAnchorReferenceUrl: (p, a) => edits.rememberAnchorReferenceUrl(p, anchorId(p, a), a.text ? 'https://example.test/reference.png' : ''),
  addExternalReferenceAnchor: (p, a) => edits.addExternalReferenceAnchor(p, { id: 'external', name: a.text, url: 'https://example.test/reference.png', kind: 'image' }).plan,
  updateShotPrompt: (p, a) => edits.updateShotPrompt(p, pos(p, a), a.text),
  changeAnchorKind: (p, a) => edits.changeAnchorKind(p, anchorId(p, a), a.kind),
  removeAnchor: (p, a) => edits.removeAnchor(p, anchorId(p, a)),
  addShot: p => edits.addShot(p),
  insertShotAt: (p, a) => edits.insertShotAt(p, pos(p, a)),
  duplicateShotAt: (p, a) => edits.duplicateShotAt(p, pos(p, a)),
  updateShotAt: (p, a) => edits.updateShotAt(p, pos(p, a), { prompt: a.text, durationSec: a.sec, modelKey: a.text, modelVendor: a.text, params: { text: a.text, number: a.sec }, keyframe: { enabled: true, prompt: a.text } }),
  removeShotAt: (p, a) => edits.removeShotAt(p, pos(p, a)),
  moveShot: (p, a) => edits.moveShot(p, pos(p, a), (a.pick + 1) % (p.shots.length || 1)),
  addScene: (p, a) => edits.addScene(p, a.text),
  renameScene: (p, a) => edits.renameScene(p, sceneId(p, a), a.text),
  removeScene: (p, a) => edits.removeScene(p, sceneId(p, a)),
  applyShotKindToAll: (p, a) => edits.applyShotKindToAll(p, a.shotKind),
  applyModelToAll: (p, a) => edits.applyModelToAll(p, a.text, a.text),
  applyDurationToAll: (p, a) => edits.applyDurationToAll(p, a.sec),
}
const SCOPE_REGISTRY: Record<string, Transform> = {
  setPlanDefaultAspect: (p, a) => scope.setPlanDefaultAspect(p, a.aspect),
  setShotAspectOverride: (p, a) => scope.setShotAspectOverride(p, pos(p, a), a.aspect || null),
}
// A real catalog contract supplies the bulk controls; no parallel hand-written option list.
const BULK_OPTIONS = [{ value: 'draft-video', label: 'Draft video', modelKey: 'bytedance/seedance-2-5', vendor: 'kie', vendorName: 'kie' }]
const BULK_REGISTRY: Record<string, Transform> = {
  applyBulkModelToShots: (p, a) => bulkModels.applyBulkModelToShots({ plan: p, isSelected: shot => shot.index % 2 === a.pick % 2, kind: a.shotKind === 'image' ? 'image' : 'video', modelKey: a.text, vendor: a.text }),
  applyBulkParamToShots: (p, a) => {
    const controls = bulkParams.deriveBulkParamScope({ plan: p, shots: [{ index: 1, durationSec: 5, anchorIds: [], prompt: '', shotKind: 'video', modelKey: 'bytedance/seedance-2-5', modelVendor: 'kie', modeId: 'omni' }], modelOptions: BULK_OPTIONS, kind: 'video', aspectOf: () => '16:9' }).controls
    const control = controls[a.pick % controls.length]
    if (!control) throw new Error('real bulk control contract missing')
    const option = control.options?.[a.pick % (control.options.length || 1)]
    const raw = option === undefined ? String(a.sec) : typeof option === 'object' ? String(option.value) : String(option)
    return bulkParams.applyBulkParamToShots({ plan: p, isSelected: shot => shot.index % 2 === a.pick % 2, kind: 'video', control, controls, raw })
  },
}
const READ_ONLY_EDITS = ['planModelSelection', 'defaultCarrierForKind', 'defaultScopeForKind', 'makeAnchorId', 'makeSceneId', 'sceneGroupsOf', 'totalDurationSec', 'validatePlan', 'shotTypeOf', 'shotKindPatch', 'deriveBulkShotKind', 'deriveBulkModelKey', 'deriveBulkDuration']
const READ_ONLY_SCOPE = ['shotAspectOverride', 'planDefaultAspect', 'isAspectOverridden', 'effectiveShotAspect', 'overriddenAspectCount', 'resolveShotParams', 'resolveKeyframeParams', 'unsupportedFilmDefaultKeys', 'shotModeControls', 'foldRatioIntoSlot']
const STORE_REGISTRY = ['setStoryboardPlan', 'addStoryboardDesign', 'duplicateStoryboardDesign', 'renameStoryboardDesign', 'deleteStoryboardDesign', 'restoreStoryboardDesign', 'commitStoryboardPlan', 'discardStoryboardPlan'] as const
const registry = { ...EDIT_REGISTRY, ...SCOPE_REGISTRY, ...BULK_REGISTRY }
const summary = { id: 'property-project', name: 'Property', createdAt: 1, updatedAt: 1 }
function reset() {
  const s = useWorkbenchStore.getState()
  s.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: '', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  s.hydrateStoryboardDesigns({})
}
beforeEach(reset)
function assertPersistable() {
  const current = readCurrentWorkbenchProjectPayload()
  const payload = normalizePayload(current)
  const record = { ...summary, version: 1 as const, payload }
  assertWorkbenchProjectMediaUrlsPersistable(record)
  const reopened = normalizeRecord(summary, JSON.parse(JSON.stringify(record)))
  // Compare to the unparsed store as well: parsing must not silently rewrite content.
  expect(JSON.parse(JSON.stringify(payload.storyboardDesignsByDocumentId ?? {}))).toEqual(JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(current.storyboardDesignsByDocumentId ?? {}).filter(([, designs]) => designs.length > 0)))))
  expect(reopened.payload.storyboardDesignsByDocumentId).toEqual(payload.storyboardDesignsByDocumentId)
}
const args = fc.record({ text: fc.oneof(fc.constant(''), fc.string()), pick: fc.nat(99), aspect: fc.constantFrom(...storyboardBulkAspectOptions(['16:9', '9:16'], '').map(o => o.value)), kind: fc.constantFrom(...edits.ANCHOR_KINDS), shotKind: fc.constantFrom<edits.ShotTypeValue>('image', 'video', 'image-video'), sec: fc.double({ min: 0.01, max: 60, noNaN: true }) })
const op = fc.tuple(fc.constantFrom(...Object.keys(registry), ...STORE_REGISTRY), args)
describe('editor persistability matrix and export coverage ratchet', () => {
  it('every exported editor function is classified, so an unregistered transformation fails', () => {
    const functions = (mod: object) => Object.entries(mod).filter(([, value]) => typeof value === 'function').map(([key]) => key).sort()
    expect(functions(edits)).toEqual([...Object.keys(EDIT_REGISTRY), ...READ_ONLY_EDITS].sort())
    expect(functions(scope)).toEqual([...Object.keys(SCOPE_REGISTRY), ...READ_ONLY_SCOPE].sort())
    expect(functions(bulkParams)).toEqual(['applyBulkParamToShots', 'deriveBulkParamScope', 'projectAspectOptions', 'storyboardBulkParamGroups'].sort())
    expect(functions(bulkModels)).toEqual(['applyBulkModelToShots', 'storyboardBulkModelGroups', 'storyboardShotKind'].sort())
  })
  it.each(Object.keys(registry))('empty content via %s survives the real store', key => {
    const p = edits.addScene(edits.addAnchor(createEmptyStoryboardPlan()), '')
    useWorkbenchStore.getState().setStoryboardPlan(registry[key](p, { text: '', pick: 0, aspect: '', kind: 'character', shotKind: 'image-video', sec: 5 }))
    assertPersistable()
  })
  it('JSON loopback catches nonfinite opaque parameter values', () => {
    const plan = createEmptyStoryboardPlan()
    plan.shots[0].params = { duration: Infinity }
    useWorkbenchStore.getState().setStoryboardPlan(plan)
    expect(assertPersistable).toThrow()
  })
  it('random edit sequences persist and JSON round-trip after every step', () => {
    fc.assert(fc.property(fc.array(op, { minLength: 1, maxLength: 45 }), operations => {
      reset()
      let plan = createEmptyStoryboardPlan()
      useWorkbenchStore.getState().setStoryboardPlan(plan)
      for (const [key, a] of operations) {
        const s = useWorkbenchStore.getState()
        const design = s.storyboardDesignsByDocumentId.doc?.[0]
        if (key === 'addStoryboardDesign') s.addStoryboardDesign({ initiator: 'user', source: plan })
        else if (key === 'duplicateStoryboardDesign' && design) s.duplicateStoryboardDesign(design.id)
        else if (key === 'commitStoryboardPlan') s.commitStoryboardPlan()
        else if (key === 'discardStoryboardPlan') s.discardStoryboardPlan()
        else if (key === 'renameStoryboardDesign' && design) s.renameStoryboardDesign(design.id, a.text)
        else if (key === 'deleteStoryboardDesign' && design) { s.deleteStoryboardDesign(design.id) }
        else if (key === 'restoreStoryboardDesign' && design) { s.deleteStoryboardDesign(design.id); s.restoreStoryboardDesign(design, 'doc', 0) }
        else { plan = registry[key] ? registry[key](plan, a) : plan; s.setStoryboardPlan(plan) }
        assertPersistable()
        plan = useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc?.[0]?.plan ?? createEmptyStoryboardPlan()
      }
    }), { numRuns: 80, seed: 20261030 })
  })
})
