// 素材库音频/视频上传修复 R13 走查 —— 真 app 真 mp3，验：
//  ① 上传 accept 含音频+视频显式扩展名（治 macOS 灰掉）
//  ② setInputFiles 喂真 mp3 → 落项目文件 → 刷新后出现在「音频」tab（音频不经画布节点）
// 用法: node tests/ux/asset-audio-upload.walk.mjs （先 .tmp/probe-tone-3s.mp3 必须存在）
// 产出: tests/ux/shots/asset-audio/*.png + stdout 断言。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/asset-audio')
fs.mkdirSync(shotsDir, { recursive: true })
const AUDIO = path.join(repoRoot, '.tmp', 'probe-tone-3s.mp3')
if (!fs.existsSync(AUDIO)) { console.log('缺 .tmp/probe-tone-3s.mp3，先用 ffmpeg 造一个'); process.exit(1) }

const userData = path.join(repoRoot, '.tmp', 'nomi-asset-audio')
fs.rmSync(userData, { recursive: true, force: true })
fs.mkdirSync(userData, { recursive: true })

let n = 0
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env } })
let win = await app.firstWindow()
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  const proj = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } })
  win = proj || live[live.length - 1] || win
  return win
}
async function snap(name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  try { await getWin().screenshot({ path: path.join(shotsDir, `${tag}.png`) }); console.log(`  · shot ${tag}`) } catch (e) { console.log(`  ⚠️ shot ${tag}: ${e.message}`) }
}
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(250)
  }
}
async function clickText(sel, text, ms = 1400) {
  const el = getWin().locator(sel, { hasText: text }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await getWin().waitForTimeout(ms); return true }
  return false
}

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light') })
  await win.reload(); await win.waitForTimeout(1600)
  await dismiss()
  await snap('library')

  const card = getWin().locator('[data-project-card][role="button"]').first()
  if (await card.count()) { await card.click({ timeout: 4000 }).catch(() => {}) }
  await win.waitForTimeout(2600)
  await dismiss()
  check('进入项目', /projectId=/.test(getWin().url()), getWin().url().slice(-40))

  // 打开素材库
  await getWin().evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-asset-library')))
  await getWin().waitForTimeout(900)
  const accept = await getWin().locator('input[aria-label="素材文件选择器"]').getAttribute('accept').catch(() => null)
  const a = accept || ''
  check('accept 含音频显式扩展名(.mp3/.wav)', a.includes('.mp3') && a.includes('.wav'), `accept="${a}"`)
  check('accept 含视频显式扩展名(.mp4/.mov)', a.includes('.mp4') && a.includes('.mov'), `accept="${a}"`)
  await snap('asset-library-open')

  // 喂真 mp3（绕原生对话框）→ 音频走项目文件导入
  await getWin().locator('input[aria-label="素材文件选择器"]').setInputFiles(AUDIO).catch((e) => console.log('setInputFiles err', e.message))
  await getWin().waitForTimeout(5000) // 落盘 + workspace 重拉
  await snap('after-audio-upload')

  // 切到「音频」tab，确认音频素材出现
  await clickText('[role="tab"]', '音频', 1200)
  await getWin().waitForTimeout(1200)
  const probe = await getWin().evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="素材库"]')
    if (!dialog) return { found: false, why: 'no panel' }
    const spans = Array.from(dialog.querySelectorAll('span')).map((s) => (s.textContent || '').trim())
    const badgeCount = spans.filter((t) => t === '音频').length
    const names = spans.filter((t) => /probe-tone/.test(t))
    return { found: badgeCount > 0 || names.length > 0, badgeCount, names }
  }).catch((e) => ({ found: false, why: e.message }))
  check('上传的音频出现在「音频」tab', probe.found, `badges=${probe.badgeCount}, names=${JSON.stringify(probe.names)}`)
  await snap('audio-tab')
} catch (e) {
  console.log('WALK ERROR:', e.stack || e.message)
} finally {
  console.log('\n=== 结果 ===')
  const pass = results.filter((r) => r.ok).length
  console.log(`${pass}/${results.length} 通过`)
  await app.close().catch(() => {})
}
