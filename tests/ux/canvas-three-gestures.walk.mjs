// Real Electron tasks: customize the add menu, Alt-drag a copy, connect a selection in one gesture.
// No generation requests; isolated settings and projects. Run after pnpm build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shots = path.join(root, 'tests/ux/shots/canvas-three-gestures')
fs.mkdirSync(shots, { recursive: true })
const { app, win: initial } = await launchNomiApp({ name: 'canvas-three-gestures', syntheticCredentialStorage: true, settleMs: 0 })
let win = initial
const nodes = () => win.locator('.generation-canvas-v2-node')
const node = (id) => win.locator(`.generation-canvas-v2-node[data-node-id="${id}"]`)
async function blank() {
  const point = await findCanvasBlankPoint(win)
  expect(point).not.toBeNull()
  return point
}
async function fit() {
  await win.getByRole('button', { name: '适应视图', exact: true }).click()
  await screenshotSettled(win, { path: path.join(shots, 'fixture.png') })
}
async function position(id) {
  return win.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(element.style.transform)
    return { x: matrix.m41, y: matrix.m42 }
  })
}
async function openMenu() {
  const point = await blank()
  await win.mouse.click(point.x, point.y, { button: 'right' })
  const menu = win.locator('.generation-canvas-v2-toolbar__node-menu')
  await expect(menu).toBeVisible()
  return menu
}
try {
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await win.getByText('新建空白项目', { exact: false }).first().waitFor({ timeout: 30000 })
  await win.keyboard.press('Escape')
  await win.getByText('新建空白项目', { exact: false }).first().click()
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1600, height: 1000 }))
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 30000 })
  await expect(win.locator('.generation-canvas-v2-toolbar')).toBeVisible()

  // Customize in the existing menu, then verify the real IPC and rail see the same preference.
  const railAudio = win.locator('.generation-canvas-v2-toolbar [data-add-intent="audio"]')
  const railAudioProof = await proveProbe(railAudio, 'default rail contains audio')
  let menu = await openMenu()
  const menuAudioProof = await proveProbe(menu.locator('[data-add-intent="audio"]'), 'default full menu contains audio')
  await menu.locator('[data-add-intent="audio"]').click({ button: 'right' })
  await expect(menu.locator('[data-add-menu-hide]')).toBeVisible()
  await menu.locator('[data-add-menu-hide]').click()
  await expectAbsent(menu.locator('[data-add-intent="audio"]'), { provenBy: menuAudioProof })
  await menu.locator('[data-add-intent="video"]').click({ button: 'right' })
  await menu.locator('[data-add-menu-up]').click()
  await expect(menu.locator('[data-add-section="generate"] [data-add-intent]').first()).toHaveAttribute('data-add-intent', 'video')
  await menu.locator('[data-add-intent="video"]').click({ button: 'right' })
  await screenshotSettled(win, { path: path.join(shots, '01-menu-customization.png') })
  await expect.poll(() => win.evaluate(() => window.nomiDesktop.settings.canvasMenuPreference.get())).toMatchObject({ schemaVersion: 1, hiddenIntentIds: ['audio'], orderedIntentIds: ['video', 'image', 'clip', 'text'] })
  await win.keyboard.press('Escape')
  await expectAbsent(railAudio, { provenBy: railAudioProof })
  menu = await openMenu()
  await menu.locator('[data-add-menu-reset]').click()
  await win.keyboard.press('Escape')
  await expect(win.locator('.generation-canvas-v2-toolbar [data-add-intent="audio"]')).toHaveCount(1)
  console.log('PASS: hide, order, persistence and restore default')

  // Alt copy must appear at the pointer; the source and clipboard are not moved.
  await addCanvasNodeFromRail(win, 'image')
  await expect(nodes()).toHaveCount(1)
  await fit()
  const original = await nodes().first().getAttribute('data-node-id')
  const beforeZoom = await node(original).boundingBox()
  await win.mouse.move(beforeZoom.x + beforeZoom.width / 2, beforeZoom.y + beforeZoom.height / 2)
  await win.mouse.wheel(0, 800)
  await screenshotSettled(win, { path: path.join(shots, 'fixture.png') })
  const staged = await node(original).boundingBox()
  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  await win.mouse.move(staged.x + staged.width / 2, staged.y + 10)
  await win.mouse.down()
  await win.mouse.move(stage.x + stage.width * 0.4, stage.y + stage.height * 0.3, { steps: 16 })
  await win.mouse.up()
  await screenshotSettled(win, { path: path.join(shots, 'fixture.png') })
  const originalPosition = await position(original)
  const box = await node(original).boundingBox()
  await win.keyboard.down('Alt')
  await win.mouse.move(box.x + box.width / 2, box.y + 10)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width / 2 + 170, box.y + 110, { steps: 20 })
  await expect(nodes()).toHaveCount(2)
  await win.screenshot({ path: path.join(shots, '02-alt-drag-copy.png') })
  await win.mouse.up()
  await win.keyboard.up('Alt')
  expect(await position(original)).toEqual(originalPosition)
  const copy = await nodes().evaluateAll((elements, source) => elements.map((element) => element.dataset.nodeId).find((id) => id !== source), original)
  expect(await position(copy)).not.toEqual(originalPosition)
  await win.keyboard.press('Meta+z')
  await expect(nodes()).toHaveCount(1)
  expect(await position(original)).toEqual(originalPosition)
  console.log('PASS: Alt drag duplicates, moves only the copy and undoes once')

  // Two text prompts feed one image. The ×2 preview and both edges belong to one undo step.
  await addCanvasNodeFromRail(win, 'text')
  await addCanvasNodeFromRail(win, 'text')
  await expect(nodes()).toHaveCount(3)
  await fit()
  const textIds = await win.locator('.generation-canvas-v2-node[data-kind="text"]').evaluateAll((elements) => elements.map((element) => element.dataset.nodeId))
  const clear = await blank()
  await win.mouse.click(clear.x, clear.y)
  const firstHit = await findNodeHitPoint(win, { nodeSelector: `.generation-canvas-v2-node[data-node-id="${textIds[0]}"]` })
  expect(firstHit).not.toBeNull()
  await win.mouse.click(firstHit.x, firstHit.y)
  await win.keyboard.down('Shift')
  const secondHit = await findNodeHitPoint(win, { nodeSelector: `.generation-canvas-v2-node[data-node-id="${textIds[1]}"]` })
  expect(secondHit).not.toBeNull()
  await win.mouse.click(secondHit.x, secondHit.y)
  await win.keyboard.up('Shift')
  const handle = win.locator(`.react-flow__node[data-id="${textIds[1]}"] .react-flow__handle.source[data-side="right"]`).first()
  await expect(handle).toBeVisible()
  const handleBox = await handle.boundingBox()
  const targetBox = await node(original).boundingBox()
  await win.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 })
  await expect(win.locator('[data-batch-connection-count="2"]')).toBeVisible()
  await win.screenshot({ path: path.join(shots, '03-multi-connect-preview.png') })
  await win.mouse.up()
  await expect(win.locator('.generation-canvas-v2__edge')).toHaveCount(2)
  const edgeProof = await proveProbe(win.locator('.generation-canvas-v2__edge'), 'both connected edges render')
  await screenshotSettled(win, { path: path.join(shots, '04-multi-connect-result.png') })
  await win.keyboard.press('Meta+z')
  await expectAbsent(win.locator('.generation-canvas-v2__edge'), { provenBy: edgeProof })
  await expect(nodes()).toHaveCount(3)
  console.log('PASS: ×2 connection gesture creates both edges and undoes once')
  // Reverse handle direction: the selected destination body must show ×2 before release too.
  const inputHandle = win.locator(`.react-flow__node[data-id="${original}"] .react-flow__handle.source[data-side="left"]`)
  const inputBox = await inputHandle.boundingBox()
  const selectedBox = await node(textIds[0]).boundingBox()
  await win.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(selectedBox.x + selectedBox.width / 2, selectedBox.y + selectedBox.height / 2, { steps: 20 })
  await expect(win.locator('[data-batch-connection-count="2"]')).toBeVisible()
  await win.mouse.up()
  await expect(win.locator('.generation-canvas-v2__edge')).toHaveCount(2)
  await win.keyboard.press('Meta+z')
  await expectAbsent(win.locator('.generation-canvas-v2__edge'), { provenBy: edgeProof })
  console.log('PASS: reverse body drop also previews ×2 and undoes once')
} catch (error) {
  await win.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.close()
}
