// R13/R16 zero-cost Electron walk: a persisted failed adapter projection is
// ignored by current state; missing request formats stay visible across a cold restart.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectHidden, expectVisible, screenshotSettled } from './_assert.mjs'
import { modelSettingsEntry, openModelSettings } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = process.env.NOMI_WALK_OUT ? path.join(path.resolve(process.env.NOMI_WALK_OUT), 'profile') : path.join(repoRoot, '.tmp', 'vendor-validation-error-persist')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const shotsDir = path.join(root, 'shots')
fs.rmSync(root, { recursive: true, force: true })
for (const dir of [settingsDir, projectsDir, shotsDir]) fs.mkdirSync(dir, { recursive: true })

const now = '2026-09-05T00:00:00.000Z'
const vendorKey = 'loopback-validation'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 12,
  vendors: [{ key: vendorKey, name: 'Loopback Validation', enabled: true, baseUrlHint: 'http://127.0.0.1:43123/v1', authType: 'bearer', providerKind: 'openai-compatible', createdAt: now, updatedAt: now }],
  models: [{ vendorKey, modelKey: 'loopback-image', labelZh: 'Loopback Image', kind: 'image', enabled: false, meta: { adapter: { state: 'failed', runId: 'failed-run', modes: [{ taskKind: 'text_to_image', state: 'failed', error: 'loopback validation failed' }], updatedAt: now } }, createdAt: now, updatedAt: now }],
  mappings: [],
  apiKeysByVendor: { [vendorKey]: { vendorKey, apiKey: Buffer.from('loopback-key').toString('base64'), enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now } },
}), 'utf8')
fs.writeFileSync(path.join(settingsDir, 'provider-adapters.json'), JSON.stringify({
  version: 1, revision: 1,
  runs: [{ id: 'failed-run', vendorKey, vendorName: 'Loopback Validation', connectionFingerprint: 'old', selectedModelKeys: ['loopback-image'], stage: 'failed', repairAttempt: 0, models: [{ modelKey: 'loopback-image', labelZh: 'Loopback Image', kind: 'image', modes: [] }], sourceUrls: [], createdAt: now, updatedAt: now }],
  revisions: [],
}), 'utf8')

let shot = 0
async function snap(win, name) {
  shot += 1
  await screenshotSettled(win, { path: path.join(shotsDir, `${String(shot).padStart(2, '0')}-${name}.png`) })
}
async function openModels(win) {
  // 首屏可能还压着开屏介绍：先关掉，再经 _shell.mjs 走「顶栏齿轮 → 设置 → 模型页签」。
  const splash = win.getByRole('dialog', { name: /开屏介绍/ }).first()
  const settingsEntry = modelSettingsEntry(win)
  await expectVisible(settingsEntry, '顶栏应提供设置入口')
  // 齿轮在开屏背后也可见，不能拿它和开屏竞速决定要不要点「跳过」。
  if (await splash.isVisible()) {
    await splash.locator('[data-splash-skip]').click({ timeout: 5000 })
    await expectHidden(splash, '开屏介绍应已关闭')
  }
  await openModelSettings(win, { label: 'open model settings', timeout: 5000 })
  await expectVisible(win.getByRole('heading', { name: '模型', exact: true }).first(), '模型设置页面应已打开')
}
let { app, win } = await launchNomiApp({ name: 'vendor-validation-error-persistence', userDataDir: root, settingsDir, projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
await openModels(win)
await snap(win, 'persisted-failure')
const vendor = win.locator('button, [role="button"]', { hasText: 'Loopback Validation' }).first()
await expectVisible(vendor, '失败供应商应在模型设置中可见')
await vendor.click({ timeout: 4000 })
await snap(win, 'failure-expanded')
await expectVisible(win.locator('[data-model-status="needsSetup"]').first(), '缺格式的连接应显示待设置，不展示旧验证失败')
const projected = await win.evaluate(async (vendorKey) => window.nomiDesktop.modelCatalog.listModels({ vendorKey }), vendorKey)
expect(projected[0].availability.reason, '没有格式仍不能用').toBe('model_unpublished')
expect(projected[0].meta?.adapter?.state, '界面不能读取旧验证结果').toBeUndefined()
await snap(win, 'current-format-needed')

try { await app.close() } catch {}
({ app, win } = await launchNomiApp({ name: 'vendor-validation-error-persistence-restart', userDataDir: root, settingsDir, projectsDir, syntheticCredentialStorage: true, settleMs: 0 }))
await openModels(win)
await expectVisible(win.locator('[data-model-status="needsSetup"]').first(), '冷启动后仍按当前缺格式状态展示')
await snap(win, 'after-cold-restart')
const body = (await win.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
console.log(JSON.stringify({ screenshots: shotsDir, failedAdapterRows: await win.locator('[data-model-adapter-state="failed"]').count(), staleFailureVisible: /loopback validation failed/.test(body) }, null, 2))
try { await app.close() } catch {}
