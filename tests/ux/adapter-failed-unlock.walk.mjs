// R13 走查：验证没通过的模型，用户还能不能自己启用（2026-08-12 解锁改动）。
// 用法: node tests/ux/adapter-failed-unlock.walk.mjs
// 产出: tests/ux/shots/adapter-unlock/*.png —— 人眼判断：失败模型是否出现在列表里、
// 勾选框是不是可点（旧行为 cursor-not-allowed 点不动，只能删掉整个供应商重来）。
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/adapter-unlock')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-adapter-unlock-userdata')
const settingsDir = path.join(repoRoot, '.tmp', 'nomi-adapter-unlock-settings')
for (const dir of [userData, settingsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

const now = '2026-08-12T00:00:00.000Z'
const vendorKey = 'api-deepseek-com'
// 种一个「验证没通过」的现场：adapter.state = failed，正是旧代码会锁死勾选框的那个状态。
fs.writeFileSync(
  path.join(settingsDir, 'model-catalog.json'),
  JSON.stringify({
    version: 1,
    vendors: [{
      key: vendorKey, name: 'DeepSeek', enabled: true,
      baseUrlHint: 'https://api.deepseek.com/v1', authType: 'bearer',
      providerKind: 'openai-compatible', meta: {}, createdAt: now, updatedAt: now,
    }],
    models: [
      {
        vendorKey, modelKey: 'deepseek-v4-pro', labelZh: 'deepseek-v4-pro', kind: 'text',
        enabled: true, createdAt: now, updatedAt: now,
        meta: { adapter: { state: 'failed', runId: 'run-x', updatedAt: now } },
      },
      {
        vendorKey, modelKey: 'deepseek-v4-flash', labelZh: 'deepseek-v4-flash', kind: 'text',
        enabled: true, createdAt: now, updatedAt: now,
        meta: { adapter: { state: 'verified', runId: 'run-x', updatedAt: now } },
      },
    ],
    mappings: [],
    apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: 'sk-walkthrough', enc: 'plain', enabled: true, createdAt: now, updatedAt: now } },
  }, null, 2),
)

let n = 0
async function snap(win, name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

// 走统一启动器：手抄的 launch 漏了 NOMI_E2E / NOMI_E2E_ALLOW_MULTI_INSTANCE，本机开着
// Nomi.app 时抢不到单实例锁会静默挂死到超时（零截图零提示）。settleMs:0 把等待留在下面，
// 保持「先改窗口尺寸再等渲染」的原顺序，免得先按默认尺寸排一遍版再回流。
const { app, win } = await launchNomiApp({
  name: 'adapter-unlock',
  userDataDir: userData,
  settingsDir,
  env: { NODE_ENV: 'production' },
  settleMs: 0,
})
// Electron 是真实 OS 窗口，setViewportSize 不管用，得从主进程改窗口尺寸。
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) { w.setSize(1680, 1050); w.center() }
}).catch(() => {})
await win.waitForTimeout(3500)
await snap(win, 'app-loaded')

// 干净用户态会先放首启导览，跳掉它才看得到工作台。
for (let i = 0; i < 6; i += 1) {
  const skip = win.locator('text=/^\\s*(Skip|跳过)\\s*›?\\s*$/i').first()
  if (!(await skip.count())) break
  await skip.click({ timeout: 2500 }).catch(() => {})
  await win.waitForTimeout(700)
}
await win.waitForTimeout(1200)
await snap(win, 'after-skip-intro')

// 界面语言可能是中文也可能是英文，两边都认。
const trigger = win.locator('button, [role="button"]').filter({ hasText: /接入模型|模型接入|Connect model/i }).first()
if (await trigger.count()) {
  await trigger.click({ timeout: 5000 }).catch(() => {})
  await win.waitForTimeout(1500)
}
await snap(win, 'model-panel')

// 展开供应商卡片，露出逐模型列表（勾选框住在那里）。
for (const label of [/DeepSeek/i, /管理|Manage/i]) {
  const card = win.locator('button, [role="button"], div').filter({ hasText: label }).last()
  if (await card.count()) {
    await card.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(1000)
  }
}
await snap(win, 'vendor-expanded')

// 关键判据：失败模型那行的勾选框，是不是真的可点。
const failedRow = win.locator('text=deepseek-v4-pro').first()
if (await failedRow.count()) {
  await failedRow.scrollIntoViewIfNeeded().catch(() => {})
  await win.waitForTimeout(400)
  await snap(win, 'failed-model-row')
  // 精确定位「那一行」的勾选框：ModelEnableEditor 把模型名写进了 aria-label。
  const toggle = win.locator('[role="checkbox"][aria-label*="deepseek-v4-pro"]').first()
  if (await toggle.count()) {
    const before = await toggle.getAttribute('aria-checked')
    const cls = (await toggle.getAttribute('class')) || ''
    console.log(`  · 失败模型勾选框 aria-checked=${before} cursor-not-allowed=${cls.includes('cursor-not-allowed')}`)
    await toggle.click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(900)
    const after = await toggle.getAttribute('aria-checked')
    console.log(`  · 点击后 aria-checked: ${before} -> ${after}  ${before !== after ? '✅ 可点（锁已解除）' : '❌ 没反应（还锁着）'}`)
    await snap(win, 'after-toggle-click')
  } else {
    console.log('  · 没找到 deepseek-v4-pro 的勾选框')
  }
} else {
  console.log('  · 列表里没出现 deepseek-v4-pro')
}

// 打开「自定义调用」编辑器，确认新注入的 config 变量在可用变量里、且有中文说明（不是裸 key）。
const codeBtn = win.locator('button[aria-label*="deepseek-v4-pro"]').filter({ hasNot: win.locator('[role="checkbox"]') }).first()
const anyCode = win.locator('button[title="自定义调用"], button[title="Custom call"]').first()
const target = (await anyCode.count()) ? anyCode : codeBtn
if (await target.count()) {
  await target.click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(1500)
  await snap(win, 'custom-call-editor')
  const varsLine = win.locator('text=/可用变量|Available variables/').first()
  if (await varsLine.count()) {
    console.log('  · 可用变量行: ' + ((await varsLine.textContent()) || '').trim().slice(0, 200))
    const hasConfig = (await win.locator('text=/自定义配置|custom config/').count()) > 0
    console.log('  · config 说明是否渲染出来: ' + (hasConfig ? '✅ 是' : '❌ 否（可能缺 i18n key）'))
  } else {
    console.log('  · 没找到「可用变量」行')
  }
} else {
  console.log('  · 没找到自定义调用入口按钮')
}

await app.close().catch(() => {})
console.log(`\n截图在 ${shotsDir}`)
// Electron 偶尔不肯干净退出（渲染进程还挂着），别让走查卡在这一步。
process.exit(0)
