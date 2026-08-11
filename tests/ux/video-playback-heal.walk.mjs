// 群反馈回归：「导入的视频播不了」「生成的视频过段时间打开播不了」——两者在没挂播放守卫的面上
// 都长成同一副样子：纯灰壳 / 纯黑 + 一个字提示都没有，用户既判断不了也修不了。
//
// 夹具用 mpeg4-in-AVI 而非 HEVC：HEVC 是「按最差平台归一」的目标（Windows 解不了），但 macOS 走
// VideoToolbox 硬解是能播的——拿它当夹具在 mac 上根本复现不出坏样子。AVI 容器 <video> 任何平台都不认，
// 是跨平台稳定的「真播不了」，且正是导入归一化覆盖的真实 case 之一（reason=container:avi）。
// 本走查验证：
//   ① 画布节点：decode 失败 → 懒自愈转码 → 真的播出画面（videoWidth > 0）
//   ② 点开大图：此前连 onError 都没有（纯黑零提示）→ 现在同样自愈并播出画面
// 零额度：不调用任何模型，只用本地 ffmpeg 造夹具。
// 用法：pnpm run build && node tests/ux/video-playback-heal.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-video-heal-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'video-playback-heal-walk'
const projectRoot = path.join(projectsDir, `video-heal-${projectId}`)
const outDir = path.join(repoRoot, '.video-playback-heal-lab')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

let passed = 0
function assert(cond, label) {
  if (!cond) throw new Error(`WALK FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

// —— 夹具：真 AVI（存量导入视频的真实形态：归一化上线前原样落盘、Chromium 不认的容器）——
const importedDir = path.join(projectRoot, 'assets', 'imported')
fs.mkdirSync(importedDir, { recursive: true })
const stalePath = path.join(importedDir, 'stale-import.avi')
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const encode = spawnSync(
  ffmpegPath,
  ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=12',
    '-c:v', 'mpeg4', stalePath],
  { timeout: 120_000 },
)
if (encode.status !== 0) throw new Error(`AVI 夹具编码失败: ${encode.stderr?.toString().slice(-400)}`)
const VIDEO_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/imported/stale-import.avi`

const nodes = [{
  id: 'video-heal-node', kind: 'video', categoryId: 'shots', title: '存量导入片段',
  position: { x: 160, y: 160 }, exactPosition: true, size: { width: 480, height: 300 }, status: 'success',
  result: { id: 'video-heal-result', type: 'video', url: VIDEO_URL, createdAt: 1 },
}]
const payload = {
  workbenchDocument: null,
  timeline: null,
  generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
  storyboardPlan: null,
  storyboardPlanCommitted: false,
}
const project = {
  id: projectId, name: '视频播放自愈回归', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument: null, timeline: null, generationCanvas: payload.generationCanvas, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({
  name: 'video-playback-heal',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  settleMs: 2000,
})

try {

  // 先钉住前提：这段 AVI 在本 Electron 里确实解不了——否则本走查什么也没证明。
  const baseline = await win.evaluate(async (src) => await new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => resolve('decoded')
    v.onerror = () => resolve(`error:${v.error && v.error.code}`)
    setTimeout(() => resolve('timeout'), 6000)
    v.src = src
  }), VIDEO_URL)
  assert(baseline !== 'decoded', `前提成立：原始 AVI 在 Electron 里播不了（${baseline}）`)

  await win.getByText('视频播放自愈回归').first().click()
  await win.waitForTimeout(2500)

  // ① 画布节点：等自愈完成 → <video> 真的解出画面
  const nodeVideo = win.locator('[data-node-preview-video="true"]').first()
  await nodeVideo.waitFor({ state: 'attached', timeout: 20000 })
  await win.waitForFunction(() => {
    const v = document.querySelector('[data-node-preview-video="true"]')
    return Boolean(v && v.videoWidth > 0)
  }, null, { timeout: 60000 })
  const nodeState = await nodeVideo.evaluate((v) => ({ w: v.videoWidth, h: v.videoHeight, src: v.currentSrc }))
  assert(nodeState.w > 0 && nodeState.h > 0, `画布节点自愈后真的播出画面（${nodeState.w}x${nodeState.h}）`)
  assert(!/stale-import\.avi$/.test(nodeState.src), `节点已切到转码产物（${nodeState.src.split('/').pop()}）`)
  await win.screenshot({ path: path.join(outDir, '1-canvas-node-healed.png') })

  // ② 全屏预览：此前这个 <video> 连 onError 都没有，播不了就是纯黑 + 零提示。
  // 选中节点 → 浮出结果工具栏 → 点「全屏预览视频」。
  await nodeVideo.click({ force: true })
  await win.waitForTimeout(1200)
  const fullscreenButton = win.getByRole('button', { name: '全屏预览视频' }).first()
  await fullscreenButton.waitFor({ state: 'visible', timeout: 15000 })
  await fullscreenButton.click()
  await win.waitForTimeout(2000)

  const dialogVideo = win.locator('video[aria-label]').last()
  await dialogVideo.waitFor({ state: 'attached', timeout: 15000 })
  await win.waitForFunction(() => {
    const list = Array.from(document.querySelectorAll('video[aria-label]'))
    return list.some((v) => v.videoWidth > 0)
  }, null, { timeout: 30000 })
  const dialogState = await dialogVideo.evaluate((v) => ({ w: v.videoWidth, h: v.videoHeight }))
  assert(dialogState.w > 0 && dialogState.h > 0, `全屏预览也播出画面（${dialogState.w}x${dialogState.h}）`)
  await win.screenshot({ path: path.join(outDir, '2-fullscreen-preview.png') })

  console.log(`\n✅ 视频播放自愈走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
}
