import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import { expect } from '../../ux/_assert.mjs'
import { canvasFitViewButton, canvasSetZoomPercent } from '../../ux/_shell.mjs'
import { waitForCanvasViewportSettled } from '../../ux/_canvasHit.mjs'

export const IDLE_K = 12
// Reserved measurement only: a future approved spinner must use the same draw/animation census.
// No spinner is mounted or enabled by this repair.
export function pendingMotionCensus() {
  const surfaces = [...document.querySelectorAll('[data-generation-waiting]')]
  const stage = document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect()
  const visible = surfaces.filter(element => {
    const rect = element.getBoundingClientRect()
    return stage && rect.left >= stage.left && rect.right <= stage.right && rect.top >= stage.top && rect.bottom <= stage.bottom
  }).length
  return { waiting: surfaces.length, visible, shaders: document.querySelectorAll('[data-generation-waiting] [data-process-fx]').length,
    minZoom: Math.min(...surfaces.map(element => Number(element.dataset.processZoom))),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    spinners: document.querySelectorAll('[data-generation-waiting] [data-process-spinner]').length,
    animations: [...document.querySelectorAll('[data-generation-waiting]')].flatMap(element => element.getAnimations({ subtree: true })).length }
}

const positions = []
for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) positions.push({ x: x * 360, y: y * 230 })
positions.sort((a, b) => Math.max(Math.abs(a.x / 360), Math.abs(a.y / 230)) - Math.max(Math.abs(b.x / 360), Math.abs(b.y / 230)) || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))

export function assertGenerationIdleWindow() {
  if (process.platform !== 'darwin') return { platform: process.platform }
  const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
  const front = execFileSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' }).trim()
  const hid = execFileSync('ioreg', ['-c', 'IOHIDSystem'], { encoding: 'utf8' })
  const idleSeconds = Math.floor(Number(/"HIDIdleTime"\s*=\s*(\d+)/.exec(hid)?.[1] ?? 0) / 1e9)
  const load = os.loadavg()
  const facts = { front, idleSeconds, load1: load[0], load5: load[1] }
  if (load[1] >= 10 || (/Claude/i.test(front) && idleSeconds < 600)) throw new Error(`quiet window unavailable: ${JSON.stringify(facts)}`)
  console.log('GENERATION_IDLE_WINDOW', JSON.stringify(facts))
  return facts
}

export async function prepareGenerationIdle({ fixture, root, repoRoot }) {
  assertGenerationIdleWindow()
  const { createProcessFixture } = await import('../../ux/process-feedback-real-fixture.mjs')
  const settingsDir = path.join(root, 'settings')
  const provider = await createProcessFixture(repoRoot, settingsDir)
  const nodes = fixture.record.payload.generationCanvas.nodes
  nodes.forEach((node, index) => { node.position = positions[index + IDLE_K]; node.size = { width: 320, height: 180 } })
  for (const name of ['project.json', 'project.backup.json']) fs.writeFileSync(path.join(fixture.projectRoot, '.nomi', name), JSON.stringify(fixture.record))
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
  const productionBundle = path.join(root, 'idle-production.cjs')
  await build({ entryPoints: [path.join(repoRoot, 'tests/perf/canvas-scale/productionIdleFixture.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', banner: { js: `module.paths.unshift(${JSON.stringify(path.join(repoRoot, 'node_modules'))});` }, outfile: productionBundle })
  return { provider, productionBundle, root, launch: { settingsDir,
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs'), path.join(repoRoot, 'tests/perf/canvas-scale/generationIdleMain.cjs')],
    env: { NOMI_TEST_NETWORK_GUARD: '1' } }, close: () => provider.close() }
}

export async function ensureGenerationIdle(page, ctx) {
  if (ctx.state.idleIds) return ctx.state.idleIds
  const ids = []
  for (let index = 0; index < IDLE_K; index++) {
    const id = await page.evaluate(({ position, index }) => {
      const store = window.__nomiCanvasStore.getState()
      const node = store.addNode({ kind: 'video', categoryId: 'shots', title: `Waiting ${index + 1}`, prompt: `Local pending task ${index + 1}`, position, exactPosition: true,
        size: { width: 320, height: 180 }, meta: { modelVendor: 'agent-runtime-loopback', modelKey: 'pf-video', previewHeight: 180 } })
      store.selectNode(node.id)
      return node.id
    }, { position: positions[index], index })
    ids.push(id)
    await page.locator('[data-composer-host="canvas"] [data-bar-segment="generate"]').first().click()
    await expect.poll(() => ctx.extras.provider.jobs.length, { timeout: 30_000 }).toBe(index + 1)
  }
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__nomiCanvasStore.getState().clearSelection())
  await canvasFitViewButton(page).click()
  await waitForCanvasViewportSettled(page)
  await canvasSetZoomPercent(page, 60)
  await expect.poll(() => page.locator('[data-generation-waiting]').count()).toBe(IDLE_K)
  await expect.poll(() => page.evaluate(ids => ids.every(id => {
    const node = window.__nomiCanvasStore.getState().nodes.find(node => node.id === id)
    return Boolean(node?.runs?.[0]?.taskId)
  }), ids)).toBe(true)
  await ctx.app.evaluate(async (_electron, { bundle, root }) => {
    globalThis.__generationIdleProduction = await globalThis.__startGenerationIdleProduction(bundle, root)
  }, { bundle: ctx.extras.productionBundle, root: path.join(ctx.extras.root, 'durable-poll') })
  // Wait for the initial durable identity to reach the real project file before opening the idle window.
  await expect.poll(() => {
    const record = JSON.parse(fs.readFileSync(path.join(ctx.fixture.projectRoot, '.nomi/project.json'), 'utf8'))
    return ids.filter(id => record.payload.generationCanvas.nodes.find(node => node.id === id)?.runs?.[0]?.taskId).length
  }, { timeout: 30_000 }).toBe(IDLE_K)
  // Initial provider acceptance/first-poll transitions are durable facts, outside pure pending.
  await expect.poll(() => ctx.extras.provider.jobs.filter(job => job.queries >= 2).length, { timeout: 30_000 }).toBe(IDLE_K)
  ctx.state.idleIds = ids
  return ids
}

export async function generationIdle(page, ctx) {
  try {
    await ensureGenerationIdle(page, ctx)
  } catch (error) {
    if (process.env.GENERATION_IDLE_RAW_OUT) {
      const dir = process.env.GENERATION_IDLE_RAW_OUT
      fs.mkdirSync(dir, { recursive: true })
      const setup = await page.evaluate(() => ({
        nodes: window.__nomiCanvasStore.getState().nodes.map(node => ({ id: node.id, title: node.title, status: node.status, position: node.position, progress: node.progress, runs: node.runs })),
        viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
        waiting: document.querySelectorAll('[data-generation-waiting]').length,
        mounted: document.querySelectorAll('.react-flow__node').length,
      }))
      fs.writeFileSync(path.join(dir, 'setup-failure.json'), JSON.stringify({ error: String(error?.stack || error), jobs: ctx.extras.provider.jobs, ...setup }, null, 2))
      await page.screenshot({ path: path.join(dir, 'setup-failure.png') })
    }
    throw error
  }
  await canvasSetZoomPercent(page, 60)
  await expect(page.locator('[data-generation-waiting]')).toHaveCount(IDLE_K)
  await expect.poll(() => page.locator('[data-generation-waiting]').evaluateAll(elements => elements.every(element => Number(element.dataset.processZoom) >= 0.59))).toBe(true)
  await page.evaluate(() => {
    if (window.__generationIdleDraw) return
    const state = { count: 0 }
    window.__generationIdleDraw = state
    for (const proto of [CanvasRenderingContext2D.prototype, WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const name of ['drawImage', 'drawArrays', 'drawElements']) {
        const real = proto[name]
        if (real) proto[name] = function (...args) { state.count++; return real.apply(this, args) }
      }
    }
  })
  await expect.poll(() => page.evaluate(pendingMotionCensus).then(census => census.visible)).toBe(IDLE_K)
  if (process.env.NOMI_IDLE_BASELINE === '1') await expect(page.locator('[data-process-fx]')).toHaveCount(IDLE_K)
  const load1AtStart = os.loadavg()[0]
  const began = Date.now()
  const before = await page.evaluate(() => window.__generationIdleDraw.count)
  const mainBefore = await ctx.app.evaluate(() => ({ saves: globalThis.__generationIdleMain.saves.length, snapshots: globalThis.__generationIdleMain.snapshots.length, ...globalThis.__generationIdleProduction.stats() }))
  const supplierQueries = ctx.extras.provider.jobs.reduce((sum, job) => sum + job.queries, 0)
  await ctx.startWindow(page)
  let saves30 = null
  while (Date.now() - began < 60_000) {
    await ctx.app.evaluate(async () => { await globalThis.__generationIdleProduction.poll() })
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000))) // measured pending interval
    if (saves30 === null && Date.now() - began >= 30_000) saves30 = await ctx.app.evaluate((_electron, before) => globalThis.__generationIdleMain.saves.length - before, mainBefore.saves)
  }
  const raw = await ctx.stopWindow(page)
  const after = await page.evaluate(() => window.__generationIdleDraw.count)
  const mainAfter = await ctx.app.evaluate(() => ({ saves: globalThis.__generationIdleMain.saves.length, snapshots: globalThis.__generationIdleMain.snapshots.length, ...globalThis.__generationIdleProduction.stats() }))
  const snapshotEvents = await ctx.app.evaluate((_electron, start) => globalThis.__generationIdleMain.snapshots.slice(start), mainBefore.snapshots)
  const snapshotInitialization = await ctx.app.evaluate((_electron, end) => globalThis.__generationIdleMain.snapshots.slice(0, end), mainBefore.snapshots)
  const census = await page.evaluate(pendingMotionCensus)
  const p95 = raw.gaps.slice().sort((a, b) => a - b)[Math.ceil(raw.gaps.length * 0.95) - 1]
  const metrics = { idleDraws: after - before, idleSaveIPC30: saves30, idleSnapshotWrites: mainAfter.snapshots - mainBefore.snapshots,
    idleQueries: mainAfter.queries - mainBefore.queries, supplierQueries: ctx.extras.provider.jobs.reduce((sum, job) => sum + job.queries, 0) - supplierQueries,
    idleSeconds: (Date.now() - began) / 1000, ...census }
  const sample = { ...metrics, p95, load1AtStart, scale: ctx.fixture.summary.scale, runIndex: ctx.runIndex, mainBefore, mainAfter, snapshotEvents, snapshotInitialization }
  if (process.env.GENERATION_IDLE_RAW_OUT) {
    fs.mkdirSync(process.env.GENERATION_IDLE_RAW_OUT, { recursive: true })
    fs.writeFileSync(path.join(process.env.GENERATION_IDLE_RAW_OUT, `${sample.scale}-${sample.runIndex}.json`), JSON.stringify(sample, null, 2))
  }
  console.log('GENERATION_IDLE', JSON.stringify({ ...sample, snapshotEvents: snapshotEvents.length, snapshotInitialization: snapshotInitialization.length }))
  expect(metrics.waiting).toBe(IDLE_K)
  expect(metrics.visible).toBe(IDLE_K)
  expect(metrics.supplierQueries).toBeGreaterThan(0)
  expect(metrics.idleQueries).toBeGreaterThan(1)
  if (process.env.NOMI_IDLE_BASELINE !== '1') {
    expect(metrics.idleDraws).toBe(0)
    expect(metrics.idleSaveIPC30).toBe(0)
    expect(metrics.idleSnapshotWrites).toBe(0)
    expect(p95).toBeLessThanOrEqual(33)
  }
  return { raw, ...metrics, generating: IDLE_K, path: '12 loopback video tasks + real durable poll fixture, 60s pending' }
}
