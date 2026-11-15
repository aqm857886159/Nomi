// 付费走查的覆盖边界：每个 *.paid.mjs 要么走 openPaidWalk（自动配出网名单、被挡即失败、花钱前核闸），
// 要么在 _paidRun.mjs 的例外表里写明理由与它自己的网络护栏。
// 另钉一条（2026-10-24，B3 起因）：每个 buildMarkers 的标记都还原样留在产品源码里——被验的修复改写了，这里先红，不等付费那天。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'

import {
  PAID_WALKS_WITHOUT_OPEN_PAID_WALK, PRODUCT_SOURCE_DIRS, REHEARSAL_FAKE_KEY, rehearsalFreeAnswers, assertPaidBuildReady, handedOverRuns, printRehearsalReminder, rehearsalReminder, jobVendor, openPaidWalk, packagedBuildIdentity,
  paidBuildMarkerProblems, paidRunRefusal, paidWalkCoverageProblems, rehearsalReceiptFile, scriptFingerprint, writeRehearsalReceipt,
  REHEARSAL_ENDPOINTS, REHEARSAL_RECEIPT_VERSION, rehearsalEndpointOf,
} from './_paidRun.mjs'
import { REHEARSAL_STATIONS } from './_paidNetwork.mjs'
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
    await expect(openPaidWalk('x.paid.mjs', 'x', models, { env, createWalk, assertBuild, argv: ['--packaged', 'C:/Nomi.exe'], packagedBuild: () => 'packaged:test', remindRehearsal: () => {} })).rejects.toThrow('reached createWalk')
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
    const paid = await openPaidWalk('x.paid.mjs', 'x', models, { env, createWalk, assertBuild: () => {}, remindRehearsal: () => {}, argv: [], connect, readRows, lockSpendTo })
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

// ── 演练（2026-11-15）：同一份付费脚本带 NOMI_PAID_REHEARSAL 免费走一遍；没演练过的真付费拒跑 ──────────────
describe('rehearsal · 开关判据', () => {
  it('R2 · 演练开关和花钱开关同时开 = 拒（两档都拒）', () => {
    for (const tier of ['no-key', 'real-key']) expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: tier, NOMI_SPEND_OK: '1' } })).toContain('说不清这一场要不要花钱')
  })
  it('演练不要 NOMI_SPEND_OK；不要 Key 那档在 CI 里也能跑，要真 Key 那档不行；认不出的值拒', () => {
    expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: 'no-key' } })).toBeNull()
    expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: 'no-key', CI: 'true' } })).toBeNull()
    expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: 'real-key', CI: 'true' } })).toContain('不在 CI 里跑')
    expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: 'yes' } })).toContain('只认')
    expect(paidRunRefusal('x.paid.mjs', { env: { NOMI_PAID_REHEARSAL: 'real-key' }, nomiRunning: true })).toContain('Nomi 正开着')
    // 不带演练开关：和以前一字不差。
    expect(paidRunRefusal('x.paid.mjs', { env: {} })).toContain('NOMI_SPEND_OK=1')
  })
})

describe('rehearsal · 上次演练的提醒（只提醒，不拦）', () => {
  const want = { script: 'tests/ux/x.paid.mjs', fingerprint: 'sha256:a', build: 'tree-1', now: Date.parse('2026-11-15T12:00:00Z') }
  const good = { version: REHEARSAL_RECEIPT_VERSION, script: 'tests/ux/x.paid.mjs', fingerprint: 'sha256:a', build: 'tree-1', passed: true, status: 'passed', station: 'vendor-create', shots: { declared: 4, reached: 4 }, reason: '走到了「vendor-create」', at: '2026-11-15T10:00:00Z' }
  const text = (receipt, extra = {}) => rehearsalReminder(receipt, { ...want, ...extra }).join('\n')
  it('同一份脚本、同一个构建：打印什么时候、过没过、走到哪一站、几发里走到几发，不说「没演练过」', () => {
    const shown = text(good)
    expect(shown).toMatch(/只提醒，不拦/)
    expect(shown).toContain('2026-11-15T10:00:00Z（2 小时前）')
    expect(shown).toMatch(/过 · 走到「vendor-create」，4 发里走到 4 发/)
    expect(shown).not.toContain('没演练过这个版本')
  })
  it('R3 · 没有收据 / 别的脚本的收据：明说「没演练过这个版本」，照跑，指出怎么免费演练', () => {
    for (const receipt of [null, { ...good, script: 'tests/ux/y.paid.mjs' }]) expect(text(receipt)).toMatch(/没演练过这个版本[\s\S]*照跑[\s\S]*NOMI_PAID_REHEARSAL=no-key/)
  })
  it('R4 · 脚本改过 / 构建变了 / 算不出构建 / 旧格式：「没演练过这个版本」并点名变了什么；上次没过、只到大脑：照实说', () => {
    expect(text(good, { fingerprint: 'sha256:b' })).toMatch(/没演练过这个版本：脚本（或它的本地辅助模块）在演练之后改过/)
    expect(text(good, { build: 'tree-2' })).toMatch(/构建变了（演练时 tree-1，现在 tree-2）/)
    expect(text(good, { build: undefined })).toContain('算不出构建身份')
    expect(text(good, { fingerprint: null })).toContain('算不出脚本指纹')
    expect(text({ ...good, version: 2 })).toContain('收据是旧格式')
    expect(text({ ...good, passed: false, status: 'failed', reason: '找不到生成钮' })).toMatch(/不过 · [\s\S]*找不到生成钮[\s\S]*上次演练不过——照跑/)
    expect(text({ ...good, passed: false, status: 'brain-only', station: 'brain' })).toMatch(/只到大脑请求（不算过） · 走到「brain」/)
  })
  it('R3 · 真付费入口用的那份提醒从不抛：入口文件不存在、收据目录不存在都只打印', () => {
    const lines = []
    const dir = makeTempDir('nomi-rehearsal-none-')
    expect(() => printRehearsalReminder({ script: 'tests/ux/none.paid.mjs', entry: path.join(dir, 'none.paid.mjs'), build: 'tree-1', receiptDir: path.join(dir, 'r'), log: (line) => lines.push(line) })).not.toThrow()
    expect(lines.join('\n')).toMatch(/没演练过这个版本[\s\S]*照跑/)
  })
  it('终点声明表：每一条都写了理由、文件在、终点是认得的站；表外的一律 vendor-create', () => {
    expect(rehearsalEndpointOf('tests/ux/x.paid.mjs', { 'x.paid.mjs': { endsAt: 'vendor-read', why: '只查列表' } })).toBe('vendor-read')
    expect(rehearsalEndpointOf('tests/ux/y.paid.mjs', { 'x.paid.mjs': { endsAt: 'vendor-read', why: '只查列表' } })).toBe('vendor-create')
    for (const [script, row] of Object.entries(REHEARSAL_ENDPOINTS)) {
      expect(script).toMatch(/\.paid\.mjs$/)
      expect(fs.existsSync(path.join('tests', 'ux', script))).toBe(true)
      expect(REHEARSAL_STATIONS).toContain(row.endsAt)
      expect(row.endsAt).not.toBe('vendor-create')
      expect(String(row.why ?? '').length).toBeGreaterThan(4)
    }
  })
  it('R4 · 脚本改一个字符、或它 import 的本地辅助模块改一个字符，指纹都变；写收据 → 提醒读的是同一张', () => {
    const root = makeTempDir('nomi-rehearsal-fp-')
    const dir = path.join(root, 'tests', 'ux')
    fs.mkdirSync(dir, { recursive: true })
    const entry = path.join(dir, 'x.paid.mjs')
    fs.writeFileSync(entry, "import { reach } from './_reach.mjs'\nawait reach()\n")
    fs.writeFileSync(path.join(dir, '_reach.mjs'), "export const reach = async () => 'generate'\n")
    const first = scriptFingerprint(entry, { repoBase: root })
    expect(first.files).toBe(2)
    fs.writeFileSync(path.join(dir, '_reach.mjs'), "export const reach = async () => 'generatE'\n")
    expect(scriptFingerprint(entry, { repoBase: root }).fingerprint).not.toBe(first.fingerprint)
    const receipts = path.join(root, 'receipts')
    const written = writeRehearsalReceipt({ script: 'tests/ux/x.paid.mjs', entry, build: 'tree-1', tier: 'no-key', verdict: { passed: true, status: 'passed', reason: 'ok', request: null, station: 'vendor-create', shots: { declared: 1, reached: 1 } }, receiptDir: receipts })
    expect(written).toMatchObject({ version: REHEARSAL_RECEIPT_VERSION, status: 'passed', shots: { declared: 1, reached: 1 } })
    const read = () => { const lines = []; printRehearsalReminder({ script: 'tests/ux/x.paid.mjs', entry, build: 'tree-1', receiptDir: receipts, log: (line) => lines.push(line) }); return lines.join('\n') }
    expect(read()).not.toContain('没演练过这个版本')
    fs.appendFileSync(entry, ' ')
    expect(read()).toMatch(/没演练过这个版本：脚本（或它的本地辅助模块）在演练之后改过/)
    // 收据文件名 = 脚本的仓库相对路径，分隔符换成双下划线（写成 join：整串字面量会被走查选择器门岗误读成 CSS 类名）
    expect(rehearsalReceiptFile('tests/ux/x.paid.mjs', receipts)).toBe(path.join(receipts, ['tests', 'ux', 'x.paid.mjs.json'].join('__')))
  })
  it('安装包形态：构建身份取安装包的 app.asar（大小 + 修改时间）', () => {
    const asar = path.resolve('/A/Nomi.app/Contents/MacOS/Nomi', '..', '..', 'Resources', 'app.asar')
    expect(packagedBuildIdentity(['--packaged', '/A/Nomi.app/Contents/MacOS/Nomi'], { exists: (file) => file === asar, stat: () => ({ size: 7, mtimeMs: 9.4 }) })).toBe('packaged:app.asar:size:7:mtime:9')
  })
})

describe('rehearsal · openPaidWalk 接线（假 App）', () => {
  const MODELS = [{ vendorKey: 'apimart', modelKey: 'kling-v4-flash' }]
  function fakeWalk({ media = [] } = {}) {
    const root = makeTempDir('nomi-rehearsal-walk-')
    const tempRoot = path.join(root, 'isolated')
    const outputDir = path.join(root, 'evidence')
    const projectRoot = path.join(tempRoot, 'projects', 'p1')
    fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify({ payload: { generationCanvas: { nodes: media } } }))
    const seen = { options: null, stopped: 0, connectKey: null }
    const createWalk = vi.fn(async (_name, options) => {
      seen.options = options
      fs.writeFileSync(options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] })}\n`)
      const report = { tempRoot, outputDir, projectRoot }
      return {
        report, outputDir, settingsDir: path.join(tempRoot, 'settings'), userDataDir: path.join(tempRoot, 'user-data'), fixture: { close: async () => {} },
        stopApp: async () => { seen.stopped += 1 },
        start: async () => ({ win: { id: 'win' } }), newProject: async () => ({ projectId: 'project-1' }),
        finish: async (error, { collect } = {}) => {
          const failures = error ? [error] : []
          try { Object.assign(report, await collect?.()) } catch (collectError) { failures.push(collectError) }
          report.result = failures.length ? 'failed' : 'passed'
          report.error = failures.map((failure) => failure.message).join('\n') || undefined
        },
      }
    })
    const receipts = []
    let standInCount = 1
    const deps = {
      createWalk, assertBuild: () => ({ tree: 'tree-1' }), argv: [], entry: 'tests/ux/x.paid.mjs',
      connect: async (_win, { apiKey }) => { seen.connectKey = apiKey; return { keySaved: true } },
      readRows: async () => MODELS.map((model) => ({ ...model, kind: 'video', labelZh: 'x' })), lockSpendTo: async () => 0,
      remindRehearsal: vi.fn(() => ['[paid] 上次演练（只提醒，不拦）']),
      writeReceipt: (receipt) => { receipts.push(receipt); return receipt },
      startStandIn: vi.fn(async (options) => { const to = `http://127.0.0.1:${40000 + standInCount++}`; return { options, origin: to, redirect: { from: options.origin, to }, close: vi.fn(async () => {}) } }),
    }
    const vendorBlock = `${JSON.stringify({ kind: 'blocked', via: 'chromium', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations' })}\n`
    return { seen, deps, receipts, vendorBlock, root }
  }
  const noKeyEnv = (root) => ({ NOMI_PAID_REHEARSAL: 'no-key', CI: '', APIMART_API_KEY: 'sk-real-looking-key-0123456789', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'no-such-real-profile') })
  const openAndLock = async (deps, env, models = MODELS) => {
    const paid = await openPaidWalk('x.paid.mjs', 'x', models, { ...deps, env })
    await paid.walk.start({ first: true })
    await paid.walk.newProject()
    return paid
  }

  it('R1 · 不要 Key 的演练：交给闸的放行名单是空的；真 Key 不进接入页（用假钥匙）；子进程的 Key 是空串；不读真实资料；不打印上次演练的提醒', async () => {
    const { seen, deps, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    expect(paid.rehearsal).toBe('no-key')
    expect(seen.options.env.NOMI_WALK_ALLOW_ORIGINS).toBe('')
    expect(seen.options.env.APIMART_API_KEY).toBe('')
    expect(paid.walk.report.networkAllowlist).toEqual([])
    expect(paid.walk.report.rehearsal.judgedAgainst).toContain('https://api.apimart.ai')
    expect(seen.connectKey).toBe(REHEARSAL_FAKE_KEY)
    expect(deps.remindRehearsal).not.toHaveBeenCalled()
    // 供应商的源改道到本机替身，替身只答产品种子声明的免费探测（APIMart 的余额查询）
    expect(JSON.parse(seen.options.env.NOMI_TEST_NETWORK_REDIRECTS)).toEqual([{ from: 'https://api.apimart.ai', to: 'http://127.0.0.1:40001' }])
    const standIn = deps.startStandIn.mock.calls[0][0]
    expect(standIn.origin).toBe('https://api.apimart.ai')
    expect(standIn.role).toBe('vendor')
    expect(standIn.freeAnswers).toEqual({ 'GET /v1/balance': { remain_balance: 0 } })
    // 供应商自己的上传口也由替身答（路径、回链字段取产品的声明）
    expect(standIn.uploadAnswers).toEqual({ 'POST /v1/uploads/images': 'url' })
    expect(deps.startStandIn).toHaveBeenCalledTimes(1) // 没带本地素材：不起中转替身
  })

  it('r2 · 带本地素材（hostedUploads）：中转也改道到本机替身，只答上传；判据的供应商名单里没有中转', async () => {
    const { seen, deps, root } = fakeWalk()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), hostedUploads: true })
    const redirects = JSON.parse(seen.options.env.NOMI_TEST_NETWORK_REDIRECTS)
    expect(redirects).toHaveLength(2)
    const relay = deps.startStandIn.mock.calls[1][0]
    expect(relay.role).toBe('relay')
    expect(redirects[1]).toEqual({ from: relay.origin, to: 'http://127.0.0.1:40002' })
    expect(relay.uploadAnswers).toEqual({ [`POST ${new URL(relay.origin + '/v1/assets').pathname}`]: 'url' })
    expect(paid.walk.report.rehearsal.judgedAgainst).not.toContain(relay.origin)
    expect(paid.walk.report.rehearsal.relay).toEqual([relay.origin])
    expect(seen.options.env.NOMI_WALK_ALLOW_ORIGINS).toBe('')
    expect(seen.options.env.NOMI_LAB_TRUSTED_PRIVATE_ORIGINS).toBe('http://127.0.0.1:40001,http://127.0.0.1:40002')
  })

  it('r2 · 读账本的口演练时返回替身记下的供应商请求（同一个形状），脚本的请求体判据照样判；读不到就是空（判据红）', async () => {
    const { seen, deps, root } = fakeWalk()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), recordAllowedBodies: true })
    await paid.walk.start({ first: true })
    expect(paid.readAllowedRequests()).toEqual([])
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations', body: { text: '{"duration":5}' } })}\n`)
    const [request] = paid.readAllowedRequests()
    expect(request).toMatchObject({ kind: 'allowed-request', method: 'POST', host: 'api.apimart.ai', body: { text: '{"duration":5}' } })
    await paid.finish(new Error('x'))
    process.exitCode = 0
  })

  it('r2 · 自带转发代理的脚本从 vendorUpstream 拿上游：演练 = 本机供应商替身（不是真供应商），代理插在 App 和替身之间、中转替身那条改道保留；真付费 = 名单上的真供应商', async () => {
    const { deps, root } = fakeWalk()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), hostedUploads: true })
    const upstream = paid.vendorUpstream()
    expect(upstream).toMatchObject({ from: 'https://api.apimart.ai', target: 'http://127.0.0.1:40001' })
    const env = upstream.launchEnvVia('http://127.0.0.1:49999')
    const relay = deps.startStandIn.mock.calls[1][0].origin
    expect(JSON.parse(env.NOMI_TEST_NETWORK_REDIRECTS)).toEqual([{ from: 'https://api.apimart.ai', to: 'http://127.0.0.1:49999' }, { from: relay, to: 'http://127.0.0.1:40002' }])
    expect(env.NOMI_LAB_TRUSTED_PRIVATE_ORIGINS).toBe('http://127.0.0.1:49999,http://127.0.0.1:40001,http://127.0.0.1:40002')
    expect(paid.walk.report.networkAllowlist).toEqual([]) // 演练时闸的放行名单仍是空的：代理就算转发，也只能到替身
    const real = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: { NOMI_SPEND_OK: '1', CI: '', APIMART_API_KEY: 'sk-real-looking-key-0123456789', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'none') }, remindRehearsal: () => {} })
    expect(real.vendorUpstream().target).toBe(real.walk.report.networkAllowlist[0])
  })

  it('r2 · 创建请求被替身记下后：缺省（含只开 recordAllowedBodies 的）立刻关 App；声明自己判请求体的（judgesBodyInRehearsal）留给脚本判', async () => {
    const createRow = (at) => `${JSON.stringify({ kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: 'https://api.apimart.ai/v1/videos/generations', at })}\n`
    for (const [options, stops] of [[{ recordAllowedBodies: true }, true], [{ recordAllowedBodies: true, judgesBodyInRehearsal: true }, false]]) {
      const { seen, deps, root } = fakeWalk()
      const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), ...options })
      await paid.walk.start({ first: true })
      await paid.lockToAuthorizedModels({ id: 'win' })
      fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, createRow(new Date().toISOString()))
      await new Promise((resolve) => setTimeout(resolve, 700))
      expect(seen.stopped > 0).toBe(stops)
      await paid.finish(undefined)
    }
    process.exitCode = 0
  })

  it('r2 · 脚本自己把 report.rehearsal 写成一个布尔开关（老脚本的写法）：收尾不崩，演练一节照样落进报告', async () => {
    const { seen, deps, receipts, vendorBlock, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    paid.walk.report.rehearsal = false
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, vendorBlock)
    await paid.finish(undefined)
    expect(paid.walk.report.rehearsal).toMatchObject({ tier: 'no-key', passed: true, station: 'vendor-create' })
    expect(receipts[0].verdict.passed).toBe(true)
    process.exitCode = 0
  })

  it('替身只在不要 Key 那档起；不演练、real-key 档都不起', async () => {
    const { deps, root } = fakeWalk()
    await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: { NOMI_SPEND_OK: '1', CI: '', APIMART_API_KEY: 'sk-real-looking-key-0123456789', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'none') }, remindRehearsal: () => {} })
    expect(deps.startStandIn).not.toHaveBeenCalled()
  })

  it('免费探测的回答从种子声明派生：成功判据那个字段 = 0，嵌套路径也对', () => {
    expect(rehearsalFreeAnswers({ request: { method: 'get', path: '/v1/balance' }, successPath: 'remain_balance' })).toEqual({ 'GET /v1/balance': { remain_balance: 0 } })
    expect(rehearsalFreeAnswers({ request: { method: 'POST', path: '/estimate' }, successPath: 'data.credits' })).toEqual({ 'POST /estimate': { data: { credits: 0 } } })
  })

  it('收尾关掉替身', async () => {
    const { deps, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    await paid.finish(new Error('x'))
    const standIn = await deps.startStandIn.mock.results[0].value
    expect(standIn.close).toHaveBeenCalled()
    process.exitCode = 0
  })

  it('挡下授权供应商的第一条请求（收窄之后）→ 通过、落收据、退出码 0、报告记方法和路径', async () => {
    const { seen, deps, receipts, vendorBlock, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, vendorBlock)
    process.exitCode = 1 // 脚本自己的 catch 在被挡后会这么设
    await paid.finish(undefined)
    expect(paid.walk.report.result).toBe('passed')
    expect(paid.walk.report.rehearsal).toMatchObject({ passed: true, station: 'vendor-create', blockedRequest: { method: 'POST', host: 'api.apimart.ai', path: '/v1/videos/generations' } })
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ script: 'tests/ux/x.paid.mjs', build: 'tree-1', tier: 'no-key', verdict: { passed: true, station: 'vendor-create' } })
    expect(process.exitCode).toBe(0)
  })

  it('脚本在发请求之前就失败（例如找不到生成钮）→ 不过、收据记不过、退出码 1', async () => {
    const { deps, receipts, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    await paid.finish(new Error('等不到「生成」按钮'))
    expect(paid.walk.report.result).toBe('failed')
    expect(paid.walk.report.rehearsal.reason).toContain('等不到「生成」按钮')
    expect(receipts[0].verdict.passed).toBe(false)
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  it('R7 · 演练里收据出现供应商任务号 → 判红（请求到了供应商）', async () => {
    const node = { id: 'n1', kind: 'video', meta: {}, runs: [{ id: 'r1', taskId: 'task-123', status: 'running' }] }
    const { seen, deps, receipts, vendorBlock, root } = fakeWalk({ media: [node] })
    const paid = await openAndLock(deps, noKeyEnv(root))
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, vendorBlock)
    await paid.finish(undefined)
    expect(paid.walk.report.error).toContain('供应商任务号')
    expect(receipts[0].verdict.passed).toBe(false)
    process.exitCode = 0
  })

  it('不要 Key 的演练点名了别家模型：起窗之前拒，指去 real-key 档', async () => {
    const { deps, root } = fakeWalk()
    await expect(openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'kie', modelKey: 'm' }], { ...deps, env: noKeyEnv(root) })).rejects.toThrow(/只覆盖 APIMart.*real-key/)
    expect(deps.createWalk).not.toHaveBeenCalled()
  })

  it('R3 · 真付费（不带演练开关）没有收据也不拒：开跑前打印上次演练的情况，照样建隔离副本；提醒自己出错也照跑；vendorNetwork:false 的探测不打印', async () => {
    const { deps, root } = fakeWalk()
    const env = { NOMI_SPEND_OK: '1', CI: '', APIMART_API_KEY: 'sk-real-looking-key-0123456789', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'none') }
    await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env })
    expect(deps.remindRehearsal).toHaveBeenCalledWith({ script: 'tests/ux/x.paid.mjs', entry: 'tests/ux/x.paid.mjs', build: 'tree-1' })
    expect(deps.createWalk).toHaveBeenCalledTimes(1)
    await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env, remindRehearsal: () => { throw new Error('boom') } })
    expect(deps.createWalk).toHaveBeenCalledTimes(2)
    deps.remindRehearsal.mockClear()
    await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env, vendorNetwork: false })
    expect(deps.remindRehearsal).not.toHaveBeenCalled()
  })

  it('原有的拒跑一条不动：没有 NOMI_SPEND_OK、在 CI 里，都在建隔离副本之前拒，也不打印提醒', async () => {
    const { deps } = fakeWalk()
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: { CI: '', APIMART_API_KEY: 'sk-real-looking-key-0123456789' } })).rejects.toThrow('NOMI_SPEND_OK=1')
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: { CI: 'true', NOMI_SPEND_OK: '1' } })).rejects.toThrow()
    expect(deps.createWalk).not.toHaveBeenCalled()
    expect(deps.remindRehearsal).not.toHaveBeenCalled()
  })

  const createRow = (pathname = '/v1/videos/generations') => `${JSON.stringify({ kind: 'blocked', via: 'rehearsal-vendor', role: 'vendor', method: 'POST', host: 'api.apimart.ai', url: `https://api.apimart.ai${pathname}`, at: new Date().toISOString() })}\n`
  const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms))

  it('真问题 1 · 自己判请求体的脚本：兜底超时关了 App，脚本随后报的判据错不许吞 → 不过，错的原文进结果和收据', async () => {
    const { seen, deps, receipts, root } = fakeWalk()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), recordAllowedBodies: true, judgesBodyInRehearsal: true, rehearsalGraceMs: 200 })
    await paid.walk.start({ first: true })
    await paid.lockToAuthorizedModels({ id: 'win' })
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, createRow())
    await settle(1500)
    expect(seen.stopped).toBeGreaterThan(0)
    await paid.finish(new Error('样片没过：A1：请求体判据没过：omni_reference_task_type 是 "reference"，应是 edit'))
    expect(paid.walk.report.rehearsal).toMatchObject({ passed: false, status: 'failed', stoppedBy: 'idle' })
    expect(paid.walk.report.rehearsal.reason).toMatch(/兜底超时[\s\S]*omni_reference_task_type/)
    expect(receipts[0].verdict.scriptError).toContain('omni_reference_task_type')
    expect(process.exitCode).toBe(1)
    process.exitCode = 0
  })

  it('真问题 1 · 自己判请求体的脚本没被关窗、自己抛了判据错 → 不过（错算数）', async () => {
    const { seen, deps, root } = fakeWalk()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), recordAllowedBodies: true, judgesBodyInRehearsal: true })
    await paid.walk.start({ first: true })
    await paid.lockToAuthorizedModels({ id: 'win' })
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, createRow())
    await paid.finish(new Error('请求体判据没过：aspect_ratio'))
    expect(paid.walk.report.rehearsal).toMatchObject({ passed: false, status: 'failed', scriptErrorCounted: true })
    expect(paid.walk.report.rehearsal.reason).toContain('aspect_ratio')
    process.exitCode = 0
  })

  it('真问题 2 · 声明 4 发只走到 2 发 → 不过，写「4 发里只走到 2 发」；4 发都走到 → 过', async () => {
    for (const [rows, passed] of [[2, false], [4, true]]) {
      const { seen, deps, receipts, root } = fakeWalk()
      const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), recordAllowedBodies: true, judgesBodyInRehearsal: true, rehearsalShots: 4 })
      await paid.walk.start({ first: true })
      await paid.lockToAuthorizedModels({ id: 'win' })
      for (let index = 0; index < rows; index += 1) fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, createRow())
      await paid.finish(undefined)
      expect(paid.walk.report.rehearsal.passed).toBe(passed)
      expect(receipts[0].verdict.shots).toEqual({ declared: 4, reached: rows })
      if (!passed) expect(paid.walk.report.rehearsal.reason).toContain('4 发里只走到 2 发')
    }
    process.exitCode = 0
  })

  it('声明多发却没开自己判请求体、或发数不是正整数：起窗之前拒', async () => {
    const { deps, root } = fakeWalk()
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), rehearsalShots: 3 })).rejects.toThrow(/声明了 3 发/)
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: noKeyEnv(root), rehearsalShots: 0 })).rejects.toThrow(/rehearsalShots/)
    expect(deps.createWalk).not.toHaveBeenCalled()
  })

  it('真问题 3 · 终点在创建请求、却只走到大脑请求：立刻关 App，状态「只到大脑」，不算过、退出码 0，收据如实记', async () => {
    const { seen, deps, receipts, root } = fakeWalk()
    const paid = await openAndLock(deps, noKeyEnv(root))
    fs.appendFileSync(seen.options.env.NOMI_WALK_NET_LOG, createRow('/v1/chat/completions'))
    await settle()
    expect(seen.stopped).toBeGreaterThan(0)
    process.exitCode = 1
    await paid.finish(new Error('Target page, context or browser has been closed'))
    expect(paid.walk.report.rehearsal).toMatchObject({ passed: false, status: 'brain-only', station: 'brain', stoppedBy: 'brain' })
    expect(receipts[0].verdict).toMatchObject({ passed: false, status: 'brain-only' })
    expect(process.exitCode).toBe(0)
  })

  it('R2 · 两个开关同时开：起窗之前拒', async () => {
    const { deps, root } = fakeWalk()
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { ...deps, env: { ...noKeyEnv(root), NOMI_SPEND_OK: '1' } })).rejects.toThrow('说不清这一场要不要花钱')
    expect(deps.createWalk).not.toHaveBeenCalled()
  })
})
