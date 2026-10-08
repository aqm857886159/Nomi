// R13/R16: real Electron UI + real HTTP probe, no mocked validation or paid requests.
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const locale = process.env.NOMI_E2E_LOCALE === 'en' ? 'en' : 'zh-CN'
const shotPrefix = locale === 'en' ? 'en-' : ''
const shots = path.join(root, 'docs/fixes/2026-10-08-money-copy')
fs.mkdirSync(shots, { recursive: true })
const L = locale === 'en'
  ? { settings: 'Settings', save: 'Save Verify', back: 'Back', replace: 'Replace key', saved: 'Saved · Not verified', reconnect: 'checked again when connected' }
  : { settings: '设置', save: '保存验证', back: '返回', replace: '更换密钥', saved: '已保存 · 未验证', reconnect: '联网后会自动复验' }
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
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light', ...(locale === 'en' ? { 'nomi:locale:v1': 'en' } : {}) },
})
const { win, app } = launched
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000))
  await win.evaluate((baseUrlHint) => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(item => item.key === 'apimart')
    catalog.upsertVendor({ ...vendor, baseUrlHint })
  }, `http://127.0.0.1:${port}/v1`)
  await win.locator(`button[aria-label*="${L.settings}"]`).first().click()
  await win.locator('[data-settings-tab-id="models"]').click()
  await win.locator('[data-model-home-available="apimart"]').click()
  const page = win.locator('[data-key-only-vendor="apimart"]')
  await page.locator('input[type="password"]').fill('fixture-offline-key')
  await screenshotSettled(win, { path: path.join(shots, `${shotPrefix}00-key-prompt.png`) })
  await page.getByRole('button', { name: L.save, exact: true }).click()
  await expect(page.locator('[data-key-only-success]')).toContainText(L.saved)
  await expect(page.locator('[data-key-only-success]')).toContainText(L.reconnect)
  const pending = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(item => item.key === 'apimart'))
  expect(pending.credentialBinding).toBeTruthy()
  expect(pending.credentialVerificationPending).toBe(true)
  expect(pending.enabled).toBe(false)
  await screenshotSettled(win, { path: path.join(shots, `${shotPrefix}01-offline-saved.png`) })
  console.log(`PASS: ${locale} key prompt + save state; no generation request`)
} finally {
  await launched.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
