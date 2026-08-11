// 项目库封面回归：「只含本地导入视频素材（+时间轴）」的项目，项目卡封面曾显示「加载失败」——
// 根因是封面派生无视 result.type，把 mp4 的 url 塞进 <img>（NomiImage）必然 decode 失败。
// 修后：无可 <img> 封面时派生 coverVideoUrl，卡片用 <video> 首帧当封面。
//
// 本走查验证（真 dist + 隔离目录，零额度）：
//   ① 纯导入视频项目：项目卡封面真的解出视频首帧（videoWidth > 0），不是「加载失败」也不是空占位
//   ② 图片项目：封面 <img> 正常加载（回归不坏）
//   ③ 整个项目库页面没有任何「加载失败」字样
// 用法：pnpm run build && node tests/ux/library-cover-imported-video.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-cover-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const outDir = path.join(repoRoot, '.library-cover-walk-lab')
fs.mkdirSync(outDir, { recursive: true })

let passed = 0
function assert(cond, label) {
  if (!cond) throw new Error(`WALK FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
function encodeFixture(args, label) {
  const run = spawnSync(ffmpegPath, ['-v', 'error', '-y', ...args], { timeout: 120_000 })
  if (run.status !== 0) throw new Error(`${label} 夹具编码失败: ${run.stderr?.toString().slice(-400)}`)
}

/** 播种一个项目目录（project.json + .nomi/project.json，走查已验证的落盘形态）。 */
function seedProject({ id, name, folder, nodes, timeline = null }) {
  const projectRoot = path.join(projectsDir, folder)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  const payload = {
    workbenchDocument: null,
    timeline,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const project = {
    id, name, version: 2,
    createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null, timeline, generationCanvas: payload.generationCanvas, payload,
  }
  fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))
  return projectRoot
}

// —— 项目 A：只含本地导入视频素材 + 时间轴（用户上报的原始复现形态）——
const videoProjectId = 'cover-video-import-walk'
const videoRoot = path.join(projectsDir, `cover-video-${videoProjectId}`)
fs.mkdirSync(path.join(videoRoot, 'assets', 'imported'), { recursive: true })
const mp4Path = path.join(videoRoot, 'assets', 'imported', 'clip.mp4')
encodeFixture(
  ['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4Path],
  'mp4',
)
const VIDEO_URL = `nomi-local://asset/${encodeURIComponent(videoProjectId)}/assets/imported/clip.mp4`
seedProject({
  id: videoProjectId,
  name: '导入视频封面走查',
  folder: `cover-video-${videoProjectId}`,
  nodes: [{
    id: 'imported-clip', kind: 'asset', categoryId: 'assets', title: 'clip.mp4',
    position: { x: 160, y: 160 }, exactPosition: true, size: { width: 480, height: 300 }, status: 'success',
    meta: { source: 'local-drop', fileName: 'clip.mp4', uploadStatus: 'uploaded', videoDuration: 1 },
    result: { id: 'imported-clip-result', type: 'video', url: VIDEO_URL, createdAt: 1 },
  }],
  timeline: {
    tracks: [{
      id: 'video-track', kind: 'video',
      clips: [{ id: 'clip-1', nodeId: 'imported-clip', type: 'video', url: VIDEO_URL, offsetFrames: 0, durationFrames: 24 }],
    }],
    fps: 24,
  },
})

// —— 项目 B：图片产物项目（封面 <img> 路回归）——
const imageProjectId = 'cover-image-regression-walk'
const imageRoot = path.join(projectsDir, `cover-image-${imageProjectId}`)
fs.mkdirSync(path.join(imageRoot, 'assets', 'imported'), { recursive: true })
const pngPath = path.join(imageRoot, 'assets', 'imported', 'still.png')
encodeFixture(['-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=1', '-frames:v', '1', pngPath], 'png')
const IMAGE_URL = `nomi-local://asset/${encodeURIComponent(imageProjectId)}/assets/imported/still.png`
seedProject({
  id: imageProjectId,
  name: '图片封面回归走查',
  folder: `cover-image-${imageProjectId}`,
  nodes: [{
    id: 'still-image', kind: 'asset', categoryId: 'assets', title: 'still.png',
    position: { x: 160, y: 160 }, exactPosition: true, size: { width: 340, height: 300 }, status: 'success',
    meta: { source: 'local-drop', fileName: 'still.png', uploadStatus: 'uploaded' },
    result: { id: 'still-image-result', type: 'image', url: IMAGE_URL, createdAt: 1 },
  }],
})

const { app, win } = await launchNomiApp({
  name: 'library-cover-imported-video',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 2500,
})

try {

  // 首启开屏会盖住项目库（截图=用户所见，必须先关掉它再验封面）
  const skipSplash = win.getByText('跳过', { exact: false }).first()
  if (await skipSplash.isVisible().catch(() => false)) {
    await skipSplash.click()
    await win.waitForTimeout(1200)
  }

  // 项目库页：两张卡都在
  const videoCard = win.locator('[data-project-card="true"]', { hasText: '导入视频封面走查' }).first()
  const imageCard = win.locator('[data-project-card="true"]', { hasText: '图片封面回归走查' }).first()
  await videoCard.waitFor({ state: 'visible', timeout: 20000 })
  await imageCard.waitFor({ state: 'visible', timeout: 20000 })
  assert(true, '项目库显示两个播种项目卡')

  // ① 视频项目封面：卡内出现 <video> 且真的解出首帧
  const coverVideo = videoCard.locator('video').first()
  await coverVideo.waitFor({ state: 'attached', timeout: 20000 })
  await win.waitForFunction((name) => {
    const cards = Array.from(document.querySelectorAll('[data-project-card="true"]'))
    const card = cards.find((c) => c.textContent && c.textContent.includes(name))
    const v = card && card.querySelector('video')
    return Boolean(v && v.videoWidth > 0 && v.readyState >= 2)
  }, '导入视频封面走查', { timeout: 30000 })
  const coverState = await coverVideo.evaluate((v) => ({ w: v.videoWidth, h: v.videoHeight, ready: v.readyState, src: v.currentSrc }))
  assert(coverState.w > 0 && coverState.ready >= 2, `导入视频项目封面解出真首帧（${coverState.w}x${coverState.h}, readyState=${coverState.ready}）`)
  assert(/clip\.mp4/.test(coverState.src), `封面视频源就是导入的 mp4（${coverState.src.split('/').pop()}）`)

  // ② 图片项目封面：<img> 正常加载（回归不坏）
  await win.waitForFunction((name) => {
    const cards = Array.from(document.querySelectorAll('[data-project-card="true"]'))
    const card = cards.find((c) => c.textContent && c.textContent.includes(name))
    const img = card && card.querySelector('img')
    return Boolean(img && img.complete && img.naturalWidth > 0)
  }, '图片封面回归走查', { timeout: 30000 })
  assert(true, '图片项目封面 <img> 正常加载（naturalWidth > 0）')

  // ③ 整页无「加载失败」占位
  const failedCount = await win.getByText('加载失败', { exact: false }).count()
  assert(failedCount === 0, '项目库页面没有任何「加载失败」字样')

  await win.screenshot({ path: path.join(outDir, '1-library-covers.png') })
  console.log(`\n✅ 项目库封面走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
}
