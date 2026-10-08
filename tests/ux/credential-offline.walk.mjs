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
  ? { save: 'Save Verify', offline: 'Saved · Not verified', offlineHint: 'checked again when connected', rechecked: 'Key confirmed · Models not verified', recheckedHint: 'verify each model', replace: 'Replace key', back: 'Back', stored: 'is stored on this machine', kept: 'previous' }
  : { save: '保存验证', offline: '已保存 · 未验证', offlineHint: '联网后会自动复验', rechecked: '已复验 · 模型未验证', recheckedHint: '逐个验证模型', replace: '更换密钥', back: '返回', stored: '已经存着', kept: '原密钥' }
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
  await win.evaluate((baseUrlHint) => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(item => item.key === 'apimart')
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
  const pending = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(item => item.key === 'apimart'))
  expect(pending.hasApiKey).toBe(false)
  expect(pending.credentialMaterialSaved).toBe(true)
  expect(pending.credentialVerificationPending).toBe(true)
  expect(pending.enabled).toBe(false)
  await screenshotSettled(win, { path: path.join(shots, '01-offline-saved.png') })
  // Back/reopen proves the badge is sourced from persisted state, not just the save response.
  await win.getByRole('button', { name: COPY.back, exact: true }).click()
  await expect(win.locator('[data-model-home-available="apimart"]')).toContainText(COPY.offline)
  // Same shared badge on the settings home row (not a hand-written pill).
  await screenshotSettled(win, { path: path.join(shots, '01b-home-row-badge.png') })
  await win.locator('[data-model-home-available="apimart"]').click()
  await expect(page.locator('[data-key-only-success]')).toContainText(COPY.offline)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  await win.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(item => item.key === 'apimart').credentialVerificationPending)).toBe(false)
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
  console.log('PASS: offline save + persistent badge, online automatic revalidation, 401 preserves old key; zero paid calls')
} finally {
  await launched.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
