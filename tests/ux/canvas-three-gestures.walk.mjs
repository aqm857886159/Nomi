// Real Electron tasks: customize the add menu, Alt-drag a copy, connect a selection in one gesture.
// No generation requests; isolated settings and projects. Run after pnpm build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { expectNodeInsideCanvas, findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { canvasAddBar, canvasFitViewButton, newProjectEntry } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'

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
  await canvasFitViewButton(win).click()
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
  await newProjectEntry(win).waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await win.keyboard.press('Escape')
  await newProjectEntry(win).click()
  win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1600, height: 1000 }))
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 30000 })
  await expect(canvasAddBar(win)).toBeVisible()

  // Customize in the existing menu, then verify the real IPC and rail see the same preference.
  const railAudio = canvasAddBar(win).locator('[data-add-intent="audio"]')
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
  await expect.poll(() => win.evaluate(() => window.nomiDesktop.settings.canvasMenuPreference.get())).toMatchObject({ schemaVersion: 1, hiddenIntentIds: ['audio'], orderedIntentIds: ['video', 'image', 'text', 'clip'] })
  await win.keyboard.press('Escape')
  await expectAbsent(railAudio, { provenBy: railAudioProof })
  menu = await openMenu()
  await menu.locator('[data-add-menu-reset]').click()
  await win.keyboard.press('Escape')
  await expect(canvasAddBar(win).locator('[data-add-intent="audio"]')).toHaveCount(1)
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
  const copy = await nodes().evaluateAll((elements, source) => elements.map((element) => element.dataset.nodeId).find((id) => id !== source), original)
  const draggedCopyPosition = await position(copy)
  expect(await position(original)).toEqual(originalPosition)
  expect(draggedCopyPosition).not.toEqual(originalPosition)
  // Page.screenshot can inject an OS cursor move while Electron is dragging.
  // Capture the committed result only after releasing the real gesture.
  await win.mouse.up()
  await win.keyboard.up('Alt')
  await expect(nodes()).toHaveCount(2)
  expect(await position(original)).toEqual(originalPosition)
  expect(await position(copy)).toEqual(draggedCopyPosition)
  expect(await position(copy)).not.toEqual(originalPosition)
  await screenshotSettled(win, { path: path.join(shots, '02-alt-drag-copy.png') })
  await win.keyboard.press('Meta+z')
  await expect(nodes()).toHaveCount(1)
  expect(await position(original)).toEqual(originalPosition)
  console.log('PASS: Alt drag duplicates, moves only the copy and undoes once')

  // Two text prompts feed one image. The ×2 preview and both edges belong to one undo step.
  await addCanvasNodeFromRail(win, 'text')
  await addCanvasNodeFromRail(win, 'text')
  await expect(nodes()).toHaveCount(3)
  await fit()
  // 加节点条在内容区底部正中（拍板稿 Main 板），不再盖在左缘：fitView 之后左侧把手露在外面，不用把夹具图片挪开。
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
  // Native capture leaves the in-progress drag's mouse position untouched.
  const previewImage = await browserWindow.evaluate(async window => (await window.webContents.capturePage()).toPNG().toString('base64'))
  fs.writeFileSync(path.join(shots, '03-multi-connect-preview.png'), Buffer.from(previewImage, 'base64'))
  await expect(win.locator('[data-batch-connection-count="2"]')).toBeVisible()
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
  expect(await inputHandle.evaluate(element => {
    const box = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  }), 'reverse gesture starts on the actual handle, not the overlaid rail').toBe(true)
  await win.mouse.down()
  await win.mouse.move(selectedBox.x + selectedBox.width / 2, selectedBox.y + selectedBox.height / 2, { steps: 20 })
  await expect(win.locator('[data-batch-connection-count="2"]')).toBeVisible()
  await win.mouse.up()
  await expect(win.locator('.generation-canvas-v2__edge')).toHaveCount(2)
  // Select/reproject a measured node, then resize through the framework's real
  // control. SVG endpoints must follow the browser's new handle measurement.
  const resizeNode = win.locator(`.react-flow__node[data-id="${original}"]`)
  const resizeHit = await findNodeHitPoint(win, { nodeSelector: `.generation-canvas-v2-node[data-node-id="${original}"]` })
  expect(resizeHit).not.toBeNull()
  await win.mouse.click(resizeHit.x, resizeHit.y)
  await expect(resizeNode).toHaveClass(/selected/)
  const beforeResize = await resizeNode.boundingBox()
  const attachedEdges = () => win.evaluate(({ targetId, sourceIds }) => {
    const rect = id => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect()
    const target = rect(targetId)
    if (!target) return []
    return Array.from(document.querySelectorAll('.generation-canvas-v2__edge-path')).map(edge => {
      const matrix = edge.getScreenCTM()
      if (!matrix || edge.getTotalLength() === 0) return null
      const screenPoint = length => {
        const point = edge.getPointAtLength(length)
        return new DOMPoint(point.x, point.y).matrixTransform(matrix)
      }
      const start = screenPoint(0)
      const end = screenPoint(edge.getTotalLength())
      const sourceId = sourceIds.find(id => {
        // XYFlow anchors a left edge at the handle's outer left edge. Text
        // source dots have a 28px hit box; target anchors have a 1px box.
        const source = document.querySelector(`.react-flow__node[data-id="${id}"] .react-flow__handle.source[data-side="left"]`)?.getBoundingClientRect()
        return source && Math.hypot(start.x - source.left, start.y - (source.top + source.height / 2)) <= 3
      })
      const targetError = Math.hypot(end.x - target.right, end.y - (target.top + target.height / 2))
      return sourceId && targetError <= 3 ? sourceId : null
    }).sort()
  }, { targetId: original, sourceIds: textIds })
  await expect.poll(attachedEdges).toEqual([...textIds].sort())
  const resizeHandle = resizeNode.locator('.react-flow__resize-control.handle.bottom.right')
  await expect(resizeHandle).toBeVisible()
  let resizeBox = await resizeHandle.boundingBox()
  // 加节点条在内容区底部正中（拍板稿 Main 板）：节点右下角的缩放把手若正好落在它底下，真人也点不到——
  // 人会先把节点往上拖开再缩放，走查照做（把手上最顶层不是它自己就把整张卡往上拖 140px）。
  const handleCovered = () => win.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('.react-flow__resize-control'), { x: resizeBox.x + resizeBox.width / 2, y: resizeBox.y + resizeBox.height / 2 })
  let liftedAwayFromDock = false
  if (await handleCovered()) {
    liftedAwayFromDock = true
    const grab = await findNodeHitPoint(win, { nodeSelector: `.generation-canvas-v2-node[data-node-id="${original}"]` })
    await win.mouse.move(grab.x, grab.y)
    await win.mouse.down()
    await win.mouse.move(grab.x, grab.y - 140, { steps: 12 })
    await win.mouse.up()
    resizeBox = await resizeHandle.boundingBox()
    expect(await handleCovered(), '把节点往上拖开之后缩放把手仍被盖住').toBe(false)
  }
  await win.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(resizeBox.x + 60, resizeBox.y + 40, { steps: 12 })
  await win.mouse.up()
  await expect.poll(async () => (await resizeNode.boundingBox()).width).toBeGreaterThan(beforeResize.width + 20)
  await expect.poll(async () => (await resizeNode.boundingBox()).height).toBeGreaterThan(beforeResize.height + 20)
  await expect.poll(attachedEdges).toEqual([...textIds].sort())
  await screenshotSettled(win, { path: path.join(shots, '05-resized-connected-node.png') })
  const deselect = await blank()
  await win.mouse.click(deselect.x, deselect.y)
  await expect(resizeNode).not.toHaveClass(/selected/)
  await expectNodeInsideCanvas(win, node(original), 'resized node stays visible after deselection/reprojection')
  await expect.poll(attachedEdges).toEqual([...textIds].sort())
  await screenshotSettled(win, { path: path.join(shots, '06-deselected-resized-node.png') })
  await win.keyboard.press('Meta+z')
  await expect.poll(async () => Math.abs((await resizeNode.boundingBox()).width - beforeResize.width)).toBeLessThan(3)
  await expect.poll(async () => Math.abs((await resizeNode.boundingBox()).height - beforeResize.height)).toBeLessThan(3)
  await expect.poll(attachedEdges).toEqual([...textIds].sort())
  console.log('PASS: real resize updates both edge endpoints, survives deselection and undoes once')
  await win.keyboard.press('Meta+z')
  if (liftedAwayFromDock) await win.keyboard.press('Meta+z') // 走查自己为躲开底部加节点条做的那一次上移，也在撤销栈里
  await expectAbsent(win.locator('.generation-canvas-v2__edge'), { provenBy: edgeProof })
  console.log('PASS: reverse body drop also previews ×2 and undoes once')
} catch (error) {
  await win.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await app.close()
}
