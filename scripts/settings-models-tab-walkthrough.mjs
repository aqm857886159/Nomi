import { makeTempDir } from './_test-temp.mjs'
// R13 真机走查：设置新增「模型」tab（2026-08-12 用户拍板）。
// plan: docs/plan/2026-08-12-model-settings-home-and-comfyui-workflow-page.md
//
// 场景：① 项目库顶栏齿轮 → 设置，左侧六个 tab（文件与保存/模型/AI 策略/自动化与权限/通用/关于）；
//       ② 点「模型」→ 里面就是完整的接入面（已接入 / 可接入 / ComfyUI），不再是只读列表；
//       ③ 点「AI 策略」→ 只剩上传边界 + 默认模型策略（MCP 代跑护栏），顶部那段重复的只读连接列表已删。
// 用法：pnpm build && node scripts/settings-models-tab-walkthrough.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-models-walk')
mkdirSync(outDir, { recursive: true })
const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const { app, win } = await launchNomiApp({
  name: 'settings-models',
  settingsDir: makeTempDir('settings-models-set-'),
  projectsDir: makeTempDir('settings-models-proj-'),
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const errors = []
try {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  // ── ① 齿轮进设置 ──
  await win.getByRole('button', { name: '设置', exact: true }).first().click()
  await win.waitForTimeout(900)
  const settings = win.getByRole('dialog', { name: '设置' })
  await shot(win, '01-settings-six-tabs.png') // 验：左侧六个 tab，含「模型」与改名后的「AI 策略」

  // ── ② 模型 tab = 真正的接入面 ──
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.waitForTimeout(900)
  await shot(win, '02-models-tab.png') // 验：能力概览 + 已接入/可接入分组 + 本地 ComfyUI 卡

  const modelsText = await win.evaluate(() => {
    const el = document.querySelector('[data-settings-section="models"]')
    return el ? el.innerText : ''
  })
  for (const needle of ['可接入', 'ComfyUI']) {
    if (!modelsText.includes(needle)) throw new Error(`模型 tab 里没有「${needle}」——接入面没搬进来`)
  }
  console.log('  模型 tab 装的是完整接入面: ✓')

  // ── ③ AI 策略 tab：只剩护栏，重复的只读连接列表已删 ──
  await settings.getByRole('button', { name: 'AI 策略', exact: true }).click()
  await win.waitForTimeout(700)
  await shot(win, '03-ai-policy-tab.png') // 验：数据上传 + 默认模型策略；无「模型连接」段
  const aiText = await win.evaluate(() => {
    const el = document.querySelector('[data-settings-section="ai-models"]')
    return el ? el.innerText : ''
  })
  if (aiText.includes('模型连接')) throw new Error('AI 策略里仍有重复的「模型连接」只读列表')
  if (!aiText.includes('默认模型策略')) throw new Error('AI 策略里的 MCP 代跑护栏被误删')
  console.log('  AI 策略只剩护栏、重复列表已删: ✓')

  // ── ④ 旧模型入口事件兼容：仍统一深链到设置 → 模型 ──
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  await win.waitForSelector('[data-settings-section="models"]')
  const settingsDialogCount = await win.getByRole('dialog', { name: '设置' }).count()
  if (settingsDialogCount !== 1) throw new Error(`旧模型入口打开了 ${settingsDialogCount} 个设置对话框`)
  console.log('  旧模型入口事件统一深链到设置 → 模型: ✓')

  console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 8).join('\n')) : '  ✅ 无 console/page error')
} catch (e) {
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
}
