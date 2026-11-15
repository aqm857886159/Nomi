import { parseFragment } from 'parse5'
import { createDefaultWorkbenchProjectPayload } from '../../src/workbench/project/projectRecordSchema.ts'
import { normalizeRecord } from '../../src/workbench/project/projectNormalize.ts'
import { createGenerationNode } from '../../src/workbench/generationCanvas/model/graphOps.ts'
import { resolveRenderedControls } from '../../src/workbench/generationCanvas/nodes/nodeModelArchetype.ts'
import { validatePlan } from '../../src/workbench/generationCanvas/agent/storyboardPlanEdits.ts'
import { storyboardPlanToPlanShotInputs, shotDurationWarnings } from '../../src/workbench/generationCanvas/agent/storyboardStrategy.ts'
import { resolveGenerationPlan } from '../../electron/shared/videoCapabilities/planResolver.ts'
import { describeIssue } from '../../src/workbench/creation/storyboard/strategyText.ts'
import i18n from '../../src/i18n/index.ts'
import { renderParameters, renderRow } from './ui.mjs'
import { planOf, shotOf, candidateFor, draftRegistry }  from './entrances.mjs'
import { createGenerationPlanningHandler, createInMemoryGenerationOperationStore } from '../../electron/capabilityCore/mcpGenerationTools.ts'

export function visibleNotes(html) {
  const found = []
  function text(node) { return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join(' ') }
  function visit(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]))
    if (['alert', 'status'].includes(attrs.role) || attrs['aria-invalid'] === 'true' || attrs['data-storyboard-row-duration-warning']) found.push(`${attrs['data-storyboard-row-duration-warning'] ? 'duration ' : ''}${text(node).trim()}`)
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(parseFragment(html))
  return found
}
export function projectFixture(test, canvas) {
  const payload = createDefaultWorkbenchProjectPayload()
  const doc = payload.activeDocumentId
  const shot = shotOf(test.target, test.params)
  if (canvas) payload.generationCanvas.nodes = [{ ...createGenerationNode({ id: 'ruler', kind: test.target.row.model.kind }), meta: {
    ...test.params, modelKey: test.target.row.model.modelKey, modelVendor: test.target.row.model.vendorKey,
    archetype: { id: test.target.row.archetype.id, modeId: test.target.mode.id, ...(test.target.variantId ? { variantId: test.target.variantId } : {}) },
  } }]
  else payload.storyboardDesignsByDocumentId = { [doc]: [{ id: 'ruler', documentId: doc, title: 'ruler', plan: planOf(shot), committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] }
  return { id: 'ruler', name: 'ruler', version: 1, createdAt: 1, updatedAt: 1, payload }
}
export function openProject(raw, target, canvas) {
  const reopened = normalizeRecord({ id: 'ruler', name: 'ruler', createdAt: 1, updatedAt: 1 }, raw)
  if (canvas) {
    const node = reopened.payload.generationCanvas.nodes[0]
    const controls = resolveRenderedControls(target.row.option, node.meta, node.kind === 'image', node.kind === 'video')
    return { reopened, notes: visibleNotes(renderParameters(target, node.meta, controls)) }
  }
  const plan = reopened.payload.storyboardDesignsByDocumentId[reopened.payload.activeDocumentId][0].plan
  const issues = validatePlan(plan)
  const value = resolveGenerationPlan({ shots: storyboardPlanToPlanShotInputs(plan), candidates: [{ provider: target.row.model.vendorKey, modelKey: target.row.model.modelKey, label: target.row.option.label, archetype: target.row.archetype, variantId: target.variantId }] })
  const warnings = shotDurationWarnings({ resolvedShots: value.shots })
  const warning = warnings.values().next().value
  const durationWarning = warning ? { kind: warning.kind, text: describeIssue(i18n.t.bind(i18n), warning.issue), detail: describeIssue(i18n.t.bind(i18n), warning.issue) } : undefined
  return { reopened, issues, notes: visibleNotes(renderRow(plan.shots[0], target.row.option, { durationWarning })) }
}

export function adjustmentEvidence(output) {
  // Current native model-switch receipts contain from/to but no reason; do not manufacture one from the test oracle.
  const native = output.receipt?.changeset?.changedDefaults ?? output.receipt?.changes ?? []
  return native.map(change => ({ key: change.key, from: change.from, to: change.to, reason: change.reason }))
}

export async function openOperation(test) {
  const operations = createInMemoryGenerationOperationStore()
  const candidate = candidateFor(test.target, test.params)
  const operation = await operations.create({ projectId: 'ruler', operationId: 'ruler', candidate, now: '2026-11-09T00:00:00Z' })
  const before = JSON.stringify(operation)
  let patches = 0
  const patch = operations.patch
  operations.patch = (...args) => { patches++; return patch(...args) }
  const reader = createGenerationPlanningHandler({ registry: draftRegistry(test.target), operations, now: () => '2026-11-09T00:00:00Z' })
  const reply = await reader({ capability: 'read', params: { operationId: 'ruler' }, lease: { projectId: 'ruler' }, origin: { host: 'codex' } })
  const notes = []
  function visit(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.code === 'string' && /^(param[.]|parameter_|duration[.])/.test(value.code)) notes.push(JSON.stringify(value))
    for (const child of Object.values(value)) visit(child)
  }
  visit(reply)
  return { unchanged: patches === 0 && JSON.stringify(await operations.read('ruler', 'ruler')) === before, notes }
}
