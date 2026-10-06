// Real original editor in Chromium; persistence/host ports are controlled, not Electron acceptance.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, test } from 'vitest'
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { createServer } from 'vite'
import { assertTailwindApplied, freshTailwindCss } from './_freshTailwindCss.mjs'

// 现编一次 Tailwind（收集阶段做完，不占用例自己的超时），后面各用例复用。
freshTailwindCss()
let server, browser, cacheDir
beforeAll(async () => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'nomi-storyboard-undo-vite-'))
  server = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  // Build and mount the real fixture under setup's existing budget. Scenario timeouts measure interactions.
  const fixture = await browser.newPage()
  try {
    await fixture.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/original-storyboard-editor-harness.html?undo=true`)
    await expect(fixture.locator('[data-storyboard-editor]')).toBeVisible()
  } finally { await fixture.close() }
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true })
})
for (const scenario of ['redo', 'consumed', 'hidden', 'later-edit', 'outside', 'input', 'ordinary', 'immediate', 'generated-immediate']) test(`storyboard deletion Undo: ${scenario}`, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(5000)
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/original-storyboard-editor-harness.html?undo=true${scenario === 'generated-immediate' ? '&confirm=true' : ''}`)
    await page.addStyleTag({ content: freshTailwindCss() })
    await assertTailwindApplied(page, 'storyboard-delete-undo.test.mjs')
    const editor = page.locator('[data-storyboard-editor]')
    await expect(editor).toBeVisible()
    await editor.getByRole('button', { name: '添加镜头', exact: true }).click()
    await expect(editor.locator('[data-storyboard-row]')).toHaveCount(2)
    const row = editor.locator('[data-storyboard-row="1"]')
    await row.getByRole('button', { name: '镜头操作', exact: true }).last().click()
    await page.locator('[data-storyboard-row-menu="1"]').getByRole('button', { name: '删除', exact: true }).click()
    if (scenario === 'generated-immediate') await page.getByRole('dialog').getByRole('button', { name: '删除镜头', exact: true }).click()
    await expect(editor.locator('[data-storyboard-row]')).toHaveCount(1)
    const remaining = editor.locator('[data-storyboard-row="1"]')
    if (scenario === 'later-edit') await editor.locator('header input').fill('Keep later title')
    if (!['immediate', 'generated-immediate'].includes(scenario)) await remaining.focus()
    if (scenario === 'consumed') await remaining.evaluate(el => el.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'z') event.preventDefault() }))
    if (scenario === 'outside') await page.getByRole('button', { name: 'Outside editor', exact: true }).focus()
    if (scenario === 'input') await editor.locator('header input').focus()
    if (scenario === 'hidden') await page.getByRole('button', { name: 'Canvas sibling', exact: true }).click()
    await page.keyboard.press(scenario === 'redo' ? 'Meta+Shift+z' : 'Meta+z')
    if (['redo', 'consumed', 'hidden', 'outside', 'input'].includes(scenario)) {
      await expect(editor.locator('[data-storyboard-row]')).toHaveCount(1)
    } else {
      await expect(editor.locator('[data-storyboard-row]')).toHaveCount(2)
      if (scenario === 'later-edit') await expect(editor.locator('header input')).toHaveValue('Keep later title')
    }
  } finally { await page.close() }
})

test('delayed delete confirmation cannot delete after the editor target changed', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(5000)
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/original-storyboard-editor-harness.html?undo=true&confirm=true`)
    await page.addStyleTag({ content: freshTailwindCss() })
    await assertTailwindApplied(page, 'storyboard-delete-undo.test.mjs')
    const editor = page.locator('[data-storyboard-editor]')
    const row = editor.locator('[data-storyboard-row="1"]')
    await row.getByRole('button', { name: '镜头操作', exact: true }).last().click()
    await page.locator('[data-storyboard-row-menu="1"]').getByRole('button', { name: '删除', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // A background author edit is controlled; the deletion and confirmation remain original UI.
    await editor.locator('header input').evaluate(input => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'Newer target')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(editor.locator('header input')).toHaveValue('Newer target')
    await dialog.getByRole('button', { name: '删除镜头', exact: true }).click()
    await expect(editor.locator('[data-storyboard-row]')).toHaveCount(1)
    await expect(editor.locator('[data-storyboard-action-feedback]')).toBeVisible()
  } finally { await page.close() }
})
