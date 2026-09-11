// 探针：点「启用 ComfyUI」后，30 秒内界面上到底有没有出现任何「确认」入口。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from '../../../../tests/ux/_launchApp.mjs'
import { screenshotSettled } from '../../../../tests/ux/_assert.mjs'

const EVID = path.join(repoRoot, 'docs/research/2026-09-11-comfyui-matrix-evidence')
const { app, win } = await launchNomiApp({ name: 'comfy-gate-probe', settleMs: 2000 })
win.setDefaultTimeout(20_000)
const snap = async (n) => { await screenshotSettled(win, { path: path.join(EVID, `${n}.png`) }) }

const scan = async (tag) => {
  const r = await win.evaluate(() => {
    const btns = [...document.querySelectorAll('button,[role="button"]')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean)
    return { hasConfirmWord: btns.filter((b) => /确认|去确认|验证/.test(b)), badge: document.body.innerText.match(/未启用|已启用|已连接/g), buttons: btns.slice(0, 40) }
  })
  console.log(`[${tag}]`, JSON.stringify(r, null, 0))
  return r
}

try {
  await win.getByRole('button', { name: '连接模型' }).first().click()
  await win.waitForTimeout(2500)
  await win.getByText('本地 ComfyUI', { exact: true }).first().click()
  await win.waitForTimeout(1500)
  await scan('before-enable')
  await win.getByRole('button', { name: /启用 ComfyUI/ }).first().click()
  for (const s of [500, 1000, 1500, 2000, 3000, 5000, 8000, 12000]) {
    await win.waitForTimeout(s === 500 ? 500 : 1500)
    const r = await scan(`t+${s}`)
    if (r.hasConfirmWord.length) { await snap(`P-confirm-visible-${s}`); break }
  }
  await snap('P-final')
  // 再点一次「启用」看会不会给出确认入口
  const again = win.getByRole('button', { name: /启用 ComfyUI/ }).first()
  if (await again.isVisible().catch(() => false)) {
    await again.click()
    await win.waitForTimeout(4000)
    await scan('second-enable')
    await snap('P-second-enable')
  }
  // 关掉设置，看主界面有没有待确认提示
  await win.keyboard.press('Escape')
  await win.waitForTimeout(2500)
  await scan('settings-closed')
  await snap('P-settings-closed')
} catch (e) { console.error('FAILED', e); await snap('P-error').catch(() => {}) }
console.log('DONE')
await app.close().catch(() => {})
