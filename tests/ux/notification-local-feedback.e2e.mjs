// Real React/Mantine component interactions with explicit desktop fault fixtures.
// This supplements the Electron journey; it does not claim full workflow coverage.
//
// 守的事（2026-09-09 通知策略，docs/plan/2026-09-09-notification-policy.md）：本地能处理的失败原地说清、不弹全局通知 / 模态——
// Codex 卡配置失败、制作失败、时间轴拒收跨项目素材；书签重命名在原地编辑；同一条后台失败五次只占一条通知（×5）、
// 关掉后从一次重新算；最新的错误不被计时器提前收走。
// 2026-11 起只跑修后这一半：原来的「before」阶段用 Vite 回放 1d565961f 的旧源码，旧源码 import 的模块早已删除
// （8cd6e8a01 删 src/desktop/activeProject），旧样子再也渲染不出来；那一半只证明「修前确实有全局通知」，
// 修后的每条断言不依赖它。探针的「测得到」基线改在本次运行里现场证明：全局通知用「Repeat once」真弹一条，
// 模态用打开着的浏览器对话框（role=dialog）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { expect } from '@playwright/test'
import { createServer } from 'vite'
import { screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { MIN_WINDOW } from './_minWindow.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(root, '.tmp/toast-policy-evidence')
fs.mkdirSync(output, { recursive: true })
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 5298, strictPort: true } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: MIN_WINDOW.width, height: MIN_WINDOW.height } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => { localStorage.setItem('nomi-color-scheme', 'light'); localStorage.setItem('nomi:locale:v1', 'zh-CN') })
  const open = async scenario => {
    await page.goto(`http://127.0.0.1:5298/tests/ux/fixtures/notification-local-feedback/index.html?scenario=${scenario}`)
    await expect(page.locator('[data-local-feedback-stage]')).toBeVisible()
  }
  const notification = page.locator('.mantine-Notification-root')

  // 探针基线：全局通知真弹一条再清掉；浏览器对话框是一个真 dialog。
  await open('repeat')
  await page.getByRole('button', { name: 'Repeat once', exact: true }).click()
  const notificationProof = await proveProbe(notification, '全局通知探针能找到真弹出的通知')
  await page.evaluate(() => window.__notificationFixture.clear())
  await expectAbsent(notification, { provenBy: notificationProof, message: '基线通知清掉后不残留' })
  await open('browser')
  const dialogProof = await proveProbe(page.getByRole('dialog'), '模态探针能找到打开着的浏览器对话框')

  // Codex 卡：配置写入失败原地显示，重试成功清掉旧错，不弹全局通知。
  await open('codex')
  await page.getByRole('button', { name: /启用|接入|开启/ }).last().click()
  await expect(page.getByRole('status')).toContainText('配置文件暂时无法写入')
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })
  await screenshotSettled(page, { path: path.join(output, 'after-codex-inline.png') })
  const errorProof = await proveProbe(page.getByRole('status'), '配置失败已在本卡显示')
  await page.evaluate(() => window.__notificationFixture.recoverCodex())
  await page.getByRole('button', { name: /启用|接入|开启/ }).last().click()
  await expectAbsent(page.getByRole('status'), { provenBy: errorProof, message: '成功重试清除配置错误' })
  await expect(page.getByRole('button', { name: /关闭/ })).toBeVisible()
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })
  await screenshotSettled(page, { path: path.join(output, 'after-codex-retry.png') })

  // 制作：失败写在操作旁、不弹模态；重试成功清旧错。
  await open('production')
  await page.locator('[data-production-primary-action]').click()
  await expect(page.locator('[data-production-action-error]')).toContainText('制作记录暂时无法写入')
  await expectAbsent(page.getByRole('dialog'), { provenBy: dialogProof, message: '制作失败原地说明不弹模态' })
  await screenshotSettled(page, { path: path.join(output, 'after-production-inline.png') })
  const failureProof = await proveProbe(page.locator('[data-production-action-error]'), '制作失败显示在操作旁')
  await page.evaluate(() => window.__notificationFixture.recoverProduction())
  await page.locator('[data-production-primary-action]').click()
  await expectAbsent(page.locator('[data-production-action-error]'), { provenBy: failureProof, message: '制作成功重试清除旧错' })
  await expect(page.locator('[data-production-control="pause"]')).toBeVisible()
  assert.equal((await page.evaluate(() => window.__notificationFixture.state())).commandCalls, 2)

  // 时间轴：拒收跨项目素材原地说明。
  await open('timeline')
  const transfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer()
    dt.setData('application/x-nomi-asset-ref', JSON.stringify({ kind: 'audio', name: 'music.mp3', renderUrl: 'nomi-local://asset/other/assets/music.mp3', origin: { source: 'project', projectId: 'other', relativePath: 'assets/music.mp3' } }))
    return dt
  })
  await page.locator('.workbench-timeline-track__clips').dispatchEvent('drop', { dataTransfer: transfer })
  await expect(page.locator('[data-timeline-track-feedback]')).not.toBeEmpty()
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })
  await screenshotSettled(page, { path: path.join(output, 'after-timeline-inline.png') })

  // 书签重命名：原地输入框，Enter 保存、Esc 放弃。
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

  // 重复通知：五次只占一条（×5），点重试执行第 5 次的回调；关掉后新事件从一次算；最新错误不被提前收走。
  await open('repeat')
  await page.getByRole('button', { name: 'Repeat five', exact: true }).click()
  await expect(notification).toHaveCount(1)
  const counts = await page.evaluate(() => window.__notificationFixture.state())
  assert.equal(counts.queued, 0)
  await screenshotSettled(page, { path: path.join(output, 'after-repeat-five.png') })
  await expect(page.locator('[data-notification-occurrences]')).toHaveText('×5')
  const countProof = await proveProbe(page.locator('[data-notification-occurrences]'), '重复通知已显示次数')
  await expect(notification).toContainText('后台任务失败 5')
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.locator('[data-action-result]')).toHaveText('5')
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })
  await page.getByRole('button', { name: 'Repeat once', exact: true }).click()
  await expect(notification).toHaveCount(1)
  await expectAbsent(page.locator('[data-notification-occurrences]'), { provenBy: countProof, message: '关闭后的新事件从一次开始，不显示重复次数' })
  await page.evaluate(() => window.__notificationFixture.clear())
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })
  await page.clock.install()
  await page.evaluate(() => window.__notificationFixture.timedError('首次错误'))
  await page.clock.runFor(900)
  await page.evaluate(() => window.__notificationFixture.timedError('最新错误仍需处理'))
  await page.clock.runFor(5000)
  await expect(notification).toHaveCount(1)
  await expect(notification).toContainText('最新错误仍需处理')
  await page.locator('.mantine-Notification-closeButton').click()
  await page.clock.runFor(500)
  await expectAbsent(notification, { provenBy: notificationProof, message: '原地反馈或已处理通知不应残留全局提示' })

  assert.deepEqual(pageErrors, [], 'No uncaught browser errors')
  fs.writeFileSync(path.join(output, 'after-local-feedback-receipt.json'), JSON.stringify({ phase: 'after', pageErrors, counts, retryVerified: true }, null, 2))
  console.log(JSON.stringify({ phase: 'after', components: ['CodexLocalImageCard', 'useProductionStatus/ProductionRunTaskCard', 'TimelineTrack', 'NomiBrowserDialog', 'toast'], repeat: counts, screenshots: output }))
} finally { await browser?.close(); await server.close() }
