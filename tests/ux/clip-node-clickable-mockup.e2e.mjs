import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const mockupPath = path.join(repoRoot, 'docs/design/mockups/2026-08-15-clip-node-export-workflow.html')
const desktopShot = path.join(repoRoot, 'docs/design/mockups/2026-08-15-clip-node-export-workflow-desktop.png')
const mobileShot = path.join(repoRoot, 'docs/design/mockups/2026-08-15-clip-node-export-workflow-mobile.png')
const fixture = path.join(repoRoot, 'tests/ux/fixtures/test-upload.png')
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })

const clipIds = () => page.locator('[data-testid="clip"]').evaluateAll((clips) => clips.map((clip) => clip.dataset.clipId))
const openExport = async () => {
  const menu = page.getByRole('dialog', { name: '导出选项' })
  if (!(await menu.isVisible().catch(() => false))) await page.getByRole('button', { name: '导出', exact: true }).click()
  await menu.waitFor({ state: 'visible' })
  return menu
}
const runExport = async (scope, destination) => {
  const menu = await openExport()
  await menu.getByRole('radio', { name: scope }).click()
  await menu.getByRole('button', { name: destination, exact: true }).click()
}

try {
  await page.goto(pathToFileURL(mockupPath).href)
  await page.waitForLoadState('load')

  assert.equal(await page.locator('[data-testid="clip"]').count(), 4, '默认有 4 个片段')
  const programMonitor = page.getByRole('region', { name: '成片预览' })
  assert.equal(await programMonitor.isVisible(), false, '未点击时只显示剪辑条')

  await page.locator('[data-testid="clip"]').nth(1).click()
  await programMonitor.waitFor({ state: 'visible' })
  const axisAfter = await page.getByRole('region', { name: '时间线' }).boundingBox()
  const previewBox = await programMonitor.boundingBox()
  assert(axisAfter && previewBox, '成片监视器与剪辑轴都有可测几何')
  assert(previewBox.y + previewBox.height < axisAfter.y, '成片监视器位于剪辑轴上方')
  assert.equal(await programMonitor.getByRole('button', { name: /分割|复制|删除/ }).count(), 0, '成片监视器不承载片段编辑命令')
  assert.match(await page.locator('#playTime').textContent(), /^00:\d{2} \/ 00:26$/, '监视器展示全局时间与成片总长')

  await page.locator('#programSeek').evaluate((input) => {
    input.value = '4.85'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(await programMonitor.getAttribute('data-active-clip-id'), 'clip-1', '切点前显示第一段画面')
  await page.getByRole('button', { name: '播放成片' }).click()
  await page.waitForFunction(() => document.querySelector('#previewPanel')?.dataset.activeClipId === 'clip-2', null, { timeout: 3000 })
  assert(Number(await page.locator('#programSeek').inputValue()) >= 5, '跨过切点后全局时间继续增加')
  await page.getByRole('button', { name: '暂停成片' }).click()

  const orderBefore = await clipIds()
  await page.locator('[data-testid="clip"]').first().dragTo(page.locator('[data-testid="clip"]').nth(2))
  const orderAfter = await clipIds()
  assert.notDeepEqual(orderAfter, orderBefore, '拖动片段会改变顺序')

  await page.locator('[data-testid="clip"]').first().click()
  const totalBeforeTrim = await page.locator('#totalDuration').textContent()
  const trimHandle = page.getByRole('button', { name: '调整片段出点' })
  const trimBox = await trimHandle.boundingBox()
  assert(trimBox, '选中片段显示裁切把手')
  await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(trimBox.x + trimBox.width / 2 + 40, trimBox.y + trimBox.height / 2, { steps: 8 })
  await page.mouse.up()
  assert.notEqual(await page.locator('#totalDuration').textContent(), totalBeforeTrim, '拖动裁切把手会改变总时长')

  const countBeforeSplit = await page.locator('[data-testid="clip"]').count()
  await page.keyboard.press('s')
  assert.equal(await page.locator('[data-testid="clip"]').count(), countBeforeSplit + 1, '分割产生新片段')
  await page.keyboard.press('Control+d')
  assert.equal(await page.locator('[data-testid="clip"]').count(), countBeforeSplit + 2, '复制产生新片段')
  await page.keyboard.press('Delete')
  assert.equal(await page.locator('[data-testid="clip"]').count(), countBeforeSplit + 1, '删除移除当前片段')

  await page.getByRole('button', { name: '添加素材' }).click()
  await page.getByRole('dialog', { name: '添加片段' }).waitFor({ state: 'visible' })
  const countBeforeImport = await page.locator('[data-testid="clip"]').count()
  await page.locator('#fileInput').setInputFiles(fixture)
  assert.equal(await page.locator('[data-testid="clip"]').count(), countBeforeImport + 1, '文件导入后片段数增加')
  assert.match(await page.locator('[data-testid="clip"][aria-pressed="true"]').getAttribute('aria-label'), /test-upload/, '导入片段立即成为时间线当前选择')
  assert.match(await page.locator('#programClipLabel').textContent(), /test-upload/, '成片监视器定位到导入片段在整片中的位置')

  let menu = await openExport()
  const menuBox = await menu.boundingBox()
  const monitorBox = await programMonitor.boundingBox()
  assert(menuBox && monitorBox && (menuBox.x + menuBox.width <= monitorBox.x || menuBox.x >= monitorBox.x + monitorBox.width || menuBox.y + menuBox.height <= monitorBox.y || menuBox.y >= monitorBox.y + monitorBox.height), '导出浮层不遮挡成片预览')
  await menu.getByRole('radio', { name: /独立片段/ }).click()
  await menu.getByRole('button', { name: '到画布', exact: true }).click()
  const currentClipCount = await page.locator('[data-testid="clip"]').count()
  assert.equal(await page.locator('[data-testid="output-node"]').count(), currentClipCount, '分段到画布生成与片段等量的节点')
  await page.waitForFunction((count) => document.querySelectorAll('[data-testid="output-edge"]').length === count, currentClipCount)
  assert.equal(await page.locator('[data-testid="output-edge"]').count(), currentClipCount, '每个分段输出都有来源连线')

  await runExport('完整成片', '到画布')
  assert.equal(await page.locator('[data-testid="output-node"]').count(), 1, '完整视频到画布只生成一个节点')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="output-edge"]').length === 1)
  assert.equal(await page.locator('[data-testid="output-edge"]').count(), 1, '完整视频输出保留来源连线')

  const fullDownloadPromise = page.waitForEvent('download')
  await runExport('完整成片', '下载')
  const fullDownload = await fullDownloadPromise
  assert.equal(fullDownload.suggestedFilename(), 'nomi-full-cut.mp4', '完整视频下载文件名明确')

  const segmentDownloadPromise = page.waitForEvent('download')
  await runExport(/独立片段/, '下载')
  const segmentDownload = await segmentDownloadPromise
  assert.match(segmentDownload.suggestedFilename(), /^nomi-segments-\d+\.zip$/, '独立片段下载带当前片段数')

  await page.reload()
  await page.waitForLoadState('load')
  await runExport(/独立片段/, '到画布')
  await page.locator('[data-testid="clip"]').nth(1).click()
  await page.screenshot({ path: desktopShot, fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.waitForLoadState('load')
  await page.locator('[data-testid="clip"]').nth(1).click()
  await runExport(/独立片段/, '到画布')
  await page.locator('[data-testid="clip"]').nth(1).click()
  const mobileMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }))
  assert(mobileMetrics.scrollWidth <= mobileMetrics.viewportWidth, '窄屏没有横向溢出')
  const mobilePreview = await page.getByRole('region', { name: '成片预览' }).boundingBox()
  const mobileAxis = await page.getByRole('region', { name: '时间线' }).boundingBox()
  assert(mobilePreview && mobileAxis && mobilePreview.y >= 56 && mobilePreview.y + mobilePreview.height < mobileAxis.y, '窄屏预览不盖顶栏且仍位于轴上方')
  await page.screenshot({ path: mobileShot, fullPage: true })

  console.log(JSON.stringify({
    compactPreview: true,
    continuousProgramMonitor: true,
    crossCutPlayback: true,
    timelineOnlyEditCommands: true,
    dragReorder: true,
    trimDrag: true,
    splitDuplicateDelete: true,
    fileImport: true,
    fullCanvasExport: true,
    segmentCanvasExport: true,
    fullDownload: true,
    segmentDownload: true,
    outputEdges: true,
    desktopShot,
    mobileShot,
  }))
} finally {
  await browser.close()
}
