// Real React/Mantine component interactions with explicit desktop fault fixtures.
// This supplements the Electron journey; it does not claim full workflow coverage.
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
const baselinePaths = new Set([
  'src/ui/browser/dialog/useBrowserDialogActions.ts', 'src/ui/browser/dialog/NomiBrowserDialogView.tsx', 'src/ui/browser/dialog/NomiBrowserDialog.tsx',
  'src/ui/onboarding/CodexLocalImageCard.tsx', 'src/workbench/production/useProductionStatus.ts',
  'src/workbench/production/ProductionRunTaskCard.tsx', 'src/workbench/timeline/TimelineTrack.tsx', 'src/ui/toast.tsx',
])
const proofs = {}
for (const phase of ['before', 'after']) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    plugins: phase === 'before' ? [{ name: 'notification-actual-baseline', enforce: 'pre', transform(_code, id) {
      const relative = path.relative(root, id.split('?')[0])
      if (baselinePaths.has(relative)) return execFileSync('git', ['show', `1d565961f:${relative}`], { cwd: root, encoding: 'utf8' })
    } }] : [],
    server: { host: '127.0.0.1', port: 5298, strictPort: true },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: MIN_WINDOW.width, height: MIN_WINDOW.height } })
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.addInitScript(() => { localStorage.setItem('nomi-color-scheme', 'light'); localStorage.setItem('nomi:locale:v1', 'zh-CN') })
    const open = async scenario => {
      await page.goto(`http://127.0.0.1:5298/tests/ux/fixtures/notification-local-feedback/index.html?phase=${phase}&scenario=${scenario}`)
      await expect(page.locator('[data-local-feedback-stage]')).toBeVisible()
    }
    await open('codex')
    await page.getByRole('button', { name: /启用|接入|开启/ }).last().click()
    if (phase === 'after') {
      await expect(page.getByRole('status')).toContainText('配置文件暂时无法写入')
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
    } else {
      await expect(page.locator('.mantine-Notification-root')).toContainText('配置文件暂时无法写入')
      proofs.notification = await proveProbe(page.locator('.mantine-Notification-root'), '旧版配置失败确实产生全局通知')
    }
    await screenshotSettled(page, { path: path.join(output, `${phase}-codex-inline.png`) })
    if (phase === 'after') {
      const errorProof = await proveProbe(page.getByRole('status'), '配置失败已在本卡显示')
      await page.evaluate(() => window.__notificationFixture.recoverCodex())
      await page.getByRole('button', { name: /启用|接入|开启/ }).last().click()
      await expectAbsent(page.getByRole('status'), { provenBy: errorProof, message: '成功重试清除配置错误' })
      await expect(page.getByRole('button', { name: /关闭/ })).toBeVisible()
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
      await screenshotSettled(page, { path: path.join(output, 'after-codex-retry.png') })
    }
    await open('production')
    await page.locator('[data-production-primary-action]').click()
    if (phase === 'after') {
      await expect(page.locator('[data-production-action-error]')).toContainText('制作记录暂时无法写入')
      await expectAbsent(page.getByRole('dialog'), { provenBy: proofs.dialog, message: '制作失败原地说明不弹模态' })
    } else {
      await expect(page.getByRole('dialog')).toContainText('制作记录暂时无法写入')
      proofs.dialog = await proveProbe(page.getByRole('dialog'), '旧版制作失败确实弹出模态')
    }
    await screenshotSettled(page, { path: path.join(output, `${phase}-production-inline.png`) })
    if (phase === 'after') {
      const failureProof = await proveProbe(page.locator('[data-production-action-error]'), '制作失败显示在操作旁')
      await page.evaluate(() => window.__notificationFixture.recoverProduction())
      await page.locator('[data-production-primary-action]').click()
      await expectAbsent(page.locator('[data-production-action-error]'), { provenBy: failureProof, message: '制作成功重试清除旧错' })
      await expect(page.locator('[data-production-control="pause"]')).toBeVisible()
      assert.equal((await page.evaluate(() => window.__notificationFixture.state())).commandCalls, 2)
    }
    await open('timeline')
    const transfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.setData('application/x-nomi-asset-ref', JSON.stringify({ kind: 'audio', name: 'music.mp3', renderUrl: 'nomi-local://asset/other/assets/music.mp3', origin: { source: 'project', projectId: 'other', relativePath: 'assets/music.mp3' } }))
      return dt
    })
    await page.locator('.workbench-timeline-track__clips').dispatchEvent('drop', { dataTransfer: transfer })
    if (phase === 'after') {
      await expect(page.locator('[data-timeline-track-feedback]')).not.toBeEmpty()
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
    } else await expect(page.locator('.mantine-Notification-root')).toHaveCount(1)
    await screenshotSettled(page, { path: path.join(output, `${phase}-timeline-inline.png`) })
    if (phase === 'before') {
      await open('browser')
      await page.getByRole('button', { name: 'Policy bookmark', exact: true }).click({ button: 'right' })
      const nativePrompt = page.waitForEvent('dialog').then(async dialog => {
        assert.equal(dialog.type(), 'prompt')
        assert.equal(dialog.defaultValue(), 'Policy bookmark')
        await dialog.dismiss()
      })
      await page.getByRole('menuitem', { name: /重命名/ }).click()
      await nativePrompt
      const textboxProof = await proveProbe(page.getByRole('textbox').first(), '浏览器地址输入证明该页文本框探针有效')
      await expectAbsent(page.getByRole('textbox', { name: /重命名/ }), { provenBy: textboxProof, message: '旧版原生重命名没有内联输入框' })
    }
    if (phase === 'after') {
      await open('browser')
      await page.getByRole('button', { name: 'Policy bookmark', exact: true }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /重命名/ }).click()
      const rename = page.getByRole('textbox', { name: /重命名/ })
      await expect(rename).toBeVisible()
      const renameProof = await proveProbe(rename, '书签重命名输入框已出现')
      await rename.fill('New policy bookmark')
      await screenshotSettled(page, { path: path.join(output, 'after-bookmark-inline-edit.png') })
      await rename.press('Enter')
      await expect(page.getByRole('button', { name: 'New policy bookmark', exact: true })).toBeVisible()
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nomi.browser.bookmarks.v1'))[0].title), 'New policy bookmark')
      await page.getByRole('button', { name: 'New policy bookmark', exact: true }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: /重命名/ }).click()
      await rename.fill('Cancelled title')
      await rename.press('Escape')
      await expectAbsent(rename, { provenBy: renameProof, message: 'Escape退出重命名' })
      await expect(page.getByRole('button', { name: 'New policy bookmark', exact: true })).toBeVisible()
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nomi.browser.bookmarks.v1'))[0].title), 'New policy bookmark')
      await screenshotSettled(page, { path: path.join(output, 'after-bookmark-inline-saved.png') })
    }
    await open('repeat')
    await page.getByRole('button', { name: 'Repeat five', exact: true }).click()
    await expect(page.locator('.mantine-Notification-root')).toHaveCount(phase === 'after' ? 1 : 2)
    const counts = await page.evaluate(() => window.__notificationFixture.state())
    assert.equal(counts.queued, phase === 'after' ? 0 : 3)
    await screenshotSettled(page, { path: path.join(output, `${phase}-repeat-five.png`) })
    if (phase === 'after') {
      await expect(page.locator('[data-notification-occurrences]')).toHaveText('×5')
      const countProof = await proveProbe(page.locator('[data-notification-occurrences]'), '重复通知已显示次数')
      await expect(page.locator('.mantine-Notification-root')).toContainText('后台任务失败 5')
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await expect(page.locator('[data-action-result]')).toHaveText('5')
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
      await page.getByRole('button', { name: 'Repeat once', exact: true }).click()
      await expect(page.locator('.mantine-Notification-root')).toHaveCount(1)
      await expectAbsent(page.locator('[data-notification-occurrences]'), { provenBy: countProof, message: '关闭后的新事件从一次开始，不显示重复次数' })
      await page.evaluate(() => window.__notificationFixture.clear())
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
      await page.clock.install()
      await page.evaluate(() => window.__notificationFixture.timedError('首次错误'))
      await page.clock.runFor(900)
      await page.evaluate(() => window.__notificationFixture.timedError('最新错误仍需处理'))
      await page.clock.runFor(5000)
      await expect(page.locator('.mantine-Notification-root')).toHaveCount(1)
      await expect(page.locator('.mantine-Notification-root')).toContainText('最新错误仍需处理')
      await page.locator('.mantine-Notification-closeButton').click()
      await page.clock.runFor(500)
      await expectAbsent(page.locator('.mantine-Notification-root'), { provenBy: proofs.notification, message: '原地反馈或已处理通知不应残留全局提示' })
    }
    assert.deepEqual(pageErrors, [], 'No uncaught browser errors')
    fs.writeFileSync(path.join(output, `${phase}-local-feedback-receipt.json`), JSON.stringify({ phase, pageErrors, counts, baseline: phase === 'before' ? '1d565961f actual source via Vite transform' : 'working tree', retryVerified: phase === 'after' }, null, 2))
    console.log(JSON.stringify({ phase, components: ['CodexLocalImageCard', 'useProductionStatus/ProductionRunTaskCard', 'TimelineTrack'], repeat: counts, screenshots: output }))
  } finally { await browser?.close(); await server.close() }
}
