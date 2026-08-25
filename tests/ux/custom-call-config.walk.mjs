// R13 走查：自定义调用编辑器的「自定义配置」区（2026-08-12）。
// 用法: node tests/ux/custom-call-config.walk.mjs
// 产出: tests/ux/shots/custom-call-config/*.png
//
// 要人眼判的三条：
//   ① 没填过时**折叠**成一行，标题写用途（「这家还要别的密钥或参数？」）而不是功能名
//   ② 展开后有说明 + 可加/删行，「可用变量」里能看到 config
//   ③ 填过之后重开，标题变成「自定义配置 · N 条」且默认展开、值还在（存的是 vendor 不是 model）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/custom-call-config')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-cfg-userdata')
const settingsDir = path.join(repoRoot, '.tmp', 'nomi-cfg-settings')
for (const dir of [userData, settingsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

const now = '2026-08-12T00:00:00.000Z'
const vendorKey = 'api-deepseek-com'
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 1,
    vendors: [{
      key: vendorKey, name: 'DeepSeek', enabled: true, baseUrlHint: 'https://api.deepseek.com/v1',
      authType: 'bearer', providerKind: 'openai-compatible', meta: {}, createdAt: now, updatedAt: now,
    }],
    models: [{
      vendorKey, modelKey: 'deepseek-v4-pro', labelZh: 'deepseek-v4-pro', kind: 'text',
      enabled: true, createdAt: now, updatedAt: now, meta: { adapter: { state: 'failed', runId: 'r', updatedAt: now } },
    }],
    mappings: [],
    apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: 'sk-walk', enc: 'plain', enabled: true, createdAt: now, updatedAt: now } },
  }, null, 2),
)

let n = 0
async function snap(win, name) {
  n += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  console.log(`  · shot ${String(n).padStart(2, '0')}-${name}`)
}

const { app, win } = await launchNomiApp({
  name: 'custom-call-config',
  userDataDir: userData,
  settingsDir,
  env: { NODE_ENV: 'production' },
  settleMs: 0,
})
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { w.setSize(1500, 1000); w.center() }
}).catch(() => {})
await win.waitForLoadState('domcontentloaded')
await win.waitForTimeout(2500)
await win.evaluate(() => {
  for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
    window.localStorage.setItem(k, 'seen')
  }
})
await win.reload()
await win.waitForTimeout(2200)
for (let i = 0; i < 5; i += 1) {
  const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛|Skip/i }).first()
  if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.waitForTimeout(220)
}

async function openEditor() {
  // 真实 aria-label 是「接入模型」——词序和我一开始猜的「模型接入」是反的，靠 dump 页面 label 才发现。
  const trigger = win.locator('[aria-label="接入模型"], [aria-label="Connect model"]').first()
  if (await trigger.count()) { await trigger.click({ timeout: 5000 }).catch(() => {}); await win.waitForTimeout(1800) }
  const card = win.locator('button, [role="button"], div').filter({ hasText: /DeepSeek/i }).last()
  if (await card.count()) { await card.click({ timeout: 3000 }).catch(() => {}); await win.waitForTimeout(1000) }
  // 行末的 <> 图标就是自定义调用入口。
  const codeBtn = win.locator('[aria-label*="自定义调用"], [aria-label*="Custom call"]').first()
  if (!(await codeBtn.count())) { console.log('  ❌ 没找到自定义调用入口'); return false }
  await codeBtn.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(1200)
  return true
}

if (!(await openEditor())) { await app.close().catch(() => {}); process.exit(0) }
await snap(win, 'editor-collapsed')

const summary = win.locator('summary').filter({ hasText: /密钥或参数|自定义配置|another key|Custom config/ }).first()
console.log(`  · 折叠标题: ${(await summary.count()) ? JSON.stringify((await summary.textContent())?.trim()) : '❌ 没找到'}`)
console.log(`  · 默认展开? ${await summary.evaluate((el) => el.parentElement?.hasAttribute('open')).catch(() => 'n/a')}（应为 false）`)

await summary.click({ timeout: 3000 }).catch(() => {})
await win.waitForTimeout(600)
await snap(win, 'config-expanded')

const addBtn = win.locator('button').filter({ hasText: /加一条|Add one/ }).first()
await addBtn.click({ timeout: 3000 }).catch(() => {})
await win.waitForTimeout(500)
const nameInput = win.locator('input[aria-label*="配置项名字"], input[aria-label*="Config entry name"]').last()
await nameInput.fill('api_secret').catch(() => {})
const valInput = win.locator('input[aria-label*="的值"], input[aria-label*="Value for"]').last()
await valInput.fill('sk-second-secret').catch(() => {})
await win.waitForTimeout(400)
await snap(win, 'config-filled')

// 「可用变量」里应能看到 config。
const varsLine = win.locator('summary').filter({ hasText: /可用变量|Variables/ }).first()
if (await varsLine.count()) {
  const txt = (await varsLine.textContent()) || ''
  console.log(`  · 可用变量含 config? ${/config/.test(txt) ? '✅' : '❌'}`)
}

const saveBtn = win.locator('button').filter({ hasText: /^保存并启用$|^Save and enable$/ }).first()
await saveBtn.click({ timeout: 4000 }).catch(() => {})
await win.waitForTimeout(1500)

// 落盘验证：应写进 vendor.meta.customConfig（不是 model）。
const cat = JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8'))
const saved = cat.vendors.find((v) => v.key === vendorKey)?.meta?.customConfig
console.log(`  · 存进 vendor.meta.customConfig: ${JSON.stringify(saved)}`)

// 重开：应默认展开、标题带条数、值还在。
if (await openEditor()) {
  await snap(win, 'reopen-expanded')
  const s2 = win.locator('summary').filter({ hasText: /密钥或参数|自定义配置|another key|Custom config/ }).first()
  console.log(`  · 重开标题: ${(await s2.count()) ? JSON.stringify((await s2.textContent())?.trim()) : '❌'}`)
  console.log(`  · 重开默认展开? ${await s2.evaluate((el) => el.parentElement?.hasAttribute('open')).catch(() => 'n/a')}（应为 true）`)
}

await app.close().catch(() => {})
console.log(`\n截图在 ${shotsDir}`)
process.exit(0)
