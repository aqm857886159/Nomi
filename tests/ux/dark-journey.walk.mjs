// 暗色「完整用户旅途」R13 走查 —— J1-J5 真实创作旅程，逐步截图 + 内容诊断（节点/clip 数）。
// 用法: node tests/ux/dark-journey.walk.mjs
// 产出: tests/ux/shots/dark-journey/*.png + stdout 每步诊断。
// 隔离 userData 绕开打包版单实例锁；强制 dark + 压 splash/tour。
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const shots = path.join(repoRoot, 'tests/ux/shots/dark-journey')
fs.mkdirSync(shots, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-journey-userdata')

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await win.screenshot({ path: path.join(shots, `${tag}.png`) })
  const diag = await win.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length
    return {
      theme: document.documentElement.dataset.theme,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 6),
      canvasNodes: q('.react-flow__node, [data-node-id], [data-canvas-node], [data-nodeid]'),
      tiptap: (document.querySelector('.ProseMirror, .tiptap')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      clips: q('[data-clip-id], [data-clip], .timeline-clip, [class*="clip"]'),
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((e) => (e.getAttribute('aria-label') || '').trim()).filter(Boolean),
    }
  })
  console.log(`\n[${tag}] theme=${diag.theme} nodes=${diag.canvasNodes} clips=${diag.clips} dialogs=${JSON.stringify(diag.dialogs)}`)
  if (diag.headings.length) console.log(`   headings: ${JSON.stringify(diag.headings)}`)
  if (diag.tiptap) console.log(`   editor: ${diag.tiptap}`)
  return diag
}

async function clickText(win, sel, text, ms = 1400) {
  const el = win.locator(sel, { hasText: text }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(ms); return true }
  return false
}
async function dismissTour(win) {
  for (let i = 0; i < 10; i++) {
    const skip = win.locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1200 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(400)
  }
}

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(1500)
await win.evaluate(() => {
  localStorage.setItem('nomi-color-scheme', 'dark')
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
})
await win.reload(); await win.waitForTimeout(1500)

await snap(win, 'J1-library')

const opened =
  (await clickText(win, '[role="button"], button, [data-project-card]', '修好一个小机器人', 2600)) ||
  (await clickText(win, '[role="button"], button', '示例', 2600))
console.log('opened example:', opened)
await dismissTour(win)
await win.waitForTimeout(800)

await clickText(win, 'button, [role="button"], [role="tab"]', '创作', 1500)
await dismissTour(win)
await snap(win, 'J2-creation')

await clickText(win, 'button, [role="button"], [role="tab"]', '生成', 1800)
await dismissTour(win)
await snap(win, 'J3-generation-canvas')
const node = win.locator('.react-flow__node, [data-node-id], [data-canvas-node]').first()
if (await node.count()) { await node.click({ timeout: 3000 }).catch(() => {}); await win.waitForTimeout(900); await snap(win, 'J3b-node-inspector') }

await clickText(win, 'button, [role="button"], [role="tab"]', '预览', 1800)
await dismissTour(win)
await snap(win, 'J4-preview-timeline')

if (await clickText(win, 'button, [role="button"]', '导出', 1500)) await snap(win, 'J5-export-dialog')
await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(500)

if (await clickText(win, 'button, [role="button"]', '模型接入', 1400)) { await snap(win, 'X1-model-onboarding'); await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400) }
const skill = win.locator('[aria-label*="技能"]').first()
if (await skill.count()) { await skill.click({ timeout: 3000 }).catch(() => {}); await win.waitForTimeout(900); await snap(win, 'X2-skill-library'); await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400) }

console.log(`\nDone. ${n} shots → ${path.relative(repoRoot, shots)}`)
await app.close()
