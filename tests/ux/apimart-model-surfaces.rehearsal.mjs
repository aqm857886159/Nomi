import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, seedSavedFixtureCredentials } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNode, closeSettings, newProjectEntry, openSettings, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const output = path.resolve(process.env.NOMI_SURFACE_EVIDENCE || '.tmp/model-surface-rehearsal')
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
    } } : { success: false }
  } else { res.statusCode = 404; payload = { success: false } }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = 'http://127.0.0.1:' + server.address().port
const results = []
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
      initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen',
        'nomi-onboarding-checklist:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
    }
    fs.mkdirSync(options.projectsDir, { recursive: true })
    await seedSavedFixtureCredentials(options, ['apimart'])
    const { app, win } = await launchNomiApp(options)
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 840))
      await newProjectEntry(win).click({ timeout: 20000 })
      await openSettings(win, { tab: 'models' })
      const card = win.locator('[data-model-account="apimart"]').first()
      await expect(card, 'board:ModelSurfaces/settings.account-card').toContainText('52.3')
      await expect(card).toContainText('19.6')
      await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.unlimited'))
      await screenshotSettled(win, { path: path.join(output, locale + '-account.png') })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
      const bounds = await card.evaluate(el => [el.scrollWidth, el.clientWidth])
      assert(bounds[0] <= bounds[1] + 1, 'Account contents fit narrow settings')
      await screenshotSettled(win, { path: path.join(output, locale + '-account-narrow.png') })
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
        await picker.waitFor({ state: 'visible', timeout: 15000 })
        for (let run = -1; run < runs; run++) {
          const start = performance.now()
          await picker.click()
          const dropdown = win.locator('[data-nomi-select-dropdown]:visible').first()
          await dropdown.locator('input').fill('seedance')
          await expect(dropdown.getByRole('option').filter({ hasText: 'Seedance' }).first()).toBeVisible()
          if (run >= 0) pickerResponseMs.push(performance.now() - start)
          await win.keyboard.press('Escape')
          await expect(dropdown).toHaveCount(0)
        }
      }
      await picker.click({ timeout: 15000 })
      const menu = win.locator('[data-nomi-select-dropdown]:visible').first()
      const search = menu.locator('input').first()
      if (!perfFile) {
        await expect(search).toBeFocused()
        await search.fill('nomi-no-such-model')
        await menu.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.aiSetup') }).click()
        await expect(win.locator('details[data-model-home-assisted][open]'), 'board:ModelSurfaces/picker.search').toBeVisible()
        await closeSettings(win)
        await picker.click()
      }
      await search.fill('seedance')
      const row = menu.getByRole('option').filter({ hasText: 'Seedance 2.0' }).first()
      await expect(row, 'board:ModelSurfaces/picker.search').toBeVisible()
      await expect(row.locator('[data-model-capability]'), 'board:ModelSurfaces/picker.row').not.toHaveCount(0)
      await screenshotSettled(win, { path: path.join(output, locale + '-model-picker.png') })
      await row.click()
      const variant = win.getByRole('button', { name: uiText(locale, 'generationCommon.parameters.variant'), exact: true }).first()
      await variant.click()
      await win.getByRole('option').filter({ hasText: 'Mini' }).first().click()
      const send = win.locator('[data-bar-segment="generate"]').first()
      await expect(send, 'board:ModelSurfaces/cost.send-pill').toHaveAttribute('data-price-source', /api\/pricing\/model/, { timeout: 10000 })
      await expect(send, 'board:ModelSurfaces/cost.hover').toHaveAttribute('aria-description', /1[.,]95/)
      await expect(send.locator('..')).toHaveAttribute('title', /0[.,]195/)
      await screenshotSettled(win, { path: path.join(output, locale + '-public-estimate.png') })
      results.push({ locale, quote: await send.innerText() })
      for (const state of ['low', 'empty', 'valid']) {
        accountMode = state
        await openSettings(win, { tab: 'models' })
        await card.getByRole('button', { name: uiText(locale, 'onboardingProviders.account.refresh') }).click()
        const amount = state === 'empty' ? '0' : state === 'low' ? '1' : '52.3'
        await expect(card).toContainText(uiText(locale, 'onboardingProviders.account.credits').replace('{{value}}', amount))
        await closeSettings(win)
        if (state === 'empty') {
          await expect(send, 'board:ModelSurfaces/cost.low-balance').toHaveAccessibleName(uiText(locale, 'onboardingProviders.account.billing'))
          await screenshotSettled(win, { path: path.join(output, locale + '-zero-balance.png') })
          await expect(send).toBeEnabled()
          const priorBalanceReads = calls.filter(call => call.path === '/v1/user/balance').length
          // A button painted as billing can expire between render and click. Its click must only refresh.
          await send.evaluate(button => {
            const realNow = Date.now
            Date.now = () => realNow() + 31_000
            try { button.click() } finally { Date.now = realNow }
          })
          await expect.poll(() => calls.filter(call => call.path === '/v1/user/balance').length).toBeGreaterThan(priorBalanceReads)
          assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
        } else {
          await expect(send).not.toHaveAccessibleName(uiText(locale, 'onboardingProviders.account.billing'))
        }
      }
    } finally { await app.close(); fs.rmSync(root, { recursive: true, force: true }) }
  }
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0)
  assert(calls.some(c => c.path === '/api/pricing/model'))
  if (perfFile) {
    fs.writeFileSync(perfFile, JSON.stringify({ runs, noisy: os.loadavg()[0] >= 10, metrics: { response: pickerResponseMs } }))
  }
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify({ results, reads: calls, generationSubmissions: 0 }, null, 2))
} finally { server.close() }
