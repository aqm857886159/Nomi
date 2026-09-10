import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { COMPOSER_SKILL, SKILL_POPOVER } from './agent-runtime-walk-support.mjs'
const out = path.resolve('docs/design/verification/2026-09-09-skill-ui-b')
fs.mkdirSync(out, { recursive: true })
const run = await launchNomiApp({ name: 'skill-cover-wall', settleMs: 0,
  initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})
const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))
const media = []
try {
  await (await run.app.browserWindow(page)).evaluate(w => w.setBounds({ x: 0, y: 0, width: 1680, height: 980 }))
  await page.getByRole('button', { name: '新建空白项目', exact: false }).first().click()
  await page.locator(COMPOSER_SKILL).first().click()
  await page.locator(SKILL_POPOVER).first().getByRole('button', { name: '新建 · 管理', exact: false }).click()
  const gallery = page.locator('[data-skill-drop-zone]')
  for (const [label, kind, count] of [['技能', 'skill', 48], ['效果', 'effect', 40]]) {
    await gallery.getByRole('radio', { name: label, exact: true }).click()
    await expect(gallery.getByRole('radio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true')
    while (await gallery.locator('details:not([open]) > summary').count()) await gallery.locator('details:not([open]) > summary').first().click()
    const cards = gallery.locator('[data-skill-card]')
    await expect(cards).toHaveCount(count)
    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i)
      const parent = card.locator('xpath=ancestor::details[1]')
      if (await parent.count() && await parent.getAttribute('open') === null) await parent.locator('summary').click()
      await card.scrollIntoViewIfNeeded()
      const image = card.locator('img[data-skill-media="image"]')
      await expect(image).toBeVisible()
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
      media.push({ id: await card.getAttribute('data-skill-card'), loaded: true })
      if (!(i % 8) || i === count - 1) await page.screenshot({ path: path.join(out, `wall-${kind}-${String(i + 1).padStart(2, '0')}.png`) })
    }
  }
  fs.writeFileSync(path.join(out, 'cover-wall.json'), JSON.stringify({ passed: true, paidCalls: 0, media }, null, 2) + '\n')
} catch (error) {
  await page.screenshot({ path: path.join(out, 'wall-FAIL.png') })
  fs.writeFileSync('/private/tmp/nomi-skill-ui-b-wall-dom.html', await page.content())
  throw error
} finally { await run.close() }
