// Real Electron: hover without selection, single and batch drops into the outer hot zone.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidence = path.join(root, 'docs/plan/canvas-magnetic-handle-evidence')
const phase = process.argv.includes('--batch-red') ? 'batch-red' : process.argv.includes('--red') ? 'red' : 'green'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-magnetic-'))
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'S', projectName: '磁吸连线验收' })
const images = fixture.record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image').slice(0, 3)
images.forEach((node, index) => {
  node.position = { x: index === 2 ? 650 : 130, y: index === 1 ? 430 : 100 }
  node.title = ['参考图一', '参考图二', '目标图片'][index]
  node.size = { width: 240, height: 180 }
  node.meta = { ...node.meta, previewHeight: 180, userResized: true }
})
fixture.record.payload.generationCanvas = { nodes: images, edges: [], groups: [], selectedNodeIds: [] }
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))
fs.mkdirSync(evidence, { recursive: true })
const results = []
const { app, win: first } = await launchNomiApp({ name: 'canvas-magnetic-handle', projectsDir: fixture.projectsDir, syntheticCredentialStorage: true, settleMs: 0 })
let win = first
const selector = (id) => `.react-flow__node[data-id="${id}"]`
const handle = (id, type, side) => win.locator(`${selector(id)} .react-flow__handle[data-handleid="${type}-${side}"]`)
async function blank() {
  const point = await findCanvasBlankPoint(win, { preference: 'bottom' })
  expect(point, 'real RF pane point').not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await waitForVisualQuiescence(win)
}
async function hotPoint(id, side) {
  const box = await win.locator(selector(id)).boundingBox()
  expect(box).not.toBeNull()
  const point = { x: side === 'left' ? box.x - 60 : box.x + box.width + 60, y: box.y + box.height / 2 }
  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  expect(point.x).toBeGreaterThan(stage.x)
  expect(point.x).toBeLessThan(stage.x + stage.width)
  return point
}
async function select(id, append = false) {
  await waitForVisualQuiescence(win)
  let point
  await expect.poll(async () => {
    point = await findNodeHitPoint(win, { nodeSelector: selector(id) })
    return point !== null
  }, { message: `node ${id} is actually hittable after layout/undo` }).toBe(true)
  if (append) await win.keyboard.down('Shift')
  await win.mouse.click(point.x, point.y)
  if (append) await win.keyboard.up('Shift')
  await expect(win.locator(selector(id))).toHaveClass(/selected/)
  await waitForVisualQuiescence(win)
}
async function edgesTouchingSide(id, side) {
  return win.evaluate(({ id, side }) => {
    const box = document.querySelector(`.react-flow__node[data-id="${id}"]`).getBoundingClientRect()
    const x = side === 'left' ? box.left : box.right
    const y = box.top + box.height / 2
    return Array.from(document.querySelectorAll('.react-flow__edge .react-flow__edge-path')).filter((edge) => {
      const matrix = edge.getScreenCTM()
      return [0, edge.getTotalLength()].some((length) => {
        const end = edge.getPointAtLength(length)
        const p = new DOMPoint(end.x, end.y).matrixTransform(matrix)
        return Math.hypot(p.x - x, p.y - y) < 3
      })
    }).length
  }, { id, side })
}
async function endpoint() {
  return win.locator('.react-flow__connection-path').evaluate((path) => {
    const end = path.getPointAtLength(path.getTotalLength())
    const p = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM())
    return { x: p.x, y: p.y }
  })
}
async function expectSnapped(id, side, point) {
  const box = await win.locator(selector(id)).boundingBox()
  const anchor = { x: side === 'left' ? box.x : box.x + box.width, y: box.y + box.height / 2 }
  const distance = async (target) => { const p = await endpoint(); return Math.hypot(p.x - target.x, p.y - target.y) }
  await expect.poll(() => distance(anchor)).toBeLessThan(3)
  // Leaving the rectangular hot zone releases both the endpoint and its highlight.
  const outside = { x: point.x, y: point.y - 110 }
  await win.mouse.move(outside.x, outside.y, { steps: 8 })
  await expect(handle(id, 'target', side)).not.toHaveAttribute('data-active', 'true')
  await expect.poll(() => distance(outside)).toBeLessThan(3)
  await win.mouse.move(point.x, point.y, { steps: 8 })
  await expect(handle(id, 'target', side)).toHaveAttribute('data-active', 'true')
  await expect.poll(() => distance(anchor)).toBeLessThan(3)
}
async function snap(name) { await screenshotSettled(win, { path: path.join(evidence, `${phase}-${name}.png`) }) }
async function task(name, run) {
  try { await run(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }); await win.screenshot({ path: path.join(evidence, `${phase}-${name}-failure.png`) }); await win.mouse.up(); await win.keyboard.press('Escape') }
  console.log(JSON.stringify(results.at(-1)))
}
try {
  await app.context().addInitScript(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi:splash:v1', 'seen')
    localStorage.setItem('nomi:journey-tour:v1', 'seen')
  })
  await win.reload() // library only, before opening a project
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url()))).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  const bw = await app.browserWindow(win)
  await bw.evaluate((window) => {
    window.setBounds({ x: 0, y: 0, width: 1800, height: 1100 })
    // Ignore unrelated physical cursor motion on this shared desktop; CDP still drives real input.
    window.setIgnoreMouseEvents(true)
  })
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node')).toHaveCount(3)
  await select(images[0].id)
  const selectedProof = await proveProbe(win.locator('.react-flow__node.selected'), 'selected node is observable')
  await blank()
  await expectAbsent(win.locator('.react-flow__node.selected'), { provenBy: selectedProof })
  await task('01-hover', async () => {
    const point = await hotPoint(images[0].id, 'left')
    await win.mouse.move(point.x, point.y)
    const icon = handle(images[0].id, 'source', 'left').locator('.generation-canvas-react-flow__handle-icon')
    await expect(icon).toHaveCSS('opacity', '1')
    await expect(icon.locator('svg')).toHaveCount(1)
    await snap('01-hover')
  })
  await task('02-single', async () => {
    await blank()
    // Select here so target snapping is tested independently of the hover regression.
    await select(images[1].id)
    const from = await hotPoint(images[1].id, 'left')
    const to = await hotPoint(images[0].id, 'right')
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(to.x, to.y, { steps: 24 })
    await expect(handle(images[0].id, 'target', 'right')).toHaveAttribute('data-active', 'true')
    await expectSnapped(images[0].id, 'right', to)
    await snap('02-single')
    const before = await win.locator('.react-flow__edge').count()
    await win.mouse.up()
    await expect(win.locator('.react-flow__edge')).toHaveCount(before + 1)
    await expect.poll(() => edgesTouchingSide(images[0].id, 'right')).toBe(1)
  })
  await task('03-batch', async () => {
    await blank()
    await select(images[0].id)
    await select(images[1].id, true)
    await expect(win.locator('.react-flow__node.selected')).toHaveCount(2)
    const from = await hotPoint(images[0].id, 'right')
    const to = await hotPoint(images[2].id, 'left')
    await win.mouse.move(from.x, from.y)
    await win.mouse.down()
    await win.mouse.move(to.x, to.y, { steps: 24 })
    await expect(handle(images[2].id, 'target', 'left')).toHaveAttribute('data-active', 'true')
    await expect(win.locator('[data-batch-connection-count="2"]')).toBeVisible()
    await expectSnapped(images[2].id, 'left', to)
    await snap('03-batch')
    const before = await win.locator('.react-flow__edge').count()
    await win.mouse.up()
    await expect(win.locator('.react-flow__edge')).toHaveCount(before + 2)
    await expect.poll(() => edgesTouchingSide(images[2].id, 'left')).toBe(2)
  })
} finally {
  fs.writeFileSync(path.join(evidence, `${phase}-results.json`), JSON.stringify(results, null, 2))
  await app.close()
}
if (results.length !== 3 || results.some((result) => !result.pass)) process.exitCode = 1
