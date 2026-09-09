import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { measureMediaBadgeContrast } from './_feel.mjs'
import { expect, screenshotSettled } from './_assert.mjs'

const phase = process.env.SHOT_NODES_PHASE || 'after'
const origin = 'http://127.0.0.1:5199'
const out = path.resolve('docs/plan/shot-nodes-evidence')
fs.mkdirSync(out, { recursive: true })
const app = await launchNomiApp({ name: 'shot-nodes-badges', settleMs: 0, env: { VITE_DEV_SERVER_URL: origin } })
try {
  const page = app.win
  await page.goto(`${origin}/design-lab.html?screen=canvas-frame&frame=1&state=canvas-frame-shot-label-outside`)
  await expect(page.locator('[data-label-stage]')).toBeVisible()
  await page.evaluate(async () => {
    const { setShotLabelFixture } = await import('/src/devlab/designLab/canvasFrame/shotLabelFixture.ts')
    setShotLabelFixture({ kind: 'image', zoom: 1, selected: false, details: true, nodePatch: { status: 'success', progress: undefined, title: '雨夜街口' } })
  })
  await expect(page.locator('[data-node-id=label-shot]')).toHaveAttribute('data-status', 'success')
  await expect(page.locator('[data-node-media-state]')).toHaveAttribute('data-node-media-state', 'ready')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.setAttribute('data-mantine-color-scheme', theme); localStorage.setItem('nomi-color-scheme', theme) }, theme)
    await expect(page.locator('[data-shot-number]')).toBeVisible()
    await expect(page.locator('[data-node-mount-badges]')).toContainText('阿青')
    await screenshotSettled(page, { path: path.join(out, `${phase}-badges-${theme}.png`) })
    if (phase === 'after') {
      const contrast = await measureMediaBadgeContrast(page.locator('[data-shot-number], [data-node-mount-badges] > span'))
      expect(contrast.violations).toEqual([])
      fs.writeFileSync(path.join(out, `after-badges-contrast-${theme}.json`), JSON.stringify(contrast, null, 2))
    }
    const metrics = await page.locator('[data-node-label-row]').evaluate(el => ({ text: el.innerText, children: [...el.children].map(child => ({ text: child.textContent, color: getComputedStyle(child).color, background: getComputedStyle(child).backgroundColor, rect: child.getBoundingClientRect().toJSON() })) }))
    fs.writeFileSync(path.join(out, `${phase}-badges-${theme}.json`), JSON.stringify(metrics, null, 2))
  }
} finally { await app.close() }
