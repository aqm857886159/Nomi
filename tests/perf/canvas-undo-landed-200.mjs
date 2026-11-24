// Measure the shipped renderer from history dispatch to its next painted frame.
// Account for retained step bytes separately using the same production store.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { require as tsxRequire } from 'tsx/cjs/api'
import { launchNomiApp } from '../ux/_launchApp.mjs'
import { createBlankProject, switchWorkspace } from '../ux/_shell.mjs'

const { values } = parseArgs({ options: { runs: { type: 'string' }, out: { type: 'string' } } })
const runs = Number(values.runs)
assert.ok(Number.isInteger(runs) && runs > 0 && values.out)
const { useGenerationCanvasStore } = tsxRequire('../../src/workbench/generationCanvas/store/generationCanvasStore.ts', import.meta.url)
const { inspectCanvasPatchHistory } = tsxRequire('../../src/workbench/generationCanvas/events/canvasPatchHistory.ts', import.meta.url)
const count = 200
const nodes = Array.from({ length: count }, (_, i) => ({
  id: 'shot-' + i, kind: 'image', title: 'Shot ' + i, categoryId: 'shots',
  position: { x: (i % 20) * 400, y: Math.floor(i / 20) * 300 },
}))
const bytes = value => Buffer.byteLength(JSON.stringify(value, (_key, item) => item instanceof Set ? [...item] : item))
const store = useGenerationCanvasStore.getState()
store.restoreSnapshot({ nodes, edges: [], groups: [] })
let singleMoveBytes = 0
for (let x = 1; x <= count; x++) {
  store.updateNodes(nodes.slice(0, x === 1 ? 1 : 20).map(n => ({ nodeId: n.id, patch: { position: { x: n.position.x + x, y: n.position.y } } })))
  if (x === 1) singleMoveBytes = bytes(inspectCanvasPatchHistory().undo.at(-1))
}
const { undo } = inspectCanvasPatchHistory()
const maxStepBytes = Math.max(...undo.map(bytes))
const retainedBytes = bytes(undo)
assert.equal(undo.length, 80)
assert.ok(singleMoveBytes <= 1024 && maxStepBytes <= 8192 && retainedBytes <= 640 * 1024)
store.restoreSnapshot({ nodes: [], edges: [], groups: [] })
assert.equal(inspectCanvasPatchHistory().indexedNodes, 0)

const { close, projectsDir, win } = await launchNomiApp({ name: 'canvas-undo-landed-200', initialLocalStorage: {
  __nomiE2E: '1', 'nomi:locale:v1': 'en', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
} })
try {
  await createBlankProject(win)
  await switchWorkspace(win, 'generation')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore?.getState().isReady))
  const cdp = await win.context().newCDPSession(win)
  const samples = []
  for (let i = 0; i < runs; i++) {
    const runId = 'bench-run-' + i
    await win.evaluate(async ({ nodes, runId }) => {
      const read = window.__nomiCanvasStore.getState
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      read().restoreSnapshot({ nodes, groups: [], edges: [] }, read().projectId)
      for (let x = 1; x <= 200; x++) {
        read().updateNodes(nodes.slice(0, 20).map(n => ({ nodeId: n.id, patch: { position: { x: n.position.x + x, y: n.position.y } } })))
        if (x % 10 === 0) await frame()
      }
      read().appendNodeRun(nodes[0].id, { id: runId, projectId: read().projectId, startedAt: 1, status: 'running' })
      read().addNodeResult(nodes[0].id, {
        id: 'bench-result', type: 'image', assetId: 'bench-asset', createdAt: 2,
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXiUAAAAASUVORK5CYII=',
      }, { width: 1, height: 1 }, runId)
      await frame()
      await frame()
    }, { nodes, runId })
    // Snapshot writes, image decode and the initial 200-node mount are setup work.
    await win.locator('.react-flow__node[data-id="shot-0"]').waitFor({ state: 'attached' })
    const snapshot = fs.readdirSync(projectsDir).map(dir => path.join(projectsDir, dir, '.nomi', 'project.json')).find(file => fs.existsSync(file))
    assert.ok(snapshot, 'Missing project snapshot')
    const savedLanding = () => JSON.parse(fs.readFileSync(snapshot, 'utf8')).payload.generationCanvas?.nodes?.[0]?.runs?.some(run => run.id === runId && run.status === 'success')
    const deadline = Date.now() + 20000
    while (!savedLanding() && Date.now() < deadline) await delay(100)
    assert.ok(savedLanding(), 'Generation result did not reach the project snapshot')
    await win.evaluate(() => new Promise(resolve => requestIdleCallback(resolve)))
    await cdp.send('HeapProfiler.collectGarbage')
    const sample = await win.evaluate(async runId => {
      const read = window.__nomiCanvasStore.getState
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
      const delays = []
      const sync = []
      const longTaskEntries = []
      const observer = new PerformanceObserver(list => longTaskEntries.push(...list.getEntries()))
      const startMeasurement = performance.now()
      observer.observe({ entryTypes: ['longtask'] })
      try {
        for (const direction of ['undo', 'redo']) {
          for (let step = 1; step <= 80; step++) {
            await frame()
            const start = performance.now()
            read()[direction]()
            sync.push(performance.now() - start)
            await frame()
            delays.push(performance.now() - start)
            const n = read().nodes[0]
            const expected = direction === 'undo' ? 200 - step : 120 + step
            if (n.position.x !== expected || n.result?.assetId !== 'bench-asset' || n.history?.length !== 1
                || n.runs?.[0]?.status !== 'success' || n.runs[0].id !== runId) throw Error('Lost edit or paid result on ' + direction + ' ' + step)
          }
        }
      } finally {
        longTaskEntries.push(...observer.takeRecords())
        observer.disconnect()
      }
      const p95 = values => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
      return { response: p95(delays), projectionMs: p95(sync), longTasks: longTaskEntries.filter(entry => entry.startTime >= startMeasurement).length }
    }, runId)
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    samples.push({ ...sample, heapUsedMiB: heap.usedSize / 1048576 })
  }
  const metrics = Object.fromEntries(Object.keys(samples[0]).map(key => [key, samples.map(sample => sample[key])]))
  console.log(JSON.stringify({ singleMoveBytes, maxStepBytes, retainedBytes, releasedIndexes: inspectCanvasPatchHistory().indexedNodes }))
  fs.writeFileSync(values.out, JSON.stringify({ runs, noisy: false, metrics, singleMoveBytes, maxStepBytes, retainedBytes, retainedSteps: 80, paidCalls: 0 }, null, 2) + '\n')
} finally {
  await close()
}
