// R13 真机走查：nomi-local 视频连续拖动进度条，主进程不得抛 ERR_INVALID_STATE。
//
// 闭合 docs/plan/2026-08-24-local-protocol-stream-ownership.md §1.6 那一环——
// 该缺陷的机制已在单测里证明（undici ReadableStreamFrom 的无保护延迟 close），
// 但「我们这个 fs 流在**真 Electron 里**确实会触发」只能在这里验。
//
// 观测点为什么放在主进程而不是截图：这个病的全部危害就是「从 microtask 抛出、没人接得住」，
// 它不改画面、不进渲染层 console。用 app.evaluate() 在**主进程**装 uncaughtException 收集器，
// 断言打的就是生产故障本身，而不是它的间接影子。
//
// 两个踩过的坑（写死在这里，别再犯）：
//   ① fixture 太小 → readyState 直奔 4、整段缓存完，25 次 seek 全打在缓存上，
//      **对照组（未修版本）也是绿的**。那种绿灯什么都没证明，所以下面强制校验缓存覆盖率。
//   ② 大文件走 UI 素材库导入会超时 → 探针拿不到地址、整轮空转。
//      改成「小文件走 UI 拿到真实地址 → 大文件直接落到同一磁盘目录 → 换文件名拼 URL」，
//      磁盘映射对不对由小文件是否躺在那儿自证。
//
// 用法：pnpm build && node scripts/local-protocol-seek-walkthrough.mjs
import { launchNomiApp, repoRoot } from '../tests/ux/_launchApp.mjs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path
const outDir = path.join(repoRoot, '.local-protocol-seek-walk')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seek-settings-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seek-projects-'))

const SEED_NAME = 'seek-seed.mp4'
const BIG_NAME = 'seek-big.mp4'
const seedPath = path.join(outDir, SEED_NAME)
const bigPath = path.join(outDir, BIG_NAME)
const MIN_BIG_BYTES = 150 * 1024 * 1024

if (!fs.existsSync(seedPath)) {
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', seedPath], { stdio: 'ignore' })
}
if (!fs.existsSync(bigPath) || fs.statSync(bigPath).size < MIN_BIG_BYTES) {
  // 无损（-qp 0）+ 噪声：testsrc 那种合成画面 x264 压得极狠，给多高的 -b:v 都到不了目标体积。
  console.log('  ⏳ 生成大 fixture（一次性，约 1-2 分钟）…')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi',
    '-i', 'testsrc=duration=20:size=1280x720:rate=30,noise=alls=60:allf=t+u',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-pix_fmt', 'yuv420p', bigPath], { stdio: 'ignore' })
}
const bigMb = fs.statSync(bigPath).size / 1024 / 1024
console.log(`  🎬 大 fixture ${bigMb.toFixed(1)} MB`)
if (fs.statSync(bigPath).size < MIN_BIG_BYTES) {
  console.log(`\n❌ fixture 只有 ${bigMb.toFixed(1)} MB，撑不出流式窗口，走查会假绿——就此停下`)
  process.exit(1)
}

const { app, win } = await launchNomiApp({
  name: 'local-protocol-seek',
  settingsDir,
  projectsDir,
  env: { NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html') },
  settleMs: 1800,
})
const shot = async (name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
let failed = false
const fail = (msg) => { failed = true; console.log(`  ✖ ${msg}`) }

try {
  // 主进程收集器。必须在任何播放之前装上。
  // 注意：装了 uncaughtException 监听后 Electron 默认处理器会因 listenerCount>1 提前返回、不再弹框——
  // 这正合意：我们要把异常**抓在手里**断言，而不是被一个模态框卡住走查。
  await app.evaluate(() => {
    globalThis.__seekUncaught = []
    process.on('uncaughtException', (error) => {
      globalThis.__seekUncaught.push({ code: error?.code ?? null, message: String(error?.message ?? error) })
    })
  })

  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2200)
  await win.keyboard.press('Escape').catch(() => {})
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1000)

  const assetTab = win.getByRole('button', { name: /素材库|Asset library/ }).first()
  if (await assetTab.count()) { await assetTab.click().catch(() => {}); await win.waitForTimeout(600) }

  const fileInput = win.locator('input[aria-label="素材文件选择器"]')
  await fileInput.waitFor({ state: 'attached', timeout: 10_000 })
  await fileInput.setInputFiles(seedPath)
  await win.waitForTimeout(3000)
  const projectTab = win.getByText('项目素材', { exact: false }).first()
  if (await projectTab.count()) { await projectTab.click().catch(() => {}); await win.waitForTimeout(1800) }
  await shot('01-seed-imported.png')

  // 探针：让 app 自己吐出真实地址，别自己拼（拼错了会「404 也不崩」= 假绿）。轮询而非死等。
  let seedUrl = null
  for (let i = 0; i < 20 && !seedUrl; i++) {
    seedUrl = await win.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        for (const attr of ['src', 'poster', 'data-src', 'href']) {
          const value = el.getAttribute?.(attr)
          if (typeof value === 'string' && value.startsWith('nomi-local://')) return value
        }
      }
      return null
    })
    if (!seedUrl) await win.waitForTimeout(750)
  }
  if (!seedUrl) throw new Error('探针没拿到 nomi-local:// 地址——素材没导入成功，后面全是空转')
  console.log(`  🔎 真实地址：${seedUrl}`)

  // 落盘目录**按文件名找**，不按 URL 反推：项目目录名是人类可读的 slug
  // （「未命名项目 08_24 16_29-mt6z62lt-e8a9abf2」），不是 URL 里的 projectId，
  // 反推必错（第一版就栽在这，被下面这句自证拦下了）。
  const findSeed = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const hit = findSeed(full); if (hit) return hit }
      else if (entry.name === SEED_NAME) return full
    }
    return null
  }
  const seedOnDisk = findSeed(projectsDir)
  if (!seedOnDisk) throw new Error(`种子文件没落盘，projectsDir=${projectsDir}`)
  console.log(`  ✓ 种子落盘于 ${path.relative(projectsDir, seedOnDisk)}`)

  const bigOnDisk = path.join(path.dirname(seedOnDisk), BIG_NAME)
  fs.copyFileSync(bigPath, bigOnDisk)
  const bigUrl = seedUrl.replace(new RegExp(`${SEED_NAME}$`), BIG_NAME)

  // 真实播放 + 连续 seek：每次 seek 都让 Chromium 中断当前 range 请求、另发一条，
  // 也就是在 protocol.handle 的响应流「读到一半」时把它取消——正是竞态窗口。
  const played = await win.evaluate(async (url) => {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    document.body.appendChild(video)
    await new Promise((resolve) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', resolve, { once: true })
      setTimeout(resolve, 15000)
    })
    const duration = video.duration
    await video.play().catch(() => {})
    let seeks = 0
    for (let i = 0; i < 30; i++) {
      const span = Number.isFinite(duration) && duration > 1 ? duration - 0.5 : 20
      // 大跳（不是顺序前进）才会让 Chromium 丢掉当前流另开一条
      video.currentTime = ((i * 7.3) % span)
      seeks++
      await new Promise((resolve) => setTimeout(resolve, 70))
    }
    let buffered = 0
    for (let i = 0; i < video.buffered.length; i++) buffered += video.buffered.end(i) - video.buffered.start(i)
    const result = {
      duration, readyState: video.readyState, seeks, error: video.error?.code ?? null,
      bufferedRatio: Number.isFinite(duration) && duration > 0 ? +(buffered / duration).toFixed(3) : null,
    }
    video.remove()
    return result
  }, bigUrl)
  console.log(`  ▶️  seek ${played.seeks} 次 · duration=${played.duration} · readyState=${played.readyState} · 缓存覆盖=${played.bufferedRatio} · err=${played.error}`)

  if (!(played.readyState >= 2)) fail(`视频没真正就绪（readyState=${played.readyState}），这轮 seek 没打到协议层`)
  if (played.error !== null) fail(`视频报错 code=${played.error}`)
  if (played.bufferedRatio !== null && played.bufferedRatio > 0.9) {
    fail(`整段几乎缓存完（覆盖=${played.bufferedRatio}），seek 打的是缓存不是协议层——这轮绿灯不作数`)
  }

  // 直球压测：比 UI seek 更密集地命中「读到一半就取消」。
  const aborted = await win.evaluate(async (url) => {
    let done = 0
    for (let i = 0; i < 60; i++) {
      const controller = new AbortController()
      fetch(url, { signal: controller.signal })
        .then((response) => response.body?.getReader().read())
        .catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, i % 5 === 0 ? 0 : 10))
      controller.abort()
      done++
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    return done
  }, bigUrl)
  console.log(`  ✂️  中途 abort ${aborted} 次`)
  await shot('02-after-seek-storm.png')
  await win.waitForTimeout(800)

  // 判据①：主进程一条未捕获异常都不许有
  const uncaught = await app.evaluate(() => globalThis.__seekUncaught ?? [])
  if (uncaught.length) {
    fail(`主进程抓到 ${uncaught.length} 条未捕获异常：`)
    for (const item of uncaught.slice(0, 5)) console.log(`      ${item.code} ${item.message}`)
  } else {
    console.log('  ✓ 主进程零未捕获异常')
  }

  // 判据②：崩溃日志里不许出现 ERR_INVALID_STATE
  const logPath = await app.evaluate(({ app: electronApp }) =>
    require('node:path').join(electronApp.getPath('logs'), 'nomi-crash.log')).catch(() => null)
  if (logPath && fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf8')
    if (log.includes('ERR_INVALID_STATE')) fail(`nomi-crash.log 里有 ERR_INVALID_STATE：${logPath}`)
    else console.log('  ✓ nomi-crash.log 无 ERR_INVALID_STATE')
  } else {
    console.log('  ✓ 未生成 nomi-crash.log（没有崩溃可记）')
  }
} catch (error) {
  fail(`走查异常：${error?.stack || error}`)
  await shot('99-error.png').catch(() => {})
} finally {
  await app.close().catch(() => {})
}

console.log(failed ? '\n❌ 走查未通过' : '\n✅ 走查通过：连续 seek + 中途 abort 下主进程零 ERR_INVALID_STATE')
process.exit(failed ? 1 : 0)
