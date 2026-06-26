// 模型接入面板 R13 走查 —— 已接入/可接入分层 + 方案2分组折叠 + 自适应默认（2026-06-25）。
// 用法: node tests/ux/model-onboarding.walk.mjs
// 产出: tests/ux/shots/onboarding/*.png —— 人眼判断分层/折叠/自适应默认/连通后浮顶。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/onboarding')
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-onboarding-userdata')
fs.rmSync(userData, { recursive: true, force: true }) // 干净新用户态
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

async function openPanel(win) {
  const trigger = win.locator('button', { hasText: '模型接入' }).first()
  if (await trigger.count()) await trigger.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(800)
  return (await win.locator('text=模型设置').count()) > 0
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

// 清场：跳过 splash + 引导旅途。
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForTimeout(1200)
for (let i = 0; i < 6; i++) {
  const skip = win.locator('button, [role="button"], a', { hasText: /跳过|开始创作|进入|完成/ }).first()
  if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(350)
}

// 注意：本机 catalog 在隔离 userData 内，但即梦登录态/编程助手 MCP 配置在 userData 外（全局），
// 故本机通常有「已接入」项（即梦/编程助手）。不写 vendor key（避免污染 + 非必要）。
console.log('— 默认态：已接入浮顶 + 可接入「接入生成模型」自适应折叠（有已接入 → 收起）—')
if (!(await openPanel(win))) { console.log('  ✗ 面板没打开'); await app.close(); process.exit(1) }
await win.waitForTimeout(900) // 等异步即梦状态落定 + loaded 门
await snap(win, 'default-connected-top-available-collapsed') // 期望：「接入生成模型」默认收起（非展开）

console.log('— 点开「接入生成模型」组 → 露出 5 个待接入 vendor + 添加按钮 —')
const genHeader = win.locator('button', { hasText: '接入生成模型' }).first()
if (await genHeader.count()) { await genHeader.click({ timeout: 2500 }).catch(() => {}); await win.waitForTimeout(500) }
await snap(win, 'gen-group-expanded')

console.log('— 展开「有即梦会员？」「接入编程助手」组（若在可接入里）—')
for (const title of ['有即梦会员？', '接入编程助手 · 可选']) {
  const h = win.locator('button', { hasText: title }).first()
  if (await h.count()) { await h.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(400) }
}
await snap(win, 'all-groups-expanded')

console.log('— 暗色 —')
await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'dark'))
await win.reload()
await win.waitForTimeout(1300)
for (let i = 0; i < 4; i++) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300) }
if (await openPanel(win)) await snap(win, 'dark-connected-and-available')

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
await app.close()
