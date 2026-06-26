// 暗黑模式 R13 走查 —— Playwright _electron 驱动真 app（隔离 userData 绕开打包版单实例锁）。
// 用法: NOMI_UI_USER_DATA=/tmp/nomi-dark node tests/ux/dark-mode.walk.mjs
// 产出: tests/ux/shots/dark/*.png —— light/dark 两版对照，人眼判断有无塌陷/低对比/残留亮块。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/dark')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = process.env.NOMI_UI_USER_DATA || path.join(repoRoot, '.tmp', 'nomi-dark-userdata')
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

async function setScheme(win, scheme) {
  await win.evaluate((s) => {
    window.localStorage.setItem('nomi-color-scheme', s)
    // 压掉首启 splash + 引导旅途（否则自动回放挡住导航）。
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(k, 'seen')
    }
  }, scheme)
  await win.reload()
  await win.waitForTimeout(900)
  const applied = await win.evaluate(() => document.documentElement.getAttribute('data-mantine-color-scheme'))
  console.log(`  → requested ${scheme}, document=`, applied)
}

async function clickByText(win, sel, text) {
  const el = win.locator(sel, { hasText: text }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); return true }
  return false
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${userData}`],
  cwd: repoRoot,
  env: { ...process.env },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)

console.log('— LIGHT baseline —')
await setScheme(win, 'light')
await snap(win, 'library-light')

console.log('— DARK —')
await setScheme(win, 'dark')

// 彻底清场：跳过 splash + 引导旅途（首启新 userData 会挡住导航）。
async function dismissOnboarding() {
  for (let i = 0; i < 8; i++) {
    const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) { await skip.click({ timeout: 1500 }).catch(() => {}) }
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(450)
  }
}
await dismissOnboarding()
await win.waitForTimeout(600)
await snap(win, 'library-dark')

// 生成画布（节点系统）——最复杂的暗色主表面。示例项目已加载于顶栏。
if (await clickByText(win, 'button, [role="button"], [role="tab"]', '生成')) {
  await win.waitForTimeout(1400); await snap(win, 'generation-canvas-dark')
}
// 预览/时间轴
if (await clickByText(win, 'button, [role="button"], [role="tab"]', '预览')) {
  await win.waitForTimeout(1200); await snap(win, 'preview-timeline-dark')
}
// 技能库面板（AppBar 新入口）
if (await win.locator('[aria-label*="技能"]').first().count()) {
  await win.locator('[aria-label*="技能"]').first().click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(800); await snap(win, 'skill-library-dark')
  await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400)
}
// 提示词库（消费 --nomi-scrim/overlay/media-veil —— 本次补的 token）
if (await clickByText(win, 'button, [role="button"]', '提示词库')) {
  await win.waitForTimeout(800); await snap(win, 'prompt-library-dark')
  await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400)
}
// 模型接入页（Seedance/豆包接入卡）
if (await clickByText(win, 'button, [role="button"]', '模型接入')) {
  await win.waitForTimeout(1000); await snap(win, 'model-onboarding-dark')
  await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400)
}
// About 弹层（含我新加的「外观」切换行）—— 点 Nomi 文字标志/版本
for (const sel of ['[aria-label*="关于"]', 'text=Nomi', '[data-nomi-about]']) {
  const b = win.locator(sel).first()
  if (await b.count()) { await b.click({ timeout: 2500 }).catch(() => {}); await win.waitForTimeout(600); break }
}
await snap(win, 'about-popover-dark')

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
await app.close()
