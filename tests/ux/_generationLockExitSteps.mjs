import { waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { canvasFitView, collapseAgentPanel, switchGenerationView, switchWorkspace } from './_shell.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { chooseAssistantModel, sendCreation, readProject, openCanvas, CREATION_PANEL } from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const LOCK_EXIT_BUILD_MARKERS = ['nomi:tasks:canvas-unknown-runs']
export const LOCK_EXIT_SCRIPT = '清晨，林薇在旧书店找到一封信。她走到窗边，最后把信放在桌上。'
const dialog = '[data-spend-confirm-dialog]'
const timeout = stationTimeout({ turns: 1 })

export function lockExitDraft(candidate) {
  return [
    { title: '林薇', role: 'anchor', storyboard: { kind: 'character', carrier: 'visual' }, prompt: '林薇，短发，灰色外套', taskKind: 'text_to_image', candidate },
    { title: '旧书店', role: 'anchor', storyboard: { kind: 'scene', carrier: 'visual' }, prompt: '旧书店，木桌和窗户', taskKind: 'text_to_image', candidate },
    ...['林薇在旧书店找到一封信', '林薇走到旧书店窗边', '林薇把信放在旧书店的桌上'].map(prompt => ({ title: prompt, prompt, taskKind: 'text_to_image', candidate, storyboard: { anchorIds: ['anchor-1', 'anchor-2'] } })),
  ]
}

/** Shared real UI sequence; the supplier alone differs between rehearsal and paid mode. */
export async function generationLockExitJourney(input) {
  let { page } = input
  const { projectId, proxy, locale = 'zh-CN', screenshotDir, restart } = input
  const text = key => uiText(locale, key)
  const report = { locale, stages: [], heartbeat: [], screenshots: [], simulated: ['concurrency refusal', 'discarding an accepted reply'] }
  let pending = false, observedIdle = false
  const timer = setInterval(async () => {
    if (pending) return
    pending = true
    const began = Date.now()
    try { await page.evaluate(() => document.readyState); report.heartbeat.push(Date.now() - began) }
    catch { /* Restart closes the previous page. */ } finally { pending = false }
  }, 1000)
  const shot = async name => {
    await waitForVisualQuiescence(page)
    fs.mkdirSync(screenshotDir, { recursive: true })
    const file = path.join(screenshotDir, `${locale}-scene-${name}.png`)
    await page.screenshot({ path: file }); report.screenshots.push(file)
  }
  const state = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const confirm = async () => { await expect(page.locator(dialog)).toBeVisible(); await page.locator(`${dialog} [data-spend-confirm-action="confirm"]`).click() }
  const canvas = async id => {
    await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page)
    // Selection is preparation; every spending/recovery action below is a real UI click.
    await page.waitForFunction(() => Boolean(window.__nomiCanvasStore))
    if (id) await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id)
    await canvasFitView(page)
    if (id) {
      await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), id)
      await expect(page.locator(`[data-node-id="${id}"]`).first()).toBeVisible()
    }
  }
  const list = async id => {
    await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'list'); await collapseAgentPanel(page)
    if (await page.locator('[data-list-detail-back]').isVisible()) await page.locator('[data-list-detail-back]').click()
    if (id) await page.locator(`[data-list-card="${id}"]`).click()
  }
  const submit = async () => { await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click(); await expect(page.locator(dialog)).not.toBeVisible() }
  const settled = async ids => expect.poll(async () => (await state()).filter(n => ids.includes(n.id) && ['success', 'error', 'recoverable'].includes(n.status)).length, { timeout }).toBe(ids.length)
  const success = async id => expect.poll(async () => {
    if (await page.locator(dialog).isVisible()) {
      await expect(page.locator(`${dialog} [data-hosting-disclosure]`)).toBeVisible()
      await page.locator(`${dialog} [data-hosting-remember] input`).check()
      report.hostingDisclosure = (report.hostingDisclosure ?? 0) + 1
      await shot('first-hosting-disclosure'); await confirm()
    }
    return (await state()).find(n => n.id === id)?.status
  }, { timeout }).toBe('success')
  const release = async () => {
    await page.getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot(`release-${report.stages.length}`)
    await page.locator('[data-release-confirm]').getByRole('button', { name: text('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await expect(page.locator(dialog)).not.toBeVisible()
  }
  const idle = async () => {
    observedIdle = true
    const before = (await state()).map(n => ({ id: n.id, status: n.status, error: n.error, result: n.result, runs: n.runs }))
    const began = Date.now()
    // User-requested idle observation: pass the 300s Run-observer horizon, without UI actions.
    for (let second = 0; second < 301; second++) await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)))
    const after = (await state()).map(n => ({ id: n.id, status: n.status, error: n.error, result: n.result, runs: n.runs }))
    report.idle = { elapsedMs: Date.now() - began, longestRelevantTimerMs: 300000, stable: JSON.stringify(before) === JSON.stringify(after) }
    assert.deepEqual(after, before, 'Idle must not invent errors or a running state')
    await shot('idle-return')
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id); await collapseAgentPanel(page)
    proxy.setLimit(2)
    // Assets are forwarded normally; discard the first shot reply, including in the paid run.
    proxy.dropNextReplyMatching('@image')
    await page.locator('[data-storyboard-batch]').click(); await expect(page.locator(dialog)).toBeVisible(); await shot('storyboard-confirm'); await confirm()
    let batchNodes
    await expect.poll(async () => {
      batchNodes = (await state()).filter(n => n.meta?.storyboardDesignId === design.id)
      return batchNodes.length > 0 && batchNodes.every(n => n.result || n.status === 'error')
        && (batchNodes.length >= 5 || await page.locator('[data-place-storyboard]').isEnabled())
    }, { timeout }).toBe(true)
    assert.ok(!batchNodes.some(n => /Storyboard target changed|storyboard_content_conflict|generation_input_changed/.test(n.error ?? '')), 'A4: automatic references must not invalidate the admitted storyboard')
    assert.equal(batchNodes.length, 5, 'A4: batch ended before dispatching all three shots')
    const bound = (await state()).filter(n => n.meta?.storyboardDesignId === design.id)
    const shotNodes = bound.filter(n => n.meta?.shotId)
    assert.ok(shotNodes.every(n => /@\[asset:/.test(n.prompt)), 'The editor plan and canvas nodes retain visible asset mentions')
    const row = node => page.locator(`[data-storyboard-row="${design.plan.shots.find(s => s.shotId === node.meta.shotId).index}"]`)
    const quota = bound.find(n => n.status === 'error' && /429|concurrency/.test(n.error ?? ''))
    const unknown = bound.find(n => n.status === 'error' && n.id !== quota?.id)
    assert.ok(quota && unknown, 'First batch must contain both refusal and discarded reply')
    report.firstBatch = structuredClone(proxy.records)
    const sent = proxy.records.filter(r => r.forwarded && r.referenceCount > 0)
    assert.equal(sent.length, 2); assert.ok(sent.every(r => /@image\d/.test(r.prompt) && r.referenceCount > 0), 'A4: @ and generated references reach HTTP')
    await shot('storyboard-errors')
    const firstRetry = proxy.records.length
    await page.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = element.scrollHeight })
    await row(quota).getByRole('button', { name: text('storyboardEditor.frame.retryHint'), exact: true }).first().click()
    await expect(page.locator(dialog)).not.toBeVisible(); await success(quota.id)
    assert.equal(proxy.records.length, firstRetry + 1)
    await page.locator('[data-storyboard-scroll]').evaluate(element => { element.scrollTop = 0 })
    await row(unknown).getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot('storyboard-release')
    await page.locator('[data-release-confirm]').getByRole('button', { name: text('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await expect(page.locator(dialog)).not.toBeVisible(); await success(unknown.id)
    await shot('storyboard-all-results'); report.stages.push('storyboard')
    await idle()
    for (const node of bound) assert.equal((await state()).find(n => n.id === node.id)?.status, 'success')
    await expect(page.locator('[data-place-storyboard]')).toBeEnabled()
    // All shots already have results: the remaining-only batch button is correctly disabled.
    await expect(page.locator('[data-storyboard-batch]')).toBeDisabled()

    await canvas()
    const blank = await findCanvasBlankPoint(page); assert.ok(blank)
    await page.mouse.click(blank.x, blank.y); await page.keyboard.press('Meta+a'); await page.keyboard.press('Meta+g')
    const groupBlank = await findCanvasBlankPoint(page); assert.ok(groupBlank); await page.mouse.click(groupBlank.x, groupBlank.y)
    await expect(page.locator('[data-frame-generate-all]').first()).toBeVisible()
    await page.locator('[data-frame-generate-all]').first().click(); await expect(page.locator(dialog)).toBeVisible()
    const checks = page.locator(`${dialog} [data-v4-block="plan-rows"] input[type="checkbox"]`)
    assert.equal(await checks.count(), 5, 'All five cards from the storyboard appear in the group confirmation')
    const members = (await readProject(page, projectId)).payload.generationCanvas.groups.find(g => bound.every(n => g.nodeIds.includes(n.id))).nodeIds
    const twoShots = shotNodes.slice(0, 2).map(n => n.id)
    await shot('canvas-cancel-confirm'); const beforeCancel = proxy.records.length
    await page.locator(`${dialog} [data-spend-confirm-action="cancel"]`).click(); assert.equal(proxy.records.length, beforeCancel)
    proxy.setLimit(1); proxy.dropNextReply()
    await page.locator('[data-frame-generate-all]').first().click()
    for (const [index, checkbox] of (await checks.all()).entries()) await checkbox.setChecked(twoShots.includes(members[index]))
    await confirm(); await expect.poll(async () => (await state()).filter(n => shotNodes.slice(0, 2).some(s => s.id === n.id) && n.status === 'error').length, { timeout }).toBe(2); await settled(shotNodes.slice(0, 2).map(n => n.id))
    let current = await state()
    const quota2 = shotNodes.find(n => /429|concurrency/.test(current.find(c => c.id === n.id)?.error ?? ''))
    const unknown2 = shotNodes.find(n => n.id !== quota2?.id && current.find(c => c.id === n.id)?.status === 'error')
    assert.ok(quota2 && unknown2)
    await canvas(quota2.id); await shot('canvas-quota')
    await page.getByRole('button', { name: text('generationCommon.observability.action.retry.main'), exact: true }).first().click(); await success(quota2.id)
    await canvas(unknown2.id); const beforeRefused = proxy.records.length
    const runsBefore = (await state()).find(n => n.id === unknown2.id).runs.length
    await submit(); await expect.poll(async () => (await state()).find(n => n.id === unknown2.id).runs.length).toBe(runsBefore + 1)
    assert.equal(proxy.records.length, beforeRefused); await shot('canvas-refused')
    const refusedId = (await state()).find(n => n.id === unknown2.id).runs[0].id
    await release(); await success(unknown2.id)
    assert.equal(proxy.records.length, beforeRefused + 1)
    assert.ok((await state()).find(n => n.id === unknown2.id).runs.some(r => r.id === refusedId), 'C2: refused history remains after releasing the original occupancy')
    await shot('canvas-released'); report.stages.push('canvas')

    await list(); await expect(page.locator('[data-list-card]')).toHaveCount(3)
    proxy.setLimit(1); proxy.dropNextReply()
    await page.locator('[data-section-generate]').first().click(); await expect(page.locator(dialog)).toBeVisible()
    for (const [index, checkbox] of (await checks.all()).entries()) await checkbox.setChecked(twoShots.includes(members[index]))
    await shot('list-confirm'); await confirm(); await expect.poll(async () => (await state()).filter(n => shotNodes.slice(0, 2).some(s => s.id === n.id) && n.status === 'error').length, { timeout }).toBe(2); await settled(shotNodes.slice(0, 2).map(n => n.id))
    current = await state()
    const quota3 = shotNodes.find(n => /429|concurrency/.test(current.find(c => c.id === n.id)?.error ?? ''))
    const unknown3 = shotNodes.find(n => n.id !== quota3?.id && current.find(c => c.id === n.id)?.status === 'error')
    assert.ok(quota3 && unknown3)
    await list(quota3.id); await shot('list-quota')
    assert.ok(!(await page.locator('[data-list-detail]').innerText()).includes('Error invoking remote method'))
    await page.locator('[data-list-detail-preview]').getByRole('button', { name: text('generationCommon.observability.action.retry.main'), exact: true }).click(); await success(quota3.id)
    await list(unknown3.id); await shot('list-unknown'); report.stages.push('list')
    assert.equal((await state()).find(n => n.id === unknown3.id).status, 'error')

    page = await restart()
    for (const surface of ['canvas', 'list', 'storyboard']) {
      if (surface === 'canvas') await canvas(unknown3.id)
      else if (surface === 'list') await list(unknown3.id)
      else await openStoryboardEditor(page, design.id)
      assert.equal((await state()).find(n => n.id === unknown3.id).status, 'error')
      await expect(page.getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).first()).toBeVisible()
      await shot(`restart-${surface}`)
    }
    await list(unknown3.id); const beforeRelease = proxy.records.length
    await release(); await success(unknown3.id); assert.equal(proxy.records.length, beforeRelease + 1)
    await shot('restart-released'); report.stages.push('restart')
    report.imagesForwarded = proxy.records.filter(r => r.forwarded).length
    assert.ok(report.imagesForwarded <= 14)
    report.maxUnresponsiveMs = Math.max(0, ...report.heartbeat)
    report.overTwoSeconds = report.heartbeat.filter(ms => ms > 2000)
    return report
  } catch (error) {
    console.error('LOCK_EXIT_STAGE_FAILURE', error.message)
    if (!observedIdle) await idle().catch(idleError => { report.idleError = idleError.message })
    error.report = report; throw error
  } finally { clearInterval(timer); console.log('LOCK_EXIT_HEARTBEAT', JSON.stringify({ maxMs: Math.max(0, ...report.heartbeat), samples: report.heartbeat.length })) }
}

/** Mounted-editor A4 slice: serial assets expose whole-plan comparison regressions. */
export async function a4LockExitJourney(input) {
  const { page, projectId, proxy, locale, screenshotDir } = input
  const screenshots = []
  const shot = async name => { await waitForVisualQuiescence(page); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-a4-${name}.png`); await page.screenshot({ path: file }); screenshots.push(file) }
  const design = await prepareLockExitStoryboard(input)
  await openCanvas(page)
  await page.waitForFunction(() => typeof window.__nomiSetBatchConcurrency === 'function')
  await openStoryboardEditor(page, design.id); await collapseAgentPanel(page)
  await page.evaluate(() => window.__nomiSetBatchConcurrency(1))
  proxy.setLimit(5)
  await page.locator('[data-storyboard-batch]').click(); await expect(page.locator(dialog)).toBeVisible()
  assert.equal(await page.locator(dialog).count(), 1)
  await shot('confirm')
  await page.locator(`${dialog} [data-spend-confirm-action="confirm"]`).click()
  let batchNodes, assetsSeen = false
  await expect.poll(async () => {
    batchNodes = (await readProject(page, projectId)).payload.generationCanvas.nodes
    if (!assetsSeen && batchNodes.filter(n => n.meta?.anchorId && n.result).length === 2) { assetsSeen = true; await shot('assets'); await page.locator('[data-storyboard-scroll]').evaluate(e => { e.scrollTop = e.scrollHeight }); await shot('shot-references') }
    return batchNodes.length > 0 && batchNodes.every(n => n.result || n.status === 'error')
      && (batchNodes.length >= 5 || await page.locator('[data-place-storyboard]').isEnabled())
  }, { timeout }).toBe(true)
  assert.equal(batchNodes.filter(n => n.result).length, 5, 'A4: mounted-editor batch ended before five images')
  assert.equal(proxy.records.length, 5)
  assert.ok(proxy.records.slice(2).every(r => /@image\d/.test(r.prompt) && r.referenceCount > 0), 'A4: shot HTTP requests contain mentions and generated references')
  await shot('all-results')
  return { checks: { mountedEditor: true, assetsBeforeShots: true, allFiveHttp: true }, screenshots, requests: structuredClone(proxy.records) }
}

export async function prepareLockExitStoryboard({ page, projectId, model, textLabel, fixture }) {
  await chooseAssistantModel(page, textLabel, CREATION_PANEL)
    if (fixture) {
      fixture.expectText({ label: 'story script to storyboard', match: body => JSON.stringify(body).includes('旧书店'), reply: { type: 'tool', id: 'lock-exit-draft', name: 'draft_shots', args: { shots: lockExitDraft({ providerId: model.vendorKey, modelId: model.modelKey }) } } })
      fixture.respond({ label: 'storyboard drafted', match: body => (body.messages ?? []).some(m => m.role === 'tool' && m.tool_call_id === 'lock-exit-draft'), reply: { type: 'text', text: '分镜方案已起草，请打开分镜表确认后生成。' } })
    }
    await sendCreation(page, `${LOCK_EXIT_SCRIPT} 请只起草分镜方案，不要生成。需要林薇和旧书店两张视觉资产卡，三个镜头都用图片模型 ${model.modelKey}，提示词明确写出资产名，每镜 storyboard.anchorIds 复用这两张参考卡的 id。`)
    let design
    await expect.poll(async () => {
      const record = await readProject(page, projectId)
      design = Object.values(record?.payload?.storyboardDesignsByDocumentId ?? {}).flat().at(-1)
      return design?.plan?.shots?.length
    }, { timeout }).toBe(3)
    assert.equal(design.plan.anchors.length, 2)
  return design
}
