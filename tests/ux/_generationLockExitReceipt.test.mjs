import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { assertPaidBuildReady } from './_paidRun.mjs'
import { LOCK_EXIT_BUILD_MARKERS } from './_generationLockExitSteps.mjs'

// 2026-11-15 起两份付费入口不再要求手递一张旧式演练收据（NOMI_*_REHEARSAL_RECEIPT + git diff）：
// 花钱前的门由 openPaidWalk 的通用收据把守（脚本指纹 + 构建身份 + 走到的站，见 _paidRun.test.mjs），
// 四段旅程本身的免费演练（*.rehearsal.walk.mjs）照旧每晚跑、自己核托管披露。
const PAID_ENTRIES = ['generation-lock-exit-real.paid.mjs', 'shot-result-ownership-real.paid.mjs']
const read = (name) => fs.readFileSync(path.join('tests/ux', name), 'utf8')

it.each(PAID_ENTRIES)('%s: no hand-carried rehearsal receipt; the generic receipt in openPaidWalk is the only spend gate', (name) => {
  const source = read(name)
  expect(source).not.toMatch(/_REHEARSAL_RECEIPT/)
  expect(source).not.toMatch(/execFileSync\('git'/)
  expect(source).toMatch(/await openPaidWalk\(/)
})

it.each(PAID_ENTRIES)('%s: the forwarding proxy takes its upstream from openPaidWalk (stand-in when rehearsing), never from the allowlist directly', (name) => {
  const source = read(name)
  expect(source).toMatch(/paid\.vendorUpstream\(\)/)
  expect(source).not.toMatch(/networkAllowlist\[0\]/)
  // 改道表由 openPaidWalk 给（保留中转替身那条），脚本不再整个覆盖
  expect(source).toMatch(/upstream\.launchEnvVia\(proxy\.origin\)/)
})

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
it('the old IPC-only product cannot pass the updated repair markers', () => {
  const parent = path.resolve(process.env.NOMI_LOCK_EXIT_OUT || '.tmp/generation-lock-exit')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'receipt-unit-')); roots.push(root)
  const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
  write('dist/main.js', 'nomi:tasks:canvas-open-runs')
  expect(() => assertPaidBuildReady(root, { markers: LOCK_EXIT_BUILD_MARKERS, verify: () => {} })).toThrow(/标记/)
  write('dist/main.js', LOCK_EXIT_BUILD_MARKERS.join('\n'))
  expect(() => assertPaidBuildReady(root, { markers: LOCK_EXIT_BUILD_MARKERS, verify: () => {} })).not.toThrow()
})
