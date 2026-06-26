// 火山豆包语音「两字段凭证」R13 走查 —— 验 App ID / Access Token 拆成两个独立框（2026-06-25）。
// 用法: node tests/ux/volcengine-speech-credential.walk.mjs
// 产出: tests/ux/shots/volc-speech/*.png —— 人眼判断两个标注框 + 各自说明 + 解锁按钮 + 暗色。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/volc-speech')
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-volc-speech-userdata')
fs.rmSync(userData, { recursive: true, force: true })
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

async function expandAllGroups(win) {
  for (const title of ['接入生成模型', '配音 · 语音', '其他模型', '有即梦会员？', '接入编程助手 · 可选']) {
    const h = win.locator('button', { hasText: title }).first()
    if (await h.count()) { await h.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(350) }
  }
}

// 找到「火山豆包语音」卡 → 点头部展开 body 露出凭证区。
async function openVolcCard(win) {
  const card = win.locator('text=火山豆包语音').first()
  if (!(await card.count())) return false
  await card.scrollIntoViewIfNeeded().catch(() => {})
  await card.click({ timeout: 2500 }).catch(() => {})
  await win.waitForTimeout(500)
  return true
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

console.log('— 打开模型接入面板 + 展开所有组 —')
if (!(await openPanel(win))) { console.log('  ✗ 面板没打开'); await app.close(); process.exit(1) }
await win.waitForTimeout(800)
await expandAllGroups(win)
await snap(win, 'panel-groups-expanded')

console.log('— 展开「火山豆包语音」卡，看凭证区两字段 —')
if (!(await openVolcCard(win))) { console.log('  ✗ 没找到火山豆包语音卡'); await app.close(); process.exit(1) }
// 滚到 Access Token 框（凭证区最底），让两字段 + 解锁按钮 + 说明全进视口。
const tokenInput = win.locator('input[aria-label*="Access Token"]').first()
if (await tokenInput.count()) await tokenInput.scrollIntoViewIfNeeded().catch(() => {})
await win.waitForTimeout(300)
await snap(win, 'volc-card-two-fields')

console.log('— 验空字段校验：只填 App ID（留空 Token）点解锁应报「都要填」—')
const appIdInput = win.locator('input[aria-label*="App ID"]').first()
if (await appIdInput.count()) {
  await appIdInput.fill('1234567890')
  // 解锁按钮限定在火山卡内（页面上别处也有解锁）：取 Access Token 框之后的那个解锁。
  const unlock = win.locator('button', { hasText: '解锁' }).last()
  if (await unlock.count()) { await unlock.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(400) }
  if (await tokenInput.count()) await tokenInput.scrollIntoViewIfNeeded().catch(() => {})
  await snap(win, 'validation-missing-token')
} else {
  console.log('  ⚠ 没定位到 App ID 框（aria-label）')
}

console.log('— 暗色 —')
await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'dark'))
await win.reload()
await win.waitForTimeout(1300)
for (let i = 0; i < 4; i++) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300) }
if (await openPanel(win)) {
  await win.waitForTimeout(600)
  await expandAllGroups(win)
  await openVolcCard(win)
  await snap(win, 'dark-volc-card-two-fields')
}

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shotsDir)}`)
await app.close()
