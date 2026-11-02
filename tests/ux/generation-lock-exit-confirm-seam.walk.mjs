#!/usr/bin/env node
// 验收线提供的回归走查：真窗 + 假服务商。点第 2 镜行上的「生成」，gap 毫秒后点底部整批。
// 单行 pending 不禁用整表钮，第一张卡盖在单发之上。单发在卡开着时跑完，确认后这一镜发几次？
// 用法：node t2-card-open.walk.mjs <gapMs>，从工作树目录运行。
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const GAP = Number(process.argv[2] ?? 0)
const { expect } = await import(`${ROOT}/node_modules/@playwright/test/index.mjs`)
const { runLockExitRehearsal } = await import(`${ROOT}/tests/ux/_generationLockExitRehearsal.mjs`)
const { prepareLockExitStoryboard } = await import(`${ROOT}/tests/ux/_generationLockExitSteps.mjs`)
const { readProject, openCanvas } = await import(`${ROOT}/tests/ux/agent-runtime-walk-support.mjs`)
const { openStoryboardEditor } = await import(`${ROOT}/tests/ux/_creationResourceTree.mjs`)
const { collapseAgentPanel, closeRailDrawer } = await import(`${ROOT}/tests/ux/_shell.mjs`)
const { waitForVisualQuiescence } = await import(`${ROOT}/tests/ux/_assert.mjs`)
const { stationTimeout } = await import(`${ROOT}/tests/ux/_station-budget.mjs`)

async function t2CardOpen(input) {
  const { page, projectId, proxy, locale, screenshotDir } = input
  const report = { gap: GAP, screenshots: [] }
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { await waitForVisualQuiescence(page).catch(() => undefined); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-t2-gap${GAP}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
    const target = design.plan.shots[1]
    report.targetPrompt = target.prompt
    const row = page.locator(`[data-storyboard-row="${target.index}"]`)
    await row.scrollIntoViewIfNeeded()
    await page.evaluate(({ index, shotId, gap }) => {
      const t0 = performance.now()
      const log = window.__vLog = { gap, nodeAt: null, busyAt: null, clickedBatchAt: null, dialogAt: null, runningAt: null, successAt: null }
      const check = () => {
        const now = performance.now() - t0
        const n = window.__nomiCanvasStore.getState().nodes.find(x => x.meta?.shotId === shotId && !x.meta?.storyboardKeyframe)
        if (n && log.nodeAt === null) log.nodeAt = now
        const queued = n && window.__nomiQueueStore.getState().entries?.some?.(e => e.nodeId === n.id && e.state === 'queued')
        if (n && log.busyAt === null && (n.status === 'running' || n.status === 'queued' || queued)) log.busyAt = now
        if (n && log.runningAt === null && n.status === 'running') log.runningAt = now
        if (n && log.successAt === null && n.status === 'success') log.successAt = now
        if (log.dialogAt === null && document.querySelector('[data-spend-confirm-dialog]')) log.dialogAt = now
      }
      window.__nomiCanvasStore.subscribe(check); window.__nomiQueueStore.subscribe(check)
      const timer = setInterval(() => { check(); if (performance.now() - t0 > 30000) clearInterval(timer) }, 2)
      document.querySelector(`[data-storyboard-row="${index}"] [data-storyboard-generate-state]`).click()
      const clickBatch = () => { log.clickedBatchAt = performance.now() - t0; log.batchDisabled = document.querySelector('[data-storyboard-batch]').disabled; document.querySelector('[data-storyboard-batch]').click() }
      if (gap <= 0) clickBatch(); else setTimeout(clickBatch, gap)
    }, { index: target.index, shotId: target.shotId, gap: GAP })
    const opened = await dialog.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 1 }) }).then(() => true, () => false)
    report.dialogOpened = opened
    report.logAtDialog = await page.evaluate(() => window.__vLog)
    if (!opened) { await shot('no-dialog'); report.http = structuredClone(proxy.records); return report }
    report.cardText = await dialog.innerText()
    report.cardListsTarget = report.cardText.includes(target.prompt.slice(0, 6))
    await shot('card-open')
    await expect.poll(async () => (await nodes()).find(n => n.meta?.shotId === target.shotId)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success').catch(error => { report.singleDidNotFinish = String(error).slice(0, 160) })
    const single = (await nodes()).find(n => n.meta?.shotId === target.shotId)
    report.singleBeforeConfirm = { status: single?.status, resultId: single?.result?.id ?? null, runs: (single?.runs ?? []).map(r => r.status) }
    report.postsBeforeConfirm = proxy.records.length
    await shot('card-open-single-done')
    if (await dialog.locator('[data-hosting-remember] input').isVisible().catch(() => false)) await dialog.locator('[data-hosting-remember] input').check()
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    await expect.poll(async () => {
      const all = await nodes()
      return all.filter(n => n.status === 'success' || n.status === 'error').length === 5 && await page.locator('[data-place-storyboard]').isEnabled()
    }, { timeout: stationTimeout({ operations: 10 }) }).toBe(true)
    report.log = await page.evaluate(() => window.__vLog)
    const final = (await nodes()).find(n => n.meta?.shotId === target.shotId)
    report.finalTarget = { status: final.status, resultId: final.result?.id ?? null, runs: (final.runs ?? []).map(r => r.status), history: (final.history ?? final.results ?? []).length }
    report.resultReplaced = final.result?.id !== single?.result?.id
    report.postsPerPrompt = Object.fromEntries([...new Set(proxy.records.map(r => r.prompt.slice(0, 24)))].map(prompt => [prompt, proxy.records.filter(r => r.prompt.startsWith(prompt)).length]))
    report.targetPosts = proxy.records.filter(r => r.prompt.includes(target.prompt.slice(0, 6))).length
    report.postsTotal = proxy.records.length
    await row.scrollIntoViewIfNeeded(); await shot('after-batch')
    expect(report.targetPosts).toBe(1)
    expect(report.finalTarget.status).toBe('success')
    expect(report.resultReplaced).toBe(false)
    return report
  } catch (error) { error.report = report; throw error }
}
Object.defineProperty(t2CardOpen, 'name', { value: `t2-gap${GAP}` })

try { await runLockExitRehearsal(process.env.NOMI_LOCK_EXIT_LOCALE || 'zh-CN', t2CardOpen) }
catch (error) { process.exitCode = 1; console.error(`zh-CN/t2: ${error.message}`) }
