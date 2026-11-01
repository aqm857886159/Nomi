#!/usr/bin/env node
// B6 真窗回归：真窗 + 假服务商，同 spendChangeLockExitJourney 的起手，
// 资产在跑时点第 2 镜行上的「生成」，放开后数 HTTP POST。合同（★1 场景六、★4、B3、E4）：这一镜恰 1 次，整批 5 次。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { expect } from '@playwright/test'
import { runLockExitRehearsal } from './_generationLockExitRehearsal.mjs'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { readProject, openCanvas } from './agent-runtime-walk-support.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { collapseAgentPanel, closeRailDrawer, switchWorkspace, switchGenerationView, canvasFitView } from './_shell.mjs'
import { waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'

async function assetPhaseRowClick(input, surface) {
  const { page, projectId, fixture, proxy, locale, screenshotDir } = input
  const report = { checks: {}, screenshots: [] }
  const dialog = page.locator('[data-spend-confirm-dialog]')
  const nodes = async () => (await readProject(page, projectId)).payload.generationCanvas.nodes
  const shot = async name => { await waitForVisualQuiescence(page); fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-asset-phase-${surface}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  const confirm = async () => {
    if (await dialog.locator('[data-hosting-remember] input').isVisible()) await dialog.locator('[data-hosting-remember] input').check()
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
  }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openCanvas(page); await page.evaluate(() => window.__nomiSetBatchConcurrency(1)); proxy.setLimit(5)
    await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
    if (surface !== 'storyboard') { await page.locator('[data-place-storyboard]').click(); await expect.poll(async () => (await nodes()).length).toBe(5) }
    fixture.holdTasks(true)
    await page.locator('[data-storyboard-batch]').click(); await expect(dialog).toBeVisible(); await confirm()
    await expect.poll(() => proxy.records.length).toBe(1)
    report.firstPost = proxy.records[0].prompt
    const target = design.plan.shots[1]
    report.targetPrompt = target.prompt
    const row = page.locator(`[data-storyboard-row="${target.index}"]`)
    await row.scrollIntoViewIfNeeded()
    const button = row.locator('[data-storyboard-generate-state]')
    report.buttonStateDuringAssets = await button.getAttribute('data-storyboard-generate-state')
    report.batchButtonDisabledDuringAssets = await page.locator('[data-storyboard-batch]').isDisabled()
    await shot('row-clickable')
    if (surface === 'storyboard') await button.click()
    else {
      const node = (await nodes()).find(n => n.meta?.shotId === target.shotId)
      await switchWorkspace(page, 'generation'); await switchGenerationView(page, surface === 'list' ? 'list' : 'canvas'); await collapseAgentPanel(page)
      if (surface === 'canvas') {
        await canvasFitView(page)
        await page.evaluate(id => window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } })), node.id)
        await page.locator('[data-composer-host="canvas"]:visible [data-bar-segment="generate"]').click()
      } else {
        await page.locator(`[data-list-card="${node.id}"]`).click()
        await page.locator('[data-inspector-composer] [data-bar-segment="generate"]').click()
      }
    }
    await expect.poll(() => proxy.records.length).toBe(2)
    await expect(dialog).not.toBeVisible()
    report.secondPost = proxy.records[1].prompt
    report.checks.singleClickPostedNoCard = true
    fixture.holdTasks(false)
    // 单点这一镜先出结果（资产 2 还要 2.5 秒假延迟 + 轮询）
    await expect.poll(async () => (await nodes()).find(n => n.meta?.shotId === target.shotId)?.status, { timeout: stationTimeout({ operations: 5 }) }).toBe('success')
    const single = (await nodes()).find(n => n.meta?.shotId === target.shotId)
    report.singleResultId = single.result?.id
    report.postsWhenSingleDone = proxy.records.length
    await shot('single-done')
    await openStoryboardEditor(page, design.id); await closeRailDrawer(page, 'docs'); await collapseAgentPanel(page)
    // 批次跑到底：表级 pending 解除、五个节点都出结果
    let sawDialog = false
    await expect.poll(async () => {
      if (await dialog.isVisible()) sawDialog = true
      const all = await nodes()
      return all.filter(n => n.status === 'success').length === 5 && await page.locator('[data-place-storyboard]').isEnabled()
    }, { timeout: stationTimeout({ operations: 8 }) }).toBe(true)
    report.sawSpendDialogInSecondPhase = sawDialog
    report.http = structuredClone(proxy.records)
    report.postsTotal = proxy.records.length
    report.postsPerPrompt = Object.fromEntries([...new Set(proxy.records.map(r => r.prompt))].map(prompt => [prompt, proxy.records.filter(r => r.prompt === prompt).length]))
    const final = (await nodes()).find(n => n.meta?.shotId === target.shotId)
    report.finalResultId = final.result?.id
    report.resultReplaced = final.result?.id !== report.singleResultId
    report.finalHistoryCount = (final.history ?? final.results ?? []).length
    report.finalRunsCount = (final.runs ?? []).length
    await row.scrollIntoViewIfNeeded(); await shot('after-batch')
    const targetPosts = proxy.records.filter(r => r.prompt.includes('窗边')).length
    report.targetPosts = targetPosts
    assert.equal(targetPosts, 1, `合同：资产阶段单点的这一镜只发 1 次，实际 ${targetPosts} 次`)
    assert.equal(report.resultReplaced, false, 'The single result remains current after the batch')
    assert.equal(report.finalRunsCount, 1, 'The batch never starts another run for this shot')
    assert.equal(proxy.records.length, 5, `合同：整批总共 5 次 POST，实际 ${proxy.records.length} 次`)
    return report
  } catch (error) { error.report = report; throw error } finally { fixture.holdTasks(false) }
}

const onlyRepro = process.argv.includes('--repro')
for (const locale of onlyRepro ? ['zh-CN'] : ['zh-CN', 'en']) for (const surface of onlyRepro ? ['storyboard'] : ['storyboard', 'canvas', 'list']) {
  const journey = { [surface]: input => assetPhaseRowClick(input, surface) }[surface]
  try { await runLockExitRehearsal(locale, journey) }
  catch (error) { process.exitCode = 1; console.error(`${locale}/${surface}: ${error.message}`) }
}
