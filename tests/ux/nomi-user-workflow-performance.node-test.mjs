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
import { buildControlInventory } from '../../scripts/build-nomi-workflow-control-inventory.mjs'
import { buildAnalysis } from '../../scripts/summarize-nomi-user-performance.mjs'
import { applyCellVerdict, validActionSample } from './nomi-user-workflow-contract.mjs'

const semanticProbe = () => ({ documentId: 'document-1', probeId: 'sample-1', inputAt: 10, feedbackAt: 30, contentAt: 900, readyAt: 40, controlInputAt: 45, acknowledgedAt: 610,
  targetReceipt: { control: 'project-menu', expanded: true, menuVisible: true }, longTaskSupported: true,
  frames: [{ startTime: 10, duration: 16 }, { startTime: 26, duration: 16 }], longTasks: [] })

test('semantic budgets distinguish feedback, decoded content and delayed target-control completion', () => {
  const sample = harness.normalizeActionSample(semanticProbe(), semanticProbe())
  assert.equal(sample.inputToFeedbackMs, 20)
  assert.equal(sample.inputToContentMs, 890)
  assert.equal(sample.inputToAcknowledgedMs, 600)
  const cell = applyCellVerdict({ scale: 'small', id: 'project.open', samples: [sample] }, { runs: 5, warmup: 1 })
  assert.equal(cell.budgets.feedbackP95.verdict, 'within')
  assert.equal(cell.budgets.acknowledgedP95.verdict, 'exceeded')
  assert.equal(cell.budgets.contentP95, undefined)
  assert.equal(cell.budgets.frameP99.verdict, 'unverified')
})

test('completed target response may precede decoded content without invalidating the action', () => {
  const raw = { ...semanticProbe(), acknowledgedAt: 60, contentAt: 80 }
  const sample = harness.normalizeActionSample(raw, raw)
  assert.equal(sample.inputToAcknowledgedMs, 50)
  assert.equal(sample.inputToContentMs, 70)
  assert.equal(sample.windowEndAt, 80)
  sample.functionalPassed = true
  sample.assertions = { firstImageDecoded: true, persistedContentUnchanged: true, targetControlResponse: true }
  assert.equal(validActionSample(sample), true)
  delete sample.rawProbe.targetReceipt
  assert.equal(validActionSample(sample), false)
})

test('schema2 decode/eligibility measurements cannot produce feedback or interactive budget conclusions', () => {
  const report = JSON.parse(fs.readFileSync(new URL('../../docs/evidence/2026-10-10-nomi-user-performance/raw/nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json', import.meta.url), 'utf8'))
  const result = buildAnalysis([{ file: 'historical.json', report }])
  assert.match(result.markdown, /historical diagnostics/)
  const historicalRow = result.markdown.split('\n').find((line) => line.startsWith('| historical.json |'))
  assert.equal(historicalRow?.split('|')[7].trim(), '—', 'Document Shift must never populate the real target-control response column')
  assert.match(result.markdown, /budget conclusions withdrawn/)
  assert.notEqual(result.exitCode, 0)
})

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
    assert.equal(new Set(designs.flatMap((design) => design.plan.shots.map((shot) => shot.prompt))).size, fixture.summary.shots, 'Every competing design/shot must have distinct visible content')
    for (const design of designs) for (const shot of design.plan.shots) assert.ok(shot.prompt.includes(shot.shotId), 'Visible content carries the exact fixture shot identity')
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
  documentId: 'document-1', probeId: 'sample-1', inputAt: 10, feedbackAt: 20, contentAt: 30, readyAt: 40, controlInputAt: 42, acknowledgedAt: 45, targetReceipt: { control: 'project-menu', expanded: true, menuVisible: true },
  frames: [{ startTime: 0, duration: 5 }, { startTime: 11, duration: 16 }, { startTime: 29, duration: 17 }, { startTime: 46, duration: 300 }],
  longTasks: [{ startTime: 0, duration: 5 }, { startTime: 12, duration: 60 }, { startTime: 46, duration: 80 }],
})

test('latency uses browser milestones; collection and preceding/following tasks are excluded', () => {
  assert.equal(typeof harness.normalizeActionSample, 'function')
  const sample = harness.normalizeActionSample(probe(), { documentId: 'document-1', probeId: 'sample-1' })
  assert.equal(sample.inputToContentMs, 20)
  assert.equal(sample.inputToReadyEligibilityMs, 30)
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

function simulatedProbe({ decoded = true, nodeMode = 'visible', loading = false } = {}) {
  let now = 0, frameCallback, expanded = false, projectShown = !loading
  const listeners = {}
  const box = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }), closest: () => null, parentElement: null }
  const media = { ...box, complete: decoded, naturalWidth: decoded ? 100 : 0 }
  const node = { ...box, querySelector: () => media,
    parentElement: nodeMode === 'transparent-ancestor' ? { ...box, opacity: '0' } : null,
    getBoundingClientRect: nodeMode === 'offscreen' ? () => ({ left: 5000, top: 5000, right: 5100, bottom: 5100, width: 100, height: 100 }) : box.getBoundingClientRect }
  const stage = { ...box, getAttribute: () => 'true', querySelector: () => nodeMode === 'outside-canvas' ? null : node }
  const project = { ...box, getAttribute: (name) => ({ title: 'Known', 'aria-label': 'Known menu', 'aria-expanded': String(expanded) })[name] }
  const context = { args: { probeId: 'sample', cardSelector: '.card', projectName: 'Known', nodeId: 'node', loadingLabels: ['route loading'] }, window: { innerWidth: 1280, innerHeight: 933 }, crypto: { randomUUID: () => 'doc' },
    performance: { now: () => now }, getComputedStyle: (element) => ({ display: 'block', visibility: 'visible', opacity: element.opacity || '1' }),
    requestAnimationFrame: (fn) => { frameCallback = fn; return 1 }, cancelAnimationFrame: () => {},
    PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
    document: { querySelector: (selector) => selector === '.card' ? null : selector.includes('project-menu') ? projectShown ? project : null : stage,
      querySelectorAll: (selector) => selector.includes('loading-mark') ? loading ? [{ ...box, getAttribute: () => 'route loading' }] : [] : expanded ? [{ ...box, getAttribute: () => 'Known menu' }] : [],
      addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: (name) => { delete listeners[name] } },
  }
  vm.runInNewContext(`(${installProjectOpenProbe.toString()})(args)`, context)
  return { state: context.window.__nomiWorkflowPerf, media, listeners,
    pointer: (time, selector, trusted = true) => { now = time; listeners.pointerdown({ isTrusted: trusted, target: { closest: (value) => value === selector } }) },
    frame: (time, timestamp = time) => { now = time; frameCallback(timestamp) }, showMenu: () => { expanded = true }, showProject: () => { projectShown = true } }
}

test('the real browser probe retains input stalls and requires trusted target input plus production response', () => {
  const browser = simulatedProbe()
  browser.pointer(1, '.card', false)
  assert.equal(browser.state.inputAt, null)
  browser.pointer(10, '.card'); browser.frame(300, 5)
  assert.equal(browser.state.readyAt, 300)
  assert.equal(browser.listeners.keydown, undefined, 'document-level Shift cannot certify target input')
  browser.pointer(301, '[data-shell-project-menu]', false)
  assert.equal(browser.state.controlInputAt, null)
  browser.pointer(302, '[data-shell-project-menu]')
  browser.frame(316)
  assert.equal(browser.state.acknowledgedAt, null, 'input alone is not completion')
  browser.showMenu(); browser.frame(600)
  const state = JSON.parse(JSON.stringify(browser.state.stop()))
  const sample = harness.normalizeActionSample(state, { documentId: 'doc', probeId: 'sample' })
  assert.equal(sample.inputToFeedbackMs, 290)
  assert.equal(sample.controlResponseMs, 298)
  assert.equal(sample.inputToAcknowledgedMs, 590)
  assert.deepEqual(sample.frameTimes, [290, 16, 284])
  assert.deepEqual(Object.keys(browser.listeners), [])
})

test('decoded content can arrive after feedback, eligibility and completed target input', () => {
  const browser = simulatedProbe({ decoded: false })
  browser.pointer(10, '.card'); browser.frame(30)
  assert.equal(browser.state.feedbackAt, 30)
  assert.equal(browser.state.readyAt, 30)
  assert.equal(browser.state.contentAt, null)
  browser.pointer(31, '[data-shell-project-menu]'); browser.showMenu(); browser.frame(46)
  assert.equal(browser.state.acknowledgedAt, 46)
  assert.equal(browser.state.contentAt, null)
  browser.media.complete = true; browser.media.naturalWidth = 100; browser.frame(80)
  assert.equal(browser.state.contentAt, 80)
  assert.doesNotThrow(() => harness.normalizeActionSample(browser.state.stop(), { documentId: 'doc', probeId: 'sample' }))
})

test('existing opening spinner is feedback before target title or decoded media', () => {
  const browser = simulatedProbe({ decoded: false, loading: true })
  browser.pointer(10, '.card'); browser.frame(20)
  assert.equal(browser.state.feedbackAt, 20)
  assert.equal(browser.state.feedbackReceipt.kind, 'opening-spinner')
  assert.equal(browser.state.readyAt, null)
  browser.showProject(); browser.frame(50)
  assert.equal(browser.state.readyAt, 50)
  assert.equal(browser.state.feedbackAt, 20)
})

test('screen-outside, transparent-ancestor and canvas-outside nodes cannot satisfy content or canvas eligibility', () => {
  for (const nodeMode of ['offscreen', 'transparent-ancestor', 'outside-canvas']) {
    const browser = simulatedProbe({ nodeMode })
    browser.pointer(10, '.card'); browser.frame(30)
    assert.equal(browser.state.feedbackAt, 30, nodeMode)
    assert.equal(browser.state.contentAt, null, nodeMode)
    assert.equal(browser.state.readyAt, null, nodeMode)
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

test('schema-v3 samples without decoded-content, target-control and persistence receipts are not measurement evidence', () => {
  const sample = { ...harness.normalizeActionSample({ ...probe(), longTaskSupported: true }, { documentId: 'document-1', probeId: 'sample-1' }), functionalPassed: true }
  const report = { schemaVersion: 3, cells: [{ id: 'project.open', scale: 'small', cache: 'cold', status: 'inconclusive', samples: [sample] }] }
  assert.match(buildAnalysis([{ file: 'pre-content-proof.json', report }]).markdown, /invalid evidence/)
  sample.assertions = { firstImageDecoded: true, persistedContentUnchanged: true, targetControlResponse: true }
  assert.doesNotMatch(buildAnalysis([{ file: 'current.json', report }]).markdown, /invalid evidence/)
})

test('missing/replaced probe or unobserved milestone is invalid, never an empty measurement', () => {
  assert.equal(typeof harness.normalizeActionSample, 'function')
  for (const state of [null, { ...probe(), documentId: 'reloaded' }, { ...probe(), probeId: 'old-sample' }, { ...probe(), inputAt: null }, { ...probe(), feedbackAt: null }, { ...probe(), acknowledgedAt: 35 }]) {
    assert.throws(() => harness.normalizeActionSample(state, { documentId: 'document-1', probeId: 'sample-1' }))
  }
})

test('aggregation pools raw distributions and keeps cache cells and support counts distinct', () => {
  assert.equal(typeof harness.summarizeCell, 'function')
  const summary = harness.summarizeCell({ cache: 'cold', samples: [
    { inputToFeedbackMs: 10, inputToReadyEligibilityMs: 20, frameTimes: [1, 1, 1, 1], longTasks: [], frameP95: 999 },
    { inputToFeedbackMs: 20, inputToReadyEligibilityMs: 30, frameTimes: [100], longTasks: [60] },
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
  assert.equal(typeof harness.runNomiWorkflowCell, 'function')
  const roots = [], closed = [], primed = []
  const options = { runs: 2, warmup: 1, launchTimeout: 1000 }
  const cell = { id: 'project.open', scale: 'small', cache: 'hot', implemented: true, samples: [] }
  const result = await harness.runNomiWorkflowCell(cell, options, {
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
  assert.equal(typeof harness.runNomiWorkflowCell, 'function')
  const result = await harness.runNomiWorkflowCell({ id: 'D1', scale: 'small', cache: 'cold', samples: [] }, { runs: 1, warmup: 0 }, {
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
  assert.equal(combinations.mandatoryHigherOrder.length, 6)
  assert.ok([...combinations.pairwise, ...combinations.mandatoryHigherOrder].every((row) => row.status === 'planned'))
})

test('control inventory rechecks actual AST bindings, conditional duplication and existing walk action gaps', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const evidence = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance')
  const persisted = JSON.parse(fs.readFileSync(path.join(evidence, 'control-inventory.json')))
  assert.deepEqual(persisted, buildControlInventory(root), 'Control source/handler/selector drift must regenerate the inventory')
  const duplicate = persisted.bindings.find((entry) => entry.source.endsWith('DocumentListSidebar.tsx') && entry.selectors['data-resource-action'] === '"duplicate"')
  assert.ok(duplicate.conditions.some((condition) => condition.includes("menuTarget.kind === 'storyboard'")))
  const families = JSON.parse(fs.readFileSync(path.join(evidence, 'entry-inventory.json')))
  assert.equal(families.entries.find((entry) => entry.id === 'document.duplicate').availability, 'unavailable')
  assert.ok(persisted.bindings.every((binding) => binding.runtimeStatus === 'planned'))
  assert.ok(persisted.existingWalkActions.length > 0)
  assert.ok(persisted.existingWalkActions.some((action) => action.mapping.startsWith('gap:')))
  assert.ok(persisted.existingWalkActions.every((action) => action.executed === false))
})

test('expanded pairwise plans cover all eligible13-axis pairs plus the complete interruption/recovery combination', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/combination-plan.json')))
  assert.equal(Object.keys(plan.expandedDimensions).length, 13)
  for (const [a, va, b, vb] of plan.expandedRequiredPairs) assert.ok(plan.expandedPairwise.some((row) => String(row[a]) === va && String(row[b]) === vb), `${a}=${va},${b}=${vb}`)
  assert.ok(plan.expandedPairwise.every((row) => row.status === 'planned' && row.executed === false && !(row.concurrency === 1 && (row.agentOverlap !== 'idle' || row.sessionPlacement === 'foreground-and-background'))))
  assert.ok(plan.expandedPairwise.some((row) => row.agentOverlap === 'stream-stream'))
  assert.ok(plan.expandedPairwise.some((row) => row.agentOverlap === 'tool-tool'))
  const all = plan.mandatoryHigherOrder.find((row) => row.id === 'MANDATORY-ALL-FEATURES-INTERRUPT-RECOVER')
  assert.ok(all && all.executed === false && all.status === 'planned')
  for (const term of ['drafts', 'plans', 'mixed group', 'Agents', 'export', 'save', 'interrupt', 'recover']) assert.ok((all.input + all.visibleCompletion).toLowerCase().includes(term.toLowerCase()), term)
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

test('negative raw frame interval fails closed rather than dropping an input stall', () => {
  const raw = semanticProbe(); raw.frames[0].duration = -1
  assert.throws(() => harness.normalizeActionSample(raw, raw), /non-monotonic raw observation/)
})
