// 真实宿主走查（屏外 Electron、隔离资料目录）：应用内更新提醒的两个项目库通知位。
// 主进程是真的：提醒记忆文件（update-reminder.json）的读写、启动时「已更新」卡的生成、快照与 ✕ 的 IPC 都走真实实现；
// 只有「发现新版」这一下由测试从主进程往窗口发 `nomi:update:event`（开发构建没有真实更新源，不连任何更新服务器、不下载、不安装）。
//
// 断言：
//   ① Mac-only 的热修说明在 Windows 上不出横幅（胶囊仍在）；适用本平台的热修出横幅；
//   ② 横幅 ✕ 之后，整个 App 重启再来同一个事件，横幅仍不出现；
//   ③ 跳版更新后的「从 0.22.5 更新到 x」卡只出一次：✕ 之后重启不再出现。
// 用法：node tests/ux/update-reminder-host.walk.mjs（先 pnpm run build）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { launchNomiApp } from './_launchApp.mjs'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { expectAbsent, expectVisible, proveProbe } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const currentVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const tempRoot = makeTempDir('nomi-update-host-')
const settingsDir = path.join(tempRoot, 'settings')
const memoryFile = path.join(settingsDir, 'update-reminder.json')
const shots = path.join(repoRoot, 'tests', 'ux', 'shots', 'update-reminder-host')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(shots, { recursive: true })

const digest = (title, heading, items) => ({ title, groups: [{ heading, items }], hiddenGroups: 0 })
const notes = (version, platforms, zhTitle) => ({
  version,
  platforms,
  zh: digest(zhTitle, '修了什么', [`${zhTitle}一`, `${zhTitle}二`]),
  en: digest(`${zhTitle} (en)`, 'What changed', [`${zhTitle} one`, `${zhTitle} two`]),
})
const macOnly = notes('0.99.1', ['darwin'], '只给 Mac 的热修')
const everywhere = notes('0.99.2', null, '所有平台的热修')

// 上次运行是 0.22.5、同意更新时记下了 (0.22.5, 当前版本] 的说明：启动后应该生成跳版合并卡。
fs.writeFileSync(memoryFile, JSON.stringify({
  version: 1,
  lastRunVersion: '0.22.5',
  dismissedBanners: [],
  pending: { fromVersion: '0.22.5', toVersion: currentVersion, notes: [notes(currentVersion, null, '本次更新的标题'), notes('0.23.0', null, '上一版的标题')] },
  updatedCard: null,
}))

async function launch(name) {
  const handle = await launchNomiApp({
    name,
    tempRoot,
    settleMs: 0,
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light', __nomiE2E: '1' },
  })
  await handle.win.waitForLoadState('domcontentloaded')
  await expectVisible(handle.win.locator('.nomi-library-page__main'), '项目库页已渲染')
  return handle
}

const sendAvailable = (app, version, noteList) => app.evaluate(({ BrowserWindow }, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('nomi:update:event', payload)
}, { type: 'available', version, notes: noteList, sizeBytes: 90 * 1024 * 1024, releaseUrl: `https://github.com/aqm857886159/Nomi/releases/tag/v${version}` })

const results = []
const check = (name, ok) => { results.push({ name, ok }); assert.ok(ok, name) }
const CARD = '[data-update-updated-card]'
const BANNER = '[data-update-hotfix-banner]'
const PILL = '[data-update-badge]'

try {
  // ── 第一次启动：跳版合并卡出现 ───────────────────────────────────────────────
  let { app, win } = await launch('update-host-1')
  await expectVisible(win.locator(CARD), '启动后出现「已更新」卡')
  const cardProof = await proveProbe(win.locator(CARD), '「已更新」卡的探针能找到它')
  const cardText = await win.locator(CARD).innerText()
  check('updated-card-merged-range', /0\.22\.5/.test(cardText) && cardText.includes(currentVersion))
  check('updated-card-headline-and-items', /本次更新的标题/.test(cardText) && /本次更新的标题一/.test(cardText))
  await win.screenshot({ path: path.join(shots, '01-updated-card.png') })
  await win.locator(`${CARD} button[aria-label]`).first().click()
  await expectAbsent(win.locator(CARD), { provenBy: cardProof, message: '✕ 之后卡片消失' })

  // ── 适用本平台的热修：横幅出现 ───────────────────────────────────────────────
  await sendAvailable(app, '0.99.2', [everywhere])
  await expectVisible(win.locator(`${BANNER}[data-update-hotfix-banner="0.99.2"]`), '适用本平台的热修出横幅')
  const bannerProof = await proveProbe(win.locator(BANNER), '横幅的探针能找到它')
  check('applicable-hotfix-shows-banner', /所有平台的热修/.test(await win.locator(BANNER).innerText()))
  await win.screenshot({ path: path.join(shots, '03-hotfix-banner.png') })

  // ── Mac-only 热修在 Windows 上：胶囊有，横幅没有 ─────────────────────────────
  await sendAvailable(app, '0.99.1', [macOnly])
  await expectVisible(win.locator(PILL), 'Mac-only 热修在本平台仍有胶囊')
  await expectAbsent(win.locator(BANNER), { provenBy: bannerProof, message: 'Mac-only 的热修说明在 Windows 上不出横幅' })
  await win.screenshot({ path: path.join(shots, '02-mac-only-hotfix-no-banner.png') })

  // ── 回到适用本平台的热修，✕ 后消失 ──────────────────────────────────────────
  await sendAvailable(app, '0.99.2', [everywhere])
  await expectVisible(win.locator(BANNER), '适用本平台的热修在 ✕ 之前仍在')
  await win.locator(`${BANNER} button[aria-label]`).first().click()
  await expectAbsent(win.locator(BANNER), { provenBy: bannerProof, message: '✕ 之后横幅消失' })
  await app.close()

  // ── 重启：✕ 过的横幅不再出，「已更新」卡也不再出 ─────────────────────────────
  ;({ app, win } = await launch('update-host-2'))
  await expectAbsent(win.locator(CARD), { provenBy: cardProof, message: '「已更新」卡只出一次，重启不再出现' })
  await sendAvailable(app, '0.99.3', [notes('0.99.3', null, '另一个热修')])
  await expectVisible(win.locator(BANNER), '没 ✕ 过的另一个热修会出横幅（证明重启后横幅机制是活的）')
  await sendAvailable(app, '0.99.2', [everywhere])
  await expectVisible(win.locator(PILL), '胶囊仍在')
  await expectAbsent(win.locator(BANNER), { provenBy: bannerProof, message: '✕ 过的横幅重启后仍不出现' })
  await win.screenshot({ path: path.join(shots, '04-after-restart-no-banner.png') })
  const persisted = JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
  check('memory-file-records-dismissal', persisted.dismissedBanners.includes('0.99.2') && persisted.updatedCard === null)
  await app.close()
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2))
} finally {
  cleanupTestTemp(tempRoot)
}
