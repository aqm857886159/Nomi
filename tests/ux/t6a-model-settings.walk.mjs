// ModelSurfaces S1, S1b and D2-2. All provider calls are redirected to a loopback fixture.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as requireTs } from 'tsx/cjs/api'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { copyOldUserData } from '../world/oldUserData.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { openModelSettings, openSettings, closeSettings } from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { renderScorecard } from './experience/scorecard.mjs'
import { writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { initialPreferences } from './uiDriverOptions.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.join(root, 'docs/evidence/2026-11-24-t6a-model-settings')
const board = path.join(root, 'docs/design/boards/2026-11-07-model-surfaces/preview')
const oldFixture = path.join(root, 'tests/fixtures/old-user-data/catalogs/v0.24.1-wizard')
const requests = []
let offline = false
const comparisons = []
const attempts = []
const measurements = []
let nameChecks = 0
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  requests.push([req.method, url.pathname])
  let body
  if (url.pathname === '/v1/user/balance' && !offline) body = { remain_credits: 52.3 }
  if (url.pathname === '/v1/balance') body = { unlimited_quota: true, remain_credits: -1 }
  if (url.pathname === '/api/pricing/model') {
    const model = url.searchParams.get('model')
    const video = model.includes('seedance')
    body = { success: true, data: { model_name: model, membership: { category: video ? 'video' : 'image' },
      paid_price: video ? 0.216 : 0.035, ...(video ? { billing_type: 'per_second' } : {}) } }
  }
  if (url.pathname === '/api/pricing/models/all') body = { success: true, data: { models: { image:
    ['gpt-image-2.6-flare', 'gpt-image-2', 'gemini-nano-banana-2.1'].map(id => ({ id, specification: 'image', fixed_prices: { unit: 'usd_per_image' } })) } } }
  res.writeHead(body ? 200 : 503, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body ?? {}))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
const { buildWorld } = requireTs('../world/index.ts', import.meta.url)
fs.mkdirSync(output, { recursive: true })

async function shot(win, name) {
  const file = path.join(output, name + '.png')
  await screenshotSettled(win, { path: file })
  const pair = [path.join(board, name + '.png'), file].map(f => fs.readFileSync(f).toString('base64'))
  const png = await win.evaluate(async images => {
    const [left, right] = await Promise.all(images.map(async base64 => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + base64
      await img.decode()
      return img
    }))
    const height = 800
    const widths = [left, right].map(im => Math.round(im.width * height / im.height))
    const canvas = document.createElement('canvas')
    canvas.width = widths[0] + widths[1]
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(left, 0, 0, widths[0], height)
    ctx.drawImage(right, widths[0], 0, widths[1], height)
    return canvas.toDataURL().split(',')[1]
  }, pair)
  fs.writeFileSync(path.join(output, 'board-vs-impl-' + name + '.png'), Buffer.from(png, 'base64'))
  comparisons.push(name)
}

async function checkNames(win) {
  const violations = await win.locator('[data-settings-content]').evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const failures = []
    while (walker.nextNode()) {
      const text = walker.currentNode
      const parent = text.parentElement
      if (!parent?.checkVisibility()) continue
      for (const match of text.textContent.matchAll(/「[^」]+」|“[^”]+”/gu)) {
        const range = document.createRange()
        range.setStart(text, match.index)
        range.setEnd(text, match.index + match[0].length)
        const rects = [...range.getClientRects()].filter(r => r.height > 0)
        if (rects.length && (new Set(rects.map(r => r.top)).size > 1 || parent.tagName !== 'SPAN'
            || getComputedStyle(parent).whiteSpace !== 'nowrap' || getComputedStyle(parent).display !== 'inline')) failures.push(match[0])
      }
    }
    return failures
  })
  assert.deepEqual(violations, [], 'board:ModelSurfaces/text.quoted-name-no-split')
  nameChecks++
}

function seedUsage(settingsDir) {
  const [project] = JSON.parse(fs.readFileSync(path.join(settingsDir, 'recent-workspaces.json')))
  const events = []
  for (const [day, amount] of [[1, 4.9], [15, 10.8]]) {
    const ts = new Date(Date.now() - day * 86400000).toISOString()
    for (const [type, facts] of [
      ['vendor.call.requested', { recipe: { vendorKey: 'apimart', modelKey: 'gpt-image-2' } }],
      ['vendor.call.completed', { status: 'succeeded', cost: { amount, unit: 'credits', provider: 'apimart' } }],
    ]) events.push({ v: 1, seq: events.length + 1, id: 'receipt-' + events.length, ts, source: 'runtime', type, payload: { runId: 'run-' + day, ...facts } })
  }
  const dir = path.join(project.rootPath, '.nomi/events')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'log-0.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
}

async function scenario(kind, locale = 'zh-CN', theme = 'light', width = 1280) {
  const tempRoot = makeTempDir('nomi-model-settings-')
  const world = buildWorld({ rootDir: tempRoot, projects: [{ name: 'Studio' }] })
  const { settingsDir, userDataDir } = world
  const catalog = path.join(settingsDir, 'model-catalog.json')
  let legacyKeys
  if (kind === 'connected') {
    writeFakeApimartCatalog(settingsDir, userDataDir)
    seedUsage(settingsDir)
  } else if (kind === 'old') {
    const { apiKeysByVendor } = writeFakeApimartCatalog(settingsDir, userDataDir)
    copyOldUserData(oldFixture, settingsDir)
    const c = JSON.parse(fs.readFileSync(catalog))
    c.apiKeysByVendor.kie = { ...apiKeysByVendor.apimart, vendorKey: 'kie' }
    fs.writeFileSync(catalog, JSON.stringify(c))
    legacyKeys = c.apiKeysByVendor
    const original = c.models.find(m => m.modelKey === 'gpt-image-2')
    buildWorld({ rootDir: tempRoot, projects: [], catalog: {
      vendors: [{ key: 'relay-two', name: 'Relay Two', enabled: true, authType: 'none', baseUrlHint: origin }],
      models: [{ ...original, vendorKey: 'relay-two', selectable: true }],
    } })
  } else if (kind === 'notice') {
    fs.writeFileSync(catalog, JSON.stringify({ version: 9999, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }))
  }
  const networkLog = path.join(tempRoot, 'network.jsonl')
  const { win, app, close } = await launchNomiApp({ name: 'model-settings', world, syntheticCredentialStorage: true,
    // This scenario exercises the application's forward-version reader. Preserve the intentionally newer fixture in launcher preparation.
    ...(kind === 'notice' ? { testedCatalogVersion: 9999 } : {}),
    initialLocalStorage: initialPreferences({ locale, theme }), viewportSize: { width, height: 800 },
    mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs')], env: {
      NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_TEST_NETWORK_FIXTURE_ORIGINS: '',
      NOMI_WALK_NET_LOG: networkLog, NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: origin,
      NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]),
    } })
  const initialRequests = requests.length
  try {
    const window = await app.browserWindow(win)
    await window.evaluate((w, size) => { w.setMinimumSize(0, 0); w.setContentSize(size, 800) }, width)
    await win.setViewportSize({ width, height: 800 })
    const dialog = await openModelSettings(win)
    const loc = selector => dialog.locator(selector)
    const back = () => loc('[data-model-settings-back]').first().click()
    const account = loc('[data-model-account]')
    const labelFor = (key, values) => uiTextWith(locale, 'settings.modelsHome.' + key, values)
    const zh = locale === 'zh-CN'
    if (kind === 'fresh') {
      const entry = loc('[data-model-home-available="apimart"]')
      await expect(entry, 'board:ModelSurfaces/settings.connect-entry').toBeVisible()
      await expect(loc('[data-model-home-connection]')).toHaveCount(0)
      await expect(account).toHaveCount(0)
      await expect(loc('[data-model-home-available]')).toHaveCount(1)
      await expect(dialog.getByText('推荐', { exact: true }), 'board:ModelSurfaces/settings.drop.recommend-badge').toHaveCount(0)
      await expect(loc('[data-model-status]'), 'board:ModelSurfaces/settings.drop.fold-status').toHaveCount(0)
      const assisted = loc('[data-model-home-assisted-onboarding]')
      await expect(assisted.locator('summary'), 'board:ModelSurfaces/settings.ai-onboard-row').toBeVisible()
      await assisted.locator('summary').click()
      await expect(assisted.getByText(uiText(locale, 'onboardingProviders.assistedOnboarding.copy'), { exact: true })).toBeVisible()
      await assisted.locator('summary').click()
      await loc('[data-model-home-action="other-ways"]').click()
      await checkNames(win)
      await expect(loc('[data-local-connection="local-speech"]'), 'board:ModelSurfaces/settings.other-ways.local').toBeVisible()
      await expect(loc('[data-local-connection="local-text"]')).toBeVisible()
      await expect(loc('[data-local-connection^="comfyui"]').first()).toBeVisible()
      await expect(loc('[data-model-home-direct-script]'), 'board:ModelSurfaces/settings.other-ways.misc').toBeVisible()
      await expect(loc('[data-settings-section="tikhub-connector"]')).toBeVisible()
      await expect(loc('[data-catalog-package-action="export"]')).toBeVisible()
      await loc('[data-model-home-action="custom-api"]').click()
      await expect(loc('[data-model-settings-page="add"]'), 'board:ModelSurfaces/settings.other-ways.relay').toBeVisible()
      await closeSettings(win)
      await openModelSettings(win)
      await entry.click()
      await expect(win.locator('[data-apimart-right]')).toBeVisible()
    } else if (kind === 'notice') {
      await expect(loc('[data-catalog-notice="read-only-newer"]'), 'board:ModelSurfaces/settings.notices').toBeVisible()
    } else if (kind === 'old') {
      const row = loc('[data-model-home-connection="local-39017"]')
      await expect(row, 'board:ModelSurfaces/settings.legacy-group').toContainText('Relay One')
      await expect(row.locator('[data-model-status]')).toBeVisible()
      await expect(row).toContainText(labelFor('maintenance'))
      await expect(loc('[data-model-home-connection="kie"]')).toContainText(labelFor('kie'))
      await expect(loc('[data-model-home-task-strip]'), 'board:ModelSurfaces/settings.adapter-tasks').toHaveCount(0)
      const search = loc('input').first()
      await expect(search, 'board:ModelSurfaces/settings.search').toBeVisible()
      await search.fill('Relay One')
      await expect(loc('[data-model-home-connection]')).toHaveCount(1)
      await search.fill('')
      await shot(win, 'M1-old-user')
      await checkNames(win)
      await loc('[data-legacy-notice]').getByRole('button').click()
      await closeSettings(win)
      await openModelSettings(win)
      await expect(row).toBeVisible()
      await expect(loc('[data-legacy-notice]'), 'board:ModelSurfaces/settings.legacy-banner').toHaveCount(0)
      assert.deepEqual(JSON.parse(fs.readFileSync(catalog)).apiKeysByVendor, legacyKeys)
      await openSettings(win, { tab: 'ai' })
      await expect(loc('[data-vendor-preference-order]'), 'board:ModelSurfaces/policy.vendor-order').toBeVisible()
    } else {
      await expect(account, 'board:ModelSurfaces/settings.account-card').toContainText(labelFor('credits', { amount: 52.3 }))
      await expect(account).toContainText(labelFor('unlimited'))
      await expect(account).toContainText(labelFor('credits', { amount: 4.9 }))
      await expect(account.getByRole('link')).toHaveAttribute('href', 'https://apimart.ai/billing')
      await expect(loc('[data-model-settings-page="home"] header').first(), 'board:ModelSurfaces/settings.header').toContainText(zh ? /图片 \d+/ : /Image \d+/)
      await expect(loc('input[type="search"]')).toHaveCount(0)
      const frame = loc('[data-settings-frame]')
      const a = await frame.boundingBox()
      assert(a.height >= 360 && a.height <= 560)
      assert.equal(await frame.evaluate(el => el.scrollWidth <= el.clientWidth), true)
      const menu = account.getByRole('button', { name: labelFor('more') })
      await menu.click()
      await expect(win.getByRole('menuitem'), 'board:ModelSurfaces/settings.account-menu').toHaveCount(3)
      if (theme === 'dark') await shot(win, 'M1-dark')
      await win.keyboard.press('Escape')
      if (theme !== 'dark') await shot(win, !zh ? 'M1-en' : width === 700 ? 'M1-narrow' : 'Main')
      await checkNames(win)
      await account.getByRole('button', { name: labelFor('usage') }).click()
      await expect(loc('[data-usage-model="gpt-image-2"]'), 'board:ModelSurfaces/settings.usage-page').toContainText('4.9')
      await expect(loc('[data-unit-price="gpt-image-2"]')).toContainText('0.35')
      if (zh && theme === 'light' && width !== 700) await shot(win, 'M1-usage')
      await checkNames(win)
      await dialog.getByRole('radio', { name: /30/ }).click()
      await expect(loc('[data-usage-model="gpt-image-2"]')).toContainText('15.7')
      await expect(loc('[data-usage-model="gpt-image-2"]')).toContainText(labelFor('runs', { count: 2 }))
      await back()
      await openSettings(win, { tab: 'ai' })
      const b = await frame.boundingBox()
      assert(Math.abs(b.y - a.y) < 1 && b.height >= 360 && b.height <= 560 && b.height > a.height, 'board:ModelSurfaces/settings.frame-height')
      measurements.push({ locale, theme, width, home: a.height, policy: b.height, top: a.y })
      await expect(loc('[data-settings-tab-id]'), 'board:ModelSurfaces/other-tabs.unchanged').toHaveCount(6)
      await expect(loc('[data-settings-section="default-generation-models"] button'), 'board:ModelSurfaces/policy.defaults').toHaveCount(4)
      await expect(loc('[data-vendor-preference-order]')).toHaveCount(0)
      const box = loc('[data-model-box-order] details')
      await expect(box.locator('summary'), 'board:ModelSurfaces/policy.model-box').toBeVisible()
      await expect(loc('[data-settings-upload-guidance]'), 'board:ModelSurfaces/policy.upload').toBeVisible()
      const relay = loc('[data-settings-custom-relay]')
      await expect(relay, 'board:ModelSurfaces/policy.relay-advanced').not.toHaveAttribute('open', '')
      await checkNames(win)
      if (zh && theme === 'light' && width !== 700) {
        await shot(win, 'M6-ai-policy')
        const defaults = loc('[data-settings-section="default-generation-models"] button').first()
        await defaults.click()
        const option = win.getByRole('option').nth(1)
        const label = await option.innerText()
        await option.click()
        await expect(defaults).toHaveText(label)
        const upload = loc('[data-settings-upload-guidance]').getByRole('switch')
        await upload.press('Space')
        await expect(upload).toBeChecked()
        for (const tab of ['file', 'automation', 'general', 'about', 'ai']) await openSettings(win, { tab })
        await expect(defaults).toHaveText(label)
        await expect(upload).toBeChecked()
        await upload.press('Space')
        await expect(upload).not.toBeChecked()
        await box.locator('summary').click()
        const model = loc('[data-model-box-row]').first()
        const key = await model.getAttribute('data-model-box-row')
        await model.getByRole('button').last().click()
        await expect(loc('[data-model-box-hidden-row="' + key + '"]')).toBeVisible()
        await loc('[data-model-box-hidden-row="' + key + '"]').getByRole('button').click()
        await expect(loc('[data-model-box-row="' + key + '"]')).toBeVisible()
        await box.locator('summary').click()
        await relay.locator('summary').click()
        await expect(loc('[data-settings-field="asset-relay-endpoint"]')).toBeVisible()
        await openModelSettings(win)
        for (const action of ['address', 'models']) {
          await menu.click()
          await win.locator('[data-menu-item="' + action + '"]').click()
          await expect(loc('[data-model-settings-vendor="apimart"]')).toBeVisible()
          if (action === 'address') await expect(loc('[data-model-connection-field="baseUrl"]')).toBeFocused()
          await back()
        }
        offline = true
        await account.getByRole('button', { name: labelFor('refresh') }).click()
        await expect(account).toContainText(labelFor('stale', { time: '' }).trim())
        await expect(account).toContainText(labelFor('retry'))
        await expect(account).toContainText(labelFor('unlimited'))
        offline = false
        await account.getByRole('button', { name: labelFor('retry') }).first().click()
        await expect(account).not.toContainText(labelFor('stale', { time: '' }).trim())
        await expect(account).toContainText(labelFor('credits', { amount: 52.3 }))
        await menu.click()
        await win.locator('[data-menu-item="disconnect"]').click()
        await win.locator('[data-confirm-dialog-cancel]').click()
        await expect(account).toBeVisible()
        await menu.click()
        await win.locator('[data-menu-item="disconnect"]').click()
        await win.locator('[data-confirm-dialog-confirm]').click()
        await expect(loc('[data-model-home-available="apimart"]')).toBeVisible()
      }
    }
    const guardEvents = fs.readFileSync(networkLog, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert(guardEvents.some(e => e.kind === 'guard-loaded'))
    assert.deepEqual(guardEvents.filter(e => e.kind === 'blocked' && /kie\.ai|39017|relay-two/u.test(e.url)), [])
    const hits = requests.slice(initialRequests)
    if (kind !== 'connected') assert.equal(hits.length, 0, 'a profile without an active APIMart account must issue zero provider reads')
    assert(hits.every(([method]) => method === 'GET'))
    attempts.push({ label: [kind, locale, theme, width].join(' · '), result: 'pass' })
    console.log('PASS', kind, locale, theme, width)
  } catch (error) {
    console.error((await win.locator('[data-settings-dialog]').allInnerTexts()).join(' ').slice(0, 3500))
    throw error
  } finally { offline = false; await close() }
}
try {
  await scenario('old')
  await scenario('notice')
  await scenario('fresh')
  await scenario('connected')
  await scenario('connected', 'en')
  await scenario('connected', 'zh-CN', 'dark')
  await scenario('connected', 'zh-CN', 'light', 700)
  assert.equal(comparisons.length, 7)
  const score = renderScorecard({
    version: 1, date: '2026-11-24', scenarioId: 'settings-model',
    change: { title: 'T-6a 模型账户、用量与 AI 策略', headSha: '2cdc60d58', headNote: '本次隔离构建的基线，含本提交的全部改动',
      added: ['APIMart 账户卡与用量页'], changed: ['旧连接分组与策略整理'], removed: ['首页未配置平台与推荐徽标'],
      userCan: '连接或管理 APIMart，在本机查看近期积分明细，找回旧连接，设置模型和上传偏好。' },
    verifier: { line: '实现线', kind: '隔离 Electron 实窗' },
    machine: { source: 'walk-log', env: { device: process.platform + ' ' + process.arch, window: '1280×800 / 700×800', language: 'zh-CN / en', theme: 'light / dark' },
      attempts, metrics: [
        { name: '从模型首页到用量明细', unit: '点击', baseline: null, current: 1, n: 4, basis: 'script-count' },
        { name: '付费提交', unit: '请求', baseline: null, current: 0, n: attempts.length, basis: 'script-count' },
        { name: '引号内名称断行或容器错误', unit: '处', baseline: null, current: 0, n: nameChecks, basis: 'script-count' },
      ] },
    human: { seq: null, events: null }, guardrails: [
      { name: 'v0.24.1 原连接密钥字段逐项比对一致，旧用户说明关闭后重开仍隐藏', result: 'pass' },
      { name: '设置顶边不随切页移动，内容高度在 360–560px 内', result: 'pass' },
      { name: '断开先确认。账户余额读取失败保留上次读数与时间，Key 额度独立显示', result: 'pass' },
    ],
    friction: { moment: '首轮实窗验收发现已接入用户无法整理模型。', decision: '按已发布的图片、视频、声音模型读取目录，走查实际隐藏再恢复同一行。' },
    unverified: [{ item: '真实账户余额、付款和真人操作评分', owner: '后续真人验收', recheck: '使用本人账户进行独立产品验收时核对。' }],
    evidence: comparisons.map(name => '[设计与实窗 · ' + name + '](board-vs-impl-' + name + '.png)'),
  })
  const report = [score, '## ui-task-scorecard · 原始走查记录', '',
    '隔离凭据与回环供应商共收到 ' + requests.length + ' 次 GET。7 天为 1 次、4.9 积分，30 天为 2 次、15.7 积分。公开单价来自独立报价响应。外部付款链接只核对目标地址。',
    '', '| 语言 / 主题 / 视口宽 | 账户页高 | 策略页高 | 共同顶边 |', '| --- | ---: | ---: | ---: |',
    ...measurements.map(m => '| ' + [m.locale + ' / ' + m.theme + ' / ' + m.width, m.home, m.policy, m.top].join(' | ') + ' |'),
    '', '旧用户场景保留了发布版 Relay One 目录和原始加密字段，并加入 KIE 与同模型的第二家中转以覆盖搜索与排序。新装、旧版与只读目录各自收到零次供应商请求。',
    '', '调试记录：启动器起初拒绝未由测试世界签发的目录。随后实窗发现模型整理入口缺失；改用各媒体目录后复测通过。上传开关由键盘空格操作，读回持久偏好。新版只读场景显式保留超前版本夹具，以便走到产品的保护逻辑。',
    '', '样张差异：积分展示遵循金额格式冻结；菜单依 D-account-default 延后更换 Key。公共临时托管沿用现行许可开关，通道由实际解析器提供。模型页折叠既有 AI 接入指引，MCP 安装仍归自动化页。已删除的 settings.drop.test-connection 的 component 为空，沿用 D-1117。',
    '', '截图左侧为已批样张，右侧为实窗。后台项目、模型目录、回执次数和余额使用隔离数据；七张原图与同名对照图一起保存。', '']
  fs.writeFileSync(path.join(output, 'walkthrough.md'), report.join('\n'))
  console.log('Seven board comparisons. Provider requests', requests.length, 'paid submissions 0.')
} finally { await new Promise(resolve => server.close(resolve)) }
