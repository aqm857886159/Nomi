import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readProject } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { canvasFitView, closeRailDrawer, collapseAgentPanel, switchGenerationView, switchWorkspace } from './_shell.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

export async function expectCssColor(locator, property, value) {
  const colors = await locator.evaluate((element, { property, value }) => {
    const probe = document.createElement('div'); probe.style.setProperty(property, value); element.append(probe)
    const expected = getComputedStyle(probe).getPropertyValue(property), actual = getComputedStyle(element).getPropertyValue(property)
    probe.remove()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data) }
    return { actual: rgba(actual), expected: rgba(expected) }
  }, { property, value })
  assert.deepEqual(colors.actual, colors.expected, `${property}: ${value}`)
}

export function expectToken(locator, property, token) { return expectCssColor(locator, property, `var(--${token})`) }

/** Real discarded reply and accepted slow task; only the supplier is a fixture. */
export async function approvedUnknownResultCardJourney(input) {
  const { page, projectId, proxy, fixture, locale, screenshotDir } = input
  const t = key => uiText(locale, key), report = { checks: {}, screenshots: [], requestsBeforeDecision: [] }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { await waitForVisualQuiescence(page); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const setTheme = async dark => page.evaluate(dark => { document.documentElement.classList.toggle('dark', dark); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.dataset.nomiColorScheme = dark ? 'dark' : 'light'; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.documentElement.setAttribute('data-mantine-color-scheme', dark ? 'dark' : 'light') }, dark)
  let design
  const canvas = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page); await page.waitForFunction(() => Boolean(window.__nomiCanvasStore)); await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id); await canvasFitView(page); await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), id); return page.locator(`[data-node-id="${id}"]`).first() }
  const list = async id => { await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'list'); await collapseAgentPanel(page); if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click(); const node = (await nodes()).find(n => n.id === id); await page.locator(node.meta.anchorId ? `[data-list-anchor="${design.id}:${node.meta.anchorId}"], [data-list-unreferenced-asset="${id}"]` : `[data-list-card="${id}"]`).first().click(); return page.locator('[data-list-detail-preview]') }
  const storyboard = async id => { await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page); if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click(); const node = (await nodes()).find(n => n.id === id); const row = page.locator(`[data-storyboard-anchor-row="${node.meta.anchorId}"]`); await row.scrollIntoViewIfNeeded(); return row.locator('[data-anchor-face]') }
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const checkDialog = async state => {
    // board:UnknownResultCard/confirm.card — real shell, icon, width and exclusive decision.
    await expect(dialog).toHaveCount(1); await expect(dialog).toBeVisible(); assert.equal(Math.round((await dialog.boundingBox()).width), 380); await expect(dialog.locator('svg').first()).toBeVisible()
    // board:UnknownResultCard/confirm.title
    await expect(dialog).toContainText(t('generationCommon.spend.resend.title.image'))
    // board:UnknownResultCard/confirm.body.restart / board:UnknownResultCard/confirm.body.waiting
    const body = dialog.locator('p').filter({ hasText: t(`generationCommon.spend.resend.${state}`) }).first()
    assert.equal(await body.textContent(), t(`generationCommon.spend.resend.${state}`)); assert.equal(await body.evaluate(e => getComputedStyle(e).whiteSpace), 'pre-line')
    await page.mouse.move(0, 0)
    // board:UnknownResultCard/confirm.resend — default semantic ink, never danger.
    await expectToken(dialog.locator('[data-spend-confirm-action="confirm"]'), 'background-color', 'nomi-ink')
    await expect(dialog.locator('[data-spend-confirm-action="confirm"]')).toHaveText(t('generationCommon.observability.action.releaseRegenerate.main'))
  }
  try {
    design = await prepareLockExitStoryboard(input); await openStoryboardEditor(page, design.id); await page.locator('[data-place-storyboard]').click(); await expect.poll(async () => (await nodes()).length).toBe(5)
    const assets = (await nodes()).filter(n => n.meta?.anchorId), unknown = assets[0], waiting = assets[1]
    await canvas(unknown.id); proxy.dropNextReply(); await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').click()
    await expect.poll(async () => (await nodes()).find(n => n.id === unknown.id)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('error')
    for (const [name, open] of [['Storyboard', storyboard], ['Canvas', canvas], ['List', list]]) {
      const surface = await open(unknown.id), card = name === 'Storyboard' ? surface : surface.locator('[role="status"]')
      // board:UnknownResultCard/restart.card / board:UnknownResultCard/restart.storyboard-cell
      await expectToken(card, 'background-color', 'nomi-paper'); await expectToken(card, 'border-top-color', 'nomi-line')
      await expectToken(card.locator('svg').first(), 'color', 'nomi-warning-ink')
      // board:UnknownResultCard/restart.title
      await expect(card).toContainText(t('generationCommon.observability.error.submissionUnknown.reason'))
      // board:UnknownResultCard/restart.resend / board:UnknownResultCard/restart.view-task
      const resend = card.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.main'), exact: true }); await expectToken(resend, 'background-color', 'nomi-ink'); await expect(resend.locator('svg')).toBeVisible(); await expect(card.getByRole('button', { name: t('generationCommon.observability.action.reconcile.main'), exact: true })).toBeVisible()
      if (name !== 'Storyboard') {
        // board:UnknownResultCard/restart.footer / board:UnknownResultCard/restart.dismiss
        for (const key of ['generationCommon.error.copyDetails', 'generationCommon.error.feedback', 'generationCommon.error.technicalDetails']) await expect(card.getByRole('button', { name: t(key), exact: true })).toBeVisible()
        const dismiss = card.getByRole('button', { name: t('generationCommon.error.dismiss'), exact: true }); await expect(dismiss).toBeVisible()
        const cardBox = await card.boundingBox(), dismissBox = await dismiss.boundingBox(); assert.ok(cardBox.x + cardBox.width - dismissBox.x - dismissBox.width <= 20, 'dismiss stays at the existing top-right edge')
      }
      // board:UnknownResultCard/pill.no-duplicate
      if (name === 'Canvas') assert.equal((await surface.locator('[data-node-inline-status]').innerText()).trim(), '')
      if (locale === 'zh-CN') await shot(`Restart${name}`)
      const before = JSON.stringify((await nodes()).find(n => n.id === unknown.id)), posts = proxy.records.length
      await resend.click(); await checkDialog('unknown'); if (locale === 'zh-CN') await shot(`Confirm${name}`)
      if (locale === 'en' && name === 'List') await shot('EnLightList')
      // board:UnknownResultCard/confirm.cancel — every dismissal is no dispatch and no mutation.
      for (const action of ['cancel', 'close', 'escape', 'backdrop']) {
        if (action === 'escape') await page.keyboard.press('Escape')
        else if (action === 'backdrop') await page.mouse.click(2, 2)
        else await dialog.locator(`[data-spend-confirm-action="${action}"]`).click()
        await expect(dialog).not.toBeVisible(); assert.equal(proxy.records.length, posts); assert.equal(JSON.stringify((await nodes()).find(n => n.id === unknown.id)), before)
        if (action !== 'backdrop') { await resend.click(); await checkDialog('unknown') }
      }
      report.checks[name] = true
    }
    await setTheme(true)
    if (locale === 'en') { await canvas(unknown.id); await shot('EnDarkCanvas'); const face = await storyboard(unknown.id); await face.getByRole('button', { name: t('generationCommon.observability.action.releaseRegenerate.main'), exact: true }).click(); await checkDialog('unknown'); await shot('EnDarkConfirm'); await dialog.locator('[data-spend-confirm-action="cancel"]').click() }
    else { await storyboard(unknown.id); await shot('ZhDarkStoryboard') }
    await setTheme(false)
    fixture.holdTasks(true); await canvas(waiting.id); await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').click()
    await expect.poll(async () => (await nodes()).find(n => n.id === waiting.id)?.status, { timeout: stationTimeout({ turns: 1 }) }).toBe('recoverable')
    const face = await storyboard(waiting.id)
    // board:UnknownResultCard/waiting.storyboard-cell / board:UnknownResultCard/waiting.resend
    const labels = await face.getByRole('button').allTextContents(); assert.deepEqual(labels, [t('generationCommon.production.runAction.retry-retrieval'), t('generationCommon.observability.action.releaseRegenerate.main'), t('generationCommon.observability.action.reconcile.main')]); await expectToken(face.getByRole('button').first(), 'background-color', 'nomi-ink'); await expectToken(face.getByRole('button').nth(1), 'border-top-color', 'nomi-line')
    assert.ok(await face.evaluate(e => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1), '135x240 cell must contain all actions')
    if (locale === 'zh-CN') await shot('WaitingStoryboard')
    const surface = await canvas(waiting.id)
    // board:UnknownResultCard/waiting.card / board:UnknownResultCard/arrow.opens-card
    await expect(surface.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true })).toBeVisible(); await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').click(); await checkDialog('waiting'); if (locale === 'zh-CN') await shot('WaitingCanvasConfirm'); await dialog.locator('[data-spend-confirm-action="cancel"]').click()
    // board:UnknownResultCard/waiting.retrieve — genuine free query, no extra POST.
    const posts = proxy.records.length; fixture.holdTasks(false); await surface.getByRole('button', { name: t('generationCommon.production.runAction.retry-retrieval'), exact: true }).click(); await expect.poll(async () => (await nodes()).find(n => n.id === waiting.id)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success'); assert.equal(proxy.records.length, posts)
    await storyboard(unknown.id)
    // board:UnknownResultCard/notice.skipped
    await page.evaluate(ids => { void window.__nomiConfirmAndRunPlan({waves:[ids],edgesUsed:[],blocked:[]},{initiator:'user'}) }, [unknown.id, waiting.id])
    await expect(page.getByText(t('generationCommon.batchPlan.openRunsSkipped').replace('{{count}}', '1'), { exact: true })).toBeVisible(); if (locale === 'zh-CN') await shot('NoticeStoryboard')
    // board:UnknownResultCard/other-failures.red — real provider refusal remains a failure.
    await expect.poll(async () => (await nodes()).find(n => n.id === waiting.id)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success')
    const ordinary = (await nodes()).find(n => n.id === waiting.id); proxy.setLimit(0); await canvas(ordinary.id); await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').click(); if (await dialog.isVisible()) await dialog.locator('[data-spend-confirm-action="confirm"]').click(); await expect.poll(async () => (await nodes()).find(n => n.id === ordinary.id)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('error'); await expect(page.locator(`[data-node-id="${ordinary.id}"] [role="alert"]`)).toBeVisible()
    report.checks.completed = true; return report
  } catch (error) { error.report = report; throw error }
}
