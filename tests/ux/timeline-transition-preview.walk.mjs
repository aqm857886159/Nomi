import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, expect, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests', 'ux', 'shots', 'timeline-transition-preview')
fs.mkdirSync(shotsDir, { recursive: true })

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-transition-preview-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
for (const directory of [userDataDir, settingsDir, projectsDir, capabilityDir]) {
  fs.mkdirSync(directory, { recursive: true })
}

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path

function encodeStill(output, color, boxColor, boxX) {
  const filter = `color=c=${color}:s=640x360,drawbox=x=${boxX}:y=70:w=180:h=220:color=${boxColor}:t=fill`
  const result = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-frames:v', '1', output], {
    timeout: 120_000,
  })
  if (result.status !== 0) {
    throw new Error(`Transition fixture encoding failed: ${result.stderr?.toString().slice(-500)}`)
  }
}

function seedProject({ id, name, type, updatedAt }) {
  const projectRoot = path.join(projectsDir, id)
  const importedDir = path.join(projectRoot, 'assets', 'imported')
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(importedDir, { recursive: true })

  const firstName = 'outgoing.png'
  const secondName = 'incoming.png'
  encodeStill(path.join(importedDir, firstName), '0xC84630', 'white', 70)
  encodeStill(path.join(importedDir, secondName), '0x176B87', '0xF2C14E', 390)
  const url = (fileName) =>
    `nomi-local://asset/${encodeURIComponent(id)}/assets/imported/${encodeURIComponent(fileName)}`

  const nodes = [
    {
      id: `${id}-outgoing`,
      kind: 'asset',
      categoryId: 'assets',
      title: 'Outgoing',
      position: { x: 100, y: 100 },
      status: 'success',
      meta: { source: 'local-drop', fileName: firstName, uploadStatus: 'uploaded' },
      result: { id: `${id}-outgoing-result`, type: 'image', url: url(firstName), createdAt: 1 },
    },
    {
      id: `${id}-incoming`,
      kind: 'asset',
      categoryId: 'assets',
      title: 'Incoming',
      position: { x: 520, y: 100 },
      status: 'success',
      meta: { source: 'local-drop', fileName: secondName, uploadStatus: 'uploaded' },
      result: { id: `${id}-incoming-result`, type: 'image', url: url(secondName), createdAt: 2 },
    },
  ]
  const timeline = {
    version: 1,
    fps: 30,
    scale: 4,
    playheadFrame: 35,
    tracks: [
      {
        id: 'imageTrack',
        type: 'image',
        label: 'Image',
        clips: [
          {
            id: `${id}-clip-outgoing`,
            type: 'image',
            sourceNodeId: `${id}-outgoing`,
            label: 'Outgoing',
            startFrame: 0,
            endFrame: 30,
            frameCount: 30,
            offsetStartFrame: 0,
            offsetEndFrame: 30,
            url: url(firstName),
          },
          {
            id: `${id}-clip-incoming`,
            type: 'image',
            sourceNodeId: `${id}-incoming`,
            label: 'Incoming',
            startFrame: 30,
            endFrame: 60,
            frameCount: 30,
            offsetStartFrame: 0,
            offsetEndFrame: 30,
            url: url(secondName),
          },
        ],
      },
      { id: 'videoTrack', type: 'video', label: 'Video', clips: [] },
      { id: 'audioTrack', type: 'audio', label: 'Audio', clips: [] },
    ],
    textClips: [],
    transitions: [
      {
        fromClipId: `${id}-clip-outgoing`,
        toClipId: `${id}-clip-incoming`,
        type,
        durationFrames: 10,
      },
    ],
  }
  const generationCanvas = {
    nodes,
    edges: [],
    selectedNodeIds: [],
    groups: [],
    canvasZoom: 1,
    canvasPan: { x: 0, y: 0 },
  }
  const payload = {
    workbenchDocument: null,
    timeline,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const record = {
    id,
    name,
    version: 2,
    createdAt: updatedAt,
    updatedAt,
    savedAt: updatedAt,
    revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null,
    timeline,
    generationCanvas,
    payload,
  }
  const serialized = JSON.stringify(record, null, 2)
  fs.writeFileSync(path.join(projectRoot, 'project.json'), serialized)
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), serialized)
}

seedProject({ id: 'transition-dissolve', name: 'Transition dissolve proof', type: 'dissolve', updatedAt: 2 })
seedProject({ id: 'transition-fade', name: 'Transition fade proof', type: 'fade', updatedAt: 1 })

let app
let win
const pageErrors = []

async function launch(name) {
  const launched = await launchNomiApp({
    name,
    userDataDir,
    settingsDir,
    projectsDir,
    capabilityDir,
    args: ['--disable-gpu', '--no-proxy-server'],
    timeout: 300_000,
    settleMs: 800,
  })
  app = launched.app
  win = launched.win
  win.on('pageerror', (error) => pageErrors.push(String(error)))
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef) => windowRef.setBounds({ x: 0, y: 0, width: 1440, height: 960 }))
}

async function close() {
  if (!app) return
  await app.close()
  app = undefined
  win = undefined
}

async function openTransitionProject(projectName, transitionType, expectedOpacities, screenshotName) {
  const card = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await expect(card, `${projectName} project card did not appear`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await card.click()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await expect(previewTab, 'Preview tab did not appear').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await previewTab.click()
  await expect(previewTab, 'Preview tab did not become active').toHaveAttribute('aria-current', 'page', {
    timeout: DEFAULT_TIMEOUT_MS,
  })

  const layer = win
    .locator(`.workbench-preview-player__stage .workbench-preview-transition[data-transition-type="${transitionType}"]`)
    .first()
  await expect(layer, `${transitionType} preview layer did not render`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(layer, `${transitionType} did not resolve the midpoint frame`).toHaveAttribute(
    'data-transition-progress',
    '0.500',
  )
  await expect(layer.locator('img'), `${transitionType} did not mount both media frames`).toHaveCount(2)
  await win.waitForFunction(
    (selector) => [...document.querySelectorAll(selector)].every((image) => image.complete && image.naturalWidth > 0),
    `.workbench-preview-player__stage .workbench-preview-transition[data-transition-type="${transitionType}"] img`,
    { timeout: DEFAULT_TIMEOUT_MS },
  )
  const visualState = await layer.evaluate((element) => ({
    backdrop: getComputedStyle(element).backgroundColor,
    opacities: [...element.children].slice(0, 2).map((child) => Number(getComputedStyle(child).opacity)),
    box: (() => {
      const rect = element.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height) }
    })(),
  }))
  expect(visualState.opacities, `${transitionType} opacity curve drifted`).toEqual(expectedOpacities)
  expect(visualState.box.width, `${transitionType} preview layer has no width`).toBeGreaterThan(300)
  expect(visualState.box.height, `${transitionType} preview layer has no height`).toBeGreaterThan(160)
  if (transitionType === 'fade') {
    expect(visualState.backdrop, 'Fade midpoint must be black').toBe('rgb(0, 0, 0)')
  }
  await screenshotSettled(win, { path: path.join(shotsDir, screenshotName) })
}

try {
  await launch('timeline-transition-preview-setup')
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    localStorage.setItem('nomi:locale:v1', 'en')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      localStorage.setItem(key, 'seen')
    }
  })
  await close()

  await launch('timeline-transition-preview-dissolve')
  await openTransitionProject('Transition dissolve proof', 'dissolve', [1, 0.5], '01-dissolve-midpoint.png')
  await close()

  await launch('timeline-transition-preview-fade')
  await openTransitionProject('Transition fade proof', 'fade', [0, 0], '02-fade-midpoint.png')
  expect(pageErrors, `Renderer page errors: ${pageErrors.join('\n')}`).toEqual([])
  console.log(`Timeline transition preview walkthrough passed. Screenshots: ${shotsDir}`)
} catch (error) {
  process.exitCode = 1
  console.error(error)
} finally {
  if (app) {
    try {
      await close()
    } catch (error) {
      process.exitCode = 1
      console.error('Failed to close Electron after transition walkthrough:', error)
    }
  }
}
