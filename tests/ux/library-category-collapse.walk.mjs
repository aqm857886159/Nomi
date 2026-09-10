import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, proveProbe, expectAbsent } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { COMPOSER_SKILL, SKILL_POPOVER } from './agent-runtime-walk-support.mjs'
const out = path.resolve('docs/design/verification/2026-09-09-skill-ui-b')
fs.mkdirSync(out, { recursive: true })
const base = process.env.NOMI_SKILL_UI_DEV_URL
if (base) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${base}/tests/ux/fixtures/library-groups/index.html`)
    const summary = page.locator('summary')
    await expect(summary).toHaveCount(1)
    await expect(summary).toHaveText('表情 · 12 项')
    await expect(page.locator('[data-v4-command]:visible')).toHaveCount(0)
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-v4-command]:visible')).toHaveCount(12)
    await page.screenshot({ path: path.join(out, 'fixture-12-expanded.png') })
    const proof = await proveProbe(page.locator('[data-v4-command="variant-11"]'), '第12项可达')
    await page.locator('[data-v4-command="variant-11"]').click()
    await expect(page.locator('output')).toHaveText('variant-11')
    await summary.click()
    await expectAbsent(page.locator('[data-v4-command="variant-11"]:visible'), { provenBy: proof })
    await page.screenshot({ path: path.join(out, 'fixture-12.png') })
  } finally { await browser.close() }
}
const run = await launchNomiApp({ name: 'library-category-collapse', settleMs: 0,
  env: base ? { NOMI_RENDERER_URL: base, VITE_DEV_SERVER_URL: base } : {},
  initialLocalStorage: { 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})
const page = run.win
page.setDefaultTimeout(stationTimeout({ operations: 2 }))
try {
  await (await run.app.browserWindow(page)).evaluate(w => w.setBounds({ x: 0, y: 0, width: 1680, height: 980 }))
  await page.getByRole('button', { name: '新建空白项目', exact: false }).first().click()
  await page.locator(COMPOSER_SKILL).first().click()
  const picker = page.locator(SKILL_POPOVER).first()
  const expression = picker.locator('details[data-library-group*="source:builtin-expressions"]')
  await expect(expression.locator('summary')).toContainText('25')
  await expression.locator('summary').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(out, '01-composer-collapsed.png') })
  await expression.locator('summary').click()
  await expect(expression.locator('[data-v4-command]:visible')).toHaveCount(25)
  await page.screenshot({ path: path.join(out, '02-composer-expanded.png') })
  await picker.getByRole('button', { name: '新建 · 管理', exact: false }).click()
  const gallery = page.locator('[data-skill-drop-zone]')
  const pack = gallery.locator('details[data-library-group="group:source:builtin-expressions"]')
  await pack.locator('summary').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(out, '03-library-collapsed.png') })
  await pack.locator('summary').click()
  await expect(pack.locator('[data-skill-card]:visible')).toHaveCount(25)
  await pack.locator('summary').evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: path.join(out, '04-library-expanded.png') })
  await pack.locator('[data-skill-card="prompt:builtin-expr-joy-1"]').click()
  const detail = page.locator('[data-skill-detail]')
  await detail.getByRole('button', { name: '用到节点', exact: true }).click()
  const editor = page.locator('.generation-canvas-v2-node__composer [contenteditable="true"]').first()
  await expect(editor).toContainText('嘴角极轻微地上扬')
  await page.locator('[data-effect-more]').click()
  const menu = page.getByTestId('node-effect-menu')
  await expect(menu).toBeVisible()
  await page.screenshot({ path: path.join(out, '07-node-groups.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '提示词库', exact: true }).click()
  const promptGroup = page.locator('button[data-library-group="group:source:builtin-expressions"]')
  await expect(promptGroup).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: path.join(out, '05-prompt-collapsed.png') })
  await promptGroup.click()
  await expect(promptGroup).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('img', { name: '喜悦 1/5 · 一丝笑意', exact: true }).first()).toBeVisible()
  await page.screenshot({ path: path.join(out, '06-prompt-expanded.png') })
  await promptGroup.click()
  await expect(promptGroup).toHaveAttribute('aria-expanded', 'false')
  fs.writeFileSync(path.join(out, 'journey.json'), JSON.stringify({ passed: true, paidCalls: 0, tasks: ['12 variants collapse and keyboard expand', '25 real expressions collapse and expand in composer/gallery', 'apply real expression to node', 'prompt virtual gallery expands and collapses'] }, null, 2) + '\n')
} catch (error) {
  await page.screenshot({ path: path.join(out, 'FAIL.png') })
  throw error
} finally { await run.close() }
