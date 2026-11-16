// R13/R16: real Electron UI + real HTTP probe, no mocked validation or paid requests.
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// NOMI_WALK_LOCALE=en walks the English UI; shots land in a per-locale folder so zh/en frames never overwrite each other.
const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const COPY = locale === 'en'
  ? { save: 'Save Verify', offline: 'Not verified', offlineHint: 'You can use the model now', rechecked: 'preset models ready', recheckedHint: 'already selectable', replace: 'Replace key', back: 'Back', stored: 'is stored on this machine', kept: 'previous' }
  : { save: '保存验证', offline: '未验证', offlineHint: '可以直接选择模型并使用', rechecked: '预置模型可用', recheckedHint: '现在就能在画布', replace: '更换密钥', back: '返回', stored: '已经存着', kept: '原密钥' }
// 2026-11-17「没验证的也能用」：离线存下的密钥不再停用连接——连接和密钥都启用、只挂「未验证」提醒，
// 这一家落在「已接入」行；联网复验清掉提醒后，预置模型本来就可用，卡片说的是「已接入，预置模型可用」。
const shots = path.join(root, 'tests/ux/shots/credential-offline', locale === 'en' ? 'en' : 'zh')
fs.mkdirSync(shots, { recursive: true })
const server = http.createServer((req, res) => {
  const valid = req.headers.authorization === 'Bearer fixture-offline-key'
  res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(valid ? { data: [{ id: 'fixture-model' }] } : { error: { message: 'Invalid API key' } }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
const launched = await launchNomiApp({
  name: 'credential-offline', syntheticCredentialStorage: true,
  env: { NODE_ENV: 'production' }, args: ['--no-proxy-server', '--disable-gpu'],
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light', 'nomi:locale:v1': locale },
})
const { win, app } = launched
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000))
  await win.evaluate(async (baseUrlHint) => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = (await catalog.listVendors()).find(item => item.key === 'apimart')
    catalog.upsertVendor({ ...vendor, baseUrlHint })
  }, `http://127.0.0.1:${port}/v1`)
  await win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click()
  await win.locator('[data-settings-tab-id="models"]').click()
  await win.locator('[data-model-home-available="apimart"]').click()
  const page = win.locator('[data-key-only-vendor="apimart"]')
  await page.locator('input[type="password"]').fill('fixture-offline-key')
  await page.getByRole('button', { name: COPY.save, exact: true }).click()
  await expect(page.locator('[data-key-only-success]')).toContainText(COPY.offline)
  await expect(page.locator('[data-key-only-success]')).toContainText(COPY.offlineHint)
  const pending = await win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listVendors()).find(item => item.key === 'apimart'))
  expect(pending.hasApiKey).toBe(true)
  expect(pending.credentialMaterialSaved).toBe(true)
  expect(pending.credentialVerificationPending).toBe(true)
  expect(pending.enabled).toBe(true)
  await screenshotSettled(win, { path: path.join(shots, '01-offline-saved.png') })
  // 已接入的连接从首页点进去是连接工作区，不再是这张填 key 卡（接入流程页面结构不变），所以留在卡上走完复验与换 key；
  // 「未验证」来自落盘状态：上面读回的目录 DTO 已证明，不只是这次保存的返回值。
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  await win.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listVendors()).find(item => item.key === 'apimart').credentialVerificationPending)).toBe(false)
  await expect(page.locator('[data-key-only-success]')).not.toContainText(COPY.offline)
  await expect(page.locator('[data-key-only-success]')).toContainText(COPY.rechecked)
  await expect(page.locator('[data-key-only-success]')).toContainText(COPY.recheckedHint)
  await screenshotSettled(win, { path: path.join(shots, '02-revalidated.png') })
  await page.getByRole('button', { name: COPY.replace, exact: true }).click()
  await page.locator('input[type="password"]').fill('fixture-rejected-key')
  await page.getByRole('button', { name: COPY.save, exact: true }).click()
  await expect(page.locator('[aria-invalid="true"]')).toBeVisible()
  await expect(page).toContainText(COPY.kept)
  // The rejected replacement kept the old key, so the stored-key line must say it is stored.
  await expect(page.locator('[data-vendor-key-stored="yes"]')).toContainText(COPY.stored)
  // A second real probe succeeds only if the previous key survived the 401 replacement.
  const health = await win.evaluate(() => window.nomiDesktop.onboarding.vendorHealth({ vendorKey: 'apimart', force: true }))
  expect(health.state).toBe('reachable')
  await screenshotSettled(win, { path: path.join(shots, '03-rejected-keeps-key.png') })
  // 回到首页：这一家在「已接入」里（离线保存那一刻起就在，不再落回「可接入」）。
  await win.getByRole('button', { name: COPY.back, exact: true }).click()
  await expect(win.locator('[data-model-home-connection="apimart"]')).toBeVisible()
  await screenshotSettled(win, { path: path.join(shots, '01b-home-row-badge.png') })
  console.log('PASS: offline save keeps the connection on with a not-verified badge, online automatic revalidation, 401 preserves old key; zero paid calls')
} finally {
  await launched.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
