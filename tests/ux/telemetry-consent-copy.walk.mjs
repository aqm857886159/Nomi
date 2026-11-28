// R13 走查：「帮 Nomi 变好」两处说明（设置页 + Agent 面板首次询问卡）补上「失败属于哪一类」，
// 中英各拍一遍，并证明：
//   ① 英文界面里这两处没有混中文；
//   ② 已经开启（且问过）的用户不会再弹一张新的同意卡——这次只改说明文字，不碰同意合同与「问过了」标记。
// 用法：先 pnpm run build，再 node tests/ux/telemetry-consent-copy.walk.mjs
//       EVIDENCE_DIR=<目录> 指定截图落点
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { createBlankProject, ensureAgentPanelOpen } from './_shell.mjs'
import { expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const evidenceDir = process.env.EVIDENCE_DIR || path.join(repoRoot, 'tests/ux/shots/telemetry-consent-copy')
fs.mkdirSync(evidenceDir, { recursive: true })
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-telemetry-consent-copy')
fs.rmSync(tempRoot, { recursive: true, force: true })

const LOCALES = [
  { locale: 'zh-CN', settings: /设置/, general: '通用', newProject: /新建空白项目/, accept: '愿意', needle: '卡不卡' },
  { locale: 'en', settings: /Settings/, general: 'General', newProject: /New blank project/, accept: 'I’m in', needle: 'smooth' },
]
const CJK = /[㐀-鿿]/

let failed = null
for (const spec of LOCALES) {
  let app
  let fixture
  try {
    const dir = path.join(tempRoot, spec.locale)
    const opts = { userDataDir: path.join(dir, 'user-data'), settingsDir: path.join(dir, 'settings'), projectsDir: path.join(dir, 'projects') }
    fs.mkdirSync(opts.settingsDir, { recursive: true })
    // 未接文本模型时 Agent 空态展示接入引导卡；种回环文本模型才能走到 V4EmptyState 与遥测询问卡。
    fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir: opts.settingsDir })
    let win
    ;({ app, win } = await launchNomiApp({ name: `consent-copy-${spec.locale}`, ...opts, settleMs: 0 }))
    await win.evaluate((locale) => {
      localStorage.setItem('nomi:locale:v1', locale)
      for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
    }, spec.locale)
    await win.reload()
    await win.waitForTimeout(1500)
    const snap = (name) => screenshotSettled(win, { path: path.join(evidenceDir, `${spec.locale}-${name}.png`) })

    // 设置页
    await win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click({ timeout: DEFAULT_TIMEOUT_MS })
    await win.getByRole('button', { name: spec.general, exact: true }).click()
    const section = win.locator('[data-settings-section="telemetry"]')
    await section.scrollIntoViewIfNeeded()
    const settingsText = await section.innerText()
    expect(settingsText, `设置页说明缺「${spec.needle}」`).toContain(spec.needle)
    if (spec.locale === 'en') expect(CJK.test(settingsText), `英文设置页说明里混了中文：${settingsText}`).toBe(false)
    await snap('settings-telemetry')
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(300)

    // Agent 面板首次询问卡（UX-A4：全新空白首屏不弹，达成首次生成/对话里程碑后现身）
    await createBlankProject(win)
    await ensureAgentPanelOpen(win)
    const card = win.locator('[data-v4-block="consent"]').first()
    await expect(card, '全新空白首屏不该立即弹出同意卡').toHaveCount(0)
    await win.evaluate(() => {
      localStorage.setItem('nomi:checklist:v1', JSON.stringify({ model: false, storyboard: false, generated: true, exported: false }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'nomi:checklist:v1' }))
    })
    await expect(card, '达成首次生成里程碑后新用户该看到同意卡').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    const proof = await proveProbe(win.locator('[data-v4-block="consent"]'), '新用户能看到同意卡')
    const cardText = await card.innerText()
    expect(cardText, `同意卡缺「${spec.needle}」`).toContain(spec.needle)
    if (spec.locale === 'en') expect(CJK.test(cardText), `英文同意卡里混了中文：${cardText}`).toBe(false)
    await card.screenshot({ path: path.join(evidenceDir, `${spec.locale}-agent-consent-card.png`) })
    await snap('agent-consent-card-in-panel')

    // 已开启且问过的用户：回到该状态后重载，不再弹卡
    await card.getByRole('button', { name: spec.accept, exact: true }).click()
    await win.waitForTimeout(800)
    await win.reload()
    await win.waitForTimeout(2000)
    await expectAbsent(win.locator('[data-v4-block="consent"]'), { provenBy: proof, message: '已开启的用户又被弹了同意卡' })
    await snap('after-enabled-no-new-card')
    console.log(`✅ ${spec.locale}: 两处说明含「${spec.needle}」，已开启用户不再弹卡`)
  } catch (error) {
    failed = error
  } finally {
    await app?.close().catch(() => {})
    await fixture?.close().catch(() => {})
  }
  if (failed) break
}
if (failed) { console.error(`❌ ${failed.message}`); process.exit(1) }
