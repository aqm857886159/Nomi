// 付费走查的覆盖边界：每个 *.paid.mjs 要么走 openPaidWalk（自动配出网名单、被挡即失败、花钱前核闸），
// 要么在 _paidRun.mjs 的例外表里写明理由与它自己的网络护栏。
// 另钉一条（2026-10-24，B3 起因）：每个 buildMarkers 的标记都还原样留在产品源码里——被验的修复改写了，这里先红，不等付费那天。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  PAID_WALKS_WITHOUT_OPEN_PAID_WALK, PRODUCT_SOURCE_DIRS, assertPaidBuildReady, handedOverRuns, jobVendor, openPaidWalk, paidBuildMarkerProblems, paidWalkCoverageProblems,
} from './_paidRun.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * tests/ux 下所有非测试的 .mjs，含还没 add 的新文件。只列已跟踪的话，新付费走查在提交前跑这里是假绿、提交后才红
 * （2026-10-24：composer-b3-reference.paid.mjs 经一层包装调 openPaidWalk，提交前没被覆盖核对看见）。
 */
function walkScripts() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'tests/ux'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter((file) => /\.mjs$/.test(file) && !/\.test\.mjs$/.test(file) && fs.existsSync(path.join(repoRoot, file)))
}
const repoPaidWalks = () => walkScripts().filter((file) => /\.paid\.mjs$/.test(file))
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

describe('openPaidWalk · 接入先于开项目，不靠走查记得顺序', () => {
  const env = { NOMI_SPEND_OK: '1', CI: '', APIMART_API_KEY: 'sk-fake-key-for-test-0123456789abcdef' }
  const models = [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash' }]
  /** 假走查：App 起来 = 账本里有 guard-loaded 三层；newProject 记下被调时接入有没有做过。 */
  async function openFake() {
    const calls = []
    const win = { id: 'win' }
    const createWalk = vi.fn(async (name, options) => {
      fs.writeFileSync(options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] })}
`)
      return {
        report: {}, settingsDir: '', userDataDir: '', fixture: { close: async () => {} }, stopApp: async () => {},
        start: async () => ({ win }), newProject: async () => { calls.push('newProject'); return { projectId: 'project-1' } },
        finish: async () => {},
      }
    })
    const connect = vi.fn(async () => { calls.push('connect'); return { keySaved: true } })
    const readRows = vi.fn(async () => [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash', labelZh: 'x' }])
    const lockSpendTo = vi.fn(async () => { calls.push('lockSpend'); return 3 })
    const paid = await openPaidWalk('x.paid.mjs', 'x', models, { env, createWalk, assertBuild: () => {}, argv: [], connect, readRows, lockSpendTo })
    return { paid, calls, win, connect, lockSpendTo }
  }

  it('walk.newProject runs the connect + spend lock first when the walk never called it (the two walks that skipped it)', async () => {
    const { paid, calls, win, connect } = await openFake()
    await paid.walk.start({ first: true })
    await paid.walk.newProject()
    expect(calls).toEqual(['connect', 'lockSpend', 'newProject'])
    expect(connect).toHaveBeenCalledWith(win, expect.objectContaining({ requiredModels: models }))
  })

  it('an explicit lock before or after newProject runs the connect only once, in either order', async () => {
    const before = await openFake()
    const { win: beforeWin } = await before.paid.walk.start({ first: true })
    await before.paid.lockToAuthorizedModels(beforeWin)
    await before.paid.walk.newProject()
    await before.paid.lockToAuthorizedModels(beforeWin)
    expect(before.calls).toEqual(['connect', 'lockSpend', 'newProject'])
    const after = await openFake()
    const { win: afterWin } = await after.paid.walk.start({ first: true })
    await after.paid.walk.newProject()
    await after.paid.lockToAuthorizedModels(afterWin)
    expect(after.calls).toEqual(['connect', 'lockSpend', 'newProject'])
  })

  it('a failed connect stops newProject and is retried next time (nothing is marked locked)', async () => {
    const { paid, calls, connect } = await openFake()
    connect.mockRejectedValueOnce(new Error('connect timed out'))
    await paid.walk.start({ first: true })
    await expect(paid.walk.newProject()).rejects.toThrow('connect timed out')
    expect(calls).not.toContain('newProject')
    await paid.walk.newProject()
    expect(calls.filter((call) => call === 'newProject')).toHaveLength(1)
  })

  it('connecting does not depend on a window event: _paidEnvKey.mjs goes through the visible settings entry', () => {
    const source = read('tests/ux/_paidEnvKey.mjs')
    expect(source).toContain('openModelSettings(win')
    expect(source).not.toContain("dispatchEvent(new CustomEvent('nomi-open-model-catalog')")
  })
})

/** 产品源码里（src/、electron/，不含测试文件）有没有这句原文：git grep 搜工作树（含还没 add 的新文件）。 */
function inProductSource(text) {
  try {
    execFileSync('git', ['grep', '--untracked', '-q', '-F', '-e', text, '--', ...PRODUCT_SOURCE_DIRS, ':(exclude)*.test.*', ':(exclude)**/__tests__/**'], { cwd: repoRoot, stdio: 'pipe' })
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
}
const MARKER_DEPS = { sourceIncludes: inProductSource, uiTextOf: uiText }

describe('build markers stay in product source (zero cost, before any paid day)', () => {
  it('every buildMarkers entry under tests/ux reads statically and appears verbatim in src/ or electron/ (tests excluded)', () => {
    const files = walkScripts().filter((file) => /\bbuildMarkers\s*:\s*\[/.test(read(file)))
    expect(files).toContain('tests/ux/_composerB3ReferenceSteps.mjs')
    expect(paidBuildMarkerProblems(files, read, MARKER_DEPS)).toEqual([])
  })

  it('goes red for the marker B3 removed from the main-process guard (strip → reject), naming the file and the marker', () => {
    const old = "const BUILD_MARKER = 'reference residue stripped before send'\nawait openPaidWalk('x', 'y', [], { buildMarkers: [BUILD_MARKER] })\n"
    const problems = paidBuildMarkerProblems(['tests/ux/old.paid.mjs'], () => old, MARKER_DEPS)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('tests/ux/old.paid.mjs')
    expect(problems[0]).toContain('reference residue stripped before send')
    expect(paidBuildMarkerProblems(['tests/ux/new.paid.mjs'], () => old.replace('stripped', 'rejected'), MARKER_DEPS)).toEqual([])
  })

  it('reads a literal, a same-file const, a uiText call and a plain template; commented-out lists do not count', () => {
    const seen = []
    const code = [
      "// run({ buildMarkers: ['commented out'] })",
      'const M = "double \\" quoted"',
      "run({ buildMarkers: ['plain', M, uiText('zh-CN', 'creationAi.rewrite.inputAria'), `tpl`] })",
    ].join('\n')
    expect(paidBuildMarkerProblems(['a.mjs'], () => code, { sourceIncludes: (text) => { seen.push(text); return true }, uiTextOf: uiText })).toEqual([])
    expect(seen).toEqual(['plain', 'double " quoted', uiText('zh-CN', 'creationAi.rewrite.inputAria'), 'tpl'])
  })

  it('goes red for an entry it cannot read statically, an unknown uiText key, or an empty list', () => {
    const deps = { sourceIncludes: () => true, uiTextOf: uiText }
    const problems = paidBuildMarkerProblems(['b.mjs'], () => "run({ buildMarkers: [makeMarker(), IMPORTED, uiText('zh-CN', 'no.such.key')] })", deps)
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toMatch(/makeMarker\(\) 读不出字面值/)
    expect(problems.join('\n')).toMatch(/IMPORTED 读不出字面值/)
    expect(problems.join('\n')).toMatch(/uiText\('zh-CN', 'no\.such\.key'\) 读不到/)
    expect(paidBuildMarkerProblems(['c.mjs'], () => 'run({ buildMarkers: [] })', deps).join()).toContain('是空的')
  })
})

describe('画布那一台的读数（D2：卡上「生成」交给画布）', () => {
  it('handedOverRuns：按这一次出价最近一回的交接找到画布那几镜的单镜 Run；别的出价、没交出去的不算', () => {
    const offer = { runId: 'op-1', generationPlan: { presentations: [
      { handOvers: [{ shotId: 'shot-1', canvasRunId: 'canvas-old' }] },
      { handOvers: [{ shotId: 'shot-1', canvasRunId: 'canvas-a' }, { shotId: 'shot-2' }, { shotId: 'shot-3', canvasRunId: 'canvas-b' }] },
    ] } }
    const runs = [offer, { runId: 'canvas-a' }, { runId: 'canvas-b' }, { runId: 'canvas-old' }, { runId: 'canvas-other' }]
    expect(handedOverRuns(runs, 'op-1').map((run) => run.runId)).toEqual(['canvas-a', 'canvas-b'])
    expect(handedOverRuns(runs, 'op-missing')).toEqual([])
  })

  it('jobVendor：画布那一台的 provider 带传输前缀 canvas:，收据里的供应商是前缀后面那一段', () => {
    expect(jobVendor('canvas:apimart')).toEqual({ vendor: 'apimart', engine: 'canvas' })
    expect(jobVendor('apimart')).toEqual({ vendor: 'apimart', engine: 'production' })
    expect(jobVendor(undefined)).toEqual({ vendor: null, engine: 'production' })
  })
})
