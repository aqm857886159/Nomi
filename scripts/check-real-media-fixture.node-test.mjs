// check:real-media-fixture 的红证（R17：只验过绿的门岗不算门岗）。
// 每条用例喂一份假登记表/假扫描结果，断言它**当场红**；外加两条必须证明**不会**红的（未到期的债只出 warning、合法例外不红）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluate, scanSynthetic, SYNTHETIC_RULES } from './check-real-media-fixture.mjs'

const TODAY = '2026-09-14'

const baseRegistry = () => ({
  mediaEnvVar: 'NOMI_REAL_MEDIA_DIR',
  assets: [{ id: 'v', kind: 'video', relativePath: 'a.mov', spec: {}, source: 's', whyThisOne: 'w' }],
  coverage: [
    { class: 'canvas-performance', test: 'tests/live.mjs', assets: ['v'], status: 'live' },
    { class: 'import', test: null, assets: ['v'], status: 'debt', debtId: 'd-import' },
    { class: 'export', test: null, assets: ['v'], status: 'debt', debtId: 'd-export' },
    { class: 'walkthrough', test: null, assets: ['v'], status: 'debt', debtId: 'd-walk' },
  ],
  requiredClasses: ['canvas-performance', 'import', 'export', 'walkthrough'],
})

const baseDebt = (due = '2026-10-14') => ({
  maxDebtDays: 30,
  debts: ['d-import', 'd-export', 'd-walk'].map((id) => ({
    id,
    class: id,
    why: 'w',
    plan: 'p',
    owner: 'o',
    registeredAt: '2026-09-14',
    due,
  })),
})

const liveTest = new Map([['tests/live.mjs', 'const dir = process.env.NOMI_REAL_MEDIA_DIR\n']])

const run = (over = {}) =>
  evaluate({
    registry: baseRegistry(),
    debt: baseDebt(),
    baseline: { entries: [] },
    synthetic: [],
    testFiles: liveTest,
    today: TODAY,
    ...over,
  })

test('基线状态不红', () => {
  assert.equal(run().errors.length, 0)
})

test('某一类覆盖面被清空 → 红', () => {
  const registry = baseRegistry()
  registry.coverage = registry.coverage.filter((e) => e.class !== 'import')
  const { errors } = run({ registry })
  assert.match(errors.join('\n'), /覆盖面缺口：import/)
})

test('登记的 live 测试不存在 → 红', () => {
  const { errors } = run({ testFiles: new Map() })
  assert.match(errors.join('\n'), /登记的测试 tests\/live\.mjs 不存在/)
})

test('登记了却没真的读 env / 没用 helper → 红', () => {
  const { errors } = run({ testFiles: new Map([['tests/live.mjs', 'const x = 1\n']]) })
  assert.match(errors.join('\n'), /没读 NOMI_REAL_MEDIA_DIR|没有真的取真实素材/)
})

test('素材缺失时 skip 掉 → 红（登记即放绿正是这条规则要拦的）', () => {
  const { errors } = run({
    testFiles: new Map([['tests/live.mjs', 'if (!process.env.NOMI_REAL_MEDIA_DIR) test.skip("no media")\n']]),
  })
  assert.match(errors.join('\n'), /逃生口 test-skip/)
})

test('素材缺失时静默 exit(0) → 红', () => {
  const { errors } = run({
    testFiles: new Map([['tests/live.mjs', 'if (!process.env.NOMI_REAL_MEDIA_DIR) process.exit(0)\n']]),
  })
  assert.match(errors.join('\n'), /逃生口 silent-exit/)
})

test('债过期 → 红', () => {
  const { errors } = run({ debt: baseDebt('2026-09-01') })
  assert.match(errors.join('\n'), /已于 2026-09-01 到期/)
})

test('债的到期日超过 30 天 → 红', () => {
  const { errors } = run({ debt: baseDebt('2026-12-31') })
  assert.match(errors.join('\n'), /超过上限 30 天/)
})

test('债没登记（「待建」当永久放行）→ 红', () => {
  const debt = baseDebt()
  debt.debts = debt.debts.filter((d) => d.id !== 'd-import')
  const { errors } = run({ debt })
  assert.match(errors.join('\n'), /debtId="d-import" 在 .* 里找不到/)
})

test('债还了却没销账 → 红', () => {
  const registry = baseRegistry()
  registry.coverage = registry.coverage.map((e) =>
    e.class === 'import' ? { class: 'import', test: 'tests/live.mjs', assets: ['v'], status: 'live' } : e,
  )
  const { errors } = run({ registry })
  assert.match(errors.join('\n'), /没有任何 coverage 条目认领它/)
})

test('新增一处合成素材构造 → 红（棘轮只减不增）', () => {
  const synthetic = [
    { identity: 'lavfi-source::tests/new.mjs::abc', rule: 'lavfi-source', file: 'tests/new.mjs', line: 3, hint: 'h' },
  ]
  const { errors } = run({ synthetic })
  assert.match(errors.join('\n'), /新增合成素材构造：tests\/new\.mjs:3/)
})

test('引用不存在的素材 id → 红', () => {
  const registry = baseRegistry()
  registry.coverage[0].assets = ['nope']
  const { errors } = run({ registry })
  assert.match(errors.join('\n'), /不存在的素材 id="nope"/)
})

test('未到期的债只出 warning，不红（必须证明「不会」红的那条）', () => {
  const { errors, warnings } = run()
  assert.equal(errors.length, 0)
  assert.ok(warnings.some((w) => /到期日 2026-10-14/.test(w)))
})

test('扫描器认得出四种合成写法，且 file:line 点得对', () => {
  const sources = new Map([
    [
      'tests/ux/fixtures/x-perf-fixture.mjs',
      ["const a = 1", "'-f', 'lavfi',", "'-i', `testsrc2=size=10x10`,", 'imageWidth: 960,', "src: 'data:image/svg+xml,<svg/>'"].join('\n'),
    ],
  ])
  const found = scanSynthetic(sources)
  assert.equal(found.length, 4)
  assert.deepEqual(
    found.map((f) => `${f.rule}:${f.line}`).sort(),
    ['hardcoded-media-geometry:4', 'lavfi-source:2', 'svg-data-uri:5', 'synthetic-video-source:3'],
  )
  assert.equal(SYNTHETIC_RULES.every((r) => typeof r.hint === 'string' && r.hint.length > 0), true)
})
