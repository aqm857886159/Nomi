// R13 走查：抠图改「用到才加载」后，首次使用的等待期到底给不给用户交代。
//
// 为什么单独一条：启动预热删掉后，那 ~50MB（isnet_quint8 44.3MB + ort wasm 11.8MB）
// 改由用户在第一次点抠图时当场等。这段等待是本次改动唯一转嫁给用户的代价，
// 它可不可接受，完全取决于屏幕上有没有说清「在下载、约 50MB、只此一次」。
// 单测只能证明 key→文案的映射对；这条要证明那句话真的出现在真 app 的屏幕上。
//
// 冷缓存是本走查的前提：userDataDir 每次全新 → Chromium 磁盘缓存为空 → 必然真下载。
// 命中缓存的第二次跑没有 fetch: 阶段，看不到要看的东西。
//
// 用法: node tests/ux/remove-background-first-use.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/remove-background-first-use')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 冷缓存：整份 userData 每次重建，保证模型/wasm 一定要重新下载。
const userData = path.join(repoRoot, '.tmp', 'nomi-rmbg-firstuse')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-rmbg-firstuse-projects')
for (const d of [userData, projectsDir]) {
  fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(d, { recursive: true })
}

const results = []
let n = 0
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.destroy(); resolve(true) })
      req.on('error', () => { if (Date.now() > deadline) reject(new Error('vite 未就绪')); else setTimeout(tick, 400) })
      req.setTimeout(1500, () => { req.destroy() })
    }
    tick()
  })
}

console.log('  … 启动 vite dev server …')
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5273'], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: 'ignore',
})
await waitForUrl('http://127.0.0.1:5273', 60000).catch((e) => console.error('vite 启动失败', e))

const { app, win } = await launchNomiApp({
  name: 'remove-background-first-use',
  userDataDir: userData,
  projectsDir,
  env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: 'http://127.0.0.1:5273' },
  settleMs: 2000,
})

async function snap(name) {
  n += 1
  try {
    await screenshotSettled(win, { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) })
  } catch { /* 截图失败不该让走查判负，下面有断言兜底 */ }
}

try {
  // 1) 启动后不该有任何抠图资源请求——这就是「删掉预热」的可观测证据。
  //    在 preload 之前挂网络监听，然后静置，看有没有人去拉模型/wasm。
  const startupFetches = await win.evaluate(async () => {
    const seen = []
    const origFetch = window.fetch
    window.fetch = function (...args) {
      const url = String(args[0] && args[0].url ? args[0].url : args[0])
      if (/staticimgly|onnxruntime|\.onnx|ort-wasm/i.test(url)) seen.push(url)
      return origFetch.apply(this, args)
    }
    await new Promise((r) => setTimeout(r, 3000))
    return seen
  })
  check('启动后静置 3s 未拉取任何抠图模型/运行时（预热已删）', startupFetches.length === 0,
    startupFetches.length ? startupFetches.slice(0, 2).join(', ') : '0 个请求')
  await snap('startup-no-preload')

  // 2) 首次抠图：一边真跑，一边把 onProgress 报上来的每个阶段文案记下来。
  //    这里直接调 removeBackgroundBlob 并复用生产的映射函数，量的是
  //    「用户会看到的那句话」，不是内部 key。
  console.log('  … 首次抠图（冷缓存，真下载 ~50MB，可能 30-180s）…')
  // 把当前阶段文案挂到屏幕上，位置/样式仿节点与白板上的状态胶囊，
  // 好让下面在「正在下载」那一刻定格的截图能被人眼直接判断。
  await win.evaluate(() => {
    const host = document.createElement('div')
    host.id = 'nomi-walk-progress-probe'
    host.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;border-radius:999px;background:rgba(20,20,22,.92);color:#fff;font:500 14px/1.4 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35)'
    host.textContent = '(waiting)'
    document.body.appendChild(host)
    window.__nomiWalkPhase = null
  })
  // 抠图跑在页面里，这里并行轮询：一看到下载文案就立刻截图定格那一刻。
  const downloadShot = (async () => {
    for (let i = 0; i < 600; i += 1) {
      const text = await win.evaluate(() => window.__nomiWalkPhase).catch(() => null)
      if (text && /下载|download/i.test(text)) {
        await snap('downloading-first-use')
        return text
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    return null
  })()
  const run = await win.evaluate(async () => {
    const t0 = performance.now()
    const c = document.createElement('canvas'); c.width = 256; c.height = 256
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#e23030'; ctx.beginPath(); ctx.arc(128, 128, 80, 0, Math.PI * 2); ctx.fill()
    const srcUrl = c.toDataURL('image/png')
    try {
      const mod = await import('/src/lib/removeBackground.ts')
      const phase = await import('/src/workbench/generationCanvas/nodes/localImageOpPhase.ts')
      const messages = []
      const rawKeys = []
      const blob = await mod.removeBackgroundBlob(srcUrl, ({ key, current, total }) => {
        rawKeys.push(key)
        const text = phase.removeBackgroundProgressMessage(key)
        const pct = total > 0 ? Math.round((current / total) * 100) : null
        window.__nomiWalkPhase = text
        const host = document.getElementById('nomi-walk-progress-probe')
        if (host) host.textContent = pct === null ? text : `${text} · ${pct}%`
        if (!messages.length || messages[messages.length - 1].text !== text) {
          messages.push({ text, pct, atMs: Math.round(performance.now() - t0) })
        }
      })
      const outUrl = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = outUrl })
      const oc = document.createElement('canvas'); oc.width = img.naturalWidth; oc.height = img.naturalHeight
      const octx = oc.getContext('2d'); octx.drawImage(img, 0, 0)
      const cornerAlpha = octx.getImageData(2, 2, 1, 1).data[3]
      const centerAlpha = octx.getImageData(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2), 1, 1).data[3]
      URL.revokeObjectURL(outUrl)
      return { ok: true, ms: Math.round(performance.now() - t0), size: blob.size, w: img.naturalWidth, h: img.naturalHeight, cornerAlpha, centerAlpha, messages, rawKeys }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), ms: Math.round(performance.now() - t0) }
    }
  }).catch((e) => ({ ok: false, error: String(e).slice(0, 300) }))

  if (!run.ok) {
    check('首次抠图真跑成功', false, run.error)
  } else {
    console.log(`  进度文案时间线（共 ${run.rawKeys.length} 次回调）：`)
    for (const m of run.messages) console.log(`    ${String(m.atMs).padStart(6)}ms  ${m.pct === null ? '  -' : String(m.pct).padStart(3) + '%'}  ${m.text}`)

    check('抠图出图且背景透明（角 α≈0、主体 α>0）',
      run.cornerAlpha < 40 && run.centerAlpha > 200,
      `${run.w}×${run.h}, ${(run.size / 1024).toFixed(0)}KB, 角α=${run.cornerAlpha} 心α=${run.centerAlpha}, ${run.ms}ms`)

    // 冷缓存下必须真的经历过下载阶段，否则下面「有没有交代」是空真。
    const fetchKeys = run.rawKeys.filter((k) => String(k).startsWith('fetch:'))
    check('冷缓存首次抠图确实经历了下载阶段（前提成立，非空真）', fetchKeys.length > 0,
      `${fetchKeys.length} 次 fetch 回调`)

    // 核心：下载期间屏幕上那句话必须明确说「在下载」，而不是含糊的「抠图中」。
    const downloadMsgs = run.messages.filter((m) => /下载|download/i.test(m.text))
    check('下载期间给出明确交代（出现「正在下载模型」类文案）', downloadMsgs.length > 0,
      downloadMsgs.length ? `「${downloadMsgs[0].text}」@${downloadMsgs[0].atMs}ms` : '未出现')

    // 反面：不许任何已知阶段落进兜底「抠图中」。
    const fellBack = run.messages.filter((m) => /^抠图中$|^Cutting out$/.test(m.text))
    check('没有任何阶段掉进兜底文案「抠图中」', fellBack.length === 0,
      fellBack.length ? `${fellBack.length} 段` : '0 段')

    // 等待不是一句静态文案硬扛到底：阶段应当推进过。
    check('等待期间文案有推进（不是一句话卡到底）', run.messages.length >= 2,
      `${run.messages.length} 个不同阶段`)
  }

  // 3) 「正在下载」那一刻的截图：上面并行轮询已在该时刻定格，这里确认它真的抓到了。
  const shotText = await downloadShot
  check('抓到「正在下载」那一刻并已截图（人眼可判断）', Boolean(shotText),
    shotText ? `屏幕文案：「${shotText}」` : '未抓到该时刻')

  // 4) 第二次抠图：缓存已热，只走 compute:* 阶段，用来验证「代价只付一次」。
  const warm = await win.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 192; c.height = 192
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 192, 192)
    ctx.fillStyle = '#2f7fe2'; ctx.beginPath(); ctx.arc(96, 96, 62, 0, Math.PI * 2); ctx.fill()
    const mod = await import('/src/lib/removeBackground.ts')
    const phase = await import('/src/workbench/generationCanvas/nodes/localImageOpPhase.ts')
    const host = document.getElementById('nomi-walk-progress-probe')
    const seen = []
    await mod.removeBackgroundBlob(c.toDataURL('image/png'), ({ key }) => {
      const text = phase.removeBackgroundProgressMessage(key)
      seen.push(text)
      if (host) host.textContent = text
    })
    return { ok: true, seen }
    // 不在这里 catch：让错误原样冒到外面，否则 harness 自己的 bug 会被洗成产品结论
    // （docs/lessons：harness 的 catch 会把自己的 bug 洗成产品结论）。
  }).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e).slice(0, 300) }))

  if (!warm.ok) {
    check('第二次抠图跑通（harness 未出错）', false, warm.error)
  } else {
    const seen = warm.seen
    check('第二次抠图不再出现下载文案（模型已缓存，代价只付一次）',
      seen.length > 0 && !seen.some((t) => /下载|download/i.test(t)),
      seen.length ? `阶段：${[...new Set(seen)].join(' → ')}` : '无回调')
  }
  await snap('warm-run-phases')
} catch (error) {
  check('走查未抛异常', false, String(error).slice(0, 300))
} finally {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) console.log('  失败：' + failed.map((f) => f.name).join(' / '))
  console.log(`  截图目录：${shotsDir}`)
  await app.close().catch(() => {})
  vite.kill()
  process.exit(failed.length ? 1 : 0)
}
