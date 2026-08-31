/* global URL, console, document, process */

import { chromium } from 'playwright'

const base = new URL('./index.html', import.meta.url).href
const browser = await chromium.launch({ channel: 'chrome', headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const results = {}
  await page.goto(`${base}#library`)
  await page.locator('[data-capability-id=research]').click()
  results.library = {
    detailUpdated: (await page.locator('#capability-detail').innerText()).includes('研究与证据收集'),
    mediaLoaded: await page
      .locator('img')
      .evaluateAll((images) => images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  }

  await page.locator('[data-view-target="agent"]').click()
  for (const question of ['platform', 'audience', 'tone']) {
    await page.locator(`[data-question=${question}] button`).first().click()
  }
  results.agent = { continueEnabled: await page.locator('#brief-continue').isEnabled() }
  await page.locator('#brief-continue').click()
  results.agent.briefWritten = await page.locator('#brief-output.is-filled').isVisible()
  await page.locator('#preflight-toggle').click()
  results.agent.preflightVisible = await page.locator('#preflight.is-open').isVisible()

  await page.locator('[data-view-target="assets"]').click()
  await page.locator('#show-risks').click()
  results.assets = { initialRiskCards: await page.locator('[data-asset-id]').count() }
  await page.locator('#resolve-rights').click()
  await page.locator('[data-asset-id=table]').click()
  await page.locator('#reference-only').click()
  results.assets.exportEnabled = await page.locator('#export-button').isEnabled()

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
  for (const view of ['library', 'agent', 'assets']) {
    await mobile.goto(`${base}?view=${view}#${view}`)
    results[`mobile_${view}`] = {
      overflow: await mobile.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
      activeViews: await mobile.locator('.product-view.is-active').count(),
    }
  }
  results.consoleErrors = consoleErrors

  const failed =
    !results.library.detailUpdated ||
    !results.library.mediaLoaded ||
    results.library.overflow ||
    !results.agent.continueEnabled ||
    !results.agent.briefWritten ||
    !results.agent.preflightVisible ||
    results.assets.initialRiskCards !== 2 ||
    !results.assets.exportEnabled ||
    consoleErrors.length > 0 ||
    ['library', 'agent', 'assets'].some(
      (view) => results[`mobile_${view}`].overflow || results[`mobile_${view}`].activeViews !== 1,
    )

  console.log(JSON.stringify(results, null, 2))
  if (failed) process.exitCode = 1
} finally {
  await browser.close()
}
