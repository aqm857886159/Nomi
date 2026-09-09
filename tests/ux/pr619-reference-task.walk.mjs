// R13 task probe: paste a known public Douyin reference, then collect three
// references for its skincare topic through the existing keyword-search UI.
// This does not claim that pasting a link performs similarity search.
import { stationTimeout } from './_station-budget.mjs'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'

const key = process.env.TIKHUB_API_KEY?.trim()
assert.ok(key, 'TIKHUB_API_KEY is required; this task cannot be validated with fixtures')
const evidence = path.join(repoRoot, 'docs/evidence/pr619-finish/task')
fs.mkdirSync(evidence, { recursive: true })
const receipt = { semantics: 'link imports one; keyword search finds references', searches: 0, imports: [], errors: [] }
const run = await launchNomiApp({ name: 'pr619-reference-task', initialLocalStorage: { 'nomi-color-scheme': 'light' } })
const { win } = run
const shot = async (name) => screenshotSettled(win, { path: path.join(evidence, `${name}.png`) })
try {
  await win.getByText('新建空白项目', { exact: true }).first().click()
  await win.waitForURL(/projectId=/)
  const match = win.url().match(/projectId=([^&#]+)/)
  const projectId = match ? decodeURIComponent(match[1]) : null
  assert.ok(projectId)
  const status = await win.evaluate((apiKey) => window.nomiDesktop.connector.tikhub.saveKey({ apiKey }), key)
  assert.equal(status.status, 'ok')
  await win.locator('[data-mode="generation"]').click()
  if (!(await win.locator('section[aria-label="素材库"]').isVisible())) {
    await win.getByRole('button', { name: '素材库', exact: true }).first().click()
  }
  await expect(win.locator('[data-find-reference-cta]')).toBeVisible()
  await shot('01-empty')
  await win.locator('[data-find-reference-cta]').click()
  const input = win.locator('[data-find-reference-panel] input').first()
  await input.fill('https://www.douyin.com/video/7103431378309532942')
  await shot('02-pasted-link')
  await input.press('Enter')
  // Wait for actual persistent assets, never an optimistic toast.
  await expect.poll(async () => win.evaluate(async (pid) => {
    const result = await window.nomiDesktop.assets.list({ projectId: pid })
    return result.items?.length ?? 0
  }, projectId), { timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThan(0)
  await shot('03-link-imported')
  receipt.linkResult = 'one asset imported; no similarity results'
  await input.fill('护肤精华')
  receipt.searches += 1
  await input.press('Enter')
  const cards = win.locator('[data-find-reference-panel] [data-ref-id]')
  await expect.poll(() => cards.count(), { timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThanOrEqual(3)
  await shot('04-search-results')
  for (let i = 0; i < 3; i += 1) {
    const card = cards.nth(i)
    const id = await card.getAttribute('data-ref-id')
    await card.getByRole('button', { name: '加入素材库', exact: true }).click()
    await expect(card.locator('button[data-added="true"]')).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    receipt.imports.push(id)
  }
  await shot('05-three-added')
  await win.locator('[data-find-reference-back]').click()
  await expect(win.getByRole('button', { name: /^douyin-ref-/ })).toHaveCount(3)
  await shot('06-three-in-library')
  const assets = await win.evaluate((pid) => window.nomiDesktop.assets.list({ projectId: pid }), projectId)
  receipt.persistedReferences = assets.items.filter((item) => item.data?.sourceEvidence?.usageStatus === 'reference_only').length
  assert.equal(receipt.persistedReferences, 3)
  await win.getByRole('button', { name: '找参考素材', exact: true }).click()
  await win.locator('[data-find-reference-panel] input').fill('https://example.com/not-a-video')
  await win.locator('[data-find-reference-panel] input').press('Enter')
  await expect(win.getByText(/识别不到|仅支持|不支持/).first()).toBeVisible({ timeout: stationTimeout() })
  await shot('07-invalid-link-feedback')
  receipt.invalidLink = 'visible failure, no search consumed'
  console.log(JSON.stringify(receipt))
} catch (error) {
  receipt.errors.push(String(error?.message ?? error))
  await shot('failure').catch(() => {})
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  await run.close()
}
