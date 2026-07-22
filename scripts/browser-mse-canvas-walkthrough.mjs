// R13 走查：MSE 流媒体「保存当前帧」+ contained「放到画布」端到端（2026-07-22 审计 B 验收）。
// 确定性本地复现 B 站类 MSE：ffmpeg 现做 fragmented MP4 → 页面 MediaSource 喂流（无可下载原件）→
// 捕捞 → 分型判 MSE → 自动当前帧（页面 canvas 原生分辨率）→ 落库标注 captureQuality='frame' +
// 素材卡「视频当前帧」→ 右键「导入画布」→ 画布节点 +1（contained IPC 管道 + 探测）。
// 用法：pnpm build && node scripts/browser-mse-canvas-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.browser-mse-lab')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const base = '/tmp/nomi-mse-walk'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

// —— 现做 fragmented MP4（MSE 必须 fmp4）——
const FFMPEG = require('@ffmpeg-installer/ffmpeg').path
const fragMp4 = path.join(base, 'frag.mp4')
await execFileAsync(FFMPEG, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2',
  '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-profile:v', 'baseline',
  '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
  fragMp4,
])
ok('fragmented MP4 已生成')

// —— 本地 MSE 站：视频只经 MediaSource 喂流，blob URL 没有可下载原件 ——
const server = http.createServer((req, res) => {
  if (req.url === '/frag.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' })
    res.end(fs.readFileSync(fragMp4))
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><html><head><title>MSE 测试页</title></head>
<body style="margin:40px;font-family:sans-serif;background:#111;color:#eee">
  <h1>MSE 流媒体测试</h1>
  <video id="v" muted autoplay loop playsinline style="width:480px;height:270px;background:#000"></video>
  <script>
    const video = document.getElementById('v')
    const mediaSource = new MediaSource()
    video.src = URL.createObjectURL(mediaSource)
    mediaSource.addEventListener('sourceopen', async () => {
      const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"')
      const bytes = await fetch('/frag.mp4').then((r) => r.arrayBuffer())
      sourceBuffer.addEventListener('updateend', () => { try { mediaSource.endOfStream() } catch (e) {} })
      sourceBuffer.appendBuffer(bytes)
    })
  </script>
</body></html>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

let app = null
try {
  app = await electron.launch({
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
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.waitForTimeout(1200)

  // UI 建项目 → 进画布（store 桥就位）
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  let canvasMounted = false
  for (let i = 0; i < 6 && !canvasMounted; i++) {
    await win.getByRole('button', { name: '生成', exact: false }).first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(1000)
    canvasMounted = await win.evaluate(() => Boolean(document.querySelector('[data-nomi-generation-canvas-import-target="true"]')))
  }
  if (canvasMounted) ok('画布已挂载（导入目标在场）')
  else fail('画布没挂载')

  // 开浏览器 → 导航 MSE 页
  await win.locator('button[aria-label="打开浏览器"]').first().click({ timeout: 5000 })
  await win.waitForTimeout(1800)
  const address = win.locator('input[aria-label="地址栏"]').first()
  await address.click({ timeout: 3000 })
  await address.fill(`http://127.0.0.1:${port}/page.html`)
  await address.press('Enter')
  await win.waitForTimeout(2500)
  const viewId = await app.evaluate(async ({ webContents }, prefix) => {
    const wc = webContents.getAllWebContents().find((c) => c.getURL().startsWith(prefix))
    return wc ? wc.id : null
  }, `http://127.0.0.1:${port}`)
  if (viewId === null) throw new Error('MSE 页 view 没找到')

  // 等视频真的在播（currentSrc=blob: 且 readyState≥2）
  let videoState = null
  for (let i = 0; i < 20 && !(videoState?.ready >= 2); i++) {
    await win.waitForTimeout(400)
    videoState = await app.evaluate(async ({ webContents }, id) => {
      const wc = webContents.getAllWebContents().find((c) => c.id === id)
      if (!wc) return null
      return wc.executeJavaScript('(() => { const v = document.getElementById("v"); return v ? { src: v.currentSrc.slice(0, 24), ready: v.readyState, w: v.videoWidth } : null })()', true)
    }, viewId)
  }
  if (videoState?.src?.startsWith('blob:') && videoState.ready >= 2) ok(`MSE 视频在播（${JSON.stringify(videoState)}）`)
  else fail(`MSE 视频没起来: ${JSON.stringify(videoState)}`)

  // 开素材盒 + 捕捞
  await win.locator('[role="dialog"][aria-label="浏览器"] button[aria-label="打开素材盒"]').first().click({ timeout: 3000 })
  let overlayPage = null
  for (let i = 0; i < 12 && !overlayPage; i++) {
    await win.waitForTimeout(350)
    overlayPage = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
  }
  if (!overlayPage) throw new Error('overlay 没出现')
  await overlayPage.locator('button[aria-label="开启资源捕捞"]').first().click({ timeout: 2500 }).catch(() => {})
  await overlayPage.waitForTimeout(500)

  // 悬停视频 → Ctrl/Cmd+C
  const candidate = await app.evaluate(async ({ webContents }, id) => {
    const wc = webContents.getAllWebContents().find((c) => c.id === id)
    if (!wc) return null
    const point = await wc.executeJavaScript('(() => { const r = document.getElementById("v").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()', true)
    wc.sendInputEvent({ type: 'mouseMove', x: point.x - 3, y: point.y - 3 })
    wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
    await new Promise((r) => setTimeout(r, 600))
    return wc.executeJavaScript('window.__nomiReadBrowserResourceCapture?.() || null', true)
  }, viewId)
  if (candidate?.url?.startsWith('blob:') && candidate.mediaType === 'video') ok(`候选=MSE blob 视频（${candidate.url.slice(0, 28)}…）`)
  else fail(`候选异常: ${JSON.stringify(candidate)?.slice(0, 120)}`)

  await overlayPage.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')

  // 等落盘：应为 PNG 当前帧 + captureQuality='frame'
  const projDir = fs.readdirSync(projectsDir).map((d) => path.join(projectsDir, d)).find((d) => fs.statSync(d).isDirectory())
  const importedDir = path.join(projDir, 'assets', 'imported')
  let framePng = null
  for (let i = 0; i < 40 && !framePng; i++) {
    await win.waitForTimeout(500)
    if (!fs.existsSync(importedDir)) continue
    framePng = fs.readdirSync(importedDir, { recursive: true }).map(String)
      .filter((f) => f.endsWith('.png') && fs.statSync(path.join(importedDir, f)).isFile())[0] || null
  }
  if (!framePng) {
    fail('当前帧没落盘')
  } else {
    const full = path.join(importedDir, framePng)
    const head = Buffer.alloc(8)
    const fd = fs.openSync(full, 'r')
    fs.readSync(fd, head, 0, 8, 0)
    fs.closeSync(fd)
    const isPng = head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    if (isPng) ok(`当前帧已落盘为 PNG（${framePng}）`)
    else fail(`落盘文件不是 PNG: ${framePng}`)
    const sidecar = JSON.parse(fs.readFileSync(`${full}.meta`, 'utf8'))
    if (sidecar.captureQuality === 'frame') ok('sidecar captureQuality=frame（诚实标注）')
    else fail(`sidecar 缺 frame 标注: ${JSON.stringify(sidecar)}`)
    fs.copyFileSync(full, path.join(outDir, 'mse-current-frame.png'))
  }
  // 素材卡副标题=「视频当前帧」
  let frameLabelVisible = false
  for (let i = 0; i < 10 && !frameLabelVisible; i++) {
    await overlayPage.waitForTimeout(400)
    frameLabelVisible = (await overlayPage.getByText('视频当前帧', { exact: false }).count()) > 0
  }
  if (frameLabelVisible) ok('素材卡显示「视频当前帧」')
  else fail('素材卡没显示「视频当前帧」')
  await overlayPage.screenshot({ path: path.join(outDir, 'overlay-frame-card.png') }).catch(() => {})

  // —— contained「放到画布」：选中 → 右键 → 导入画布 → 父窗 toast + 画布出现素材节点 ——
  const tile = overlayPage.locator('[data-browser-asset-tile]').first()
  await tile.click({ timeout: 3000 })
  await tile.click({ button: 'right', timeout: 3000 })
  await overlayPage.waitForTimeout(700)
  const importItem = overlayPage.getByText('导入画布', { exact: false }).first()
  if ((await importItem.count()) > 0) ok('contained 右键菜单出现「导入画布」（探测链路通）')
  else fail('contained 右键菜单没有「导入画布」')
  await importItem.click({ timeout: 2500 }).catch(() => {})
  // 父窗（画布宿主）toast「已导入画布」= IPC 管道 + addNode 真跑了
  let importToast = false
  for (let i = 0; i < 16 && !importToast; i++) {
    await win.waitForTimeout(300)
    importToast = await win.evaluate(() => document.body.innerText.includes('已导入')).catch(() => false)
  }
  if (importToast) ok('父窗 toast「已导入画布」（contained IPC 管道端到端通）')
  else fail('父窗没出现「已导入」toast')
  // 关浏览器 → 画布上真的多了素材节点（人眼终审截图）
  await win.locator('button[aria-label="关闭浏览器"]').first().click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(1200)
  const canvasNodeVisible = await win.evaluate(() => Boolean(document.querySelector('[data-nomi-generation-canvas-import-target="true"] img, .react-flow img, [class*="canvas"] img')))
  console.log('  [canvas-after] 画布区出现图片元素:', canvasNodeVisible)
  await win.screenshot({ path: path.join(outDir, 'canvas-after-import.png') }).catch(() => {})
} catch (error) {
  console.error('走查异常:', error?.stack || error)
  failures += 1
} finally {
  if (app) {
    const proc = app.process()
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
    try { proc?.kill('SIGKILL') } catch { /* 已退出 */ }
  }
  await new Promise((resolve) => server.close(resolve))
}
console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
if (failures > 0) process.exitCode = 1
