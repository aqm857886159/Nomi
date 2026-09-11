// 聚焦实验：ComfyUI 启用 → 验证确认 的真实路径（像真人一样点）。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../../../../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../../../../tests/ux/_assert.mjs'

const EVID = path.join(repoRoot, 'docs/research/2026-09-11-comfyui-matrix-evidence')
fs.mkdirSync(EVID, { recursive: true })
const { app, win } = await launchNomiApp({ name: 'comfy-connect', settleMs: 2000 })
win.setDefaultTimeout(20_000)
const snap = async (n) => { await screenshotSettled(win, { path: path.join(EVID, `${n}.png`) }); console.log(`  shot: ${n}.png`) }
const dump = async (l) => { const t = await win.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n')); console.log(`--- DOM(${l}) ---\n${t}\n--- /DOM ---`); return t }

try {
  await win.getByRole('button', { name: '连接模型' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click()
  await win.waitForTimeout(6000)
  await snap('C1-after-enable')
  await dump('after-enable')

  // 真人会去点 toast 上的「去确认」
  const go = win.getByRole('button', { name: /去确认/ }).first()
  console.log('去确认 visible =', await go.isVisible().catch(() => false))
  if (await go.isVisible().catch(() => false)) {
    await go.click()
    await win.waitForTimeout(3000)
    await snap('C2-confirm-panel')
    await dump('confirm-panel')
    const ok = win.getByRole('button', { name: /^确认验证$/ }).first()
    console.log('确认验证 visible =', await ok.isVisible().catch(() => false), 'enabled =', await ok.isEnabled().catch(() => false))
    await ok.click()
    for (const s of [8000, 15000, 25000]) {
      await win.waitForTimeout(s)
      await snap(`C3-after-confirm-${s}`)
      await dump(`after-confirm-${s}`)
    }
  }
} catch (e) {
  console.error('FAILED', e)
  await snap('C-error').catch(() => {})
}
console.log('DONE')
await app.close().catch(() => {})
