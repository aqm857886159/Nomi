// 付费走查的覆盖边界：每个 *.paid.mjs 要么走 openPaidWalk（自动配出网名单、被挡即失败、花钱前核闸），
// 要么在 _paidRun.mjs 的例外表里写明理由与它自己的网络护栏。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { PAID_WALKS_WITHOUT_OPEN_PAID_WALK, paidWalkCoverageProblems } from './_paidRun.mjs'

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
