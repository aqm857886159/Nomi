import { expect, expectAbsent, proveProbe } from '../_assert.mjs'
import { tsImport } from 'tsx/esm/api'
import { canvasFitViewButton } from '../_shell.mjs'

const { readProcessMotionCapability, shouldReduceProcessMotion } = await tsImport(
  '../../../src/workbench/generationCanvas/nodes/processMotionCapability.ts', import.meta.url,
)

const WAITING_NODE_COUNT = Number(process.env.NOMI_WAITING_EFFECTS_NODES || 8)
if (![8, 16, 32].includes(WAITING_NODE_COUNT)) throw new Error('NOMI_WAITING_EFFECTS_NODES must be 8, 16 or 32')

async function expectedEffects(page, visibleCount) {
  const capability = await page.evaluate(readProcessMotionCapability)
  const effectCount = shouldReduceProcessMotion(capability) ? 0 : visibleCount
  console.log('WAITING_FX_CAPABILITY', JSON.stringify({ ...capability, effectCount }))
  return effectCount
}

export async function prepareWaitingFx(page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__nomiCanvasStore))).toBe(true)
  await page.evaluate(count => {
    const store = window.__nomiCanvasStore
    const template = store.getState().nodes.find(node => node.kind === 'image')
    if (!template) throw new Error('Waiting performance fixture requires a real image node')
    const now = Date.now()
    const nodes = Array.from({ length: count }, (_, index) => ({
      ...template, id: `waiting-perf-${index}`, kind: 'image', title: `Waiting ${index + 1}`, shotIndex: index + 1, status: 'running', result: undefined, results: [],
      position: { x: 60 + (index % 4) * 290, y: 40 + Math.floor(index / 4) * 230 }, size: { width: 260, height: 180 },
      progress: { phase: 'generating', updatedAt: now },
      runs: [{ id: `waiting-run-${index}`, status: 'running', startedAt: now, updatedAt: now }],
    }))
    store.setState({ nodes, edges: [], groups: [], selectedNodeIds: [] })
  }, WAITING_NODE_COUNT)
  // Native window bounds may be clamped by the display (e.g. Linux Xvfb).
  // Fit the selected visible-node workload before React Flow culls offscreen nodes.
  await canvasFitViewButton(page).click()
  await expect.poll(() => page.evaluate(count => {
    const stage = document.querySelector('.generation-canvas-v2__stage').getBoundingClientRect()
    const nodes = [...document.querySelectorAll('article[data-node-id]')]
    return nodes.length === count && nodes.every(node => {
      const rect = node.getBoundingClientRect()
      return rect.left >= stage.left && rect.right <= stage.right
        && rect.top >= stage.top && rect.bottom <= stage.bottom
    })
  }, WAITING_NODE_COUNT), { message: 'All waiting nodes must be inside the actual canvas viewport' }).toBe(true)
  await expect(page.locator('[data-generation-waiting]')).toHaveCount(WAITING_NODE_COUNT)
  await expect.poll(() => page.locator('[data-generation-waiting]').evaluateAll(surfaces =>
    surfaces.every(surface => Number(surface.dataset.processZoom) >= 0.4)),
  { message: 'The waiting workload must retain effect-eligible zoom' }).toBe(true)
  const effectCount = await expectedEffects(page, WAITING_NODE_COUNT)
  await expect(page.locator('[data-process-fx]')).toHaveCount(effectCount)
  await expect(page.locator('[data-process-static-grid]')).toHaveCount(WAITING_NODE_COUNT - effectCount)
  console.log('WAITING_FX_READY', JSON.stringify(await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    nodes: document.querySelectorAll('article[data-node-id]').length,
    effectCount: document.querySelectorAll('[data-process-fx]').length,
    staticCount: document.querySelectorAll('[data-process-static-grid]').length,
  }))))
  await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    const frame = () => { if (++frames >= 60) resolve(); else requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  }))
}

export async function sampleWaitingFx(page) {
  const effectCount = await page.locator('[data-process-fx]').count()
  const staticCount = await page.locator('[data-process-static-grid]').count()
  await page.evaluate(() => new Promise(resolve => {
    const started = performance.now()
    const frame = () => { if (performance.now() - started >= 30000) resolve(); else requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
  }))
  return { effectCount, staticCount }
}

export async function cleanupWaitingFx(page) {
  const waitingProof = await proveProbe(page.locator('[data-generation-waiting]'), '性能窗口有真实等待层')
  const effectCount = await expectedEffects(page, WAITING_NODE_COUNT - 4)
  const owners = await page.locator(effectCount
    ? 'article[data-node-id]:has([data-process-fx])'
    : 'article[data-node-id]:has([data-generation-waiting])').evaluateAll(nodes => nodes.slice(0, 4).map(n => n.dataset.nodeId))
  expect(owners).toHaveLength(4)
  await page.evaluate(ids => {
    for (const id of ids) window.__nomiCanvasStore.getState().setNodeStatus(id, 'error', 'fixture stopped')
  }, owners)
  await expect(page.locator('[data-generation-waiting]')).toHaveCount(WAITING_NODE_COUNT - 4)
  await expect(page.locator('[data-process-fx]')).toHaveCount(effectCount)
  await expect(page.locator('[data-process-static-grid]')).toHaveCount(WAITING_NODE_COUNT - 4 - effectCount)
  console.log('WAITING_FX_HANDOVER', JSON.stringify({ effectCount, staticCount: WAITING_NODE_COUNT - 4 - effectCount }))
  await page.evaluate(() => {
    const store = window.__nomiCanvasStore
    store.setState({ nodes: store.getState().nodes.map(n => ({ ...n, position: { x: n.position.x + 100000, y: n.position.y + 100000 } })) })
  })
  await expect(page.locator('[data-process-fx]')).toHaveCount(0)
  await expect(page.locator('.generation-canvas-v2__stage canvas')).toHaveCount(0)
  await page.evaluate(() => window.__nomiCanvasStore.setState({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }))
  await expectAbsent(page.locator('[data-generation-waiting]'), { provenBy: waitingProof, message: '卸载后等待层持续为空' })
  await expectAbsent(page.locator('.generation-canvas-v2__stage canvas'), { provenBy: waitingProof, message: '卸载后 canvas 持续为零' })
}
