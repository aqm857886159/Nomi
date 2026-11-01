import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { readProject, openCanvas } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { switchGenerationView, collapseAgentPanel } from './_shell.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expectAbsent, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

/** Real clicks on all three single-card surfaces; the shared submitter alone owns deduplication. */
export async function singleActionsLockExitJourney(input) {
  const { page, projectId, fixture, proxy, locale, screenshotDir } = input
  const t = key => uiText(locale, key), report = { checks: {}, screenshots: [] }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const shot = async name => { await waitForVisualQuiescence(page); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-single-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const confirm = async () => { await expect(dialog).toBeVisible(); await dialog.locator('[data-spend-confirm-action="confirm"]').click() }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); await switchGenerationView(page, 'canvas'); await page.waitForFunction(() => typeof window.__nomiSetBatchConcurrency === 'function')
    await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await collapseAgentPanel(page)
    await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).length).toBe(5)
    await openStoryboardEditor(page, design.id)
    await page.locator('[data-storyboard-batch]').click(); await confirm()
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'success').length, { timeout: stationTimeout({ operations: 5 }) }).toBe(5)
    const shots = design.plan.shots.map(s => ({ row: s.index, node: null, shotId: s.shotId }))
    for (const s of shots) s.node = (await nodes()).find(n => n.meta?.shotId === s.shotId)
    const navigate = async (surface, target) => {
      if (surface === 'storyboard') { await openStoryboardEditor(page, design.id); await collapseAgentPanel(page); return page.locator(`[data-storyboard-row="${target.row}"]`) }
      // shortcut: persisted list view makes openCanvas wait before switching; repair and revalidate after the three-attempt stop is lifted.
      await openCanvas(page); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page)
      if (surface === 'canvas') { await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), target.node.id); return page.locator(`[data-node-id="${target.node.id}"]`).first() }
      await switchGenerationView(page, 'list')
      if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click()
      await page.locator(`[data-list-card="${target.node.id}"]`).click()
      return page.locator('[data-list-detail-preview]')
    }
    await openCanvas(page); await switchGenerationView(page, 'canvas'); await page.evaluate(() => window.__nomiSetBatchConcurrency(null)); proxy.setLimit(1)
    await page.locator('[data-frame-generate-all]').first().click()
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    assert.equal(await dialog.locator('[data-v4-block="plan-rows"] input[type="checkbox"]:checked').count(), 5)
    const cancelledAt = proxy.records.length
    await shot('canvas-batch-cancel')
    await dialog.locator('[data-spend-confirm-action="cancel"]').click()
    await expect(dialog).not.toBeVisible(); assert.equal(proxy.records.length, cancelledAt)
    report.checks.batchCancel = true
    await page.locator('[data-frame-generate-all]').first().click()
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    await confirm()
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'error').length, { timeout: stationTimeout({ operations: 5 }) }).toBe(4)
    proxy.setLimit(5)
    const surfaces = ['storyboard', 'canvas', 'list']
    const errorProbes = {}
    for (const face of ['canvas', 'list']) {
      const failed = await navigate(face, shots[0])
      errorProbes[face] = await proveProbe(failed.locator('[role="alert"]'), `${face}: this shot has a real error card before retry`)
    }
    for (let i = 0; i < surfaces.length; i++) {
      const surface = surfaces[i], target = shots[i], scope = await navigate(surface, target), before = proxy.records.length
      const label = surface === 'storyboard' ? t('storyboardEditor.frame.retryHint') : t('generationCommon.observability.action.retry.main')
      await scope.getByRole('button', { name: label, exact: true }).dblclick()
      await expect(dialog).not.toBeVisible()
      await expect.poll(async () => (await nodes()).find(n => n.id === target.node.id)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success')
      assert.equal(proxy.records.length, before + 1, `E3/${surface}: a double-click retries exactly once`)
      await shot(`${surface}-retried`); report.checks[`E3/${surface}`] = true
      if (i === 0) {
        for (const face of surfaces) {
          const updated = await navigate(face, target)
          if (face === 'storyboard') { await page.locator('[data-storyboard-scroll]').evaluate(e => { e.scrollTop = 0 }); await expect(updated.locator('[data-storyboard-frame="done"]')).toBeVisible() }
          else { await expectAbsent(updated.locator('[role="alert"]'), { provenBy: errorProbes[face] }); await expect(updated.locator('img').first()).toBeVisible() }
          await shot(`E9-${face}-same-result`)
        }
        assert.equal(proxy.records.length, before + 1, 'Switching surfaces after retry never resubmits')
        report.checks.E9 = true
      }
    }
    await openCanvas(page); await switchGenerationView(page, 'canvas'); await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); fixture.holdTasks(true)
    await page.locator('[data-frame-generate-all]').first().click()
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    const queuedStart = proxy.records.length
    await confirm(); await expect.poll(() => proxy.records.length).toBe(queuedStart + 1)
    for (let i = 0; i < surfaces.length; i++) {
      const surface = surfaces[i], target = shots[i]
      assert.ok(await page.evaluate(id => window.__nomiQueueStore.getState().entries.some(e => e.nodeId === id && e.state === 'queued'), target.node.id), `${surface} target is still queued`)
      const scope = await navigate(surface, target), before = proxy.records.length
      await shot(`${surface}-queued`)
      if (surface === 'storyboard') await scope.getByRole('button', { name: t('storyboardEditor.frame.regenerate'), exact: true }).click()
      else await page.locator(surface === 'list' ? '[data-inspector-composer] [data-bar-segment="generate"]' : '[data-composer-host="canvas"]:visible [data-bar-segment="generate"]').click()
      await expect(dialog).not.toBeVisible()
      await expect.poll(() => proxy.records.length).toBe(before + 1)
      report.checks[`E4/${surface}`] = true
    }
    fixture.holdTasks(false)
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'success').length, { timeout: stationTimeout({ operations: 5 }) }).toBe(5)
    assert.equal(proxy.records.length, queuedStart + 5, 'Each queued or singled node reaches HTTP exactly once')
    assert.equal(proxy.records.filter(r => r.forwarded).length, 14)
    assert.ok(await page.evaluate(() => Object.values(window.__nomiQueueStore.getState().batches).every(b => b.finishedAt)), 'Every batch Promise settled')
    report.http = structuredClone(proxy.records)
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}
