import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 工具栏功能层级梳理走查（用户拍板：全屏从最左移到右侧工具区，和下载做伴）。
// 种一个图片节点 + 一个视频节点，分别选中让浮动工具栏出现，截图人眼核对全屏新位置。
// 零额度：nomi-local SVG/本地 mp4，不调模型。
// 用法：pnpm run build && node tests/ux/toolbar-order.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, screenshotSettled } from './_assert.mjs'
import { canvasFitView, switchWorkspace } from './_shell.mjs'
import { findNodeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { uiText } from './full-walk/invariants.mjs'

const require = createRequire(import.meta.url)
const root = makeTempDir('nomi-toolbar-')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'toolbar-order-walk'
const projectRoot = path.join(projectsDir, `toolbar-${projectId}`)
const outDir = makeTempDir('nomi-toolbar-order-evidence-')
process.env.EVIDENCE_DIR = outDir
const locale = 'zh-CN'
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

let passed = 0
function assert(cond, label) {
  if (!cond) throw new Error(`WALK FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

// 图片夹具（nomi-local SVG）
const genDir = path.join(projectRoot, 'assets', 'generated')
fs.mkdirSync(genDir, { recursive: true })
const IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#3a5a78"/><circle cx="480" cy="270" r="120" fill="#f0c987"/></svg>`
fs.writeFileSync(path.join(genDir, 'img.svg'), IMAGE_SVG)
const IMAGE_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/img.svg`

// 视频夹具（真 h264 mp4）
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const mp4Path = path.join(genDir, 'clip.mp4')
const enc = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path], { timeout: 120_000 })
if (enc.status !== 0) throw new Error('mp4 夹具失败')
const VIDEO_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/clip.mp4`

const nodes = [
  { id: 'img-node', kind: 'image', categoryId: 'shots', title: '图片镜头', position: { x: 160, y: 160 }, exactPosition: true, size: { width: 420, height: 260 }, status: 'success', result: { id: 'img-r', type: 'image', url: IMAGE_URL, createdAt: 1 }, meta: { imageWidth: 960, imageHeight: 540 } },
  { id: 'vid-node', kind: 'video', categoryId: 'shots', title: '视频镜头', position: { x: 160, y: 560 }, exactPosition: true, size: { width: 420, height: 260 }, status: 'success', result: { id: 'vid-r', type: 'video', url: VIDEO_URL, createdAt: 1 } },
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: '工具栏梳理回归', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, workbenchDocument: null, timeline: null, generationCanvas: payload.generationCanvas, payload }
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project))

const { app, win: library } = await launchNomiApp({
  name: 'toolbar-order',
  userDataDir: settingsDir,
  settingsDir: settingsDir,
  projectsDir: projectsDir,
  initialLocalStorage: {
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:canvas-gesture-hint:v1': 'seen',
    'nomi:locale:v1': locale,
  },
})

try {
  await library.locator('[data-project-card]', { hasText: project.name }).click()
  const projectWindow = () => app.windows().find((page) => /[?&]projectId=/.test(page.url()))
  await expect.poll(() => Boolean(projectWindow())).toBe(true)
  const win = projectWindow()
  await switchWorkspace(win, 'generation')
  await canvasFitView(win)
  await waitForCanvasViewportSettled(win)

  async function selectNode(id) {
    const nodeSelector = `.react-flow__node[data-id="${id}"]`
    const node = win.locator(nodeSelector)
    await expect(node).toBeVisible()
    const hit = await findNodeHitPoint(win, { nodeSelector })
    if (!hit) throw new Error(`${id} 没有可选中的节点表面`)
    await win.mouse.click(hit.x, hit.y)
    return node
  }

  async function checkOrder(node, kind, shot) {
    const key = `generationCommon.${kind}Toolbar`
    const toolbar = node.getByRole('toolbar', { name: uiText(locale, `${key}.aria`), exact: true })
    const order = await toolbar.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim()))
    const fullscreen = uiText(locale, `${key}.fullscreenAria`)
    const fsIndex = order.indexOf(fullscreen)
    const dlIndex = order.indexOf(uiText(locale, 'generationCommon.imageToolbar.download'))
    assert(order.length > 0, `${kind} 工具栏浮出（${order.length} 个按钮）`)
    assert(fsIndex > 0, `${kind} 全屏在创作动作后（idx=${fsIndex}）`)
    assert(dlIndex >= 0 && Math.abs(fsIndex - dlIndex) === 1, `${kind} 全屏与下载相邻（${fsIndex}, ${dlIndex}）`)
    if (kind === 'image') assert(order[0] !== fullscreen, `图片工具栏最左保留创作动作（${order[0]}）`)
    await screenshotSettled(win, { path: path.join(outDir, `${shot}.png`) })
  }

  const imageNode = await selectNode('img-node')
  await win.locator('[role="toolbar"][aria-label="图片操作"]').waitFor({ state: 'visible', timeout: 15000 })
  await checkOrder(imageNode, 'image', '1-image-toolbar')
  const videoNode = await selectNode('vid-node')
  await win.locator('[role="toolbar"][aria-label="视频操作"]').waitFor({ state: 'visible', timeout: 15000 })
  await checkOrder(videoNode, 'video', '2-video-toolbar')

  console.log(`\n✅ 工具栏梳理走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
}
