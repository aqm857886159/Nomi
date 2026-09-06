// 供应商偏好的真实旅程：两家同模型 → 设置里排偏好 → 选择器折叠成一行 → 点另一家 chip → 真实生成一次。
// 外部供应商只由隔离 loopback 代替；Electron、IPC、选择器、付费确认、生成和项目持久化走生产路径。
//
// 它同时留下两张**真机**截图（`tests/ux/shots/vendor-order/journey-*.png`）：选择框实际长相、
// 设置排序控件实际长相。设计实验室那份（`shots/design-lab-vendor-order/`）是喂固定夹具的现役组件，
// 真机这份走完整条 IPC + catalog 的同一批组件——两边摆一起才答得了「实验室里对，真机里也对吗」。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

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
// 第三家：目录里有它的模型，但**没有钥匙**。2026-09-06 用户拍板「没接入的供应商不显示」，
// 所以它是这条旅程的阴性对照——它的模型必须在真机下拉里一行都找不到。
const UNCONNECTED_VENDOR = { key: 'unconnected-relay', name: '没接入的中转' }
const UNCONNECTED_MODEL = 'vendor-order-unconnected-fixture'
const UNCONNECTED_LABEL = '没接入供应商 fixture'
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
  vendors: [
    ...VENDORS.map(({ key, name }) => ({ key, name, enabled: true, baseUrlHint: `http://127.0.0.1:${port}`, authType: 'none', providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW })),
    // enabled 但 authType 要钥匙、又没给钥匙 = 「加过、没接通」——真实用户拔了 key 后就是这个状态。
    { ...UNCONNECTED_VENDOR, enabled: true, baseUrlHint: `http://127.0.0.1:${port}`, authType: 'bearer', providerKind: 'openai-compatible', createdAt: NOW, updatedAt: NOW },
  ],
  models: [
    ...VENDORS.map(({ key }) => ({ modelKey: MODEL, vendorKey: key, labelZh: '供应商偏好 fixture', kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image'], meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW })),
    { modelKey: UNCONNECTED_MODEL, vendorKey: UNCONNECTED_VENDOR.key, labelZh: UNCONNECTED_LABEL, kind: 'image', enabled: true, published: true, publishedModes: ['text_to_image'], meta: { archetypeId: 'agnes-image' }, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [...VENDORS.map(({ key }) => imageMapping(key)), imageMapping(UNCONNECTED_VENDOR.key)],
  apiKeysByVendor: Object.fromEntries(VENDORS.map(({ key }) => [key, { vendorKey: key, apiKey: `vendor-order-${key}`, enc: 'plain', enabled: true, createdAt: NOW, updatedAt: NOW }])),
}, null, 2))

const check = (condition, message) => { if (!condition) throw new Error(`WALK FAIL: ${message}`); console.log(`  ✓ ${message}`) }
const snap = async (win, name, target = win) => { const file = path.join(shotsDir, name); await screenshotSettled(target, { path: file }); console.log(`  · ${name}`); return file }
// 浮层（Mantine portal + fixed 定位）按 locator 截图会卡在「element is not visible」——
// keepMounted 的那份隐藏副本也匹配同一个选择器。改成量出可见那份的矩形再整屏 clip。
const snapClip = async (win, selector, name) => {
  const box = await win.evaluate((sel) => {
    const visible = [...document.querySelectorAll(sel)].filter((node) => node.getBoundingClientRect().width > 20)
    const rect = visible[visible.length - 1]?.getBoundingClientRect()
    return rect ? { x: Math.max(0, rect.x - 8), y: Math.max(0, rect.y - 8), width: rect.width + 16, height: rect.height + 16 } : null
  }, selector)
  if (!box) throw new Error(`WALK FAIL: 截 ${name} 时没找到可见的 ${selector}`)
  await screenshotSettled(win, { path: path.join(shotsDir, name), clip: box })
  console.log(`  · ${name}`)
}
const findProjectJson = (root) => { const stack = [root]; while (stack.length) { const current = stack.pop(); for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const full = path.join(current, entry.name); if (entry.isDirectory()) stack.push(full); else if (entry.name === 'project.json' && full.includes(`${path.sep}.nomi${path.sep}`)) return full } } return null }
const dismissFirstRun = async (win) => { await win.evaluate(() => { localStorage.setItem('__nomiE2E', '1'); for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) localStorage.setItem(key, 'seen') }); await win.reload(); await win.waitForTimeout(1200) }
const spendDialog = async (win) => { const dialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last(); await dialog.waitFor({ timeout: 8000 }); return dialog }

let app
let win
try {
  ({ app, win } = await launchNomiApp({ name: 'vendor-preference-order', userDataDir, settingsDir, projectsDir, syntheticCredentialStorage: true, args: ['--no-proxy-server'], settleMs: 1200 }))
  await dismissFirstRun(win)
  await win.evaluate(async (baseUrl) => {
    for (const vendor of [{ key: 'apimart', name: 'APIMart' }, { key: 'kie', name: 'Kie' }]) {
      await window.nomiDesktop.modelCatalog.upsertVendorApiKey(vendor.key, { apiKey: `vendor-order-${vendor.key}`, enabled: true })
      await window.nomiDesktop.modelCatalog.upsertVendor({ key: vendor.key, name: vendor.name, enabled: true, authType: 'none', providerKind: 'openai-compatible', baseUrlHint: baseUrl })
    }
  }, `http://127.0.0.1:${port}`)
  await win.reload(); await win.waitForTimeout(1200)
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 5000 }); await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 5000 }); await win.waitForTimeout(1000)
  // 优先供应商的家在「AI 策略」tab（设计系统 §1.7.2：接入归「模型」，「默认走哪家」是策略）。
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'ai' } })))
  await win.locator('[data-settings-page="ai"], [data-settings-section="ai-models"]').first().waitFor({ timeout: 8000 })
  const preference = win.locator('[data-vendor-preference-order]'); await preference.waitFor({ timeout: 8000 })
  check(await win.locator('[data-settings-section="default-generation-models"]').count() === 1,
    '优先供应商与「新建卡片默认模型」同屏（同一族策略住一起）')
  const rows = preference.locator('[data-vendor-preference-row]')
  // 「只列已配置的家」不等于「只列这次种进去的两家」：本机默认还带着免鉴权的本地通道
  // （即梦 CLI、火山语音），它们也是能真的调起来的供应商，排进去是诚实的。
  // 断言因此钉两件事：种进去的两家都在；没配 key 的家一个都不在。
  const listed = await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-vendor-preference-row')))
  check(listed.includes('apimart') && listed.includes('kie'), `两家已配置供应商都在偏好列表里（${listed.join(', ')}）`)
  check(!listed.includes('newapi'), '没配 key 的供应商不进偏好列表')
  await preference.scrollIntoViewIfNeeded()
  await snap(win, 'journey-settings-vendor-order.png', preference)
  const first = await rows.first().getAttribute('data-vendor-preference-row'); await rows.first().getByRole('button', { name: /下移|Move down/ }).click(); await win.waitForTimeout(350)
  const moved = await rows.first().getAttribute('data-vendor-preference-row')
  check(moved !== first, `调整偏好顺序后设置已更新（${first} → ${moved}）`)
  await win.locator('[data-settings-close]').first().click().catch(() => win.keyboard.press('Escape'))
  await win.waitForTimeout(500)
  await addCanvasNodeFromRail(win, 'image'); await win.waitForTimeout(800)
  const node = win.locator('[data-kind="image"][data-node-id]').last(); await node.waitFor({ timeout: 5000 }); const nodeId = await node.getAttribute('data-node-id')
  const promptEditor = node.locator('div[contenteditable="true"]').last(); await promptEditor.click(); await promptEditor.fill('供应商偏好真实生成验收图')
  await node.locator('button[aria-label="模型"]').first().click({ timeout: 5000 })
  const option = win.getByRole('option').filter({ hasText: '供应商偏好 fixture' }).first(); await option.waitFor({ timeout: 8000 })
  const chips = option.locator('button[aria-pressed]'); check(await chips.count() === 2, '同一模型折叠为一行并显示两家供应商 chip')
  // 用户 2026-09-06 拍板：没接入的家的模型**不显示**（此前是灰显沉底）。阳性对照是上面那条
  // 已经找到的 fixture 行——先证明这个下拉里确实找得到模型，「找不到没接入那条」才算数据而不是空探针。
  const allOptions = win.getByRole('option')
  const optionProof = await proveProbe(allOptions, '模型下拉里本来就列得出模型行')
  await expectAbsent(allOptions.filter({ hasText: UNCONNECTED_LABEL }), {
    provenBy: optionProof,
    message: '没接入的供应商，它的模型一行都不出现（不是灰显沉底）',
  })
  console.log('  ✓ 没接入的供应商，它的模型一行都不出现（不是灰显沉底）')
  // 模型名不许被行尾 chip 挤没（2026-09-06 用户返工的起因：真机上三行只剩图标 + 一排 chip）。
  const labelWidth = await option.locator('[data-nomi-select-option-label]').first().evaluate((node) => node.getBoundingClientRect().width)
  check(labelWidth > 24, `模型名在真机上仍看得见（${Math.round(labelWidth)}px）`)
  // 「不再挂 N 家」必须先证明这个选择器测得到东西——这一行本来就有一排 pill 形状的 chip，
  // 拿它当基线（否则 selector 写错时「一个都没找到」会伪装成「已经修好了」）。
  const pills = option.locator('[class*="rounded-pill"]')
  const pillProof = await proveProbe(pills, '模型行上本来就有一排 pill 形状的供应商 chip')
  await expectAbsent(pills.filter({ hasText: /^\d+ 家$/ }), {
    provenBy: pillProof,
    message: '有 chip 的行不再同时挂「N 家」附注（同一件事只说一遍）',
  })
  console.log('  ✓ 有 chip 的行不再同时挂「N 家」附注（同一件事只说一遍）')
  await snapClip(win, '[data-nomi-select-dropdown]', 'journey-model-picker.png')
  await option.click(); await win.locator('button[aria-label="模型"]').first().click({ timeout: 5000 })
  const reopened = win.getByRole('option').filter({ hasText: '供应商偏好 fixture' }).first(); await reopened.waitFor({ timeout: 8000 }); await reopened.locator('button[aria-pressed]').last().click()
  const currentNode = win.locator('[data-kind="image"][data-node-id]').last(); await currentNode.waitFor({ timeout: 5000 })
  const generate = currentNode.locator('button[aria-label="生成素材"]').first()
  await generate.click({ timeout: 5000 }); const dialog = await spendDialog(win); await dialog.getByRole('button', { name: '生成', exact: true }).click()
  await win.waitForFunction((id) => document.querySelector(`[data-node-id="${id}"]`)?.getAttribute('data-status') === 'success', nodeId, { timeout: 30_000 })
  check(wireCalls.length === 1 && wireCalls[0].model === MODEL, '切换 chip 后真实图片生成请求已发出'); check(Boolean(findProjectJson(projectsDir)), '真实生成结果已写入项目持久化文件')
  console.log('vendor preference picker journey passed')
} finally { await app?.close().catch(() => {}); await new Promise((resolve) => vendorServer.close(resolve)) }
