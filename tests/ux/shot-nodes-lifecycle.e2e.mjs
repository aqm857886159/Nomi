import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, screenshotSettled } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { createProcessFixture } from './process-feedback-real-fixture.mjs'

const root = path.resolve('.')
const out = path.join(root, 'docs/plan/shot-nodes-evidence')
await fs.mkdir(out, { recursive: true })
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-shot-nodes-'))
const settingsDir = path.join(tempRoot, 'settings')
const fixture = await createProcessFixture(root, settingsDir)
const app = await launchNomiApp({ name: 'shot-nodes-lifecycle', tempRoot, settingsDir, settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi.canvas.batch-concurrency': '1' },
  env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:5199', NOMI_DISABLE_AUTO_UPDATE: '1' }, args: ['--no-proxy-server'] })
const page = app.win
const receipt = { paidCalls: 0, supplier: 'loopback; real UI/queue/store/materialization', screenshots: [], checks: [] }
async function capture(state) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.setAttribute('data-mantine-color-scheme', theme); localStorage.setItem('nomi-color-scheme', theme) }, theme)
    const name = `after-${state}-${theme}.png`
    await screenshotSettled(page, { path: path.join(out, name) })
    receipt.screenshots.push(name)
  }
}
try {
  page.setDefaultTimeout(stationTimeout({ operations: 4 }))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.getByRole('button', { name: /新建空白项目/ }).click()
  await page.locator('[data-project-card]').first().dblclick()
  await page.getByRole('button', { name: '生成', exact: true }).click()
  await expect(page.locator('.generation-canvas-v2__stage')).toBeVisible()
  await app.app.evaluate(async (_, root) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const store = require(root + '/dist-electron/assets/projectAssetStore.js')
    const original = store.importRemoteAsset
    let first = true
    globalThis.__shotNodeMaterialize = { received: false }
    store.importRemoteAsset = async (...args) => {
      if (first && args[0]?.kind === 'generated') {
        first = false
        globalThis.__shotNodeMaterialize.received = true
        await new Promise(resolve => { globalThis.__shotNodeMaterialize.release = resolve })
      }
      return original(...args)
    }
  }, root)
  const ids = []
  for (const prompt of ['傍晚河边，一位女孩望向远处的桥，电影画面。', '桥边的灯亮起来，暖色夜景。']) {
    await page.getByRole('button', { name: '添加图片节点', exact: true }).click()
    const node = page.locator('article[data-node-id]').last()
    await expect(node).toBeVisible()
    ids.push(await node.getAttribute('data-node-id'))
    await node.click({ position: { x: 40, y: 15 } })
    await page.locator('[contenteditable=true]:visible').first().fill(prompt)
  }
  await page.keyboard.press('Escape')
  const empty = await findCanvasBlankPoint(page)
  await page.mouse.click(empty.x, empty.y)
  await page.locator('[data-batch-scope=all]').click()
  await expect(page.getByText('开始生成', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '生成', exact: true }).last().click()
  await expect.poll(() => fixture.jobs.length).toBe(1)
  const first = page.locator(`article[data-node-id="${ids[0]}"]`)
  const second = page.locator(`article[data-node-id="${ids[1]}"]`)
  await page.getByRole('button', { name: '适应视图', exact: true }).click()
  await expect(second.locator('[data-node-inline-status] [data-generation-message]')).toHaveText('排队中')
  await capture('queued')
  await expect(first.locator('[data-node-inline-status] [data-generation-message]')).toContainText(/生成中.*已等 (1[2-9]|[2-9][0-9]) 秒/, { timeout: stationTimeout({ operations: 6 }) })
  await first.click({ position: { x: 40, y: 15 } })
  await capture('generating')
  fixture.jobs[0].done = true
  await expect.poll(() => app.app.evaluate(() => globalThis.__shotNodeMaterialize.received), { timeout: stationTimeout({ operations: 8 }) }).toBe(true)
  await page.evaluate(() => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(v => v.key === 'agent-runtime-loopback')
    catalog.upsertVendor({ ...vendor, enabled: false })
  })
  await app.app.evaluate(() => globalThis.__shotNodeMaterialize.release())
  await expect(first.locator('[data-node-inline-status] [data-generation-message]')).toContainText('已保存到项目', { timeout: stationTimeout({ operations: 8 }) })
  await expect(first.locator('[data-node-media-state=ready]')).toBeAttached()
  await capture('complete')
  await expect(second.locator('[role=alert]')).toContainText('这个模型没配好', { timeout: stationTimeout({ operations: 8 }) })
  await expect(second.locator('[data-node-inline-status] [data-generation-message]')).toContainText('模型未配置')
  await second.click({ position: { x: 40, y: 15 } })
  await capture('failed')
  receipt.checks.push('Queued from actual concurrency=1 batch, first operation completes through real asset localization, next fails after vendor is disabled')
  await page.evaluate(() => {
    const catalog = window.nomiDesktop.modelCatalog
    const vendor = catalog.listVendors().find(v => v.key === 'agent-runtime-loopback')
    catalog.upsertVendor({ ...vendor, enabled: true })
  })
  // Fix the real configuration, then use the node's existing generation action.
  const retry = second.getByRole('button', { name: '仍要重试', exact: true })
  if (await retry.isVisible()) await retry.click()
  else await page.getByRole('button', { name: '生成素材', exact: true }).click()
  const confirm = page.getByRole('button', { name: '生成', exact: true }).last()
  if (await page.getByText('开始生成', { exact: true }).isVisible()) await confirm.click()
  await expect.poll(() => fixture.jobs.length).toBe(2)
  fixture.jobs[1].done = true
  await expect(second.locator('[data-node-inline-status] [data-generation-message]')).toContainText('已保存到项目', { timeout: stationTimeout({ operations: 8 }) })
  await capture('retry-complete')
  receipt.checks.push('Existing node retry/generate action completes after configuration recovery')
} catch (error) {
  await page.screenshot({ path: path.join(out, 'lifecycle-FAIL.png') })
  console.error(error)
  console.error((await page.locator('body').innerText()).slice(-10000))
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(out, 'lifecycle-receipt.json'), JSON.stringify(receipt, null, 2))
  await app.close()
  await fixture.close()
}
