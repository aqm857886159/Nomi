import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { canvasFitView, collapseAgentPanel, switchGenerationView } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { chooseAssistantModel, sendCreation, readProject, openCanvas, CREATION_PANEL } from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const LOCK_EXIT_BUILD_MARKERS = ['nomi:tasks:canvas-unknown-runs', 'This shot changed, so it was not submitted']
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

/** Shared by rehearsal and paid entry. Only the supplier and text response differ. */
export async function generationLockExitJourney({ page, projectId, proxy, model, textLabel, locale = 'zh-CN', screenshotDir, restart, fixture }) {
  const text = key => uiText(locale, key)
  const report = { locale, heartbeat: [], screenshots: [], simulated: 'Only concurrency refusal and discarded response at a local proxy; supplier is fake in rehearsal and real in paid mode' }
  let pending = false
  const timer = setInterval(async () => {
    if (pending) return
    pending = true
    const started = Date.now()
    try { await page.evaluate(() => document.readyState); report.heartbeat.push(Date.now() - started) } catch { /* Restart closes the previous window. */ }
    finally { pending = false }
  }, 1000)
  const shot = async (name, locator = page) => {
    fs.mkdirSync(screenshotDir, { recursive: true })
    const file = path.join(screenshotDir, `${locale}-${name}.png`)
    await locator.screenshot({ path: file })
    report.screenshots.push(file)
  }
  const state = async () => { const record = await readProject(page, projectId); return record?.payload?.generationCanvas?.nodes ?? [] }
  const confirm = async () => { await page.locator(dialog).waitFor({ timeout }); await page.locator(`${dialog} [data-spend-confirm-action="confirm"]`).click() }
  const select = async id => {
    await page.evaluate(id => window.__nomiCanvasStore.getState().selectNode(id), id)
    await canvasFitView(page)
  }
  const submit = async () => { await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click() }
  try {
    const design = await prepareLockExitStoryboard({ page, projectId, model, textLabel, fixture })
    await openStoryboardEditor(page, design.id)
    await collapseAgentPanel(page)
    await shot('batch-confirm-before')
    await page.locator('[data-storyboard-batch]').click()
    await shot('batch-confirm', page.locator(dialog))
    await confirm()
    await expect.poll(async () => {
      const nodes = (await state()).filter(n => n.meta?.storyboardDesignId === design.id)
      if (nodes.some(n => /Storyboard target changed|storyboard_content_conflict|generation_input_changed/.test(n.error ?? ''))) throw new Error('A4: automatic reference invalidated the admitted storyboard')
      return nodes.filter(n => n.result || n.status === 'error').length
    }, { timeout }).toBe(5)
    await shot('assets-and-shots')
    const sentShots = proxy.records.filter(r => r.forwarded && /找到|窗边|放在/.test(r.prompt ?? ''))
    assert.equal(sentShots.length, 2, 'Two shot requests pass; the third is refused by the local concurrency cap')
    assert.ok(sentShots.every(r => /@\[asset:/.test(r.prompt)), 'A4: dispatched shots include visible asset mentions')
    assert.ok(sentShots.every(r => r.referenceCount > 0), 'A4: dispatched shots carry generated asset references')
    report.firstBatch = structuredClone(proxy.records)
    const failed = (await state()).find(n => n.meta?.storyboardDesignId === design.id && n.status === 'error')
    assert.ok(failed, 'The concurrency refusal is visible on its shot')
    await shot('quota-storyboard')
    await openCanvas(page); await collapseAgentPanel(page); await select(failed.id)
    await shot('quota-canvas')
    await switchGenerationView(page, 'list')
    await shot('quota-list-small')
    await page.locator(`[data-list-card="${failed.id}"]`).click()
    await expect(page.locator('[data-list-detail-preview] [role="alert"]')).toBeVisible()
    await shot('quota-list-detail')
    assert.ok(!(await page.locator('[data-list-detail]').innerText()).includes('Error invoking remote method'), 'E2: list shows the classified reason')
    await openStoryboardEditor(page, design.id)
    const rowId = failed.meta.shotId
    const rowIndex = design.plan.shots.find(s => s.shotId === rowId)?.index
    const row = page.locator(`[data-storyboard-editor] [data-storyboard-row="${rowIndex}"]`)
    await row.getByRole('button', { name: text('storyboardEditor.frame.retryHint'), exact: true }).first().click()
    // A user retry must have its ordinary approval opportunity.
    if (await page.locator(dialog).isVisible()) await confirm()
    await expect.poll(async () => (await state()).filter(n => n.meta?.storyboardDesignId === design.id && n.result).length, { timeout }).toBe(5)
    await shot('all-five-images')
    const record = await readProject(page, projectId)
    const latest = Object.values(record.payload.storyboardDesignsByDocumentId).flat().find(d => d.id === design.id)
    assert.ok(latest.plan.shots.every(s => /@\[asset:/.test(s.prompt)), 'Every shot uses the refreshed author plan')

    // The accepted-but-lost response is a separate intent; image spend remains bounded.
    await openCanvas(page)
    await collapseAgentPanel(page)
    const id = await page.evaluate(model => {
      const store = window.__nomiCanvasStore.getState()
      const node = store.addNode({ kind: 'image', title: '核对后重发', prompt: 'A small blue letter on a wooden desk', position: { x: 40, y: 40 }, exactPosition: true, size: { width: 480, height: 320 }, meta: { modelVendor: model.vendorKey, modelKey: model.modelKey } })
      store.selectNode(node.id)
      return node.id
    }, model)
    proxy.dropNextReply()
    await select(id); await submit()
    if (await page.locator(dialog).isVisible()) await confirm()
    await expect.poll(async () => (await state()).find(n => n.id === id)?.status, { timeout }).toBe('error')
    await shot('unknown-card', page.locator(`[data-node-id="${id}"]`))
    const original = (await state()).find(n => n.id === id).runs[0].id
    const before = proxy.records.length
    await submit()
    if (await page.locator(dialog).isVisible()) await confirm()
    await expect.poll(async () => (await state()).find(n => n.id === id)?.runs?.length, { timeout }).toBe(2)
    assert.equal(proxy.records.length, before, 'C1: refused click never reaches the proxy')
    await page.getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.alt'), exact: true }).click()
    await shot('release-confirm')
    await page.getByRole('button', { name: text('generationCommon.observability.releaseConfirm.continue'), exact: true }).click()
    await page.locator(dialog).waitFor({ timeout })
    await shot('spend-confirm', page.locator(dialog))
    await confirm()
    await expect.poll(async () => (await state()).find(n => n.id === id)?.status, { timeout }).toBe('success')
    const completed = (await state()).find(n => n.id === id)
    assert.ok(completed.runs.some(r => r.id === original), 'The original unknown record remains')
    assert.equal(completed.runs.length, 3, 'The refused record also remains')
    assert.equal(proxy.records.length, before + 1)
    await shot('released-result', page.locator(`[data-node-id="${id}"]`))
    if (restart) { page = await restart(); await expect.poll(async () => (await state()).find(n => n.id === id)?.status, { timeout }).toBe('success'); await shot('restarted-result') }
    report.maxUnresponsiveMs = Math.max(0, ...report.heartbeat)
    report.overTwoSeconds = report.heartbeat.filter(ms => ms > 2000)
    report.imagesForwarded = proxy.records.filter(r => r.forwarded).length
    assert.ok(report.imagesForwarded <= 14)
    return report
  } finally { clearInterval(timer); console.log('LOCK_EXIT_HEARTBEAT', JSON.stringify({ maxMs: Math.max(0, ...report.heartbeat), samples: report.heartbeat.length })) }
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
