// 第一阶段真实旅程：两家同模型 → 设置偏好 → 打开生成节点模型框 → 点另一家 chip。
// 只写隔离目录的占位凭据；生成请求可由 VENDOR_ORDER_GENERATE=1 的 fixture runner 接管。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/vendor-order')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vendor-order-'))
const { app, win } = await launchNomiApp({
  name: 'vendor-preference-order',
  userDataDir: path.join(tempRoot, 'user-data'),
  settingsDir: path.join(tempRoot, 'user-data'),
  projectsDir: path.join(tempRoot, 'projects'),
  capabilityDir: path.join(tempRoot, 'capability'),
  syntheticCredentialStorage: true,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

const snap = async (name, target = win) => {
  await screenshotSettled(target, { path: path.join(shotsDir, name) })
  console.log(`  · ${name}`)
}
const assert = (condition, message) => { if (!condition) throw new Error(`WALK FAIL: ${message}`) }

try {
  await win.waitForTimeout(1200)
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi:splash:v1', 'seen')
    localStorage.setItem('nomi:journey-tour:v1', 'seen')
  })
  await win.reload()
  await win.waitForTimeout(1200)
  await win.evaluate(() => Promise.all([
    window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: 'nomi-vendor-order-a', enabled: true }),
    window.nomiDesktop.modelCatalog.upsertVendorApiKey('kie', { apiKey: 'nomi-vendor-order-b', enabled: true }),
  ]))
  await win.reload()
  await win.waitForTimeout(1200)

  const settingsTrigger = win.locator('[data-testid="open-model-settings"], [aria-label="打开模型设置"]').first()
  await settingsTrigger.waitFor({ timeout: 15_000 })
  await settingsTrigger.click()
  await expectVisible(win.locator('[data-model-settings-page="home"]'), '模型设置首页')
  const preference = win.locator('[data-vendor-preference-order]')
  await expectVisible(preference, '优先供应商排序控件')
  await snap('05-settings-vendor-order.png', preference)

  const rows = preference.locator('[data-vendor-preference-row]')
  assert(await rows.count() >= 2, '至少两家已配置供应商出现在排序控件')
  const first = await rows.first().getAttribute('data-vendor-preference-row')
  const secondDown = rows.first().getByRole('button', { name: /下移|Move down/ })
  await secondDown.click()
  await win.waitForTimeout(350)
  const moved = await preference.locator('[data-vendor-preference-row]').first().getAttribute('data-vendor-preference-row')
  assert(moved !== first, '上移/下移后顺序真实改变并写入设置')

  await win.locator('[data-settings-close]').first().click().catch(() => win.keyboard.press('Escape'))
  const create = win.getByRole('button', { name: /新建空白项目|New blank project/ }).first()
  if (await create.isVisible().catch(() => false)) await create.click()
  else await win.getByRole('button', { name: /^生成$|^Generate$/ }).first().click()
  await win.waitForTimeout(1800)
  const imageNode = win.locator('[data-node-kind="image"]').first()
  if (await imageNode.isVisible().catch(() => false)) await imageNode.click()
  const modelButton = win.locator('.generation-canvas-v2-node__composer [aria-label="模型"], .generation-canvas-v2-node__composer-card [aria-label="模型"]').first()
  await expectVisible(modelButton, '生成节点模型选择框')
  await modelButton.click()
  const options = win.locator('[role="option"]:visible')
  await options.first().waitFor({ timeout: 8_000 })
  const chips = win.locator('[role="option"]:visible button[aria-pressed]')
  assert(await chips.count() > 0, '模型行尾显示供应商 chips')
  await snap('01-picker-preferred.png')
  await chips.last().click()
  await win.waitForTimeout(500)
  await snap('02-picker-no-preference.png')
  console.log('vendor preference picker journey passed (selection path verified; generation fixture is opt-in)')
} finally {
  await app.close().catch(() => {})
}
