import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { expect } from '@playwright/test'

import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { seedFinishedJourneyProject } from './fixtures/journey-project-fixture.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-model3d-asset-library-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
const outDir = path.join(repoRoot, '.model3d-asset-library-walk')
const projectName = '3D 素材闭环走查'
const modelName = 'meshy-7-turntable.glb'
const sourceModel = path.join(repoRoot, 'src', 'assets', 'ue-mannequin-retopology.glb')
const downloadPath = path.join(root, 'downloads', modelName)

fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(path.dirname(downloadPath), { recursive: true })
const fixture = seedFinishedJourneyProject({ projectsDir, projectId: 'model3d-asset-library', projectName })
const storedModel = path.join(fixture.projectRoot, 'assets', 'generated', modelName)
fs.copyFileSync(sourceModel, storedModel)
fs.writeFileSync(`${storedModel}.meta`, JSON.stringify({
  kind: 'generated',
  mediaType: 'model3d',
  provider: 'meshy',
  modelKey: 'meshy-7',
}))

let assertions = 0
function check(condition, label, detail = '') {
  if (!condition) throw new Error(`MODEL3D WALK FAIL: ${label}${detail ? ` (${detail})` : ''}`)
  assertions += 1
  console.log(`  ok ${label}${detail ? ` (${detail})` : ''}`)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function imageLumaRange(imagePath) {
  const analyzed = require('node:child_process').spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', imagePath,
    '-vf', 'signalstats,metadata=print:file=-', '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 30_000 })
  if (analyzed.status !== 0) {
    throw new Error(`MODEL3D WALK FAIL: canvas pixel analysis failed: ${analyzed.stderr?.slice(-500)}`)
  }
  const minimum = Number(/lavfi\.signalstats\.YMIN=(\d+)/.exec(analyzed.stdout)?.[1])
  const maximum = Number(/lavfi\.signalstats\.YMAX=(\d+)/.exec(analyzed.stdout)?.[1])
  return { minimum, maximum, range: maximum - minimum }
}

function boxesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
}

async function launch(name) {
  const instance = await launchNomiApp({
    name,
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    args: ['--no-proxy-server'],
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
    settleMs: 2200,
  })
  await instance.win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await instance.win.reload()
  await instance.win.waitForLoadState('domcontentloaded')
  return instance
}

async function setWindowSize(instance, width, height) {
  const browserWindow = await instance.app.browserWindow(instance.win)
  await browserWindow.evaluate((window, bounds) => window.setBounds({ x: 0, y: 0, ...bounds }), { width, height })
  await instance.win.waitForTimeout(500)
}

async function openProjectAssetLibrary(win) {
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await projectCard.waitFor({ state: 'visible', timeout: 12_000 })
  await projectCard.click()
  await win.locator('[data-workspace-mode]').waitFor({ state: 'visible', timeout: 12_000 })
  await win.getByRole('button', { name: /^(生成|Generate)$/ }).first().click({ timeout: 12_000 })
  const assetTab = win.getByRole('button', { name: /素材库|Asset library/ }).first()
  if (await assetTab.count()) await assetTab.click()
  const projectTab = win.getByRole('tab', { name: /项目素材|Project assets/ }).first()
  await projectTab.waitFor({ state: 'visible', timeout: 12_000 })
  await projectTab.click()
  const tile = win.getByRole('button', { name: modelName, exact: true }).first()
  await tile.waitFor({ state: 'visible', timeout: 12_000 })
  return tile
}

async function filterToModel3d(win) {
  const filter = win.getByRole('button', { name: /筛选素材分类|Filter asset categories/ }).first()
  await filter.click()
  const menu = win.getByRole('dialog', { name: /素材分类筛选|Asset category filter/ }).first()
  await menu.waitFor({ state: 'visible' })
  for (const label of [/图片|Images/, /视频|Videos/, /音频|Audio/]) {
    const option = menu.getByRole('option').filter({ hasText: label }).first()
    check(await option.getAttribute('aria-selected') === 'true', 'filter starts with category enabled', String(label))
    await option.click()
  }
  const model3d = menu.getByRole('option').filter({ hasText: /^3D/ }).first()
  check(await model3d.getAttribute('aria-selected') === 'true', '3D category remains enabled')
  await filter.click()
}

async function openAndInspectModel(instance, passName) {
  const { win } = instance
  const tile = await openProjectAssetLibrary(win)
  await filterToModel3d(win)
  check(await tile.isVisible(), `${passName}: generated GLB is visible after 3D filtering`)
  check(!(await win.getByRole('button', { name: '① 黄昏小巷', exact: true }).isVisible().catch(() => false)), `${passName}: image assets are filtered out`)
  await win.screenshot({ path: path.join(outDir, `${passName}-01-library.png`) })

  await tile.dblclick()
  const dialog = win.getByRole('dialog', { name: new RegExp(modelName.replace('.', '\\.')) }).first()
  await dialog.waitFor({ state: 'visible', timeout: 12_000 })
  const canvas = dialog.locator('canvas').first()
  await canvas.waitFor({ state: 'visible', timeout: 20_000 })
  await win.waitForTimeout(1800)

  const firstPath = path.join(outDir, `${passName}-02-preview.png`)
  const firstImage = await canvas.screenshot({ path: firstPath })
  const firstStats = imageLumaRange(firstPath)
  check(Number.isFinite(firstStats.range) && firstStats.range >= 24, `${passName}: WebGL canvas contains nonblank model pixels`, `luma ${firstStats.minimum}-${firstStats.maximum}`)

  await win.waitForTimeout(1400)
  const autoImage = await canvas.screenshot({ path: path.join(outDir, `${passName}-03-auto-rotate.png`) })
  check(sha256(firstImage) !== sha256(autoImage), `${passName}: automatic turntable changes the rendered frame`)

  const bounds = await canvas.boundingBox()
  check(Boolean(bounds && bounds.width > 200 && bounds.height > 200), `${passName}: preview has a stable inspection viewport`)
  if (!bounds) throw new Error('MODEL3D WALK FAIL: canvas bounds unavailable')
  await win.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.52)
  await win.mouse.down()
  await win.mouse.move(bounds.x + bounds.width * 0.34, bounds.y + bounds.height * 0.42, { steps: 12 })
  await win.mouse.up()
  await win.waitForTimeout(500)
  const draggedImage = await canvas.screenshot({ path: path.join(outDir, `${passName}-04-drag-rotate.png`) })
  check(sha256(autoImage) !== sha256(draggedImage), `${passName}: pointer drag rotates the model`)

  return { dialog, canvas }
}

let first
let second
try {
  first = await launch('model3d-asset-library-first')
  await setWindowSize(first, 1440, 920)
  const firstPreview = await openAndInspectModel(first, 'desktop')

  await first.app.evaluate(({ dialog }, targetPath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath: targetPath }),
    })
  }, downloadPath)
  const download = firstPreview.dialog.getByRole('button', { name: /下载 GLB|Download GLB/ }).first()
  await download.click()
  await first.win.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => /下载 GLB|Download GLB/.test(item.getAttribute('aria-label') || ''))
    return Boolean(button && !button.disabled)
  })
  // The desktop bridge streams the GLB to disk: the file appears (0 bytes) before its bytes finish
  // flushing, so gate the byte checks on the download having fully landed — size matches the managed
  // source asset — otherwise readFileSync races a half-written file on slow CI (same write race as
  // canvas-card-stack's history-image download).
  await expect
    .poll(() => (fs.existsSync(downloadPath) ? fs.statSync(downloadPath).size : -1), {
      message: 'GLB 下载桥接应写出与受管资产等长的完整文件',
      timeout: 10_000,
    })
    .toBe(fs.statSync(storedModel).size)
  check(fs.existsSync(downloadPath), 'download button saves a GLB through the desktop bridge')
  check(sha256(fs.readFileSync(downloadPath)) === sha256(fs.readFileSync(storedModel)), 'downloaded GLB bytes match the managed asset')

  await setWindowSize(first, 760, 760)
  const closeButton = firstPreview.dialog.getByRole('button', { name: /关闭预览|Close preview/ }).first()
  const narrowDownload = firstPreview.dialog.getByRole('button', { name: /下载 GLB|Download GLB/ }).first()
  const [dialogBox, canvasBox, closeBox, downloadBox, viewport] = await Promise.all([
    firstPreview.dialog.boundingBox(),
    firstPreview.canvas.boundingBox(),
    closeButton.boundingBox(),
    narrowDownload.boundingBox(),
    first.win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ])
  check(Boolean(dialogBox && dialogBox.x >= 0 && dialogBox.y >= 0 && dialogBox.width <= viewport.width && dialogBox.height <= viewport.height), 'narrow window keeps the preview dialog inside the viewport')
  check(Boolean(canvasBox && canvasBox.width >= 420 && canvasBox.height >= 320), 'narrow window retains a usable 3D viewport')
  check(Boolean(closeBox && downloadBox && !boxesOverlap(closeBox, downloadBox)), 'narrow window keeps download and close controls separate')
  await first.win.screenshot({ path: path.join(outDir, 'desktop-05-narrow.png') })

  await first.win.keyboard.press('Escape')
  await firstPreview.dialog.waitFor({ state: 'detached' })
  await first.close()
  first = null

  second = await launch('model3d-asset-library-restart')
  await setWindowSize(second, 1280, 840)
  const restored = await openAndInspectModel(second, 'restart')
  check(await restored.dialog.isVisible(), 'fresh Electron process restores the generated 3D asset and preview')

  console.log(`MODEL3D ASSET LIBRARY PASS: ${assertions} assertions`)
  console.log(`Screenshots: ${outDir}`)
} finally {
  if (first) await first.close().catch(() => undefined)
  if (second) await second.close().catch(() => undefined)
}
