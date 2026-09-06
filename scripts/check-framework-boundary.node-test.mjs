// 框架边界门岗自测（R29）。三件必须证明的事：**命中会红、不命中会绿、债到期会红**。
//
// 为什么喂假仓库而不是扫真代码：门岗自己的测试如果只跑真实存量，它证明的是「今天长这样」，
// 证明不了「明天新增一条会不会被拦」——而后者才是这道门岗存在的全部理由（R17：加规则先验它会红）。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REFERENCE_CONFORMANCE_LAYERS,
  advisoryCapabilityHits,
  evaluate,
  evaluateReferenceConformance,
  isVersionBehind,
  scanSources,
  stripComments,
  validateRegistry,
} from './framework-boundary-lib.mjs'

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

// —— 启发式一条（advisory，2026-09-07）——
// 它抓的是 forbidden 正则抓不到的那半边：换个符号名重写一份框架已有的能力。
// 三件要证明的事：文件名命中会叫、导出符号命中会叫、豁免登记会闭嘴。
test('能力词启发式：文件名与导出符号命中都会提醒', () => {
  const files = new Map([
    ['electron/foo/sessionSnapshotStore.ts', 'export const x = 1\n'],
    ['electron/foo/queue.ts', 'export function createRetryQueue() {}\n'],
    ['electron/foo/unrelated.ts', 'export function renderThumbnail() {}\n'],
  ])
  const notices = advisoryCapabilityHits({ files, watchWords: ['session', 'retry'] })
  assert.deepEqual(notices.map((notice) => `${notice.file}:${notice.kind}:${notice.word}`), [
    'electron/foo/sessionSnapshotStore.ts:文件名:session',
    'electron/foo/queue.ts:导出符号:retry',
  ])
})

test('能力词启发式：豁免登记会闭嘴，注释里的同名词不算', () => {
  const files = new Map([
    ['electron/foo/sessionSnapshotStore.ts', 'export const x = 1\n'],
    ['electron/foo/note.ts', '// export function createSessionThing() {}\nexport const y = 2\n'],
  ])
  const exemptions = new Set(['electron/foo/sessionSnapshotStore.ts'])
  assert.deepEqual(advisoryCapabilityHits({ files, watchWords: ['session'], exemptions }), [])
})

test('能力词启发式：词表为空时一句话都不说（不许靠空词表假装在守）', () => {
  const files = new Map([['electron/foo/sessionStore.ts', 'export const x = 1\n']])
  assert.deepEqual(advisoryCapabilityHits({ files, watchWords: [] }), [])
})

// —— 第二份必交物：参考实现逐层对照（R29，2026-09-07）——
// 四件必须证明的事：**缺字段会红、文档指不到会红、文档缺层缺列会红、债到期会红**；
// 外加一件必须证明「不会红」的事：版本落后只出 warning（advisory 若也算红，就没人敢升依赖了）。

const conformanceRegistry = {
  capabilityInventory: { packages: ['@demo/sdk', '@other/ui'] },
  frameworks: [{ id: 'demo', packages: ['@demo/sdk'], fourColumnTable: 'docs/plan/demo.md', capabilities: [] }],
}

const goodDoc = ['## 参考实现逐层对照', ...REFERENCE_CONFORMANCE_LAYERS,
  '它怎么做', '我们怎么做', '判定', '若没想到补在哪个阶段前'].join('\n')

const runConformance = (registry, options = {}) => evaluateReferenceConformance({
  registry,
  today: options.today ?? '2026-09-07',
  docExists: options.docExists ?? (() => true),
  readDoc: options.readDoc ?? (() => goodDoc),
  installedVersions: options.installedVersions ?? {},
})

test('缺字段：登记框架没有 referenceConformance、在用的包没登记 → 都红', () => {
  const { errors } = runConformance(conformanceRegistry)
  assert.ok(errors.some((error) => error.includes('demo: 缺 referenceConformance')))
  assert.ok(errors.some((error) => error.includes('@other/ui') && error.includes('既没有框架登记')))
  // pi 那种「框架自己的包」由框架条目覆盖，不该再被要求单独登记一遍
  assert.ok(!errors.some((error) => error.startsWith('@demo/sdk:')))
})

test('登记成债：绑了 doc/why/未过期的 due → 绿；到期未交 → 红并点名落点', () => {
  const owed = { id: 'demo', doc: 'docs/research/demo-conformance.md', due: '2026-12-31', why: '正在写' }
  const other = { id: '@other/ui', doc: 'docs/research/ui.md', due: '2026-12-31', why: '排在后面' }
  const registry = { ...conformanceRegistry, referenceConformanceDebt: [owed, other] }
  assert.deepEqual(runConformance(registry).errors, [])

  const expired = runConformance({ ...registry, referenceConformanceDebt: [{ ...owed, due: '2026-09-01' }, other] })
  assert.ok(expired.errors.some((error) => error.includes('已于 2026-09-01 到期仍未交')
    && error.includes('docs/research/demo-conformance.md')))

  const noDue = runConformance({ ...registry, referenceConformanceDebt: [{ id: 'demo', doc: 'd.md', why: 'x' }, other] })
  assert.ok(noDue.errors.some((error) => error.includes('due 必须是 YYYY-MM-DD')))
})

test('文档路径不存在 → 红（指不到的文档等于没写）', () => {
  const registry = { ...conformanceRegistry, frameworks: [{
    ...conformanceRegistry.frameworks[0],
    referenceConformance: { doc: 'docs/research/gone.md', verifiedAt: '2026-09-07', upstreamVersion: '1.0.0' },
  }], referenceConformanceDebt: [{ id: '@other/ui', doc: 'x.md', due: '2026-12-31', why: 'x' }] }
  const { errors } = runConformance(registry, { docExists: () => false })
  assert.ok(errors.some((error) => error.includes('docs/research/gone.md 不存在')))
})

test('文档缺层或缺列 → 红；裁剪只能从九层里选，自造一层也红', () => {
  const base = { doc: 'docs/research/demo.md', verifiedAt: '2026-09-07', upstreamVersion: '1.0.0' }
  const debt = [{ id: '@other/ui', doc: 'x.md', due: '2026-12-31', why: 'x' }]
  const withConformance = (referenceConformance) => ({
    ...conformanceRegistry,
    frameworks: [{ ...conformanceRegistry.frameworks[0], referenceConformance }],
    referenceConformanceDebt: debt,
  })

  const thin = runConformance(withConformance(base), { readDoc: () => '## 参考实现逐层对照\n工具\n它怎么做\n我们怎么做\n' })
  assert.ok(thin.errors.some((error) => error.includes('缺「安全」这一层')))
  assert.ok(thin.errors.some((error) => error.includes('缺「判定」这一列')))

  // 裁剪：只声明两层，文档只要覆盖这两层就绿——不是每个框架都有全部九层
  const tailored = runConformance(withConformance({ ...base, layers: ['工具', '安全'] }), {
    readDoc: () => '## 参考实现逐层对照\n工具\n安全\n它怎么做\n我们怎么做\n判定\n若没想到补在哪个阶段前\n',
  })
  assert.deepEqual(tailored.errors, [])

  const invented = runConformance(withConformance({ ...base, layers: ['随便一层'] }))
  assert.ok(invented.errors.some((error) => error.includes('不在九层之内')))
})

test('两边同时登记 → 红（不许既欠着债又声称已交）', () => {
  const registry = {
    ...conformanceRegistry,
    frameworks: [{ ...conformanceRegistry.frameworks[0], referenceConformance: {
      doc: 'docs/research/demo.md', verifiedAt: '2026-09-07', upstreamVersion: '1.0.0',
    } }],
    referenceConformanceDebt: [
      { id: 'demo', doc: 'docs/research/demo.md', due: '2026-12-31', why: 'x' },
      { id: '@other/ui', doc: 'x.md', due: '2026-12-31', why: 'x' },
    ],
  }
  assert.ok(runConformance(registry).errors.some((error) => error.includes('既登记成债又声称已交')))
})

test('债只能欠在真实存在的东西上；清掉的债留在表里也红（棘轮只减不增）', () => {
  const registry = { ...conformanceRegistry, referenceConformanceDebt: [
    { id: 'demo', doc: 'd.md', due: '2026-12-31', why: 'x' },
    { id: '@other/ui', doc: 'x.md', due: '2026-12-31', why: 'x' },
    { id: '@gone/pkg', doc: 'g.md', due: '2026-12-31', why: 'x' },
  ] }
  assert.ok(runConformance(registry).errors.some((error) => error.includes('@gone/pkg')
    && error.includes('既不是登记框架也不是 capabilityInventory 里的包')))
})

test('版本落后只出 warning，不进 errors —— advisory 若也算红，就没人敢升依赖了', () => {
  const registry = {
    ...conformanceRegistry,
    frameworks: [{ ...conformanceRegistry.frameworks[0], referenceConformance: {
      doc: 'docs/research/demo.md', verifiedAt: '2026-09-07', upstreamVersion: '0.84.3',
    } }],
    referenceConformanceDebt: [{ id: '@other/ui', doc: 'x.md', due: '2026-12-31', why: 'x' }],
  }
  const { errors, warnings } = runConformance(registry, { installedVersions: { '@demo/sdk': '0.85.1' } })
  assert.deepEqual(errors, [])
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes('0.84.3') && warnings[0].includes('0.85.1'))

  const level = runConformance(registry, { installedVersions: { '@demo/sdk': '0.84.3' } })
  assert.deepEqual(level.warnings, [])
})

test('版本比较：只按数字段比大小，比不动就当没落后（宁可漏报也不误报）', () => {
  assert.equal(isVersionBehind('0.84.3', '0.85.1'), true)
  assert.equal(isVersionBehind('1.2.3', '1.2.10'), true)
  assert.equal(isVersionBehind('12.11.5', '12.11.5'), false)
  assert.equal(isVersionBehind('2.0.0', '1.9.9'), false)
  assert.equal(isVersionBehind('7.17.8', '7.18.0-beta.1'), true)
  assert.equal(isVersionBehind('next', '1.0.0'), false)
  assert.equal(isVersionBehind('1.0.0', undefined), false)
})
