// 探针：导入一张工作流后，(a) 不碰验证弹层 / (b) 点确认验证，两种情况下工作流是否真的留下来。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../../../../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../../../../tests/ux/_assert.mjs'

const EVID = path.join(repoRoot, 'docs/research/2026-09-11-comfyui-matrix-evidence')
const WF = path.join(EVID, 'workflows')
const MODE = process.env.PROBE_MODE ?? 'confirm' // 'confirm' | 'skip'
const tempRoot = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', `comfy-import-probe-${MODE}-`))
const settingsDir = path.join(tempRoot, 'settings')
fs.mkdirSync(settingsDir, { recursive: true })
console.log('PROFILE=' + tempRoot + ' MODE=' + MODE)

const { app, win } = await launchNomiApp({ name: `comfy-import-${MODE}`, tempRoot, settingsDir, settleMs: 2000 })
win.setDefaultTimeout(20_000)
win.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`  RENDERER-${m.type()}: ${m.text().slice(0, 300)}`) })
win.on('pageerror', (e) => console.log(`  PAGEERROR: ${String(e).slice(0, 300)}`))
const snap = async (n) => { await screenshotSettled(win, { path: path.join(EVID, `${n}.png`) }); console.log(`  shot: ${n}.png`) }
const dump = async (l) => { const t = await win.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n')); console.log(`--- DOM(${l}) ---\n${t}\n--- /DOM ---`); return t }

try {
  await win.getByRole('button', { name: '连接模型' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click()
  await win.waitForTimeout(6000)

  await win.getByRole('button', { name: '自定义' }).first().click()
  await win.waitForTimeout(1200)
  await win.locator('textarea').first().fill(fs.readFileSync(path.join(WF, 'row1b-sd15-txt2img-ckpt-corrected-api.json'), 'utf8'))
  await win.getByRole('button', { name: /^分析$/ }).first().click()
  await win.waitForTimeout(9000)
  await win.getByPlaceholder(/给它起个名/).first().fill('PROBE 文生图')
  await win.getByRole('button', { name: /^导入$/ }).first().click()
  await win.waitForTimeout(6000)
  await snap(`PB-${MODE}-01-gate`)

  if (MODE === 'confirm') {
    const ok = win.getByRole('button', { name: /^确认验证$/ }).first()
    if (await ok.isVisible().catch(() => false)) { await ok.click(); await win.waitForTimeout(40000) }
  } else {
    // 真人可能直接关掉这个弹层继续用
    const x = win.locator('[aria-label="关闭"]').first()
    if (await x.isVisible().catch(() => false)) await x.click()
    await win.waitForTimeout(3000)
  }
  await snap(`PB-${MODE}-02-after`)
  await dump(`${MODE}-after`)

  // 重新打开设置 → 模型 → ComfyUI，看工作流在不在
  await win.keyboard.press('Escape'); await win.waitForTimeout(1500)
  await win.getByRole('button', { name: '设置' }).first().click(); await win.waitForTimeout(2000)
  await win.getByRole('button', { name: '模型' }).first().click(); await win.waitForTimeout(2500)
  await snap(`PB-${MODE}-03-reopened`)
  const t = await dump(`${MODE}-reopened`)
  console.log('WORKFLOW_PRESENT=' + t.includes('PROBE 文生图'))
} catch (e) { console.error('FAILED', e); await snap(`PB-${MODE}-error`).catch(() => {}) }

const cat = path.join(settingsDir, 'model-catalog.json')
if (fs.existsSync(cat)) {
  const raw = fs.readFileSync(cat, 'utf8')
  const d = JSON.parse(raw)
  console.log('CATALOG vendor comfy =', JSON.stringify(d.vendors.find((v) => v.key === 'comfyui-local')))
  console.log('CATALOG has PROBE =', raw.includes('PROBE 文生图'))
  console.log('CATALOG comfy models =', JSON.stringify(d.models.filter((m) => m.vendorKey === 'comfyui-local').map((m) => [m.modelKey, m.labelZh, m.enabled])))
}
console.log('DONE')
await app.close().catch(() => {})
