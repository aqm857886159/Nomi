// 批量 / 夜间演练的纯函数：挑哪些脚本、日志 → 一句原因、跳过档、「今天不过」红名单。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { BRAIN_ONLY, KNOWN_RED, REHEARSAL_SKIPS, endpointTally, nightlyProblems, reasonFromLog, rehearsalSkipOf, rehearsalTargets } from './_paidRehearsalList.mjs'

// 红名单定下那天（2026-11-15）的全集：名单只能是它的子集——修好一份删一份，不许往里加新的。
// 要加，就得同时改这一行；评审看到这一行变长就是违约。
const KNOWN_RED_BASELINE_20261115 = new Set(['canvas-spend-policy.paid.mjs', 'storyboard-agent-bulk-real.paid.mjs'])
// 跳过名单、「只到大脑」名单同一种守法：定下那天的全集，只能减。
const SKIPS_BASELINE_20261115 = new Set(['agent-default-model-real.paid.mjs', 'agent-image-input-real.paid.mjs', 'apimart-text-brains-real.paid.mjs', 'browser-extract-real.paid.mjs', 'catalog-media-rest-real.paid.mjs', 'relay-video-onboarding-real.paid.mjs', 'release-core-compare.paid.mjs', 'shot-table-vision-leg.paid.mjs'])
const BRAIN_ONLY_BASELINE_20261115 = new Set(['agent-permission-two-tiers.paid.mjs', 'agent-queued-shots.paid.mjs', 'agent-shot-scope-real.paid.mjs', 'agent-spend-per-shot-real.paid.mjs', 'agent-spend-real-image.paid.mjs', 'agent-video-landing.paid.mjs', 'production-shot-claim.paid.mjs'])
const targets = rehearsalTargets(fs.readdirSync(path.join('tests', 'ux')))

describe('paid rehearsal batch', () => {
  it('targets every *.paid.mjs except the ones that do not open through openPaidWalk, and keeps run-retrieval-recovery-real.paid.mjs in the active nightly no-key set', () => {
    const files = ['b.paid.mjs', 'a.paid.mjs', 'x.walk.mjs', '_paidRun.mjs', 'skip.paid.mjs']
    expect(rehearsalTargets(files, [{ file: 'tests/ux/skip.paid.mjs' }])).toEqual(['a.paid.mjs', 'b.paid.mjs'])
    expect(targets).toContain('run-retrieval-recovery-real.paid.mjs')
    expect(rehearsalSkipOf('run-retrieval-recovery-real.paid.mjs', {})).toBeNull()
    expect(Object.hasOwn(KNOWN_RED, 'run-retrieval-recovery-real.paid.mjs')).toBe(false)
    expect(Object.hasOwn(BRAIN_ONLY, 'run-retrieval-recovery-real.paid.mjs')).toBe(false)
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
  it('the skip list only shrinks: every entry was on the 2026-11-15 list', () => {
    for (const file of Object.keys(REHEARSAL_SKIPS)) expect(SKIPS_BASELINE_20261115.has(file)).toBe(true)
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
    expect(nightlyProblems([{ file: 'ok.paid.mjs', status: 'passed' }, { file: 'broken.paid.mjs', status: 'failed', reason: 'x' }, { file: 'needs.paid.mjs', status: 'skipped', reason: '要 X' }], red, {})).toEqual([])
    const offList = nightlyProblems([{ file: 'new.paid.mjs', status: 'failed', reason: '找不到生成钮' }, { file: 'broken.paid.mjs', status: 'failed' }], red, {})
    expect(offList).toHaveLength(1)
    expect(offList[0]).toMatch(/new\.paid\.mjs.*不在「今天不过」名单里.*找不到生成钮/)
    expect(nightlyProblems([{ file: 'broken.paid.mjs', status: 'passed' }], red, {})[0]).toMatch(/今天过了——把它从名单里删掉/)
    expect(nightlyProblems([], red, {})[0]).toMatch(/没跑到/)
  })
})

describe('「只到大脑」名单（只减不增）与三类终点', () => {
  it('the list only shrinks; every entry is a real paid script whose end is the create request, never also red or skipped', () => {
    for (const [file, reason] of Object.entries(BRAIN_ONLY)) {
      expect(BRAIN_ONLY_BASELINE_20261115.has(file)).toBe(true)
      expect(targets).toContain(file)
      expect(String(reason).length).toBeGreaterThan(6)
      expect(Object.hasOwn(KNOWN_RED, file) || Object.hasOwn(REHEARSAL_SKIPS, file)).toBe(false)
    }
  })
  it('nightly: brain-only off the list → red; on the list → green; listed but passed / failed / not run → red', () => {
    const brain = { 'agent.paid.mjs': '只到 chat/completions' }
    expect(nightlyProblems([{ file: 'agent.paid.mjs', status: 'brain-only' }], {}, brain)).toEqual([])
    expect(nightlyProblems([{ file: 'other.paid.mjs', status: 'brain-only', reason: 'r' }], {}, {})[0]).toMatch(/other\.paid\.mjs 只走到大脑请求.*不在「只到大脑」名单里/)
    expect(nightlyProblems([{ file: 'agent.paid.mjs', status: 'passed' }], {}, brain)[0]).toMatch(/「只到大脑」名单里，但今天过了/)
    expect(nightlyProblems([{ file: 'agent.paid.mjs', status: 'failed', reason: 'x' }], {}, brain).join('\n')).toMatch(/今天是「failed」/)
    expect(nightlyProblems([], {}, brain)[0]).toMatch(/「只到大脑」名单里的 agent\.paid\.mjs 这一场没跑到/)
    // brain-only 不会被「今天不过」名单吞掉
    expect(nightlyProblems([{ file: 'agent.paid.mjs', status: 'brain-only', reason: 'r' }], { 'agent.paid.mjs': 'x' }, {}).join('\n')).toMatch(/不在「只到大脑」名单里/)
  })
  it('tally counts the three endpoint classes apart (skipped not counted) and lists brain-only by name', () => {
    const { tally, brainOnly } = endpointTally([
      { file: 'a', endsAt: 'vendor-create', status: 'passed' }, { file: 'b', endsAt: 'vendor-create', status: 'brain-only' },
      { file: 'c', endsAt: 'vendor-read', status: 'passed' }, { file: 'd', endsAt: 'brain', status: 'failed' }, { file: 'e', endsAt: 'vendor-create', status: 'skipped' },
    ])
    expect(tally).toEqual({ 'vendor-create': { total: 2, passed: 1 }, 'vendor-read': { total: 1, passed: 1 }, brain: { total: 1, passed: 0 } })
    expect(brainOnly).toEqual(['b'])
  })
})
