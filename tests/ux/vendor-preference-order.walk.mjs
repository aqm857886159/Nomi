// 第一阶段真实旅程：两家同模型 → 设置偏好 → 选择器折叠 → 点另一家 chip → 真实生成一次。
// 外部供应商只由隔离 loopback 代替；Electron、IPC、选择器、付费确认、生成和项目持久化走生产路径。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/vendor-order')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-vendor-order-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-09-06T00:00:00.000Z'
const MODEL = 'vendor-order-image-fixture'
const VENDORS = [{ key: 'apimart', name: 'APIMart' }, { key: 'kie', name: 'Kie' }]
const imageBytes = fs.readFileSync(path.join(repoRoot, 'resources/onboarding-demo/shot-4.jpg'))
const imageDataUrl = `data:image/jpeg;base64,${imageBytes.toString('base64')}`
const wireCalls = []

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve({}) } })
  })
}
const vendorServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/images/generations') { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'route not found' } })); return }
  const body = await readJsonBody(req)
  wireCalls.push({ model: String(body.model || ''), prompt: String(body.prompt || ''), authorization: req.headers.authorization || '' })
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ url: imageDataUrl }] }))
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const port = vendorServer.address().port
function imageMapping(vendorKey) {
  return { id: `${vendorKey}-${MODEL}-text_to_image`, vendorKey, modelKey: MODEL, taskKind: 'text_to_image', name: `${vendorKey} fixture`, enabled: true,
    create: { method: 'POST', path: '/v1/images/generations', headers: { 'Content-Type': 'application/json' }, body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}', size: '{{request.params.size}}' }, response_mapping: { image_url: 'data.0.url' }, defaultParams: { size: '1024x1024' } }, createdAt: NOW, updatedAt: NOW }
}
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: VENDORS.map(({ key, name }) => ({ key, name, enabled: true, baseUrlHint: `http://127.0.0.1:${port}`, authType: 'none', providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW })),
  models: VENDORS.map(({ key }) => ({ modelKey: MODEL, vendorKey: key, labelZh: '供应商偏好 fixture', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image'], meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW })),
  mappings: VENDORS.map(({ key }) => imageMapping(key)), apiKeysByVendor: {},
}, null, 2))

const check = (condition, message) => { if (!condition) throw new Error(`WALK FAIL: ${message}`); console.log(`  ✓ ${message}`) }
const snap = async (win, name, target = win) => { const file = path.join(shotsDir, name); await screenshotSettled(target, { path: file }); console.log(`  · ${name}`); return file }
const findProjectJson = (root) => { const stack = [root]; while (stack.length) { const current = stack.pop(); for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const full = path.join(current, entry.name); if (entry.isDirectory()) stack.push(full); else if (entry.name === 'project.json' && full.includes(`${path.sep}.nomi${path.sep}`)) return full } } return null }
const dismissFirstRun = async (win) => { await win.evaluate(() => { localStorage.setItem('__nomiE2E', '1'); for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) localStorage.setItem(key, 'seen') }); await win.reload(); await win.waitForTimeout(1200) }
const spendDialog = async (win) => { const dialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last(); await dialog.waitFor({ timeout: 8000 }); return dialog }

let app
let win
try {
  ({ app, win } = await launchNomiApp({ name: 'vendor-preference-order', userDataDir, settingsDir, projectsDir, syntheticCredentialStorage: true, args: ['--no-proxy-server'], settleMs: 1200 }))
  await dismissFirstRun(win)
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 }); await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 5000 }); await win.waitForTimeout(1000)
  await win.getByRole('button', { name: /打开模型设置/ }).first().click({ timeout: 5000 })
  await win.locator('[data-model-settings-page="home"]').waitFor({ timeout: 5000 })
  const preference = win.locator('[data-vendor-preference-order]'); await preference.waitFor({ timeout: 5000 }); await snap(win, '05-settings-vendor-order.png', preference)
  const rows = preference.locator('[data-vendor-preference-row]'); check(await rows.count() === 2, '设置里只列两家已配置供应商')
  const first = await rows.first().getAttribute('data-vendor-preference-row'); await rows.first().getByRole('button', { name: /下移|Move down/ }).click(); await win.waitForTimeout(350)
  check(await rows.first().getAttribute('data-vendor-preference-row') !== first, '调整偏好顺序后设置已更新')
  await win.locator('[data-settings-close]').first().click().catch(() => win.keyboard.press('Escape'))
  await win.locator('[aria-label="添加图片节点"]').first().click({ timeout: 5000 }); await win.waitForTimeout(800)
  const node = win.locator('[data-kind="image"][data-node-id]').last(); await node.waitFor({ timeout: 5000 }); const nodeId = await node.getAttribute('data-node-id')
  await node.locator('div[contenteditable="true"]').last().fill('供应商偏好真实生成验收图')
  await node.locator('button[aria-label="模型"]').first().click({ timeout: 5000 })
  const option = win.getByRole('option').filter({ hasText: '供应商偏好 fixture' }).first(); await option.waitFor({ timeout: 8000 })
  const chips = option.locator('button[aria-pressed]'); check(await chips.count() === 2, '同一模型折叠为一行并显示两家供应商 chip')
  await snap(win, '01-picker-preferred.png'); await chips.last().click(); await snap(win, '02-picker-alternate-chip.png'); await win.keyboard.press('Escape')
  await node.locator('button[aria-label="生成素材"]').first().click({ timeout: 5000 }); const dialog = await spendDialog(win); await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', nodeId, { timeout: 30_000 })
  check(wireCalls.length === 1 && wireCalls[0].model === MODEL, '切换 chip 后真实图片生成请求已发出'); check(Boolean(findProjectJson(projectsDir)), '真实生成结果已写入项目持久化文件'); await snap(win, '03-generated-with-alternate-vendor.png')
  console.log('vendor preference picker journey passed')
} finally { await app?.close().catch(() => {}); await new Promise((resolve) => vendorServer.close(resolve)) }
