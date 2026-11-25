import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect } from './_assert.mjs'
import { ensureAgentPanelOpen, switchWorkspace } from './_shell.mjs'
import { openStoryboardEditor } from './_creationResourceTree.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CREATION_PANEL, DOCUMENT, ERROR_BAR, chooseAssistantModel,
  createRuntimeWalk, hasToolResult, recorded, sendCreation, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

process.env.NOMI_WALK_OUT = makeTempDir('nomi-b2c-form-evidence-')
process.env.EVIDENCE_DIR = path.join(process.env.NOMI_WALK_OUT, 'feel')
const walk = await createRuntimeWalk('b2c-form', { generationProvider: 'apimart' })
const receipt = { frames: {} }
let failure
try {
  // The isolated APIMart fixture supplies the two real catalog entries. Only the loopback text model is called.
  const catalogFile = path.join(walk.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'))
  const defaultModelKeys = ['gpt-image-2', 'MiniMax-H3']
  const defaults = catalog.models.filter((model) => model.vendorKey === FIXTURE_APIMART_VENDOR && defaultModelKeys.includes(model.modelKey))
  expect(defaults).toHaveLength(2)
  for (const model of defaults) model.enabled = true
  await fs.writeFile(catalogFile, JSON.stringify(catalog))

  const { win: page } = await walk.start({ first: true })
  await walk.resizeWindow(1440, 1000)
  const { projectRoot } = await walk.newProject()
  await walk.resizeWindow(1440, 1000)
  const panel = page.locator('[data-v4-panel]')
  const handle = page.locator('[data-assistant-pane] [role=separator]:visible')
  const width = () => panel.evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const shot = walk.snap
  for (const surface of ['creation', 'storyboard', 'generation', 'preview']) {
    if (surface === 'storyboard') await openStoryboardEditor(page)
    else await switchWorkspace(page, surface)
    await ensureAgentPanelOpen(page, `核验 ${surface} 的停靠面板`, { form: 'dock' })
    await expect(panel).toBeVisible()
    await shot(`frame-${surface}`)
    receipt.frames[surface] = await panel.evaluate((el) => {
      const bounds = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, radius: style.borderRadius, border: style.borderWidth }
    })
  }
  await switchWorkspace(page, 'creation')
  await handle.focus()
  await page.keyboard.press('End')
  await expect.poll(width).toBe(600)
  await shot('width-600')
  for (const surface of ['generation', 'preview', 'creation']) {
    await switchWorkspace(page, surface)
    await expect.poll(width).toBe(600)
    if (surface === 'preview') await shot('width-600-preview')
  }
  receipt.crossSurface600 = true
  await handle.focus()
  await page.keyboard.press('Home')
  await expect.poll(width).toBe(300)
  await shot('width-300')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(width).toBe(310)
  await shot('width-before-refresh')
  await page.reload()
  await expect.poll(width).toBe(310)
  receipt.refreshWidth = 310
  await handle.focus()
  // 宽度动画落定后，下一发方向键才会从当前可见宽度继续累加。
  for (let expectedWidth = 320; expectedWidth <= 390; expectedWidth += 10) {
    await page.keyboard.press('ArrowLeft')
    await expect.poll(width).toBe(expectedWidth)
  }
  const modelTrigger = panel.locator('[data-v4-control="model"]')
  await modelTrigger.click()
  const modelRows = panel.locator('[data-v4-model-row]')
  await expect(modelRows).toHaveCount(3)
  for (const [key, name] of [['imageDefault', 'GPT Image 2'], ['videoDefault', 'MiniMax H3']]) {
    const select = modelRows.getByRole('button', { name: uiText('zh-CN', `agentPanelV4.${key}`), exact: true })
    await select.click()
    await page.getByRole('option').filter({
      has: page.locator('[data-nomi-select-option-label]').and(page.getByText(name, { exact: true })),
    }).click()
    await expect(select).toContainText(name)
  }
  await shot('model-electron')
  receipt.models = await modelRows.allTextContents()
  await modelTrigger.click()
  await expect.poll(width).toBe(390)
  const box = await handle.boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x - 78, center.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(width).toBe(468)
  receipt.dragWidth = await width()
  expect(receipt.dragWidth).toBe(468)
  await handle.focus()
  await page.keyboard.press('Home')
  await expect.poll(width).toBe(300)
  for (let expectedWidth = 310; expectedWidth <= 390; expectedWidth += 10) {
    await page.keyboard.press('ArrowLeft')
    await expect.poll(width).toBe(expectedWidth)
  }
  await switchWorkspace(page, 'creation')
  await expect.poll(width).toBe(390)
  await chooseAssistantModel(page, FIXTURE_TEXT_MODEL_LABEL)
  await page.locator(DOCUMENT).fill('清晨，女孩走进咖啡馆，把红杯放在窗前。')
  const processRows = panel.locator('[data-v4-block="process"]')

  async function captureProcess(process, state) {
    await expect(process).toHaveAttribute('data-running', String(state === 'running'))
    await shot(`process-${state}-electron`)
    const summary = process.locator(':scope > summary')
    if (await process.getAttribute('open') === null) await summary.click()
    // 现役收据没有可展开的内容时直接渲染行，有详情时才用 summary。
    const toolRows = process.locator('[data-v4-block="tool"]:not(details), details[data-v4-block="tool"] > summary')
    await expect(toolRows).toHaveCount(3)
    for (const row of await toolRows.all()) await expect(row).toBeVisible()
    await page.mouse.move(10, 990)
    const styles = await toolRows.evaluateAll((rows) => rows.map((row) => {
      const css = getComputedStyle(row)
      return { background: css.backgroundColor, shadow: css.boxShadow, border: css.borderWidth }
    }))
    expect(styles).toEqual(Array.from({ length: 3 }, () => ({
      background: 'rgba(0, 0, 0, 0)', shadow: 'none', border: '0px',
    })))
    receipt[`process-${state}`] = styles
    await shot(`process-${state}-expanded-electron`)
    await summary.click()
  }

  for (const [index, fails] of [false, true].entries()) {
    const prompt = `B2C_FORM_${index}：读取文稿、核对画布，然后写入 8 个分镜。`
    const shots = Array.from({ length: 8 }, (_, shot) => ({
      title: `咖啡馆镜头 ${shot + 1}`, prompt: `清晨咖啡馆红杯，镜头 ${shot + 1}`, taskKind: 'text_to_image',
    }))
    const calls = [
      { name: 'read_script', args: { scope: 'full' } },
      { name: 'look_at_canvas', args: {} },
      { name: 'draft_shots', args: { shots: fails ? [] : shots } },
    ]
    const callIds = calls.map((_, i) => `b2c-${index}-${i}`)
    const toolRequests = calls.map((call, i) => walk.fixture.expectText({
      label: callIds[i],
      match: (body) => (i === 0 ? flattenRequestText(body).includes(prompt) : hasToolResult(body, callIds[i - 1]))
        && !hasToolResult(body, callIds[i]),
      reply: { type: 'tool', id: callIds[i], ...call },
    }))
    const streamingText = fails ? '' : '已写入 8 个分镜。'
    const finalText = fails ? '分镜未写入，请补充镜头内容。' : '下一步：补齐角色参考图。'
    const answer = streamingText + finalText
    const done = walk.fixture.expectText({
      label: `b2c result ${index}`,
      match: (body) => hasToolResult(body, callIds[2]),
      reply: { type: 'hold', ...(streamingText ? { text: streamingText } : {}) },
    })
    await sendCreation(page, prompt)
    for (const request of toolRequests) await recorded(request.received, 'real lane tool request')
    await recorded(done.received, 'real lane tool results')
    await expect.poll(() => readLaneTranscripts(projectRoot).flatMap(laneMessages)
      .filter((message) => message.role === 'toolResult' && callIds.includes(message.toolCallId))
      .map((message) => Boolean(message.isError))).toEqual([false, false, fails])
    const process = processRows.last()
    await expect(processRows).toHaveCount(index + 1)
    if (!fails) await captureProcess(process, 'running')
    done.release({ type: 'text', text: finalText })
    const visibleAnswer = panel.locator('[data-v4-block="assistant"]').getByText(answer, { exact: true })
    await waitForV4TurnIdle(page, { panel: CREATION_PANEL, settledBy: visibleAnswer })
    if (fails) await expect(process.locator(ERROR_BAR)).toBeVisible()
    else await expect(visibleAnswer).toBeVisible()
    await captureProcess(process, fails ? 'failed' : 'done')
  }
  expect(walk.fixture.images).toHaveLength(0)
  expect(walk.fixture.videos).toHaveLength(0)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root: dom } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: dom.nodeId, selector: '[data-v4-panel] header [class*=font-nomi-display]',
  })
  if (nodeId) receipt.brandFonts = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  walk.report.form = receipt
} catch (error) { failure = error }
await walk.finish(failure)
