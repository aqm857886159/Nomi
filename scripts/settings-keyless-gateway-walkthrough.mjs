import { makeTempDir } from './_test-temp.mjs'
// R16 真实任务：把一个无需 Key、没有文档、媒体自检失败的本地网关接进 Nomi。
// 成功标准：UI 不要求 Key；请求不带鉴权头；模型仍启用且有可执行 mapping；旧官方预设仍要求 Key。
// Usage: pnpm build && node scripts/settings-keyless-gateway-walkthrough.mjs
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.settings-keyless-gateway-walk')
const settingsDir = makeTempDir('settings-keyless-gateway-set-')
const projectsDir = makeTempDir('settings-keyless-gateway-proj-')
mkdirSync(outDir, { recursive: true })

const requests = []
const server = createServer((request, response) => {
  requests.push({
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
    apiKey: request.headers['x-api-key'],
  })
  response.setHeader('content-type', 'application/json')
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200)
    response.end(JSON.stringify({ data: [{ id: 'local-image-v1', object: 'model' }] }))
    return
  }
  response.writeHead(404)
  response.end(JSON.stringify({ error: { message: 'Deliberate self-check failure' } }))
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Local gateway did not expose a TCP port')
const baseUrl = `http://127.0.0.1:${address.port}/v1`

const shot = async (win, name) => {
  await win.screenshot({ path: path.join(outDir, name) })
  console.log(`  screenshot: ${name}`)
}

const { app, win } = await launchNomiApp({
  name: 'settings-keyless-gateway',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
  settleMs: 1800,
})

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })).catch(() => {})

  await win.getByRole('button', { name: '设置', exact: true }).first().click()
  const settings = win.getByRole('dialog', { name: '设置' })
  await settings.getByRole('button', { name: '模型', exact: true }).click()
  await win.waitForSelector('[data-settings-section="models"]')
  const generationGroup = win.getByRole('button', { name: /接入生成模型/ }).first()
  if ((await generationGroup.getAttribute('aria-expanded')) !== 'true') await generationGroup.click()
  await win.getByRole('button', { name: '添加模型 / 中转站', exact: true }).click()
  await win.getByRole('button', { name: 'new-api 中转', exact: true }).click()

  const wizard = win.locator('[data-model-settings-page="add"]')
  await wizard.waitFor({ state: 'visible' })
  if (await win.locator('[role="dialog"]').count() !== 1) throw new Error('Adding a model opened a nested dialog')
  const noKeyLabel = wizard.getByText('无需 API Key', { exact: true })
  const noKey = wizard.locator('input[type="checkbox"]').first()
  const keyInput = wizard.getByPlaceholder('sk-...', { exact: true })
  if (!(await noKeyLabel.isVisible()) || !(await keyInput.isVisible())) throw new Error('Custom gateway auth controls are incomplete')
  await noKeyLabel.click()
  if (!(await noKey.isChecked())) throw new Error('No-auth switch did not enter the checked state')
  if (await keyInput.count()) throw new Error('API Key input remained visible in no-auth mode')
  await win.waitForTimeout(200)
  await shot(win, '01-keyless-custom-gateway.png')

  await win.getByRole('button', { name: 'OpenAI', exact: true }).click()
  if (await noKey.count()) throw new Error('Official provider still exposes the no-auth switch')
  if (!(await wizard.getByPlaceholder('sk-...', { exact: true }).isVisible())) throw new Error('Official provider no longer requires an API Key')

  await win.getByRole('button', { name: 'new-api 中转', exact: true }).click()
  const restoredNoKey = wizard.locator('input[type="checkbox"]').first()
  if (await restoredNoKey.isChecked()) throw new Error('Switching presets retained the previous no-auth state')
  await wizard.getByText('无需 API Key', { exact: true }).click()
  await wizard.getByPlaceholder('如：TOAPI 中转', { exact: true }).fill('Local Keyless Gateway')
  await wizard.getByPlaceholder('https://api.openai.com/v1', { exact: true }).fill(baseUrl)
  await win.keyboard.press('Tab')

  const fetched = win.getByText('拉到 1 个模型，还没选', { exact: true })
  await fetched.waitFor({ timeout: 12_000 }).catch(async () => {
    await win.getByRole('button', { name: '拉取模型', exact: true }).click()
    await fetched.waitFor({ timeout: 12_000 })
  })
  await win.getByRole('button', { name: '选择模型 →', exact: true }).click()
  await win.getByRole('button', { name: 'local-image-v1', exact: true }).click()
  await win.getByRole('button', { name: '接入并验证 1 个', exact: true }).click()
  await win.getByText('1 个模型都已经加好了', { exact: true }).waitFor({ timeout: 20_000 })
  await shot(win, '02-failed-self-check-still-added.png')

  const catalog = JSON.parse(readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
  const model = catalog.models.find((item) => item.modelKey === 'local-image-v1')
  const vendor = catalog.vendors.find((item) => item.key === model?.vendorKey)
  const mappings = catalog.mappings.filter((item) => item.vendorKey === vendor?.key && item.modelKey === model?.modelKey)
  if (!vendor || vendor.authType !== 'none' || vendor.enabled !== true) throw new Error('Keyless vendor was not persisted as enabled authType:none')
  if (catalog.apiKeysByVendor[vendor.key]) throw new Error('Keyless vendor persisted an API key record')
  if (!model?.enabled || model?.meta?.adapter?.state !== 'failed') throw new Error('Failed media model state was not recorded honestly')
  if (mappings.length === 0 || mappings.some((mapping) => mapping.enabled !== true)) throw new Error('Failed media candidate has no enabled executable mapping')
  if (requests.some((request) => request.authorization || request.apiKey)) throw new Error('Keyless gateway received an authentication header')

  console.log(`  keyless requests without auth headers: ${requests.length}`)
  console.log(`  failed media mappings published: ${mappings.length}`)
  console.log('  keyless gateway, no-doc fallback, and failed-media execution path: ok')
} catch (error) {
  console.error('  walkthrough failed:', error)
  try { await shot(win, 'ERROR.png') } catch { /* noop */ }
  process.exitCode = 1
} finally {
  await app.close()
  await new Promise((resolve) => server.close(resolve))
}
