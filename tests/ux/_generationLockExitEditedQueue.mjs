import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { collapseAgentPanel, switchGenerationView } from './_shell.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

async function editQueuedShot(input, surface) {
  const { page, projectId, proxy, fixture, locale, screenshotDir } = input
  const t = key => uiText(locale, key), report = { surface, checks: {}, screenshots: [] }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-edit-${surface}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); await page.waitForFunction(() => typeof window.__nomiSetBatchConcurrency === 'function')
    await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await collapseAgentPanel(page)
    await page.locator('[data-storyboard-batch]').click(); await page.locator('[data-spend-confirm-dialog] [data-spend-confirm-action="confirm"]').click()
    await expect.poll(() => proxy.records.length, { timeout: stationTimeout({ operations: 5 }) }).toBe(3)
    fixture.holdTasks(true)
    const node = (await nodes()).find(n => n.meta?.shotId === design.plan.shots[2].shotId)
    assert.ok(node)
    if (surface === 'storyboard') {
      await page.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = element.scrollHeight })
      const editor = page.locator(`[data-storyboard-row="${design.plan.shots[2].index}"] [contenteditable="true"]`).first()
      await editor.fill('用户把第三镜改成另一张画面')
    } else {
      await openCanvas(page)
      if (surface === 'canvas') await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), node.id)
      else { await switchGenerationView(page, 'list'); await page.locator(`[data-list-card="${node.id}"]`).click() }
      await page.locator('[data-composer-host="canvas"]:visible [contenteditable="true"]').first().fill('用户把第三镜改成另一张画面')
    }
    await shot('changed-while-queued'); fixture.holdTasks(false)
    await expect.poll(async () => (await nodes()).find(n => n.id === node.id)?.status, { timeout: stationTimeout({ turns: 1 }) }).toBe('error')
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'success').length, { timeout: stationTimeout({ turns: 1 }) }).toBe(4)
    assert.equal(proxy.records.length, 4, 'Only the changed shot is withheld; all four peers reach HTTP')
    await openStoryboardEditor(page, design.id)
    await page.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(page.locator(`[data-storyboard-row="${design.plan.shots[2].index}"]`).getByRole('button', { name: t('storyboardEditor.frame.retryHint'), exact: true })).toBeVisible()
    await shot('storyboard-refusal')
    await openCanvas(page); await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), node.id)
    await expect(page.locator(`[data-node-id="${node.id}"] [role="alert"]`)).toBeVisible(); await shot('canvas-refusal')
    await switchGenerationView(page, 'list'); await page.locator(`[data-list-card="${node.id}"]`).click()
    await expect(page.locator('[data-list-detail-preview] [role="alert"]')).toBeVisible(); await shot('list-refusal')
    report.checks = { onlyEditedShotWithheld: true, otherFourSubmitted: true, allThreeSurfaces: true }
    report.http = structuredClone(proxy.records)
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}
export const editedStoryboardLockExitJourney = input => editQueuedShot(input, 'storyboard')
export const editedCanvasLockExitJourney = input => editQueuedShot(input, 'canvas')
export const editedListLockExitJourney = input => editQueuedShot(input, 'list')
