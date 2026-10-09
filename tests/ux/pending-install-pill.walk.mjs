// 「上次没装上 · 点一下重试」胶囊截图走查（屏外 Electron、隔离资料目录；首启引导已标成看过，胶囊不被挡）。
// 开发构建不是打包版，启动时的「从磁盘恢复待装记录」只在打包版跑，所以这里把恢复后主进程会广播的两个事件
// （有新版 + 安装阶段出错）直接发给窗口——界面渲染的就是那个状态；恢复逻辑本身由 autoUpdater.flow.test.ts 的跨进程用例证明。
// 磁盘上预置了真实的 pendingInstall 记录（目标版本高于当前、缓存包文件存在）。
// 用法：SHOT_DIR=<目录> node tests/ux/pending-install-pill.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { expectVisible } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotDir = path.resolve(process.env.SHOT_DIR || path.join(repoRoot, 'tests/ux/shots/pending-install-pill'))
fs.mkdirSync(shotDir, { recursive: true })

const configs = [
  { name: 'zh-light', locale: 'zh-CN', scheme: 'light' },
  { name: 'en-dark', locale: 'en', scheme: 'dark' },
]

for (const config of configs) {
  const tempRoot = makeTempDir('nomi-pending-install-')
  const settingsDir = path.join(tempRoot, 'settings')
  fs.mkdirSync(settingsDir, { recursive: true })
  const cacheFile = path.join(tempRoot, 'Nomi-Setup-0.99.0.exe')
  fs.writeFileSync(cacheFile, 'installer')
  const currentVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
  fs.writeFileSync(path.join(settingsDir, 'update-reminder.json'), JSON.stringify({
    version: 1, lastRunVersion: currentVersion, dismissedBanners: [], pending: null, updatedCard: null,
    pendingInstall: { version: '0.99.0', file: cacheFile },
  }))
  const { app, win, close } = await launchNomiApp({
    name: `pending-install-${config.name}`,
    tempRoot,
    settleMs: 0,
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': config.scheme, 'nomi:locale:v1': config.locale, __nomiE2E: '1' },
  })
  try {
    await win.waitForLoadState('domcontentloaded')
    await expectVisible(win.locator('.nomi-library-page__main'), '项目库页已渲染（首启引导已看过，没有遮挡）')
    await app.evaluate(({ BrowserWindow }) => {
      const send = (event) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('nomi:update:event', event) }
      send({ type: 'available', version: '0.99.0', notes: [], sizeBytes: null, releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/tag/v0.99.0' })
      send({ type: 'error', message: '', stage: 'install', reason: 'other' })
    })
    const pill = win.locator('[data-update-badge="error"]')
    await expectVisible(pill, '胶囊显示「上次没装上」')
    await win.screenshot({ path: path.join(shotDir, `pending-install-${config.name}.png`) })
  } finally {
    await close()
    cleanupTestTemp(tempRoot)
  }
}
console.log(JSON.stringify({ ok: true, shotDir }))
