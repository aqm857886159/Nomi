// 走查：告知范围升级后，已同意旧范围的用户被再确认一次，确认之前新字段一条都不发。
//   ① 盘上预埋「旧版本同意过」的遥测设置（enabled、没有 scopeVersion），并把首次询问卡标成问过；
//   ② 打开项目 → Agent 面板空态出现「再确认卡」（scope 形态），不是首次询问卡；
//   ③ 经真 IPC 投一份合法的 perf.session.summary：确认前 queued=false；
//   ④ 点「同意新增」→ 设置视图的 scopeVersion 升到 2；再投同一份 → queued=true，待发摘要里出现这个事件；
//   ⑤ 重载后卡不再出现。
// 用法：先 pnpm run build；node tests/ux/telemetry-scope-reconfirm.walk.mjs
//       EVIDENCE_DIR=<目录> 指定截图落点
import { launchNomiApp } from './_launchApp.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expect, expectAbsent, proveProbe, clickOrFail, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'tests/ux/shots/telemetry-scope-reconfirm')
fs.mkdirSync(evidenceDir, { recursive: true })
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-telemetry-scope-reconfirm')
fs.rmSync(tempRoot, { recursive: true, force: true })

const PERF_PROPS = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: false, cpuCores: '5-8', memoryGb: '8plus' }
const LOCALES = [
  { locale: 'zh-CN', newProject: /新建空白项目/ },
  { locale: 'en', newProject: /New blank project/ },
]

let failed = null
for (const spec of LOCALES) {
  let app
  try {
    const dir = path.join(tempRoot, spec.locale)
    const opts = { userDataDir: path.join(dir, 'user-data'), settingsDir: path.join(dir, 'settings'), projectsDir: path.join(dir, 'projects') }
    fs.mkdirSync(opts.settingsDir, { recursive: true })
    // 旧版本写下的文件：开着、没有 scopeVersion 这一格。
    fs.writeFileSync(path.join(opts.settingsDir, 'telemetry-settings.json'), JSON.stringify({ schemaVersion: 1, enabled: true, endpointMode: 'aptabase', consentedAt: '2026-09-20T00:00:00.000Z', installSessionId: 'legacySession0123456789' }))
    let win
    ;({ app, win } = await launchNomiApp({ name: `scope-reconfirm-${spec.locale}`, ...opts, settleMs: 0 }))
    await win.evaluate((locale) => {
      localStorage.setItem('nomi:locale:v1', locale)
      localStorage.setItem('nomi:agent-consent-asked:v1', 'asked')
      for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    }, spec.locale)
    await win.reload()
    await win.waitForFunction(() => Boolean(window.nomiDesktop?.settings?.telemetry))

    const before = await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())
    expect(before.enabled, '预埋的旧设置应当是开着的').toBe(true)
    expect(before.scopeVersion, '旧设置里没有范围版本，读出来应当是 1').toBe(1)

    await clickOrFail(win.getByRole('button', { name: spec.newProject }), 'new project', { noWaitAfter: true })
    await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
    const card = win.locator('[data-v4-block="consent"]').first()
    await expect(card, '已同意旧范围的用户该看到再确认卡').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const proof = await proveProbe(win.locator('[data-v4-block="consent"]'), '能看到再确认卡')
    expect(await card.getAttribute('data-v4-consent-mode'), '应当是 scope 形态，不是首次询问卡').toBe('scope')
    await card.screenshot({ path: path.join(evidenceDir, `${spec.locale}-scope-card.png`) })

    const queuedBefore = await win.evaluate((props) => window.nomiDesktop.telemetry.track({ eventName: 'perf.session.summary', props }), PERF_PROPS)
    expect(queuedBefore.queued, '确认之前新范围的事件不许入队').toBe(false)

    // 按钮按词典里的名字认，不抄文案。
    await card.getByRole('button', { name: uiText(spec.locale, 'agentPanelV4.consent.scopeAccept'), exact: true }).click()
    await expect.poll(async () => (await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())).scopeVersion, { timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
    const after = await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())
    expect(after.scopeVersion, '点同意后范围版本应升到 2').toBe(2)
    const queuedAfter = await win.evaluate((props) => window.nomiDesktop.telemetry.track({ eventName: 'perf.session.summary', props }), PERF_PROPS)
    expect(queuedAfter.queued, '确认之后新范围的事件应当入队').toBe(true)
    const summary = await win.evaluate(() => window.nomiDesktop.settings.telemetry.summary())
    const names = [...summary.pending, ...summary.sent].map((item) => item.eventName)
    expect(names, '本机待发 / 已发摘要里应当有 perf.session.summary').toContain('perf.session.summary')

    await win.reload()
    // 等 Agent 面板的空态出现（卡就住在它里面），再证明卡不在——不拿 sleep 当信号。
    await win.waitForSelector('[data-v4-block="empty"]', { timeout: DEFAULT_TIMEOUT_MS })
    await expectAbsent(win.locator('[data-v4-block="consent"]'), { provenBy: proof, message: '确认过的用户重载后又被弹了卡' })
    await screenshotSettled(win, { path: path.join(evidenceDir, `${spec.locale}-after-confirm.png`) })
    console.log(`✅ ${spec.locale}: 再确认卡出现 → 确认前不入队 → 确认后升到范围 2 并入队 → 重载不再弹`)
  } catch (error) {
    failed = error
  } finally {
    await app?.close().catch(() => {})
  }
  if (failed) break
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
