import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { expect } from '@playwright/test'
import { prepareLockExitStoryboard } from './_generationLockExitSteps.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { readProject, AGENT_PANEL, COMPOSER_INPUT, COMPOSER_SEND } from './agent-runtime-walk-support.mjs'
import { ensureAgentPanelOpen } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

async function agentGenerate(input, mounted) {
  let { page } = input
  const { fixture, proxy, projectId, locale, screenshotDir } = input
  const report = { mounted, checks: {}, screenshots: [], confirmations: 0 }
  const shot = async name => { fs.mkdirSync(screenshotDir, { recursive: true }); const file = path.join(screenshotDir, `${locale}-agent-${mounted ? 'mounted' : 'unmounted'}-${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file) }
  try {
    const design = await prepareLockExitStoryboard(input)
    await openStoryboardEditor(page, design.id)
    if (!mounted) {
      await page.getByRole('button', { name: uiText(locale, 'storyboardEditor.backToCreation'), exact: true }).click()
      page = await input.restart() // A fresh window removes the hidden editor kept alive by the previous tab.
    }
    await expect(page.locator('[data-storyboard-editor]')).toHaveCount(mounted ? 1 : 0)
    proxy.setLimit(5)
    fixture.expectText({ label: 'agent starts the existing storyboard', match: body => JSON.stringify(body).includes('开始这份分镜生产'), reply: { type: 'tool', id: 'lock-exit-agent-generate', name: 'generate', args: { operationId: design.id } } })
    fixture.expectText({ label: 'agent receives generation handoff', match: body => (body.messages ?? []).some(m => m.role === 'tool' && m.tool_call_id === 'lock-exit-agent-generate'), reply: { type: 'text', text: '分镜已交给生成页。' } })
    await ensureAgentPanelOpen(page)
    await page.locator(`${AGENT_PANEL}:visible ${COMPOSER_INPUT}`).fill(`开始这份分镜生产，使用现有方案 ${design.id}，不改内容。`)
    await page.locator(`${AGENT_PANEL}:visible ${COMPOSER_SEND}`).click()
    await expect.poll(async () => {
      const dialog = page.locator('[data-spend-confirm-dialog]')
      if (await dialog.isVisible()) {
        await shot(`confirm-${report.confirmations}`)
        report.confirmations++
        assert.ok(report.confirmations <= 3, 'Agent keeps its existing two asset approvals and one shot-batch approval')
        await dialog.locator('[data-spend-confirm-action="confirm"]').click()
      }
      const nodes = (await readProject(page, projectId)).payload.generationCanvas.nodes
      assert.ok(!nodes.some(n => /storyboard_content_conflict|generation_input_changed/.test(n.error ?? '')), 'A5: automatic references must not invalidate the agent handoff')
      return nodes.filter(n => n.status === 'success').length
    }, { timeout: stationTimeout({ turns: 1 }) }).toBe(5)
    assert.equal(proxy.records.length, 5)
    assert.ok(proxy.records.slice(2).every(r => /@image\d/.test(r.prompt) && r.referenceCount > 0))
    await openStoryboardEditor(page, design.id); await shot('all-results')
    report.checks = { agentEntry: true, fiveHttp: true, references: true, noFalseConflict: true }
    return report
  } catch (error) { error.report = report; throw error }
}
export const agentMountedLockExitJourney = input => agentGenerate(input, true)
export const agentUnmountedLockExitJourney = input => agentGenerate(input, false)
