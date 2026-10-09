// 设置 → 关于：更新入口截图走查（屏外 Electron、隔离资料目录，不连任何更新服务器）。
// 「改后」：关于页只报一句状态 + 「查看」，点「查看」打开共享的更新弹窗；
// 「改前」（BEFORE=1，在 origin/main 的构建上跑）：关于页自带下载 / 重启 / 重试 / 发版说明那一整套。
// 用法：SHOT_DIR=<目录> [BEFORE=1] node tests/ux/about-update-entry.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = path.resolve(process.env.SHOT_DIR || path.join(repoRoot, 'tests/ux/shots/about-update-entry'))
const before = process.env.BEFORE === '1'
fs.mkdirSync(shotDir, { recursive: true })

const digest = (title, items) => ({ title, groups: [{ heading: null, items }], hiddenGroups: 0 })
const notes = {
  version: '0.99.0',
  platforms: null,
  zh: digest('逐张确认，说到做到', ['每张单独决定', '中途点 × 就停', '提交卡住会超时']),
  en: digest('Confirm each shot one by one', ['Decide per shot', 'Closing stops it at once', 'Submits time out']),
}
const oldNotes = '# Nomi v0.99.0 — 逐张确认，说到做到\n\n## 修了什么\n\n- **每张单独决定**：确认卡上每张都可以选\n- **中途点 × 就停**：停下后照实告诉你\n'
const payload = before
  ? { type: 'available', version: '0.99.0', notes: oldNotes }
  : { type: 'available', version: '0.99.0', notes: [notes], sizeBytes: 90 * 1024 * 1024, releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/tag/v0.99.0' }

const configs = before
  ? [{ name: 'before-zh-light', locale: 'zh-CN', scheme: 'light' }]
  : [{ name: 'after-zh-light', locale: 'zh-CN', scheme: 'light' }, { name: 'after-en-dark', locale: 'en', scheme: 'dark' }]

for (const config of configs) {
  const { app, win, close } = await launchNomiApp({
    name: `about-update-${config.name}`,
    settleMs: 0,
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': config.scheme, 'nomi:locale:v1': config.locale, __nomiE2E: '1' },
  })
  try {
    await win.waitForLoadState('domcontentloaded')
    await expectVisible(win.locator('.nomi-library-page__main'), '项目库页已渲染')
    const send = () => app.evaluate(({ BrowserWindow }, event) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('nomi:update:event', event)
    }, payload)
    // 改前的更新状态只活在「关于」页自己那一份里（事件一次性广播、晚打开的页面看不到），所以先打开再发事件；
    // 改后的状态由主进程持有，先发后开也看得到。
    if (!before) await send()
    await win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click()
    await win.locator('[data-settings-tab-id="about"]').click()
    if (before) await send()
    await win.getByText(/0\.99\.0/).first().waitFor()
    await win.screenshot({ path: path.join(shotDir, `${config.name}-about.png`) })
    if (!before) {
      await win.getByRole('button', { name: /^(查看|View)$/ }).click()
      await expectVisible(win.locator('[data-updater-dialog]'), '点「查看」后更新弹窗打开')
      await win.screenshot({ path: path.join(shotDir, `${config.name}-dialog.png`) })
    }
  } finally {
    await close()
  }
}
console.log(JSON.stringify({ ok: true, shotDir, before }))
