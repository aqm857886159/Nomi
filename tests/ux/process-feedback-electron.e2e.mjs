import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { createProcessFixture } from './process-feedback-real-fixture.mjs'

const root = path.resolve('.')
const evidence = path.join(root, 'docs/plan/process-feedback-evidence/neighbor-placement/real')
await fs.mkdir(evidence, { recursive: true })
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-process-real-'))
const settingsDir = path.join(tempRoot, 'settings')
const fixture = await createProcessFixture(root, settingsDir)
const application = await launchNomiApp({ name: 'process-real', tempRoot, settingsDir, settleMs: 0,
  env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5198', NOMI_DISABLE_AUTO_UPDATE: '1' }, args: ['--no-proxy-server'] })
let page = application.win
const receipt = { paidCalls: 0, screenshots: [], checks: [] }
async function shot(name) {
  if (/^(selected|unselected)-(generating|complete)$/.test(name)) {
    const media = page.locator('article[data-node-id]').first()
    await expect(media.locator('[data-shot-number]')).toBeVisible()
    const geometry = await media.evaluate(el => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
      return { node: rect(el), number: rect(el.querySelector('[data-shot-number]')), status: el.querySelector('[data-generation-status]') ? rect(el.querySelector('[data-generation-status]')) : null, toolbar: el.querySelector('[data-node-floating-toolbar]') ? rect(el.querySelector('[data-node-floating-toolbar]')) : null }
    })
    expect(geometry.number.bottom).toBeLessThanOrEqual(geometry.node.top)
    expect(geometry.number.left).toBeGreaterThanOrEqual(geometry.node.left)
    if (name.endsWith('generating')) {
      expect(geometry.status.bottom).toBeLessThanOrEqual(geometry.node.top)
      expect(geometry.status.left).toBeGreaterThan(geometry.number.right)
    } else expect(geometry.status).toBeNull()
    if (geometry.toolbar) expect(geometry.toolbar.bottom).toBeLessThanOrEqual(geometry.node.top)
    receipt.checks.push({ criterion: name, geometry, result: 'green' })
  }
  if (name === 'FAIL') await page.screenshot({ path: path.join(evidence, `${name}.png`) })
  else await screenshotSettled(page, { path: path.join(evidence, `${name}.png`) })
  receipt.screenshots.push(name)
  console.log('SHOT', name)
}
async function setZoom(percent) {
  const zoom = page.locator('.generation-canvas-v2__zoom-bar input[type=range]')
  await zoom.evaluate((el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, percent)
  await expect(zoom).toHaveValue(String(percent))
  await expect.poll(() => page.locator('.generation-canvas-v2__canvas').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(percent / 100, 4)
}
async function centerNode(target) {
  const bounds = await target.boundingBox()
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  const start = await findCanvasBlankPoint(page)
  expect(start).toBeTruthy()
  const dx = stage.x + stage.width * 0.45 - (bounds.x + bounds.width / 2)
  const dy = stage.y + stage.height * 0.4 - (bounds.y + bounds.height / 2)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
}
try {
  page.setDefaultTimeout(15000)
  await application.app.evaluate(async (_, root) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const store = require(root + '/dist-electron/assets/projectAssetStore.js')
    const original = store.importRemoteAsset
    let first = true
    globalThis.__pfImportGate = { received: false }
    store.importRemoteAsset = async (...args) => {
      if (first && args[0]?.kind === 'generated') {
        first = false
        globalThis.__pfImportGate.received = true
        await new Promise(resolve => { globalThis.__pfImportGate.release = resolve })
      }
      return original(...args)
    }
  }, root)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.getByRole('button', { name: /新建空白项目/ })).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => { for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen'); localStorage.setItem('nomi.canvas.batch-concurrency', '1') })
  const skip = page.locator('[data-splash-skip=true]')
  if (await skip.isVisible()) await skip.click()
  await page.getByRole('button', { name: /新建空白项目/ }).click()
  await expect(page.getByRole('button', { name: '生成', exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.locator('.generation-canvas-v2__stage')).toBeVisible()
  const blank = await findCanvasBlankPoint(page)
  expect(blank).toBeTruthy()
  await page.mouse.click(blank.x, blank.y, { button: 'right' })
  await page.locator('.generation-canvas-v2__context-node-menu [role=menuitem]').filter({ hasText: '图片' }).first().click()
  const node = page.locator('article[data-node-id]').first()
  await expect(node).toBeVisible()
  await node.click({ position: { x: 40, y: 15 } })
  await shot('00-image-idle')
  await page.locator('[contenteditable=true]:visible').first().fill('傍晚河边，一位女孩望向远处的桥，电影画面。')
  expect(fixture.jobs.length).toBe(0)
  await page.getByRole('button', { name: '生成素材', exact: true }).click()
  // 用户自己点的单份生成不弹付费确认卡（2026-09-25 拍板，判据按份数不按入口）；若中间弹卡而不点，
  // 请求永远发不出去——下面假供应商恰好收到 1 单（fixture.jobs）就是证据。
  console.log('started generation')
  await expect.poll(() => fixture.jobs.length, { timeout: 30000 }).toBe(1)
  await expect(node.locator('[data-generation-message]')).toContainText('生成中', { timeout: 30000 })
  const generationStatusProof = await proveProbe(node.locator('[data-generation-status]'), '真实生成状态条已出现')
  await expect(node.locator('[data-generation-message]')).toContainText(/已等 (2[0-9]|[3-9][0-9]) 秒/, { timeout: 45000 })
  await shot('selected-generating')
  const emptyDuringGeneration = await findCanvasBlankPoint(page)
  await page.mouse.click(emptyDuringGeneration.x, emptyDuringGeneration.y)
  await expect(node).toHaveAttribute('data-selected', 'false')
  await shot('unselected-generating')
  await node.click({ position: { x: 40, y: 15 } })
  await shot('01-image-generating')
  await page.locator('[data-task-center-trigger]').click()
  await expect(page.locator('[data-nomi-right-panel=tasks] [data-generation-message]')).toBeVisible()
  await shot('02-task-center-generating')
  console.log(await page.locator('[data-nomi-right-panel=tasks]').innerText())
  fixture.jobs[0].done = true
  await expect.poll(() => application.app.evaluate(() => globalThis.__pfImportGate.received), { timeout: 30000 }).toBe(true)
  await expect(node.locator('[data-generation-message]')).toHaveText('正在存到你电脑上')
  await shot('03-image-finalizing')
  await application.app.evaluate(() => globalThis.__pfImportGate.release())
  await expect(node.locator('[data-node-media-state=ready]')).toBeAttached({ timeout: 30000 })
  await expectAbsent(node.locator('[data-generation-status]'), { provenBy: generationStatusProof, message: '完成态状态条消失' })
  await page.getByRole('button', { name: '关闭任务面板' }).click()
  await shot('selected-complete')
  const emptyAfterCompletion = await findCanvasBlankPoint(page)
  await page.mouse.click(emptyAfterCompletion.x, emptyAfterCompletion.y)
  await expect(node).toHaveAttribute('data-selected', 'false')
  await shot('unselected-complete')
  await page.locator('[data-task-center-trigger]').click()
  await shot('04-image-saved')
  await page.getByRole('button', { name: '关闭任务面板' }).click()
  await node.click({ position: { x: 40, y: 15 } })
  await node.hover()
  await node.locator('[aria-label*=加入时间轴]').first().click()
  await expect(page.locator('[data-testid=timeline-clip]')).toBeVisible()
  await page.getByRole('button', { name: '重新生成', exact: true }).click()
  const regenerateDialog = page.getByRole('dialog', { name: '重新生成', exact: true })
  await expect(regenerateDialog).toBeVisible()
  await regenerateDialog.getByRole('button', { name: '重新生成', exact: true }).click()
  await expect.poll(() => fixture.jobs.length, { timeout: 30000 }).toBe(2)
  await expect(node.locator('[data-generation-message]')).toContainText(/已等 (2[0-9]|[3-9][0-9]) 秒/, { timeout: 45000 })
  await page.locator('[data-task-center-trigger]').click()
  await expect(page.locator('[data-nomi-right-panel=tasks]')).toBeVisible()
  const nodeId = await node.getAttribute('data-node-id')
  const messages = await page.evaluate((nodeId) => [
    `article[data-node-id="${nodeId}"] [data-generation-message]`,
    `[data-nomi-right-panel=tasks] [data-task-node-id="${nodeId}"][data-task-group=running] [data-generation-message]`,
    '[data-timeline-generation-feedback]',
  ].map(selector => {
    const elements = document.querySelectorAll(selector)
    if (elements.length !== 1) throw new Error(`Expected one message for the active node at ${selector}, got ${elements.length}`)
    return elements[0].textContent
  }), nodeId)
  await expect(page.locator('[data-nomi-right-panel=tasks] [data-generation-message]').last()).toHaveText('已保存到项目')
  expect(messages[0]).toMatch(/生成中.*已等/)
  expect(new Set(messages).size).toBe(1)
  receipt.checks.push({ criterion: 'three-real-surfaces-same-instant', nodeId, messages, result: 'green' })
  await shot('10-three-real-surfaces-generating')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.locator('[data-timeline-generation-feedback]:visible')).toBeVisible()
  await shot('11-preview-timeline-regenerating')
  await page.getByRole('button', { name: '生成', exact: true }).first().click()
  fixture.jobs[1].done = true
  await expect(node.locator('[data-node-media-state=ready]')).toBeAttached({ timeout: 30000 })
  await expectAbsent(node.locator('[data-generation-status]'), { provenBy: generationStatusProof, message: '完成态状态条消失' })
  // Reduced motion and 60% are checked against the live node, not a lab transform.
  await page.getByRole('button', { name: '添加视频节点', exact: true }).click()
  const videoId = await page.locator('article[data-node-id]').last().getAttribute('data-node-id')
  const video = page.locator(`article[data-node-id="${videoId}"]`)
  await video.click({ position: { x: 40, y: 15 } })
  await page.locator('[contenteditable=true]:visible').first().fill('女孩走过桥，镜头缓缓向前推进。')
  await page.getByRole('button', { name: '添加图片节点', exact: true }).click()
  const queuedId = await page.locator('article[data-node-id]').last().getAttribute('data-node-id')
  const queued = page.locator(`article[data-node-id="${queuedId}"]`)
  await queued.click({ position: { x: 40, y: 15 } })
  await page.locator('[contenteditable=true]:visible').first().fill('桥边的灯亮起来，暖色夜景。')
  await page.keyboard.press('Escape')
  const empty = await findCanvasBlankPoint(page)
  await page.mouse.click(empty.x, empty.y)
  await page.locator('[data-batch-scope=all]').click()
  await expect(page.getByText('开始生成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '生成', exact: true }).last().click()
  await expect.poll(() => fixture.jobs.length, { timeout: 30000 }).toBe(3)
  await setZoom(60)
  await centerNode(queued)
  await expect(queued.locator('[data-generation-message]')).toHaveText('排队中')
  await queued.click({ position: { x: 40, y: 15 } })
  await shot('05-image-queued')
  await page.locator('[data-task-center-trigger]').click()
  await shot('06-task-center-queued')
  await page.getByRole('button', { name: '关闭任务面板' }).click()
  await centerNode(video)
  await video.click({ position: { x: 40, y: 15 } })
  await expect(video.locator('[data-generation-message]')).toContainText(/已等 (2[0-9]|[3-9][0-9]) 秒/, { timeout: 45000 })
  await expect(video).not.toContainText('这类通常')
  await shot('07-video-generating-no-history')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(video.locator('[data-process-dot]')).toHaveCSS('opacity', '1')
  await expect(video.locator('[data-process-static-grid]')).toHaveCSS('transform', 'none')
  await shot('08-video-generating-reduced-motion')
  await setZoom(60)
  const renderedFont = await video.locator('[data-generation-message]').evaluate(el => {
    let scale = 1
    for (let p = el; p; p = p.parentElement) { const m = new DOMMatrix(getComputedStyle(p).transform); scale *= Math.hypot(m.a, m.b) }
    return parseFloat(getComputedStyle(el).fontSize) * scale
  })
  expect(renderedFont).toBeGreaterThanOrEqual(12)
  const composerFont = await video.locator('[contenteditable=true]').evaluate(el => {
    let scale = 1
    for (let p = el; p; p = p.parentElement) { const m = new DOMMatrix(getComputedStyle(p).transform); scale *= Math.hypot(m.a, m.b) }
    return parseFloat(getComputedStyle(el).fontSize) * scale
  })
  expect(composerFont).toBeGreaterThanOrEqual(12)
  await shot('09-video-generating-zoom-60')
  receipt.checks.push({ criterion: 'real-zoom-60', renderedFont, composerFont, result: 'green' })
  await page.evaluate(() => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(v => v.key === 'agent-runtime-loopback')
    catalog.upsertVendor({ ...vendor, enabled: false })
  })
  fixture.jobs[2].done = true
  await expect(queued.locator('[role=alert]')).toBeVisible({ timeout: 60000 })
  await expect(queued.locator('[role=alert]')).toContainText('模型未配置')
  await expect(queued.getByRole('button', { name: '检查模型', exact: true })).toBeVisible()
  await setZoom(100)
  await centerNode(queued)
  await queued.click({ position: { x: 40, y: 15 } })
  await shot('12-image-failed-vendor-disabled')
  await page.locator('[data-task-center-trigger]').click()
  await expect(page.locator(`[data-task-node-id="${queuedId}"] [data-generation-message]`)).toHaveText('模型未配置')
  await shot('13-task-center-failed-vendor-disabled')
  receipt.checks.push({ criterion: 'real-vendor-disabled-recovery', result: 'green' })
  receipt.checks.push({ criterion: 'real-reduced-motion', result: 'green' }, { criterion: 'video-no-history-no-estimate', result: 'green' })

} catch (error) {
  await shot('FAIL')
  console.error(error)
  console.log((await page.locator('body').innerText()).slice(-12000))
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(evidence, 'acceptance.json'), JSON.stringify(receipt, null, 2) + '\n')
  await application.close()
  await fixture.close()
}
