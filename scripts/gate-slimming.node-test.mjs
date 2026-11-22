// 门岗瘦身（2026-10-01，用户按 docs/audit/2026-10-01-gate-ledger.md 拍板）的回归钉：
//   · 删 / 降 / 合并之后，账本里那 17 次「真问题」对应的门岗**照样在 PR 的 Contracts 里、照样阻断**；
//   · 被删的不许悄悄回来，被降级的不许悄悄升回去（升回去要改这里并说明理由）。
// 账本里 Contracts 的真问题：check:test-types 5、check:filesize 4、check:walkthroughs 3、
// check:design-lab / lint:ci / check:test-waits / check:vocabularies / check:icon-semantics 各 1。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parseGateArgs } from './run-gates-contracts.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const { gates, advisory } = parseGateArgs(pkg.scripts['gates:contracts'].split(/\s+/).slice(5))

// 账本里「真问题」的门岗。check:test-types 现在由 typecheck 编排器并发带起（见 scripts/typecheck.node-test.mjs），
// 所以在名单里以 typecheck 的身份出现。
const REAL_PROBLEM_GATES = [
  'typecheck', // 含 check:test-types（生产 tsc x3 + 测试类型棘轮）
  'check:filesize',
  'check:walkthroughs',
  'check:design-lab',
  'lint:ci',
  'check:test-waits',
  'check:vocabularies',
  'check:icon-semantics',
  // 纸面类里仍保留的两道：合同（只对 schema 阻断）/ PR 正文与先查别人（原 check:prior-art 于 2026-11-23 T-8 并入 check:pr-judgement）。概念写口 check:concept-owners 2026-10-02 降为警告档、2026-10-19 用户拍板「改回挡合并」，见下方 REAL_PROBLEM_GATES 的末项
  'check:root-cause-contracts',
  'check:pr-judgement',
  // 2026-10-19 用户拍板「改回挡合并（推荐）」：advisory 档下未登记边界从 37 攒到 121 而无人被拦，必须阻断
  'check:concept-owners',
]

test('账本里真问题的门岗：全都还在 PR 的 Contracts 里，且不是 advisory', () => {
  for (const gate of REAL_PROBLEM_GATES) {
    assert.ok(gates.includes(gate), `${gate} 不在 gates:contracts 里了`)
    assert.ok(!advisory.has(gate), `${gate} 被降成 advisory 了——账本里它抓到过真问题`)
  }
})

test('被删的门岗不许悄悄回来：docs-index / doc-status / ledger 与 door-map 不在 PR 的 Contracts 里，脚本本身还在（docs-autosync 要用）', () => {
  for (const removed of ['check:docs-index', 'check:doc-status', 'check:ledger', 'check:door-map', 'check:research-sources', 'check:symptom-cluster', 'check:archetype-defaults', 'check:archetype-sources', 'check:standard-formats', 'check:dependency-capabilities', 'check:main-console', 'check:renderer-sync-ipc', 'check:builtin-vendor-literals', 'check:prior-art']) {
    assert.ok(!gates.includes(removed), `${removed} 回到了 gates:contracts`)
  }
  for (const kept of ['check:docs-index', 'check:doc-status', 'check:ledger']) {
    assert.ok(pkg.scripts[kept], `${kept} 的脚本不该删：docs-autosync 还要用`)
  }
  for (const gone of ['check:research-sources', 'check:symptom-cluster', 'check:archetype-defaults', 'check:archetype-sources', 'check:standard-formats', 'check:dependency-capabilities', 'check:i18n-dead-keys', 'check:audit', 'check:mcp-legacy-entry', 'check:handoff', 'check:main-console', 'check:renderer-sync-ipc', 'check:builtin-vendor-literals', 'check:prior-art']) {
    assert.equal(pkg.scripts[gone], undefined, `${gone} 已按门岗清理 / T-8 收口删除，不许悄悄回来`)
  }
  for (const siteSub of ['data', 'editorial', 'pricing', 'links', 'locales', 'schema', 'descriptions', 'attribution']) {
    assert.equal(pkg.scripts[`check:site-${siteSub}`], undefined, `check:site-${siteSub} 已并进 check:site`)
  }
  assert.equal(pkg.scripts['check:door-map'], undefined, 'check:door-map 已并入 check:root-cause-contracts')
  for (const file of ['scripts/check-door-map.mjs', 'scripts/door-map-lib.mjs']) {
    assert.ok(!fs.existsSync(path.join(repoRoot, file)), `${file} 应该已删除（P1：不留并行版）`)
  }
  // 生成门表的脚本留着：门表由它生成，不是手写
  assert.ok(fs.existsSync(path.join(repoRoot, 'scripts/door-map.mjs')))
})

test('降为提示的：advisory 名单是空的（concept-owners 2026-10-19 用户拍板改回挡合并；再降级要用户拍板并在这里写清理由）', () => {
  assert.deepEqual([...advisory].sort(), [])
})

test('Ponytail 已整套删除：脚本、模式开关、延后账本、check 与 review:branch 都不在了', () => {
  for (const file of ['scripts/ponytail-review-branch.mjs', 'scripts/ponytail-review-hook.mjs', 'scripts/check-ponytail-deferred.mjs', 'docs/engineering/ponytail-mode.json']) {
    assert.ok(!fs.existsSync(path.join(repoRoot, file)), file + ' 应该已删除（用合并前独立验收代替）')
  }
  assert.ok(!pkg.scripts['review:branch'])
  assert.ok(!gates.includes('check:ponytail-review'))
})

test('每轮注入的交付账本提醒已从 L0 hook 删掉；gen:ledger / ledger:brief 仍可按需跑', () => {
  const hook = fs.readFileSync(path.join(repoRoot, 'scripts/claude-hooks/self-check.sh'), 'utf8')
  assert.doesNotMatch(hook, /build-delivery-ledger/)
  assert.ok(pkg.scripts['gen:ledger'])
  assert.ok(pkg.scripts['ledger:brief'])
})
