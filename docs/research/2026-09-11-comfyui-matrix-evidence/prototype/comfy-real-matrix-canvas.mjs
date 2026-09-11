// 第④步：接完 ComfyUI 后，画布上到底能不能选到 ComfyUI 的模型、能不能点生成。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../../../../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../../../../tests/ux/_assert.mjs'

const EVID = path.join(repoRoot, 'docs/research/2026-09-11-comfyui-matrix-evidence')
const { app, win } = await launchNomiApp({ name: 'comfy-canvas', settleMs: 2000 })
win.setDefaultTimeout(25_000)
const snap = async (n) => { await screenshotSettled(win, { path: path.join(EVID, `${n}.png`) }); console.log(`  shot: ${n}.png`) }
const dump = async (l) => { const t = await win.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n')); console.log(`--- DOM(${l}) ---\n${t.slice(0, 3500)}\n--- /DOM ---`); return t }

try {
  // 先照真人路径接上 ComfyUI
  await win.getByRole('button', { name: '连接模型' }).first().click(); await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click(); await win.waitForTimeout(1500)
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click(); await win.waitForTimeout(6000)
  const close = win.getByRole('button', { name: '关闭' }).first()
  if (await close.isVisible().catch(() => false)) await close.click()
  await win.waitForTimeout(2500)
  await snap('D0-settings-closed')

  // 建项目进画布
  await win.getByRole('button', { name: /新建空白项目/ }).first().click()
  await win.waitForTimeout(8000)
  await snap('D1-project')
  await dump('project')

  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(6000)
  await snap('D2-canvas')
  const t = await dump('canvas')
  console.log('HAS_COMFY_TEXT=' + /ComfyUI|本地 · 文生图/.test(t))
  // 打开模型选择器
  for (const sel of ['选择模型', '选模型', '模型']) {
    const b = win.getByRole('button', { name: new RegExp(sel) }).first()
    if (await b.isVisible().catch(() => false)) { await b.click(); await win.waitForTimeout(3500); break }
  }
  await snap('D3-model-picker')
  const t2 = await dump('model-picker')
  console.log('PICKER_HAS_COMFY=' + /ComfyUI|本地 · 文生图/.test(t2))
  await win.mouse.click(450, 250); await win.waitForTimeout(1500)
  // 节点自己的模型选择器
  await win.getByRole('button', { name: /新建画面/ }).first().click({ timeout: 20000 }).catch(async () => {
    console.log('新建画面 blocked; trying left rail image tool')
    await win.mouse.click(99, 382)
  })
  await win.waitForTimeout(5000)
  await snap('D4-node-created')
  const t3 = await dump('node-created')
  console.log('NODE_HAS_COMFY=' + /ComfyUI|本地 · 文生图/.test(t3))
  const chip = win.locator('[data-testid*="model"], button:has-text("自动选"), button:has-text("选择模型")').first()
  if (await chip.isVisible().catch(() => false)) { await chip.click(); await win.waitForTimeout(3500) }
  await snap('D5-node-model-picker')
  const t4 = await dump('node-model-picker')
  console.log('NODE_PICKER_HAS_COMFY=' + /ComfyUI|本地 · 文生图/.test(t4))
} catch (e) { console.error('FAILED', e); await snap('D-error').catch(() => {}) }
console.log('DONE')
await app.close().catch(() => {})
