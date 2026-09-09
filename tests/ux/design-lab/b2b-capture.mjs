// B2b specimen evidence only; never records or updates the baseline tree.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const output = path.resolve('docs/design/2026-09-09-agent-process-state-and-panel-frame')
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const receipt = { viewport: { width: 1600, height: 1000 }, screenshots: [], checks: [] }
try {
  for (const id of ['process-running', 'process-done', 'process-failed', 'panel-narrow', 'panel-wide', 'frames-unified', 'logo-audit']) {
    const context = await browser.newContext({ viewport: receipt.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:5197/design-lab.html?screen=agent-panel-v4&state=b2b-${id}&frame=1`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const shot = page.locator(`[data-design-lab-shot="b2b-${id}"]`)
    await shot.waitFor({ state: 'visible' })
    const capture = async name => { await shot.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' }); receipt.screenshots.push(name) }
    if (id === 'process-running') {
      const positions = []
      for (const step of [0, 1, 6]) {
        await page.locator(`[data-b2b-step="${step}"]`).click()
        positions.push(await page.locator('[data-b2b-active]').boundingBox())
        assert.equal(await page.locator('[data-b2b-process]').count(), 1)
        assert.equal(await page.locator('[data-b2b-details]').isVisible(), false)
        await capture(`process-running-${step}`)
      }
      assert.equal(positions[0].y, positions[2].y)
      receipt.checks.push('running: one process row; previous steps hidden; same y across all 3 steps')
    }
    await capture(id)
    if (id === 'process-done') {
      assert.equal(await page.locator('[data-b2b-details]').isVisible(), false)
      await page.locator('[data-b2b-process] > summary').click()
      assert.equal(await page.locator('[data-b2b-details] [data-v4-block="tool"]').count(), 7)
      assert.equal(await page.locator('[data-v4-block="assistant"]').isVisible(), true)
      await capture('process-done-expanded')
      receipt.checks.push('done: summary collapsed by default, expands to 7 receipts; answer remains visible')
    }
    if (id === 'process-failed') {
      assert.equal(await page.locator('[data-b2b-failure]').isVisible(), true)
      assert.equal(await page.locator('[data-b2b-details]').isVisible(), false)
      receipt.checks.push('failed: separate visible failure card; ordinary process remains collapsed')
    }
    if (id === 'panel-narrow') {
      const handle = page.getByRole('separator')
      const box = await handle.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x - 500, box.y + box.height / 2, { steps: 10 })
      await page.mouse.up()
      assert.equal(await handle.getAttribute('aria-valuenow'), '600')
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(await handle.getAttribute('aria-valuenow'), '600')
      await handle.focus()
      for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
      assert.equal(await handle.getAttribute('aria-valuenow'), '300')
      receipt.checks.push('resize: pointer drag clamps at 600; reload restores 600; keyboard clamps at 300')
    }
    if (id === 'frames-unified') {
      const frames = await page.locator('[data-b2b-panel]').evaluateAll(nodes => nodes.map(node => { const b = node.getBoundingClientRect(); const css = getComputedStyle(node); return { y: b.y, height: b.height, radius: css.borderRadius } }))
      assert.equal(new Set(frames.map(x => JSON.stringify(x))).size, 1)
      receipt.frames = frames
    }
    if (id === 'logo-audit') receipt.brand = await page.locator('.nomi-brand').evaluateAll(nodes => nodes.map(node => { const word = node.querySelector('.nomi-wordmark'); const css = getComputedStyle(word); return { gap: getComputedStyle(node).gap, font: css.fontFamily, weight: css.fontWeight, tracking: css.letterSpacing, radius: node.querySelector('rect')?.getAttribute('rx') } }))
    if (id === 'logo-audit') {
      const cdp = await context.newCDPSession(page)
      await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
      const root = await cdp.send('DOM.getDocument')
      const nodes = await cdp.send('DOM.querySelectorAll', { nodeId: root.root.nodeId, selector: '.nomi-wordmark' })
      receipt.renderedBrandFonts = []
      for (const nodeId of nodes.nodeIds) receipt.renderedBrandFonts.push(await cdp.send('CSS.getPlatformFontsForNode', { nodeId }))
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
  fs.writeFileSync(path.join(output, 'capture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
} finally { await browser.close() }
