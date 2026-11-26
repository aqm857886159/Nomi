// 走查：告知范围升级后，已同意旧范围的用户被再确认一次，确认之前新字段一条都不发。
//   ① 盘上预埋「旧版本同意过」的遥测设置（enabled、没有 scopeVersion），并把首次询问卡标成问过；
//   ② 打开项目 → Agent 面板空态出现「再确认卡」（scope 形态），不是首次询问卡；
//   ③ 经真 IPC 投一份合法的 perf.session.summary：确认前 queued=false；
//   ④ 点「同意新增」→ 设置视图的 scopeVersion 升到 2；再投同一份 → queued=true，待发摘要里出现这个事件；
//   ⑤ 重载后卡不再出现。
// 用法：先 pnpm run build；node tests/ux/telemetry-scope-reconfirm.walk.mjs
//       EVIDENCE_DIR=<目录> 指定截图落点
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { AGENT_PANEL, createBlankProject, ensureAgentPanelOpen } from './_shell.mjs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'

const tempRoot = makeTempDir('nomi-telemetry-scope-reconfirm-')
const evidenceDir = process.env.EVIDENCE_DIR ? assertOutsideRepo(process.env.EVIDENCE_DIR) : path.join(tempRoot, 'evidence')
fs.mkdirSync(evidenceDir, { recursive: true })
process.env.EVIDENCE_DIR = evidenceDir

const PERF_PROPS = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: false, cpuCores: '5-8', memoryGb: '8plus' }
const LOCALES = ['zh-CN', 'en']

let failed = null
for (const locale of LOCALES) {
  let close
  let fixture
  try {
    const dir = path.join(tempRoot, locale)
    const settingsDir = path.join(dir, 'settings')
    fs.mkdirSync(settingsDir, { recursive: true })
    // 旧版本写下的文件：开着、没有 scopeVersion 这一格。
    fs.writeFileSync(path.join(settingsDir, 'telemetry-settings.json'), JSON.stringify({ schemaVersion: 1, enabled: true, endpointMode: 'aptabase', consentedAt: '2026-09-20T00:00:00.000Z', installSessionId: 'legacySession0123456789' }))
    // 未接文本模型时，Agent 显示接入卡。为已接入的旧用户种一个回环模型，才能走到同意卡。
    fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
    let win
    ;({ close, win } = await launchNomiApp({
      name: `scope-reconfirm-${locale}`,
      userDataDir: path.join(dir, 'user-data'),
      settingsDir,
      projectsDir: path.join(dir, 'projects'),
      env: { NOMI_TEST_NETWORK_GUARD: '1' },
      initialLocalStorage: {
        'nomi:locale:v1': locale,
        'nomi:agent-consent-asked:v1': 'asked',
        'nomi:splash:v1': 'seen',
        'nomi:journey-tour:v1': 'seen',
        'nomi:canvas-gesture-hint:v1': 'seen',
      },
    }))
    await win.waitForFunction(() => Boolean(window.nomiDesktop?.settings?.telemetry))

    const before = await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())
    expect(before.enabled, '预埋的旧设置应当是开着的').toBe(true)
    expect(before.scopeVersion, '旧设置里没有范围版本，读出来应当是 1').toBe(1)

    await createBlankProject(win)
    await ensureAgentPanelOpen(win)
    const empty = win.locator(AGENT_PANEL).locator('[data-v4-block="empty"]')
    await expect(empty).toBeVisible()
    const card = empty.locator('[data-v4-block="consent"]')
    const proof = await proveProbe(card, '已同意旧范围的用户能看到再确认卡')
    expect(await card.getAttribute('data-v4-consent-mode'), '应当是 scope 形态，不是首次询问卡').toBe('scope')
    await screenshotSettled(card, { path: path.join(evidenceDir, `${locale}-scope-card.png`) })

    const queuedBefore = await win.evaluate((props) => window.nomiDesktop.telemetry.track({ eventName: 'perf.session.summary', props }), PERF_PROPS)
    expect(queuedBefore.queued, '确认之前新范围的事件不许入队').toBe(false)

    // 按钮按词典里的名字认，不抄文案。
    await card.getByRole('button', { name: uiText(locale, 'agentPanelV4.consent.scopeAccept'), exact: true }).click()
    await expect.poll(async () => (await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())).scopeVersion, { timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
    const after = await win.evaluate(() => window.nomiDesktop.settings.telemetry.get())
    expect(after.scopeVersion, '点同意后范围版本应升到 2').toBe(2)
    const queuedAfter = await win.evaluate((props) => window.nomiDesktop.telemetry.track({ eventName: 'perf.session.summary', props }), PERF_PROPS)
    expect(queuedAfter.queued, '确认之后新范围的事件应当入队').toBe(true)
    const summary = await win.evaluate(() => window.nomiDesktop.settings.telemetry.summary())
    const names = [...summary.pending, ...summary.sent].map((item) => item.eventName)
    expect(names, '本机待发 / 已发摘要里应当有 perf.session.summary').toContain('perf.session.summary')

    await win.reload()
    await ensureAgentPanelOpen(win)
    await expect(empty).toBeVisible()
    await expectAbsent(card, { provenBy: proof, message: '确认过的用户重载后又被弹了卡' })
    await screenshotSettled(win, { path: path.join(evidenceDir, `${locale}-after-confirm.png`) })
    fixture.assertClean()
    expect(fixture.requests, '遥测确认不调用文本模型').toHaveLength(0)
    expect(fixture.images, '遥测确认不调用图片模型').toHaveLength(0)
    console.log(`✅ ${locale}: 再确认卡出现 → 确认前不入队 → 确认后升到范围 2 并入队 → 重载不再弹`)
  } catch (error) {
    failed = error
  } finally {
    try {
      await close?.()
    } finally {
      await fixture?.close()
    }
  }
  if (failed) break
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
