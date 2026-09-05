// 真实用户任务：在画布剪辑节点内预览、剪辑、导入，并走完四条导出路径。
// 零模型额度：使用隔离项目和本地媒体；导出走真实 Electron/ffmpeg 链路。
// 用法：pnpm run build && node tests/ux/clip-node-editing.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'
import { findEdgeHitPoint } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ffprobePath = require('@ffprobe-installer/ffprobe').path
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-clip-node-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'clip-node-editing-walk'
const projectRoot = path.join(projectsDir, `clip-node-editing-${projectId}`)
const generatedAssetsDir = path.join(projectRoot, 'assets', 'generated')
const screenshots = {
  compact: path.join(os.tmpdir(), 'nomi-clip-node-compact.png'),
  isolatedDrag: path.join(os.tmpdir(), 'nomi-clip-node-isolated-drag.png'),
  isolatedSnap: path.join(os.tmpdir(), 'nomi-clip-node-isolated-snap.png'),
  preview: path.join(os.tmpdir(), 'nomi-clip-node-preview.png'),
  exportMenu: path.join(os.tmpdir(), 'nomi-clip-node-export-menu.png'),
  outputs: path.join(os.tmpdir(), 'nomi-clip-node-outputs.png'),
  imported: path.join(os.tmpdir(), 'nomi-clip-node-imported-video.png'),
  videoResize: path.join(os.tmpdir(), 'nomi-clip-node-imported-video-resize.png'),
  imageResize: path.join(os.tmpdir(), 'nomi-clip-node-imported-image-resize.png'),
}
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(generatedAssetsDir, { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'), path.join(generatedAssetsDir, 'fixture.png'))
const fixtureVideoPath = path.join(generatedAssetsDir, 'fixture.mp4')
const importedVideoPath = path.join(root, 'twelve-seconds-with-audio.mp4')
// Two-core Linux runners can need more than two minutes for the real 1080p x264-medium export.
const exportTimeoutMs = 300_000
const encodeFixture = (output, duration) => execFileSync(ffmpegPath, [
  '-v', 'error', '-y',
  '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=24:duration=${duration}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${duration}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
  output,
])
encodeFixture(fixtureVideoPath, 2)
encodeFixture(importedVideoPath, 12)

const imageUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/fixture.png`
const videoUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/fixture.mp4`
const imageNode = {
  id: 'canvas-image-source', kind: 'image', categoryId: 'shots', title: '画布图片',
  position: { x: 80, y: 100 }, exactPosition: true, size: { width: 260, height: 200 }, status: 'success',
  result: { id: 'canvas-image-source-result', type: 'image', url: imageUrl, createdAt: 1 },
}
const videoNode = {
  id: 'canvas-video-source', kind: 'video', categoryId: 'shots', title: '画布视频',
  position: { x: 80, y: 380 }, exactPosition: true, size: { width: 260, height: 200 }, status: 'success',
  result: { id: 'canvas-video-source-result', type: 'video', url: videoUrl, durationSeconds: 2, createdAt: 1 },
}
const seedClips = [
  { id: 'image-a', sourceNodeId: imageNode.id, type: 'image', label: '开场', url: imageUrl, durationSeconds: 2, trimStart: 0, trimEnd: 2 },
  { id: 'video-b', sourceNodeId: videoNode.id, type: 'video', label: '推进', url: videoUrl, durationSeconds: 2, trimStart: 0, trimEnd: 2 },
  { id: 'image-c', sourceNodeId: imageNode.id, type: 'image', label: '转场', url: imageUrl, durationSeconds: 2, trimStart: 0, trimEnd: 2 },
  { id: 'video-d', sourceNodeId: videoNode.id, type: 'video', label: '收束', url: videoUrl, durationSeconds: 2, trimStart: 0, trimEnd: 2 },
]
const clipNode = {
  id: 'canvas-clip-editor', kind: 'clip', categoryId: 'shots', title: '画布剪辑',
  position: { x: 450, y: 300 }, exactPosition: true, size: { width: 760, height: 140 }, status: 'idle',
  meta: { clip: { nodeRole: 'clip', sourceNodeIds: seedClips.map((clip) => clip.id), clips: seedClips } },
}
const isolatedClip = {
  id: 'canvas-isolated-clip', kind: 'clip', categoryId: 'shots', title: '单素材剪辑',
  position: { x: 450, y: 520 }, exactPosition: true, size: { width: 760, height: 140 }, status: 'idle',
  meta: {
    clip: {
      nodeRole: 'clip',
      sourceNodeIds: ['isolated-image'],
      clips: [{ ...seedClips[0], id: 'isolated-image', label: '单素材' }],
    },
  },
}
const generationCanvas = {
  nodes: [imageNode, videoNode, clipNode, isolatedClip],
  edges: [
    { id: 'edge-image-clip', source: imageNode.id, target: clipNode.id, mode: 'reference', order: 0 },
    { id: 'edge-video-clip', source: videoNode.id, target: clipNode.id, mode: 'reference', order: 1 },
    { id: 'edge-image-isolated-clip', source: imageNode.id, target: isolatedClip.id, mode: 'reference', order: 0 },
  ],
  selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 },
}
const payload = { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: '画布剪辑节点走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, ...payload, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const launched = await launchNomiApp({ name: 'clip-node-editing', userDataDir: settingsDir, settingsDir, projectsDir, settleMs: 1200 })
const { app, win } = launched

async function dismissOnboarding() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.keyboard.press('Escape').catch(() => {})
  for (let index = 0; index < 4; index += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if ((await skip.count()) > 0) await skip.click({ timeout: 800 }).catch(() => {})
  }
}

async function openCanvas() {
  await dismissOnboarding()
  await win.reload()
  await win.waitForTimeout(1000)
  const projectCard = win.locator('[data-project-card]', { hasText: '画布剪辑节点走查' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const continueButton = projectCard.getByText('继续创作', { exact: false }).first()
    if ((await continueButton.count()) > 0) await continueButton.click()
    else await projectCard.dblclick()
  }
  await win.getByRole('button', { name: '生成', exact: true }).first().click().catch(() => {})
  const node = win.locator('[data-clip-node="true"][data-node-id="canvas-clip-editor"]')
  await node.waitFor({ state: 'visible', timeout: 8000 })
  await node.click({ position: { x: 20, y: 20 } })
  return node
}

async function resetExportTrace() {
  await win.evaluate(() => {
    const previous = globalThis.__nomiClipExportTrace
    previous?.unsubscribe?.()
    previous?.observer?.disconnect?.()

    const events = []
    const notifications = []
    const notificationSelector = '[role="alert"], .mantine-Notification-root'
    const baseline = new Set(Array.from(document.querySelectorAll(notificationSelector)).map((element) => element.textContent?.trim()).filter(Boolean))
    const captureNotifications = () => {
      for (const element of document.querySelectorAll(notificationSelector)) {
        const message = element.textContent?.trim()
        if (message && !baseline.has(message) && !notifications.includes(message)) notifications.push(message)
      }
    }
    const observer = new MutationObserver(captureNotifications)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const unsubscribe = globalThis.nomiDesktop?.exports?.onEvent?.((event) => {
      events.push(event)
      if (events.length > 50) events.shift()
    })
    globalThis.__nomiClipExportTrace = { events, notifications, observer, unsubscribe }
  })
}

async function collectExportDiagnostics() {
  const renderer = await win.evaluate(async () => {
    const trace = globalThis.__nomiClipExportTrace
    const compactSnapshot = (snapshot) => snapshot ? ({
      id: snapshot.id,
      status: snapshot.status,
      progress: snapshot.progress,
      error: snapshot.error,
      result: snapshot.result,
      updatedAt: snapshot.updatedAt,
    }) : null
    const events = (trace?.events ?? []).slice(-12).map((event) => ({
      type: event.type,
      jobId: event.jobId,
      snapshot: compactSnapshot(event.snapshot),
    }))
    const jobId = events.at(-1)?.jobId ?? null
    let status = null
    if (jobId) {
      try {
        status = compactSnapshot(await globalThis.nomiDesktop?.exports?.status?.(jobId))
      } catch (error) {
        status = { error: error instanceof Error ? error.message : String(error) }
      }
    }
    return { jobId, status, events, notifications: trace?.notifications ?? [] }
  })

  const files = {}
  if (renderer.jobId) {
    const jobDir = path.join(projectRoot, '.nomi', 'jobs', renderer.jobId)
    for (const name of ['ffmpeg.log', 'export.log', 'error.json', 'job.json']) {
      const filePath = path.join(jobDir, name)
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf8')
      files[name] = content.slice(-12_000)
    }
  }
  return { ...renderer, files }
}

async function runExport(scope, destination, expectedToast) {
  await resetExportTrace()
  const menu = win.getByTestId('clip-node-export-menu')
  const mainClipNode = win.locator('[data-clip-node="true"][data-node-id="canvas-clip-editor"]')
  if (!(await menu.isVisible().catch(() => false))) await mainClipNode.getByTestId('clip-node-export').click()
  await menu.getByRole('radio', { name: scope }).click()
  await menu.getByRole('button', { name: destination, exact: true }).click()
  try {
    const outcome = await Promise.race([
      win.getByText(expectedToast, { exact: false }).waitFor({ state: 'visible', timeout: exportTimeoutMs }).then(() => 'success'),
      win.waitForFunction((expected) => {
        const trace = globalThis.__nomiClipExportTrace
        return trace?.events?.some((event) => ['failed', 'cancelled'].includes(event?.snapshot?.status))
          || trace?.notifications?.some((message) => !message.includes(expected))
      }, expectedToast, { timeout: exportTimeoutMs }).then(() => 'failed'),
    ])
    if (outcome === 'failed') throw new Error('export reported a failure before the success notification')
  } catch (error) {
    const diagnostics = await collectExportDiagnostics()
    throw new Error(`Export did not complete: ${JSON.stringify(diagnostics)}`, { cause: error })
  }
}

async function closeApp() {
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  fs.rmSync(root, { recursive: true, force: true })
}

function persistedClipStart(clipId) {
  for (const projectFile of [path.join(projectRoot, '.nomi', 'project.json'), path.join(projectRoot, 'project.json')]) {
    const persisted = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    const canvas = persisted.payload?.generationCanvas ?? persisted.generationCanvas
    const node = canvas?.nodes?.find((candidate) => candidate.id === isolatedClip.id)
    const source = node?.meta?.clip?.clips?.find((candidate) => candidate.id === clipId)
    if (source) return source.timelineStartFrame ?? 0
  }
  return null
}

async function waitForPersistedClipStart(clipId, expected) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const startFrame = persistedClipStart(clipId)
    if (startFrame === expected) return startFrame
    await win.waitForTimeout(200)
  }
  return persistedClipStart(clipId)
}

async function dragClipEnd(material, deltaX, screenshotPath) {
  const before = await material.boundingBox()
  const beforeEndFrame = Number(await material.getAttribute('data-persisted-end-frame'))
  const handle = material.getByRole('button', { name: '调整片段出点', exact: true })
  const clipId = await material.getAttribute('data-clip-id')
  if (!before || !clipId) throw new Error('找不到片段出点把手')
  let started = false
  for (let attempt = 0; attempt < 3 && !started; attempt += 1) {
    if (await material.getAttribute('data-selected') !== 'true') {
      await material.click({ position: { x: before.width / 2, y: before.height / 2 } })
    }
    await handle.scrollIntoViewIfNeeded()
    await handle.hover()
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('找不到片段出点把手')
    const startX = handleBox.x + handleBox.width / 2
    const startY = handleBox.y + handleBox.height / 2
    await win.mouse.down()
    await win.mouse.move(startX + deltaX, startY, { steps: 12 })
    started = await win.waitForFunction((id) => document.querySelector(`[data-clip-id="${id}"]`)?.getAttribute('data-resizing') === 'right', clipId, { timeout: 2500 })
      .then(() => true)
      .catch(() => false)
    if (!started) {
      await win.mouse.up()
      await win.waitForTimeout(100)
    }
  }
  if (!started) throw new Error(`片段出点拖动未启动：${clipId}`)
  const preview = await material.boundingBox()
  if (screenshotPath) await screenshotSettled(win, { path: screenshotPath })
  const limited = await material.getAttribute('data-resize-limited') === 'true'
  await win.mouse.up()
  await win.waitForTimeout(300)
  return {
    before,
    preview,
    after: await material.boundingBox(),
    beforeEndFrame,
    afterEndFrame: Number(await material.getAttribute('data-persisted-end-frame')),
    limited,
  }
}

try {
  const clip = await openCanvas()
  const isolatedNode = win.locator('[data-clip-node="true"][data-node-id="canvas-isolated-clip"]')
  await isolatedNode.waitFor({ state: 'visible', timeout: 8000 })
  await isolatedNode.click({ position: { x: 20, y: 20 } })
  const isolatedMaterial = isolatedNode.locator('[data-clip-id="clip-isolated-image"]')
  const isolatedLane = isolatedNode.getByTestId('clip-node-media-lane')
  const isolatedBefore = await isolatedMaterial.boundingBox()
  const isolatedPlayheadBefore = await isolatedNode.getByTestId('clip-node-playhead').boundingBox()
  if (!isolatedBefore) throw new Error('找不到单素材剪辑片段')
  await win.mouse.move(isolatedBefore.x + isolatedBefore.width / 2, isolatedBefore.y + isolatedBefore.height / 2)
  await win.mouse.down()
  await win.mouse.move(isolatedBefore.x + isolatedBefore.width / 2 + 120, isolatedBefore.y + isolatedBefore.height / 2, { steps: 10 })
  await win.waitForFunction(() => document.querySelector('[data-clip-id="clip-isolated-image"]')?.getAttribute('data-dragging') === 'true')
  await screenshotSettled(win, { path: screenshots.isolatedDrag })
  await win.mouse.up()
  await win.waitForTimeout(300)
  const isolatedAfter = await isolatedMaterial.boundingBox()
  const isolatedStartAfterDrag = Number(await isolatedMaterial.getAttribute('data-persisted-start-frame'))
  const isolatedPlayheadAfter = await isolatedNode.getByTestId('clip-node-playhead').boundingBox()
  const isolatedClipDrag = Boolean(isolatedAfter && isolatedAfter.x > isolatedBefore.x + 80 && isolatedStartAfterDrag > 0)
  const isolatedClipSelected = await isolatedMaterial.getAttribute('data-selected') === 'true'
  const isolatedClipActionsEnabled = await isolatedNode.getByTestId('clip-node-duplicate').isEnabled()
    && await isolatedNode.getByTestId('clip-node-remove').isEnabled()
  const dragDoesNotMovePlayhead = Boolean(
    isolatedPlayheadBefore
    && isolatedPlayheadAfter
    && Math.abs(isolatedPlayheadAfter.x - isolatedPlayheadBefore.x) < 1,
  )

  const persistedStartOnDisk = await waitForPersistedClipStart('isolated-image', isolatedStartAfterDrag)
  const isolatedDragPersists = persistedStartOnDisk === isolatedStartAfterDrag && persistedStartOnDisk > 0

  const beforeSnap = await isolatedMaterial.boundingBox()
  const laneBox = await isolatedLane.boundingBox()
  if (!beforeSnap || !laneBox) throw new Error('找不到单素材吸附测试区域')
  await win.mouse.move(beforeSnap.x + beforeSnap.width / 2, beforeSnap.y + beforeSnap.height / 2)
  await win.mouse.down()
  await win.mouse.move(laneBox.x + beforeSnap.width / 2 + 3, beforeSnap.y + beforeSnap.height / 2, { steps: 10 })
  const snapGuide = win.getByTestId('clip-node-snap-guide')
  await snapGuide.waitFor({ state: 'attached' })
  const originSnapGuideVisible = await snapGuide.locator('span').last().evaluate((label) => {
    const rect = label.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(label).visibility !== 'hidden'
  })
  await screenshotSettled(win, { path: screenshots.isolatedSnap })
  await win.mouse.up()
  await win.waitForTimeout(250)
  const isolatedSnapsToOrigin = Number(await isolatedMaterial.getAttribute('data-persisted-start-frame')) === 0

  const beforeCancel = await isolatedMaterial.boundingBox()
  if (!beforeCancel) throw new Error('找不到单素材取消测试片段')
  await win.mouse.move(beforeCancel.x + beforeCancel.width / 2, beforeCancel.y + beforeCancel.height / 2)
  await win.mouse.down()
  await win.mouse.move(beforeCancel.x + beforeCancel.width / 2 + 90, beforeCancel.y + beforeCancel.height / 2, { steps: 8 })
  await win.keyboard.press('Escape')
  await win.mouse.up()
  await win.waitForTimeout(200)
  const cancelLeavesNoMutation = Number(await isolatedMaterial.getAttribute('data-persisted-start-frame')) === 0

  const undoOrigin = await isolatedMaterial.boundingBox()
  if (!undoOrigin) throw new Error('找不到单素材撤销测试片段')
  await win.mouse.move(undoOrigin.x + undoOrigin.width / 2, undoOrigin.y + undoOrigin.height / 2)
  await win.mouse.down()
  await win.mouse.move(undoOrigin.x + undoOrigin.width / 2 + 90, undoOrigin.y + undoOrigin.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(200)
  const undoMovedStart = Number(await isolatedMaterial.getAttribute('data-persisted-start-frame'))
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(250)
  const oneDragOneUndo = undoMovedStart > 0
    && Number(await isolatedMaterial.getAttribute('data-persisted-start-frame')) === 0

  await clip.click({ position: { x: 20, y: 20 } })
  const clips = clip.getByTestId('clip-node-clip')
  await win.waitForFunction(() => {
    const video = document.querySelector('[data-node-preview-video="true"]')
    return video instanceof HTMLVideoElement && video.readyState >= 2 && getComputedStyle(video).opacity !== '0'
  }, { timeout: 15_000 })
  await win.waitForTimeout(1200)

  const compactDefault = await clip.evaluate((element) => element.getAttribute('data-clip-mode') === 'compact')
    && (await clips.count()) === 4
    && (await win.getByTestId('clip-node-preview').count()) === 0
  const canvasVideoFrameReady = await win.locator('[data-node-preview-video="true"]').evaluate((video) => (
    video instanceof HTMLVideoElement && video.readyState >= 2 && getComputedStyle(video).opacity !== '0'
  ))
  const canvasVideoAudioEnabled = await win.locator('[data-node-preview-video="true"]').evaluate((video) => (
    video instanceof HTMLVideoElement && video.muted === false
  ))
  const canvasVideoNode = win.locator('[data-node-preview-video="true"]').locator('xpath=ancestor::*[@data-node-id][1]')
  await canvasVideoNode.hover()
  await win.waitForFunction(() => document.querySelector('[data-node-preview-video="true"]')?.muted === true)
  await clip.hover({ position: { x: 20, y: 20 } })
  await win.waitForFunction(() => document.querySelector('[data-node-preview-video="true"]')?.muted === false)
  const canvasVideoAudioRestoredAfterHover = await win.locator('[data-node-preview-video="true"]').evaluate((video) => (
    video instanceof HTMLVideoElement && video.muted === false
  ))
  const clipNodeIsWideEnough = (await clip.boundingBox())?.width >= 750
  const rulerBoxBeforeDrag = await clip.getByTestId('clip-node-ruler').boundingBox()
  const mediaLaneBox = await clip.getByTestId('clip-node-media-lane').boundingBox()
  const thirtySecondLabelBox = await clip.getByText('00:30', { exact: true }).boundingBox()
  const axisViewportBox = await clip.getByTestId('clip-node-axis-content').locator('..').boundingBox()
  const rulerDoesNotOverlapMedia = Boolean(rulerBoxBeforeDrag && mediaLaneBox && rulerBoxBeforeDrag.y + rulerBoxBeforeDrag.height <= mediaLaneBox.y)
  const thirtySecondHasTrailingSpace = Boolean(
    thirtySecondLabelBox
    && axisViewportBox
    && axisViewportBox.x + axisViewportBox.width - (thirtySecondLabelBox.x + thirtySecondLabelBox.width) >= 20,
  )
  const clipVideoThumbnailReady = await clip.locator('[data-clip-id="clip-video-b"]').evaluate((element) => (
    Array.from(element.children).some((child) => {
      if (child instanceof HTMLImageElement) return child.complete && child.naturalWidth > 0
      if (!(child instanceof HTMLElement) || child.dataset.clipFilmstrip !== 'true') return false
      const style = getComputedStyle(child)
      const sourceWidth = Number.parseFloat(style.backgroundSize)
      return style.backgroundImage !== 'none'
        && style.backgroundSize.endsWith('px 100%')
        && Number.isFinite(sourceWidth)
        && sourceWidth >= element.getBoundingClientRect().width - 1
    })
  ))
  await screenshotSettled(win, { path: screenshots.compact })

  const nodeBeforeDrag = await clip.boundingBox()
  const dragHandleBox = await clip.getByTestId('clip-node-drag-handle').boundingBox()
  if (!nodeBeforeDrag || !dragHandleBox) throw new Error('找不到剪辑节点拖动区域')
  await win.mouse.move(dragHandleBox.x + dragHandleBox.width / 2, dragHandleBox.y + dragHandleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(dragHandleBox.x + dragHandleBox.width / 2 + 100, dragHandleBox.y + dragHandleBox.height / 2 + 60, { steps: 10 })
  await win.mouse.up()
  await win.waitForTimeout(300)
  const nodeAfterDrag = await clip.boundingBox()
  const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const nodeDragWorks = Boolean(
    nodeAfterDrag
    && nodeAfterDrag.x > nodeBeforeDrag.x + 60
    && nodeAfterDrag.y > nodeBeforeDrag.y + 30,
  )
  const nodeVisibleAfterDrag = Boolean(
    nodeAfterDrag
    && nodeAfterDrag.x < viewport.width
    && nodeAfterDrag.y < viewport.height
    && nodeAfterDrag.x + nodeAfterDrag.width > 0
    && nodeAfterDrag.y + nodeAfterDrag.height > 0,
  )

  const rulerBox = await clip.getByTestId('clip-node-ruler').boundingBox()
  if (!rulerBox) throw new Error('找不到剪辑轴标尺')
  await win.mouse.click(rulerBox.x + rulerBox.width * 0.38, rulerBox.y + rulerBox.height / 2)
  const preview = win.getByTestId('clip-node-preview')
  await preview.waitFor({ state: 'visible' })
  const nodeAfterPreview = await clip.boundingBox()
  const previewBox = await preview.boundingBox()
  const timelineClickOpensPreview = Boolean(previewBox)
  const nodeStaysPutWhenPreviewOpens = Boolean(
    nodeAfterDrag
    && nodeAfterPreview
    && Math.abs(nodeAfterPreview.x - nodeAfterDrag.x) < 2
    && Math.abs(nodeAfterPreview.y - nodeAfterDrag.y) < 2,
  )
  const previewDoesNotHideNode = Boolean(
    nodeAfterPreview
    && previewBox
    && (
      previewBox.y + previewBox.height <= nodeAfterPreview.y - 4
      || previewBox.y >= nodeAfterPreview.y + nodeAfterPreview.height + 4
    ),
  )
  const seek = preview.locator('input[type="range"]')
  const clickPositionsGlobalPlayhead = Number(await seek.inputValue()) > 0
  const clipActions = clip.getByTestId('clip-node-actions')
  const clipActionsDiscoverable = (await clipActions.getByRole('button').count()) === 3
    && await clip.getByTestId('clip-node-split').isEnabled()
    && await clip.getByTestId('clip-node-duplicate').isEnabled()
    && await clip.getByTestId('clip-node-remove').isEnabled()
  const previewStartsMuted = await preview.evaluate((element) => (
    element.getAttribute('data-muted') === 'true' && element.querySelector('video')?.muted === true
  ))
  await preview.getByRole('button', { name: '取消静音' }).click()
  const previewCanUnmute = await preview.evaluate((element) => (
    element.getAttribute('data-muted') === 'false' && element.querySelector('video')?.muted === false
  ))
  const first = clips.first()
  const playbackStartBox = await first.boundingBox()
  if (!playbackStartBox) throw new Error('找不到播放起点片段')
  await first.click({ position: { x: playbackStartBox.width * 0.78, y: playbackStartBox.height / 2 } })
  const beforeCutClipId = await preview.getAttribute('data-active-clip-id')
  await preview.getByRole('button', { name: '播放预览' }).click()
  await win.waitForFunction((clipId) => document.querySelector('[data-testid="clip-node-preview"]')?.getAttribute('data-active-clip-id') !== clipId, beforeCutClipId, { timeout: 3000 })
  const afterCutClipId = await preview.getAttribute('data-active-clip-id')
  const playbackCrossesCuts = Boolean(beforeCutClipId && afterCutClipId && beforeCutClipId !== afterCutClipId)
  await preview.getByRole('button', { name: '暂停预览' }).click().catch(() => {})
  await screenshotSettled(win, { path: screenshots.preview })

  await clip.getByTestId('clip-node-export').click()
  const exportMenu = win.getByTestId('clip-node-export-menu')
  await exportMenu.waitFor({ state: 'visible' })
  const exportMenuBox = await exportMenu.boundingBox()
  const previewBeforeExportBox = await preview.boundingBox()
  const exportDoesNotOverlapPreview = Boolean(
    exportMenuBox
    && previewBeforeExportBox
    && (
      exportMenuBox.x + exportMenuBox.width <= previewBeforeExportBox.x
      || exportMenuBox.x >= previewBeforeExportBox.x + previewBeforeExportBox.width
      || exportMenuBox.y + exportMenuBox.height <= previewBeforeExportBox.y
      || exportMenuBox.y >= previewBeforeExportBox.y + previewBeforeExportBox.height
    ),
  )
  await screenshotSettled(win, { path: screenshots.exportMenu })

  await runExport('完整成片', '到画布', '已向画布导出 1 个视频节点')
  const fullCanvasExport = (await win.locator('[data-kind="video"]').count()) === 2
  await runExport('完整成片', '下载', '已导出 1 个视频文件')
  const fullExportPath = fs.readdirSync(path.join(projectRoot, 'exports'))
    .map((name) => path.join(projectRoot, 'exports', name))
    .find((candidate) => candidate.endsWith('.mp4'))
  const exportKeepsAudio = Boolean(fullExportPath && execFileSync(ffprobePath, [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', fullExportPath,
  ]).toString().trim())
  await runExport(/独立片段/, '到画布', '已向画布导出 4 个视频节点')
  const segmentCanvasExport = (await win.locator('[data-kind="video"]').count()) === 6
  await runExport(/独立片段/, '下载', '已导出 4 个视频文件')
  const outputEdges = win.locator('.generation-canvas-v2__edge[data-edge-id^="edge-canvas-clip-editor::"]')
  const fiveOutputEdges = (await outputEdges.count()) === 5
  const restingEdgesHaveNoLabels = (await win.locator('.generation-canvas-v2__edge-control').count()) === 0
  await preview.getByRole('button', { name: '关闭预览' }).click()
  const edgePoint = await findEdgeHitPoint(win, {
    edgeSelector: '.generation-canvas-v2__edge[data-edge-id^="edge-canvas-clip-editor::"] .generation-canvas-v2__edge-hit',
    margins: { left: 16, top: 80, right: 16, bottom: 16 },
  })
  if (!edgePoint) throw new Error('找不到可见的输出连线点击位置')
  await win.mouse.click(edgePoint.x, edgePoint.y)
  await win.waitForTimeout(250)
  const clickingEdgeShowsNativeControl = (await win.locator('.generation-canvas-v2__edge-control[data-active="true"]').count()) === 1
  await screenshotSettled(win, { path: screenshots.outputs, fullPage: true })

  const firstBox = await first.boundingBox()
  if (!firstBox) throw new Error('找不到首个片段')
  await first.click({ position: { x: firstBox.width * 0.5, y: firstBox.height / 2 } })
  const beforeSplit = await clips.count()
  await win.keyboard.press('s')
  await win.waitForTimeout(200)
  const keyboardSplit = (await clips.count()) === beforeSplit + 1
  await win.keyboard.press('Control+d')
  await win.waitForTimeout(200)
  const keyboardDuplicate = (await clips.count()) === beforeSplit + 2
  await win.keyboard.press('Delete')
  await win.waitForTimeout(200)
  const keyboardDelete = (await clips.count()) === beforeSplit + 1
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(250)
  const keyboardUndo = (await clips.count()) === beforeSplit + 2
  await win.keyboard.press('Control+Shift+z')
  await win.waitForTimeout(250)
  const keyboardRedo = (await clips.count()) === beforeSplit + 1

  const toolbarTarget = clip.locator('[data-clip-id="clip-video-b"]')
  const toolbarTargetBox = await toolbarTarget.boundingBox()
  if (!toolbarTargetBox) throw new Error('找不到图标操作目标片段')
  await toolbarTarget.click({ position: { x: toolbarTargetBox.width * 0.5, y: toolbarTargetBox.height / 2 } })
  const beforeToolbarActions = await clips.count()
  await clip.getByTestId('clip-node-split').click()
  const toolbarSplit = (await clips.count()) === beforeToolbarActions + 1
  await clip.getByTestId('clip-node-duplicate').click()
  const toolbarDuplicate = (await clips.count()) === beforeToolbarActions + 2
  await clip.getByTestId('clip-node-remove').click()
  const toolbarRemove = (await clips.count()) === beforeToolbarActions + 1

  const movable = clip.locator('[data-clip-id="clip-video-d"]')
  await movable.scrollIntoViewIfNeeded()
  const movableId = await movable.getAttribute('data-clip-id')
  const movableBefore = await movable.boundingBox()
  if (!movableId || !movableBefore) throw new Error('找不到可拖动片段')
  await win.mouse.click(movableBefore.x + movableBefore.width / 2, movableBefore.y + movableBefore.height / 2)
  await win.mouse.move(movableBefore.x + movableBefore.width / 2, movableBefore.y + movableBefore.height / 2)
  await win.mouse.down()
  await win.mouse.move(movableBefore.x + movableBefore.width / 2 + 90, movableBefore.y + movableBefore.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(250)
  const moved = clip.locator(`[data-clip-id="${movableId}"]`)
  const movedBox = await moved.boundingBox()
  const timelineDrag = Boolean(movedBox && movedBox.x > movableBefore.x + 20)
  const nudgeBefore = movedBox?.x ?? 0
  for (let index = 0; index < 8; index += 1) await win.keyboard.press('Shift+Period')
  await win.waitForTimeout(200)
  const nudgedBox = await moved.boundingBox()
  const keyboardNudge = Boolean(nudgedBox && nudgedBox.x > nudgeBefore + 2)
  const trimHandle = moved.getByRole('button', { name: '调整片段出点', exact: true })
  const trimBefore = await moved.boundingBox()
  const handleBox = await trimHandle.boundingBox()
  if (!trimBefore || !handleBox) throw new Error('找不到片段裁剪把手')
  await win.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(handleBox.x - 40, handleBox.y + handleBox.height / 2, { steps: 8 })
  await win.mouse.up()
  await win.waitForTimeout(200)
  const trimAfter = await moved.boundingBox()
  const trimWorks = Boolean(trimAfter && trimAfter.width < trimBefore.width - 4)

  const beforeImport = await clips.count()
  await clip.getByRole('button', { name: '添加素材', exact: true }).click()
  await win.getByTestId('asset-picker').waitFor({ state: 'visible' })
  await win.locator('input[type="file"]').last().setInputFiles(importedVideoPath)
  await win.waitForFunction((count) => (
    document.querySelector('[data-clip-node="true"][data-node-id="canvas-clip-editor"]')
      ?.querySelectorAll('[data-testid="clip-node-clip"]').length === count + 1
  ), beforeImport, { timeout: 30_000 })
  const realImport = (await clips.count()) === beforeImport + 1 && (await win.locator('[role="alert"]:visible').count()) === 0
  const importedClip = clips.last()
  await importedClip.scrollIntoViewIfNeeded()
  const importedClipBox = await importedClip.boundingBox()
  const importUsesRealDuration = Boolean(importedClipBox && importedClipBox.width >= 220)
  await screenshotSettled(win, { path: screenshots.imported })

  const canvasZoom = win.getByRole('slider', { name: '缩放比例' }).first()
  await canvasZoom.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, '50')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await win.waitForTimeout(500)
  const resizeAtHalfZoom = Number(await canvasZoom.inputValue()) === 50

  await importedClip.scrollIntoViewIfNeeded()
  const videoShrink = await dragClipEnd(importedClip, -60, screenshots.videoResize)
  const videoResizeFollowsPointer = Boolean(
    videoShrink.preview
    && videoShrink.before.width - videoShrink.preview.width >= 48,
  )
  const videoShrinkPersists = Boolean(
    videoShrink.after
    && videoShrink.beforeEndFrame > videoShrink.afterEndFrame
    && videoShrink.before.width - videoShrink.after.width >= 48,
  )
  const videoRestore = await dragClipEnd(importedClip, 90)
  const videoExtendsBackToSource = Boolean(
    videoRestore.after
    && videoRestore.afterEndFrame === videoShrink.beforeEndFrame
    && Math.abs(videoRestore.after.width - videoShrink.before.width) <= 3,
  )
  const videoSourceLimitFeedback = videoRestore.limited

  const beforeImageImport = await clips.count()
  await clip.getByRole('button', { name: '添加素材', exact: true }).click()
  await win.getByTestId('asset-picker').waitFor({ state: 'visible' })
  await win.locator('input[type="file"]').last().setInputFiles(path.join(repoRoot, 'tests/ux/fixtures/test-upload.png'))
  await win.waitForFunction((count) => (
    document.querySelector('[data-clip-node="true"][data-node-id="canvas-clip-editor"]')
      ?.querySelectorAll('[data-testid="clip-node-clip"]').length === count + 1
  ), beforeImageImport, { timeout: 30_000 })
  const importedImage = clips.last()
  await importedImage.scrollIntoViewIfNeeded()
  const realImageImport = (await clips.count()) === beforeImageImport + 1
    && (await win.locator('[role="alert"]:visible').count()) === 0
  const imageExtend = await dragClipEnd(importedImage, 30, screenshots.imageResize)
  const imageExtensionFollowsPointer = Boolean(
    imageExtend.preview
    && imageExtend.preview.width - imageExtend.before.width >= 22,
  )
  const imageExtensionPersists = Boolean(
    imageExtend.after
    && imageExtend.afterEndFrame > imageExtend.beforeEndFrame
    && imageExtend.after.width - imageExtend.before.width >= 22,
  )
  const imageShrink = await dragClipEnd(importedImage, -20)
  const imageCanShrink = Boolean(
    imageShrink.after
    && imageShrink.afterEndFrame < imageShrink.beforeEndFrame
    && imageShrink.before.width - imageShrink.after.width >= 13,
  )
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(250)
  const resizeOneUndo = Number(await importedImage.getAttribute('data-persisted-end-frame')) === imageShrink.beforeEndFrame
  await win.keyboard.press('Control+Shift+z')
  await win.waitForTimeout(250)

  const resizeCancelBefore = Number(await importedImage.getAttribute('data-persisted-end-frame'))
  const cancelHandle = importedImage.getByRole('button', { name: '调整片段出点', exact: true })
  const cancelHandleBox = await cancelHandle.boundingBox()
  if (!cancelHandleBox) throw new Error('找不到取消伸缩测试的出点把手')
  await win.mouse.move(cancelHandleBox.x + cancelHandleBox.width / 2, cancelHandleBox.y + cancelHandleBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(cancelHandleBox.x + cancelHandleBox.width / 2 + 24, cancelHandleBox.y + cancelHandleBox.height / 2, { steps: 8 })
  await win.waitForFunction((clipId) => document.querySelector(`[data-clip-id="${clipId}"]`)?.getAttribute('data-resizing') === 'right', await importedImage.getAttribute('data-clip-id'))
  await win.keyboard.press('Escape')
  await win.mouse.up()
  await win.waitForTimeout(200)
  const resizeEscapeCancels = Number(await importedImage.getAttribute('data-persisted-end-frame')) === resizeCancelBefore

  const result = {
    isolatedClipDrag,
    isolatedClipSelected,
    isolatedClipActionsEnabled,
    dragDoesNotMovePlayhead,
    isolatedDragPersists,
    originSnapGuideVisible,
    isolatedSnapsToOrigin,
    cancelLeavesNoMutation,
    oneDragOneUndo,
    compactDefault,
    canvasVideoFrameReady,
    canvasVideoAudioEnabled,
    canvasVideoAudioRestoredAfterHover,
    clipNodeIsWideEnough,
    rulerDoesNotOverlapMedia,
    thirtySecondHasTrailingSpace,
    clipVideoThumbnailReady,
    nodeDragWorks,
    nodeVisibleAfterDrag,
    timelineClickOpensPreview,
    nodeStaysPutWhenPreviewOpens,
    previewDoesNotHideNode,
    exportDoesNotOverlapPreview,
    clickPositionsGlobalPlayhead,
    clipActionsDiscoverable,
    previewStartsMuted,
    previewCanUnmute,
    playbackCrossesCuts,
    fullCanvasExport,
    exportKeepsAudio,
    segmentCanvasExport,
    fiveOutputEdges,
    restingEdgesHaveNoLabels,
    clickingEdgeShowsNativeControl,
    keyboardSplit,
    keyboardDuplicate,
    keyboardDelete,
    keyboardUndo,
    keyboardRedo,
    toolbarSplit,
    toolbarDuplicate,
    toolbarRemove,
    timelineDrag,
    keyboardNudge,
    trimWorks,
    realImport,
    importUsesRealDuration,
    resizeAtHalfZoom,
    videoResizeFollowsPointer,
    videoShrinkPersists,
    videoExtendsBackToSource,
    videoSourceLimitFeedback,
    realImageImport,
    imageExtensionFollowsPointer,
    imageExtensionPersists,
    imageCanShrink,
    resizeOneUndo,
    resizeEscapeCancels,
  }
  console.log(JSON.stringify({ result, screenshots }))
  await closeApp()
  process.exit(Object.values(result).every(Boolean) ? 0 : 1)
} catch (error) {
  console.error(error)
  await closeApp()
  process.exit(1)
}
