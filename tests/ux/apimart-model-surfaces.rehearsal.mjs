import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, seedSavedFixtureCredentials } from './_launchApp.mjs'
import { clickOrFail, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, backToLibrary, closeSettings, newProjectEntry, openSettings, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const output = path.resolve(process.env.NOMI_SURFACE_EVIDENCE || '.tmp/model-surface-rehearsal')
// 缺省浅色；NOMI_SURFACE_SCHEME=dark 整轮按暗色起（截图名带 dark），中文轨中途切暗那一段只在浅色轮跑。
const scheme = process.env.NOMI_SURFACE_SCHEME === 'dark' ? 'dark' : 'light'
const shot = (locale, name) => path.join(output, locale + '-' + name + (scheme === 'dark' ? '-dark' : '') + '.png')
fs.mkdirSync(output, { recursive: true })
const calls = []
let accountMode = 'valid'
const server = http.createServer((req, res) => {
  const target = new URL(req.url, 'http://127.0.0.1')
  calls.push({ method: req.method, path: target.pathname })
  let payload
  if (req.method !== 'GET') { res.statusCode = 405; payload = { success: false } }
  else if (target.pathname === '/v1/balance') payload = { success: true, remain_credits: 18, remain_balance: 1.8, unlimited_quota: true }
  else if (target.pathname === '/v1/user/balance') payload = accountMode === 'unknown' ? { success: false } : { success: true, remain_credits: accountMode === 'empty' ? 0 : accountMode === 'low' ? 1 : 52.3 }
  else if (target.pathname === '/v1/usage') payload = { success: true, data: { total: { credits: 19.6, requests: 41 } } }
  else if (target.pathname === '/api/pricing/model') {
    const model = target.searchParams.get('model')
    payload = model === 'seedance-2.0-mini' ? { success: true, data: {
      model_name: model, billing_type: 'per_second', membership: { category: 'video' },
      resolution_enabled: true, resolution_paid_prices: { '720P': 0.039, '480P': 0.02 },
    } } : model === 'gpt-image-2.6-flare' ? { success: true, data: {
      model_name: model, membership: { category: 'image' }, billing_type: 'tiered_token',
      precharge_billing_type: 'size_quality_token_formula', pricing: { unit: 'usd_per_million_tokens' },
      size_quality_paid_prices: { '1:1': { medium: 0.034776 } },
    } } : { success: false }
  } else { res.statusCode = 404; payload = { success: false } }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = 'http://127.0.0.1:' + server.address().port
const results = []
const absenceControls = []
const settingsRows = []
const sends = []
let explicitSends = 0
async function recordSettingsRows(win, locale, scheme) {
  const rows = await win.evaluate(() => {
    const header = document.querySelector('[data-model-account="apimart"]').firstElementChild
    const actions = header.lastElementChild
    const label = actions.previousElementSibling
    const measure = (text, control) => {
      const a = text.getBoundingClientRect(), b = control.getBoundingClientRect()
      return { text: text.textContent, gap: b.left - a.right, centerOffset: (b.top + b.bottom - a.top - a.bottom) / 2 }
    }
    const folds = ['[data-model-home-assisted]', '[data-model-home-other-connections]'].map(selector => {
      const summary = document.querySelector(selector).querySelector('summary')
      const group = summary.firstElementChild.lastElementChild
      const title = group.firstElementChild
      return { ...measure(title, group.lastElementChild), hintOffset: title.getBoundingClientRect().left - summary.lastElementChild.getBoundingClientRect().left }
    })
    return { account: measure(label, actions), folds }
  })
  for (const row of [rows.account, ...rows.folds]) {
    assert(Math.abs(row.gap - 6) < 0.5, 'Secondary controls use gap-1.5 after their text')
    assert(Math.abs(row.centerOffset) < 0.5, 'Secondary controls share the text row center')
  }
  for (const row of rows.folds) assert(Math.abs(row.hintOffset) < 0.5, 'Disclosure titles align with their hint text')
  settingsRows.push({ locale, scheme, ...rows })
}
const perfFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : undefined
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 5
const pickerResponseMs = []
try {
  for (const locale of (perfFile ? ['en'] : ['zh-CN', 'en'])) {
    accountMode = 'valid'
    const root = makeTempDir('nomi-model-surfaces-')
    const settingsDir = path.join(root, 'settings')
    fs.mkdirSync(settingsDir, { recursive: true })
    const options = {
      name: 'apimart-model-surfaces-' + locale, userDataDir: settingsDir, settingsDir, projectsDir: path.join(root, 'projects'),
      syntheticCredentialStorage: true,
      env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: origin }]) },
      initialLocalStorage: { 'nomi-color-scheme': scheme, 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
        'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    }
    fs.mkdirSync(options.projectsDir, { recursive: true })
    // Exercise both a new catalog and the neutral snapshot written by the real 0.24.1 store.
    const previousCatalog = locale === 'en' && !perfFile
    if (previousCatalog) {
      const snapshot = new URL('../fixtures/old-user-data/curated/v0.24.1-apimart/model-catalog.json', import.meta.url)
      fs.copyFileSync(snapshot, path.join(settingsDir, 'model-catalog.json'))
    }
    await seedSavedFixtureCredentials(options, ['apimart'])
    const { app, win } = await launchNomiApp(options)
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      await clickOrFail(newProjectEntry(win), 'new project')
      await openSettings(win, { tab: 'models' })
      const card = win.locator('[data-model-account="apimart"]').first()
      await expect(card, 'board:ModelSurfaces/settings.account-card').toContainText('52.3')
      await expect(card).toContainText('19.6')
      await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.unlimited'))
      if (!perfFile) await recordSettingsRows(win, locale, scheme)
      await screenshotSettled(win, { path: shot(locale, 'account') })
      if (!perfFile && locale === 'zh-CN' && scheme === 'light') {
        const general = await openSettings(win, { tab: 'general' })
        await clickOrFail(general.getByRole('button', { name: uiText(locale, 'theme.switchToDark'), exact: true }), 'switch to dark theme')
        await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
        await openSettings(win, { tab: 'models' })
        await recordSettingsRows(win, locale, 'dark')
        await screenshotSettled(win, { path: path.join(output, 'zh-CN-account-dark.png') })
        await openSettings(win, { tab: 'general' })
        await clickOrFail(general.getByRole('button', { name: uiText(locale, 'theme.switchToLight'), exact: true }), 'restore light theme')
        await expect(win.locator('html')).toHaveAttribute('data-theme', 'light')
        await openSettings(win, { tab: 'models' })
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
      const bounds = await card.evaluate(el => [el.scrollWidth, el.clientWidth])
      assert(bounds[0] <= bounds[1] + 1, 'Account contents fit narrow settings')
      await screenshotSettled(win, { path: shot(locale, 'account-narrow') })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      accountMode = 'unknown'
      await card.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.refresh') }).click()
      await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.unavailable'))
      accountMode = 'empty'
      await card.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.refresh') }).click()
      await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.credits').replace('{{value}}', '0'))
      accountMode = 'valid'
      await card.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.refresh') }).click()
      await expect(card).toContainText('52.3')
      await closeSettings(win)
      await switchWorkspace(win, 'generation')
      await addCanvasNode(win, 'video')
      const picker = win.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true }).first()
      if (perfFile) {
        await expectVisible(picker, 'model picker is ready')
        for (let run = -1; run < runs; run++) {
          const start = performance.now()
          await picker.click()
          const dropdown = win.locator('[data-nomi-select-dropdown]:visible').first()
          await dropdown.locator('input').fill('seedance')
          await expect(dropdown.getByRole('option').filter({ hasText: 'Seedance' }).first()).toBeVisible()
          if (run >= 0) pickerResponseMs.push(performance.now() - start)
          const dropdownProof = await proveProbe(dropdown, 'opened model dropdown')
          await win.keyboard.press('Escape')
          await expectAbsent(dropdown, { provenBy: dropdownProof, message: 'Escape closes the model dropdown' })
        }
      }
      await clickOrFail(picker, 'open model picker')
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      const search = menu.locator('input').first()
      if (!perfFile) {
        const dropdownProof = await proveProbe(menu, 'opened model dropdown before Escape')
        // Negative control: the original absence assertion must fail while this real dropdown is open.
        await assert.rejects(() => expect(menu).toHaveCount(0, { timeout: stationTimeout() }), error =>
          /Expected:.*0/.test(error.message) && /Received:.*1/.test(error.message))
        await win.keyboard.press('Escape')
        await expectAbsent(menu, { provenBy: dropdownProof, message: 'Escape closes the proven dropdown' })
        absenceControls.push({ locale, visibleDropdownRejectedAbsence: true, escapedDropdownAbsent: true })
        await clickOrFail(picker, 'reopen model picker after Escape')
        await expect(search).toBeFocused()
        await search.fill('nomi-no-such-model')
        await menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.aiSetup') }).click()
        await expect(win.locator('details[data-model-home-assisted][open]'), 'board:ModelSurfaces/picker.search').toBeVisible()
        await closeSettings(win)
        await picker.click()
      }
      await search.fill('seedance')
      // 主干菜单：变体各占一行、行上一句能力描述（代替分支原先的能力芯片）。
      const row = menu.getByRole('option').filter({ hasText: 'Mini' }).first()
      await expect(row, 'board:ModelSurfaces/picker.search').toBeVisible()
      await expect(row.locator('[data-nomi-select-option-description]'), 'board:ModelSurfaces/picker.row').not.toHaveCount(0)
      await screenshotSettled(win, { path: shot(locale, 'model-picker') })
      await row.click()
      const send = win.locator('[data-bar-segment="generate"]').first()
      await expect(send, 'board:ModelSurfaces/cost.send-pill').toHaveAttribute('data-price-source', /api\/pricing\/model/, { timeout: stationTimeout() })
      await expect(send, 'board:ModelSurfaces/cost.hover').toHaveAttribute('aria-description', /1[.,]95/)
      await expect(send.locator('[data-send-cost="credits"]'), 'board:ModelSurfaces/cost.send-pill').toHaveText(/1[.,]95/)
      const footer = win.locator('[data-node-composer-footer]').first()
      const footerHeight = async () => (await footer.boundingBox()).height
      const pillHeight = await footerHeight()
      await screenshotSettled(win, { path: shot(locale, 'public-estimate') })
      // 悬停那一句（cost.hover）：设计系统 Tooltip，截图拍得到；句子照板原文。
      await send.hover()
      const tip = win.locator('[data-send-cost-hover]').first()
      await expect(tip, 'board:ModelSurfaces/cost.hover').toBeVisible({ timeout: stationTimeout() })
      await expect(tip).toHaveText(/1[.,]95/)
      await expect(tip).toHaveText(/0[.,]195/)
      results.push({ locale, hoverText: await tip.innerText() })
      await screenshotSettled(win, { path: shot(locale, 'hover') })
      // 指针移开（Radix 离开后要再收到一次移动才收起，真鼠标是连续移动；这里分步移两次）。
      await footer.hover({ position: { x: 4, y: 4 } })
      await win.mouse.move(20, 20, { steps: 5 })
      await expect(tip).toHaveCount(0, { timeout: stationTimeout() })
      results.push({ locale, catalog: previousCatalog ? 'v0.24.1-apimart' : 'fresh', quote: await send.innerText() })
      // 去充值走 window.open → 主进程 shell.openExternal；走查把渲染层 window.open 换成记录器，只记 URL、不真开浏览器。
      await win.evaluate(() => { window.__nomiOpened = []; window.open = (url) => { window.__nomiOpened.push(String(url)); return null } })
      const slot = win.locator('[data-bar-segment="generate"]').first()
      for (const state of ['unknown', 'low', 'empty', 'valid']) {
        accountMode = state
        await openSettings(win, { tab: 'models' })
        await card.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.refresh') }).click()
        if (state === 'unknown') await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.unavailable'))
        else await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.credits').replace('{{value}}', state === 'empty' ? '0' : state === 'low' ? '1' : '52.3'))
        await closeSettings(win)
        if (state === 'unknown' || state === 'valid') {
          // 余额查不到 / 够：照常是发送胶囊，不换成去充值。
          await expect(slot.locator('[data-send-cost="credits"]'), 'board:ModelSurfaces/cost.low-balance').toBeVisible()
          await expect(win.locator('[data-send-cost="shortfall"]')).toHaveCount(0)
          continue
        }
        // 余额刚查到且低于估价（1 < 1.95）/ 为零：同一行里发送键换成「还差 N 积分」+「去充值」，底栏不长高、下面没有第二行。
        const shortfall = win.locator('[data-send-cost="shortfall"]').first()
        const gap = state === 'empty' ? '1[.,]95' : '0[.,]95'
        await expect(shortfall, 'board:ModelSurfaces/cost.low-balance').toContainText(new RegExp(uiText(locale, 'onboardingProviders.account.shortBy').replace('{{value}}', gap)))
        await expect(win.locator('[data-bar-segment="generate"] button[aria-label="' + uiText(locale, 'generationCommon.composer.generateAsset') + '"]')).toHaveCount(0)
        const lowHeight = await footerHeight()
        // 「还差 N 积分」和「去充值」在同一行：两者竖直中线相差不到 1px。
        const centers = await shortfall.evaluate(el => [...el.children].map(child => { const r = child.getBoundingClientRect(); return r.top + r.height / 2 }))
        assert.equal(centers.length, 2)
        assert(Math.abs(centers[0] - centers[1]) < 1, 'shortfall text and top-up button share one row')
        assert.equal(lowHeight, pillHeight, 'low-balance footer height equals the normal pill footer height')
        // 让位次序：底栏挤时先让摘要、方式名（共用让法 ②③），「还差 N 积分」和「去充值」不在让法里——
        // 两者都不被截断（内容宽 ≤ 自身宽），且整颗落在底栏里面点得到。
        const fit = await shortfall.evaluate(el => {
          const bar = el.closest('[data-bar-segment]').parentElement.getBoundingClientRect()
          const r = el.getBoundingClientRect()
          return { clipped: [el, ...el.children].some(child => child.scrollWidth > child.clientWidth + 1), inside: r.left >= bar.left - 0.5 && r.right <= bar.right + 0.5 }
        })
        assert.deepEqual(fit, { clipped: false, inside: true }, 'shortfall and top-up are never truncated and stay inside the bar')
        results.push({ locale, state, footerHeight: { pill: pillHeight, low: lowHeight } })
        await screenshotSettled(win, { path: shot(locale, state === 'low' ? 'low-balance' : 'zero-balance') })
        const topUp = shortfall.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.billing') })
        if (state === 'empty') {
          const priorBalanceReads = calls.filter(call => call.path === '/v1/user/balance').length
          // 钮画成「去充值」之后读数可能过期：过期时点它只重读，不把人送去充值页。
          await topUp.evaluate(button => {
            const realNow = Date.now
            Date.now = () => realNow() + 31_000
            try { button.click() } finally { Date.now = realNow }
          })
          await expect.poll(() => calls.filter(call => call.path === '/v1/user/balance').length).toBeGreaterThan(priorBalanceReads)
          assert.deepEqual(await win.evaluate(() => window.__nomiOpened), [])
        }
        await clickOrFail(topUp, 'click top up')
        const opened = await win.evaluate(() => window.__nomiOpened.splice(0))
        assert.deepEqual(opened, [locale.startsWith('zh') ? 'https://apimart.ai/zh/billing' : 'https://apimart.ai/billing'])
        results.push({ locale, state, topUpOpened: opened })
        assert.equal(calls.filter(call => call.method !== 'GET').length, explicitSends)
      }
      if (!perfFile) {
        // 图片节点放进一个新项目：和视频节点同屏时，第二张的生成框会落到窗口外（主干画布的落点，和本刀无关）。
        await backToLibrary(win)
        await clickOrFail(newProjectEntry(win), 'new project for the image node')
        await switchWorkspace(win, 'generation')
        await addCanvasNode(win, 'image')
        const imageComposer = win.locator('[data-composer-host="canvas"]:visible').last()
        const imagePicker = imageComposer.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
        await imagePicker.click()
        await search.fill('Flare')
        await menu.getByRole('option').filter({ hasText: 'GPT Image 2.6 Flare' }).click()
        const imageSend = imageComposer.locator('[data-bar-segment="generate"]')
        await expect(imageSend).toHaveAttribute('aria-description', uiText(locale, 'onboardingProviders.account.priceUnknown'))
        // 算不出：钮上只剩 ↑，不印数、不印 0、不印「—」。
        await expect(imageSend.locator('[data-send-cost]'), 'board:ModelSurfaces/cost.send-pill').toHaveCount(0)
        await expect(imageSend).toHaveText('')
        await screenshotSettled(win, { path: shot(locale, 'price-unknown') })
        await imageComposer.locator('[data-parameter-summary]').click()
        const size = win.locator('[data-agent-parameter-control="size"]').first()
        await size.getByText('1:1', { exact: true }).click()
        await win.keyboard.press('Escape')
        await expect(imageSend, 'board:ModelSurfaces/cost.send-pill').toHaveText(/0[.,]35/, { timeout: stationTimeout() })
        await expect(imageSend).toHaveAttribute('data-price-source', /model=gpt-image-2.6-flare/)
        await expect(imageSend).toHaveAttribute('aria-description', /token/i)
        await imageSend.hover()
        await expect(win.locator('[data-send-cost-hover]').first(), 'board:ModelSurfaces/cost.hover').toHaveText(/0[.,]035/, { timeout: stationTimeout() })
        await win.mouse.move(5, 5)
        await screenshotSettled(win, { path: shot(locale, 'output-estimate') })
        results.push({ locale, model: 'gpt-image-2.6-flare', outputEstimate: await imageSend.getAttribute('aria-description') })
        // 真点发送：写一句提示词再点。上游是本机假服务（非 GET 一律 405，不产出媒体）：
        // 弹花钱确认就取消；直接发出就记下那一笔，看节点上创作者看到什么。
        await imageComposer.locator('[data-prompt-box] .ProseMirror').first().fill('清晨的码头，一只白鹭')
        const postsBefore = calls.filter(call => call.method !== 'GET').length
        await clickOrFail(imageSend, 'click send with an output estimate')
        const dialog = win.locator('[data-spend-confirm-dialog]').first()
        await expect.poll(async () => (await dialog.isVisible()) || calls.filter(call => call.method !== 'GET').length > postsBefore,
          { timeout: stationTimeout() }).toBe(true)
        if (await dialog.isVisible()) {
          await screenshotSettled(win, { path: shot(locale, 'send-confirm') })
          await clickOrFail(dialog.locator('[data-spend-confirm-action="cancel"]'), 'cancel spend confirmation')
          sends.push({ locale, outcome: 'confirm-cancelled', posts: calls.filter(call => call.method !== 'GET').length - postsBefore })
        } else {
          await win.waitForTimeout(1500)
          await screenshotSettled(win, { path: shot(locale, 'send-fake-upstream') })
          sends.push({ locale, outcome: 'sent-to-fake-upstream', posts: calls.filter(call => call.method !== 'GET').slice(postsBefore) })
        }
        explicitSends += calls.filter(call => call.method !== 'GET').length - postsBefore
      }
    } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }) }
  }
  // 非 GET 只许来自上面那一次真点发送（假上游 405，不产出媒体）。
  assert.equal(calls.filter(c => c.method !== 'GET').length, explicitSends)
  assert(calls.some(c => c.path === '/api/pricing/model'))
  if (perfFile) {
    fs.writeFileSync(perfFile, JSON.stringify({ runs, noisy: os.loadavg()[0] >= 10, metrics: { response: pickerResponseMs } }))
  }
  fs.writeFileSync(path.join(output, 'receipt' + (scheme === 'dark' ? '-dark' : '') + '.json'), JSON.stringify({ results, sends, absenceControls, settingsRows, reads: calls, generationSubmissions: explicitSends }, null, 2))
} finally { server.close() }
