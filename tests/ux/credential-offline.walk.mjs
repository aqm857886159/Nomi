// R13/R16: real Electron UI + real HTTP probe, no mocked validation or paid requests.
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shots = path.join(root, 'tests/ux/shots/credential-offline')
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
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light' },
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
  await page.getByRole('button', { name: '保存验证', exact: true }).click()
  await expect(page.locator('[data-key-only-success]')).toContainText('已保存 · 未验证')
  await expect(page.locator('[data-key-only-success]')).toContainText('联网后会自动复验')
  const pending = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(item => item.key === 'apimart'))
  expect(pending.hasApiKey).toBe(true)
  expect(pending.credentialVerificationPending).toBe(true)
  expect(pending.enabled).toBe(false)
  await screenshotSettled(win, { path: path.join(shots, '01-offline-saved.png') })
  // Back/reopen proves the badge is sourced from persisted state, not just the save response.
  await win.getByRole('button', { name: '返回', exact: true }).click()
  await expect(win.locator('[data-model-home-available="apimart"]')).toContainText('已保存 · 未验证')
  await win.locator('[data-model-home-available="apimart"]').click()
  await expect(page.locator('[data-key-only-success]')).toContainText('已保存 · 未验证')
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  await win.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(item => item.key === 'apimart').credentialVerificationPending)).toBe(false)
  await expect(page.locator('[data-key-only-success]')).not.toContainText('已保存 · 未验证')
  await screenshotSettled(win, { path: path.join(shots, '02-revalidated.png') })
  await page.getByRole('button', { name: '更换密钥', exact: true }).click()
  await page.locator('input[type="password"]').fill('fixture-rejected-key')
  await page.getByRole('button', { name: '保存验证', exact: true }).click()
  await expect(page.locator('[aria-invalid="true"]')).toBeVisible()
  await expect(page).toContainText('原密钥')
  // A second real probe succeeds only if the previous key survived the 401 replacement.
  const health = await win.evaluate(() => window.nomiDesktop.onboarding.vendorHealth({ vendorKey: 'apimart', force: true }))
  expect(health.state).toBe('reachable')
  await screenshotSettled(win, { path: path.join(shots, '03-rejected-keeps-key.png') })
  console.log('PASS: offline save + persistent badge, online automatic revalidation, 401 preserves old key; zero paid calls')
} finally {
  await launched.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
