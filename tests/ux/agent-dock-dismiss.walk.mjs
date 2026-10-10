import { makeTempDirAsync } from '../../scripts/_test-temp.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { backToLibrary } from './_shell.mjs'
const root = path.resolve('.')
const out = path.join(root, 'docs/plan/b2d-dock-evidence')
await fs.mkdir(out, { recursive: true })
const tempRoot = await makeTempDirAsync('nomi-b2d-dock-')
const settingsDir = path.join(tempRoot, 'settings')
await fs.mkdir(settingsDir, { recursive: true })
const now = '2026-09-09T00:00:00.000Z'
const models = [
  { modelKey: 'deepseek-v4-pro', labelZh: 'DeepSeek V4 Pro', kind: 'text' },
  { modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image' },
  { modelKey: 'MiniMax-H3', labelZh: 'MiniMax H3', kind: 'video' },
].map(model => ({ ...model, vendorKey: 'b2c-catalog', enabled: true, published: true, publishedModes: [], createdAt: now, updatedAt: now }))
await fs.writeFile(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ version: currentCatalogVersion(), vendors: [{ key: 'b2c-catalog', name: 'Catalog', enabled: true, authType: 'none', createdAt: now, updatedAt: now }], models, mappings: [], apiKeysByVendor: {} }))
const application = await launchNomiApp({ name: 'b2d-dock', tempRoot, settingsDir, settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': 'light', 'nomi.assistantModel': JSON.stringify({ vendorKey: 'b2c-catalog', modelKey: 'deepseek-v4-pro' }) },
  env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:52794', NOMI_DISABLE_AUTO_UPDATE: '1' } })
const page = application.win
const receipt = { modelCalls: 0, evidence: 'real Electron App with isolated catalog and deterministic host snapshots', frames: {}, screenshots: [] }
async function shot(name) {
  await screenshotSettled(page, { path: path.join(out, `${name}.png`) })
  receipt.screenshots.push(name)
  console.log('SHOT', name)
}
try {
  page.setDefaultTimeout(stationTimeout())
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: /新建空白项目/ }).click()
  await expect(page.locator('[data-v4-panel]')).toBeVisible()
    await page.evaluate(async state => {
      const fixture = await import('/src/devlab/designLab/v4/agentPanelV4LabHost.tsx')
      const { projectAgentProjectionStore: store } = await import('/src/workbench/ai/projectAgentProjectionStore.ts')
      const current = store.getState()
      const snapshot = fixture.labHostState({ turnStatus: state, items: [
        fixture.labUserItem('u-b2c', '把这篇文稿拆成 8 个分镜。'),
        ...(state === 'done' ? [fixture.labAssistantItem('a-b2c', '已写入 8 个分镜。下一步：补齐角色参考图，再开始生成。')] : []),
        fixture.labToolItem('read-b2c', 'document.read'),
        fixture.labToolItem('skill-b2c', 'skill.read'),
        { ...fixture.labToolItem('write-b2c', 'canvas.write', state), ...(state === 'failed' ? { text: '分镜未写入：参数校验未通过。' } : {}) },
      ] })
      const { writeResidentToolProjections, residentToolProjectionScope } = await import('/src/workbench/ai/resident/residentToolProjection.ts')
      const { projectBindingKey } = await import('/src/workbench/ai/v4/agentPanelV4PendingTools.ts')
      const scope = residentToolProjectionScope(projectBindingKey(current.binding ?? snapshot.binding), snapshot.activeThreadId)
      writeResidentToolProjections(scope, new Map([
        ['turn-lab:read-b2c', { label: '读取全文', effect: '已读取文稿', target: '', technicalDetails: '', input: '{}', output: '已读取文稿' }],
        ['turn-lab:skill-b2c', { label: '加载分镜技能', effect: '已加载', target: '', technicalDetails: '', input: '{}', output: '已加载' }],
        ['turn-lab:write-b2c', { label: '写入 8 镜', effect: state === 'done' ? '已写入' : '', target: '', technicalDetails: '', input: '{}', output: state === 'failed' ? '分镜未写入：参数校验未通过。' : state === 'done' ? '已写入 8 镜' : '' }],
      ]))
      const time = new Date(Date.now() - 8000).toISOString()
      store.install('b2c-walkthrough', 1, { ...snapshot, binding: current.binding ?? snapshot.binding,
        turns: snapshot.turns.map(turn => ({ ...turn, createdAt: time, updatedAt: new Date().toISOString() })) })
    }, 'done')

  await expect(page.locator('[data-v4-block=process]')).toHaveCount(1)
  const summary = page.locator('[data-v4-block=process] > summary')
  await page.mouse.move(10, 990)
  receipt.processNonHover = await summary.evaluate(el => {
    const css = getComputedStyle(el)
    return { hover: el.matches(':hover'), background: css.backgroundColor, border: css.borderWidth, shadow: css.boxShadow }
  })
  expect(receipt.processNonHover).toEqual({ hover: false, background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' })
  await shot('process-done-non-hover')
  await summary.hover()
  receipt.processHover = await summary.evaluate(el => ({ hover: el.matches(':hover'), background: getComputedStyle(el).backgroundColor }))
  await shot('process-done-hover')
  await page.mouse.move(10, 990)
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  const dock = page.locator('[data-agent-collapsed-dock]')
  const chip = page.locator('[data-agent-dock-reason="resident-collapsed"]')
  const dockProof = await proveProbe(dock, '关闭前输入坞真实可见')
  await shot('dock-before-close')
  await page.getByRole('button', { name: '关闭输入坞', exact: true }).click()
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  await expect(chip).toBeVisible()
  await shot('dock-closed-canvas')
  await page.evaluate(async () => {
    const fixture = await import('/src/devlab/designLab/v4/agentPanelV4LabHost.tsx')
    const { projectAgentProjectionStore: store } = await import('/src/workbench/ai/projectAgentProjectionStore.ts')
    const current = store.getState()
    const snapshot = fixture.labHostState({ items: [...(current.snapshot?.items ?? []), fixture.labAssistantItem('b2d-unread-1', '分镜已准备好。'), fixture.labAssistantItem('b2d-unread-2', '可以继续创作。')] })
    store.install('b2d-unread', 1, { ...snapshot, binding: current.binding ?? snapshot.binding })
  })
  await expect(chip).toHaveAttribute('data-agent-dock-badge-kind', 'count')
  await expect(chip).toHaveAttribute('data-agent-dock-count', '2')
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  receipt.unreadStaysHidden = true
  await page.evaluate(async () => {
    const { projectAgentProjectionStore } = await import('/src/workbench/ai/projectAgentProjectionStore.ts')
    const { agentPanelV4PendingTools, projectBindingKey } = await import('/src/workbench/ai/v4/agentPanelV4PendingTools.ts')
    const binding = projectAgentProjectionStore.getState().binding
    agentPanelV4PendingTools.register({ turnId: 'turn-b2d-pending', toolCallId: 'call-b2d', toolName: 'nomi_document_edit', args: { operation: 'append' }, isPending: () => true, confirm: async () => undefined }, projectBindingKey(binding))
  })
  await expect(chip).toHaveAttribute('data-agent-dock-status', 'needs-confirm')
  await expect(chip).toHaveAttribute('data-agent-dock-badge-kind', 'count')
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  receipt.pendingStaysHidden = true
  await shot('hidden-with-pending-badge')
  await chip.click()
  await expect(page.locator('[data-v4-panel]')).toBeVisible()
  await shot('chip-restored-panel')
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  for (const label of ['创作', '预览', '生成']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
    await expect(chip).toBeVisible()
  }
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await page.keyboard.press('Meta+Backslash')
  await expect(page.locator('[data-v4-panel]')).toBeVisible()
  await page.keyboard.press('Meta+Backslash')
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  await expect(chip).toBeVisible()
  receipt.keyboardRestores = true
  await page.reload()
  await expect(chip).toBeVisible()
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  receipt.persistedDismissal = await page.evaluate(async () => {
    const { useWorkbenchStore } = await import('/src/workbench/workbenchStore.ts')
    return useWorkbenchStore.getState().agentDockHidden
  })
  expect(receipt.persistedDismissal).toBe(true)
  await backToLibrary(page)
  await page.getByRole('button', { name: /新建空白项目/ }).click()
  await expect(page.locator('[data-v4-panel]')).toBeVisible()
  await page.getByRole('button', { name: '收起面板', exact: true }).click()
  await expect(chip).toBeVisible()
  await expectAbsent(dock, { provenBy: dockProof, message: '关闭后的输入坞持续不存在' })
  receipt.newProjectStaysHidden = true
  await fs.writeFile(path.join(out, 'electron-receipt.json'), JSON.stringify(receipt, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') })
  throw error
} finally { await application.app.close() }
