import { expectComposerFooterHit } from './_composerFixedFooter.mjs'
// R8 前置：把「组 / 选择浮条 / 节点浮条 / 提示词 composer + @ 弹层」的**真实样子**拍下来，
// 样张才能是「真实布局 + 改动」而不是脑补（CLAUDE.md 三闸①）。
// 用法: node tests/ux/group-baseline.walk.mjs
import { launchNomiApp, ACCEPTANCE_WIDE_VIEWPORT } from './_launchApp.mjs'
import { findCanvasBlankPoint, expectNodeInsideCanvas } from './_canvasHit.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, expectVisible, screenshotSettled } from './_assert.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/group-baseline')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

let n = 0
async function snap(win, name, clip) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`), ...(clip ? { clip } : {}) })
  console.log(`  · shot ${tag}`)
}
async function snapNear(win, name, locator, pad = 40) {
  await expectVisible(locator, `${name} 的真实控件已出现`)
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${name} 没有可截图的盒子`)
  await snap(win, name, {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(1400, box.width + pad * 2), height: Math.min(900, box.height + pad * 2),
  })
  return box
}

const { app, win } = await launchNomiApp({
  name: 'group-baseline',
  ...(process.argv.includes('--wide') ? { viewportSize: ACCEPTANCE_WIDE_VIEWPORT } : {}),
  args: ['--no-proxy-server'],
  settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})
await win.getByRole('button', { name: '新建空白项目', exact: false }).first().click()
await win.getByRole('button', { name: '生成', exact: true }).click()

const addImage = win.locator('[aria-label="添加图片节点"]').first()
await expectVisible(addImage, '生成画布已可添加节点')
if (!(await addImage.count())) { console.error('❌ 找不到「添加图片节点」'); await app.close(); process.exit(1) }
let firstCreatedId
for (let i = 0; i < 4; i += 1) {
  await addImage.click({ timeout: 4000 })
  await win.waitForTimeout(280)
  if (!firstCreatedId) {
    firstCreatedId = await win.locator('.generation-canvas-v2-node[data-node-id]').first().getAttribute('data-node-id')
    if (!firstCreatedId) throw new Error('第一张新卡必须有真实 ID，不能把后续可见卡当成首卡')
  }
}
await win.waitForTimeout(900)
await expectNodeInsideCanvas(win, win.locator(`.generation-canvas-v2-node[data-node-id="${firstCreatedId}"]`), '连续建完四张后首卡完整在舞台内')
await snap(win, 'canvas-4-nodes')

// 全选 → 选择浮条（真实样子：计数 + 生成 N + 编组 + 关闭）
const blank = await findCanvasBlankPoint(win)
if (!blank) throw new Error('画布没有可点击的真实空白点')
await win.mouse.click(blank.x, blank.y)
await win.keyboard.press('Control+a')
await expect(win.locator('.generation-canvas-v2-node[data-selected="true"]')).toHaveCount(4)
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

// 先证单选，再取 composer；旧尺寸 class 已退役，等待它只会吞掉定位超时。
await win.getByRole('button', { name: '清除选择', exact: true }).click()
const firstNode = win.locator('.generation-canvas-v2-node[data-node-id]').first()
await firstNode.click({ timeout: 4000 })
await expect(win.locator('.generation-canvas-v2-node[data-selected="true"]')).toHaveCount(1)
await snap(win, 'canvas-node-selected')
const composer = firstNode.locator('.generation-canvas-v2-node__composer-card')
await expectComposerFooterHit(composer, '分组后空提示词')
await snapNear(win, 'composer-real', composer, 20)
// Reference controls may scroll in their own area after recommendations yield.
await composer.getByRole('button', { name: '文生图', exact: true }).click()
await expectComposerFooterHit(composer, '参考区内部滚动后')

// 节点浮动工具栏（图片节点的那条，@ 与抽帧共用同一 shell）
const nodeToolbar = win.locator('[role="toolbar"]').first()
await snapNear(win, 'node-floating-toolbar-real', nodeToolbar, 20)

// @ 弹层（无参考图时的空态）
const editor = composer.locator('[data-prompt-box] [contenteditable="true"]')
await expect.poll(() => editor.evaluate(element => element.closest('[data-prompt-box]').parentElement.clientHeight), { message: '分组后图片提示词区仍保留三行可输入空间' }).toBeGreaterThanOrEqual(72)
await editor.click({ timeout: 4000 })
await win.waitForTimeout(300)
await win.keyboard.type('@')
await expect(editor).toContainText('@')
await win.waitForTimeout(700)
await snap(win, 'mention-popup-empty')
// Fixed controls must already be reachable before Playwright can scroll anything.
await win.keyboard.press('Escape')
await expectComposerFooterHit(composer, '分组后填字')
await composer.locator('[data-effect-more]').click({ timeout: 4000 })
await expectVisible(win.getByTestId('node-effect-menu'), '受限高度下效果菜单仍可点击打开')
await snap(win, 'effects-menu-reachable')
await win.keyboard.press('Escape')

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
