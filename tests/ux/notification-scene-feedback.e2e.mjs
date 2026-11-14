import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { createServer } from 'vite'
import { screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { MIN_WINDOW } from './_minWindow.mjs'
const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(root, '.tmp/toast-policy-evidence')
fs.mkdirSync(output, { recursive: true })
const baselinePaths = new Set(['src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx', 'src/ui/toast.tsx'])
const receipts = []
let notificationProof
for (const phase of ['before', 'after']) {
  const server = await createServer({ root, configFile: false, logLevel: 'error', plugins: phase === 'before' ? [{ name: 'scene-feedback-actual-baseline', enforce: 'pre', transform(_code, id) { const relative = path.relative(root, id.split('?')[0]); if (baselinePaths.has(relative)) return execFileSync('git', ['show', `1d565961f:${relative}`], { cwd: root, encoding: 'utf8' }) } }] : [], server: { host: '127.0.0.1', port: 5299, strictPort: true } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: MIN_WINDOW.width, height: MIN_WINDOW.height } })
    const pageErrors = []
    page.on('pageerror', error => { pageErrors.push(error.message); console.error(error.message) })
    await page.addInitScript(() => { localStorage.setItem('nomi-color-scheme', 'light'); localStorage.setItem('nomi:locale:v1', 'zh-CN') })
    await page.goto('http://127.0.0.1:5299/tests/ux/fixtures/notification-scene-feedback/index.html')
    await expect(page.locator('[data-scene-feedback-stage]')).toBeVisible()
    const file = { name: 'not-a-panorama.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid panorama fixture') }
    for (let i = 0; i < 5; i++) await page.locator('input[type=file]').setInputFiles(file)
    if (phase === 'before') {
      await expect(page.locator('.mantine-Notification-root')).toHaveCount(2)
      notificationProof = await proveProbe(page.locator('.mantine-Notification-root'), '旧版五次非法全景文件产生全局通知')
      await expect(page.locator('.mantine-Notification-root').first()).toContainText('请选择图片格式的全景图')
    } else {
      await expect(page.locator('[data-scene-feedback-stage] [role=status]')).toHaveCount(1)
      await expect(page.locator('[data-scene-feedback-stage] [role=status]')).toContainText('请选择图片格式的全景图')
      await expect(page.locator('[data-scene-feedback-stage]').getByRole('button', { name: '导入全景图', exact: true })).toBeVisible()
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: notificationProof, message: '全景文件错误原地显示，不再产生全局通知' })
    }
    const counts = await page.evaluate(() => window.__sceneFeedbackState())
    assert.equal(counts.queued, phase === 'before' ? 3 : 0)
    assert.equal(counts.visible, phase === 'before' ? 2 : 0)
    await screenshotSettled(page, { path: path.join(output, `${phase}-scene3d-panorama-inline.png`) })
    assert.deepEqual(pageErrors, [])
    receipts.push({ phase, inputEvents: 5, counts, screenshot: `${phase}-scene3d-panorama-inline.png`, scope: 'real Scene3DEnvironmentPanel + production CSS + actual file input validation; component fixture, not complete Electron journey' })
  } finally { await browser?.close(); await server.close() }
}
fs.writeFileSync(path.join(output, 'scene3d-feedback-receipt.json'), JSON.stringify(receipts, null, 2))
console.log(JSON.stringify(receipts))
