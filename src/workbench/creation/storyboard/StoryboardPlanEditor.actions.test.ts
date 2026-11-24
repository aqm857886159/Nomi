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
    await expect(zone).toHaveAttribute('data-storyboard-anchors-expanded', 'false')
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
    await expect(card.getByPlaceholder(copy.anchor.namePlaceholder)).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(zone.locator('[data-storyboard-anchor-strip]')).toBeVisible()
    await toggle.click()
    await expect(card).toBeVisible()

    await add.click()
    await expect(card).toHaveCount(2)
    await expect(card.last().getByPlaceholder(copy.anchor.namePlaceholder)).toBeFocused()

    await toggle.click()
    await add.click()
    await expect(card).toHaveCount(3)
    await expect(card.last().getByPlaceholder(copy.anchor.namePlaceholder)).toBeFocused()
  } finally {
    await page.close()
  }
})

test('deleting the final reference reports an empty zone and returns focus to Add Reference', async () => {
  const page = await fixture.browser.newPage()
  try {
    await page.goto(fixture.url(harness, '?locale=en'))
    const zone = page.locator('[data-storyboard-anchors]')
    const add = zone.getByRole('button', { name: copy.addAnchor, exact: true })
    await add.click()
    await zone.getByRole('button', { name: copy.anchor.actions, exact: true }).click()
    await page.getByRole('menuitem', { name: copy.anchor.delete, exact: true }).click()
    await expect(zone.locator('[data-storyboard-anchor-row]')).toHaveCount(0)
    await expect(zone).toHaveAttribute('data-storyboard-anchors-expanded', 'false')
    await expect(add).toBeFocused()
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
      await expect(row.locator('[data-prompt-box] [contenteditable="true"]')).toBeFocused()
    } finally {
      await page.close()
    }
  })

  test('an appended row that fits in the viewport also receives prompt focus', async () => {
    const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(fixture.url(harness, '?locale=en'))
      await page.addStyleTag({ content: freshTailwindCss() })
      await page.addStyleTag({ url: '/src/styles/index.css' })
      await page.getByRole('button', { name: copy.addShot, exact: true }).click()
      const prompt = page.locator('[data-storyboard-row="2"] [data-prompt-box] [contenteditable="true"]')
      await expect(prompt).toBeInViewport()
      await expect(prompt).toBeFocused()
    } finally {
      await page.close()
    }
  })

  test('the footer reveals shot 321 from shot 1, preserving selection and other scene folds', async () => {
    const page = await fixture.browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await page.goto(fixture.url(harness, '?locale=en&windowed'))
      await page.addStyleTag({ content: freshTailwindCss() })
      await page.addStyleTag({ url: '/src/styles/index.css' })
      const scroll = page.locator('[data-storyboard-scroll]')
      const rows = page.locator('[data-storyboard-rows]')
      const interlude = rows.getByRole('button', { name: /^Interlude/ })
      const departure = rows.getByRole('button', { name: /^Departure/ })
      const select = (index: number) => rows.locator(`[data-storyboard-row="${index}"] [data-storyboard-visual-column]`)
      const selection = page.locator('[data-storyboard-selection-toolbar]')
      await interlude.click()
      await departure.click()
      await scroll.evaluate(element => { element.scrollTop = 0 })
      await select(1).click({ position: { x: 4, y: 4 } })
      await select(2).click({ position: { x: 4, y: 4 }, modifiers: ['Shift'] })
      const selectionText = copy.selection.count.replace('{{count}}', '2')
      await expect(selection).toContainText(selectionText)
      await expect(interlude).toHaveAttribute('aria-expanded', 'false')
      await expect(departure).toHaveAttribute('aria-expanded', 'false')
      await expect(select(1)).toBeInViewport()
      await expect(rows.locator('[data-storyboard-item="shot:shot-320"]')).toHaveCount(0)

      await page.locator('[data-storyboard-plan-footer]').getByRole('button', { name: copy.addShot, exact: true }).click()
      const prompt = rows.locator('[data-storyboard-row="321"] [data-prompt-box] [contenteditable="true"]')
      await expect(prompt).toBeInViewport()
      await expect(prompt).toBeFocused()
      await expect(selection).toContainText(selectionText)
      await expect(rows).toHaveAttribute('data-storyboard-row-count', '321')
      await page.keyboard.type('Continue at the departure gate')
      await expect(prompt).toHaveText('Continue at the departure gate')

      await scroll.evaluate(element => { element.scrollTop = 0 })
      await expect(interlude).toHaveAttribute('aria-expanded', 'false')
      await expect(departure).toHaveAttribute('aria-expanded', 'true')
    } finally {
      await page.close()
    }
  })
})
