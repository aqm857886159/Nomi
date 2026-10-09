import { makeTempDirAsync } from '../../scripts/_test-temp.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
const root = path.resolve('.')
const out = path.join(root, 'docs/plan/b2c-form-evidence')
await fs.mkdir(out, { recursive: true })
const tempRoot = await makeTempDirAsync('nomi-b2c-form-')
const settingsDir = path.join(tempRoot, 'settings')
await fs.mkdir(settingsDir, { recursive: true })
const now = '2026-09-09T00:00:00.000Z'
const models = [
  { modelKey: 'deepseek-v4-pro', labelZh: 'DeepSeek V4 Pro', kind: 'text' },
  { modelKey: 'gpt-image-2', labelZh: 'GPT Image 2', kind: 'image' },
  { modelKey: 'MiniMax-H3', labelZh: 'MiniMax H3', kind: 'video' },
].map(model => ({ ...model, vendorKey: 'b2c-catalog', enabled: true, published: true, publishedModes: [], createdAt: now, updatedAt: now }))
await fs.writeFile(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({ version: currentCatalogVersion(), vendors: [{ key: 'b2c-catalog', name: 'Catalog', enabled: true, authType: 'none', createdAt: now, updatedAt: now }], models, mappings: [], apiKeysByVendor: {} }))
const application = await launchNomiApp({ name: 'b2c-form', tempRoot, settingsDir, settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': 'light', 'nomi.assistantModel': JSON.stringify({ vendorKey: 'b2c-catalog', modelKey: 'deepseek-v4-pro' }) },
  env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:52793', NOMI_DISABLE_AUTO_UPDATE: '1' } })
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
  await expect(page.getByRole('button', { name: /新建空白项目/ })).toBeVisible({ timeout: stationTimeout() })
  await page.getByRole('button', { name: /新建空白项目/ }).click()
  await expect(page.locator('[data-v4-panel]')).toBeVisible({ timeout: stationTimeout() })
  for (const [surface, label] of [['creation','创作'], ['storyboard','分镜'], ['generation','生成'], ['preview','预览']]) {
    if (surface === 'storyboard') await page.getByText('分镜方案', { exact: true }).first().click()
    else await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.locator('[data-v4-panel]')).toBeVisible()
    await shot(`frame-${surface}`)
    receipt.frames[surface] = await page.locator('[data-v4-panel]').evaluate(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { x:r.x, y:r.y, width:r.width, height:r.height, radius:s.borderRadius, border:s.borderWidth } })
  }
  await page.getByRole('button', { name: '创作', exact: true }).click()
  console.log('separators', await page.getByRole('separator').evaluateAll(els => els.map(el=>({name:el.getAttribute('aria-label')}))))
  await page.locator('[data-assistant-pane] [role=separator]:visible').focus()
  await page.keyboard.press('End')
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(600)
  await shot('width-600')
  for (const label of ['生成', '预览', '创作']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(600)
    if (label === '预览') await shot('width-600-preview')
  }
  receipt.crossSurface600 = true
  await page.locator('[data-assistant-pane] [role=separator]:visible').focus()
  await page.keyboard.press('Home')
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(300)
  await shot('width-300')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(310)
  await shot('width-before-refresh')
  await page.reload()
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(310)
  receipt.refreshWidth = 310
  await page.locator('[data-assistant-pane] [role=separator]:visible').focus()
  for (let i=0;i<8;i++) await page.keyboard.press('ArrowLeft')
  await page.locator('[data-v4-control=model]').click()
  await expect(page.locator('[data-v4-model-row]')).toHaveCount(3)
  for (const [slot, name] of [['图片默认', 'GPT Image 2'], ['视频默认', 'MiniMax H3']]) {
    await page.locator('[data-v4-model-row]').filter({ hasText: slot }).getByRole('button').click()
    await page.getByRole('option', { name: new RegExp(name) }).first().click()
  }
  await shot('model-electron')
  receipt.models = await page.locator('[data-v4-model-row]').allTextContents()
  await page.locator('[data-v4-control=model]').click()
  const handle = page.locator('[data-assistant-pane] [role=separator]:visible')
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(390)
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 70, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(468)
  receipt.dragWidth = await page.locator('[data-v4-panel]').evaluate(el => Math.round(el.getBoundingClientRect().width))
  expect(receipt.dragWidth).toBe(468)
  await handle.focus()
  await page.keyboard.press('Home')
  for (let i=0;i<9;i++) await page.keyboard.press('ArrowLeft')
  for (const state of ['running', 'done', 'failed']) {
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
    }, state)
    await expect(page.locator('[data-v4-block=process]')).toHaveCount(1)
    await expect(page.locator('[data-v4-block=process]')).toHaveAttribute('data-running', String(state === 'running'))
    if (state === 'done') await expect(page.locator('[data-v4-block=assistant]')).toContainText('已写入 8 个分镜')
    if (state === 'failed') await expect(page.locator('[data-v4-block=errorbar]')).toBeVisible()
    await shot(`process-${state}-electron`)
    if (!await page.locator('[data-v4-block=process]').evaluate(el => el.open)) await page.locator('[data-v4-block=process] > summary').click()
    await expect(page.locator('[data-v4-block=process] [data-v4-block=tool]').first()).toBeVisible()
    await page.mouse.move(10, 990)
    const surfaces = await page.locator('[data-v4-block=process] [data-v4-block=tool] > summary').evaluateAll(rows => rows.map(row => {
      const css = getComputedStyle(row)
      return { background: css.backgroundColor, shadow: css.boxShadow, border: css.borderWidth }
    }))
    expect(surfaces.length).toBeGreaterThan(0)
    expect(surfaces.every(row => row.background === 'rgba(0, 0, 0, 0)' && row.shadow === 'none' && row.border === '0px')).toBe(true)
    receipt[`process${state}Surfaces`] = surfaces
    await shot(`process-${state}-expanded-electron`)
    await page.locator('[data-v4-block=process] > summary').click()
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root: dom } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: dom.nodeId, selector: '[data-v4-panel] header [class*=font-nomi-display]' })
  if (nodeId) receipt.brandFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  await fs.writeFile(path.join(out,'electron-receipt.json'), JSON.stringify(receipt,null,2))
} catch (error) {
  await page.screenshot({ path: path.join(out,'failure.png') })
  await fs.writeFile(path.join(out,'failure.txt'), String(error))
  throw error
} finally { await application.app.close() }
