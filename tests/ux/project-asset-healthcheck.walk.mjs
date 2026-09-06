// 群反馈回归（症状「生成的视频过段时间打开播不了」根治的存量抢救半边）：
// 打开项目时后台体检，把此前漏落进节点的厂商临时 URL（会过期）就地下载成本地 nomi-local 资产。
//
// 本走查用一个临时 http server 冒充厂商 CDN：种一个 result.url = http://localhost:PORT/v.mp4 的
// 视频节点（模拟主进程 projectId 时序为空时漏落的临时直链），打开项目，验证：
//   ① 体检把节点 result.url 从 http:// 换成了 nomi-local://（真的下载落地，走完整 IPC 链路）
//   ② 文件真的落到项目 assets 目录
//   ③ 落地后 <video> 真的能播（videoWidth > 0）
// 这同时证明结构闸（生成出口）用的同一条 importRemoteUrl IPC 真能把 http 下载成本地。
// 零额度：不调任何模型，视频用本地 ffmpeg 造。
// 用法：pnpm run build && node tests/ux/project-asset-healthcheck.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-healthcheck-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'asset-healthcheck-walk'
const projectRoot = path.join(projectsDir, `healthcheck-${projectId}`)
const outDir = path.join(repoRoot, '.project-asset-healthcheck-lab')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

let passed = 0
function assert(cond, label) {
  if (!cond) throw new Error(`WALK FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

// —— 造一个真 h264 mp4，用临时 http server 供给（冒充厂商 CDN 临时直链）——
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const mp4Path = path.join(root, 'cdn-video.mp4')
const encode = spawnSync(
  ffmpegPath,
  ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path],
  { timeout: 120_000 },
)
if (encode.status !== 0) throw new Error(`mp4 夹具编码失败: ${encode.stderr?.toString().slice(-400)}`)
const mp4Bytes = fs.readFileSync(mp4Path)

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4Bytes.length) })
  res.end(mp4Bytes)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const cdnUrl = `http://127.0.0.1:${server.address().port}/cdn-video.mp4`

const nodes = [{
  id: 'healthcheck-node', kind: 'video', categoryId: 'shots', title: '厂商临时URL片段',
  position: { x: 160, y: 160 }, exactPosition: true, size: { width: 480, height: 300 }, status: 'success',
  // 模拟主进程 projectId 时序为空时漏落的临时直链（会过期）
  result: { id: 'healthcheck-result', type: 'video', url: cdnUrl, createdAt: 1 },
}]
const payload = {
  workbenchDocument: null, timeline: null,
  generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
  storyboardPlan: null, storyboardPlanCommitted: false,
}
const project = {
  id: projectId, name: '开项目体检回归', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  workbenchDocument: null, timeline: null, generationCanvas: payload.generationCanvas, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win } = await launchNomiApp({
  name: 'project-asset-healthcheck',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  // --no-proxy-server：开发机若配了系统代理，主进程 applySystemProxy 会用 ProxyAgent 套住全局 fetch，
  // 把 127.0.0.1 请求也发给代理 → loopback 夹具服务器收不到。这个 switch 让 session 直连，探测到
  // DIRECT 就不套代理。真实厂商 CDN 是公网 https、经代理正常，此 switch 只为让本地夹具走查跑通。
  args: ['--no-proxy-server'],
  env: {
    // 走查用 127.0.0.1 冒充厂商 CDN，SSRF 闸默认拦 loopback。**只**报出这一个精确 origin，
    // 不再像旧的 LAB_ALLOW_LOCALHOST=1 那样把整个私网分类器关掉（那会连 169.254 云元数据段
    // 一起放行，而且随包发布）。main.ts 只在未打包构建里读它，打包版本一次都不读。
    NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: new URL(cdnUrl).origin,
    HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  },
  settleMs: 2000,
})

try {

  await win.getByText('开项目体检回归').first().click()
  await win.waitForTimeout(1500)

  // ① 体检把节点 result.url 从 http:// 换成 nomi-local://（后台异步，给它时间跑）。
  // 节点 <video> 的 src 即 result.url（buildVideoPlaybackUrl 对 nomi-local/http 都恒等透传），
  // 所以直接从 DOM 读 src：初始是 http（server 活着照样能播），体检落地后重挂载成 nomi-local。
  const nodeVideo = win.locator('[data-node-preview-video="true"]').first()
  await nodeVideo.waitFor({ state: 'attached', timeout: 20000 })
  await win.waitForFunction(() => {
    const v = document.querySelector('[data-node-preview-video="true"]')
    const src = v?.getAttribute('src') || v?.currentSrc || ''
    return src.startsWith('nomi-local://')
  }, null, { timeout: 30000 })
  const nodeUrl = await nodeVideo.evaluate((v) => v.getAttribute('src') || v.currentSrc || '')
  assert(nodeUrl.startsWith('nomi-local://'), `体检把 http 临时 URL 落地成本地（${nodeUrl.slice(0, 60)}）`)

  // ② 文件真的落到项目 assets 目录
  const generatedDir = path.join(projectRoot, 'assets', 'generated')
  const landed = fs.existsSync(generatedDir)
    && fs.readdirSync(generatedDir, { recursive: true }).some((f) => String(f).endsWith('.mp4'))
  assert(landed, '下载的视频真的落到项目 assets/generated 目录')

  // ③ 落地后真的能播
  await win.waitForFunction(() => {
    const v = document.querySelector('[data-node-preview-video="true"]')
    return Boolean(v && v.videoWidth > 0)
  }, null, { timeout: 30000 })
  const w = await nodeVideo.evaluate((v) => v.videoWidth)
  assert(w > 0, `落地后节点真的播出画面（${w}px 宽）`)
  await screenshotSettled(win, { path: path.join(outDir, 'healthcheck-localized.png') })

  console.log(`\n✅ 开项目体检走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
  server.close()
}
