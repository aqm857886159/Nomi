// 付费走查的覆盖边界：每个 *.paid.mjs 要么走 openPaidWalk（自动配出网名单、被挡即失败、花钱前核闸），
// 要么在 _paidRun.mjs 的例外表里写明理由与它自己的网络护栏。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { PAID_WALKS_WITHOUT_OPEN_PAID_WALK, assertPaidBuildReady, openPaidWalk, paidWalkCoverageProblems } from './_paidRun.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function repoPaidWalks() {
  return execFileSync('git', ['ls-files', 'tests/ux'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter((file) => /\.paid\.mjs$/.test(file))
}
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')

describe('paid walk coverage', () => {
  it('every *.paid.mjs in the repo uses openPaidWalk or sits in the exception table (and the table has no dead entries)', () => {
    const files = repoPaidWalks()
    expect(files.length).toBeGreaterThan(5)
    expect(paidWalkCoverageProblems(files, read)).toEqual([])
  })

  it('goes red for a paid walk that neither calls openPaidWalk nor is listed', () => {
    const fake = { 'tests/ux/sneaky.paid.mjs': "import { assertPaidRunAllowed } from './_paidRun.mjs'\nassertPaidRunAllowed('x')\n" }
    const problems = paidWalkCoverageProblems(Object.keys(fake), (file) => fake[file], [])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('tests/ux/sneaky.paid.mjs')
  })

  it('goes red for a dead exception entry and for a stale one that now uses openPaidWalk', () => {
    const entry = { file: 'tests/ux/gone.paid.mjs', why: 'x', networkGuard: 'y' }
    expect(paidWalkCoverageProblems([], () => '', [entry]).join()).toContain('不存在')
    const stale = { file: 'tests/ux/a.paid.mjs', why: 'x', networkGuard: 'y' }
    expect(paidWalkCoverageProblems([stale.file], () => 'await openPaidWalk(a, b, c)', [stale]).join()).toContain('过期')
  })

  it('every exception states its reason and its own network guard', () => {
    for (const entry of PAID_WALKS_WITHOUT_OPEN_PAID_WALK) {
      expect(entry.why.length).toBeGreaterThan(10)
      expect(entry.networkGuard.length).toBeGreaterThan(10)
    }
  })
})

// 2026-10-17「真付费只跑一次」的运行前检查：产物比源码新 + 产物里有被验修复的标记；不满足一分钱不花。
describe('assertPaidBuildReady · refuses before any spend', () => {
  function fakeBuild(files) {
    const root = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'paid-build-'))
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, text)
    }
    return root
  }
  const stampOk = () => ({})

  it('passes when the stamp matches and every marker literal is in the output', () => {
    const root = fakeBuild({ 'dist/assets/app.js': 'x("请先确认再生成");', 'dist-electron/main.js': 'const code="E_TIER_MISMATCH";' })
    expect(() => assertPaidBuildReady(root, { verify: stampOk, markers: ['请先确认再生成', 'E_TIER_MISMATCH'] })).not.toThrow()
  })

  it('goes red when the build stamp does not match the source (stale or failed build)', () => {
    const root = fakeBuild({ 'dist/a.js': 'x' })
    const stale = () => { throw new Error('dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。') }
    expect(() => assertPaidBuildReady(root, { verify: stale })).toThrow(/一分钱没花[\s\S]*过期/)
  })

  it('goes red when the real stamp check finds no stamp at all (default verify, no injection)', () => {
    const root = fakeBuild({ 'dist/a.js': 'x', 'dist-electron/main.js': 'y' })
    expect(() => assertPaidBuildReady(root)).toThrow(/一分钱没花/)
  })

  it('goes red when a marker literal is missing from the output, naming it', () => {
    const root = fakeBuild({ 'dist/assets/app.js': 'x("旧文案");' })
    expect(() => assertPaidBuildReady(root, { verify: stampOk, markers: ['旧文案', '新文案'] })).toThrow(/"新文案"/)
  })

  it('a minified-away function name is not a marker: only text that survives into the output counts', () => {
    const root = fakeBuild({ 'dist/assets/app.js': 'function a(){return 1}' })
    expect(() => assertPaidBuildReady(root, { verify: stampOk, markers: ['resolvePermissionTier'] })).toThrow(/找不到被验修复的标记/)
  })

  it('goes red for an empty or non-string marker instead of silently passing', () => {
    const root = fakeBuild({ 'dist/a.js': 'x' })
    expect(() => assertPaidBuildReady(root, { verify: stampOk, markers: [''] })).toThrow(/空值/)
  })
})

describe('openPaidWalk · build check runs before the isolated copy is built', () => {
  const env = { NOMI_SPEND_OK: '1', CI: '', APIMART_API_KEY: 'sk-fake-key-for-test-0123456789abcdef' }
  it('refuses when the build check fails: createWalk is never called', async () => {
    const createWalk = vi.fn()
    const assertBuild = () => { throw new Error('付费走查拒跑（一分钱没花）：构建产物过期') }
    await expect(openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'apimart', modelKey: 'm' }], { env, createWalk, assertBuild, argv: [] })).rejects.toThrow(/一分钱没花/)
    expect(createWalk).not.toHaveBeenCalled()
  })

  it('hands the caller buildMarkers to the check; --packaged skips it', async () => {
    const seen = []
    const assertBuild = (root, options) => { seen.push(options.markers); throw new Error('stop') }
    const models = [{ vendorKey: 'apimart', modelKey: 'm' }]
    await expect(openPaidWalk('x.paid.mjs', 'x', models, { env, createWalk: vi.fn(), assertBuild, argv: [], buildMarkers: ['标记甲'] })).rejects.toThrow('stop')
    expect(seen).toEqual([['标记甲']])
    // 打包形态：不调检查（这里走到 createWalk 就抛，证明检查被跳过且没挡在前面）
    const createWalk = vi.fn(async () => { throw new Error('reached createWalk') })
    await expect(openPaidWalk('x.paid.mjs', 'x', models, { env, createWalk, assertBuild, argv: ['--packaged', 'C:/Nomi.exe'] })).rejects.toThrow('reached createWalk')
    expect(seen).toHaveLength(1)
  })
})
