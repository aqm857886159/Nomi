// 框架边界门岗自测（R29）。三件必须证明的事：**命中会红、不命中会绿、债到期会红**。
//
// 为什么喂假仓库而不是扫真代码：门岗自己的测试如果只跑真实存量，它证明的是「今天长这样」，
// 证明不了「明天新增一条会不会被拦」——而后者才是这道门岗存在的全部理由（R17：加规则先验它会红）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, scanSources, stripComments, validateRegistry } from './framework-boundary-lib.mjs'

const registry = {
  frameworks: [{
    id: 'demo',
    packages: ['@demo/sdk'],
    version: '1.0.0',
    fourColumnTable: 'docs/plan/demo.md',
    capabilities: [{
      id: 'session-persistence',
      provides: 'SessionManager 负责落盘',
      evidence: '@demo/sdk dist/session-manager.d.ts:1',
      scope: ['app/runtime/'],
      forbidden: [{ id: 'own-store', pattern: 'writeOwnSessionFile\\(', why: '自研落盘会丢掉框架的版本迁移' }],
    }],
  }],
}

const identity = 'demo/session-persistence/own-store::app/runtime/session.ts'
const debtEntry = { identity, hits: 1, plan: 'docs/plan/demo.md', due: '2026-12-31' }

test('登记表缺 provides/evidence/四列表 就不合法', () => {
  assert.equal(validateRegistry(registry).length, 0)
  const broken = structuredClone(registry)
  delete broken.frameworks[0].capabilities[0].evidence
  broken.frameworks[0].fourColumnTable = ''
  const errors = validateRegistry(broken)
  assert.ok(errors.some((error) => error.includes('evidence')))
  assert.ok(errors.some((error) => error.includes('fourColumnTable')))
})

test('命中：scope 内新出现一份自研版本 → 报红，并说清框架已提供什么', () => {
  const hits = scanSources(new Map([['app/runtime/session.ts', 'writeOwnSessionFile(path)\n']]), registry)
  const errors = evaluate({ hits, baseline: { debt: [] }, today: '2026-09-07' })
  assert.equal(errors.length, 1)
  assert.ok(errors[0].includes('新增自研版本'))
  assert.ok(errors[0].includes('app/runtime/session.ts:1'))
  assert.ok(errors[0].includes('SessionManager 负责落盘'))
})

test('不命中：scope 外的同名符号、以及注释里的符号，都不报红', () => {
  const outOfScope = scanSources(new Map([['tools/other.ts', 'writeOwnSessionFile(path)\n']]), registry)
  assert.equal(outOfScope.size, 0)
  const commented = scanSources(new Map([[
    'app/runtime/session.ts',
    '// 说明：不要再 writeOwnSessionFile( 了\n/* writeOwnSessionFile( */\nconst ok = 1\n',
  ]]), registry)
  assert.equal(commented.size, 0)
  assert.equal(evaluate({ hits: commented, baseline: { debt: [] }, today: '2026-09-07' }).length, 0)
})

test('已登记的债：未到期 → 绿；到期未清 → 红，并点名收敛方案', () => {
  const hits = scanSources(new Map([['app/runtime/session.ts', 'writeOwnSessionFile(path)\n']]), registry)
  assert.deepEqual(evaluate({ hits, baseline: { debt: [debtEntry] }, today: '2026-09-07' }), [])

  const expired = evaluate({ hits, baseline: { debt: [{ ...debtEntry, due: '2026-09-01' }] }, today: '2026-09-07' })
  assert.equal(expired.length, 1)
  assert.ok(expired[0].includes('已于 2026-09-01 到期'))
  assert.ok(expired[0].includes('docs/plan/demo.md'))
})

test('债条目必须绑方案与到期日；缺一即红（登记是有时限的承诺，不是永久豁免）', () => {
  const hits = scanSources(new Map([['app/runtime/session.ts', 'writeOwnSessionFile(path)\n']]), registry)
  const noPlan = evaluate({ hits, baseline: { debt: [{ identity, hits: 1, due: '2026-12-31' }] }, today: '2026-09-07' })
  assert.ok(noPlan.some((error) => error.includes('plan 必须指向收敛方案文档')))
  const noDue = evaluate({ hits, baseline: { debt: [{ identity, hits: 1, plan: 'docs/plan/demo.md' }] }, today: '2026-09-07' })
  assert.ok(noDue.some((error) => error.includes('due 必须是 YYYY-MM-DD')))
})

test('棘轮双向：同文件命中变多要红，变少而基线没降也要红', () => {
  const more = scanSources(new Map([[
    'app/runtime/session.ts', 'writeOwnSessionFile(a)\nwriteOwnSessionFile(b)\n',
  ]]), registry)
  const grew = evaluate({ hits: more, baseline: { debt: [debtEntry] }, today: '2026-09-07' })
  assert.ok(grew.some((error) => error.includes('命中数从 1 涨到 2')))

  const cleared = scanSources(new Map([['app/runtime/session.ts', 'const ok = 1\n']]), registry)
  const stale = evaluate({ hits: cleared, baseline: { debt: [debtEntry] }, today: '2026-09-07' })
  assert.ok(stale.some((error) => error.includes('基线里的债已不存在')))
})

test('抹注释保持行号等高（报出来的 file:line 必须点得开）', () => {
  const stripped = stripComments('/* a\nb */\nconst x = 1\n')
  assert.equal(stripped.split('\n').length, 4)
  assert.ok(stripped.split('\n')[2].includes('const x = 1'))
})
