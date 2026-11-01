import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { readProject } from './agent-runtime-walk-support.mjs'
import { canvasFitView, collapseAgentPanel, switchGenerationView, switchWorkspace } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** Independent queue/refusal/recovery walk; it does not rerun the blocked batch rehearsal. */
export async function threePageLockExitJourney(input) {
  let { page } = input
  const { projectId, proxy, locale, screenshotDir, restart } = input
  const t = key => uiText(locale, key)
  const dialog = '[data-spend-confirm-dialog]'
  const report = { locale, checks: {}, screenshots: [] }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const canvas = async id => {
    await switchWorkspace(page, 'generation')
    await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page)
    if (id) await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id)
    await canvasFitView(page)
  }
  const list = async (id, detail = true) => {
    await switchGenerationView(page, 'list')
    if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click()
    if (detail) await page.locator(`[data-list-card="${id}"]`).click()
  }
  const confirm = async () => { await page.locator(dialog).waitFor(); await page.locator(`${dialog} [data-spend-confirm-action="confirm"]`).click() }
  const submit = async () => { await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click(); if (await page.locator(dialog).isVisible()) await confirm() }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id)
    await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).filter(n => n.meta?.storyboardDesignId === design.id).length).toBe(5)
    const bound = (await nodes()).filter(n => n.meta?.storyboardDesignId === design.id)
    await canvas()
    await page.evaluate(() => window.__nomiSetBatchConcurrency(1))
    await page.locator('[data-frame-generate-all]').first().click(); await shot('queue-confirm'); await confirm()
    const last = bound.at(-1)
    await canvas(last.id); await shot('queue-canvas')
    await list(last.id, false); await shot('queue-list-small')
    await page.locator(`[data-list-card="${last.id}"]`).click(); await shot('queue-list-rail')
    const railText = await page.locator(`[data-list-detail-row="${last.id}"]`).innerText()
    assert.ok(railText.includes(t('generationCommon.observability.progress.queued')), 'E4: the narrow rail reads the actual queue')
    await openStoryboardEditor(page, design.id); await shot('queue-storyboard')
    await expect.poll(async () => (await nodes()).filter(n => bound.some(b => b.id === n.id) && n.status === 'success').length, { timeout: 90000 }).toBe(5)
    report.checks.queue = true
    assert.equal(proxy.records.filter(r => r.forwarded).length, 5)

    await canvas(); await page.evaluate(() => window.__nomiSetBatchConcurrency(null))
    await page.locator('[data-frame-generate-all]').first().click()
    const checks = page.locator(`${dialog} input[type="checkbox"]`)
    for (const checkbox of await checks.all()) if (!(await checkbox.isDisabled())) await checkbox.check()
    await confirm()
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'error').length, { timeout: 90000 }).toBe(3)
    const failed = (await nodes()).find(n => n.status === 'error' && n.meta?.shotId)
    assert.ok(failed)
    await canvas(failed.id); await shot('429-canvas')
    await list(failed.id, false); await shot('429-list-small')
    await page.locator(`[data-list-card="${failed.id}"]`).click(); await shot('429-list-detail')
    assert.ok(!(await page.locator('[data-list-detail]').innerText()).includes('Error invoking remote method'))
    const modelChip = page.locator('[data-list-detail]').getByRole('button', { name: t('generationCommon.parameters.model'), exact: true }).first()
    await modelChip.evaluate(element => element.addEventListener('click', () => { element.dataset.lockExitModelClicked = 'true' }, { once: true }))
    await page.locator('[data-list-detail-preview]').getByRole('button', { name: t('generationCommon.observability.action.switchModel.alt'), exact: true }).click()
    await expect(modelChip).toHaveAttribute('data-lock-exit-model-clicked', 'true')
    await page.keyboard.press('Escape')
    report.checks.listModelChip = true
    await openStoryboardEditor(page, design.id); await shot('429-storyboard')
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'running').length).toBe(0)
    report.checks.quota = true

    await canvas(failed.id)
    proxy.dropNextReply(); await submit()
    await expect.poll(async () => (await nodes()).find(n => n.id === failed.id)?.status, { timeout: 90000 }).toBe('error')
    await expect(page.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true })).toBeVisible()
    const count = proxy.records.length
    await submit()
    await expect.poll(async () => (await nodes()).find(n => n.id === failed.id)?.runs?.length).toBeGreaterThanOrEqual(4)
    assert.equal(proxy.records.length, count)
    await shot('unknown-canvas-light')
    await list(failed.id); await shot('unknown-list-detail-light')
    await expect(page.locator('[data-list-detail-preview] [role="alert"]')).toBeVisible()
    await openStoryboardEditor(page, design.id); await shot('unknown-storyboard-shot')
    await expect(page.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true })).toBeVisible()
    report.checks.refusedClickAndSameExit = true

    const asset = bound.find(n => n.meta?.anchorId)
    await canvas(asset.id); proxy.dropNextReply(); await submit()
    await expect.poll(async () => (await nodes()).find(n => n.id === asset.id)?.status, { timeout: 90000 }).toBe('error')
    await openStoryboardEditor(page, design.id)
    const toggle = page.locator('[data-storyboard-anchors-toggle]')
    if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await toggle.click()
    const assetRow = page.locator(`[data-storyboard-anchor-row="${asset.meta.anchorId}"]`)
    await expect(assetRow.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true })).toBeVisible()
    await shot('unknown-storyboard-anchor')
    await assetRow.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot('unknown-storyboard-anchor-confirm')
    await page.locator('[data-release-confirm]').getByRole('button', { name: t('generationCommon.observability.releaseConfirm.cancel'), exact: true }).click()
    report.checks.anchorHasExit = true

    page = await restart()
    await canvas(failed.id); await shot('restart-unknown-canvas')
    await list(failed.id); await shot('restart-unknown-list')
    await openStoryboardEditor(page, design.id); await shot('restart-unknown-storyboard')
    report.checks.restart = true
    await canvas(failed.id); await list(failed.id)
    await page.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot('list-release-confirm')
    await page.getByRole('button', { name: t('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await expect.poll(async () => (await nodes()).find(n => n.id === failed.id)?.status, { timeout: 90000 }).toBe('success')
    assert.equal(proxy.records.length, count + 2)
    report.checks.releaseTargetsOriginalRun = true
    await shot('list-released-result')
    report.checks.spendConfirmation = await page.locator(dialog).isVisible()
    report.blocked = report.checks.spendConfirmation ? [] : ['spend-confirmation-policy']
    await openStoryboardEditor(page, design.id)
    if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click()
    await page.locator(`[data-storyboard-anchor-row="${asset.meta.anchorId}"]`).getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await page.locator('[data-release-confirm]').getByRole('button', { name: t('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await expect.poll(async () => (await nodes()).find(n => n.id === asset.id)?.status, { timeout: 90000 }).toBe('success')
    report.checks.anchorRelease = true
    await shot('storyboard-anchor-released-result')
    const canvasNode = bound.find(n => n.meta?.shotId && n.id !== failed.id)
    await canvas(canvasNode.id); proxy.dropNextReply(); await submit()
    await expect.poll(async () => (await nodes()).find(n => n.id === canvasNode.id)?.status, { timeout: 90000 }).toBe('error')
    await page.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot('canvas-release-confirm')
    await page.locator('[data-release-confirm]').getByRole('button', { name: t('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await expect.poll(async () => (await nodes()).find(n => n.id === canvasNode.id)?.status, { timeout: 90000 }).toBe('success')
    report.checks.canvasRelease = true
    await shot('canvas-released-result')
    return report
  } catch (error) { error.report = report; throw error }
}
