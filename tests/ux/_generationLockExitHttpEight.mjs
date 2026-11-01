import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { stationTimeout } from './_station-budget.mjs'
import { chooseAssistantModel, sendCreation, readProject, openCanvas, CREATION_PANEL } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { collapseAgentPanel } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import fs from 'node:fs'
import path from 'node:path'

/** Eight real HTTP submissions, four concurrent refusals, plus a single-card double-click retry. */
export async function httpEightLockExitJourney({ page, projectId, proxy, fixture, model, textLabel, locale, screenshotDir }) {
  const t = key => uiText(locale, key)
  const report = { checks: {}, screenshots: [] }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const shot = async name => { fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  try {
    await chooseAssistantModel(page, textLabel, CREATION_PANEL)
    fixture.expectText({ label: 'eight image storyboard', match: body => JSON.stringify(body).includes('八张明信片'), reply: { type: 'tool', id: 'eight-shots', name: 'draft_shots', args: { shots: Array.from({ length: 8 }, (_, index) => ({ title: `明信片 ${index + 1}`, prompt: `明信片 ${index + 1}，窗边一本书`, taskKind: 'text_to_image', candidate: { providerId: model.vendorKey, modelId: model.modelKey } })) } } })
    fixture.respond({ label: 'eight shots ready', match: body => (body.messages ?? []).some(m => m.tool_call_id === 'eight-shots' && m.role === 'tool'), reply: { type: 'text', text: '八张方案已就绪。' } })
    await sendCreation(page, '请起草八张明信片的分镜方案，只起草，不生成。')
    let design
    await expect.poll(async () => { design = Object.values((await readProject(page, projectId)).payload.storyboardDesignsByDocumentId).flat().at(-1); return design?.plan.shots.length }).toBe(8)
    await openCanvas(page); await page.waitForFunction(() => typeof window.__nomiSetBatchConcurrency === 'function'); await openStoryboardEditor(page, design.id); await collapseAgentPanel(page)
    proxy.setLimit(4)
    await page.evaluate(() => window.__nomiSetBatchConcurrency(6))
    await page.locator('[data-storyboard-batch]').click(); await expect(dialog).toBeVisible(); await shot('eight-confirm')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    await expect.poll(() => proxy.records.length).toBe(8)
    assert.equal(proxy.records.filter(r => r.rejected).length, 4)
    report.eightHttpReceipts = structuredClone(proxy.records)
    const failed = (await nodes()).find(n => n.status === 'error')
    assert.ok(failed)
    assert.ok((await nodes()).some(n => n.status === 'running'), 'B1: the other four requests are still running')
    await expect(page.locator('[data-storyboard-batch]')).toBeDisabled()
    await expect(page.locator('[data-place-storyboard]')).toBeDisabled()
    await shot('eight-refusals-others-running')
    proxy.setLimit(5)
    const rowIndex = design.plan.shots.find(s => s.shotId === failed.meta.shotId).index
    await page.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = element.scrollHeight })
    await page.locator(`[data-storyboard-row="${rowIndex}"]`).getByRole('button', { name: t('storyboardEditor.frame.retryHint'), exact: true }).dblclick()
    await expect(dialog).not.toBeVisible()
    await expect.poll(() => proxy.records.length).toBe(9)
    await shot('eight-single-retry-running')
    await expect.poll(async () => (await nodes()).filter(n => n.status === 'running').length, { timeout: stationTimeout({ operations: 8 }) }).toBe(0)
    assert.equal(proxy.records.length, 9)
    assert.equal((await nodes()).filter(n => n.status === 'success').length, 5)
    await expect(page.locator('[data-storyboard-batch]')).toBeEnabled()
    assert.ok(!(await page.locator('body').innerText()).includes(t('taskCenter.brake.toast')))
    report.checks = { A1: true, B1: true, B4: true, B5: true }
    await shot('eight-settled-no-brake')
    return report
  } catch (error) { error.report = report; throw error }
}
