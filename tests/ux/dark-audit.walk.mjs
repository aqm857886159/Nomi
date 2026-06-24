// 暗色设计审计：每个界面双主题截图，喂设计/用户 Agent 逐张人眼审。
// 用法: NOMI_AUDIT_THEME=dark node tests/ux/dark-audit.walk.mjs  (再跑 light)
// 产出: tests/ux/shots/audit-<theme>/*.png
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = process.cwd()
const THEME = process.env.NOMI_AUDIT_THEME === 'light' ? 'light' : 'dark'
const shots = path.join(repoRoot, 'tests/ux/shots', `audit-${THEME}`)
fs.rmSync(shots, { recursive: true, force: true })
fs.mkdirSync(shots, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-audit-userdata')

let n = 0
async function snap(win, name) {
  n += 1
  await win.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · ${THEME} ${String(n).padStart(2, '0')}-${name}`)
}
async function click(win, txt, ms = 1500) {
  const el = win.locator('button, [role="button"], [role="tab"], a', { hasText: txt }).first()
  if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await win.waitForTimeout(ms); return true }
  return false
}
async function escClose(win) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(400) }
async function dismissTour(win) {
  for (let i = 0; i < 8; i++) {
    const s = win.locator('button, [role="button"], a', { hasText: /跳过|完成|知道了/ }).first()
    if (await s.count()) await s.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(300)
  }
}

const app = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: repoRoot, env: { ...process.env } })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded'); await win.waitForTimeout(1500)
await win.evaluate((t) => { localStorage.setItem('nomi-color-scheme', t); for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen') }, THEME)
await win.reload(); await win.waitForTimeout(1500)

await snap(win, 'library')
// 库页弹层：模型接入 / 提示词库前先在库页能点到的
await click(win, '修好一个小机器人', 2600) || await click(win, '示例', 2600)
await dismissTour(win)
await snap(win, 'creation')
// 生成画布（空 + 建节点卡）
await click(win, '生成', 1800); await dismissTour(win); await snap(win, 'canvas-empty')
await click(win, '新建画面', 1600); await snap(win, 'canvas-node-card')
// 时间轴/预览（白线所在）
await click(win, '预览', 1800); await dismissTour(win); await snap(win, 'preview-timeline')
// 顶栏各库
if (await click(win, '素材库', 1200)) { await snap(win, 'material-library'); await escClose(win) }
if (await click(win, '提示词库', 1200)) { await snap(win, 'prompt-library'); await escClose(win) }
{ const s = win.locator('[aria-label*="技能"]').first(); if (await s.count()) { await s.click({ timeout: 3000 }).catch(() => {}); await win.waitForTimeout(900); await snap(win, 'skill-library'); await escClose(win) } }
if (await click(win, '模型接入', 1400)) { await snap(win, 'model-onboarding'); await escClose(win) }
// 创作助手对话面板
await click(win, '创作', 1200)
{ const a = win.locator('[aria-label*="助手"], button, [role="button"]', { hasText: /创作助手|Nomi 创作|AI/ }).first(); if (await a.count()) { await a.click({ timeout: 2500 }).catch(() => {}); await win.waitForTimeout(900); await snap(win, 'creation-assistant') } }
// About 弹层（外观行）
for (const sel of ['text=Nomi', '[aria-label*="关于"]']) { const b = win.locator(sel).first(); if (await b.count()) { await b.click({ timeout: 2000 }).catch(() => {}); await win.waitForTimeout(600); break } }
await snap(win, 'about-popover')

console.log(`\n${THEME}: ${n} shots → ${path.relative(repoRoot, shots)}`)
await app.close()
