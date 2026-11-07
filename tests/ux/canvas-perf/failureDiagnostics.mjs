import fs from 'node:fs/promises'
import path from 'node:path'

/** Capture before the failed sample's Electron window is closed, for every scenario. */
export async function captureScenarioFailure(page, { directory, id, error }) {
  const stem = path.join(directory, id.replace(/[^a-zA-Z0-9._-]/g, '-'))
  const diagnostics = { message: error?.message ?? String(error), counts: null, captureErrors: [] }
  try {
    await fs.mkdir(directory, { recursive: true })
    diagnostics.counts = await page.evaluate(() => {
      const count = selector => document.querySelectorAll(selector).length
      return {
        viewport: { width: innerWidth, height: innerHeight },
        stage: document.querySelector('.generation-canvas-v2__stage')?.getBoundingClientRect().toJSON(),
        fx: count('[data-process-fx]'),
        fxCanvas: count('[data-process-fx] canvas'),
        staticShells: count('[data-process-static-grid]'),
        waiting: count('[data-generation-waiting]'),
        nodes: count('article[data-node-id]'),
        surfaces: [...document.querySelectorAll('[data-generation-waiting]')].map(surface => ({
          nodeId: surface.closest('[data-node-id]')?.getAttribute('data-node-id'),
          zoom: surface.getAttribute('data-process-zoom'),
          fx: surface.querySelectorAll('[data-process-fx]').length,
          staticShells: surface.querySelectorAll('[data-process-static-grid]').length,
        })),
      }
    })
  } catch (captureError) { diagnostics.captureErrors.push(String(captureError)) }
  try {
    await page.screenshot({ path: `${stem}.png`, timeout: 10_000 })
    diagnostics.screenshot = `${stem}.png`
  } catch (captureError) { diagnostics.captureErrors.push(String(captureError)) }
  try {
    await fs.writeFile(`${stem}.json`, JSON.stringify(diagnostics, null, 2))
  } catch (captureError) { diagnostics.captureErrors.push(String(captureError)) }
  console.error('CANVAS_SCENARIO_FAILURE', JSON.stringify(diagnostics))
  return diagnostics
}
