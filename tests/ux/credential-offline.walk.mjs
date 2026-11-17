// R13/R16: real Electron UI + real loopback HTTP, no mocked validation or paid requests.
//
// 2026-11-18 D-1117-delete-verification：保存只做一件事——存 key。
//   ① 离线（服务没开）存下就是存下：连接启用、预置模型可用，界面不说「未验证」，联网后也没有自动复验这回事；
//   ② 只有服务明确回 401 / 403 才不存（F1），旧 key 原样留着，「是否已存」那一行照存储事实说「已经存着」；
//   ③ 旧 key 真的还在：用主进程按 vendorKey 自取凭据的拉清单口去问回环服务，回环服务只认旧 key。
// 文案一律取词典，不在走查里另抄。
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { uiText, uiTextPattern } from './full-walk/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// NOMI_WALK_LOCALE=en walks the English UI; shots land in a per-locale folder so zh/en frames never overwrite each other.
const locale = process.env.NOMI_WALK_LOCALE === 'en' ? 'en' : 'zh-CN'
const text = (key) => uiText(locale, key)
const pattern = (key) => new RegExp(uiTextPattern(text(key)))
// 退役的说法（和 src/ui/onboarding/unverifiedUsableCopy.test.ts 同一组意思）：存 key 之后界面一个都不许出现。
const RETIRED = locale === 'en' ? /not (yet )?verified|unverified|verification|re-?check/i : /未验证|待验证|验证中|复验|验证/
const shots = path.join(root, 'tests/ux/shots/credential-offline', locale === 'en' ? 'en' : 'zh')
fs.mkdirSync(shots, { recursive: true })
const seen = []
const server = http.createServer((req, res) => {
  seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`)
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
const apimart = () => win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listVendors()).find(item => item.key === 'apimart'))
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
  const success = page.locator('[data-key-only-success]')

  // ① 离线保存：服务没开，存下就是存下。
  await page.locator('input[type="password"]').fill('fixture-offline-key')
  await page.getByRole('button', { name: text('onboardingProviders.keyOnly.save'), exact: true }).click()
  await expect(success).toContainText(pattern('onboardingProviders.keyOnly.publishedTitle'))
  await expect(success).not.toContainText(RETIRED)
  const offline = await apimart()
  expect(offline.hasApiKey).toBe(true)
  expect(offline.credentialMaterialSaved).toBe(true)
  expect(offline.enabled).toBe(true)
  expect('credentialVerificationPending' in offline, '旧的「待验证」字段不该再出现在目录 DTO 上').toBe(false)
  await screenshotSettled(win, { path: path.join(shots, '01-offline-saved.png') })

  // 联网：没有自动复验——服务开起来、发一次 online，什么都不会去探，卡片也不变。
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  await win.evaluate(() => window.dispatchEvent(new Event('online')))
  await win.waitForTimeout(1500)
  expect(seen, '联网后不该有任何「复验」请求').toEqual([])
  await expect(success).toContainText(pattern('onboardingProviders.keyOnly.publishedTitle'))

  // ② 换一把服务明确拒绝的 key：不存，旧 key 留着，「是否已存」照存储事实说。
  await page.getByRole('button', { name: text('onboardingProviders.keyOnly.replaceKey'), exact: true }).click()
  await page.locator('input[type="password"]').fill('fixture-rejected-key')
  await page.getByRole('button', { name: text('onboardingProviders.keyOnly.save'), exact: true }).click()
  await expect(page.locator('[aria-invalid="true"]')).toBeVisible()
  await expect(page).toContainText(locale === 'en' ? 'previous' : '原密钥')
  await expect(page.locator('[data-vendor-key-stored="yes"]')).toContainText(pattern('onboardingProviders.keyOnly.storedYes'))
  await screenshotSettled(win, { path: path.join(shots, '02-rejected-keeps-key.png') })

  // ③ 旧 key 真的还在：主进程按 vendorKey 自取凭据去拉清单，回环服务只认旧 key。
  const listed = await win.evaluate(() => window.nomiDesktop.onboarding.httpConnectionListModels({ vendorKey: 'apimart' }))
  expect(listed?.ok, `按已存凭据拉清单没成功：${JSON.stringify(listed)}`).toBe(true)
  expect(seen.some(line => line.endsWith('Bearer fixture-offline-key')), '拉清单带的不是旧 key').toBe(true)

  // 回到首页：这一家在「已接入」里，行尾是五个状态词之一，不是「未验证」。
  await win.locator('[data-model-settings-back]').click()
  const row = win.locator('[data-model-home-connection="apimart"]')
  await expect(row).toBeVisible()
  await expect(row).not.toContainText(RETIRED)
  await screenshotSettled(win, { path: path.join(shots, '03-home-row.png') })
  console.log('PASS: offline save stores and publishes, no revalidation on reconnect, 401 replacement keeps the old key; zero paid calls')
} finally {
  await launched.close()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
