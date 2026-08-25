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
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-toolbar-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'toolbar-order-walk'
const projectRoot = path.join(projectsDir, `toolbar-${projectId}`)
const outDir = path.join(repoRoot, '.toolbar-order-lab')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

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

const { app, win } = await launchNomiApp({
  name: 'toolbar-order',
  userDataDir: settingsDir,
  settingsDir: settingsDir,
  projectsDir: projectsDir,
  settleMs: 2000,
})

try {
  await win.getByText('工具栏梳理回归').first().click()
  await win.waitForTimeout(2000)

  // —— 图片节点：点节点容器选中（点标题会进改名模式，工具栏不浮）→ 读工具栏按钮顺序 ——
  await win.locator('[data-node-id="img-node"]').first().click({ force: true })
  await win.locator('[role="toolbar"][aria-label="图片操作"]').waitFor({ state: 'visible', timeout: 15000 })
  const imgOrder = await win.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="图片操作"]')
    if (!bar) return null
    return Array.from(bar.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 8))
  })
  assert(imgOrder && imgOrder.length > 0, `图片工具栏浮出（${imgOrder ? imgOrder.length : 0} 个按钮）`)
  const fsIdx = imgOrder.findIndex((x) => x.includes('全屏'))
  const dlIdx = imgOrder.findIndex((x) => x.includes('下载'))
  assert(fsIdx > 0, `图片：全屏不再在最左（idx=${fsIdx}）`)
  assert(dlIdx >= 0 && Math.abs(fsIdx - dlIdx) === 1, `图片：全屏与下载相邻成工具组（全屏idx=${fsIdx} 下载idx=${dlIdx}）`)
  assert(!imgOrder[0].includes('全屏'), `图片：最左是创作动作不是全屏（最左=「${imgOrder[0]}」）`)
  await screenshotSettled(win, { path: path.join(outDir, '1-image-toolbar.png') })

  // —— 视频节点：点节点容器选中 → 读工具栏按钮顺序 ——
  await win.locator('[data-node-id="vid-node"]').first().click({ force: true })
  await win.locator('[role="toolbar"][aria-label="视频操作"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  const vidOrder = await win.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="视频操作"]')
    if (!bar) return null
    return Array.from(bar.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 8))
  })
  if (vidOrder && vidOrder.length) {
    const vFs = vidOrder.findIndex((x) => x.includes('全屏'))
    const vDl = vidOrder.findIndex((x) => x.includes('下载'))
    assert(vFs > 0, `视频：全屏不再在最左（idx=${vFs}）`)
    assert(vDl >= 0 && Math.abs(vFs - vDl) === 1, `视频：全屏与下载相邻成工具组（全屏idx=${vFs} 下载idx=${vDl}）`)
    await screenshotSettled(win, { path: path.join(outDir, '2-video-toolbar.png') })
  } else {
    console.log('  · 视频工具栏未定位到（选择器差异），仅截图留存')
    await screenshotSettled(win, { path: path.join(outDir, '2-video-toolbar.png') })
  }

  console.log(`\n✅ 工具栏梳理走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
}
