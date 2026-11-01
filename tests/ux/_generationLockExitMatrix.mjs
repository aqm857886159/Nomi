import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { stationTimeout } from './_station-budget.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { canvasFitView, collapseAgentPanel, switchWorkspace, switchGenerationView } from './_shell.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** Hold genuine accepted fake tasks, then drive the real runner and free-query actions. */
export async function matrixLockExitJourney(input) {
  const { page, projectId, proxy, fixture, locale, screenshotDir } = input
  const t = key => uiText(locale, key)
  const report = { checks: {}, screenshots: [], setup: 'E5 calls the real single-node runner after the renderer reaches recoverable while the accepted fake task is still held by the host observer; no fabricated node errors or Run records.' }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const canvas = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page); await page.waitForFunction(() => Boolean(window.__nomiCanvasStore)); await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id); await canvasFitView(page); await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), id); await expect(page.locator(`[data-node-id="${id}"]`).first()).toBeVisible() }
  const list = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'list'); if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click(); const node = (await nodes()).find(n => n.id === id); await page.locator(node.meta.anchorId ? `[data-list-anchor="${design.id}:${node.meta.anchorId}"], [data-list-unreferenced-asset="${id}"]` : `[data-list-card="${id}"]`).first().click() }
  const storyboard = async node => {
    await openStoryboardEditor(page, design.id)
    if (node.meta.anchorId) {
      if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click()
      return page.locator(`[data-storyboard-anchor-row="${node.meta.anchorId}"]`)
    }
    return page.locator(`[data-storyboard-row="${design.plan.shots.find(s => s.shotId === node.meta.shotId).index}"]`)
  }
  let design
  try {
    design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id); await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).length).toBe(5)
    const bound = await nodes(), assets = bound.filter(n => n.meta.anchorId), shots = bound.filter(n => n.meta.shotId)
    const inFlight = [assets[0], shots[0]], retrievable = [assets[1], shots[1], shots[2]]
    fixture.holdTasks(true); proxy.setLimit(5)
    for (const node of bound) {
      await canvas(node.id)
      await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click()
      await expect(page.locator('[data-spend-confirm-dialog]')).not.toBeVisible()
      await expect.poll(async () => (await nodes()).find(n => n.id === node.id)?.runs?.[0]?.taskId).toBeTruthy()
    }
    assert.equal(proxy.records.length, 5)
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'recoverable').length, { timeout: stationTimeout({ turns: 1 }) }).toBe(5)
    for (const node of inFlight) {
      await page.evaluate(id => { void window.__nomiConfirmAndRunNode(id, { initiator: 'user' }) }, node.id)
      await expect.poll(async () => (await nodes()).find(n => n.id === node.id)?.status).toBe('error')
      assert.equal(proxy.records.length, 5)
      const row = await storyboard(node)
      await expect(row.getByRole('button', { name: t('generationCommon.observability.action.viewTask.main'), exact: true })).toBeVisible()
      await expect(row.getByRole('button', { name: t('storyboardEditor.frame.retryHint'), exact: true })).toHaveCount(0)
      await shot(`in-flight-storyboard-${node.meta.anchorId ? 'asset' : 'shot'}`)
      await canvas(node.id); await expect(page.getByRole('button', { name: t('generationCommon.observability.action.viewTask.main'), exact: true }).first()).toBeVisible(); await shot('in-flight-canvas')
      await list(node.id); await expect(page.locator('[data-list-detail-preview]').getByRole('button', { name: t('generationCommon.observability.action.viewTask.main'), exact: true })).toBeVisible(); await shot('in-flight-list')
    }
    report.checks.E5 = true
    await expect.poll(async () => (await nodes()).filter(n => retrievable.some(r => r.id === n.id) && n.status === 'recoverable').length, { timeout: stationTimeout({ turns: 1 }) }).toBe(3)
    for (const node of retrievable.slice(0, 2)) {
      const row = await storyboard(node); await expect(row.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true })).toBeVisible(); await shot(`retrieve-storyboard-${node.meta.anchorId ? 'asset' : 'shot'}`)
      await canvas(node.id); await expect(page.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true }).first()).toBeVisible(); await shot('retrieve-canvas')
      await list(node.id); await expect(page.locator('[data-list-detail-preview]').getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true })).toBeVisible(); await shot('retrieve-list')
    }
    fixture.holdTasks(false)
    for (const [index, node] of retrievable.entries()) {
      if (index === 0) { const row = await storyboard(node); await row.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true }).click() }
      else { if (index === 1) await canvas(node.id); else await list(node.id); await page.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true }).first().click() }
      await expect.poll(async () => (await nodes()).find(n => n.id === node.id)?.status, { timeout: stationTimeout({ operations: 3 }) }).toBe('success')
      assert.equal(proxy.records.length, 5)
      await shot(`retrieved-${index}`)
    }
    report.checks.E7 = true; report.postsBeforeAndAfterFreeQuery = [5, proxy.records.length]
    return report
  } catch (error) { error.report = report; throw error }
}
