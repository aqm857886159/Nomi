import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { TIER_COMMANDS, parseNameStatusZ, resolveGatesTier } from './run-gates-tests.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

const tierOf = (entries, options) => resolveGatesTier(entries, options).tier
const modify = (...paths) => paths.map((file) => ({ status: 'M', path: file }))

test('普通隔离改动走 focused——这一档存在的全部理由', () => {
  assert.equal(tierOf(modify('src/workbench/settings/SettingsPanel.tsx')), 'focused')
  assert.equal(tierOf(modify('docs/plan/2026-09-12-gates-risk-tier.md')), 'focused')
})

test('高风险面照旧全量：electron/、画布、打包配置', () => {
  assert.equal(tierOf(modify('electron/harness/tools/index.ts')), 'full')
  assert.equal(tierOf(modify('src/workbench/generationCanvas/reactFlow/GenerationCanvas.tsx')), 'full')
  assert.equal(tierOf(modify('package.json')), 'full')
})

test('fail-closed 三条：空 diff、删除/重命名、CI 工作流', () => {
  assert.equal(tierOf([]), 'full')
  assert.equal(resolveGatesTier([]).reasons[0], 'empty_diff_fail_closed')
  assert.equal(tierOf([{ status: 'D', path: 'src/utils/legacy.ts' }]), 'full')
  assert.equal(tierOf([{ status: 'R100', path: 'src/utils/renamed.ts' }]), 'full')
  assert.equal(tierOf(modify('.github/workflows/quality-gate.yml')), 'full')
  assert.equal(tierOf(modify('scripts/test-focused.mjs')), 'full')
})

// R17：这条断言是先写、先看它红的。`tests/ux/_launchApp.mjs` 是**所有** Electron 走查的启动器，
// 改它等于改全部走查的地基——但它此前不在 VALIDATION_INFRASTRUCTURE_PATTERNS 里，
// 被判成 isolated_change → focused。共享 harness（`tests/ux/_*.mjs`）必须升档。
test('共享走查 harness（tests/ux/_*.mjs）升到全量', () => {
  assert.equal(tierOf(modify('tests/ux/_launchApp.mjs')), 'full')
  assert.equal(tierOf(modify('tests/ux/_assert.mjs')), 'full')
  assert.equal(tierOf(modify('tests/ux/_feel.mjs')), 'full')
  assert.match(resolveGatesTier(modify('tests/ux/_launchApp.mjs')).reasons[0], /^validation_infrastructure:tests\/ux\/_launchApp\.mjs$/)
  // 下划线前缀是判据的一部分：普通走查脚本本身不该把整台机器拖进全量。
  assert.equal(tierOf(modify('tests/ux/smoke.e2e.mjs')), 'focused')
})

test('gates:full 的显式全量不经过 policy，也不冒充发布边界', () => {
  const resolved = resolveGatesTier(modify('src/App.tsx'), { requestedTier: 'full' })
  assert.equal(resolved.tier, 'full')
  assert.deepEqual(resolved.reasons, ['explicit_full_tier'])
})

test('-z 的 name-status 流：重命名取新路径并保留 R 状态', () => {
  assert.deepEqual(parseNameStatusZ('M\0src/a.ts\0A\0src/b.ts\0'), [
    { status: 'M', path: 'src/a.ts' },
    { status: 'A', path: 'src/b.ts' },
  ])
  assert.deepEqual(parseNameStatusZ('R100\0src/old.ts\0src/new.ts\0'), [{ status: 'R100', path: 'src/new.ts' }])
  assert.deepEqual(parseNameStatusZ(''), [])
})

test('两档各自指向真实存在的 package 脚本，且两个入口都接在本调度点上', () => {
  for (const [tier, args] of Object.entries(TIER_COMMANDS)) {
    assert.equal(args[0], 'run', tier)
    assert.ok(pkg.scripts[args[1]], `${tier} 指向了不存在的脚本 ${args[1]}`)
  }
  assert.match(pkg.scripts.gates, /node \.\/scripts\/run-gates-tests\.mjs(?! --tier)/)
  assert.match(pkg.scripts['gates:full'], /node \.\/scripts\/run-gates-tests\.mjs --tier=full/)
  // 默认档不许再直接写死全量，否则分档就被旁路了。
  assert.doesNotMatch(pkg.scripts.gates, /pnpm run test\b(?!:)/)
})
