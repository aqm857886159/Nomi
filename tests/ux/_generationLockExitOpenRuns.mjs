import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { canvasFitView, collapseAgentPanel, closeRailDrawer, switchWorkspace, switchGenerationView } from './_shell.mjs'
import { waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { confirmLockExitSpend } from './_generationLockExitHosting.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** The reviewer's real slow-provider route, with the approved cancel/retrieve/send-again expectations. */
export async function lateResultOpenRunsJourney(input, resend = false) {
  const { page, projectId, fixture, proxy, locale, screenshotDir } = input
  const text = key => uiText(locale, key)
  const report = { checks: {}, screenshots: [], slowWaitStartedAt: Date.now(), pages: [], feedback: [] }
  const confirmClick = async (button, surface) => {
    await button.evaluate(element => element.addEventListener('pointerdown', () => {
      const began = performance.now()
      window.__lockExitFeedbackMs = null
      const observer = new MutationObserver(() => {
        if (![...document.querySelectorAll('[data-spend-confirm-dialog]')].some(bar => bar.getClientRects().length && getComputedStyle(bar).visibility !== 'hidden')) return
        observer.disconnect()
        requestAnimationFrame(() => { window.__lockExitFeedbackMs = performance.now() - began })
      })
      observer.observe(document.body, { subtree: true, childList: true, attributes: true })
      setTimeout(() => observer.disconnect(), 2000)
    }, { once: true }))
    await button.click()
    await page.waitForFunction(() => typeof window.__lockExitFeedbackMs === 'number')
    const ms = await page.evaluate(() => window.__lockExitFeedbackMs)
    report.feedback.push({ surface, ms })
    assert.ok(ms <= 100, `${surface}: arrow to visible feedback ${ms}ms exceeds 100ms`)
  }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => {
    await waitForVisualQuiescence(page)
    fs.mkdirSync(screenshotDir, { recursive: true })
    const file = path.join(screenshotDir, `${locale}-${resend ? 'i5b' : 'i5'}-${name}.png`)
    await page.screenshot({ path: file });report.screenshots.push(file)
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id);await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).length).toBe(5)
    const asset = (await nodes()).find(node => node.meta?.anchorId)
    const current = async () => (await nodes()).find(node => node.id === asset.id)
    const canvas = async () => {
      await switchWorkspace(page, 'generation');await switchGenerationView(page, 'canvas');await collapseAgentPanel(page)
      await page.waitForFunction(() => Boolean(window.__nomiCanvasStore))
      await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), asset.id);await canvasFitView(page)
      await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), asset.id)
      return page.locator(`[data-node-id="${asset.id}"]`).first()
    }
    const arrow = host => host.locator('[data-bar-segment="generate"]').first()
    fixture.holdTasks(true);proxy.setLimit(5)
    let host = await canvas();await arrow(host).click()
    await expect.poll(async () => (await current())?.runs?.[0]?.taskId).toBeTruthy()
    const originalTask = (await current()).runs[0].taskId
    report.slowWaitStartedAt = Date.now()
    await expect.poll(async () => (await current())?.status, { timeout: stationTimeout({ turns: 1 }) }).toBe('recoverable')
    report.slowWaitMs = Date.now() - report.slowWaitStartedAt
    const runs = JSON.stringify((await current()).runs)
    assert.equal(proxy.records.length, 1)
    for (const surface of ['canvas', 'list', 'storyboard']) {
      if (surface === 'canvas') { host = await canvas();await confirmClick(arrow(host), surface) }
      else if (surface === 'list') {
        await switchWorkspace(page, 'generation');await switchGenerationView(page, 'list')
        if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click()
        await page.locator(`[data-list-anchor="${design.id}:${asset.meta.anchorId}"], [data-list-unreferenced-asset="${asset.id}"]`).first().click()
        host = page.locator('[data-list-detail-preview]');await confirmClick(page.locator('[data-composer-host="inline"] [data-bar-segment="generate"]').first(), surface)
      } else {
        await openStoryboardEditor(page, design.id);await closeRailDrawer(page, 'docs');await collapseAgentPanel(page)
        if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click()
        host = page.locator(`[data-storyboard-anchor-row="${asset.meta.anchorId}"]`);await host.scrollIntoViewIfNeeded()
        await confirmClick(host.getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.main'), exact: true }), surface)
      }
      await expect(page.locator('[data-spend-confirm-dialog]:visible').first()).toBeVisible()
      assert.equal(JSON.stringify((await current()).runs), runs, 'F12: confirmation does not replace the original Run')
      assert.equal(proxy.records.length, 1)
      await shot(`${surface}-confirm`)
      await page.locator('[data-spend-confirm-dialog]:visible').getByRole('button', { name: text('common.cancel'), exact: true }).click()
      await expect(host.getByRole('button', { name: text('generationCommon.production.runAction.retry-retrieval'), exact: true }).first()).toBeVisible()
      await shot(`${surface}-after-cancel`)
      report.pages.push(surface)
    }
    host = await canvas()
    if (resend) {
      await arrow(host).click()
      await confirmLockExitSpend(page, report, { shot, context: 'late-resend' })
      await expect.poll(() => proxy.records.length).toBe(2)
      await expect.poll(async () => (await current())?.runs?.[0]?.taskId).toBeTruthy()
      await expect.poll(async () => (await current())?.runs?.[0]?.taskId).not.toBe(originalTask)
      report.oldStillPendingWhenResent = true
      fixture.holdTasks(false)
      await expect.poll(async () => (await current())?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success')
      assert.notEqual((await current()).result.taskId, originalTask)
      assert.equal(proxy.records.length, 2)
    } else {
      fixture.holdTasks(false)
      await host.getByRole('button', { name: text('generationCommon.production.runAction.retry-retrieval'), exact: true }).first().click()
      await expect.poll(async () => (await current())?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success')
      assert.equal(proxy.records.length, 1)
    }
    report.checks = { allThreePages: report.pages.length === 3, cancelPreservesRuns: true, noPreconfirmationPost: true, freeRetrieval: !resend, confirmedResend: resend }
    report.finalNode = await current();report.posts = proxy.records.length
    await shot(resend ? 'new-result' : 'free-result')
    return report
  } catch (error) { error.report = report;throw error } finally { fixture.holdTasks(false) }
}
