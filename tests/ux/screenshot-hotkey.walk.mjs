// R13 走查 —— 全局截图热键（SHUO backlog 第 7 项）。
// 用法: node tests/ux/screenshot-hotkey.walk.mjs   产出: tests/ux/shots/screenshot-hotkey/*.png
//
// ⚠️ 诚实边界：**全局热键本身没法在这里按**（Playwright 只能往窗口里发键，发不出 OS 级全局按键）。
// 所以这条走查分两段各自验真：
//   ① 设置面板 → 真开关 → 主进程真 globalShortcut.register，用 electron.evaluate 读主进程状态对账；
//   ② 抓屏落地链路 → 直接调主进程的 captureScreenToCanvas（热键回调调的就是它），验「抓到 → 选区面板 → 落节点」。
// 热键那一下真按下去的手感，留给用户在真机上试——这里不假装验过。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/screenshot-hotkey')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-screenshot-userdata')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
const fail = []
function check(name, ok, detail) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
async function snap(win, name, clip) {
  n += 1
  await win.screenshot({ path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`), ...(clip ? { clip } : {}) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

const { app, win } = await launchNomiApp({
  name: 'screenshot-hotkey',
  userDataDir: userData,
  settingsDir: userData,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
await win.evaluate(() => {
  window.localStorage.setItem('__nomiE2E', '1')
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2200)
for (const label of ['新建空白项目', '开始一个项目']) {
  const el = win.locator('button', { hasText: label }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); break }
}
await win.waitForTimeout(2500)
const genTab = win.locator('button', { hasText: /^生成$/ }).first()
if (await genTab.count()) await genTab.click({ timeout: 5000 }).catch(() => {})
await win.waitForTimeout(2000)

// ── ① 默认必须是关的（拍板：不默认抢用户的全局键、不默认弹权限框）
const bootStatus = await app.evaluate(async ({ globalShortcut }) => ({
  anyRegistered: globalShortcut.isRegistered('Alt+Shift+Q'),
}))
console.log('  → 启动后主进程:', JSON.stringify(bootStatus))
check('默认没注册任何全局键（默认关）', bootStatus.anyRegistered === false, JSON.stringify(bootStatus))

// 打开设置 → 通用
await win.locator('[aria-label="设置"], [title="设置"]').first().click({ timeout: 6000 }).catch(async () => {
  await win.locator('button:has(svg)').filter({ hasText: '' }).nth(0).click().catch(() => {})
})
await win.waitForTimeout(1200)
const dialog = win.locator('[role="dialog"][aria-label="设置"]').first()
check('设置面板打开了', await dialog.count() > 0)
await dialog.locator('button', { hasText: '通用' }).first().click({ timeout: 5000 })
await win.waitForTimeout(900)
await snap(win, 'settings-general-off')
{
  const box = await dialog.boundingBox().catch(() => null)
  if (box) await snap(win, 'settings-general-off-zoom', { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 })
}
const sectionText = await dialog.textContent().catch(() => '')
check('通用页有「全局截图热键」这一节', /全局截图热键/.test(sectionText || ''), (sectionText || '').slice(0, 60))
check('说清了默认关 + macOS 要屏幕录制权限', /默认关/.test(sectionText || '') && /屏幕录制/.test(sectionText || ''))

// ── ② 打开开关 → 主进程必须真的注册上
// Mantine 的 Switch 真 input 是视觉隐藏的（点不到）→ 点它的 track。
const toggle = dialog.locator('.mantine-Switch-track').first()
await toggle.click({ timeout: 5000 })
await win.waitForTimeout(2000)
const afterOn = await app.evaluate(async ({ globalShortcut }) => ({
  q: globalShortcut.isRegistered('Alt+Shift+Q'),
}))
console.log('  → 开关打开后主进程:', JSON.stringify(afterOn))
check('打开开关 → 主进程真的 register 了 ⌥⇧Q（不是只改了个 UI 状态）', afterOn.q === true, JSON.stringify(afterOn))
await snap(win, 'settings-general-on')
{
  const box = await dialog.boundingBox().catch(() => null)
  if (box) await snap(win, 'settings-general-on-zoom', { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 })
}

// 未授权时必须给人话 + 指路（macOS 上大概率就是未授权状态）
const onText = await dialog.textContent().catch(() => '')
const screenAccess = await app.evaluate(async ({ systemPreferences }) => {
  try { return process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted' } catch { return 'unknown' }
})
console.log('  → 屏幕录制权限:', screenAccess)
if (screenAccess !== 'granted') {
  check('未授权时给了人话 + 指路系统设置（不静默失败）',
    /屏幕录制/.test(onText) && /系统设置/.test(onText), onText.slice(-140))
} else {
  console.log('  · 本机已授权，跳过「未授权提示」这条')
}

// ── ③ 换键 → 旧键必须撤掉（不撤会越占越多）
await dialog.locator('[data-screenshot-accelerator="Alt+Shift+S"]').first().click({ timeout: 5000 })
await win.waitForTimeout(2000)
const afterSwitch = await app.evaluate(async ({ globalShortcut }) => ({
  q: globalShortcut.isRegistered('Alt+Shift+Q'),
  s: globalShortcut.isRegistered('Alt+Shift+S'),
}))
console.log('  → 换键后:', JSON.stringify(afterSwitch))
check('换键后新键注册上了', afterSwitch.s === true, JSON.stringify(afterSwitch))
check('换键后**旧键撤掉了**（不撤会一直占着用户的键）', afterSwitch.q === false, JSON.stringify(afterSwitch))

// ── ④ 关掉 → 必须真撤
await toggle.click({ timeout: 5000 })
await win.waitForTimeout(2000)
const afterOff = await app.evaluate(async ({ globalShortcut }) => ({
  q: globalShortcut.isRegistered('Alt+Shift+Q'),
  s: globalShortcut.isRegistered('Alt+Shift+S'),
}))
console.log('  → 关掉后:', JSON.stringify(afterOff))
check('关掉开关 → 全局键真的还给系统了', afterOff.q === false && afterOff.s === false, JSON.stringify(afterOff))

await win.keyboard.press('Escape')
await win.waitForTimeout(800)

// ── ⑤ 抓屏落地链路（热键回调调的就是这个函数）
if (screenAccess === 'granted') {
  // 热键回调调的就是 captureScreenToCanvas。全局热键是 OS 级按键、Playwright 发不出去，
  // 所以走 NOMI_E2E 门禁下的那个入口去调**同一个函数**（不是另写一条测试逻辑）。
  const callResult = await win.evaluate(async () => {
    try {
      await window.nomiDesktop.screenshot.e2eCapture()
      return 'ok'
    } catch (error) { return String(error).slice(0, 160) }
  })
  console.log('  → 直调抓屏:', callResult)
  await win.waitForTimeout(4000)
  const overlay = await win.evaluate(() => Boolean(document.querySelector('[data-screenshot-crop]')))
  check('抓完弹出选区面板', overlay)
  await snap(win, 'crop-overlay')
  if (overlay) {
    const before = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
    await win.locator('[data-screenshot-commit]').first().click({ timeout: 5000 })
    await win.waitForTimeout(4000)
    const after = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
    check('确认后落成画布节点', after - before === 1, `${before} → ${after}`)
    await snap(win, 'node-landed')
  }
} else {
  console.log('  · 本机没有屏幕录制权限 → 抓屏链路这段跳过（这正是它该有的行为：不硬跑、不假装成功）')
}

await app.close()
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : '\n✅ 全部达标')
process.exit(fail.length ? 1 : 0)
