import { makeTempDir } from '../../../scripts/_test-temp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { checkNeeds, CORE_SMOKE_NEEDS, provisionNeeds } from './needs.mjs'
import { checkCoreSmokeScenarios, CORE_SMOKE_FIXTURES, CORE_SMOKE_SCENARIOS, expandCoreSmokeRuns } from './scenarios.mjs'
import { checkWorkingTreeUntouched, parseCoreSmokeArgv } from './run.mjs'
import { readCoreSmokeEnvironment } from './fixture.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const temps = []
afterEach(() => { for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('core smoke scenario list (single owner)', () => {
  it('the checked-in list is valid and runs the registered walkthroughs under both CI fixtures', () => {
    expect(checkCoreSmokeScenarios()).toEqual([])
    expect(CORE_SMOKE_FIXTURES).toEqual(['empty', 'used'])
    for (const fixture of CORE_SMOKE_FIXTURES) {
      // 花钱路那条带两例（confirm / cancel），所以它的脚本在展开里出现两次——一例一个进程。
      expect(expandCoreSmokeRuns(fixture).map((run) => run.id)).toEqual([
        'node-params-and-version-pill',
        'canvas-drag-pan-gestures',
        'spend-confirm--confirm',
        'spend-confirm--cancel',
      ])
      expect(new Set(expandCoreSmokeRuns(fixture).map((run) => run.script))).toEqual(new Set([
        'tests/ux/node-params-and-version-pill.walk.mjs',
        'tests/ux/canvas-drag-pan-gestures.walk.mjs',
        'tests/ux/core-smoke-spend-confirm.walk.mjs',
      ]))
    }
  })

  it('every listed walkthrough opens its project through the core smoke fixture (no private launcher)', () => {
    for (const scenario of CORE_SMOKE_SCENARIOS) {
      const source = fs.readFileSync(path.join(repoRoot, scenario.script), 'utf8')
      expect(source, scenario.script).toMatch(/launchCoreSmoke\(/)
      expect(source, scenario.script).not.toMatch(/launchNomiApp\(/)
    }
  })

  it('rejects per-fixture opt-outs, unknown needs, and malformed cases before any process starts', () => {
    const base = { id: 'x', script: 'tests/ux/node-params-and-version-pill.walk.mjs' }
    expect(checkCoreSmokeScenarios([{ ...base, fixtures: ['empty'] }], { root: repoRoot }).join('\n')).toMatch(/不认识的字段「fixtures」/)
    expect(checkCoreSmokeScenarios([{ ...base, skip: true }], { root: repoRoot }).join('\n')).toMatch(/不认识的字段「skip」/)
    expect(checkCoreSmokeScenarios([{ ...base, needs: ['paidVendor'] }], { root: repoRoot }).join('\n')).toMatch(/缺依赖：「paidVendor」没有 provisioner/)
    expect(checkCoreSmokeScenarios([{ ...base, needs: ['fixtureTextModel'] }], { root: repoRoot }).join('\n')).toMatch(/需要「loopbackProvider」/)
    expect(checkCoreSmokeScenarios([{ ...base, cases: [] }], { root: repoRoot }).join('\n')).toMatch(/cases/)
    expect(checkCoreSmokeScenarios([{ ...base, script: 'tests/ux/missing.walk.mjs' }], { root: repoRoot }).join('\n')).toMatch(/不存在/)
  })

  it('a scenario with cases expands to one run per case under each fixture, carrying its needs', () => {
    const spend = { id: 'spend', script: 'tests/ux/node-params-and-version-pill.walk.mjs', needs: ['loopbackProvider', 'fixtureTextModel'], cases: ['confirm', 'cancel'] }
    expect(checkCoreSmokeScenarios([spend], { root: repoRoot })).toEqual([])
    for (const fixture of CORE_SMOKE_FIXTURES) {
      const runs = expandCoreSmokeRuns(fixture, [spend])
      expect(runs.map((run) => [run.id, run.caseId, run.fixture, run.needs.join(',')])).toEqual([
        ['spend--confirm', 'confirm', fixture, 'loopbackProvider,fixtureTextModel'],
        ['spend--cancel', 'cancel', fixture, 'loopbackProvider,fixtureTextModel'],
      ])
    }
    expect(() => expandCoreSmokeRuns('staging', [spend])).toThrow(/未知夹具/)
  })
})

describe('core smoke needs', () => {
  it('only registered needs are accepted; requirements must be declared explicitly', () => {
    expect(Object.keys(CORE_SMOKE_NEEDS)).toEqual(['loopbackProvider', 'paidGenerationRoute', 'fixtureTextModel'])
    expect(checkNeeds(['loopbackProvider', 'fixtureTextModel'])).toEqual([])
    expect(checkNeeds(['paidGenerationRoute'])[0]).toMatch(/需要「loopbackProvider」/)
    expect(checkNeeds(['nope'])[0]).toMatch(/缺依赖/)
  })

  it('loopbackProvider + fixtureTextModel really stand up a zero-cost provider and select its text model', async () => {
    const settingsDir = makeTempDir('nomi-core-smoke-needs-')
    temps.push(settingsDir)
    const provisioned = await provisionNeeds(['fixtureTextModel', 'loopbackProvider'], { repoRoot, settingsDir })
    try {
      const catalog = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
      expect(JSON.stringify(catalog)).toContain(provisioned.handles.loopbackProvider.baseURL)
      expect(JSON.parse(provisioned.localStorage['nomi.assistantModel'])).toEqual({
        vendorKey: provisioned.handles.fixtureTextModel.vendorKey,
        modelKey: provisioned.handles.fixtureTextModel.modelKey,
      })
      const response = await fetch(`${provisioned.handles.loopbackProvider.baseURL}/v1/images/generations`, { method: 'POST', body: '{}' })
      expect(response.status).toBe(200)
    } finally {
      await provisioned.close()
    }
  })

  // 「能真按下去的那条生成路」：声明了才开执行侧那三把钥匙。不声明 → 一把都不给（老场景一个字不变）；
  // 声明 → 三把齐，且地址就是这台夹具（少一把主进程就装不出可提交的执行器，见 needs.mjs 里的理由）。
  it('paidGenerationRoute hands the main process the three fixture keys, and nothing does without it', async () => {
    const plain = makeTempDir('nomi-core-smoke-needs-plain-')
    temps.push(plain)
    const textOnly = await provisionNeeds(['loopbackProvider', 'fixtureTextModel'], { repoRoot, settingsDir: plain })
    try {
      expect(textOnly.env).toEqual({})
    } finally {
      await textOnly.close()
    }

    const paidDir = makeTempDir('nomi-core-smoke-needs-paid-')
    temps.push(paidDir)
    const paid = await provisionNeeds(['loopbackProvider', 'paidGenerationRoute'], {
      repoRoot, settingsDir: paidDir, userDataDir: paidDir, appName: 'nomi',
    })
    try {
      expect(paid.env.NOMI_E2E_PRODUCTION_FIXTURE).toBe('1')
      expect(paid.env.NOMI_E2E_FIXTURE_BASE_URL).toBe(paid.handles.loopbackProvider.baseURL)
      expect(String(paid.env.NOMI_E2E_FIXTURE_API_KEY || '')).not.toBe('')
      // 目录里真的有那家内置档案（异步协议那条路），否则提交层拿不到 task id。
      const catalog = JSON.parse(fs.readFileSync(path.join(paidDir, 'model-catalog.json'), 'utf8'))
      expect(catalog.vendors.map((vendor) => vendor.key)).toContain(paid.handles.paidGenerationRoute.vendorKey)
    } finally {
      await paid.close()
    }
  })

  it('an unknown need fails before anything is provisioned', async () => {
    await expect(provisionNeeds(['nope'], { repoRoot, settingsDir: os.tmpdir() })).rejects.toThrow(/缺依赖/)
  })
})

describe('core smoke runner invariants', () => {
  it('the smoke may not touch tracked files; CI additionally needs a clean tree on both ends', () => {
    expect(checkWorkingTreeUntouched({ before: '', after: '', ci: true })).toEqual([])
    expect(checkWorkingTreeUntouched({ before: ' M a.ts\n', after: ' M a.ts\n', ci: false })).toEqual([])
    const dirtied = checkWorkingTreeUntouched({ before: '', after: ' M docs/plan/evidence.png\n', ci: false })
    expect(dirtied.join('\n')).toMatch(/docs\/plan\/evidence\.png/)
    expect(checkWorkingTreeUntouched({ before: ' M a.ts\n', after: ' M a.ts\n', ci: true }).join('\n')).toMatch(/CI 上/)
  })

  it('argv needs an explicit fixture and tolerates the pnpm separator', () => {
    expect(parseCoreSmokeArgv(['--', '--fixture', 'used'])).toEqual({ fixture: 'used', locale: 'zh-CN' })
    expect(() => parseCoreSmokeArgv([])).toThrow(/--fixture/)
    expect(() => parseCoreSmokeArgv(['--fixture', 'used', '--skip'])).toThrow(/不认识的参数/)
  })

  it('a walkthrough run by hand defaults to the empty fixture; unknown fixtures fail', () => {
    expect(readCoreSmokeEnvironment({}).fixture).toBe('empty')
    expect(readCoreSmokeEnvironment({ NOMI_CORE_SMOKE_NEEDS: '' }).assignedNeeds).toEqual([])
    expect(() => readCoreSmokeEnvironment({ NOMI_CORE_SMOKE_FIXTURE: 'staging' })).toThrow(/未知夹具/)
  })
})
