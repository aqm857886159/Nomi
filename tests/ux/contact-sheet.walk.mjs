// R13 走查 —— 联系表（SHUO backlog 第 6 项，用户拍板 a：把选中的成图排成一张）。
// 用法: node tests/ux/contact-sheet.walk.mjs   产出: tests/ux/shots/contact-sheet/*.png
//
// 关键断言不是「有没有出一个节点」，而是**拼出来的那张图对不对**：
// 尺寸符合排版公式、四张源图的颜色真的出现在各自格子里（去成品图上采样比色）。
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { screenshotSettled } from './_assert.mjs'
import { canvasFitViewButton } from './_shell.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/contact-sheet')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tmpDir = path.join(repoRoot, '.tmp')
fs.mkdirSync(tmpDir, { recursive: true })
const userData = path.join(tmpDir, 'nomi-contactsheet-userdata')
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
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`), ...(clip ? { clip } : {}) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

// 四张纯色图，颜色互不相同 → 成品图上采样就能证明「哪张进了哪格」
const COLORS = [
  { name: 'red', rgb: [255, 0, 0] },
  { name: 'lime', rgb: [0, 255, 0] },
  { name: 'blue', rgb: [0, 0, 255] },
  { name: 'yellow', rgb: [255, 255, 0] },
]
const FF = require('@ffmpeg-installer/ffmpeg').path
const pics = []
for (const c of COLORS) {
  const out = path.join(tmpDir, `sheet-${c.name}.png`)
  await new Promise((resolve, reject) => {
    const p = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c.name}:size=480x270`, '-frames:v', '1', out])
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))))
  })
  pics.push(out)
}
console.log('  → 源图:', COLORS.map((c) => c.name).join('/'))

const { app, win } = await launchNomiApp({
  name: 'contact-sheet',
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

const b64s = pics.map((p) => fs.readFileSync(p).toString('base64'))
await win.evaluate(async (list) => {
  const dt = new DataTransfer()
  list.forEach((b64, i) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    dt.items.add(new File([bytes], `sheet-${i}.png`, { type: 'image/png' }))
  })
  const stage = document.querySelector('.generation-canvas-v2__stage')
  const rect = stage.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, clientX: rect.left + 300, clientY: rect.top + 240, dataTransfer: dt }
  stage.dispatchEvent(new DragEvent('dragover', opts))
  stage.dispatchEvent(new DragEvent('drop', opts))
}, b64s)
await win.waitForTimeout(7000)
await snap(win, 'sources-imported')
const sourceCount = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
check('四张源图都进画布了', sourceCount === 4, `实得 ${sourceCount}`)

// 全选 → 浮条上应出现「生成总览图」
await win.keyboard.press('Control+a')
await win.waitForTimeout(900)
const toolbar = win.locator('.generation-canvas-v2__selection-toolbar').first()
{
  const box = await toolbar.boundingBox().catch(() => null)
  if (box) await snap(win, 'toolbar-with-action', { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20), width: box.width + 40, height: box.height + 40 })
}
const sheetBtn = toolbar.getByRole('button', { name: /^(生成总览图|Create overview)/ }).first()
check('多选浮条上出现「生成总览图」', await sheetBtn.count() > 0)
const btnLabel = await sheetBtn.getAttribute('aria-label').catch(() => null)
check('钮上标明会生成几张总览图', /生成总览图（4 张）/.test(btnLabel || ''), String(btnLabel))

// 生成
await sheetBtn.click({ timeout: 5000 })
await win.waitForTimeout(6000)
// The canvas only mounts visible React Flow nodes. The overview is intentionally
// placed to the right of the selected sources, so fit before asserting the new
// node; counting the current viewport would otherwise report the four sources
// while the real overview already exists off-screen.
const fitBtn = canvasFitViewButton(win)
if (await fitBtn.count()) { await fitBtn.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(1500) }
await snap(win, 'after-build')
const built = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
const overviewNode = win.locator('.generation-canvas-v2-node').filter({ hasText: /总览图/ }).first()
check('多出一个总览图节点', built >= 5 && await overviewNode.count() > 0, `实得 ${built}`)

// 取成品图，验尺寸 + 采样比色（真正证明「哪张进了哪格」）。
// nomi-local:// 的 <img> 直接画进 canvas 会被当成跨源图拦住读像素；这里改用 fetch 取回字节 →
// createImageBitmap（字节来源是我们自己 fetch 的，不带污染标记）再采样，既不绕过协议的安全边界，也不丢这条断言。
const verdict = await overviewNode.locator('img').first().evaluate(async (img) => {
  const src = img.currentSrc || img.getAttribute('src') || ''
  const out = { width: img.naturalWidth || 0, height: img.naturalHeight || 0, src }
  try {
    const blob = await (await fetch(src)).blob()
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    // 排版常量与 contactSheetLayout.ts 默认值一致：cell 480x270, gap 16, padding 24, caption 30
    const P = 24, CW = 480, CH = 270, GAP = 16, CAP = 30
    const at = (col, row) => {
      const d = ctx.getImageData(Math.round(P + col * (CW + GAP) + CW / 2), Math.round(P + row * (CH + CAP + GAP) + CH / 2), 1, 1).data
      return [d[0], d[1], d[2]]
    }
    return { ...out, width: bitmap.width, height: bitmap.height, cells: [at(0, 0), at(1, 0), at(0, 1), at(1, 1)] }
  } catch (error) {
    return { ...out, sampleError: String(error?.message || error) }
  }
}).catch(() => ({ error: '没找到总览图成品' }))
console.log('  → 成品:', JSON.stringify(verdict))
check('拿到总览图成品', !verdict.error && verdict.width > 0 && verdict.height > 0, verdict.error || `${verdict.width}x${verdict.height}`)
if (!verdict.error) {
  // 4 张 → 2 列 2 行；宽 = 24*2 + 2*480 + 16 = 1024；高 = 24*2 + 2*(270+30) + 16 = 664
  check('成品尺寸符合排版公式（2×2）', verdict.width === 1024 && verdict.height === 664, `${verdict.width}x${verdict.height}`)
  check('成品落在本地资源协议上', verdict.src.startsWith('nomi-local://'), verdict.src)
  check('成品图能读到像素（才能证明哪张进了哪格）', Array.isArray(verdict.cells), verdict.sampleError || '')
  if (Array.isArray(verdict.cells)) {
    const near = (got, want) => got.every((v, i) => Math.abs(v - want[i]) < 40)
    const expected = COLORS.map((c) => c.rgb)
    const okCells = verdict.cells.map((got, i) => near(got, expected[i]))
    check('四个格子里真是对应的四张图（成品图上采样比色）', okCells.every(Boolean),
      verdict.cells.map((c, i) => `${COLORS[i].name}:${okCells[i] ? 'ok' : `got rgb(${c})`}`).join(' '))
  }
}

await snap(win, 'canvas-final')

// 成品图另存一份真实渲染截图，人眼看清四格和标号条；不绕过 nomi-local:// 的安全边界。
if (await overviewNode.count()) {
  await overviewNode.screenshot({ path: path.join(shotsDir, '05-sheet-actual.png') })
  console.log('  · shot 05-sheet-actual（真实节点截图）')
}

await app.close()
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : '\n✅ 全部达标')
process.exit(fail.length ? 1 : 0)
