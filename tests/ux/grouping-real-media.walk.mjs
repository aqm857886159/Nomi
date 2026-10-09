import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 编组优化的真实媒体验收：真实 Electron + 持久化画布节点 + 仓库登记的真实 AI 视频/抽帧。
// 不调用供应商、不触发付费生成；验的是编组交互是否承载真实图片与视频节点。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const ffprobe = require('@ffprobe-installer/ffprobe').path
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceVideo = path.join(repoRoot, 'tests/ux/fixtures/canvas-follow-hand-1080p15.mp4')
const outputDir = path.join(repoRoot, 'tests/ux/shots/grouping-real-media')
if (!fs.existsSync(sourceVideo)) throw new Error(`真实视频缺失：${sourceVideo}`)
fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

const temp = makeTempDir('nomi-grouping-real-media-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'grouping-real-media'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets', 'imported')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(importedDir, { recursive: true })
const videoFile = path.join(importedDir, 'real-ai-shot.mp4')
const imageFile = path.join(importedDir, 'real-ai-shot-frame.png')
fs.copyFileSync(sourceVideo, videoFile)
require('node:child_process').execFileSync(ffmpeg, [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-ss',
  '0.5',
  '-i',
  sourceVideo,
  '-frames:v',
  '1',
  imageFile,
])
const mediaGeometry = (file) => {
  const output = require('node:child_process').execFileSync(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file],
    { encoding: 'utf8' },
  )
  const stream = JSON.parse(output).streams?.[0]
  if (!Number.isFinite(stream?.width) || !Number.isFinite(stream?.height))
    throw new Error(`真实媒体尺寸探测失败：${file}`)
  return { width: stream.width, height: stream.height, aspectRatio: stream.width / stream.height }
}
const imageGeometry = mediaGeometry(imageFile)
const videoGeometry = mediaGeometry(videoFile)
const localUrl = (relative) =>
  `nomi-local://asset/${encodeURIComponent(projectId)}/${relative.split('/').map(encodeURIComponent).join('/')}`
const videoUrl = localUrl('assets/imported/real-ai-shot.mp4')
const imageUrl = localUrl('assets/imported/real-ai-shot-frame.png')
const size = { width: 300, height: 240 }
const nodes = [
  {
    id: 'real-image-1',
    kind: 'image',
    title: '真实图片 · 雨衣人物',
    categoryId: 'shots',
    shotIndex: 1,
    position: { x: 150, y: 150 },
    size,
    status: 'success',
    meta: {
      imageWidth: imageGeometry.width,
      imageHeight: imageGeometry.height,
      imageAspectRatio: imageGeometry.aspectRatio,
    },
    result: { id: 'real-image-1-result', type: 'image', url: imageUrl, thumbnailUrl: imageUrl, createdAt: 1 },
  },
  {
    id: 'real-video-1',
    kind: 'video',
    title: '真实视频 · 雨衣人物',
    categoryId: 'shots',
    shotIndex: 2,
    position: { x: 530, y: 150 },
    size,
    status: 'success',
    meta: {
      videoWidth: videoGeometry.width,
      videoHeight: videoGeometry.height,
      videoAspectRatio: videoGeometry.aspectRatio,
    },
    result: { id: 'real-video-1-result', type: 'video', url: videoUrl, thumbnailUrl: imageUrl, createdAt: 1 },
  },
  {
    id: 'real-image-2',
    kind: 'image',
    title: '真实图片 · 第二帧',
    categoryId: 'shots',
    shotIndex: 3,
    position: { x: 150, y: 470 },
    size,
    status: 'success',
    meta: {
      imageWidth: imageGeometry.width,
      imageHeight: imageGeometry.height,
      imageAspectRatio: imageGeometry.aspectRatio,
    },
    result: { id: 'real-image-2-result', type: 'image', url: imageUrl, thumbnailUrl: imageUrl, createdAt: 1 },
  },
  {
    id: 'real-video-2',
    kind: 'video',
    title: '真实视频 · 第二节点',
    categoryId: 'shots',
    shotIndex: 4,
    position: { x: 530, y: 470 },
    size,
    status: 'success',
    meta: {
      videoWidth: videoGeometry.width,
      videoHeight: videoGeometry.height,
      videoAspectRatio: videoGeometry.aspectRatio,
    },
    result: { id: 'real-video-2-result', type: 'video', url: videoUrl, thumbnailUrl: imageUrl, createdAt: 1 },
  },
]
const group = {
  id: 'real-media-group',
  name: '真实媒体编组',
  categoryId: 'shots',
  nodeIds: nodes.map((node) => node.id),
  frameBounds: { x: 80, y: 80, w: 820, h: 700 },
  createdAt: 1,
  updatedAt: 1,
}
const generationCanvas = {
  nodes,
  edges: [],
  groups: [group],
  selectedNodeIds: [],
  canvasZoom: 1,
  canvasPan: { x: 0, y: 0 },
}
const payload = {
  workbenchDocument: null,
  timeline: {
    version: 1,
    fps: 30,
    scale: 1,
    playheadFrame: 0,
    tracks: [
      { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
      { id: 'videoTrack', type: 'video', label: '视频轨', clips: [] },
    ],
  },
  generationCanvas,
  storyboardPlan: null,
  storyboardPlanCommitted: false,
}
const project = {
  id: projectId,
  name: '真实媒体编组验收',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  payload,
}
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({
  name: 'grouping-real-media',
  projectsDir,
  settleMs: 0,
  initialLocalStorage: {
    'nomi:locale:v1': 'zh-CN',
    'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
  },
})
try {
  const card = win.locator('[data-project-card]', { hasText: project.name }).first()
  await card.waitFor({ state: 'visible' })
  await card.dblclick()
  await win.getByRole('button', { name: '生成', exact: true }).click()
  await win.getByLabel('适应视图', { exact: true }).click()
  await expect(win.locator('[data-node-id]')).toHaveCount(4)
  await expect.poll(() => win.locator('[data-node-id] img').count()).toBe(4)
  await expect
    .poll(() => win.locator('[data-node-id] img').evaluateAll((els) => els.every((el) => el.naturalWidth > 0)))
    .toBe(true)
  // 真实视频默认只显示真实封面；悬停才按产品的懒加载策略挂播放器并解码。
  const decodedVideoWidths = {}
  for (const id of ['real-video-1', 'real-video-2']) {
    await win.locator(`[data-node-id="${id}"]`).hover()
    await expect.poll(() => win.locator(`[data-node-id="${id}"] video`).count()).toBe(1)
    await expect.poll(() => win.locator(`[data-node-id="${id}"] video`).evaluate((el) => el.videoWidth > 0)).toBe(true)
    decodedVideoWidths[id] = await win
      .locator(`[data-node-id="${id}"] video`)
      .evaluate((el) => ({ width: el.videoWidth, height: el.videoHeight, readyState: el.readyState }))
  }
  await win.mouse.move(20, 20)

  const groupBox = win.locator('.generation-canvas-v2__group-box').first()
  await expectVisible(groupBox, '真实媒体编组框已加载')
  const point = await groupBox.evaluate((box) => {
    const rect = box.getBoundingClientRect()
    for (let y = rect.top + 12; y < rect.bottom - 12; y += 10)
      for (let x = rect.left + 12; x < rect.right - 12; x += 10) {
        const stack = document.elementsFromPoint(x, y)
        if (stack.some((el) => el.closest('[data-group-id]')) && !stack.some((el) => el.closest('[data-node-id]')))
          return { x, y }
      }
    return null
  })
  if (!point) throw new Error('真实媒体编组框内找不到空白点击点')
  await win.mouse.click(point.x, point.y)
  await expectVisible(win.locator('[data-group-toolbar="true"]'), '真实媒体编组工具条已出现')
  await expect(win.locator('.generation-canvas-v2__group-box').first()).toHaveAttribute('data-frame-selected', 'true')
  await expect(win.locator('[data-toolbar-action-menu="group-arrange"]')).toBeVisible()
  await screenshotSettled(win, { path: path.join(outputDir, '01-real-media-group-toolbar.png') })
  await win.locator('[data-toolbar-action-menu="group-arrange"]').click()
  await win.getByRole('menuitem', { name: '网格', exact: true }).click()
  await screenshotSettled(win, { path: path.join(outputDir, '02-real-media-arranged.png') })
  const facts = await win.evaluate(() => ({
    media: [...document.querySelectorAll('[data-node-id]')].map((node) => ({
      id: node.getAttribute('data-node-id'),
      imageWidth: node.querySelector('img')?.naturalWidth ?? 0,
      videoWidth: node.querySelector('video')?.videoWidth ?? 0,
    })),
    toolbar: document.querySelector('[data-group-toolbar="true"]')?.textContent?.replace(/\s+/g, '') ?? null,
    selectedFrame: document.querySelector('.generation-canvas-v2__group-box')?.getAttribute('data-frame-selected'),
  }))
  facts.decodedVideoWidths = decodedVideoWidths
  if (!Object.values(decodedVideoWidths).every((value) => value.width === 1920 && value.height === 1080))
    throw new Error(`真实 1080p 视频未解码：${JSON.stringify(decodedVideoWidths)}`)
  fs.writeFileSync(path.join(outputDir, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log('✅ 真实媒体编组走查完成 →', outputDir, JSON.stringify(facts))
} finally {
  await app.close()
  fs.rmSync(temp, { recursive: true, force: true })
}
