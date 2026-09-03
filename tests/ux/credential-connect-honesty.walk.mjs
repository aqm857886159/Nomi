// R13/R16 走查：保存 vendor key 后，「已接入 / N 个可使用」这套「已可用」表述必须与真实可用性一致。
//
// 背景（2026-09-01 CERT 核实）：保存凭据落盘即 enabled:false（认证前不 promote，属正确 fail-closed），
// 而 resolveTextBrainKeys 要求凭据 enabled===true 才算可用。若某条保存路径只写凭据、忘了把 vendor 同时
// de-publish，就会出现「vendor.enabled=true + 凭据 enabled:false」的错位——模型设置首页据此把它列进
// 「已接入 / N 个可使用」，可文本大脑（及一切生成）实际拿不到可用模型。
//
// 根因修在 store 最内层共享边界 applyApiKeyUpsert（见 electron/catalog/credentialPublication.ts 与
// docs/fixes/2026-09-01-credential-enable-honesty.root-cause.json）。认证 promote 一律写
// enabled:true 故不触发该守卫——态②就是它的不变性证据。
//
// 这条走查锁两态的「名实一致」——两态都用真机 resolveTextBrain（渲染口）作真相：
//   ① 裸凭据写入（bridge upsertVendorApiKey，不配对 upsertVendor）→ vendor 必被 de-publish →
//      apimart 落「可接入」段、不落「已接入」段；resolveTextBrain=null。
//   ② 认证成功终态（vendor+model+凭据全 enabled + adapter verified）→ apimart 落「已接入」段；
//      resolveTextBrain 返回 brain。
// 判据：UI「已接入段出现」当且仅当 resolveTextBrain 可用。任一态不一致即报红。
//
// 用法（零额度可跑；给真 key 更贴真）：APIMART_API_KEY=... node tests/ux/credential-connect-honesty.walk.mjs
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/credential-connect-honesty')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })
const API_KEY = process.env.APIMART_API_KEY || 'sk-walkthrough-not-a-real-key-000'
const MODEL = 'deepseek-v4-pro'

function mkProfile(name) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-credhon-${name}-`))
  const p = {
    tempRoot,
    settingsDir: path.join(tempRoot, 'settings'),
    userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'),
    capabilityDir: path.join(tempRoot, 'capability'),
    catFile: path.join(tempRoot, 'settings', 'model-catalog.json'),
  }
  for (const d of [p.settingsDir, p.userDataDir, p.projectsDir, p.capabilityDir]) fs.mkdirSync(d, { recursive: true })
  return p
}

async function launch(name, p) {
  const { app, win } = await launchNomiApp({
    name: `credhon-${name}`, tempRoot: p.tempRoot, userDataDir: p.userDataDir, settingsDir: p.settingsDir,
    projectsDir: p.projectsDir, capabilityDir: p.capabilityDir,
    env: { NODE_ENV: 'production' }, args: ['--no-proxy-server', '--disable-gpu'], settleMs: 0,
  })
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) { w.setSize(1680, 1050); w.center() } }).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light'); for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen') })
  await win.reload(); await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

async function openModelSettings(win) {
  for (let i = 0; i < 5; i += 1) { await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(120) }
  await clickOrFail(win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]'), '打开设置')
  const dialog = win.locator('[role="dialog"][aria-modal="true"]').first()
  await expectVisible(dialog, '设置对话框没出现')
  await clickOrFail(dialog.locator('[data-settings-tab-id="models"]'), '设置里的「模型」tab')
  await expectVisible(dialog.locator('[data-model-settings-page]').first(), '模型设置首页没渲染出来')
  return dialog
}

// 渲染口真相：resolveTextBrain（promptLibrary.textBrain 直连 resolveTextBrainKeys/Status）+ vendor 态。
async function resolverUsable(win) {
  return win.evaluate(async () => {
    let brain = null
    try { brain = await window.nomiDesktop.promptLibrary.textBrain() } catch (e) { brain = { error: String(e) } }
    const v = (window.nomiDesktop.modelCatalog.listVendors() || []).find((x) => (x.key || x.vendorKey) === 'apimart')
    return { usable: Boolean(brain && brain.brain && brain.status === 'ok'), brain, vendorEnabled: v?.enabled, hasApiKey: v?.hasApiKey }
  })
}
async function apimartInConnectedSection(win) {
  return win.evaluate(() => Boolean(document.querySelector('[data-model-home-connection="apimart"]')))
}

// 用真实 bridge 把凭据写进某 profile（safeStorage 加密），返回后关闭。
async function seedRealCredential(p) {
  const { app, win } = await launch('seed', p)
  await win.evaluate((k) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: k, enabled: true }), API_KEY)
  await app.close().catch(() => {})
}
// 磁盘微调终态（凭据密文保留，仅翻标志 + 认证 meta），聚焦 deepseek-v4-pro。
function patchDisk(p, { vendorEnabled, credentialEnabled, modelEnabled, certified }) {
  const cat = JSON.parse(fs.readFileSync(p.catFile, 'utf8'))
  const v = cat.vendors.find((x) => x.key === 'apimart'); if (v) v.enabled = vendorEnabled
  const cred = cat.apiKeysByVendor?.apimart; if (cred) cred.enabled = credentialEnabled
  const m = (cat.models || []).find((x) => x.vendorKey === 'apimart' && x.modelKey === MODEL)
  if (m) {
    m.enabled = modelEnabled
    m.meta = certified
      ? { adapter: { state: 'verified', activeRevision: 'rev-1', modes: [{ taskKind: 'chat', state: 'verified' }], runId: 'run-cert', updatedAt: '2026-09-01T00:00:00.000Z' } }
      : {}
  }
  for (const mm of cat.models || []) if (mm.vendorKey === 'apimart' && mm.kind === 'text' && mm.modelKey !== MODEL) mm.enabled = false
  fs.writeFileSync(p.catFile, JSON.stringify(cat, null, 2))
}

try {
  // ── 态① 裸凭据写入旁路：fix 后 vendor 必被 de-publish，名实一致 ──
  {
    const p = mkProfile('bare')
    const { app, win } = await launch('bare', p)
    // 复现旁路：只写凭据，不配对 upsertVendor({enabled:false})。真机端到端走 IPC → 渲染层 sanitizer
    // → store applyApiKeyUpsert 的守卫，因此本态就是「下沉后的不变量仍然成立」的真机证据。
    await win.evaluate((k) => window.nomiDesktop.modelCatalog.upsertVendorApiKey('apimart', { apiKey: k, enabled: true }), API_KEY)
    const r = await resolverUsable(win)
    const dialog = await openModelSettings(win)
    await win.waitForTimeout(500)
    const inConnected = await apimartInConnectedSection(win)
    await screenshotSettled(dialog, { path: path.join(shotsDir, '01-bare-credential-home.png') })
    console.log(`  ① 裸凭据: vendor.enabled=${r.vendorEnabled} hasApiKey=${r.hasApiKey} resolver可用=${r.usable} UI已接入段=${inConnected}`)
    // 硬断言：凭据写入后 vendor 被 de-publish；且「已接入」出现 ⟺ resolver 可用。
    expect(r.vendorEnabled, '裸凭据写入后 vendor 仍 enabled=true：共享边界没把它 de-publish（会显示已接入但用不了）').toBe(false)
    expect(inConnected, '裸凭据（resolver 不可用）时 apimart 仍列在「已接入」段：名实不符').toBe(false)
    expect(inConnected, '态①名实不符：UI已接入 ≠ resolver可用').toBe(r.usable)
    await app.close().catch(() => {})
  }

  // ── 态② 认证成功终态：apimart 应在已接入段，且 resolver 返回 brain ──
  {
    const p = mkProfile('certified')
    await seedRealCredential(p)
    patchDisk(p, { vendorEnabled: true, credentialEnabled: true, modelEnabled: true, certified: true })
    const { app, win } = await launch('certified', p)
    const r = await resolverUsable(win)
    const dialog = await openModelSettings(win)
    await win.waitForTimeout(500)
    const inConnected = await apimartInConnectedSection(win)
    await screenshotSettled(dialog, { path: path.join(shotsDir, '02-certified-home.png') })
    console.log(`  ② 认证成功: vendor.enabled=${r.vendorEnabled} resolver可用=${r.usable} UI已接入段=${inConnected}`)
    // 真 key 才可能真解出 brain；占位 key 会让 resolver 不可用（safeStorage 解不出）——两种都要求「名实一致」。
    expect(inConnected, '态②名实不符：UI已接入 ≠ resolver可用').toBe(r.usable)
    if (process.env.APIMART_API_KEY) {
      expect(r.usable, '给了真 APIMART_API_KEY，认证成功终态却没解出可用文本大脑').toBe(true)
      expect(inConnected, '认证成功且 resolver 可用，apimart 却没列进「已接入」段').toBe(true)
    }
    await app.close().catch(() => {})
  }

  console.log(`\n✅ 凭据连接名实一致走查通过。截图：${shotsDir}`)
  process.exit(0)
} catch (err) {
  console.log(`\n✖ ${err?.stack || err?.message || err}`)
  process.exit(1)
}
