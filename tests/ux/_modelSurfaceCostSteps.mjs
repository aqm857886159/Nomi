import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect, screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { addCanvasNode, canvasZoomPercent, canvasZoomStep, closeSettings, collapseAgentPanel, openSettings, switchWorkspace } from './_shell.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { MODEL_COST, costError } from './_modelSurfaceCostSupport.mjs'
import { CANVAS_STAGE_SELECTOR } from './_canvasHit.mjs'

// Docs checked 2026-11-09:
// https://docs.apimart.ai/en/api-reference/account/{user-balance,token-balance,usage}.md
// Balance-value units depend on provider configuration (USD/CNY/tokens); do not call them USD.
// Only usage explicitly guarantees credits=amount_usd*10, [start,end) Unix seconds.
// Usage posts at completion, normally ~1s, last minute may lag + 60s cache; poll >=60s.
// Balance docs promise no numeric latency SLA. Account deltas may include concurrent callers.
export async function modelSurfaceCostSteps({ page, projectId, proxy, locale, screenshotDir }) {
  const text = key => uiText(locale, key)
  const timeout = stationTimeout({ turns: 1 })
  const latest = route => proxy.reads.filter(r => r.path === route).at(-1)
  const readAccount = async (refresh = false) => {
    await openSettings(page, { tab: 'models' })
    const card = page.locator('[data-model-account="apimart"]')
    const prior = proxy.reads.length
    if (refresh) await card.getByRole('button', { name: text('onboardingProviders.account.refresh'), exact: true }).click()
    await expect.poll(() => {
      const account = latest('/v1/user/balance'), usage = latest('/v1/usage')
      return Boolean(account?.raw.success && usage?.raw.success && (!refresh || (proxy.reads.indexOf(account) >= prior && proxy.reads.indexOf(usage) >= prior)))
    }, { timeout: stationTimeout({ operations: 3 }) }).toBe(true)
    const raw = { account: latest('/v1/user/balance'), key: latest('/v1/balance'), usage: latest('/v1/usage') }
    const balance = card.getByText(text('onboardingProviders.account.balance'), { exact: true }).locator('..').locator('dd').first()
    const usage = card.getByText(text('onboardingProviders.account.sevenDays'), { exact: true }).locator('..').locator('dd').first()
    const fmt = n => Number(n).toLocaleString(locale, { maximumFractionDigits: 2 })
    assert(Number.isFinite(raw.account.raw.remain_credits) && Number.isFinite(raw.usage.raw.data?.total?.credits), 'Raw balance/usage must be available, not guessed zero')
    await expect(balance).toContainText(fmt(raw.account.raw.remain_credits))
    await expect(usage).toContainText(fmt(raw.usage.raw.data.total.credits))
    const ui = { balance: await balance.innerText(), sevenDays: await usage.innerText(), card: await card.innerText() }
    ui.matchesRaw = ui.balance.includes(fmt(raw.account.raw.remain_credits)) && ui.sevenDays.includes(fmt(raw.usage.raw.data.total.credits))
    await closeSettings(page)
    return { at: new Date().toISOString(), ui, raw }
  }
  const report = { locale, model: MODEL_COST, startedAt: new Date().toISOString(), checks: {}, snapshots: [] }
  try {
    console.info(`[model-cost] ${locale}: account-before`)
    report.before = await readAccount()
    console.info(`[model-cost] ${locale}: choose-model-and-spec`)
    await switchWorkspace(page, 'generation')
    await collapseAgentPanel(page)
    await addCanvasNode(page, 'image')
    const composer = page.locator('[data-composer-host="canvas"]:visible').first()
    await composer.locator('[data-node-composer-prompt] [contenteditable="true"]').fill('A single blue circle on white paper.')
    const modelPicker = composer.getByRole('button', { name: text('generationCommon.parameters.model'), exact: true })
    report.phase = 'model-search'
    report.modelBeforeSelection = await modelPicker.innerText()
    await expect(modelPicker).toBeVisible()
    await modelPicker.click()
    const menu = page.locator('[data-nomi-select-dropdown]:visible').first()
    await expect(menu).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    const search = menu.getByRole('textbox', { name: text('common.searchOptions'), exact: true })
    await expect(search).toBeVisible()
    await search.fill(MODEL_COST.label)
    const option = menu.getByRole('option').filter({ hasText: MODEL_COST.label }).first()
    await expect(option).toBeVisible()
    await option.click()
    await expect(modelPicker).toContainText(MODEL_COST.label, { timeout: stationTimeout({ operations: 3 }) })
    await expect.poll(async () => (await readProject(page, projectId)).payload.generationCanvas.nodes.find(n => n.kind === 'image')?.meta)
      .toMatchObject({ modelVendor: MODEL_COST.vendorKey, modelKey: MODEL_COST.modelKey })
    report.selectedModelLabel = await modelPicker.innerText()
    report.phase = 'specification'
    await composer.locator('[data-parameter-summary]').click()
    for (const [key, value] of [['size', MODEL_COST.size], ['resolution', MODEL_COST.resolution], ['quality', MODEL_COST.quality]]) {
      const control = page.locator(`[data-agent-parameter-control="${key}"]`).first()
      // Existing parameter controls render enum values as buttons (same path as the original model-surfaces rehearsal).
      await control.getByText(value, { exact: true }).click()
    }
    await page.keyboard.press('Escape')
    for (let step = 0; step < 8 && await canvasZoomPercent(page) > 50; step++) {
      const previous = await canvasZoomPercent(page)
      await canvasZoomStep(page, 'out', 'frame the estimate below a tall image node')
      await expect.poll(() => canvasZoomPercent(page)).toBeLessThan(previous)
    }
    await expect.poll(() => canvasZoomPercent(page)).toBeLessThanOrEqual(50)
    const canvasBounds = await page.locator(CANVAS_STAGE_SELECTOR).boundingBox()
    assert(canvasBounds, 'Canvas must be visible before framing the estimate')
    const composerFits = async () => {
      const bounds = await composer.boundingBox()
      return Boolean(bounds && bounds.x >= canvasBounds.x && bounds.y >= canvasBounds.y
        && bounds.x + bounds.width <= canvasBounds.x + canvasBounds.width
        && bounds.y + bounds.height <= canvasBounds.y + canvasBounds.height)
    }
    for (let step = 0; step < 6 && !await composerFits(); step++) {
      const previous = await canvasZoomPercent(page)
      await canvasZoomStep(page, 'out', 'keep the whole estimate composer in view')
      await expect.poll(() => canvasZoomPercent(page)).toBeLessThan(previous)
    }
    await expect.poll(composerFits).toBe(true)
    await expect(composer).toBeInViewport({ ratio: 1 })
    report.canvasZoomPercent = await canvasZoomPercent(page)
    console.info(`[model-cost] ${locale}: before-send-estimate`)
    const send = composer.locator('[data-bar-segment="generate"]')
    await expect(send).toHaveAttribute('data-price-source', /model=gpt-image-2.5-flare/, { timeout })
    await expect(send).toBeEnabled()
    const ariaDescription = await send.getAttribute('aria-description')
    const numbers = ariaDescription.match(/\d+(?:[.,]\d+)?/g)?.map(v => Number(v.replace(',', '.')))
    assert.equal(numbers?.length, 2, 'Record both displayed credits and displayed USD')
    const price = proxy.reads.filter(r => r.path === '/api/pricing/model' && r.raw.data?.model_name === MODEL_COST.modelKey).at(-1)
    const exactUsd = price?.raw.data?.size_quality_paid_prices?.[MODEL_COST.size]?.[MODEL_COST.quality]
    assert(Number.isFinite(exactUsd) && exactUsd > 0, 'Exact chosen public output estimate must be observable')
    report.estimate = { usd: exactUsd, credits: exactUsd * 10, displayedCredits: numbers[0], displayedUsd: numbers[1],
      buttonText: await send.innerText(), ariaDescription, tooltip: await send.locator('..').getAttribute('title'), source: await send.getAttribute('data-price-source') }
    fs.mkdirSync(screenshotDir, { recursive: true })
    report.screenshot = path.join(screenshotDir, `${locale}-before-send.png`)
    await screenshotSettled(page, { path: report.screenshot })
    report.submittedAt = new Date().toISOString()
    console.info(`[model-cost] ${locale}: submit-once`)
    await send.click() // The only generate click; polling below never resubmits.
    const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
    let confirmed = false
    await expect.poll(async () => {
      const node = (await nodes()).find(n => n.kind === 'image')
      const dialog = page.locator('[data-spend-confirm-dialog]')
      if (!confirmed && await dialog.isVisible()) { confirmed = true; await dialog.locator('[data-spend-confirm-action="confirm"]').click() }
      return node?.status === 'success' && Boolean(node?.result?.taskId)
    }, { timeout }).toBe(true)
    const node = (await nodes()).find(n => n.kind === 'image')
    assert.equal(proxy.records.length, 1)
    assert.equal(node.result.taskId, proxy.records[0].taskId)
    report.requestId = node.result.taskId
    report.landedAt = new Date().toISOString()
    console.info(`[model-cost] ${locale}: wait-for-account-posting`)
    // Honor usage's >=60s query spacing, including the initial account read. Condition, bounded by 4 minutes.
    let lastRead = Date.parse(report.before.raw.usage.at)
    await expect.poll(async () => {
      if (Date.now() - lastRead < 60_000) return false
      report.after = await readAccount(true)
      lastRead = Date.now()
      report.snapshots.push(report.after)
      return report.after.raw.usage.raw.data.total.requests > report.before.raw.usage.raw.data.total.requests
    }, { timeout: stationTimeout({ operations: 16 }), intervals: [1000] }).toBe(true)
    const before = report.before.raw, after = report.after.raw
    const actualCredits = before.account.raw.remain_credits - after.account.raw.remain_credits
    report.actual = { credits: after.usage.raw.data.total.credits - before.usage.raw.data.total.credits,
      usd: after.usage.raw.data.total.amount_usd - before.usage.raw.data.total.amount_usd,
      balanceCreditsDelta: actualCredits,
      balanceValueDelta: before.account.raw.remain_balance - after.account.raw.remain_balance,
      balanceValueUnit: 'system configuration dependent; not assumed USD',
      usageUsdDelta: after.usage.raw.data.total.amount_usd - before.usage.raw.data.total.amount_usd,
      usageCreditsDelta: after.usage.raw.data.total.credits - before.usage.raw.data.total.credits,
      usageRequestsDelta: after.usage.raw.data.total.requests - before.usage.raw.data.total.requests,
      attribution: 'Account interval deltas; concurrent calls/adjustments cannot be assigned to this task by the aggregate usage API.' }
    report.error = { publicOutputUsd: costError(report.estimate.usd, report.actual.usd),
      usageUsd: costError(report.estimate.usd, report.actual.usageUsdDelta),
      displayedUsd: costError(report.estimate.displayedUsd, report.actual.usd), displayedCredits: costError(report.estimate.displayedCredits, report.actual.credits) }
    report.uiUpdate = { balanceChanged: report.after.ui.balance !== report.before.ui.balance, sevenDaysChanged: report.after.ui.sevenDays !== report.before.ui.sevenDays, latestRawValuesMatchUi: report.after.ui.matchesRaw }
    report.checks = { onePost: proxy.records.length === 1, landed: node.status === 'success', rawAndUiRead: report.before.ui.matchesRaw && report.after.ui.matchesRaw }
    assert(Object.values(report.checks).every(Boolean))
    report.finishedAt = new Date().toISOString()
    return report
  } catch (error) { error.report = report; throw error }
}
