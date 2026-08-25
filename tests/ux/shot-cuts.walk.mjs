// R13 走查 —— 按镜头拆（SHUO backlog 第 3 项）。
// 用法: node tests/ux/shot-cuts.walk.mjs   产出: tests/ux/shots/shot-cuts/*.png
//
// 用一段**真的有硬切**的视频（现造：4 段不同画面拼接 → 3 个切点），走完整条链：
// 传视频 → 点「按镜头拆」→ 真 ffmpeg 检测 → 面板出缩略图 → 拖灵敏度看数量变 → 勾选 → 落画布 → 自动成一组。
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/shot-cuts')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tmpDir = path.join(repoRoot, '.tmp')
fs.mkdirSync(tmpDir, { recursive: true })
const userData = path.join(tmpDir, 'nomi-shotcuts-userdata')
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

// ── 造一段有 3 个硬切的测试视频（每段 2s，共 8s）
const FIXTURE = path.join(tmpDir, 'shot-cuts-fixture.mp4')
const FF = require('@ffmpeg-installer/ffmpeg').path
await new Promise((resolve, reject) => {
  const child = spawn(FF, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'color=c=blue:size=640x360:rate=12:duration=2',
    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[out]',
    '-map', '[out]', '-pix_fmt', 'yuv420p', FIXTURE,
  ])
  child.on('error', reject)
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))))
})
console.log('  → 夹具视频:', FIXTURE, fs.statSync(FIXTURE).size, 'bytes（预期 3 个切点：2s/4s/6s）')

const { app, win } = await launchNomiApp({
  name: 'shot-cuts',
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

// 把夹具视频**拖进画布**（用户真实路径：从访达拖一段素材进来 → handleCanvasStageDrop）。
const fixtureB64 = fs.readFileSync(FIXTURE).toString('base64')
await win.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const file = new File([bytes], 'shot-cuts-fixture.mp4', { type: 'video/mp4' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const stage = document.querySelector('.generation-canvas-v2__stage')
  if (!stage) throw new Error('找不到画布 stage')
  const rect = stage.getBoundingClientRect()
  const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, dataTransfer: dt }
  stage.dispatchEvent(new DragEvent('dragover', opts))
  stage.dispatchEvent(new DragEvent('drop', opts))
}, fixtureB64)
await win.waitForTimeout(6000)
await snap(win, 'video-imported')
const nodeId = await win.evaluate(() => document.querySelector('[data-node-id]')?.getAttribute('data-node-id'))
console.log('  → 视频节点:', nodeId)
const hasVideo = await win.evaluate(() => Boolean(document.querySelector('[data-node-id] video')))
check('视频真的进画布了', Boolean(nodeId) && hasVideo, `node=${nodeId} video=${hasVideo}`)
if (!nodeId || !hasVideo) { await app.close(); process.exit(1) }

// 点「按镜头拆」
await win.locator(`[data-node-id="${nodeId}"]`).first().click({ timeout: 4000 })
await win.waitForTimeout(900)
const splitBtn = win.locator('button', { hasText: '按镜头拆' }).first()
check('浮条上有「按镜头拆」', await splitBtn.count() > 0)
await splitBtn.click({ timeout: 5000 })
await win.waitForTimeout(1200)
await snap(win, 'panel-detecting')

// 等检测完（真 ffmpeg）
const panel = win.locator('[role="dialog"][aria-label="按镜头拆"]').first()
await panel.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
let ready = false
for (let i = 0; i < 40; i += 1) {
  const txt = await panel.textContent().catch(() => '')
  if (txt && /检测到\s*\d+\s*个镜头/.test(txt)) { ready = true; break }
  await win.waitForTimeout(500)
}
check('检测完成并报出镜头数', ready)
await win.waitForTimeout(600)
await snap(win, 'panel-ready')
{
  const box = await panel.boundingBox().catch(() => null)
  if (box) await snap(win, 'panel-ready-zoom', { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: box.width + 12, height: box.height + 12 })
}

const counts = await win.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="按镜头拆"]')
  const tiles = dlg ? dlg.querySelectorAll('[data-shot-cut]') : []
  const first = tiles[0]
  return {
    header: dlg?.textContent?.match(/检测到\s*(\d+)\s*个镜头/)?.[1] ?? null,
    tiles: tiles.length,
    firstBg: first ? getComputedStyle(first.querySelector('span')).backgroundImage.slice(0, 40) : null,
    commitLabel: dlg?.querySelector('[data-shot-cut-commit]')?.textContent?.trim() ?? null,
  }
})
console.log('  → 面板:', JSON.stringify(counts))
check('检测到 3 个镜头（夹具就是 3 个硬切）', counts.header === '3', String(counts.header))
check('缩略图格子数 = 镜头数', counts.tiles === 3, String(counts.tiles))
check('缩略图真有联系表底图（不是空格子）', /url\(/.test(counts.firstBg || ''), String(counts.firstBg))
check('按钮标明会加几张', /加入画布（3）/.test(counts.commitLabel || ''), String(counts.commitLabel))

// Portal 浮层配色：必须是 --nomi-* 的真颜色，不能静默退回继承的灰
const colors = await win.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="按镜头拆"]')
  const card = dlg?.firstElementChild
  const commit = dlg?.querySelector('[data-shot-cut-commit]')
  return {
    cardBg: card ? getComputedStyle(card).backgroundColor : null,
    commitBg: commit ? getComputedStyle(commit).backgroundColor : null,
    commitFg: commit ? getComputedStyle(commit).color : null,
  }
})
console.log('  → 面板配色:', JSON.stringify(colors))
check('确认按钮不是「静默退回的灰」（Portal token 坑）',
  colors.commitBg !== 'rgb(201, 201, 201)' && colors.commitBg !== 'rgba(0, 0, 0, 0)', JSON.stringify(colors))

// 灵敏度滑杆：拉高应当变少（前端过滤，瞬时）
const slider = win.locator('#shot-cut-sensitivity').first()
await slider.fill('0.7')
await win.waitForTimeout(500)
const afterHigh = await win.evaluate(() => document.querySelectorAll('[data-shot-cut]').length)
await snap(win, 'panel-high-sensitivity')
check('灵敏度拉到最高 → 镜头数变少（滑杆真在过滤）', afterHigh < 3, `${afterHigh} 个`)
await slider.fill('0.1')
await win.waitForTimeout(500)
const afterLow = await win.evaluate(() => document.querySelectorAll('[data-shot-cut]').length)
check('拉回最低 → 恢复全集（不重跑 ffmpeg 也能回来）', afterLow === 3, `${afterLow} 个`)

// 取消勾选一个 → 按钮数字应当跟着变
await win.locator('[data-shot-cut]').first().click({ timeout: 4000 })
await win.waitForTimeout(400)
const afterUncheck = await win.evaluate(() =>
  document.querySelector('[data-shot-cut-commit]')?.textContent?.trim() ?? '')
check('取消勾选一个 → 按钮变「加入画布（2）」', /加入画布（2）/.test(afterUncheck), afterUncheck)
await win.locator('[data-shot-cut]').first().click({ timeout: 4000 })
await win.waitForTimeout(400)

// 落画布
const nodesBefore = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
await win.locator('[data-shot-cut-commit]').first().click({ timeout: 5000 })
await win.waitForTimeout(9000)
await snap(win, 'after-commit')
const after = await win.evaluate(() => ({
  nodes: document.querySelectorAll('[data-node-id]').length,
  groups: document.querySelectorAll('[data-group-id]').length,
  groupLabel: document.querySelector('.generation-canvas-v2__group-box-label')?.textContent?.trim() ?? null,
  panelOpen: Boolean(document.querySelector('[role="dialog"][aria-label="按镜头拆"]')),
}))
console.log(`  → 落画布后:`, JSON.stringify(after), `(之前 ${nodesBefore} 个节点)`)
check('落了 3 个新节点', after.nodes - nodesBefore === 3, `实得 ${after.nodes - nodesBefore}`)
check('自动成一组（拍板：拆出来直接能整组运行）', after.groups === 1, String(after.groups))
check('组名说清来自哪段视频', /拆自/.test(after.groupLabel || ''), String(after.groupLabel))
check('落完面板自动关掉', !after.panelOpen)

const fitBtn = win.locator('[aria-label="适应视图"]').first()
if (await fitBtn.count()) { await fitBtn.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(1200) }
await snap(win, 'canvas-final')
{
  const gb = await win.locator('.generation-canvas-v2__group-box').first().boundingBox().catch(() => null)
  if (gb) await snap(win, 'group-final-zoom', { x: Math.max(0, gb.x - 12), y: Math.max(0, gb.y - 12), width: Math.min(900, gb.width + 24), height: Math.min(500, gb.height + 24) })
}

await app.close()
console.log(fail.length ? `\n❌ ${fail.length} 条不达标:\n - ${fail.join('\n - ')}` : '\n✅ 全部达标')
process.exit(fail.length ? 1 : 0)
