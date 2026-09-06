// 症状聚类判据的测试（R17：加规则先证明它会红）。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  contractDate,
  evaluateClusters,
  findClusters,
  moduleKey,
  modulesOf,
} from './symptom-cluster-lib.mjs'

const contract = (file, scopes, entries = []) => ({
  file,
  date: contractDate(file),
  modules: modulesOf({ scope_paths: scopes, entry_points: entries }),
})

test('模块键：三段及以上取前两段，两段取目录', () => {
  assert.equal(moduleKey('electron/harness/runtime/pi/session.mts'), 'electron/harness')
  assert.equal(moduleKey('src/workbench/generationCanvas/x.ts'), 'src/workbench')
  assert.equal(moduleKey('scripts/check-x.mjs'), 'scripts')
  assert.equal(moduleKey('electron/hardenedFetch.ts'), 'electron')
  assert.equal(moduleKey(''), null)
})

test('模块从 scope_paths 与 entry_points 两处取，去重排序', () => {
  const modules = modulesOf({
    scope_paths: ['electron/harness/runtime/pi/', 'electron/harness/other.ts'],
    entry_points: ['跑 pnpm run x；判据在 src/workbench/canvas/a.ts:12 那一带'],
  })
  assert.deepEqual(modules, ['electron/harness', 'src/workbench'])
})

test('7 天内第三份合同才成簇；跨过窗口就不成簇', () => {
  const inside = [
    contract('docs/fixes/2026-09-07-a.root-cause.json', ['electron/harness/x.ts']),
    contract('docs/fixes/2026-09-09-b.root-cause.json', ['electron/harness/y.ts']),
    contract('docs/fixes/2026-09-12-c.root-cause.json', ['electron/harness/z.ts']),
  ]
  const clusters = findClusters({ contracts: inside })
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].module, 'electron/harness')
  assert.equal(clusters[0].contracts.length, 3)

  const spread = [
    contract('docs/fixes/2026-09-07-a.root-cause.json', ['electron/harness/x.ts']),
    contract('docs/fixes/2026-09-09-b.root-cause.json', ['electron/harness/y.ts']),
    contract('docs/fixes/2026-09-20-c.root-cause.json', ['electron/harness/z.ts']),
  ]
  assert.deepEqual(findClusters({ contracts: spread }), [])
})

test('成簇且无结构评审 → 红；有一份日期够新且点名该模块的评审 → 绿', () => {
  const clusters = findClusters({
    contracts: [
      contract('docs/fixes/2026-09-07-a.root-cause.json', ['electron/harness/x.ts']),
      contract('docs/fixes/2026-09-09-b.root-cause.json', ['electron/harness/y.ts']),
      contract('docs/fixes/2026-09-12-c.root-cause.json', ['electron/harness/z.ts']),
    ],
  })
  const red = evaluateClusters({ clusters, audits: [] })
  assert.equal(red.length, 1)
  assert.match(red[0], /已有 3 份根因合同/)

  const tooOld = evaluateClusters({
    clusters,
    audits: [{ file: 'docs/audit/2026-09-08-x.md', date: '2026-09-08', text: '评审了 electron/harness' }],
  })
  assert.equal(tooOld.length, 1, '评审日期早于簇的最后一份合同，不算')

  const wrongModule = evaluateClusters({
    clusters,
    audits: [{ file: 'docs/audit/2026-09-13-x.md', date: '2026-09-13', text: '评审了 src/workbench' }],
  })
  assert.equal(wrongModule.length, 1, '评审没点名这个模块，不算')

  const green = evaluateClusters({
    clusters,
    audits: [{ file: 'docs/audit/2026-09-13-x.md', date: '2026-09-13', text: '本次评审 electron/harness 这一层' }],
  })
  assert.deepEqual(green, [])
})

test('整簇早于阈值 → 不追溯；混合窗口只要有一份早于阈值也不追溯', () => {
  const old = findClusters({
    contracts: [
      contract('docs/fixes/2026-09-01-a.root-cause.json', ['electron/harness/x.ts']),
      contract('docs/fixes/2026-09-02-b.root-cause.json', ['electron/harness/y.ts']),
      contract('docs/fixes/2026-09-03-c.root-cause.json', ['electron/harness/z.ts']),
    ],
  })
  assert.equal(old.length, 1)
  assert.deepEqual(evaluateClusters({ clusters: old, audits: [] }), [])
})

test('新窗口不许藏在老窗口后面（实测栽过：只报最密的那一个，新增三份合同一条都报不出来）', () => {
  const contracts = [
    // 老的、更密的一簇（阈值之前，不追溯）
    contract('docs/fixes/2026-08-01-a.root-cause.json', ['electron/harness/a.ts']),
    contract('docs/fixes/2026-08-02-b.root-cause.json', ['electron/harness/b.ts']),
    contract('docs/fixes/2026-08-03-c.root-cause.json', ['electron/harness/c.ts']),
    contract('docs/fixes/2026-08-04-d.root-cause.json', ['electron/harness/d.ts']),
    contract('docs/fixes/2026-08-05-e.root-cause.json', ['electron/harness/e.ts']),
    // 这周新出现的三份（阈值之后，必须报）
    contract('docs/fixes/2026-09-20-x.root-cause.json', ['electron/harness/x.ts']),
    contract('docs/fixes/2026-09-21-y.root-cause.json', ['electron/harness/y.ts']),
    contract('docs/fixes/2026-09-22-z.root-cause.json', ['electron/harness/z.ts']),
  ]
  const errors = evaluateClusters({ clusters: findClusters({ contracts }), audits: [] })
  assert.equal(errors.length, 1, '新窗口必须被报出来')
  assert.match(errors[0], /2026-09-20 到 2026-09-22/)
  assert.ok(!errors[0].includes('2026-08-01'), '老窗口不该混进这条')
})

test('同一模块多个重叠窗口只报最密的一条（刷屏的门岗没人读）', () => {
  const contracts = ['20', '21', '22', '23', '24'].map((day) =>
    contract(`docs/fixes/2026-09-${day}-x.root-cause.json`, ['electron/harness/x.ts']))
  const clusters = findClusters({ contracts })
  assert.ok(clusters.length > 1, '窗口本身有多个')
  const errors = evaluateClusters({ clusters, audits: [] })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /已有 5 份根因合同/)
})
