// Real Electron journeys, fake HTTP only: discovery is not generation verification.
// Run after pnpm build: node tests/ux/provider-model-discovery.walk.mjs
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, expectNoCjkInEnglishDom } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-model-discovery-'))
const shots = path.join(tempRoot, 'shots')
fs.mkdirSync(shots)
const requests = []
let relayMode = 'success'
let relayVendorKey = 'discovery-relay'
let replicateVendorKey = 'discovery-replicate'
let releaseSlow
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  requests.push({ method: req.method, path: url.pathname, query: url.search, authorization: req.headers.authorization })
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname.startsWith('/native/')) return send(404, { status: 404, message: 'No message available' })
  if (url.pathname === '/seed/v1/models') return send(200, { data: [{ id: 'seed-model' }] })
  if (url.pathname === '/replicate/v1/models') {
    return send(200, url.searchParams.has('cursor')
      ? { results: [{ owner: 'owner', name: 'sora-discovery' }], next: null }
      : { results: [{ owner: 'owner', name: 'flux-discovery' }], next: `${base}/replicate/v1/models?cursor=page-2` })
  }
  if (url.pathname === '/relay/v1/models') {
    if (req.headers.authorization !== 'Bearer fixture-gateway-override') {
      return send(401, { error: { message: 'fixture: custom authorization must replace the default' } })
    }
    if (relayMode === 'auth') return send(200, { code: 401, msg: 'fixture: list access denied', data: [] })
    if (relayMode === 'rate') return send(429, { error: { message: 'fixture: retry later' } })
    if (relayMode === 'network') return req.socket.destroy()
    if (relayMode === 'changed') return send(200, { data: [{ id: 'gpt-discovery-text' }] })
    if (relayMode === 'slow') {
      releaseSlow = () => { if (!res.writableEnded && !res.destroyed) send(200, { data: [{ id: 'stale-connection-only' }] }) }
      return
    }
    return send(200, { data: [{ id: 'gpt-discovery-text' }, { id: 'flux-discovery-image' }] })
  }
  return send(404, { error: 'Not Found' })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let instance
let win
const snap = async name => {
  const file = path.join(shots, `${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`SHOT ${file}`)
}
const picker = () => win.locator('[data-model-settings-page="add"]')
const status = () => picker().locator('[data-model-picker-status]')
const row = id => picker().getByRole('button', { name: id, exact: true })
const refetch = () => picker().getByRole('button', { name: /获取可用模型|重新获取列表|Get available models|Get list again/ })

async function start() {
  instance = await launchNomiApp({
    name: 'provider-model-discovery',
    tempRoot,
    args: ['--no-proxy-server'],
    syntheticCredentialStorage: true,
  })
  win = instance.win
  await win.evaluate(() => {
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await expect(win.locator('[data-testid="open-model-settings"]').first()).toBeVisible({ timeout: 30_000 })
}
async function home() {
  await win.keyboard.press('Escape')
  await clickOrFail(win.locator('[data-testid="open-model-settings"]').first(), '模型设置')
  await expect(win.locator('[data-model-settings-page="home"]')).toBeVisible()
}
async function openPicker(vendorKey) {
  await clickOrFail(win.locator(`[data-model-home-connection="${vendorKey}"]`), `连接 ${vendorKey}`)
  await expect(win.locator(`[data-model-settings-vendor="${vendorKey}"]`)).toBeVisible()
  await clickOrFail(win.getByRole('button', { name: /添加其他|Add More/, exact: true }), '添加其他')
}
async function backHome() {
  await clickOrFail(picker().getByRole('button', { name: /取消|Cancel/, exact: true }), '返回连接')
  await clickOrFail(win.locator('[data-model-settings-back]').first(), '返回模型首页')
  await expect(win.locator('[data-model-settings-page="home"]')).toBeVisible()
}
async function savedKeys(vendorKey) {
  return win.evaluate(key => window.nomiDesktop.modelCatalog.listModels().filter(m => m.vendorKey === key).map(m => m.modelKey), vendorKey)
}
async function completeModelSelfCheck() {
  const done = win.getByRole('button', { name: '\u5b8c\u6210', exact: true }).last()
  await expect(done).toBeVisible({ timeout: stationTimeout({ operations: 3 }) })
  await clickOrFail(done, 'complete model self-check')
  const cancel = picker().getByRole('button', { name: '\u53d6\u6d88', exact: true })
  if (await cancel.count()) await clickOrFail(cancel, 'close model picker after self-check')
}

try {
  await start()
  // Fixture setup uses only public catalog IPC inside this isolated profile. No user key is read.
  const fixture = await win.evaluate(async ({ base }) => {
    const catalog = window.nomiDesktop.modelCatalog
    const kie = catalog.listVendors().find(v => v.key === 'kie')
    if (!kie) throw new Error('Built-in Kie catalog missing')
    catalog.upsertVendor({ ...kie, enabled: true, baseUrlHint: `${base}/seed/v1` })
    await catalog.upsertVendorApiKey('kie', { apiKey: 'fixture-discovery-key', enabled: true })
    catalog.upsertVendor({ ...catalog.listVendors().find(v => v.key === 'kie'), enabled: true, baseUrlHint: `${base}/native` })
    for (const model of catalog.listModels({ vendorKey: 'kie' })) {
      const taskKind = model.kind === 'video' ? 'text_to_video' : model.kind === 'audio' ? 'text_to_audio' : 'text_to_image'
      catalog.upsertModel({ ...model, meta: { ...(model.meta || {}), adapter: { state: 'verified', activeRevision: 'fixture-retained', modes: [{ state: 'verified', taskKind }] } } })
    }
    const relay = await window.nomiDesktop.onboarding.httpConnectionConfigure({
      vendorName: 'Discovery Relay', baseUrl: `${base}/relay/v1`, apiKey: 'fixture-discovery-key',
      authType: 'bearer', providerKind: 'openai-compatible',
      headers: { authorization: 'Bearer fixture-gateway-override' }, models: [],
    })
    if (!relay.ok) throw new Error('Relay fixture registration failed')
    const replicate = await window.nomiDesktop.onboarding.httpConnectionConfigure({
      vendorName: 'Replicate Fixture', baseUrl: `${base}/replicate/v1`, apiKey: 'fixture-discovery-key',
      authType: 'bearer', providerKind: 'openai-compatible', headers: {}, models: [],
    })
    if (!replicate.ok) throw new Error('Replicate fixture registration failed')
    for (const [vendorKey, route] of [[relay.registration.vendorKey, 'relay'], [replicate.registration.vendorKey, 'replicate']]) {
      catalog.upsertModel({ vendorKey, modelKey: 'already-connected', labelZh: 'Already connected', kind: 'image', enabled: true })
    }
    return {
      originalKieKeys: catalog.listModels().filter(m => m.vendorKey === 'kie').map(m => m.modelKey),
      relayVendorKey: relay.registration.vendorKey,
      replicateVendorKey: replicate.registration.vendorKey,
    }
  }, { base })
  relayVendorKey = fixture.relayVendorKey
  replicateVendorKey = fixture.replicateVendorKey
  const originalKieKeys = fixture.originalKieKeys
  expect(originalKieKeys.length).toBeGreaterThanOrEqual(9)
  await win.reload()
  await home()
  // Saved credentials and custom headers must behave identically across health and list IPC.
  const savedHealth = await win.evaluate((vendorKey) => window.nomiDesktop.onboarding.vendorHealth({ vendorKey, force: true }), relayVendorKey)
  expect(savedHealth.state).toBe('reachable')

  // J1: original Kie-style response -> usable retained catalog -> manual ID persisted.
  await openPicker('kie')
  await clickOrFail(refetch(), '读取 Kie 模型列表')
  expect(requests.filter(r => r.path.startsWith('/native/')).length).toBeGreaterThanOrEqual(2)
  await snap('01-kie-catalog-not-full-dark')
  const manual = picker().getByPlaceholder('没列出来的，输入模型 id 回车添加')
  await manual.fill('manual-discovery-model')
  await manual.press('Enter')
  await expect(row('manual-discovery-model')).toBeEnabled()
  const saveManual = picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true })
  await saveManual.scrollIntoViewIfNeeded()
  await expect(saveManual).toBeVisible()
  await snap('01b-kie-manual-ready-to-save')
  await clickOrFail(saveManual, 'manual model self-check')
  await clickOrFail(win.getByRole('button', { name: '\u5b8c\u6210', exact: true }), 'complete manual model self-check')
  await clickOrFail(picker().getByRole('button', { name: '\u53d6\u6d88', exact: true }), 'close manual model picker')
  await expect(win.locator('[data-model-settings-vendor="kie"]')).toBeVisible()
  expect(await savedKeys('kie')).toContain('manual-discovery-model')
  await snap('02-kie-manual-saved')
  await clickOrFail(win.locator('[data-model-settings-back]').first(), '返回首页')

  // J2: real listing + selection retained through errors + successful retry.
  await openPicker(relayVendorKey)
  await clickOrFail(refetch(), '获取标准列表')
  await expect(row('flux-discovery-image')).toBeEnabled()
  await clickOrFail(row('flux-discovery-image'), '选择图片模型')
  for (const [mode, text] of [['auth', '未通过鉴权'], ['rate', '被限流'], ['network', '检查网络或代理']]) {
    relayMode = mode
    if (mode === 'network') await win.evaluate(() => window.nomiDesktop.proxy.set({ mode: 'off', customUrl: '' }))
    await clickOrFail(refetch(), `重试 ${mode}`)
    await expect(status()).toContainText(text, { timeout: 20_000 })
    await expect(row('flux-discovery-image')).toBeEnabled()
    await expect(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true })).toBeEnabled()
    if (mode === 'network') {
      await expect(status()).toContainText('当前未启用代理')
    }
    await snap(`03-relay-${mode}-selection-retained`)
  }
  // Exercise the exact proxy-URL diagnostic through real IPC, within this isolated profile.
  // The fixture remains loopback/direct; no system proxy or real account is changed.
  const proxy = await win.evaluate(customUrl => window.nomiDesktop.proxy.set({ mode: 'custom', customUrl }), base)
  expect(proxy.status.activeUrl).toContain(base)
  await clickOrFail(refetch(), '核对代理地址错误提示')
  await expect(status()).toContainText(`（当前代理：${base}（来源：应用内设置））`)
  await expect(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true })).toBeEnabled()
  await snap('03b-relay-network-proxy-selection-retained')
  await win.evaluate(() => window.nomiDesktop.proxy.set({ mode: 'off', customUrl: '' }))
  relayMode = 'changed'
  await clickOrFail(refetch(), '恢复后重新拉取')
  await expect(refetch()).toBeEnabled()
  await expect(row('gpt-discovery-text')).toBeEnabled()
  await expect(row('flux-discovery-image')).toBeEnabled()
  await clickOrFail(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true }), 'run model self-check')
  await completeModelSelfCheck()
  await expect(win.locator(`[data-model-settings-vendor="${relayVendorKey}"]`)).toBeVisible()
  expect(await savedKeys(relayVendorKey)).toEqual(expect.arrayContaining(['already-connected', 'flux-discovery-image']))
  await clickOrFail(win.locator('[data-model-settings-back]').first(), '返回首页')
  relayMode = 'success'

  // Slow result must not affect a different saved connection, including its loading state.
  await openPicker(relayVendorKey)
  relayMode = 'slow'
  await clickOrFail(refetch(), '发起慢请求')
  await expect.poll(() => typeof releaseSlow).toBe('function')
  await backHome()
  await openPicker(replicateVendorKey)
  releaseSlow()
  relayMode = 'success'
  await clickOrFail(refetch(), '获取 Replicate 分页')
  await expect(row('owner/flux-discovery')).toBeEnabled()
  await expect(row('owner/sora-discovery')).toBeEnabled()
  // A positive list assertion proves we reached the new scope; inspect all IDs, not just absence.
  const replicateIds = await picker().locator('button span.text-body-sm').allTextContents()
  expect(replicateIds.sort()).toEqual(['owner/flux-discovery', 'owner/sora-discovery'].sort())
  expect(requests.filter(r => r.path === '/replicate/v1/models' && r.query.includes('page-2')).length).toBeGreaterThan(0)
  await snap('04-replicate-two-pages-no-stale-result')
  await clickOrFail(row('owner/flux-discovery'), '选择分页模型')
  await clickOrFail(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true }), 'run model self-check')
  await completeModelSelfCheck()
  await expect(win.locator(`[data-model-settings-vendor="${replicateVendorKey}"]`)).toBeVisible()

  // J3: new connection uses the same failure handling, not just the existing-connection picker.
  await clickOrFail(win.locator('[data-model-settings-back]').first(), '返回首页')
  const customApi = win.locator('[data-model-home-action="custom-api"]').first()
  if (!(await customApi.isVisible())) await clickOrFail(win.locator('[data-model-home-action="other-ways"]').first(), 'expand other connection ways')
  await clickOrFail(customApi, 'open custom connection')
  await win.getByPlaceholder('如：TOAPI 中转').fill('Discovery New Connection')
  await win.getByPlaceholder('https://api.openai.com/v1').fill(`${base}/relay/v1`)
  await win.getByPlaceholder('sk-...').fill('fixture-discovery-key')
  await clickOrFail(win.getByRole('button', { name: '高级设置（接口协议 / 自定义请求头）', exact: true }), '展开自定义请求头')
  await clickOrFail(win.getByRole('button', { name: '添加 Header', exact: true }), '添加鉴权覆盖')
  await win.getByPlaceholder('Header 名，如 HTTP-Referer').fill('AUTHORIZATION')
  await win.getByPlaceholder('值', { exact: true }).fill('Bearer fixture-gateway-override')
  await clickOrFail(win.getByRole('button', { name: '保存连接', exact: true }), '先保存新连接')
  await clickOrFail(win.getByRole('button', { name: '获取模型', exact: true }), '新连接读取模型列表')
  await expect(row('gpt-discovery-text')).toBeEnabled()
  await clickOrFail(row('gpt-discovery-text'), '选择新连接文本模型')
  relayMode = 'auth'
  await clickOrFail(refetch(), '新连接鉴权失败')
  await expect(status()).toContainText('未通过鉴权')
  await expect(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true })).toBeEnabled()
  await snap('05-new-connection-keeps-selection')
  relayMode = 'success'
  await clickOrFail(refetch(), '新连接恢复')
  await expect(refetch()).toBeEnabled()
  relayMode = 'slow'
  releaseSlow = undefined
  await clickOrFail(refetch(), '新连接发起慢刷新')
  await expect.poll(() => typeof releaseSlow).toBe('function')
  await clickOrFail(picker().getByRole('button', { name: '取消', exact: true }), '请求中返回上一屏')
  await expect(picker()).toContainText('\u8fde\u63a5\u5df2\u5b89\u5168\u4fdd\u5b58')
  releaseSlow()
  await win.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(picker()).toContainText('\u8fde\u63a5\u5df2\u5b89\u5168\u4fdd\u5b58')
  relayMode = 'success'
  await clickOrFail(win.getByRole('button', { name: '获取模型', exact: true }), '用户主动返回列表')
  await clickOrFail(row('gpt-discovery-text'), '重新选择新连接文本模型')
  await clickOrFail(picker().getByRole('button', { name: '\u81ea\u68c0 1 \u4e2a', exact: true }), 'run model self-check')
  await completeModelSelfCheck()
  await expect(win.locator('[data-model-settings-page="add"]')).toBeVisible()
  const newConnectionKey = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors().find(v => v.name === 'Discovery New Connection')?.key)
  expect(newConnectionKey).toBeTruthy()
  expect(await savedKeys(newConnectionKey)).toContain('gpt-discovery-text')
  const newHealth = await win.evaluate(vendorKey => window.nomiDesktop.onboarding.vendorHealth({ vendorKey, force: true }), newConnectionKey)
  expect(newHealth.state).toBe('reachable')

  // Cold start proves persistence; final light/en screenshot checks both locale and theme branches.
  await win.evaluate(() => { localStorage.setItem('nomi-color-scheme', 'light'); localStorage.setItem('nomi:locale:v1', 'en') })
  await instance.close()
  instance = await launchNomiApp({
    name: 'provider-model-discovery-cold',
    tempRoot,
    args: ['--no-proxy-server'],
    syntheticCredentialStorage: true,
  })
  win = instance.win
  await expect(win.locator('[data-testid="open-model-settings"]').first()).toBeVisible({ timeout: 30_000 })
  expect(await savedKeys('kie')).toContain('manual-discovery-model')
  expect(await savedKeys(replicateVendorKey)).toEqual(expect.arrayContaining(['owner/flux-discovery']))
  expect(await savedKeys(newConnectionKey)).toContain('gpt-discovery-text')
  const coldHealth = await win.evaluate(vendorKey => window.nomiDesktop.onboarding.vendorHealth({ vendorKey, force: true }), newConnectionKey)
  expect(coldHealth.state).toBe('reachable')
  await home()
  await openPicker('kie')
  await clickOrFail(refetch(), 'Cold-start catalog discovery')
  await expect(status()).toContainText('not the provider’s full catalog')
  await expect.poll(() => win.evaluate(() => document.documentElement.dataset.nomiColorScheme)).toBe('light')
  // EN-DOM 断言网:此刻界面确实是英文(上面刚断言过 catalog 文案的英文原文),整页不该再有中文。
  await expectNoCjkInEnglishDom(win, { message: '模型发现冷启动页在 en 下出现中文' })
  await snap('06-cold-start-english-light')
  const modelListRequests = requests.filter(r => r.path.endsWith('/models'))
  expect(modelListRequests.length).toBeGreaterThan(0)
  expect(modelListRequests.every(r => r.method === 'GET')).toBe(true)
  const relayRequests = requests.filter(r => r.path === '/relay/v1/models')
  expect(relayRequests.some(r => r.authorization === 'Bearer fixture-gateway-override')).toBe(true)
  expect(requests.filter(r => r.path !== '/relay/v1/models').every(r => r.authorization === 'Bearer fixture-discovery-key')).toBe(true)
  fs.writeFileSync(path.join(tempRoot, 'result.json'), JSON.stringify({ passed: true, originalKieModels: originalKieKeys.length, requests: requests.map(({ authorization: _auth, ...request }) => request), shots }, null, 2))
  console.log(`PASS provider discovery journeys; evidence ${tempRoot}; generation requests: 0`)
} catch (error) {
  if (win) await snap('failure').catch(() => undefined)
  throw error
} finally {
  releaseSlow?.()
  await instance?.close().catch(() => undefined)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
