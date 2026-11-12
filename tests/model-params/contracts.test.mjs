// Executable known gaps. it.fails asserts the intended invariant; remove .fails only after repair.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setCatalogRowLookup } from '../../electron/capabilityCore/modelAdmissionSchema.ts'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { models, cases, missing, identity, illegal, surface } from './corpus.mjs'
import { entrances } from './entrances.mjs'
import { projectFixture, openProject, adjustmentEvidence, openOperation } from './observation.mjs'

// Keyed by entrance/column: CI retries failing tests, and an it.fails body always fails, so a retry must overwrite its own row.
const measurements = new Map()
const infrastructureErrors = []
const openedCache = new Map()
let root
beforeAll(() => {
  root = makeTempDir('model-params-')
  setCatalogRowLookup((providerId, modelId) => models.find(row => row.model.vendorKey === providerId && row.model.modelKey === modelId)?.model)
})
afterAll(() => {
  setCatalogRowLookup(undefined)
  if (process.env.NOMI_MODEL_PARAMS_REPORT) fs.writeFileSync(process.env.NOMI_MODEL_PARAMS_REPORT, JSON.stringify({ models: models.length, measurements: [...measurements.values()], infrastructureErrors, missing: [...new Map(missing.map(row => [JSON.stringify(row), row])).values()] }, null, 2))
  fs.rmSync(root, { recursive: true, force: true })
})

function changes(test, output) {
  const keys = new Set([...test.source.mode.params, ...output.target.mode.params].map(control => control.key))
  const input = output.input ?? test.params
  return [...keys].filter(key => input[key] !== undefined && String(input[key]) !== String(output.saved?.[key]))
    .map(key => ({ key, from: input[key], to: output.saved?.[key] }))
}
function record(id, column, count, failures, example) {
  const row = { id, column, samples: count, failures, example }
  measurements.set(`${id}/${column}`, row)
  return row
}
function scan(entrance, column) {
  let count = 0, failures = 0, example
  for (const test of cases(entrance.axis)) {
    if (entrance.only && !entrance.only(test)) continue
    count++
    let output
    try { output = entrance.write(test) }
    catch (error) { infrastructureErrors.push({ id: entrance.id, source: identity(test.source), target: identity(test.target), error: error.stack }); break }
    let problems = []
    if (column === 'legal') {
      if (output.saved) {
        problems = illegal(output.target, output.saved)
        const targetKeys = new Set(output.target.mode.params.map(control => control.key))
        for (const control of test.source.mode.params) if (!targetKeys.has(control.key) && output.saved[control.key] !== undefined) problems.push({ key: control.key, value: output.saved[control.key], reason: 'unsupported retained parameter' })
      }
      else if (output.refusal && !illegal(test.target, { duration: output.refusedDuration }).length) problems.push({ key: 'feasible-duration-refused', value: output.refusedDuration })
      if (output.firstFrameSupported === false) problems.push({ key: 'first-frame-mode', value: output.target.mode.id })
    } else if (output.saved) {
      problems = changes(test, output).filter(change => !adjustmentEvidence(output).some(item => item.key === change.key && Object.is(item.from, change.from) && Object.is(item.to, change.to) && typeof item.reason === 'string' && item.reason.trim()))
    }
    if (problems.length) { failures++; example ??= { source: identity(test.source), target: identity(output.target), params: test.params, problems, saved: output.saved } }
  }
  return record(entrance.id, column, count, failures, example)
}
async function openScan(entrance) {
  let count = 0, failures = 0, example
  const canvas = entrance.id.startsWith('canvas-') || entrance.id === 'agent-node'
  for (const test of cases('values')) {
    if (entrance.only && !entrance.only(test)) continue
    // Storyboard storage has no variant field; its current reader uses the default variant.
    if (!canvas && test.target.variantId !== surface(test.target.row).variantId) continue
    const invalid = illegal(test.target, test.params)
    if (!invalid.length) continue
    count++
    const operation = entrance.id === 'agent-draft'
    const key = `${operation ? 'operation' : canvas}:${identity(test.target)}:${JSON.stringify(test.params)}`
    let observed = openedCache.get(key)
    if (!observed) {
      const raw = projectFixture(test, canvas), before = JSON.stringify(raw)
      const file = path.join(root, 'saved-project.json')
      fs.writeFileSync(file, before)
      const input = JSON.parse(fs.readFileSync(file, 'utf8')), inputBefore = JSON.stringify(input)
      const writes = ['writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'mkdirSync'].map(name => vi.spyOn(fs, name))
      let opened, wrote
      try { opened = operation ? await openOperation({ ...test, params: input.payload.storyboardDesignsByDocumentId[input.payload.activeDocumentId][0].plan.shots[0].params }) : openProject(input, test.target, canvas); wrote = writes.reduce((count, spy) => count + spy.mock.calls.length, 0) }
      catch (error) { infrastructureErrors.push({ id: entrance.id, column: 'open', error: error.stack }); break }
      finally { writes.forEach(spy => spy.mockRestore()) }
      const unchanged = opened.unchanged !== false && wrote === 0 && JSON.stringify(input) === inputBefore && fs.readFileSync(file, 'utf8') === before
      const marked = invalid.every(problem => {
        const control = test.target.mode.params.find(control => control.key === problem.key)
        return opened.notes.some(note => note.includes(String(problem.value)) && (note.includes(problem.key) || note.includes(control.label)))
      })
      observed = { unchanged, marked, notes: opened.notes, invalid }
      openedCache.set(key, observed)
    }
    if (!observed.unchanged || !observed.marked) { failures++; example ??= { target: identity(test.target), ...observed } }
  }
  return record(entrance.id, 'open', count, failures, example)
}

// Fixed baseline, never inferred from the run: a repaired known gap becomes an unexpected pass until .fails is removed.
const knownGaps = new Set([
  'canvas-model/legal', 'canvas-model/explanation', 'canvas-model/open',
  'canvas-mode/legal', 'canvas-mode/explanation', 'canvas-mode/open',
  'canvas-variant/legal', 'canvas-variant/explanation', 'canvas-variant/open',
  'storyboard-model/legal', 'storyboard-model/explanation', 'storyboard-model/open',
  'storyboard-kind/legal', 'storyboard-kind/explanation', 'storyboard-kind/open',
  'storyboard-mode/legal', 'storyboard-mode/explanation', 'storyboard-mode/open',
  'storyboard-reference-mode/legal', 'storyboard-reference-mode/open',
  'storyboard-duration/legal', 'storyboard-duration/open',
  'agent-patch/legal', 'agent-patch/open',
  'agent-node/explanation', 'agent-node/open',
  'agent-draft/open',
  'deterministic-planner/legal', 'deterministic-planner/explanation', 'deterministic-planner/open',
  'first-frame/legal', 'first-frame/explanation', 'first-frame/open',
])

describe('C1 parameters / catalog × entrance × three invariants', () => {
  it('has catalog models, mode/variant pairs, cross-kind pairs and seeds', () => {
    expect(models.length).toBeGreaterThan(50)
    for (const axis of ['models', 'kinds', 'modes', 'variants', 'values']) expect(cases(axis).next().done, axis).toBe(false)
  })
  it('project fixtures reopen through the production parser and duration warnings are observable', () => {
    const row = models.find(row => row.model.kind === 'video' && row.archetype.modes.some(mode => mode.params.some(control => control.key === 'duration' && control.min > 3)))
    const mode = row.archetype.modes.find(mode => mode.params.some(control => control.key === 'duration' && control.min > 3))
    const target = surface(row, mode.id)
    const test = { target, params: { duration: 3 } }
    for (const canvas of [true, false]) {
      const raw = projectFixture(test, canvas), before = JSON.stringify(raw)
      const opened = openProject(raw, target, canvas)
      expect(opened.reopened.payload.generationCanvas).toBeDefined()
      expect(JSON.stringify(raw)).toBe(before)
      if (!canvas) expect(opened.notes.some(note => note.includes('duration') && note.includes('3'))).toBe(true)
    }
  })
  for (const entrance of entrances) for (const column of ['legal', 'explanation', 'open']) {
    const key = `${entrance.id}/${column}`
    const check = knownGaps.has(key) ? it.fails : it
    check(key, async () => {
      const row = column === 'open' ? await openScan(entrance) : scan(entrance, column)
      expect(row.samples, 'nonempty measurement').toBeGreaterThan(0)
      expect(row.failures, JSON.stringify(row.example)).toBe(0)
    })
  }
  it('has no infrastructure errors hidden by it.fails', () => { expect(infrastructureErrors).toEqual([]); expect(measurements.size).toBe(entrances.length * 3); expect([...measurements.values()].every(row => row.samples > 0)).toBe(true) })
})
