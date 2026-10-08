// Shared-base contract, not a second scanFeel implementation. Uses the real Tailwind plugin.
// node tests/ux/focus-indication.e2e.mjs; FOCUS_EXPECT_RED=1 preserves the pre-fix evidence.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig.js'
import { fileURLToPath } from 'node:url'
const output = new URL('../../.tmp/focus-evidence/', import.meta.url)
await fs.mkdir(output, { recursive: true })
const fixture = await fs.readFile(new URL('./fixtures/focus-indication/controls.html', import.meta.url), 'utf8')
const config = loadConfig(fileURLToPath(new URL('../../tailwind.config.ts', import.meta.url)))
const { css } = await postcss([tailwind({ ...config, content: [{ raw: fixture }] })]).process('@tailwind base; @tailwind utilities;', { from: undefined })
const browser = await chromium.launch()
const report = { negativeFixtures: [], themes: [], failures: [] }
const read = (locator) => locator.evaluate(e => {
  const s = getComputedStyle(e)
  return { outline: s.outline, width: s.outlineStyle === 'none' ? 0 : parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor, border: s.borderColor, shadow: s.boxShadow, visible: e.matches(':focus-visible'), focused: e === document.activeElement }
})
try {
  const page = await browser.newPage()
  await page.setContent(await fs.readFile(new URL('./fixtures/focus-indication/leaks.html', import.meta.url), 'utf8'))
  await page.locator('#mouse-text').click()
  assert.ok((await read(page.locator('#mouse-text'))).width > 0, 'negative text fixture must expose an outer outline')
  report.negativeFixtures.push('mouse-text-outline: RED detected')
  await page.keyboard.press('Tab')
  const missing = await read(page.locator('#keyboard-button'))
  assert.equal(missing.focused, true, 'negative keyboard fixture must actually hold focus')
  assert.equal(missing.width, 0, 'negative keyboard fixture must have no outline')
  assert.equal(missing.shadow, 'none', 'negative keyboard fixture must have no shadow alternative')
  report.negativeFixtures.push('keyboard-focus-missing: RED detected')
  const native = await page.evaluate(() => ({
    scrollbar: [getComputedStyle(document.querySelector('#scrollbar')).scrollbarWidth, getComputedStyle(document.querySelector('#scrollbar')).scrollbarColor],
    forms: ['select','checkbox','range'].map(id => getComputedStyle(document.getElementById(id)).appearance),
  }))
  assert.deepEqual(native.scrollbar, ['auto','auto'], 'scrollbar negative fixture must expose default styling')
  assert.ok(native.forms.every(appearance => appearance === 'auto'), 'form negative fixtures must expose native appearance')
  report.negativeFixtures.push('ua-default-scrollbar: RED candidate', 'ua-default-form-control: RED candidates (ownership inspection required)')
  for (const theme of ['light', 'dark']) {
    await page.setContent(fixture)
    await page.addStyleTag({ content: css })
    await page.evaluate(t => document.documentElement.setAttribute('data-mantine-color-scheme', t), theme)
    const panelBefore = (await read(page.locator('#outer-panel'))).border
    await page.locator('#independent-field').click()
    if ((await read(page.locator('#outer-panel'))).border !== panelBefore) report.failures.push(`${theme}: native field focus leaked to outer panel`)
    const entries = []
    const colors = await page.evaluate(() => {
      const probe = document.createElement('span'); document.body.append(probe)
      const result = {}
      for (const key of ['accent','focus','danger']) { probe.style.color = `var(--nomi-${key})`; result[key] = getComputedStyle(probe).color }
      probe.remove(); return result
    })
    for (const id of ['text','search','password','number','email','tel','url','textarea','nested','nested-editor','editable','plaintext','readonly','invalid']) {
      const field = page.locator(`#${id}`)
      const unfocusedBorder = (await read(field)).border
      await field.click()
      const mouse = await read(field)
      if (mouse.width > 0) report.failures.push(`${theme}/${id}: mouse outer outline ${mouse.outline}`)
      // Shift+Tab then Tab is real keyboard input, not element.focus() modality guessing.
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
      const keyboard = await read(field)
      if (!keyboard.focused || keyboard.width > 0) report.failures.push(`${theme}/${id}: keyboard text indication ${keyboard.outline}`)
      const borderTarget = id === 'nested' ? page.locator('#composer') : id === 'nested-editor' ? page.locator('#nested-editor-border') : field
      const border = (await read(borderTarget)).border
      const expectedBorder = id === 'invalid' ? unfocusedBorder : colors.accent
      if (border !== expectedBorder) report.failures.push(`${theme}/${id}: focus border ${border}, expected ${expectedBorder}`)
      entries.push({ id, mouse, keyboard, border })
    }
    for (const id of ['button','link','select','checkbox','range','custom','tabindex','summary']) {
      const target = page.locator(`#${id}`)
      // Setting tabindex focus start then Tab isolates keyboard modality without activating actions.
      await target.evaluate(e => { const marker = document.createElement('span'); marker.tabIndex = -1; marker.id = 'focus-start'; e.before(marker); marker.focus() })
      await page.keyboard.press('Tab')
      const keyboard = await read(target)
      if (!keyboard.focused || keyboard.width <= 0 || keyboard.style === 'auto' || keyboard.color !== colors.focus) report.failures.push(`${theme}/${id}: missing owned keyboard outline`)
      await page.locator('#focus-start').evaluate(e => e.remove())
      let mouse
      if (['button','custom','tabindex','summary','link'].includes(id)) {
        await page.locator('#text').click()
        await target.click()
        mouse = await read(target)
        if (mouse.width > 0) report.failures.push(`${theme}/${id}: pointer command outline`)
      }
      entries.push({ id, keyboard, mouse })
    }
    report.themes.push({ theme, entries })
    await page.screenshot({ path: fileURLToPath(new URL(`${theme}-controls.png`, output)), fullPage: true })
  }
} finally { await browser.close() }
await fs.writeFile(new URL(process.env.FOCUS_EXPECT_RED ? 'matrix-red.json' : 'matrix-green.json', output), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ negativeFixtures: report.negativeFixtures, failures: report.failures }, null, 2))
assert.equal(report.failures.length, 0, 'shared focus contract violations')
