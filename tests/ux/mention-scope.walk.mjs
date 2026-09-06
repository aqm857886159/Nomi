// R13 走查 —— @ 引用范围扩展（SHUO backlog 第 5 项）。
// 用法: node tests/ux/mention-scope.walk.mjs   产出: tests/ux/shots/mention-scope/*.png
//
// 这一项最要命的不是「弹层里多了几行」，而是**选中之后有没有真的建立引用**。
// 所以核心断言是：@ 一个画布节点 → 画布上**真的多一条边** + chip 编号对得上，不是只在文本里留一句话。
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mention-scope')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tmpDir = path.join(repoRoot, '.tmp')
fs.mkdirSync(tmpDir, { recursive: true })
const userData = path.join(tmpDir, 'nomi-mention-userdata')
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

// 两张真图当素材（不同颜色，肉眼能分辨谁是谁）
const FF = require('@ffmpeg-installer/ffmpeg').path
const pics = []
for (const [name, color] of [['ref-red', 'red'], ['ref-blue', 'blue']]) {
  const out = path.join(tmpDir, `${name}.png`)
  await new Promise((resolve, reject) => {
    const c = spawn(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=320x320`, '-frames:v', '1', out])
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))))
  })
  pics.push(out)
}
console.log('  → 素材图:', pics.map((p) => path.basename(p)).join(', '))

const { app, win } = await launchNomiApp({
  name: 'mention-scope',
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

// 把两张图拖进画布（真实路径：从访达拖素材进来）
const b64s = pics.map((p) => fs.readFileSync(p).toString('base64'))
await win.evaluate(async (list) => {
  const dt = new DataTransfer()
  list.forEach((b64, i) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    dt.items.add(new File([bytes], `ref-${i}.png`, { type: 'image/png' }))
  })
  const stage = document.querySelector('.generation-canvas-v2__stage')
  const rect = stage.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, clientX: rect.left + 260, clientY: rect.top + 220, dataTransfer: dt }
  stage.dispatchEvent(new DragEvent('dragover', opts))
  stage.dispatchEvent(new DragEvent('drop', opts))
}, b64s)
await win.waitForTimeout(6000)
await snap(win, 'assets-imported')

// 再加一个空图片节点当「目标」（要在它的提示词框里打 @）
await addCanvasNodeFromRail(win, 'image', { timeout: 4000 })
await win.waitForTimeout(1500)
const ids = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-node-id]')).map((el) => el.getAttribute('data-node-id')))
const targetId = ids[ids.length - 1]
console.log('  → 节点:', ids.length, '目标:', targetId)
check('画布上有 2 张素材 + 1 个目标节点', ids.length === 3, `实得 ${ids.length}`)

// 选中目标 → 提示词框 → 打 @
await win.locator(`[data-node-id="${targetId}"]`).first().click({ timeout: 4000 })
await win.waitForTimeout(1500)
// 目标节点可能落在视口外（默认位置会滑出去）→ 先「适应视图」再点，否则 composer 点不到。
const fitBtn = win.locator('[aria-label="适应视图"]').first()
if (await fitBtn.count()) { await fitBtn.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(1200) }
await win.locator(`[data-node-id="${targetId}"]`).first().click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(1200)
await snap(win, 'target-selected')
const editorCount = await win.evaluate(() => document.querySelectorAll('.ProseMirror').length)
console.log('  → ProseMirror 实例:', editorCount)
check('选中目标后提示词框出现', editorCount > 0, `${editorCount} 个`)
if (!editorCount) { await app.close(); process.exit(1) }
// 页面上不止一个 ProseMirror（还有别处的编辑器实例）→ 挑真正可见、且在 composer 里的那个。
const editorIndex = await win.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.ProseMirror'))
  return all.findIndex((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 40 && r.height > 10 && el.closest('.generation-canvas-v2')
  })
})
console.log('  → 可见 composer 编辑器序号:', editorIndex)
check('找得到 composer 里那个可见的提示词框', editorIndex >= 0, String(editorIndex))
if (editorIndex < 0) { await app.close(); process.exit(1) }
const editor = win.locator('.ProseMirror').nth(editorIndex)
await editor.click({ timeout: 8000 })
await win.waitForTimeout(400)
await win.keyboard.type('女主站在天台边 @')
await win.waitForTimeout(1200)
await snap(win, 'mention-open')

const popup = await win.evaluate(() => {
  const list = document.querySelector('[data-mention-list]')
  if (!list) return null
  return {
    groups: Array.from(list.querySelectorAll('[data-mention-group]')).map((el) => el.getAttribute('data-mention-group')),
    labels: Array.from(list.querySelectorAll('[data-mention-item]')).map((el) => el.getAttribute('aria-label')),
    headers: Array.from(list.children).filter((el) => el.tagName === 'DIV').map((el) => el.textContent?.trim()),
  }
})
console.log('  → 弹层:', JSON.stringify(popup))
check('@ 弹层出来了', Boolean(popup))
check('画布上已出图的节点进了候选（扩展前根本没有这一组）',
  (popup?.groups || []).includes('canvas'), JSON.stringify(popup?.groups))
check('候选按组标了来源', (popup?.headers || []).some((h) => h === '画布'), JSON.stringify(popup?.headers))

// 打字过滤
await win.keyboard.type('ref-1')
await win.waitForTimeout(900)
const filtered = await win.evaluate(() =>
  Array.from(document.querySelectorAll('[data-mention-item]')).map((el) => el.getAttribute('aria-label')))
console.log('  → 过滤后:', JSON.stringify(filtered))
check('打字能过滤（旧版 query 根本不参与过滤）', filtered.length > 0 && filtered.length < 2, JSON.stringify(filtered))
await snap(win, 'mention-filtered')

// 选中 → 必须**真的建一条边**
const edgesBefore = await win.evaluate(() => document.querySelectorAll('.generation-canvas-v2__edge-path').length)
await win.locator('[data-mention-item]').first().click({ timeout: 5000 })
await win.waitForTimeout(2000)
const after = await win.evaluate((idx) => {
  const editorEl = document.querySelectorAll('.ProseMirror')[idx]
  return {
    edges: document.querySelectorAll('.generation-canvas-v2__edge-path').length,
    chips: Array.from(document.querySelectorAll('[data-asset-mention]')).map((el) => el.textContent?.trim()),
    prompt: editorEl?.textContent?.trim() ?? '',
  }
}, editorIndex)
console.log('  → 选中后:', JSON.stringify(after), `(之前 ${edgesBefore} 条边)`)
check('@ 一个画布节点 → 画布上真的多了一条边（不是只在文本里留句话）',
  after.edges - edgesBefore === 1, `实得 ${after.edges - edgesBefore}`)
check('插入了 chip', (after.chips || []).length === 1, JSON.stringify(after.chips))
check('chip 编号是「图片1」（它成了第 1 张参考）', /图片1/.test((after.chips || [])[0] || ''), JSON.stringify(after.chips))
await snap(win, 'after-select')
{
  const box = await win.locator('.ProseMirror').first().boundingBox().catch(() => null)
  if (box) await snap(win, 'chip-zoom', { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 60), width: Math.min(900, box.width + 32), height: 180 })
}

await app.close()
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : '\n✅ 全部达标')
process.exit(fail.length ? 1 : 0)
