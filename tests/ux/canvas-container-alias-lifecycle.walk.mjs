// Real Electron regression: compatibility aliases belong to the canvas root
// lifecycle; media/card subtree changes must not rescan the entire canvas.
import fs from 'node:fs'
import path from 'node:path'
import { launchCoreSmoke } from './core-smoke/fixture.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'

const output = path.resolve('outputs/canvas-container-alias-lifecycle', process.argv[2] || 'run')
fs.mkdirSync(output, { recursive: true })
const smoke = await launchCoreSmoke({ name: 'canvas-container-alias-lifecycle', seed: ({ imageResult, imageMeta }) => ({
  nodes: ['a', 'b'].map((id, index) => ({ id, kind: 'image', categoryId: 'shots', title: id, prompt: '', position: { x: 100 + index * 400, y: 100 + index * 180 }, size: { width: 240, height: 135 }, status: 'success', result: imageResult(id, 1), history: [], references: [], runs: [], meta: imageMeta() })),
  edges: [{ id: 'edge-ab', source: 'a', target: 'b', mode: 'reference' }], groups: [],
}) })
const report = { checks: [] }
try {
  const page = await smoke.openProject()
  await page.locator('.generation-canvas-v2__stage[data-ready="true"]').waitFor()
  await page.locator('.react-flow__edge[data-id="edge-ab"] .generation-canvas-v2__edge-hit').waitFor({ state: 'attached' })
  const hitLayers = await page.locator('.react-flow__edge[data-id="edge-ab"]').evaluate(edge => ({
    framework: edge.querySelectorAll('.react-flow__edge-interaction').length,
    accessible: edge.querySelectorAll('.generation-canvas-v2__edge-hit[role="button"][tabindex="0"]').length,
  }))
  report.hitLayers = hitLayers
  const result = await page.evaluate(async () => {
    const host = document.querySelector('.generation-canvas-v2__stage')
    const pairs = [
      ['.react-flow__viewport', 'generation-canvas-v2__canvas'],
      ['.react-flow__edges', 'generation-canvas-v2__edges'],
      ['.react-flow__nodes', 'generation-canvas-v2__nodes'],
    ]
    const initial = pairs.map(([selector, alias]) => host.querySelector(selector)?.classList.contains(alias))
    const query = host.querySelector.bind(host)
    let scans = 0
    host.querySelector = selector => { if (pairs.some(([candidate]) => candidate === selector)) scans++; return query(selector) }
    window.__nomiCanvasAliasProbe = { read: () => scans, restore: () => { host.querySelector = query } }
      // A real DOM mutation is the smallest trigger for the old subtree observer.
      // No framework/store stubs: the loaded production host owns this lifecycle.
      const probe = document.createElement('span')
      probe.dataset.aliasLifecycleProbe = 'true'
      query('.react-flow__nodes').append(probe)
      await new Promise(resolve => requestAnimationFrame(resolve))
      probe.remove()
      await new Promise(resolve => requestAnimationFrame(resolve))
      return { initial, scans, retained: pairs.map(([selector, alias]) => query(selector)?.classList.contains(alias)) }
  })
  report.checks.push(result)
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  expect(hitLayers.framework + hitLayers.accessible).toBe(1)
  expect(hitLayers.accessible).toBe(1)
  expect(result.initial).toEqual([true, true, true])
  expect(result.retained).toEqual([true, true, true])
  expect(result.scans).toBe(0)
  const edge = page.locator('.react-flow__edge[data-id="edge-ab"]')
  const edgeProof = await proveProbe(edge, 'the connected reference edge exists before disconnect')
  await page.locator('.generation-canvas-v2__edge[data-edge-id="edge-ab"] .generation-canvas-v2__edge-hit').press('Enter')
  await expect(page.locator('.generation-canvas-v2__edge[data-edge-id="edge-ab"]')).toHaveAttribute('data-active', 'true')
  await page.locator('[data-edge-disconnect]').click()
  await expectAbsent(edge, { provenBy: edgeProof })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await edge.waitFor({ state: 'attached' })
  const afterInteraction = await page.evaluate(() => {
    const result = { scans: window.__nomiCanvasAliasProbe.read(),
      aliases: ['.react-flow__viewport.generation-canvas-v2__canvas', '.react-flow__edges.generation-canvas-v2__edges', '.react-flow__nodes.generation-canvas-v2__nodes'].map(selector => Boolean(document.querySelector(selector))) }
    window.__nomiCanvasAliasProbe.restore()
    return result
  })
  expect(afterInteraction.scans).toBe(0)
  expect(afterInteraction.aliases).toEqual([true, true, true])
  report.checks.push({ keyboardSelect: true, clickDisconnect: true, undoRestore: true, ...afterInteraction })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await smoke.close() }
