import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { readProject } from './agent-runtime-walk-support.mjs'
import { switchWorkspace, switchGenerationView, collapseAgentPanel } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { waitForVisualQuiescence } from './_assert.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** The list header's own entry, plus readable small-card/queue receipts. No blocked retry-policy assertion. */
export async function listEntryLockExitJourney(input) {
  const { page, projectId, proxy, locale, screenshotDir } = input
  const t = key => uiText(locale, key)
  const report = { locale, checks: {}, screenshots: [], heartbeat: [] }
  const timer = setInterval(() => { const began = Date.now(); void page.evaluate(() => document.readyState).then(() => report.heartbeat.push(Date.now() - began)).catch(() => {}) }, 1000)
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const shot = async name => {
    await waitForVisualQuiescence(page)
    fs.mkdirSync(screenshotDir, { recursive: true })
    const file = path.join(screenshotDir, `${locale}-${name}.png`)
    await page.screenshot({ path: file }); report.screenshots.push(file)
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id)
    await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).filter(n => n.meta?.storyboardDesignId === design.id).length).toBe(5)
    await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'list'); await collapseAgentPanel(page)
    await expect(page.locator('[data-list-card]')).toHaveCount(3)
    await page.locator('[data-section-generate]').first().click()
    await expect(dialog).toBeVisible()
    assert.equal(await dialog.locator('input[type="checkbox"]:checked').count(), 3)
    await shot('list-entry-confirm')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    await expect.poll(() => proxy.records.length).toBe(3)
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'error').length).toBe(1)
    const failedNode = (await nodes()).find(n => n.status === 'error')
    await expect(page.locator(`[data-list-card="${failedNode.id}"] [data-list-media-failed]`)).toBeVisible()
    await expect(page.locator(`[data-list-card="${failedNode.id}"]`)).toContainText(t('generationCommon.observability.error.quota.reason'))
    await shot('list-small-classified-429')
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'success').length).toBe(2)
    assert.equal(new Set(proxy.records.map(r => r.prompt)).size, 3)
    report.checks.listHeaderOncePerNode = true
    report.checks.classifiedSmallCard = true

    await page.evaluate(() => window.__nomiSetBatchConcurrency(1))
    await page.locator('[data-section-generate]').first().click(); await expect(dialog).toBeVisible()
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    await shot('list-queue-confirm')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    const queued = page.locator('[data-list-card]:has([data-list-status="queued"])').first()
    await expect(queued).toBeVisible()
    const queuedId = await queued.getAttribute('data-list-card')
    await expect(queued).toContainText(t('generationCommon.observability.progress.queued'))
    await expect(queued).not.toContainText(t('generationList.notGenerated'))
    await expect(page.locator('[data-section-generate]').first()).toBeDisabled()
    await shot('list-small-queued-readable')
    await queued.click()
    await expect(page.locator(`[data-list-detail-row="${queuedId}"]`)).toContainText(t('generationCommon.observability.progress.queued'))
    await shot('list-rail-queued-readable')
    await expect.poll(async () => (await nodes()).filter(n => n.meta?.shotId && n.status === 'success').length, { timeout: stationTimeout({ operations: 5 }) }).toBe(3)
    assert.equal(proxy.records.length, 6)
    report.checks.actualQueue = true
    report.imagesForwarded = proxy.records.filter(r => r.forwarded).length
    report.maxUnresponsiveMs = Math.max(0, ...report.heartbeat)
    return report
  } catch (error) { error.report = report; throw error }
  finally { clearInterval(timer) }
}
