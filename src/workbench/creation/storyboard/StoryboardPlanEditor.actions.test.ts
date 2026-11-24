import { expect } from '@playwright/test'
import { chromium } from 'playwright'
import { beforeAll, describe, test } from 'vitest'
import { enStoryboardEditor as copy } from '../../../i18n/locales/storyboardEditor'
import { FIXTURE_BUILD_BUDGET_MS, useBrowserFixture as setupBrowserFixture } from '../../../../tests/ux/_browserFixture.mjs'
import { freshTailwindCss } from '../../../../tests/ux/_freshTailwindCss.mjs'

const harness = 'tests/ux/fixtures/original-storyboard-editor-harness.html'
const fixture = setupBrowserFixture({ entries: [harness], browserType: chromium, ready: '[data-storyboard-editor]' })

test('the empty reference prompt offers an add action without disclosure', async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(harness, '?locale=en'))
    const zone = page.locator('[data-storyboard-anchors]')
    const add = zone.getByRole('button', { name: copy.addAnchor, exact: true })
    const toggle = zone.locator('[data-storyboard-anchors-toggle]')
    await expect(zone.getByText(copy.noAnchors, { exact: true })).toBeVisible()
    await expect(toggle).toHaveCount(0)
    await expect(add).toBeEnabled()
  } finally {
    await page.close()
  }
})

test('one click adds an editable reference card and restores disclosure for populated sections', async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(harness, '?locale=en'))
    const zone = page.locator('[data-storyboard-anchors]')
    const add = zone.getByRole('button', { name: copy.addAnchor, exact: true })
    const toggle = zone.locator('[data-storyboard-anchors-toggle]')
    const card = zone.locator('[data-storyboard-anchor-row]')

    await add.click({ timeout: 2000 })
    await expect(card).toHaveCount(1)
    await expect(card.getByPlaceholder(copy.anchor.namePlaceholder)).toBeEditable()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(zone.locator('[data-storyboard-anchor-strip]')).toBeVisible()
    await toggle.click()
    await expect(card).toBeVisible()
  } finally {
    await page.close()
  }
})

describe('persistent add shot action', () => {
  beforeAll(() => { freshTailwindCss() }, FIXTURE_BUILD_BUDGET_MS)

  test('the footer appends exactly one shot and reveals its editor from the top of a short viewport', async () => {
    const page = await fixture.browser.newPage({ viewport: { width: 1100, height: 430 } })
    try {
      await page.goto(fixture.url(harness, '?locale=en&many'))
      const editor = page.locator('[data-storyboard-editor]')
      const footer = editor.locator('[data-storyboard-plan-footer]')
      const scroll = editor.locator('[data-storyboard-scroll]')
      const add = editor.getByRole('button', { name: copy.addShot, exact: true })
      const rows = editor.locator('[data-storyboard-rows]')
      const row = editor.locator('[data-storyboard-row="4"]')

      await expect(rows).toHaveAttribute('data-storyboard-row-count', '3')
      await expect(footer.getByRole('button', { name: copy.addShot, exact: true })).toBeAttached()
      await page.addStyleTag({ content: freshTailwindCss() })
      await page.addStyleTag({ url: '/src/styles/index.css' })
      await expect(add).toBeInViewport()
      await expect(add).toHaveCount(1)
      expect(await scroll.evaluate(element => element.scrollTop)).toBe(0)
      await add.click()
      await expect(rows).toHaveAttribute('data-storyboard-row-count', '4')
      await expect(row).toBeInViewport({ ratio: 0.8 })
      await expect(row.locator('[data-prompt-box] [contenteditable="true"]')).toBeEditable()
    } finally {
      await page.close()
    }
  })
})
