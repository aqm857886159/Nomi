// 批量 / 夜间演练的纯函数：挑哪些脚本、日志 → 一句原因、跳过档、「今天不过」红名单。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { KNOWN_RED, REHEARSAL_SKIPS, nightlyProblems, reasonFromLog, rehearsalSkipOf, rehearsalTargets } from './_paidRehearsalList.mjs'

// 红名单定下那天（2026-11-15）的全集：名单只能是它的子集——修好一份删一份，不许往里加新的。
// 要加，就得同时改这一行；评审看到这一行变长就是违约。
const KNOWN_RED_BASELINE_20261115 = new Set(['canvas-spend-policy.paid.mjs', 'storyboard-agent-bulk-real.paid.mjs', 'generation-lock-exit-real.paid.mjs', 'shot-result-ownership-real.paid.mjs'])
const targets = rehearsalTargets(fs.readdirSync(path.join('tests', 'ux')))

describe('paid rehearsal batch', () => {
  it('targets every *.paid.mjs except the ones that do not open through openPaidWalk', () => {
    const files = ['b.paid.mjs', 'a.paid.mjs', 'x.walk.mjs', '_paidRun.mjs', 'skip.paid.mjs']
    expect(rehearsalTargets(files, [{ file: 'tests/ux/skip.paid.mjs' }])).toEqual(['a.paid.mjs', 'b.paid.mjs'])
  })
  it('reason = the last [rehearsal] line, else the last error-looking line (stack frames ignored)', () => {
    expect(reasonFromLog('[paid] x\n[rehearsal] 付费走查出网被挡\n[rehearsal] 不过：没走到收窄花钱面\n')).toBe('不过：没走到收窄花钱面')
    expect(reasonFromLog('start\nError: 会花真钱\n    at foo (x.mjs:1)\n')).toBe('Error: 会花真钱')
    expect(reasonFromLog('')).toBe('没有输出')
  })
})

describe('skips: missing parameters / environment are not failures', () => {
  it('env-gated skips run once the env is given; always-skips never run in the batch', () => {
    expect(rehearsalSkipOf('agent-image-input-real.paid.mjs', {})).toContain('NOMI_REAL_MEDIA_DIR')
    expect(rehearsalSkipOf('agent-image-input-real.paid.mjs', { NOMI_REAL_MEDIA_DIR: '/x' })).toBeNull()
    expect(rehearsalSkipOf('release-core-compare.paid.mjs', { NOMI_REAL_MEDIA_DIR: '/x' })).toContain('--target-root')
    expect(rehearsalSkipOf('a.paid.mjs', {})).toBeNull()
  })
  it('every skip names a real paid script, says what it needs, and is never also on the red list', () => {
    for (const [file, row] of Object.entries(REHEARSAL_SKIPS)) {
      expect(targets).toContain(file)
      expect(row.needs.length).toBeGreaterThan(4)
      expect(Boolean(row.always) || (row.env ?? []).length > 0).toBe(true)
      expect(Object.hasOwn(KNOWN_RED, file)).toBe(false)
    }
  })
})

describe('「今天不过」红名单（只减不增）', () => {
  it('the list only shrinks: every entry was on the 2026-11-15 list', () => {
    for (const file of Object.keys(KNOWN_RED)) expect(KNOWN_RED_BASELINE_20261115.has(file)).toBe(true)
  })
  it('every entry is a real paid script with a one-line reason', () => {
    for (const [file, reason] of Object.entries(KNOWN_RED)) {
      expect(targets).toContain(file)
      expect(String(reason).length).toBeGreaterThan(6)
      expect(String(reason)).not.toMatch(/\n/)
    }
  })
  it('nightly: off-list failure → red; listed but passed today → red; listed but not run → red; skipped and listed failures → green', () => {
    const red = { 'broken.paid.mjs': '对 undefined 调 replace' }
    expect(nightlyProblems([{ file: 'ok.paid.mjs', status: 'passed' }, { file: 'broken.paid.mjs', status: 'failed', reason: 'x' }, { file: 'needs.paid.mjs', status: 'skipped', reason: '要 X' }], red)).toEqual([])
    const offList = nightlyProblems([{ file: 'new.paid.mjs', status: 'failed', reason: '找不到生成钮' }, { file: 'broken.paid.mjs', status: 'failed' }], red)
    expect(offList).toHaveLength(1)
    expect(offList[0]).toMatch(/new\.paid\.mjs.*不在「今天不过」名单里.*找不到生成钮/)
    expect(nightlyProblems([{ file: 'broken.paid.mjs', status: 'passed' }], red)[0]).toMatch(/今天过了——把它从名单里删掉/)
    expect(nightlyProblems([], red)[0]).toMatch(/没跑到/)
  })
})
