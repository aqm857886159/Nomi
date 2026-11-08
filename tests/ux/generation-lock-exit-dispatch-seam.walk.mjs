#!/usr/bin/env node
import { confirmLockExitSpend } from './_generationLockExitHosting.mjs'
// 验收线提供的回归走查：真窗 + 假服务商。第一张卡确认，资产在跑；最后一张资产出图的那一刻 + delay 毫秒，
// 点最后一镜行上的「生成」。批量那一发排在同批前面的镜后面（并发 1 或 ≥7 镜时的真实形状），这一镜发几次？
// 用法：node t4-seam.walk.mjs <delayMs> [concurrency]，从工作树目录运行。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DELAY = Number(process.argv[2] ?? 0)
const CONCURRENCY = Number(process.argv[3] ?? 1)
const { expect } = await import(`${ROOT}/node_modules/@playwright/test/index.mjs`)
const { runLockExitRehearsal } = await import(`${ROOT}/tests/ux/_generationLockExitRehearsal.mjs`)
const { prepareLockExitStoryboard } = await import(`${ROOT}/tests/ux/_generationLockExitSteps.mjs`)
const { readProject, openCanvas } = await import(`${ROOT}/tests/ux/agent-runtime-walk-support.mjs`)
const { openStoryboardEditor } = await import(`${ROOT}/tests/ux/_creationResourceTree.mjs`)
const { collapseAgentPanel, closeRailDrawer } = await import(`${ROOT}/tests/ux/_shell.mjs`)
const { waitForVisualQuiescence } = await import(`${ROOT}/tests/ux/_assert.mjs`)
const { stationTimeout } = await import(`${ROOT}/tests/ux/_station-budget.mjs`)

async function t4Seam(input) {
  const { page, projectId, fixture, proxy, locale, screenshotDir } = input
  const report = { delay: DELAY, concurrency: CONCURRENCY, screenshots: [] }
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { await waitForVisualQuiescence(page).catch(() => undefined); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-t4-d${DELAY}-c${CONCURRENCY}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); await page.evaluate(value => window.__nomiSetBatchConcurrency(value), CONCURRENCY); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
    const target = design.plan.shots.at(-1)
    report.targetPrompt = target.prompt
    fixture.holdTasks(true)
    await page.locator('[data-storyboard-batch]').click(); await expect(dialog).toBeVisible()
    await confirmLockExitSpend(page, report, { shot })
    await expect.poll(() => proxy.records.length).toBe(1)
    await page.evaluate(({ index, shotId, delay }) => {
      const log = window.__vLog = { delay, assetsDoneAt: null, rowClickedAt: null, firstShotNodeAt: null, firstEntryForShotAt: null, targetEntryAt: null, targetBusyAt: null, targetRunningAt: null, rowButtonState: null }
      const check = () => {
        const now = performance.now()
        const all = window.__nomiCanvasStore.getState().nodes
        const anchors = all.filter(n => n.meta?.anchorId), shots = all.filter(n => n.meta?.shotId && !n.meta?.storyboardKeyframe)
        const entries = window.__nomiQueueStore.getState().entries ?? []
        if (log.assetsDoneAt === null && anchors.length === 2 && anchors.every(n => n.status === 'success')) {
          log.assetsDoneAt = now
          const click = () => { const button = document.querySelector(`[data-storyboard-row="${index}"] [data-storyboard-generate-state]`); log.rowButtonState = button?.getAttribute('data-storyboard-generate-state') ?? 'missing'; log.rowClickedAt = performance.now(); button?.click() }
          setTimeout(click, delay)
        }
        if (log.firstShotNodeAt === null && shots.length > 0) log.firstShotNodeAt = now
        const shotIds = new Set(shots.map(n => n.id))
        if (log.firstEntryForShotAt === null && entries.some(e => shotIds.has(e.nodeId))) log.firstEntryForShotAt = now
        const n = shots.find(x => x.meta?.shotId === shotId)
        if (n) {
          const own = entries.filter(e => e.nodeId === n.id)
          log.targetEntries = own.map(e => e.state)
          if (log.targetEntryAt === null && own.length > 0) log.targetEntryAt = now
          if (log.targetBusyAt === null && (n.status === 'running' || n.status === 'queued' || own.some(e => e.state === 'queued'))) log.targetBusyAt = now
          if (log.targetRunningAt === null && n.status === 'running') log.targetRunningAt = now
        }
      }
      window.__nomiCanvasStore.subscribe(check); window.__nomiQueueStore.subscribe(check)
      setInterval(check, 3)
    }, { index: target.index, shotId: target.shotId, delay: DELAY })
    fixture.holdTasks(false)
    await expect.poll(async () => {
      const all = await nodes()
      return all.filter(n => n.status === 'success' || n.status === 'error').length === 5 && await page.locator('[data-place-storyboard]').isEnabled()
    }, { timeout: stationTimeout({ operations: 12 }) }).toBe(true)
    report.log = await page.evaluate(() => window.__vLog)
    const final = (await nodes()).find(n => n.meta?.shotId === target.shotId)
    report.finalTarget = { status: final.status, error: String(final.error ?? '').slice(0, 120), resultId: final.result?.id ?? null, runs: (final.runs ?? []).map(r => r.status), history: (final.history ?? final.results ?? []).length }
    report.postsPerPrompt = Object.fromEntries([...new Set(proxy.records.map(r => r.prompt.slice(0, 24)))].map(prompt => [prompt, proxy.records.filter(r => r.prompt.startsWith(prompt)).length]))
    // Asset mentions become @imageN in transport; compare the complete authored prompt after removing only those transport bindings.
    report.targetPosts = proxy.records.filter(r => r.prompt.replace(/@image\d+/g, '') === target.prompt).length
    report.postsTotal = proxy.records.length
    report.toasts = await page.locator('[data-sonner-toast], [role="status"]').allInnerTexts().catch(() => [])
    await shot('after-batch')
    expect(report.targetPosts).toBe(1)
    expect(report.finalTarget.status).toBe('success')
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}
Object.defineProperty(t4Seam, 'name', { value: `t4-d${DELAY}-c${CONCURRENCY}` })

try { await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN', t4Seam) }
catch (error) { process.exitCode = 1; console.error(`zh-CN/t4: ${error.message}`) }
