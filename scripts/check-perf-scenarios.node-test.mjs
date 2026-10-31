// check:perf-scenarios 的必红 / 必绿测试 + 登记表库（统计、判定、PR 证据行）的单测。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeTempDir } from './_test-temp.mjs'
import { DRIVERS, judge, knownScenarios, loadScenarios, parsePerfEvidence, quantile, scenarioIds, summarizeRuns, validateScenarios } from './perf-scenarios-lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const SCRIPT = 'tests/perf/canvas-scale-bench.mjs'

const goodScenario = (overrides = {}) => ({
  id: 'sample-drag',
  feature: '样例：拖动多个节点',
  script: SCRIPT,
  args: ['--scales', 'I150', '--scenarios', 'drag-nodes-20'],
  scale: '150 个图片节点',
  metrics: ['frameGapP95', 'longTasks'],
  budget: 33,
  baseline: { median: 20, p95: 24, runs: 5, machine: 'test', date: '2026-10-11', commit: 'abc1234' },
  ...overrides,
})

function fixtureRoot(scenarios, { withScript = true } = {}) {
  const root = makeTempDir('nomi-perf-scenarios-')
  fs.mkdirSync(path.join(root, 'tests/perf/scenarios'), { recursive: true })
  if (withScript) {
    fs.mkdirSync(path.join(root, 'tests/perf'), { recursive: true })
    fs.writeFileSync(path.join(root, SCRIPT), '')
  }
  for (const [name, data] of Object.entries(scenarios)) fs.writeFileSync(path.join(root, 'tests/perf/scenarios', name), typeof data === 'string' ? data : JSON.stringify(data))
  return root
}
const runGate = (root) => spawnSync(process.execPath, [path.join(here, 'check-perf-scenarios.mjs')], { encoding: 'utf8', env: { ...process.env, PERF_SCENARIOS_REPO_ROOT: root } })

test('门岗必红：缺 baseline 的场景', () => {
  const { baseline, ...noBaseline } = goodScenario()
  const run = runGate(fixtureRoot({ 'sample-drag.json': noBaseline }))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /缺 baseline/)
})

test('门岗必红：budget / baseline 不是数字、runs 不足 5', () => {
  const run = runGate(fixtureRoot({ 'sample-drag.json': goodScenario({ budget: '33ms', baseline: { median: '20', p95: 24, runs: 3, machine: 'm', date: 'd', commit: 'c' } }) }))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /budget 必须是正数/)
  assert.match(run.stderr, /baseline\.median 必须是数字/)
  assert.match(run.stderr, /baseline\.runs 必须是数字且 ≥ 5/)
})

test('门岗必红：script 不存在、script 没有适配、id 与文件名不一致、id 重复', () => {
  const missing = runGate(fixtureRoot({ 'sample-drag.json': goodScenario() }, { withScript: false }))
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /script 不存在/)
  const root = fixtureRoot({
    'sample-drag.json': goodScenario(),
    'other.json': goodScenario({ id: 'sample-drag' }),
    'unadapted.json': goodScenario({ id: 'unadapted', script: 'tests/perf/handmade-profiler.mjs' }),
  })
  fs.writeFileSync(path.join(root, 'tests/perf/handmade-profiler.mjs'), '')
  const run = runGate(root)
  assert.equal(run.status, 1)
  assert.match(run.stderr, /文件名要和 id 一致/)
  assert.match(run.stderr, /重复/)
  assert.match(run.stderr, /还没有适配/)
})

test('门岗必红：metrics 量具量不出、args 自带 --runs', () => {
  const run = runGate(fixtureRoot({ 'sample-drag.json': goodScenario({ metrics: ['openToInteractive'], args: ['--runs', '3'] }) }))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /量不出/)
  assert.match(run.stderr, /不要写 --runs/)
})

test('门岗必红：预算状态不认识、提议的预算没写依据', () => {
  const run = runGate(fixtureRoot({
    'sample-drag.json': goodScenario({ budgetStatus: 'maybe' }),
    'no-basis.json': goodScenario({ id: 'no-basis', budgetStatus: 'proposed' }),
  }))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /budgetStatus 只能是/)
  assert.match(run.stderr, /budgetBasis 写依据/)
  const ok = runGate(fixtureRoot({ 'sample-drag.json': goodScenario({ budgetStatus: 'proposed', budgetBasis: '60Hz 下 p95 不超过两帧（33ms）' }) }))
  assert.equal(ok.status, 0, ok.stderr)
})

test('画布规模基准的读结果：工作台场景的响应与主进程往返按样本读出，缺的数不凑 0', () => {
  const payload = { results: [{ samples: [
    { frameP95Ms: 12, longTasks: 0, responseMs: 80, mainRoundTripMaxMs: 40 },
    { frameP95Ms: 14, longTasks: 1, responseMs: 95, mediaRequests: 7, blankCardPct: 0 },
  ] }] }
  const runs = DRIVERS['tests/perf/canvas-scale-bench.mjs'].readRuns(payload)
  // mediaRequests：库场景（library-*）打开那一下发出的图片 / 视频请求数（设计卡 2026-10-23-skill-prompt-library-layout ★7）。
  // blankCardPct：远看密集（far-dense-pan）的缺块率；阳性对照没过的样本不交这个数（缺的不凑 0）。
  assert.deepEqual(runs, { frameGapP95: [12, 14], longTasks: [0, 1], response: [80, 95], mainRoundTripMax: [40], mediaRequests: [7], blankCardPct: [0] })
  const open = DRIVERS['tests/ux/project-open-stages.e2e.mjs'].readRuns({ samples: [
    { kind: 'cold', clickToMediaMs: 900, longTaskCount: 2, backToLibraryMs: 210 },
    { kind: 'reopen', clickToMediaMs: 500, longTaskCount: 0 },
  ] })
  assert.deepEqual(open, { openToInteractive: [900], longTasks: [2], response: [210] })
})

test('门岗必绿：字段齐全的场景', () => {
  const run = runGate(fixtureRoot({ 'sample-drag.json': goodScenario() }))
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /1 个场景/)
})

test('仓库真实登记表通过门岗，且每个场景的量具都有适配', () => {
  const entries = loadScenarios(repoRoot)
  assert.ok(entries.length >= 2, '至少有两个种子场景')
  assert.deepEqual(validateScenarios(entries, { exists: (rel) => fs.existsSync(path.join(repoRoot, rel)) }), [])
  for (const entry of entries) assert.ok(DRIVERS[entry.data.script], entry.file)
})

test('统计：中位数与 p95 同 project-open-stages 的线性插值口径', () => {
  assert.equal(quantile([10, 20, 30, 40, 50], 0.5), 30)
  assert.equal(quantile([10, 20, 30, 40, 50], 0.95), 48)
  assert.deepEqual(summarizeRuns([5, null, 15, 25]), { runs: 3, median: 15, p95: 24 })
  assert.equal(quantile([], 0.5), null)
})

test('判定：超预算、退化 >20%、噪声基线只提示', () => {
  const scenario = goodScenario()
  assert.equal(judge(scenario, { median: 40, p95: 50 }).status, 'over-budget')
  assert.equal(judge(scenario, { median: 25, p95: 30 }).status, 'regression') // 比基线 20 差 25%
  assert.equal(judge(scenario, { median: 22, p95: 30 }).status, 'ok')
  assert.equal(judge(goodScenario({ baseline: { ...scenario.baseline, noisy: true } }), { median: 25, p95: 30 }).status, 'regression-noisy')
  assert.equal(judge(scenario, { median: null, p95: null }).status, 'no-data')
})

test('PR 证据行：格式、未验证不算通过、不适用要有理由、id 必须在登记表里', () => {
  const known = ['sample-drag']
  assert.deepEqual(parsePerfEvidence('- perf-scenario：sample-drag 中位数 20 / p95 24 / 预算 33', known), { ok: true, id: 'sample-drag' })
  assert.deepEqual(parsePerfEvidence('- perf-scenario: sample-drag 中位数 20ms / p95 24ms / 预算 33ms', known), { ok: true, id: 'sample-drag' })
  assert.equal(parsePerfEvidence('- perf-scenario：未验证：没有量具', known).ok, false)
  assert.match(parsePerfEvidence('- perf-scenario：未验证：没有量具', known).reason, /不接受「未验证」/)
  assert.equal(parsePerfEvidence('- perf-scenario：sample-drag 很快', known).ok, false)
  assert.equal(parsePerfEvidence('- perf-scenario：ghost 中位数 1 / p95 2 / 预算 3', known).ok, false)
  assert.equal(parsePerfEvidence('- perf-scenario：不适用：只改了一行文案', known).ok, true)
  assert.equal(parsePerfEvidence('- perf-scenario：不适用：无', known).ok, false)
  assert.deepEqual(scenarioIds([{ data: { id: 'a' } }, { data: null }]), ['a'])
})


test('whiteboard driver rejects failed and incomplete journeys even when frame samples exist', () => {
  const driver = DRIVERS['tests/ux/whiteboard-refactor.walk.mjs']
  const complete = { rendererErrors: [], checks: ['no renderer exceptions'], performance: { frames: 368, frameP95Ms: 10, longTasks: [] } }
  assert.deepEqual(driver.readRuns({ samples: [
    complete,
    { ...complete, error: 'capture toolbar clipped' },
    { ...complete, rendererErrors: ['renderer exception'] },
    { ...complete, checks: [] },
    { ...complete, performance: { ...complete.performance, frames: 2 } },
    { ...complete, performance: { ...complete.performance, frameP95Ms: null } },
  ] }), { frameGapP95: [10], longTasks: [0] })
  assert.deepEqual(driver.readRuns({}), { frameGapP95: [], longTasks: [] })
})

// ── 欠账（已知超预算）与待测 ───────────────────────────────────────────────────────────────────────────────────
const debt = { owner: 'P-sample', state: 'assigned', note: '每帧全局查询，修复线在改', since: '2026-10-16' }
const overBudget = (overrides = {}) => goodScenario({ baseline: { median: 40, p95: 44, runs: 5, machine: 'test', date: '2026-10-16', commit: 'abc1234' }, ...overrides })

test('门岗：超预算的基线必须登记欠账，达标了必须删掉欠账', () => {
  const missing = runGate(fixtureRoot({ 'sample-drag.json': overBudget() }))
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /超预算 33：不许偷偷放着/)
  const cleared = runGate(fixtureRoot({ 'sample-drag.json': goodScenario({ budgetDebt: debt }) }))
  assert.equal(cleared.status, 1)
  assert.match(cleared.stderr, /欠账还清了，删掉 budgetDebt/)
  const bad = runGate(fixtureRoot({ 'sample-drag.json': overBudget({ budgetDebt: { owner: '', state: 'later', note: '慢', since: '昨天' } }) }))
  assert.equal(bad.status, 1)
  for (const pattern of [/budgetDebt.owner/, /budgetDebt.state 只能是/, /budgetDebt.note/, /budgetDebt.since/]) assert.match(bad.stderr, pattern)
  const ok = runGate(fixtureRoot({ 'sample-drag.json': overBudget({ budgetDebt: debt }) }))
  assert.equal(ok.status, 0, ok.stderr)
})

test('门岗：待测场景只许 proposed、不许有基线和欠账；量过的不许再挂待测', () => {
  const { baseline, ...noBaseline } = goodScenario()
  const pending = { ...noBaseline, budgetStatus: 'proposed', budgetBasis: '一次性迁移，Nielsen 1s/10s', measurement: { state: 'pending', reason: '夹具还差一档旧项目' } }
  const ok = runGate(fixtureRoot({ 'sample-drag.json': pending }))
  assert.equal(ok.status, 0, ok.stderr)
  const run = runGate(fixtureRoot({
    'sample-drag.json': { ...pending, budgetStatus: 'approved' },
    'measured.json': { ...goodScenario({ id: 'measured', budgetStatus: 'proposed', budgetBasis: '一次性迁移，Nielsen 1s/10s' }), measurement: { state: 'pending', reason: '夹具还差一档旧项目' } },
  }))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /待测场景的预算只能是 proposed/)
  assert.match(run.stderr, /已经有基线了：去掉 measurement/)
})

test('判定：欠账场景超预算是 known-debt（不算失败），比欠账基线又差 >20% 是 regression（棘轮）', () => {
  const scenario = overBudget({ budgetDebt: debt })
  assert.equal(judge(scenario, { median: 45, p95: 50 }).status, 'known-debt')
  assert.equal(judge(scenario, { median: 49, p95: 55 }).status, 'regression') // 比欠账基线 40 差 22.5%
  assert.equal(judge(scenario, { median: 30, p95: 32 }).status, 'ok') // 修到预算内
  assert.equal(judge(overBudget(), { median: 45, p95: 50 }).status, 'over-budget') // 没登记欠账照旧红
})

test('PR 证据行核数字：预算以登记表为准；超预算红，欠账场景不比欠账基线更差就放行', () => {
  const byId = new Map([['sample-drag', goodScenario()], ['debt-drag', overBudget({ id: 'debt-drag', budgetDebt: debt })]])
  const known = [...byId.keys()]
  assert.deepEqual(parsePerfEvidence('- perf-scenario：sample-drag 中位数 20 / p95 24 / 预算 33', known, byId), { ok: true, id: 'sample-drag' })
  assert.match(parsePerfEvidence('- perf-scenario：sample-drag 中位数 20 / p95 24 / 预算 50', known, byId).reason, /登记的预算是 33/)
  assert.match(parsePerfEvidence('- perf-scenario：sample-drag 中位数 40 / p95 44 / 预算 33', known, byId).reason, /> 预算 33/)
  assert.deepEqual(parsePerfEvidence('- perf-scenario：debt-drag 中位数 44 / p95 46 / 预算 33', known, byId), { ok: true, id: 'debt-drag' })
  assert.match(parsePerfEvidence('- perf-scenario：debt-drag 中位数 50 / p95 52 / 预算 33', known, byId).reason, /欠账场景又变差/)
  // 预算内的场景只看预算：比基线慢一点（机器噪声）不拦人。
  assert.deepEqual(parsePerfEvidence('- perf-scenario：sample-drag 中位数 30 / p95 31 / 预算 33', known, byId), { ok: true, id: 'sample-drag' })
})

test('knownScenarios 带出场景本身（PR 头的覆盖基线的），证据行拿它核数字', () => {
  const baseEntries = [{ file: 'tests/perf/scenarios/sample-drag.json', data: goodScenario() }]
  const prFiles = [{ file: 'tests/perf/scenarios/sample-drag.json', content: JSON.stringify(goodScenario({ budget: 40 })) }]
  const known = knownScenarios({ baseEntries, prFiles })
  assert.deepEqual(known.ids, ['sample-drag'])
  assert.equal(known.byId.get('sample-drag').budget, 40)
})

test('内联画板量具的读结果：失败 / 带渲染异常的样本整份丢掉，各场景只读自己量的那几项', () => {
  const driver = DRIVERS['tests/ux/whiteboard-perf.probe.mjs']
  const good = { rendererErrors: [], openToInteractiveMs: 420, openLongTasks: 1, idleBusyPct: 0.2, idleRectReadsPerSec: 0, idleLayoutsPerSec: 0 }
  const values = driver.readRuns({ samples: [
    good,
    { ...good, error: 'Error: timed out' },
    { ...good, rendererErrors: ['renderer exception'] },
    { ...good, rendererErrors: undefined },
    { rendererErrors: [], typeResponseP95Ms: 18, frameP95Ms: 6.2, longTasks: 0, panelFramesOff: 12 },
  ] })
  assert.deepEqual(values.openToInteractive, [420])
  assert.deepEqual(values.idleBusyPct, [0.2])
  assert.deepEqual(values.response, [18])
  assert.deepEqual(values.longTasks, [1, 0]) // 打开阶段的长任务；拖动场景自己的长任务优先
  assert.deepEqual(values.panelFramesOff, [12])
  assert.deepEqual(driver.readRuns({}), { openToInteractive: [], response: [], frameGapP95: [], longTasks: [], idleRectReadsPerSec: [], idleBusyPct: [], idleLayoutsPerSec: [], panelFramesOff: [] })
})

const NODE_JSON_SCRIPT = 'tests/perf/node-json-bench.mjs'
test('Node JSON driver reads non-UI metrics without a script-specific adapter', () => {
  const driver = DRIVERS[NODE_JSON_SCRIPT]
  assert.ok(driver, 'generic Node JSON driver is registered')
  const payload = { runs: 5, noisy: false, metrics: { rssMiB: [11, 12, 13, 14, 15], response: [1, 2, 3, 4, 5] } }
  assert.deepEqual(driver.readRuns(payload, { metrics: ['rssMiB', 'response'] }), payload.metrics)
  const args = driver.buildArgs(NODE_JSON_SCRIPT, ['--instrument', 'tests/perf/any-probe.mjs', '--', '--size', 'large'], { runs: 5, label: 'probe' })
  assert.equal(args[0], NODE_JSON_SCRIPT)
  assert.equal(args[args.indexOf('--runs') + 1], '5')
  assert.equal(args[args.indexOf('--out') + 1], driver.resultFile('probe'))
  const scenario = goodScenario({ script: NODE_JSON_SCRIPT, metrics: ['rssMiB'], budget: 160 })
  assert.deepEqual(validateScenarios([{ file: 'tests/perf/scenarios/sample-drag.json', data: scenario }], { exists: () => true }), [])
})

test('Node JSON driver rejects noisy, dropped, invalid and missing measurements instead of filtering', () => {
  const driver = DRIVERS[NODE_JSON_SCRIPT]
  const good = { runs: 5, noisy: false, metrics: { rssMiB: [11, 12, 13, 14, 15] } }
  for (const [payload, message] of [
    [{ ...good, noisy: true }, /noisy/i],
    [{ ...good, metrics: { rssMiB: [11, 12, 13, 14] } }, /sample|count|runs/i],
    [{ ...good, metrics: { rssMiB: [11, 12, null, 14, 15] } }, /finite|numeric/i],
    [{ ...good, metrics: { rssMiB: [11, 12, Infinity, 14, 15] } }, /finite|numeric/i],
    [{ ...good, metrics: { response: [1, 2, 3, 4, 5] } }, /missing/i],
  ]) assert.throws(() => driver.readRuns(payload, { metrics: ['rssMiB'] }), message)
})

function nodeJsonProbe(source, { stale = false } = {}) {
  const root = makeTempDir('node-json-driver-')
  const script = path.join(root, 'probe.mjs'), out = path.join(root, 'result.json')
  fs.writeFileSync(script, `import fs from 'node:fs'\nconst args=process.argv.slice(2);const get=(name)=>args[args.indexOf(name)+1];const out=get('--out');const runs=Number(get('--runs'));\n${source}\n`)
  if (stale) fs.writeFileSync(out, JSON.stringify({ runs: 5, noisy: false, metrics: { rssMiB: [1, 2, 3, 4, 5] } }))
  const run = spawnSync(process.execPath, [path.join(repoRoot, NODE_JSON_SCRIPT), '--instrument', script, '--runs', '5', '--out', out, '--', '--size', 'large'], { cwd: repoRoot, encoding: 'utf8' })
  return { ...run, out }
}

test('Node JSON wrapper runs a real child and preserves its complete numeric measurements', () => {
  const run = nodeJsonProbe(`if(get('--size')!=='large')throw new Error('lost instrument args');fs.writeFileSync(out,JSON.stringify({runs,noisy:false,metrics:{rssMiB:Array.from({length:runs},(_,i)=>i+10),response:[1,2,3,4,5]}}))`)
  assert.equal(run.status, 0, run.stderr)
  const payload = JSON.parse(fs.readFileSync(run.out, 'utf8'))
  assert.equal(payload.runs, 5)
  assert.deepEqual(DRIVERS[NODE_JSON_SCRIPT].readRuns(payload, { metrics: ['rssMiB'] }), { rssMiB: [10, 11, 12, 13, 14] })
})

test('Node JSON wrapper rejects good files from failed children and bad JSON or incomplete samples', () => {
  for (const [source, message] of [
    [`fs.writeFileSync(out,JSON.stringify({runs,noisy:false,metrics:{rssMiB:[1,2,3,4,5]}}));process.exit(9)`, /instrument exited 9/i],
    [`fs.writeFileSync(out,'<html>upstream error</html>')`, /JSON/i],
    [`fs.writeFileSync(out,JSON.stringify({runs,noisy:true,metrics:{rssMiB:[1,2,3,4,5]}}))`, /noisy/i],
    [`fs.writeFileSync(out,JSON.stringify({runs,noisy:false,metrics:{rssMiB:[1,2,3,4]}}))`, /sample|count|runs/i],
  ]) {
    const run = nodeJsonProbe(source)
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, message)
  }
})

test('Node JSON wrapper never accepts stale results when a successful child writes nothing', () => {
  const run = nodeJsonProbe('// No output from this run.', { stale: true })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /JSON|result|output/i)
})
