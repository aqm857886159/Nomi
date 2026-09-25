// 一次性：拍「模型接入」面板真实样子（出样张前必须先看真实 UI，零额度零 vendor 调用）。
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { realNomiProfile, seedRealCredentials } from '../tests/ux/_realProfile.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.model-panel-shot')
mkdirSync(outDir, { recursive: true })

const settings = path.join(os.tmpdir(), 'nomi-panelshot-settings')
const projects = path.join(os.tmpdir(), 'nomi-panelshot-projects')
mkdirSync(settings, { recursive: true })
mkdirSync(projects, { recursive: true })
// 用真实 dev catalog：要看「已接入」分组真实长什么样，空 catalog 只能看到「可接入」。
// 凭据钥匙（Windows 的 Local State）跟目录一起进隔离副本，user-data 与启动器默认同形、只是先建出来。
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'model-panel-shot-'))
const userDataDir = path.join(tempRoot, 'user-data')
if (existsSync(realNomiProfile().catalogPath)) seedRealCredentials({ settingsDir: settings, userDataDir })

const { app, win } = await launchNomiApp({
  name: 'model-panel-shot',
  tempRoot,
  userDataDir,
  settingsDir: settings,
  projectsDir: projects,
  settleMs: 2000,
})
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await win.waitForTimeout(1500)
  await win.screenshot({ path: path.join(outDir, '01-full.png') })

  const panel = win.locator('[role="dialog"]').first()
  await panel.screenshot({ path: path.join(outDir, '02-panel.png') })
  const box = await panel.boundingBox()
  console.log('  面板几何：', JSON.stringify(box))

  // 展开「接入生成模型」那组，看组内真实内容
  const groups = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"] button[aria-expanded]')).map((b) => ({
      text: (b.textContent || '').trim().slice(0, 40),
      expanded: b.getAttribute('aria-expanded'),
    })),
  )
  console.log('  可折叠项：', JSON.stringify(groups, null, 0))
  const structure = await win.evaluate(() => {
    const root = document.querySelector('[role="dialog"]')
    return root ? (root.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 700) : null
  })
  console.log('\n  面板文本：', structure)
} catch (e) {
  console.log('  ✗ ' + String(e).slice(0, 300))
} finally {
  await app.close().catch(() => {})
}
