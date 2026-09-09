import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
const origin = 'http://127.0.0.1:5199'
const out = path.resolve('docs/plan/shot-nodes-evidence')
const app = await launchNomiApp({ name: 'shot-nodes-layout', settleMs: 0, env: { VITE_DEV_SERVER_URL: origin } })
try {
  const page = app.win
  await page.goto(`${origin}/design-lab.html?screen=canvas-frame&frame=1&state=canvas-frame-shot-label-outside`)
  await expect(page.locator('[data-label-stage]')).toBeVisible()
  await page.locator('[data-label-stage] > div').evaluate(el => { el.style.left = '400px' })
  const results = []
  for (const selected of [false, true]) for (const status of ['queued', 'running', 'success', 'error']) {
    await page.evaluate(async ({ selected, status }) => {
      const { setShotLabelFixture } = await import('/src/devlab/designLab/canvasFrame/shotLabelFixture.ts')
      setShotLabelFixture({ kind: 'image', zoom: 1, selected, details: true, nodePatch: { status,
        progress: status === 'running' ? { phase: 'generating', updatedAt: Date.now() - 12000 } : undefined,
        error: status === 'error' ? 'TheProviderReturnedAnUnrecognizedErrorWithAVeryLongUnbrokenIdentifierThatMustRemainReadableAndMustNotCrossTheNodeBoundary' : undefined,
      } })
    }, { selected, status })
    const node = page.locator('[data-node-id="label-shot"]')
    await expect(node).toHaveAttribute('data-status', status)
    await expect(node.locator('[data-generation-message]').first()).toBeVisible()
    if (selected) await expect(node.locator('[role="toolbar"]')).toBeVisible()
    const geometry = await node.evaluate(el => {
      const rect = el.getBoundingClientRect().toJSON()
      const label = el.querySelector('[data-node-label-row]').getBoundingClientRect().toJSON()
      const status = el.querySelector('[data-node-inline-status]').getBoundingClientRect().toJSON()
      const toolbar = el.querySelector('[role="toolbar"]')?.getBoundingClientRect().toJSON()
      const messages = [...el.querySelectorAll('[data-generation-message]')].map(message => message.getBoundingClientRect().toJSON())
      return { rect, label, status, toolbar, messages }
    })
    expect(geometry.label.bottom).toBeLessThanOrEqual(geometry.rect.top)
    if (geometry.toolbar) expect(geometry.toolbar.bottom).toBeLessThanOrEqual(geometry.status.top)
    expect(geometry.status.bottom).toBeLessThanOrEqual(geometry.label.top)
    for (const message of geometry.messages) {
      expect(message.left).toBeGreaterThanOrEqual(geometry.rect.left)
      expect(message.right).toBeLessThanOrEqual(geometry.rect.right + 1)
    }
    results.push({ selected, status, ...geometry })
    await screenshotSettled(page, { path: path.join(out, `layout-${selected ? 'selected' : 'unselected'}-${status}.png`) })
  }
  fs.writeFileSync(path.join(out, 'layout-geometry.json'), JSON.stringify(results, null, 2))
} finally { await app.close() }
