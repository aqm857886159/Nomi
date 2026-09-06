// R8 前置：把「组 / 选择浮条 / 节点浮条 / 提示词 composer + @ 弹层」的**真实样子**拍下来，
// 样张才能是「真实布局 + 改动」而不是脑补（CLAUDE.md 三闸①）。
// 用法: node tests/ux/group-baseline.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/group-baseline')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-groupbase-userdata')
fs.mkdirSync(userData, { recursive: true })

let n = 0
async function snap(win, name, clip) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`), ...(clip ? { clip } : {}) })
  console.log(`  · shot ${tag}`)
}
async function snapNear(win, name, locator, pad = 40) {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) { console.error(`  ⚠️ 找不到 ${name} 的盒子`); return null }
  await snap(win, name, {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(1400, box.width + pad * 2), height: Math.min(900, box.height + pad * 2),
  })
  return box
}

const { app, win } = await launchNomiApp({
  name: 'group-baseline',
  userDataDir: userData,
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
await win.waitForTimeout(2500)

// 左缘加节点收口在 _canvasRail（结构锚点，不认走 i18n 的 aria-label），找不到当场抛。
try {
  for (let i = 0; i < 4; i += 1) { await addCanvasNodeFromRail(win, 'image', { timeout: 4000 }); await win.waitForTimeout(280) }
} catch (error) { console.error('❌ 画布左缘加不出图片节点', error?.message || error); await app.close(); process.exit(1) }
await win.waitForTimeout(900)
await snap(win, 'canvas-4-nodes')

// 全选 → 选择浮条（真实样子：计数 + 生成 N + 编组 + 关闭）
await win.locator('.generation-canvas-v2, [data-canvas-stage]').first().click({ position: { x: 40, y: 40 } }).catch(() => {})
await win.keyboard.press('Control+a')
await win.waitForTimeout(600)
const toolbar = win.locator('.generation-canvas-v2__selection-toolbar').first()
await snapNear(win, 'selection-toolbar-real', toolbar, 24)

// 编组 → 组框 + 标签胶囊的真实样子
const groupBtn = win.locator('[aria-label^="创建分组"]').first()
if (!(await groupBtn.count())) { console.error('❌ 找不到「创建分组」按钮'); await app.close(); process.exit(1) }
await groupBtn.click({ timeout: 4000 })
await win.waitForTimeout(900)
await snap(win, 'canvas-grouped')
const groupBox = win.locator('.generation-canvas-v2__group-box').first()
await snapNear(win, 'group-frame-real', groupBox, 30)
const groupLabel = win.locator('.generation-canvas-v2__group-box-label').first()
await snapNear(win, 'group-label-real', groupLabel, 16)

// 单选一个节点 → composer 的真实样子
await win.keyboard.press('Escape')
await win.waitForTimeout(300)
const firstNode = win.locator('[data-node-id]').first()
await firstNode.click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(900)
await snap(win, 'canvas-node-selected')
const composer = win.locator('.generation-canvas-v2 [class*="min-h-\\[150px\\]"]').first()
const cbox = await composer.boundingBox().catch(() => null)
if (cbox) {
  await snap(win, 'composer-real', {
    x: Math.max(0, cbox.x - 20), y: Math.max(0, cbox.y - 20),
    width: cbox.width + 40, height: cbox.height + 40,
  })
} else {
  console.error('  ⚠️ composer 盒子没读到，改拍整窗下半')
}

// 节点浮动工具栏（图片节点的那条，@ 与抽帧共用同一 shell）
const nodeToolbar = win.locator('[role="toolbar"]').first()
await snapNear(win, 'node-floating-toolbar-real', nodeToolbar, 20)

// @ 弹层（无参考图时的空态）
const editor = win.locator('.ProseMirror').first()
if (await editor.count()) {
  await editor.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(300)
  await win.keyboard.type('@')
  await win.waitForTimeout(700)
  await snap(win, 'mention-popup-empty')
}

// 组框的几何/配色实测（mockup 要用真值）
const facts = await win.evaluate(() => {
  const box = document.querySelector('.generation-canvas-v2__group-box')
  const label = document.querySelector('.generation-canvas-v2__group-box-label')
  const cs = box ? getComputedStyle(box) : null
  const ls = label ? getComputedStyle(label) : null
  return {
    groupBorder: cs?.borderColor, groupBg: cs?.backgroundColor, groupRadius: cs?.borderRadius,
    labelBg: ls?.backgroundColor, labelColor: ls?.color, labelFont: ls?.font, labelText: label?.textContent,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--nomi-accent').trim(),
  }
})
console.log('  → 组框实测:', JSON.stringify(facts, null, 2))
fs.writeFileSync(path.join(shotsDir, 'facts.json'), JSON.stringify(facts, null, 2))

await app.close()
console.log('✅ 基线截图完成 →', shotsDir)
