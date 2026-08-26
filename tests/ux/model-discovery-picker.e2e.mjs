// Component-level liveness/selection tests; production Electron journeys live in the companion walk.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { expect, clickOrFail } from './_assert.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/model-discovery/index.html`)
  await page.waitForLoadState('networkidle')
  const picker = page.getByTestId('picker')
  const refresh = picker.getByRole('button', { name: /获取可用模型|重新获取列表/ })
  await clickOrFail(refresh, 'Fetch models')
  await clickOrFail(picker.getByRole('button', { name: 'flux-image', exact: true }), 'Select image')
  await clickOrFail(page.getByRole('button', { name: 'Change remote list', exact: true }), 'Change upstream response')
  await clickOrFail(refresh, 'Refresh changed list')
  await expect(picker.getByRole('button', { name: 'flux-image', exact: true })).toBeVisible()
  await clickOrFail(picker.getByRole('button', { name: '保存 1 个模型', exact: true }), 'Save retained selection')
  await expect(page.getByTestId('saved')).toHaveText(JSON.stringify([{ id: 'flux-image', kind: 'image' }]))

  await clickOrFail(page.getByRole('button', { name: 'Delay alpha', exact: true }), 'Delay old connection')
  await clickOrFail(refresh, 'Start then cancel a delayed fetch')
  await expect(page.getByTestId('pending')).toHaveText('true')
  await clickOrFail(page.getByRole('button', { name: 'Cancel pending', exact: true }), 'Leave selection page')
  await clickOrFail(page.getByRole('button', { name: 'Release alpha', exact: true }), 'Release cancelled reply')
  await expect(page.getByTestId('pending')).toHaveText('false')
  await expect(refresh).toBeEnabled()
  expect((await picker.locator('button span.text-body-sm').allTextContents()).sort()).toEqual(['flux-image', 'gpt-text'])

  await clickOrFail(refresh, 'Start delayed fetch')
  await expect(page.getByTestId('pending')).toHaveText('true')
  await clickOrFail(page.getByRole('button', { name: 'Switch beta', exact: true }), 'Switch connection')
  await clickOrFail(refresh, 'Fetch new connection')
  await expect(picker.getByRole('button', { name: 'beta-text', exact: true })).toBeVisible()
  await clickOrFail(page.getByRole('button', { name: 'Release alpha', exact: true }), 'Release stale reply')
  await expect(page.getByTestId('pending')).toHaveText('false')
  expect(await picker.locator('button span.text-body-sm').allTextContents()).toEqual(['beta-text'])
  await expect(refresh).toBeEnabled()
  console.log('PASS picker retains selected model/type on changed list and rejects stale connection response')
} finally {
  await browser?.close()
  await server.close()
}
