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

// 产物里一定有、修复之前没有的字面量（运行结局的种类名）：付费入口拿它证明被验的修复真在产物里。
export const SHOT_RESULT_OWNERSHIP_BUILD_MARKERS = ['attempt-refused', 'attempt-started', 'canvas.run-settled']

/**
 * 同一镜两个入口先后各下一单，旧的那单晚到（docs/plan/2026-11-07-shot-result-ownership.md「真实场景复现」）。
 * 画布生成框点生成 → 服务商把这一单压住、等到「可找回」→ 到分镜表同一镜点「放手重新生成」并确认（第二单）→ 放开服务商，两单都出图。
 * 付了钱的两张图都要落在这一镜上：新的那张是当前图，旧的那张进版本历史；只下两单；镜头成功、不再转。
 * holdTasks(on)：免费演练用夹具压住任务；付费入口传自己的「压住轮询」开关。
 */
export async function shotResultOwnershipJourney(input) {
  const { page, projectId, fixture, proxy, locale, screenshotDir, holdTasks = (on) => fixture.holdTasks(on) } = input
  const text = (key) => uiText(locale, key)
  const report = { checks: {}, screenshots: [], facts: {} }
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async (name) => {
    await waitForVisualQuiescence(page).catch(() => undefined)
    fs.mkdirSync(screenshotDir, { recursive: true })
    const file = path.join(screenshotDir, `${locale}-ownership-${name}.png`)
    await page.screenshot({ path: file })
    report.screenshots.push(file)
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id)
    await page.locator('[data-place-storyboard]').click()
    await expect.poll(async () => (await nodes()).length).toBe(5)
    const asset = (await nodes()).find((node) => node.meta?.anchorId)
    assert.ok(asset, 'the storyboard places one asset node')
    const current = async () => (await nodes()).find((node) => node.id === asset.id)
    const canvas = async () => {
      await switchWorkspace(page, 'generation'); await switchGenerationView(page, 'canvas'); await collapseAgentPanel(page)
      await page.waitForFunction(() => Boolean(window.__nomiCanvasStore))
      await page.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), asset.id); await canvasFitView(page)
      await page.evaluate((id) => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), asset.id)
      return page.locator(`[data-node-id="${asset.id}"]`).first()
    }
    const storyboardRow = async () => {
      await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
      if (await page.locator('[data-storyboard-anchors]').getAttribute('data-storyboard-anchors-expanded') !== 'true') await page.locator('[data-storyboard-anchors-toggle]').click()
      const row = page.locator(`[data-storyboard-anchor-row="${asset.meta.anchorId}"]`)
      await row.scrollIntoViewIfNeeded()
      return row
    }

    // 第一单：画布生成框。服务商压住，渲染层等到超时把它交给主进程观察者（镜头「可找回」）。
    holdTasks(true); proxy.setLimit(5)
    const host = await canvas()
    await host.locator('[data-bar-segment="generate"]').first().click()
    await expect.poll(async () => (await current())?.runs?.[0]?.taskId).toBeTruthy()
    const firstTask = (await current()).runs[0].taskId
    await expect.poll(async () => (await current())?.status, { timeout: stationTimeout({ turns: 1 }) }).toBe('recoverable')
    assert.equal(proxy.records.length, 1)
    await shot('first-recoverable')

    // 第二单：分镜表同一镜「放手重新生成」，确认卡上确认。旧的那单还压着。
    const row = await storyboardRow()
    await row.getByRole('button', { name: text('generationCommon.observability.action.releaseRegenerate.main'), exact: true }).click()
    await expect(page.locator('[data-spend-confirm-dialog]:visible').first()).toBeVisible()
    await shot('storyboard-resend-confirm')
    await confirmLockExitSpend(page, report, { shot, context: 'ownership-resend' })
    await expect.poll(() => proxy.records.length).toBe(2)
    await expect.poll(async () => (await current())?.runs?.find((run) => run.taskId && run.taskId !== firstTask)?.taskId).toBeTruthy()
    const secondTask = (await current()).runs.find((run) => run.taskId && run.taskId !== firstTask).taskId
    await shot('storyboard-second-running')

    // 放开：两单都出图。等到两张图都在这一镜上（新的当前、旧的进历史），或等满时限后如实记下看到的。
    holdTasks(false)
    const landed = (node) => [node?.result, ...(node?.history ?? [])].filter(Boolean).map((entry) => entry.taskId)
    // 旧的那单由主进程观察者收完再落画布，回来的时间不由画布定：缺省等 5 个操作，NOMI_OWNERSHIP_LATE_WAIT_MS 可拉长；
    // 等的过程中每次读到的「当前图 / 历史 / 记录状态」都记下来（收据里看它什么时候、落在哪）。
    const lateWaitMs = Number(process.env.NOMI_OWNERSHIP_LATE_WAIT_MS) || stationTimeout({ operations: 5 })
    const releasedAt = Date.now()
    report.timeline = []
    let bothLanded = true
    await expect.poll(async () => {
      const node = await current()
      const seen = { ms: Date.now() - releasedAt, status: node?.status, current: node?.result?.taskId, landed: landed(node), runs: (node?.runs ?? []).map((run) => `${run.taskId}:${run.status}`) }
      if (JSON.stringify({ ...report.timeline.at(-1), ms: 0 }) !== JSON.stringify({ ...seen, ms: 0 })) report.timeline.push(seen)
      return node?.status === 'success' && node?.result?.taskId === secondTask && landed(node).includes(firstTask)
    }, { timeout: lateWaitMs, intervals: [1000] }).toBe(true).catch(() => { bothLanded = false })
    const finalNode = await current()
    report.facts = {
      firstTask, secondTask, posts: proxy.records.length, status: finalNode?.status, currentTask: finalNode?.result?.taskId,
      landedTasks: landed(finalNode), runs: (finalNode?.runs ?? []).map((run) => ({ status: run.status, taskId: run.taskId, resultId: run.resultId })),
    }
    await storyboardRow(); await shot('storyboard-final')
    await canvas(); await shot('canvas-final')
    report.checks = {
      bothPaidResultsOnShot: bothLanded,
      newResultIsCurrent: finalNode?.result?.taskId === secondTask,
      oldResultInHistory: landed(finalNode).includes(firstTask),
      twoOrdersOnly: proxy.records.length === 2,
      notBusy: finalNode?.status === 'success',
    }
    assert.ok(Object.values(report.checks).every(Boolean), `shot result ownership: ${JSON.stringify(report.facts)}`)
    return report
  } catch (error) { error.report = report; throw error } finally { holdTasks(false) }
}
