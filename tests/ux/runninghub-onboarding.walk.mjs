// RunningHub 接入 + 模型选择器去重 R13 走查。bridge 直连(绕UI)+ Playwright 直驱 DOM(绕多屏OS点击)。
// 用法: RH_KEY=xxx node tests/ux/runninghub-onboarding.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'; import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/runninghub'); fs.mkdirSync(shotsDir, { recursive: true })
const userData = path.join(repoRoot, '.tmp', 'nomi-rh-userdata'); fs.mkdirSync(userData, { recursive: true })
const KEY = process.env.RH_KEY || ''
let n = 0
const snap = async (w, name) => { n += 1; const t = `${String(n).padStart(2,'0')}-${name}`; await screenshotSettled(w, { path: path.join(shotsDir, `${t}.png`) }); console.log(`  · ${t}`) }
const tryClick = async (w, sel, label, ms = 3000) => { try { const el = w.locator(sel).first(); if (await el.count()) { await el.click({ timeout: ms }); console.log(`  ✓ ${label}`); return true } } catch (e) { console.log(`  ✗ ${label}: ${String(e.message).split('\n')[0]}`) } return false }
const dumpButtons = async (w) => { const t = await w.locator('button, [role=button], [aria-label]').allInnerTexts().catch(() => []); console.log('  buttons:', JSON.stringify([...new Set(t.filter(Boolean))].slice(0, 30))) }

const { app, win } = await launchNomiApp({ name: 'runninghub-onboarding', userDataDir: userData })
// 直接 bridge 连 RunningHub（绕 UI）
if (KEY) {
  const r = await win.evaluate((k) => { try { window.nomiDesktop.modelCatalog.upsertVendorApiKey('runninghub', { apiKey: k, enabled: true }); return 'ok' } catch (e) { return String(e) } }, KEY)
  console.log('  bridge connect runninghub:', r)
}
await win.evaluate(() => { for (const k of ['nomi:splash:v1','nomi:journey-tour:v1','nomi:canvas-gesture-hint:v1','nomi-onboarding-checklist:v1']) localStorage.setItem(k,'seen') })
await win.reload(); await win.waitForTimeout(1800)
await snap(win, 'after-load')

// 新建空白项目（进画布）
if (!await tryClick(win, 'button:has-text("新建空白项目")', 'new-blank-project')) { await dumpButtons(win) }
await win.waitForTimeout(1500)
await snap(win, 'project-opened')
await tryClick(win, 'button:has-text("生成")', 'gen-tab'); await win.waitForTimeout(700)
await tryClick(win, 'button:has-text("新建画面")', 'new-board'); await win.waitForTimeout(1000)
await snap(win, 'canvas')

// 加视频节点
// 左缘加节点一律走 _canvasRail：它自己判断该种在常驻位还是在「更多」里，找不到当场抛。
await addCanvasNodeFromRail(win, 'video')
await win.waitForTimeout(1200); await snap(win, 'video-node')
// 选中
await tryClick(win, '.generation-canvas-v2-node, [data-node-kind], article', 'select-node'); await win.waitForTimeout(700)
await snap(win, 'video-node-selected')
// 开模型下拉：试当前模型名按钮
for (const s of ['button:has-text("可灵")','button:has-text("Seedance")','button:has-text("即梦")','[aria-label*="模型"] button','[aria-label*="选择模型"]','button:has-text("Veo")']) {
  if (await tryClick(win, s, `model-select ${s}`)) { await win.waitForTimeout(800); break }
}
await snap(win, 'model-dropdown')
// dump 下拉可见文本（机器核对：可灵/Seedance 是否各一条 + 「N家」）
const opts = await win.locator('[role=option], [role=menuitem], [class*=option], [class*=Select] li').allInnerTexts().catch(() => [])
console.log('  图片节点下拉项:', JSON.stringify([...new Set(opts.filter(Boolean))].slice(0, 40)))
await win.keyboard.press('Escape'); await win.waitForTimeout(400)

// ── 加 3D 节点，验混元/HiTem/Meshy ──
// 3D 模型自「第三档」起在左缘的「更多」里，同样走 _canvasRail。
await addCanvasNodeFromRail(win, 'model3d')
await win.waitForTimeout(1200); await snap(win, '3d-node')
await tryClick(win, 'text=3D 模型', 'select-3d'); await win.waitForTimeout(700)
await snap(win, '3d-node-selected')
for (const s of ['button:has-text("混元")','button:has-text("3D")','[aria-label*="模型"] button','button:has-text("Meshy")']) {
  if (await tryClick(win, s, `3d-model-select ${s}`)) { await win.waitForTimeout(800); break }
}
await snap(win, '3d-model-dropdown')
const opts3d = await win.locator('[role=option], [role=menuitem], [class*=option]').allInnerTexts().catch(() => [])
console.log('  3D节点下拉项:', JSON.stringify([...new Set(opts3d.filter(Boolean))].slice(0, 20)))
await app.close()
console.log('DONE')
