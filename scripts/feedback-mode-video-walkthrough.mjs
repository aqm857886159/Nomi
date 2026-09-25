// R13 真机走查（2026-07-28 群反馈两根治）：
// B) 导入 Chromium 播不了的视频（mpeg4 AVI）→ 进口归一化转码 → 节点能播、时长非 0；
//    导入损坏视频 → 播放守卫显示人话原因（不再无声灰壳）。
// A) 图片节点连参考图（建边自动切图生图·既有）→ **换模型** → 生成方式不再回落「文生图」（本次修复）。
// 截图进 .feedback-walk/ 人眼判断。用法：node scripts/feedback-mode-video-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { realNomiProfile, seedRealCredentials } from '../tests/ux/_realProfile.mjs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.feedback-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

// 隔离档案（拷真实 model-catalog → 模型下拉有真选项）+ 隔离项目根
const isolatedSettings = path.join(os.tmpdir(), 'nomi-feedback-walk-settings')
const isolatedProjects = path.join(os.tmpdir(), 'nomi-feedback-walk-projects')
mkdirSync(isolatedSettings, { recursive: true })
mkdirSync(isolatedProjects, { recursive: true })
// 与启动器默认同形（每次新 tempRoot/user-data），只是先建出来：凭据钥匙（Windows 的 Local State）要在起 App 前种进去。
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'feedback-mode-video-'))
const userDataDir = path.join(tempRoot, 'user-data')
if (existsSync(realNomiProfile().catalogPath)) seedRealCredentials({ settingsDir: isolatedSettings, userDataDir })

// 夹具：mpeg4 AVI（Chromium 铁定播不了）+ 损坏 mp4 + 1x1 PNG（参考图）
const fixtureDir = path.join(os.tmpdir(), 'nomi-feedback-walk-fixtures')
mkdirSync(fixtureDir, { recursive: true })
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const aviPath = path.join(fixtureDir, 'legacy-camera.avi')
const enc = spawnSync(ffmpegPath, ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=12', '-c:v', 'mpeg4', '-y', aviPath], { timeout: 60000 })
if (enc.status !== 0) { console.log('✗ 夹具编码失败'); process.exit(1) }
const brokenPath = path.join(fixtureDir, 'broken-clip.mp4')
writeFileSync(brokenPath, Buffer.from('this is definitely not a playable video payload'))
const pngPath = path.join(fixtureDir, 'ref.png')
writeFileSync(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))

async function dropFile(win, filePath, name, mime, x, y) {
  const b64 = readFileSync(filePath).toString('base64')
  await win.evaluate(({ b64, name, mime, x, y }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], name, { type: mime })
    const dt = new DataTransfer()
    dt.items.add(file)
    const stage = document.querySelector('.generation-canvas-v2__stage')
    if (!stage) throw new Error('stage not found')
    for (const type of ['dragover', 'drop']) {
      stage.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    }
  }, { b64, name, mime, x, y })
}

const readModeBar = (win) => win.evaluate(() => {
  const group = document.querySelector('[role="group"][aria-label="生成方式"]')
  if (!group) return null
  const buttons = Array.from(group.querySelectorAll('button'))
  return {
    all: buttons.map((b) => (b.textContent || '').trim()),
    active: (buttons.find((b) => b.dataset.active === 'true')?.textContent || '').trim(),
  }
})

const { app, win } = await launchNomiApp({
  name: 'feedback-mode-video',
  tempRoot,
  userDataDir,
  settingsDir: isolatedSettings,
  projectsDir: isolatedProjects,
  settleMs: 1200,
})
const errors = []
let failed = false
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  // 隔离档案无语言设置 → 可能跟随系统落 en；走查选择器用 zh，先钉中文再走
  await win.evaluate(() => window.localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  // 进入生成画布工作区：优先点顶部步骤导航，兜底 URL step 参数（同一 store 真相源）
  const canvasNav = win.getByText('生成', { exact: true })
  if ((await canvasNav.count()) > 0) await canvasNav.first().click().catch(() => {})
  await win.waitForTimeout(1200)
  const hasStage = await win.locator('.generation-canvas-v2__stage').count()
  if (!hasStage) {
    await win.evaluate(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('step', 'generate')
      window.history.pushState({}, '', url)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
  }
  await win.locator('.generation-canvas-v2__stage').first().waitFor({ timeout: 15000 })
  await win.waitForTimeout(1000)

  // ── B1) mpeg4 AVI 导入 → 转码 → 能播 ──
  console.log('— B1: 导入 mpeg4 AVI（播不了的编码/容器）—')
  await dropFile(win, aviPath, 'legacy-camera.avi', 'video/x-msvideo', 700, 380)
  try {
    await win.waitForFunction(() => {
      const v = document.querySelector('[data-node-id] video')
      return Boolean(v && Number.isFinite(v.duration) && v.duration > 0)
    }, { timeout: 45000 })
    const dur = await win.evaluate(() => document.querySelector('[data-node-id] video')?.duration ?? 0)
    console.log(`  ✓ AVI 经转码可播，duration=${dur.toFixed(2)}s`)
  } catch {
    console.log('  ✗ AVI 导入后视频不可播（duration 未就绪）'); failed = true
  }
  await win.waitForTimeout(500)
  const aviCard = win.locator('[data-node-id]').filter({ hasText: 'legacy-camera' }).first()
  if ((await aviCard.count()) > 0) await aviCard.screenshot({ path: path.join(outDir, '10-avi-imported-playable.png') }).catch(() => {})
  else await shot(win, '10-avi-imported-playable.png')
  console.log('  📸 10-avi-imported-playable.png')

  // ── B2) 损坏视频 → 守卫人话报错（不再无声灰壳）──
  console.log('— B2: 导入损坏视频 → 播放守卫诚实报错 —')
  await dropFile(win, brokenPath, 'broken-clip.mp4', 'video/mp4', 980, 620)
  const overlayVisible = await win
    .waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll('[data-node-id]'))
      return cards.some((c) => /解码失败|格式不受支持|无法播放|正在自动转码/.test(c.textContent || ''))
    }, { timeout: 45000 })
    .then(() => true)
    .catch(() => false)
  if (overlayVisible) console.log('  ✓ 守卫在节点上给出了人话原因')
  else { console.log('  ✗ 损坏视频没有出现可见报错（还是无声灰壳？）'); failed = true }
  await win.waitForTimeout(1500)
  const brokenCard = win.locator('[data-node-id]').filter({ hasText: /格式不受支持|解码失败|无法播放/ }).first()
  if ((await brokenCard.count()) > 0) await brokenCard.screenshot({ path: path.join(outDir, '11-broken-video-honest-error.png') }).catch(() => {})
  else await shot(win, '11-broken-video-honest-error.png')
  console.log('  📸 11-broken-video-honest-error.png')

  // ── A) 参考图 + 换模型：生成方式不回落文生图 ──
  console.log('— A: 拖参考图连出图片节点 → 选模型/换模型 → 生成方式恒图生图 —')
  await dropFile(win, pngPath, 'ref.png', 'image/png', 420, 640)
  await win.waitForTimeout(1500)
  // 真用户主路径：从素材卡输出把手拖到空白 → 「创建并连接」菜单 → 图片
  const refCard = win.locator('[data-node-id][data-kind="asset"]').filter({ has: win.locator('img') }).first()
  const bb = await refCard.boundingBox()
  if (!bb) throw new Error('A 段：找不到参考图素材卡')
  // 输出把手圆心在卡右沿外 14px（right-[-14px] 的 28px 圆）——从沿外 6px 起拖才是连线不是拖卡
  const startX = bb.x + bb.width + 6
  const startY = bb.y + bb.height / 2
  await win.mouse.move(startX - 10, startY)
  await win.mouse.move(startX, startY)
  await win.mouse.down()
  await win.mouse.move(startX + 140, startY - 50, { steps: 8 })
  await win.mouse.move(startX + 280, startY - 80, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(600)
  await shot(win, '19-connection-create-menu.png')
  await win.locator('.generation-canvas-v2__connection-create-menu').getByText('图片', { exact: true }).first().click()
  const imageNode = win.locator('[data-node-id][data-kind="image"]').first()
  await imageNode.waitFor({ timeout: 8000 })
  await win.waitForTimeout(800)
  await imageNode.click({ position: { x: 40, y: 16 } }).catch(() => {})
  await win.waitForTimeout(800)

  // 选模型（composer 内的「模型」下拉）
  const modelSelect = win.locator('.generation-canvas-v2-node__composer-card [aria-label="模型"]').first()
  await modelSelect.waitFor({ timeout: 8000 })
  const pickModel = async (preferences) => {
    await modelSelect.click()
    await win.waitForTimeout(500)
    const options = win.locator('[role="option"]')
    const texts = await options.allTextContents().catch(() => [])
    for (const pref of preferences) {
      const idx = texts.findIndex((t) => t.includes(pref))
      if (idx >= 0) { await options.nth(idx).click(); await win.waitForTimeout(800); return texts[idx].trim() }
    }
    await win.keyboard.press('Escape').catch(() => {})
    return ''
  }
  const m1 = await pickModel(['Seedream', 'GPT Image', 'Nano Banana'])
  console.log(`  模型 M1 = ${m1 || '（没找到候选）'}`)
  if (!m1) { failed = true; throw new Error('A 段：模型下拉里找不到已知档案模型') }
  const afterM1 = await readModeBar(win)
  console.log(`  连着参考·选 M1 后生成方式: ${JSON.stringify(afterM1)}`)
  if (!afterM1 || !afterM1.active || afterM1.active === '文生图') {
    console.log('  ✗ 挂着参考边选模型后仍停在文生图（换模型 reconcile 未生效）'); failed = true
  } else console.log(`  ✓ 选 M1 后自动=「${afterM1.active}」`)
  await shot(win, '20-mode-after-connect.png')

  // 换模型 M2 → 修复点：模式不回落文生图
  const m2 = await pickModel(['Nano Banana', 'GPT Image', 'Seedream'].filter((p) => !m1.includes(p)))
  console.log(`  模型 M2 = ${m2 || '（没有第二个候选，A 段降级为单模型验证）'}`)
  if (m2) {
    await win.waitForTimeout(600)
    const afterSwitch = await readModeBar(win)
    console.log(`  换模型后生成方式: ${JSON.stringify(afterSwitch)}`)
    if (!afterSwitch || afterSwitch.active === '文生图' || !afterSwitch.active) {
      console.log('  ✗ 换模型后回落「文生图」——参考将被静默丢（修复未生效）'); failed = true
    } else console.log(`  ✓ 换模型后保持「${afterSwitch.active}」（修复生效）`)
  }
  await shot(win, '21-mode-after-model-switch.png')

  console.log('\n=== 页面错误(' + errors.length + ') ===')
  for (const e of errors.slice(0, 8)) console.log('  ✗ ' + e.slice(0, 200))
} catch (e) {
  console.log('✗ 走查异常: ' + (e && e.message ? e.message : e))
  failed = true
} finally {
  await app.close().catch(() => {})
}
if (failed) { console.log('WALKTHROUGH: FAIL'); process.exit(1) }
console.log('WALKTHROUGH: PASS')
