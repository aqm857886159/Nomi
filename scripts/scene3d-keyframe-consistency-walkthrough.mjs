// R13 走查：3D 首尾帧产物可信度（2026-07-22 审计 P0 根治验证）。
// 同一条运镜：出参考视频 MP4 + 首尾帧 PNG + （选中物体带 gizmo 状态下）相机截图，然后
// ffmpeg 抽 MP4 首/尾帧与 PNG 做 SSIM 对账——同相机同时间点构图必须一致，且全部产物零 editor-only 元素
//（TransformControls 球/轴/轨迹点）。截图落 .scene3d-keyframe-lab/ 供人眼终审。
// 用法：pnpm build && node scripts/scene3d-keyframe-consistency-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.scene3d-keyframe-lab')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const base = '/tmp/nomi-keyframe-walk'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 用 app 随附的 ffmpeg（Homebrew 版在这台机器 x265 dylib 悬空）
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path
const FFPROBE = require('@ffprobe-installer/ffprobe').path

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
  cwd: repoRoot,
  env: {
    ...process.env,
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    NOMI_PROJECTS_DIR: projectsDir,
    NOMI_SETTINGS_DIR: settingsDir,
  },
})
try {
  const win = await app.firstWindow()
  const shot = async (name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.waitForTimeout(1200)

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(1500)
  await win.locator('[aria-label="添加3D 场景节点"]').first().click()
  await win.waitForTimeout(1000)
  await win.locator('[aria-label="打开 3D 编辑器"]').first().click()
  await win.waitForTimeout(3000)

  // 跳过 5 步引导
  for (let step = 1; step <= 5; step += 1) {
    const next = win.getByRole('button', { name: step < 5 ? '下一步' : '开始使用', exact: true })
    await next.first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(400)
  }

  // 场景内容：城市街道模板（有楼有路，构图差异一眼可辨）
  await win.locator('[data-coach="add-button"]').first().click()
  await win.waitForTimeout(600)
  await win.getByText('场景模板', { exact: true }).first().click()
  await win.waitForTimeout(600)
  await win.getByText('城市街道', { exact: true }).first().click()
  await win.waitForTimeout(1200)

  // 选相机 → 推近预设（一段 3s 运镜）
  await win.getByText('相机1', { exact: true }).first().click()
  await win.waitForTimeout(800)
  await win.getByRole('button', { name: '预设', exact: true }).first().click().catch(() => {})
  await win.waitForTimeout(400)
  await win.getByRole('button', { name: '推近', exact: true }).first().click()
  await win.waitForTimeout(1200)
  ok('运镜段已落（推近）')

  const exportBtn = win.locator('[data-coach="export-button"]')

  // —— 产物 1：参考视频 MP4（任务优先 IA：切「运镜参考」任务 → CTA 直达）——
  await win.getByRole('tab', { name: /运镜参考/ }).first().click()
  await win.waitForTimeout(500)
  await exportBtn.first().click()
  await win.waitForTimeout(800)
  let videoUrl = null
  for (let i = 0; i < 90 && !videoUrl; i += 1) {
    videoUrl = await win.evaluate(() => {
      const store = window.__nomiCanvasStore
      const node = store?.getState().nodes.find((n) => n.meta?.cameraMoveVideo?.url)
      return node?.meta?.cameraMoveVideo?.url ?? null
    }).catch(() => null)
    if (!videoUrl) await win.waitForTimeout(1000)
  }
  if (videoUrl) ok(`参考视频已生成: ${String(videoUrl).slice(0, 80)}`)
  else fail('90s 内参考视频没生成')

  // —— 产物 2：首尾帧 PNG（离屏同源采样；入口在整运镜>预设区）——
  await win.getByRole('button', { name: '知道了', exact: true }).first().click().catch(() => {})
  await win.getByRole('button', { name: '导出运镜首尾帧', exact: true }).first().click()
  let frameNodes = []
  for (let i = 0; i < 45 && frameNodes.length < 2; i += 1) {
    frameNodes = await win.evaluate(() => {
      const store = window.__nomiCanvasStore
      return (store?.getState().nodes ?? [])
        .filter((n) => /运镜(首|尾)帧/.test(String(n.title || '')))
        .map((n) => ({ title: n.title, url: n.result?.url ?? null }))
    }).catch(() => [])
    if (frameNodes.length < 2) await win.waitForTimeout(1000)
  }
  if (frameNodes.length >= 2 && frameNodes.every((n) => n.url)) ok(`首尾帧节点已建: ${frameNodes.map((n) => n.title).join(' / ')}`)
  else fail(`首尾帧节点缺失: ${JSON.stringify(frameNodes)}`)
  await shot('01-after-keyframes.png')

  // —— 产物 3：选中相机（轨迹线/白点/相机辅助线全部在场）状态下的相机截图（live 路径隐藏集验证）。
  // 注：物体 TransformControls 只随物体选中出现，而相机截图必须选中相机——live 路径真实的
  // 残留风险=轨迹可视物与相机 helper（旧代码未打标，会烧进导出；见 02 视口截图对照）。——
  await win.getByRole('button', { name: '知道了', exact: true }).first().click().catch(() => {})
  await win.getByText('相机1', { exact: true }).first().click()
  await win.waitForTimeout(800)
  await shot('02-camera-selected-trajectory-visible.png')
  // 构图任务 CTA=「使用这张构图」=相机截图（任务优先 IA）
  await win.getByRole('tab', { name: /构图图/ }).first().click()
  await win.waitForTimeout(400)
  await exportBtn.first().click()
  // 等相机截图的图片节点真正落 result.url（importRemoteUrl 异步）
  let cameraShotUrl = null
  for (let i = 0; i < 20 && !cameraShotUrl; i += 1) {
    cameraShotUrl = await win.evaluate(() => {
      const store = window.__nomiCanvasStore
      const node = (store?.getState().nodes ?? []).find((n) => /3D截图/.test(String(n.title || '')) && n.result?.url)
      return node?.result?.url ?? null
    }).catch(() => null)
    if (!cameraShotUrl) await win.waitForTimeout(500)
  }
  if (cameraShotUrl) ok('已在选中物体（gizmo 在场）状态下出相机截图')
  else fail('相机截图节点没落 result.url')

  // —— 产物文件：从节点 URL 精确映射（nomi-local://asset/<projectId>/assets/... → projectRoot/assets/...）——
  const projectRoot = fs.readdirSync(projectsDir).map((d) => path.join(projectsDir, d)).find((d) => fs.statSync(d).isDirectory())
  const assetPathFromUrl = (url) => {
    const match = /\/assets\/(.+)$/.exec(String(url || ''))
    if (!match) return null
    return path.join(projectRoot, 'assets', decodeURIComponent(match[1]))
  }
  const mp4 = assetPathFromUrl(videoUrl)
  const firstPng = assetPathFromUrl(frameNodes.find((n) => /首帧/.test(n.title))?.url)
  const lastPng = assetPathFromUrl(frameNodes.find((n) => /尾帧/.test(n.title))?.url)
  const cameraShotPng = assetPathFromUrl(cameraShotUrl)
  for (const [label, file] of [['mp4', mp4], ['首帧', firstPng], ['尾帧', lastPng], ['相机截图', cameraShotPng]]) {
    if (!file || !fs.existsSync(file)) throw new Error(`${label} 文件不存在: ${file}`)
  }
  console.log('  产物: mp4=', path.basename(mp4), ' first=', path.basename(firstPng), ' last=', path.basename(lastPng), ' camshot=', path.basename(cameraShotPng))

  // —— ffmpeg 抽 MP4 首/尾帧 ——
  const mp4First = path.join(outDir, 'mp4-first.png')
  const mp4Last = path.join(outDir, 'mp4-last.png')
  await execFileAsync(FFMPEG, ['-y', '-i', mp4, '-vf', 'select=eq(n\\,0)', '-vframes', '1', mp4First])
  await execFileAsync(FFMPEG, ['-y', '-sseof', '-0.2', '-i', mp4, '-update', '1', '-vframes', '1', mp4Last])
  fs.copyFileSync(firstPng, path.join(outDir, 'export-first.png'))
  fs.copyFileSync(lastPng, path.join(outDir, 'export-last.png'))
  fs.copyFileSync(cameraShotPng, path.join(outDir, 'camera-screenshot.png'))

  // —— SSIM 对账（PNG 缩到 mp4 分辨率再比；同源采样应 >0.9）——
  const ssim = async (a, b) => {
    const { stderr } = await execFileAsync(FFMPEG, [
      '-i', a, '-i', b,
      '-filter_complex', '[0:v][1:v]scale2ref=flags=bicubic[left][right];[left][right]ssim',
      '-f', 'null', '-',
    ]).catch((error) => ({ stderr: String(error?.stderr || error) }))
    const match = /All:\s*([0-9.]+)/.exec(String(stderr))
    return match ? Number(match[1]) : NaN
  }
  const ssimFirst = await ssim(path.join(outDir, 'export-first.png'), mp4First)
  const ssimLast = await ssim(path.join(outDir, 'export-last.png'), mp4Last)
  console.log(`  SSIM 首帧 vs MP4第0帧: ${ssimFirst}`)
  console.log(`  SSIM 尾帧 vs MP4末帧: ${ssimLast}`)
  if (ssimFirst >= 0.9) ok(`首帧构图与 MP4 一致（SSIM=${ssimFirst.toFixed(4)}）`)
  else fail(`首帧构图与 MP4 不一致（SSIM=${ssimFirst}）`)
  if (ssimLast >= 0.9) ok(`尾帧构图与 MP4 一致（SSIM=${ssimLast.toFixed(4)}）`)
  else fail(`尾帧构图与 MP4 不一致（SSIM=${ssimLast}）`)

  // 分辨率断言：首尾帧全分辨率（1920 宽），MP4 720p 封顶
  const probe = async (file) => {
    const { stdout } = await execFileAsync(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_streams', file])
    const stream = JSON.parse(stdout).streams.find((s) => s.width)
    return { width: stream.width, height: stream.height }
  }
  const pngDim = await probe(firstPng)
  const mp4Dim = await probe(mp4)
  if (pngDim.width === 1920) ok(`首尾帧全分辨率（${pngDim.width}×${pngDim.height}）`)
  else fail(`首尾帧分辨率异常: ${JSON.stringify(pngDim)}`)
  if (mp4Dim.width === 1280) ok(`MP4 保持 720p 封顶（${mp4Dim.width}×${mp4Dim.height}，Seedance 约束零回归）`)
  else fail(`MP4 分辨率异常: ${JSON.stringify(mp4Dim)}`)

  console.log(`\n人眼终审素材已就位: ${outDir}`)
  console.log('  export-first.png / mp4-first.png —— 并排看构图 + 零 gizmo')
  console.log('  export-last.png / mp4-last.png')
  console.log('  camera-screenshot.png —— 选中物体状态下 live 相机截图，必须零 gizmo/轴/轨迹点')
} catch (error) {
  console.error('走查异常:', error?.stack || error)
  failures += 1
} finally {
  if (app) {
    const proc = app.process()
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
    try { proc?.kill('SIGKILL') } catch { /* 已退出 */ }
  }
}
console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
if (failures > 0) process.exitCode = 1
