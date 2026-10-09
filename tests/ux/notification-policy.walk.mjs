// Real Electron settings/task journey. "before" runs the previously built baseline;
// "after" requires a fresh production build, and asserts the intended policy.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect } from '@playwright/test'
import { proveProbe, expectAbsent } from './_assert.mjs'

const phase = process.env.NOTIFICATION_POLICY_PHASE || 'after'
const output = path.resolve('.tmp/toast-policy-evidence')
fs.mkdirSync(output, { recursive: true })
const { app, win } = await launchNomiApp({
  name: `notification-policy-${phase}`, settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi-color-scheme': 'light', '__nomiE2E': '1' },
})
try {
  await win.waitForLoadState('domcontentloaded')
  await win.locator('button[aria-label*="设置"], button[aria-label*="Settings"]').first().click()
  for (let index = 0; index < 5; index++) {
    await win.getByRole('button', { name: '检查文件夹', exact: true }).click()
    await expect(win.locator('[data-project-location-check-feedback]')).toHaveAttribute('data-feedback-state', 'success')
  }
  const count = await win.locator('.mantine-Notification-root').count()
  if (phase === 'after') {
    const folderProof = await proveProbe(win.locator('[data-project-location-check-feedback]'), '文件夹检查结果真实显示在按钮旁')
    await expectAbsent(win.locator('.mantine-Notification-root'), { provenBy: folderProof, message: '文件夹结果不重复弹全局提示' })
  }
  else assert.ok(count > 0, 'baseline must reproduce duplicate global feedback')
  await win.screenshot({ path: path.join(output, `${phase}-directory-check.png`) })
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: /新建空白项目|New blank project/ }).first().click()
  await expect(win.locator('[data-task-center-trigger]')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('nomi:update:event', { type: 'available', version: '0.99.0', notes: [], sizeBytes: null, releaseUrl: null })
    }
  })
  if (phase === 'after') {
    await expect(win.locator('[data-update-badge]')).toBeVisible()
    const badgeProof = await proveProbe(win.locator('[data-update-badge]'), '更新事件已投影到真实宿主角标')
    await expectAbsent(win.locator('[data-updater-dialog]'), { provenBy: badgeProof, message: '未请求更新详情时不主动弹窗' })
    await win.screenshot({ path: path.join(output, `${phase}-update-available.png`) })
    await win.locator('[data-update-badge]').click()
    await expect(win.locator('[data-updater-dialog]')).toBeVisible()
    const dialogProof = await proveProbe(win.locator('[data-updater-dialog]'), '用户点击角标后更新弹窗确实出现')
    await win.screenshot({ path: path.join(output, `${phase}-update-requested.png`) })
    await win.locator('[data-updater-dialog]').getByRole('button', { name: /关闭|Close/ }).click()
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('nomi:update:event', { type: 'downloaded', version: '0.99.0' })
    })
    await expect(win.locator('[data-update-badge]')).toBeVisible()
    await expectAbsent(win.locator('[data-updater-dialog]'), { provenBy: dialogProof, message: '用户关闭后下载完成不重新弹窗' })
  } else {
    await expect(win.locator('[data-updater-dialog]')).toBeVisible()
    await win.screenshot({ path: path.join(output, `${phase}-update-available.png`) })
  }
  console.log(JSON.stringify({ phase, folderChecks: 5, globalToasts: count, update: phase === 'after' ? 'explicit-only' : 'automatic-modal' }))
} finally {
  await app.close()
}
