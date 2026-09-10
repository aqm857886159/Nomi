// Real isolated Electron renderer/preload/IPC/HTTPS/WS -> a browser acting as a phone.
// Validates real camera pixels and recording acknowledgement, not physical gyro hardware.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { expect, clickOrFail, expectVisible, proveProbe, expectAbsent, screenshotSettled } from './_assert.mjs'
import { addCameraPreset, placeCharacter } from './_directorLab.mjs'
import { createBlankProject, prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const shots = path.join(repoRoot, 'tests/ux/shots/director/mobile')
fs.mkdirSync(shots, { recursive: true })
const iso = prepareIsolation(path.join(repoRoot, '.tmp', `director-mobile-${Date.now().toString(36)}`), { requireCatalog: false })
const { app, win } = await launchNomiApp({ name: 'director-mobile', userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir, projectsDir: iso.projectsDir })
let browser
const errors = []
win.on('pageerror', (error) => errors.push(String(error)))
try {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('__nomiE2E', '1')
  })
  await win.reload()
  await expectVisible(win.getByText('新建空白项目', { exact: false }).first(), '项目库未打开', stationTimeout({ operations: 4 }))
  await createBlankProject(win, iso.projectsDir)
  await expectVisible(win.getByRole('button', { name: '生成', exact: true }).first(), '工作台未打开', stationTimeout({ operations: 4 }))
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }).first(), '生成区')
  const board = win.locator('button[aria-label^="新建一个"][aria-label$="节点"]').first()
  if (await board.count()) await board.click()
  await expectVisible(win.locator('[data-node-kind="director"]').first(), '导演台入口未出现', stationTimeout({ operations: 4 }))
  await win.keyboard.press('Escape')
  await win.mouse.click(60, 520)
  await clickOrFail(win.locator('[data-node-kind="director"]').first(), '添加导演台')
  await clickOrFail(win.getByTestId('director-node-open').first(), '进入导演台')
  await expectVisible(win.getByTestId('director-pip'), '导演台未渲染', stationTimeout({ operations: 4 }))
  await win.waitForFunction(() => {
    const point = window.__nomiDirectorE2E?.projectPoint(0, 0, 0)
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
  })
  const lab = { page: win, bridge: (method, ...args) => win.evaluate(([name, list]) => window.__nomiDirectorE2E?.[name](...list), [method, args]) }
  await placeCharacter(lab, 'female', 0, 0)
  await clickOrFail(win.getByTestId('director-outliner-row').filter({ hasText: '角色' }).first(), '选中角色')
  await addCameraPreset(lab, '正面中景')
  await clickOrFail(win.getByTestId('director-pip').getByRole('button', { name: '进入视角' }), '进入机位')
  await clickOrFail(win.getByRole('button', { name: '连接手机虚拟相机' }), '连接手机')
  await expectVisible(win.getByTestId('director-mobile-dialog').locator('code'), '局域网二维码未生成', stationTimeout({ operations: 4 }))
  const status = await win.evaluate(() => window.nomiDesktop.director.mobile.status())
  const url = new URL(status.urls[0])
  url.hostname = '127.0.0.1'
  browser = await chromium.launch({ headless: true, channel: process.env.NOMI_BROWSER_CHANNEL || 'chrome' })
  const phone = await browser.newPage({ viewport: { width: 960, height: 540 }, ignoreHTTPSErrors: true })
  phone.on('pageerror', (error) => errors.push(String(error)))
  await phone.goto(url.href)
  await expect(phone.locator('#dot')).toHaveClass('dot on')
  await phone.waitForFunction(() => {
    const image = document.getElementById('preview')
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
  }, null, { timeout: stationTimeout({ operations: 2 }) })
  const previewProof = await proveProbe(phone.locator('#preview:visible'), '手机监视器已显示有效机位帧')
  const frame = await phone.locator('#preview').evaluate((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const colors = new Set()
    for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]}-${pixels[i + 1]}-${pixels[i + 2]}`)
    return { width: canvas.width, height: canvas.height, colors: colors.size }
  })
  expect(Math.max(frame.width, frame.height)).toBeLessThanOrEqual(480)
  expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2)
  await expect(phone.locator('#hint')).toBeInViewport()
  expect(frame.colors).toBeGreaterThan(8)
  await screenshotSettled(phone, { path: path.join(shots, '01-camera-monitor.png') })
  console.log('✓ HTTPS/WS phone receives actual production camera pixels', frame)
  await phone.locator('#record').click()
  await expect(phone.locator('#record')).toHaveText('停止录制')
  await expectVisible(win.getByText(/录制中 ·/).first(), '远程开始未触发桌面录制')
  const stick = await phone.locator('#stick').boundingBox()
  await phone.mouse.move(stick.x + stick.width / 2 + 40, stick.y + stick.height / 2)
  await phone.mouse.down()
  await expect.poll(async () => {
    const text = await win.getByText(/录制中 ·/).first().textContent()
    return Number(text.match(/([\d.]+)s/)?.[1] ?? 0)
  }).toBeGreaterThan(0.6)
  await phone.mouse.up()
  await phone.locator('#record').click()
  await expect(phone.locator('#record')).toHaveText('开始录制')
  await expectVisible(win.locator('[data-clip-id][title^="路径片段"]').first(), '远程完成后没有运镜片段')
  await screenshotSettled(phone, { path: path.join(shots, '02-recording-complete.png') })
  await screenshotSettled(win, { path: path.join(shots, '03-desktop-connected.png') })
  console.log('✓ Remote start/stop follows desktop state and creates a motion clip')
  await win.getByTestId('director-mobile-dialog').getByRole('button', { name: '断开连接' }).click()
  await expect(phone.locator('#dot')).toHaveClass('dot')
  await expect(phone.locator('#record')).toBeDisabled()
  await expect(phone.locator('#preview')).not.toHaveAttribute('src', /.+/)
  await expectAbsent(phone.locator('#preview:visible'), { provenBy: previewProof, message: '断开后监视器图片持续隐藏，不能出现破图边框' })
  expect((await win.evaluate(() => window.nomiDesktop.director.mobile.status())).running).toBe(false)
  await screenshotSettled(phone, { path: path.join(shots, '04-disconnected.png') })
  expect(errors).toEqual([])
  fs.writeFileSync(path.join(shots, 'evidence.json'), JSON.stringify({ frame, recordingAcknowledged: true, disconnected: true, physicalPhoneTested: false }, null, 2))
  console.log('✓ Stop closes the service, clears the monitor and disables remote recording')
} finally {
  await browser?.close()
  await app.close()
}
