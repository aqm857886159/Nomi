// Real Chromium, original TextDocumentNode/ProseMirror and generation action; controlled supplier/storage, not Electron acceptance.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { expect as browserExpect } from '@playwright/test'
import { createServer } from 'vite'
import { stationTimeout } from './_station-budget.mjs'
import { assertTailwindApplied, freshTailwindCss } from './_freshTailwindCss.mjs'

// 现编一次 Tailwind（收集阶段做完，不占用例自己的超时），后面各用例复用。
freshTailwindCss()

let server, browser, cacheDir
beforeAll(async () => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'nomi-text-ownership-vite-'))
  server = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  browser = await chromium.launch({ headless: true })
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true })
})

test('selection rewrite persists its actual result body, reopens without replay, and rejects later manual edits', async () => {
  const page = await browser.newPage()
  page.setDefaultTimeout(stationTimeout({ operations: 1 }))
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/text-document-generation-ownership.html`)
    await page.addStyleTag({ content: freshTailwindCss() })
    await assertTailwindApplied(page, 'text-document-generation-ownership.test.mjs')
    const editor = page.locator('.ProseMirror')
    await browserExpect(editor).toBeVisible()
    await browserExpect(editor).toHaveText('Keep OLD tail')
    await editor.click()
    await browserExpect(editor).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await browserExpect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Keep OLD tail')
    await page.keyboard.press('ArrowLeft')
    for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight')
    for (let index = 0; index < 3; index += 1) await page.keyboard.press('Shift+ArrowRight')
    await browserExpect.poll(() => page.evaluate(() => window.textOwnership.snapshot().selection)).toBe('OLD')
    await page.evaluate(() => window.textOwnership.prepare())
    await page.evaluate(() => window.textOwnership.generate())
    await browserExpect.poll(() => page.evaluate(() => window.textOwnership.snapshot().pending)).toBe(null)
    const generated = await page.evaluate(() => ({ ...window.textOwnership.snapshot(), validation: window.textOwnership.validate() }))
    expect(generated.text).toBe('Keep\nNEW\ntail')
    expect(generated.validation).toEqual({ accepted: true })
    expect(generated.appliedRun.resultId).toBe(generated.result.id)
    expect(generated.appliedRun.textDocumentDigest).toMatch(/^sha256-[a-f0-9]{64}$/)
    expect(generated.persistRevision).toBeGreaterThan(generated.beforeApplyRevision)

    await page.evaluate(() => window.textOwnership.reopen())
    await browserExpect(editor).toHaveText('Keep NEW tail')
    const reopened = await page.evaluate(() => ({ ...window.textOwnership.snapshot(), validation: window.textOwnership.validate() }))
    expect(reopened.text).toBe(generated.text)
    expect(reopened.appliedRun.textDocumentDigest).toBe(generated.appliedRun.textDocumentDigest)
    expect(reopened.validation).toEqual({ accepted: true })

    await editor.click()
    await page.keyboard.type(' MANUAL')
    const edited = await page.evaluate(() => ({ ...window.textOwnership.snapshot(), validation: window.textOwnership.validate() }))
    expect(edited.text).toContain('MANUAL')
    expect(edited.appliedRun.textDocumentDigest).toBe(generated.appliedRun.textDocumentDigest)
    expect(edited.validation.accepted).toBe(false)
  } finally { await page.close() }
})
