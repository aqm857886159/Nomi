import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { readProject, openCanvas } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { switchGenerationView, collapseAgentPanel, switchWorkspace, closeRailDrawer, canvasFitView, canvasSetZoomPercent, canvasZoomPercent } from './_shell.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
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
  const canvas = async () => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page); await page.waitForFunction(() => Boolean(window.__nomiCanvasStore)) }
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
      if (surface === 'storyboard') { await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page); const row = page.locator(`[data-storyboard-row="${target.row}"]`); await row.scrollIntoViewIfNeeded(); return row }
      await canvas()
      if (surface === 'canvas') { await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), target.node.id); return page.locator(`[data-node-id="${target.node.id}"]`).first() }
      await switchGenerationView(page, 'list')
      if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click()
      await page.locator(`[data-list-card="${target.node.id}"]`).click()
      return page.locator('[data-list-detail-preview]')
    }
    const surfaces = ['storyboard', 'canvas', 'list']
    if (!input.queuedOnly) {
    await canvas(); await page.evaluate(() => window.__nomiSetBatchConcurrency(null)); proxy.setLimit(1)
    const blank = await findCanvasBlankPoint(page); assert.ok(blank); await page.mouse.click(blank.x, blank.y)
    await canvasFitView(page)
    try {
      await canvasSetZoomPercent(page, 30)
      await expect.poll(() => canvasZoomPercent(page)).toBe(30)
      const rect = await page.locator('.generation-canvas-v2__stage').evaluate(stage => {
        const r = stage.getBoundingClientRect()
        const a = { x: r.left + 24, y: r.top + 24 }, b = { x: r.right - 100, y: r.bottom - 24 }
        return [a, b].every(p => document.elementFromPoint(p.x, p.y)?.matches('.react-flow__pane')) ? { a, b } : null
      })
      assert.ok(rect, 'The whole-canvas selection starts and ends on actual blank pane')
      await page.keyboard.down('Shift'); await page.mouse.move(rect.a.x, rect.a.y); await page.mouse.down(); await page.mouse.move(rect.b.x, rect.b.y, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Shift')
      await expect.poll(() => page.evaluate(() => window.__nomiCanvasStore.getState().selectedNodeIds.length)).toBe(5)
      report.checks.E1BoxSelection = true
      await shot('box-selected-five')
    } catch (error) {
      report.blocked = ['E1 selection: ' + error.message]
      await page.keyboard.up('Shift'); await page.mouse.up()
    }
    const afterSelectionBlank = await findCanvasBlankPoint(page); assert.ok(afterSelectionBlank); await page.mouse.click(afterSelectionBlank.x, afterSelectionBlank.y)
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
          if (face === 'storyboard') { await updated.scrollIntoViewIfNeeded(); await expect(updated.locator('[data-storyboard-frame="done"]')).toBeVisible() }
          else { await expectAbsent(updated.locator('[role="alert"]'), { provenBy: errorProbes[face] }); await expect(updated.locator('img').first()).toBeVisible() }
          await shot(`E9-${face}-same-result`)
        }
        assert.equal(proxy.records.length, before + 1, 'Switching surfaces after retry never resubmits')
        report.checks.E9 = true
      }
    }
    }
    await canvas(); const queueBlank = await findCanvasBlankPoint(page); assert.ok(queueBlank); await page.mouse.click(queueBlank.x, queueBlank.y); await canvasFitView(page); await waitForVisualQuiescence(page)
    await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); fixture.holdTasks(true)
    await page.locator('[data-frame-generate-all]').first().click()
    for (const checkbox of await dialog.locator('input[type="checkbox"]').all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    const queuedStart = proxy.records.length
    await confirm(); await expect.poll(() => proxy.records.length).toBe(queuedStart + 1)
    const beforeQueuedGroupClick = proxy.records.length
    await page.locator('[data-frame-generate-all]').first().click()
    await expect(dialog).not.toBeVisible()
    assert.equal(proxy.records.length, beforeQueuedGroupClick, 'All queued members are excluded from a second group submission')
    report.checks.queuedGroupExcluded = true
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
    assert.equal(new Set(proxy.records.slice(queuedStart).map(r => r.prompt)).size, 5, 'All five distinct nodes are submitted once in this wave')
    assert.equal(proxy.records.filter(r => r.forwarded).length, input.queuedOnly ? 10 : 14)
    assert.ok(await page.evaluate(() => Object.values(window.__nomiQueueStore.getState().batches).every(b => b.finishedAt)), 'Every batch Promise settled')
    report.http = structuredClone(proxy.records)
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}

/** A11 uses the real storyboard parameter panel while the accepted asset task is held. */
export async function spendChangeLockExitJourney(input) {
  const { page, projectId, fixture, proxy, locale, screenshotDir } = input
  const report = { checks: {}, screenshots: [] }, dialog = page.locator('[data-spend-confirm-dialog]')
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { await waitForVisualQuiescence(page); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-a11-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const confirm = async () => {
    if (await dialog.locator('[data-hosting-remember] input').isVisible()) await dialog.locator('[data-hosting-remember] input').check()
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
    fixture.holdTasks(true)
    await page.locator('[data-storyboard-batch]').click(); await expect(dialog).toBeVisible(); await confirm()
    await expect.poll(() => proxy.records.length).toBe(1)
    const row = page.locator(`[data-storyboard-row="${design.plan.shots[1].index}"]`)
    await row.scrollIntoViewIfNeeded(); await row.locator('[data-parameter-summary]').click()
    await page.locator('[data-agent-parameter-control="resolution"]').getByRole('radio', { name: '2K', exact: true }).click()
    await page.keyboard.press('Escape'); await expect(row.locator('[data-parameter-summary]')).toContainText('2K')
    await shot('changed-during-assets')
    fixture.holdTasks(false)
    await expect(dialog).toBeVisible({ timeout: stationTimeout({ operations: 5 }) })
    await expect(dialog.locator('[data-v4-block="plan-rows"] input[type="checkbox"]')).toHaveCount(3)
    await expect.poll(async () => (await nodes()).filter(n => n.meta?.shotId).length).toBe(3)
    const current = (await nodes()).filter(n => n.meta?.shotId)
    const second = current.find(n => n.meta.shotId === design.plan.shots[1].shotId)
    assert.equal(second.meta.resolution ?? second.meta.params?.resolution, '2K')
    report.currentConfirmation = await dialog.innerText()
    await shot('second-confirm-current')
    const beforeCancel = proxy.records.length
    assert.equal(beforeCancel, 2)
    await dialog.locator('[data-spend-confirm-action="cancel"]').click()
    await expect(page.locator('[data-place-storyboard]')).toBeEnabled()
    assert.equal(proxy.records.length, beforeCancel)
    assert.equal((await nodes()).filter(n => n.meta?.anchorId && n.status === 'success').length, 2)
    report.checks.secondConfirmationCancelKeepsAssets = true
    await page.locator('[data-storyboard-batch]').click(); await expect(dialog).toBeVisible(); await shot('retry-current-confirm'); await confirm()
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'success').length, { timeout: stationTimeout({ operations: 5 }) }).toBe(5)
    assert.equal(proxy.records.length, 5)
    const sent = proxy.records.find(r => r.prompt.includes('@image') && r.prompt.includes('窗边'))
    assert.equal(sent?.resolution, '2k')
    report.checks.confirmSendsCurrentResolution = true
    report.http = structuredClone(proxy.records)
    await row.scrollIntoViewIfNeeded(); await shot('current-result')
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}

export const queueActionsLockExitJourney = input => singleActionsLockExitJourney({ ...input, queuedOnly: true })
