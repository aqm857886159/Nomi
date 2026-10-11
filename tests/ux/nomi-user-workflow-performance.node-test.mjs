import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { createNomiUserWorkflowFixture, NOMI_WORKFLOW_SCALES, validateWorkflowFixtureSummary } from './fixtures/nomi-user-workflow-fixture.mjs'
import { percentile, redact } from './nomi-user-workflow-performance.e2e.mjs'
import * as harness from './nomi-user-workflow-performance.e2e.mjs'
import { installProjectOpenProbe } from './nomi-user-workflow-probe.mjs'
import { buildAnalysis } from '../../scripts/summarize-nomi-user-performance.mjs'

test('workflow scale contract is fixed and complete', () => {
  assert.deepEqual(Object.keys(NOMI_WORKFLOW_SCALES), ['small', 'typical', 'heavy'])
  for (const [scale, config] of Object.entries(NOMI_WORKFLOW_SCALES)) {
    assert.equal(config.shots, { small: 12, typical: 48, heavy: 320 }[scale])
    assert.equal(config.images > 0 && config.videos > 0, true)
    assert.equal(config.documents > 0, true)
    assert.equal(typeof validateWorkflowFixtureSummary, 'function')
    assert.equal(scale.length > 0, true)
  }
  assert.equal(NOMI_WORKFLOW_SCALES.small.canvasScale, 'REAL')
  assert.equal(NOMI_WORKFLOW_SCALES.typical.canvasScale, 'S')
  assert.equal(NOMI_WORKFLOW_SCALES.heavy.canvasScale, 'XL')
})

test('small fixture persists document, plan and mixed media counts', () => {
  const root = makeTempDir('nomi-workflow-fixture-test-')
  const fixture = createNomiUserWorkflowFixture({ projectsDir: root, scale: 'small', projectId: 'fixture-contract-small' })
  assert.equal(fixture.summary.shots, 12)
  assert.equal(validateWorkflowFixtureSummary(fixture.summary, 'small'), true)
  const record = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), 'utf8'))
  assert.equal(record.payload.workbenchDocuments.length, 2)
  assert.equal(Object.values(record.payload.storyboardDesignsByDocumentId).flat().length, 2)
  assert.equal(record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image').length, 4)
  assert.equal(record.payload.generationCanvas.nodes.filter((node) => node.kind === 'video').length, 2)
})

for (const scale of ['small', 'typical', 'heavy']) {
  test(`${scale} fixture contains nonempty drafts, competing plans, mixed groups and history`, () => {
    const fixture = createNomiUserWorkflowFixture({ projectsDir: makeTempDir('nomi-real-shape-'), scale })
    const payload = JSON.parse(fs.readFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), 'utf8')).payload
    const designs = Object.values(payload.storyboardDesignsByDocumentId).flat()
    assert.equal(designs.reduce((total, design) => total + design.plan.shots.length, 0), { small: 12, typical: 48, heavy: 320 }[scale])
    assert.ok(payload.workbenchDocuments.every((doc) => JSON.stringify(doc.contentJson).includes('Workflow draft')))
    assert.ok(Object.values(payload.storyboardDesignsByDocumentId).some((plans) => plans.length >= 2))
    assert.equal(new Set(designs.flatMap((design) => design.plan.shots.map((shot) => shot.shotId))).size, fixture.summary.shots)
    const canvas = payload.generationCanvas
    assert.ok(canvas.groups.some((group) => ['image', 'video'].every((kind) => group.nodeIds.some((id) => canvas.nodes.find((node) => node.id === id)?.kind === kind))))
    assert.ok(canvas.nodes.some((node) => node.history.length >= 2))
    assert.equal(fixture.summary.images, canvas.nodes.filter((node) => node.kind === 'image').length)
    assert.equal(fixture.summary.videos, canvas.nodes.filter((node) => node.kind === 'video').length)
    assert.equal(canvas.edges.length, { small: 4, typical: 48, heavy: 320 }[scale])
    assert.equal(fixture.summary.references, canvas.edges.length)
  })
}

test('production snapshot and result normalization preserve fixture groups and history', () => {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--eval', `
    import assert from 'node:assert/strict'
    import { makeTempDir } from './scripts/_test-temp.mjs'
    import { createNomiUserWorkflowFixture } from './tests/ux/fixtures/nomi-user-workflow-fixture.mjs'
    import { normalizeStoreSnapshot } from './src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts'
    import { normalizeNodeResultVersionNumbers } from './src/workbench/generationCanvas/model/nodeResultLifecycle.ts'
    for (const scale of ['small', 'typical', 'heavy']) {
      const fixture = createNomiUserWorkflowFixture({ projectsDir: makeTempDir('nomi-production-shape-'), scale })
      const canvas = fixture.record.payload.generationCanvas
      const normalized = normalizeStoreSnapshot(canvas)
      assert.deepEqual(normalized.groups.map(({ id, nodeIds }) => ({ id, nodeIds })), canvas.groups.map(({ id, nodeIds }) => ({ id, nodeIds })))
      for (const node of normalized.nodes) {
        const results = normalizeNodeResultVersionNumbers(node)
        assert.deepEqual(results.history, node.history)
        assert.equal(results.resultVersionMax, node.resultVersionMax)
      }
    }
  `], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('CLI accepts separated and equals syntax with identical nonempty cells', () => {
  assert.equal(typeof harness.parseOptions, 'function')
  const separated = harness.parseOptions(['--scale', 'small,heavy', '--scenario', 'project.open', '--runs', '5', '--warmup', '1', '--cache', 'cold,hot'])
  const equals = harness.parseOptions(['--scale=small,heavy', '--scenario=project.open', '--runs=5', '--warmup=1', '--cache=cold,hot'])
  assert.deepEqual(separated, equals)
  assert.deepEqual(separated.scales, ['small', 'heavy'])
  assert.deepEqual(separated.caches, ['cold', 'hot'])
})

test('CLI rejects empty, unknown, duplicate and non-finite inputs instead of succeeding empty', () => {
  assert.equal(typeof harness.parseOptions, 'function')
  for (const argv of [['--scale='], ['--scale=unknown'], ['--scenario=unknown'], ['--runs=NaN'], ['--runs=0'], ['--runs=1.5'], ['--warmup=-1'], ['--cache=luke'], ['--timeout=Infinity'], ['--scale'], ['--typo=x'], ['small'], ['--scale=small', '--scale=heavy']]) {
    assert.throws(() => harness.parseOptions(argv), undefined, argv.join(' '))
  }
})

test('evidence writes never overwrite a previous report even at the same timestamp', () => {
  assert.equal(typeof harness.writeReport, 'function')
  const root = makeTempDir('nomi-evidence-test-')
  const report = { schemaVersion: 2, generatedAt: '2026-10-11T01:00:00.000Z', cells: [] }
  const first = harness.writeReport(root, report)
  const second = harness.writeReport(root, { ...report, marker: 'second' })
  assert.notEqual(first, second)
  assert.equal(JSON.parse(fs.readFileSync(first)).marker, undefined)
  assert.equal(JSON.parse(fs.readFileSync(second)).marker, 'second')
})

const probe = () => ({
  documentId: 'document-1', probeId: 'sample-1', inputAt: 10, visibleAt: 30, readyAt: 40, acknowledgedAt: 45,
  frames: [{ startTime: 0, duration: 200 }, { startTime: 11, duration: 16 }, { startTime: 29, duration: 17 }, { startTime: 46, duration: 300 }],
  longTasks: [{ startTime: 0, duration: 70 }, { startTime: 12, duration: 60 }, { startTime: 46, duration: 80 }],
})

test('latency uses browser milestones; collection and preceding/following tasks are excluded', () => {
  assert.equal(typeof harness.normalizeActionSample, 'function')
  const sample = harness.normalizeActionSample(probe(), { documentId: 'document-1', probeId: 'sample-1' })
  assert.equal(sample.inputToVisibleMs, 20)
  assert.equal(sample.inputToReadyMs, 30)
  assert.equal(sample.inputToAcknowledgedMs, 35)
  assert.deepEqual(sample.frameTimes, [16, 16])
  assert.deepEqual(sample.longTasks, [33])
  assert.equal(sample.elapsedMs, undefined)
})

test('raw durations crossing the end are retained but clipped in action-window metrics', () => {
  const raw = { ...probe(), longTasks: [{ startTime: 44, duration: 300 }] }
  const sample = harness.normalizeActionSample(raw, { documentId: 'document-1', probeId: 'sample-1' })
  assert.deepEqual(sample.longTasks, [1])
  assert.deepEqual(sample.rawProbe.longTasks, [{ startTime: 44, duration: 300 }])
})

test('the real browser probe retains input-to-first-frame stalls and only trusted input', () => {
  let now = 0, frameCallback
  const listeners = {}
  const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }), closest: () => null, parentElement: null }
  box.querySelector = () => ({ ...box, complete: true, naturalWidth: 100 })
  const context = { args: { probeId: 'sample', cardSelector: '.card', projectName: 'Known', nodeId: 'node' }, window: { innerWidth: 1280, innerHeight: 933 }, crypto: { randomUUID: () => 'doc' },
    performance: { now: () => now }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame: (fn) => { frameCallback = fn; return 1 }, cancelAnimationFrame: () => {},
    PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
    document: { querySelector: (selector) => selector.includes('project-menu') ? { ...box, textContent: 'Known' } : { ...box, getAttribute: () => 'true', querySelector: () => box },
      addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: (name) => { delete listeners[name] } },
  }
  vm.runInNewContext(`(${installProjectOpenProbe.toString()})(args)`, context)
  now = 1; listeners.pointerdown({ isTrusted: false, target: { closest: () => true } })
  assert.equal(context.window.__nomiWorkflowPerf.inputAt, null)
  now = 10; listeners.pointerdown({ isTrusted: true, target: { closest: () => true } })
  now = 300; frameCallback(now)
  now = 316; frameCallback(now)
  now = 317; listeners.keydown({ isTrusted: true, key: 'Shift' })
  const state = JSON.parse(JSON.stringify(context.window.__nomiWorkflowPerf.stop()))
  const sample = harness.normalizeActionSample(state, { documentId: 'doc', probeId: 'sample' })
  assert.deepEqual(sample.frameTimes, [290, 16])
  assert.equal(sample.inputToReadyMs, 290)
  assert.deepEqual(Object.keys(listeners), [])
})

test('a visible canvas card with pending image decoding is not visible project content', () => {
  let now = 10, frameCallback
  const listeners = {}
  const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }), closest: () => null, parentElement: null }
  const media = { ...box, complete: false, naturalWidth: 0 }
  const node = { ...box, querySelector: () => media }
  const stage = { ...box, getAttribute: () => 'true', querySelector: () => node }
  const context = { args: { probeId: 'sample', cardSelector: '.card', projectName: 'Known', nodeId: 'node' }, window: { innerWidth: 1280, innerHeight: 933 }, crypto: { randomUUID: () => 'doc' },
    performance: { now: () => now }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    requestAnimationFrame: (fn) => { frameCallback = fn; return 1 }, cancelAnimationFrame: () => {},
    PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
    document: { querySelector: (selector) => selector.includes('project-menu') ? { ...box, textContent: 'Known' } : stage,
      addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: () => {} },
  }
  vm.runInNewContext(`(${installProjectOpenProbe.toString()})(args)`, context)
  listeners.pointerdown({ isTrusted: true, target: { closest: () => true } })
  now = 30; frameCallback(now)
  assert.equal(context.window.__nomiWorkflowPerf.visibleAt, null)
  assert.equal(context.window.__nomiWorkflowPerf.readyAt, null)
  media.complete = true; media.naturalWidth = 100
  now = 46; frameCallback(now)
  assert.equal(context.window.__nomiWorkflowPerf.visibleAt, 46)
  assert.equal(context.window.__nomiWorkflowPerf.readyAt, 46)
})

test('screen-outside, transparent-ancestor and canvas-outside nodes cannot satisfy visible content', () => {
  for (const mode of ['offscreen', 'transparent-ancestor', 'outside-canvas']) {
    let now = 10, frameCallback
    const listeners = {}
    const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }), closest: () => null }
    const node = { ...box, parentElement: mode === 'transparent-ancestor' ? { ...box, opacity: '0', parentElement: null } : null,
      getBoundingClientRect: mode === 'offscreen' ? () => ({ left: 5000, top: 5000, right: 5100, bottom: 5100, width: 100, height: 100 }) : box.getBoundingClientRect }
    const stage = { ...box, getAttribute: () => 'true', querySelector: () => mode === 'outside-canvas' ? null : node }
    const context = { args: { probeId: 'sample', cardSelector: '.card', projectName: 'Known', nodeId: 'node' }, window: { innerWidth: 1280, innerHeight: 933 }, crypto: { randomUUID: () => 'doc' },
      performance: { now: () => now }, getComputedStyle: (element) => ({ display: 'block', visibility: 'visible', opacity: element.opacity || '1' }),
      requestAnimationFrame: (fn) => { frameCallback = fn; return 1 }, cancelAnimationFrame: () => {},
      PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
      document: { querySelector: (selector) => selector.includes('project-menu') ? { ...box, textContent: 'Known' } : selector.includes('stage') ? stage : node,
        addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: () => {} },
    }
    vm.runInNewContext(`(${installProjectOpenProbe.toString()})(args)`, context)
    listeners.pointerdown({ isTrusted: true, target: { closest: () => true } })
    now = 30; frameCallback(now)
    assert.equal(context.window.__nomiWorkflowPerf.visibleAt, null, mode)
    assert.equal(context.window.__nomiWorkflowPerf.readyAt, null, mode)
  }
})

test('waiting rejects missing/reloaded probe immediately as invalid', async () => {
  for (const state of [undefined, { documentId: 'reloaded', probeId: 'sample', readyAt: null }]) {
    const page = { evaluate: (fn, args) => vm.runInNewContext(`(${fn.toString()})(args)`, { args, window: { __nomiWorkflowPerf: state }, setTimeout, clearTimeout, requestAnimationFrame: () => assert.fail('invalid probe must not keep waiting') }) }
    await assert.rejects(harness.waitForProbeReady(page, { documentId: 'doc', probeId: 'sample' }, 1000), /invalid measurement/)
  }
})

test('ready wait uses evaluate conditions without launcher feel checkpoint APIs', async () => {
  assert.equal(typeof harness.waitForProbeReady, 'function')
  const page = {
    waitForFunction: () => assert.fail('would run feel scans/screenshots inside action window'),
    evaluate: (fn, args) => vm.runInNewContext(`(${fn.toString()})(args)`, { args, window: { __nomiWorkflowPerf: { documentId: 'doc', probeId: 'sample', readyAt: 15 } }, setTimeout, clearTimeout, requestAnimationFrame: () => assert.fail('already ready') }),
  }
  await harness.waitForProbeReady(page, { documentId: 'doc', probeId: 'sample' }, 1000)
})

test('schema-v2 passed flags with empty samples cannot certify acceptance', () => {
  const cell = { id: 'project.open', scale: 'small', cache: 'cold', status: 'passed', implemented: true, executed: true, passed: true, samples: [{}, {}, {}, {}, {}], acceptanceMissing: [] }
  assert.notEqual(harness.reportExitCode({ schemaVersion: 2, cells: [cell] }), 0)
  const analysis = buildAnalysis([{ file: 'invalid.json', report: { schemaVersion: 2, cells: [cell] } }])
  assert.notEqual(analysis.exitCode, 0)
  assert.match(analysis.markdown, /invalid/)
})

test('schema-v2 samples without decoded-content and persistence receipts are not measurement evidence', () => {
  const sample = { ...harness.normalizeActionSample({ ...probe(), longTaskSupported: true }, { documentId: 'document-1', probeId: 'sample-1' }), functionalPassed: true }
  const report = { schemaVersion: 2, cells: [{ id: 'project.open', scale: 'small', cache: 'cold', status: 'inconclusive', samples: [sample] }] }
  assert.match(buildAnalysis([{ file: 'pre-content-proof.json', report }]).markdown, /invalid evidence/)
  sample.assertions = { firstImageDecoded: true, persistedContentUnchanged: true }
  assert.doesNotMatch(buildAnalysis([{ file: 'current.json', report }]).markdown, /invalid evidence/)
})

test('missing/replaced probe or unobserved milestone is invalid, never an empty measurement', () => {
  assert.equal(typeof harness.normalizeActionSample, 'function')
  for (const state of [null, { ...probe(), documentId: 'reloaded' }, { ...probe(), probeId: 'old-sample' }, { ...probe(), inputAt: null }, { ...probe(), visibleAt: null }, { ...probe(), acknowledgedAt: 35 }]) {
    assert.throws(() => harness.normalizeActionSample(state, { documentId: 'document-1', probeId: 'sample-1' }))
  }
})

test('aggregation pools raw distributions and keeps cache cells and support counts distinct', () => {
  assert.equal(typeof harness.summarizeCell, 'function')
  const summary = harness.summarizeCell({ cache: 'cold', samples: [
    { inputToVisibleMs: 10, inputToReadyMs: 20, frameTimes: [1, 1, 1, 1], longTasks: [], frameP95: 999 },
    { inputToVisibleMs: 20, inputToReadyMs: 30, frameTimes: [100], longTasks: [60] },
  ] })
  assert.equal(summary.frameP95, percentile([1, 1, 1, 1, 100], 0.95))
  assert.equal(summary.frameSamples, 5)
  assert.equal(summary.actionSamples, 2)
  assert.equal(summary.cache, 'cold')
  assert.equal(summary.p99Supported, false)
})

test('blocked, invalid, planned, empty and incomplete evidence never passes acceptance', () => {
  assert.equal(typeof harness.reportExitCode, 'function')
  for (const cells of [[], [{ status: 'blocked_environment' }], [{ status: 'invalid' }], [{ status: 'planned' }], [{ status: 'executed', passed: false }], [{ status: 'passed', passed: true, implemented: false }]]) {
    assert.notEqual(harness.reportExitCode({ cells }), 0)
  }
})

test('project selector requires the persisted record identity, not the fixture envelope', () => {
  assert.equal(typeof harness.projectCardSelector, 'function')
  const fixture = createNomiUserWorkflowFixture({ projectsDir: makeTempDir('nomi-selector-'), scale: 'small', projectId: 'known-id' })
  assert.throws(() => harness.projectCardSelector(fixture))
  assert.equal(harness.projectCardSelector(fixture.record), '[data-project-card][data-project-id="known-id"]')
})

test('each cold/hot repetition receives a fresh persisted fixture and closes on failure', async () => {
  assert.equal(typeof harness.runCell, 'function')
  const roots = [], closed = [], primed = []
  const options = { runs: 2, warmup: 1, launchTimeout: 1000 }
  const cell = { id: 'project.open', scale: 'small', cache: 'hot', implemented: true, samples: [] }
  const result = await harness.runCell(cell, options, {
    launch: async (config) => {
      roots.push(config.tempRoot)
      return { app: config.tempRoot, win: config.tempRoot }
    },
    close: async (app) => closed.push(app),
    prepare: async (_instance, fixture, cache) => primed.push([fixture.record.id, cache]),
    measure: async (_instance, fixture) => {
      const manifest = path.join(fixture.projectRoot, '.nomi', 'project.json')
      const record = JSON.parse(fs.readFileSync(manifest))
      assert.ok(!record.contaminated)
      record.contaminated = true
      fs.writeFileSync(manifest, JSON.stringify(record))
      if (roots.length === 3) throw Object.assign(new Error('invalid measurement: probe lost'), { probeState: { ...probe(), acknowledgedAt: null } })
      return { ...harness.normalizeActionSample(probe(), { documentId: 'document-1', probeId: 'sample-1' }), functionalPassed: true }
    },
  })
  assert.equal(new Set(roots).size, 3)
  assert.deepEqual(closed, roots)
  assert.equal(primed.length, 3)
  assert.ok(primed.every(([, cache]) => cache === 'hot'))
  assert.equal(result.status, 'invalid')
  assert.equal(result.samples.length, 1) // warm-up excluded; good sample retained
  assert.equal(result.attempts.length, 3)
  assert.equal(result.attempts[2].invalidProbe.acknowledgedAt, null)
  assert.equal(result.passed, false)
})

test('planned journeys do not launch or inherit an environment blocker', async () => {
  assert.equal(typeof harness.runCell, 'function')
  const result = await harness.runCell({ id: 'D1', scale: 'small', cache: 'cold', samples: [] }, { runs: 1, warmup: 0 }, {
    launch: async () => assert.fail('planned action must not launch'),
  })
  assert.equal(result.status, 'planned')
  assert.equal(result.implemented, false)
  assert.equal(result.executed, false)
})

test('persisted document, plan, group and history changes fail the project-open correctness check', () => {
  assert.equal(typeof harness.assertFixtureUnchanged, 'function')
  for (const mutate of [
    (record) => { record.payload.workbenchDocuments[0].title = 'unexpected' },
    (record) => { Object.values(record.payload.storyboardDesignsByDocumentId)[0][0].plan.shots[0].prompt = 'unexpected' },
    (record) => { record.payload.generationCanvas.groups[0].nodeIds = [] },
    (record) => { record.payload.generationCanvas.nodes[0].history = [] },
  ]) {
    const fixture = createNomiUserWorkflowFixture({ projectsDir: makeTempDir('nomi-persisted-assert-'), scale: 'small' })
    harness.assertFixtureUnchanged(fixture)
    const record = JSON.parse(JSON.stringify(fixture.record))
    mutate(record)
    fs.writeFileSync(path.join(fixture.projectRoot, '.nomi', 'project.json'), JSON.stringify(record))
    assert.throws(() => harness.assertFixtureUnchanged(fixture), /persisted content changed/)
  }
})

test('legacy elapsed time is rejected by the summarizer and blocked input exits nonzero', () => {
  const root = makeTempDir('nomi-analysis-')
  fs.writeFileSync(path.join(root, 'legacy.json'), JSON.stringify({ schemaVersion: 1, scales: [{ scale: 'small', scenarios: [{ id: 'P1', status: 'measured', samples: [{ elapsedMs: 999, frameP95: 42 }] }] }] }))
  const output = path.join(root, 'analysis.md')
  const processResult = spawnSync(process.execPath, ['scripts/summarize-nomi-user-performance.mjs', root, output], { encoding: 'utf8' })
  assert.notEqual(processResult.status, 0)
  assert.match(fs.readFileSync(output, 'utf8'), /legacy.*untrusted/i)
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /\| 999 \|/)
})

test('source-linked inventory distinguishes implementation and planned pairwise/higher-order coverage', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const evidence = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance')
  const inventory = JSON.parse(fs.readFileSync(path.join(evidence, 'entry-inventory.json')))
  assert.equal(inventory.entries.filter((entry) => entry.implemented).length, 1)
  assert.equal(inventory.entries.find((entry) => entry.implemented).id, 'project.open')
  assert.equal(new Set(inventory.entries.map((entry) => entry.id)).size, inventory.entries.length)
  for (const entry of inventory.entries) {
    assert.ok(fs.existsSync(path.join(root, entry.source)), entry.id)
    for (const field of ['precondition', 'input', 'visibleCompletion', 'dataAssertion', 'budget']) assert.ok(entry[field], `${entry.id}/${field}`)
    assert.equal(typeof entry.executed, 'boolean'); assert.equal(entry.passed, false)
    if (entry.executed) {
      assert.equal(entry.implemented, true)
      assert.ok(entry.evidence?.length)
      for (const file of entry.evidence) assert.ok(fs.existsSync(path.join(evidence, file)))
    } else if (!entry.implemented) assert.equal(entry.executed, false)
  }
  const registry = fs.readFileSync(path.join(root, 'src/workbench/generationCanvas/nodes/registry.ts'), 'utf8')
  for (const [, kind] of registry.matchAll(/kind: '([^']+)'/g)) assert.ok(inventory.entries.some((entry) => entry.id === `node.${kind}`), kind)
  const combinations = JSON.parse(fs.readFileSync(path.join(evidence, 'combination-plan.json')))
  const dimensions = Object.entries(combinations.dimensions)
  for (let left = 0; left < dimensions.length; left++) for (let right = left + 1; right < dimensions.length; right++) {
    const [a, valuesA] = dimensions[left], [b, valuesB] = dimensions[right]
    for (const valueA of valuesA) for (const valueB of valuesB) assert.ok(combinations.pairwise.some((row) => row[a] === valueA && row[b] === valueB), `${a}=${valueA},${b}=${valueB}`)
  }
  assert.equal(combinations.mandatoryHigherOrder.length, 5)
  assert.ok([...combinations.pairwise, ...combinations.mandatoryHigherOrder].every((row) => row.status === 'planned'))
})

test('percentiles and raw path redaction are deterministic', () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 48)
  const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const privatePath = path.join(checkoutRoot, 'private.txt')
  const tempPath = path.join(os.tmpdir(), 'secret')
  const output = redact({ path: privatePath, nested: [tempPath] })
  assert.deepEqual(output, { path: '<repo>/private.txt', nested: ['<temp>/secret'] })
  assert.doesNotMatch(JSON.stringify(output), new RegExp(checkoutRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(JSON.stringify(output), new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})
