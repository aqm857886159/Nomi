// R13/R16 zero-cost Electron walk: a persisted failed adapter projection is
// cleared by connection repair, deletion, and a cold restart.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expectAbsent, expectHidden, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = path.join(repoRoot, '.tmp', 'vendor-validation-error-persist')
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
  const directTrigger = win.locator('[aria-label="打开模型设置"], [aria-label="打开模型接入"], button:has-text("模型接入"), button:has-text("Connect model")').first()
  if (await directTrigger.count()) {
    await expectVisible(directTrigger, '工作区应提供模型设置入口')
    await directTrigger.click({ timeout: 5000 })
    await expectVisible(win.getByRole('heading', { name: '模型', exact: true }).first(), '模型设置页面应已打开')
    return
  }
  const splash = win.getByRole('dialog', { name: /开屏介绍/ }).first()
  let project = win.getByRole('button', { name: /新建空白项目/ }).first()
  const firstScreen = await Promise.race([
    expectVisible(directTrigger, '工作区应提供模型设置入口').then(() => 'direct'),
    expectVisible(splash, '开屏介绍应可关闭').then(() => 'splash'),
    expectVisible(project, '项目库应提供新建空白项目入口').then(() => 'project'),
  ])
  if (firstScreen === 'direct') {
    await directTrigger.click({ timeout: 5000 })
    await expectVisible(win.getByRole('heading', { name: '模型', exact: true }).first(), '模型设置页面应已打开')
    return
  }
  if (firstScreen === 'splash') {
    await splash.locator('button').last().click({ timeout: 5000, force: true })
    await expectHidden(splash, '开屏介绍应已关闭')
    project = win.getByRole('button', { name: /新建空白项目/ }).first()
  }
  let trigger = win.locator('[aria-label="打开模型设置"], [aria-label="打开模型接入"], button:has-text("模型接入"), button:has-text("Connect model")').first()
  if (!(await trigger.count())) {
    const settings = win.getByRole('button', { name: '设置', exact: true }).first()
    await expectVisible(settings, '项目库应提供设置入口')
    await settings.click({ timeout: 5000 })
    const modelTab = win.getByRole('button', { name: '模型', exact: true }).first()
    await expectVisible(modelTab, '设置中应提供模型页签')
    await modelTab.click({ timeout: 5000 })
    await expectVisible(win.getByRole('heading', { name: '模型', exact: true }).first(), '模型设置页面应已打开')
    return
  }
  await expectVisible(trigger, '创作工作区应提供模型接入入口')
  await trigger.click({ timeout: 5000 })
  if (!(await win.getByRole('heading', { name: '模型', exact: true }).count())) {
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
  }
  await expectVisible(win.getByRole('heading', { name: '模型', exact: true }).first(), '模型设置页面应已打开')
}
async function invalidate(win, action) {
  await win.evaluate(async ({ vendorKey, action }) => {
    const catalog = window.nomiDesktop?.modelCatalog
    if (!catalog) throw new Error('model catalog bridge unavailable')
    if (action === 'clear') await catalog.clearVendorApiKey(vendorKey)
    else await catalog.deleteVendor(vendorKey)
    window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed', { detail: { vendorKey } }))
  }, { vendorKey, action })
  await expectVisible(win.locator('body'), `完成 ${action} 后应用仍可交互`)
}

let { app, win } = await launchNomiApp({ name: 'vendor-validation-error-persistence', userDataDir: root, settingsDir, projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
await openModels(win)
await snap(win, 'persisted-failure')
const vendor = win.locator('button, [role="button"]', { hasText: 'Loopback Validation' }).first()
await expectVisible(vendor, '失败供应商应在模型设置中可见')
await vendor.click({ timeout: 4000 })
await snap(win, 'failure-expanded')
const failureNotice = win.getByText('未通过', { exact: true }).first()
const failureProof = await proveProbe(failureNotice, '持久化失败状态应先在模型设置中可见')

await invalidate(win, 'clear')
await win.reload()
await openModels(win)
await expectAbsent(failureNotice, { provenBy: failureProof, message: '修复连接后不应继续显示旧校验错误' })
await snap(win, 'after-connection-repair')
await invalidate(win, 'delete')
await win.reload()
await openModels(win)
await expectAbsent(failureNotice, { provenBy: failureProof, message: '删除连接后不应继续显示旧校验错误' })
await snap(win, 'after-delete')

try { await app.close() } catch {}
({ app, win } = await launchNomiApp({ name: 'vendor-validation-error-persistence-restart', userDataDir: root, settingsDir, projectsDir, syntheticCredentialStorage: true, settleMs: 0 }))
await openModels(win)
await expectAbsent(win.getByText('未通过', { exact: true }).first(), { provenBy: failureProof, message: '冷启动后不应复活旧校验错误' })
await snap(win, 'after-cold-restart')
const body = (await win.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ')
console.log(JSON.stringify({ screenshots: shotsDir, failedAdapterRows: await win.locator('[data-model-adapter-state="failed"]').count(), staleFailureVisible: /loopback validation failed/.test(body) }, null, 2))
try { await app.close() } catch {}
