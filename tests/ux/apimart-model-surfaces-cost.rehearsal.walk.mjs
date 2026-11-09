#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'
import { createModelCostProxy, MODEL_COST, stepsHash } from './_modelSurfaceCostSupport.mjs'
import { modelSurfaceCostSteps } from './_modelSurfaceCostSteps.mjs'
import { newProjectEntry } from './_shell.mjs'
import { expect } from './_assert.mjs'
import { lockSpendToModels } from './_paidRun.mjs'

assert(process.env.NOMI_SPEND_OK !== '1', 'Free rehearsal never accepts spend authorization')
const output = path.resolve(process.env.NOMI_MODEL_COST_OUT || '.tmp/model-surfaces-cost')
fs.mkdirSync(output, { recursive: true })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'src', 'electron'])
const receipt = { status: 'failed', commit, model: MODEL_COST, stepsHash: stepsHash(), startedAt: new Date().toISOString(), results: [] }
try {
  for (const locale of ['zh-CN', 'en']) {
    const root = makeTempDir('nomi-model-cost-')
    const settingsDir = path.join(root, 'settings'), userDataDir = path.join(root, 'user-data')
    // Loopback fixture only; the production APIMart mapping/bootstrap remains the one under test.
    const fixture = await createAgentRuntimeFixture({ rootDir: process.cwd(), settingsDir, userDataDir, appName: 'nomi', generationProvider: 'apimart' })
    fixture.setMediaBehavior(() => ({ inlineResult: true }))
    let app, proxy
    try {
      const price = JSON.parse(fs.readFileSync(new URL('../fixtures/model-surfaces-cost/public-price.json', import.meta.url)))
      proxy = await createModelCostProxy(fixture.baseURL, { reply: (req, url, records) => {
        const credits = records.length ? 123.435 : 123.45
        const usage = records.length ? 10.015 : 10
        if (req.method === 'GET' && url.pathname === '/v1/balance') return { body: { success: true, remain_credits: credits, unlimited_quota: true } }
        if (req.method === 'GET' && url.pathname === '/v1/user/balance') return { body: { success: true, remain_credits: credits, remain_balance: credits / 10 } }
        if (req.method === 'GET' && url.pathname === '/v1/usage') return { body: { success: true, data: { scope: 'account', start: Number(url.searchParams.get('start')), end: Number(url.searchParams.get('end')), total: { credits: usage, amount_usd: usage / 10, requests: records.length ? 2 : 1 } } } }
        if (req.method === 'GET' && url.pathname === '/api/pricing/model') return { body: url.searchParams.get('model') === MODEL_COST.modelKey ? price : { success: false } }
        return null
      } })
      const options = { name: 'model-cost-' + locale, settingsDir, userDataDir, projectsDir: path.join(root, 'projects'), syntheticCredentialStorage: true,
        env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: proxy.origin }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: [fixture.baseURL, proxy.origin].join(',') },
        initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' } }
      const started = await launchNomiApp(options); app = started.app
      const page = started.win
      await page.evaluate(model => window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: model.vendorKey, modelKey: model.modelKey, enabled: true, published: true }), MODEL_COST)
      await lockSpendToModels(page, [MODEL_COST])
      await newProjectEntry(page).click()
      await expect(page.locator('.tiptap[contenteditable="true"]').first()).toBeVisible()
      const projectId = await page.evaluate(() => new URL(location.href).searchParams.get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId'))
      const report = await modelSurfaceCostSteps({ page, projectId, proxy, locale, screenshotDir: output })
      assert(Math.abs(report.actual.credits - 0.015) < 1e-9, 'Known loopback debit must be recovered')
      receipt.results.push(report)
    } finally { if (app) await app.close(); if (proxy) await proxy.close(); await fixture.close(); fs.rmSync(root, { recursive: true, force: true }) }
  }
  receipt.status = 'passed'
} catch (error) { receipt.error = error.message; receipt.partial = error.report; process.exitCode = 1; console.error(error) }
finally { receipt.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2)) }
