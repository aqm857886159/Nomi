// PR#24 抠图(BG Removal) R13 走查 —— DEV 模式真 app 真引擎，验本 PR 最大运行时风险点：
//  A 启动跨源隔离生效（crossOriginIsolated===true → COOP/COEP 头落地 → SharedArrayBuffer 可用，ONNX 多线程不退单线程）
//    + 真跑一次 removeBackgroundBlob()（合成图，端到端走 worker → @imgly WASM → CDN 模型 → 透明 PNG）
//  B 打开画板节点 modal（WhiteboardDrawingTool/LeaferCanvas churn 零回归）
//  贯穿：全程零 console error / 零 pageerror（CSP/worker 接线错会在 preload/抠图时抛）
// DEV 模式：脚本内起 vite(127.0.0.1:5273) → electron 以 NOMI_DESKTOP_DEV 连 dev（vite 提供 /src，真 import 才解析）
// 用法: node tests/ux/remove-background.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/remove-background')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-rmbg')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-rmbg-projects')
for (const d of [userData, projectsDir]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }

const results = []
let n = 0
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`) }

// ── 起 vite dev server ──
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
  // This journey asserts SharedArrayBuffer for the ONNX worker; opt into the Vite headers it needs.
  env: { ...process.env, NOMI_DEV_CROSS_ORIGIN_ISOLATION: '1' },
  stdio: 'ignore',
})
await waitForUrl('http://127.0.0.1:5273', 60000).catch((e) => { console.error('vite 启动失败', e); })

const consoleErrors = []
const { app, win: _win } = await launchNomiApp({
  name: 'remove-background',
  userDataDir: userData,
  projectsDir,
  env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: 'http://127.0.0.1:5273' },
  settleMs: 2000,
})
let win = _win
const getWin = () => {
  // dev 模式 openDevTools({mode:'detach'}) 会多出 devtools:// 窗口，必须排除否则误点到它上
  const live = app.windows().filter((w) => { try { return !w.isClosed() && !w.url().startsWith('devtools://') } catch { return false } })
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
function wire(w) {
  w.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  w.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
}
wire(win)
app.on('window', wire)
async function snap(name) { n += 1; try { await screenshotSettled(getWin(), { path: path.join(shotsDir, `${String(n).padStart(2, '0')}-${name}.png`) }) } catch { /* */ } }
async function dismiss() {
  for (let i = 0; i < 6; i++) {
    const skip = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后|关闭/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }
}

try {
  // A1 跨源隔离：COOP/COEP 头若没落地，crossOriginIsolated=false → ONNX 退单线程（本 PR 专门加的头）
  const isolated = await win.evaluate(() => self.crossOriginIsolated === true)
  check('跨源隔离生效 crossOriginIsolated=true（COOP/COEP 头落地）', isolated, `crossOriginIsolated=${isolated}`)
  const sab = await win.evaluate(() => typeof SharedArrayBuffer !== 'undefined')
  check('SharedArrayBuffer 可用（ONNX 多线程前提）', sab)

  // A2 真跑抠图：合成「白底红圆」→ removeBackgroundBlob → 透明 PNG。端到端走 worker+WASM+CDN 模型。
  console.log('  … 真跑 removeBackground（首跑拉模型，可能 30-120s）…')
  const rmbg = await win.evaluate(async () => {
    const t0 = performance.now()
    const c = document.createElement('canvas'); c.width = 256; c.height = 256
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#e23030'; ctx.beginPath(); ctx.arc(128, 128, 80, 0, Math.PI * 2); ctx.fill()
    const srcUrl = c.toDataURL('image/png')
    try {
      const mod = await import('/src/lib/removeBackground.ts')
      const blob = await mod.removeBackgroundBlob(srcUrl)
      const outUrl = URL.createObjectURL(blob)
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = outUrl })
      const oc = document.createElement('canvas'); oc.width = img.naturalWidth; oc.height = img.naturalHeight
      const octx = oc.getContext('2d'); octx.drawImage(img, 0, 0)
      const cornerAlpha = octx.getImageData(2, 2, 1, 1).data[3]
      const centerAlpha = octx.getImageData(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2), 1, 1).data[3]
      URL.revokeObjectURL(outUrl)
      return { ok: true, ms: Math.round(performance.now() - t0), size: blob.size, w: img.naturalWidth, h: img.naturalHeight, cornerAlpha, centerAlpha }
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e), ms: Math.round(performance.now() - t0) }
    }
  }).catch((e) => ({ ok: false, error: String(e).slice(0, 200) }))

  if (rmbg.ok) {
    check('removeBackground 返回 PNG（端到端 worker+WASM+模型）', rmbg.size > 0 && rmbg.w > 0, `${rmbg.w}×${rmbg.h}, ${(rmbg.size / 1024).toFixed(0)}KB, ${rmbg.ms}ms`)
    check('背景被抠透明（角 alpha≈0，主体 alpha>0）', rmbg.cornerAlpha < 40 && rmbg.centerAlpha > 200, `角α=${rmbg.cornerAlpha} 心α=${rmbg.centerAlpha}`)
  } else {
    check('removeBackground 真跑成功', false, rmbg.error)
  }

  // B 回归：进项目 → 生成画布 → 加画板节点 → 打开 modal
  await dismiss() // 先关开屏/上手浮层，否则盖住新建按钮
  await getWin().waitForTimeout(400)
  await getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first().click({ timeout: 4000 }).catch(() => {})
  await dismiss()
  await getWin().waitForTimeout(1200)
  const projectId = (/projectId=([^&]+)/.exec(getWin().url()) || [])[1] || ''
  check('新建并进入项目', Boolean(projectId))

  await getWin().locator('button, [role="button"], [role="tab"]', { hasText: /^生成$/ }).first().click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(900)
  await dismiss()
  await getWin().waitForTimeout(500)
  await snap('canvas-tab')

  // 画板自 2026-09-06「第三档」起住在左缘的「更多」里；点法收口在 _canvasRail，找不到当场抛
  //（原来那句 `.catch(() => {})` 会静默不建节点，后面每一步都在空画布上跑成假绿）。
  await addCanvasNodeFromRail(getWin(), 'whiteboard')
  await getWin().waitForTimeout(1200)
  await snap('node-added')

  await getWin().locator('[data-testid="whiteboard-empty-action"]').first().click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(1000)
  const modal = getWin().locator('[data-nomi-whiteboard-modal="true"]').first()
  await modal.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  await getWin().waitForTimeout(1000)
  const leaferHost = getWin().locator('[aria-label="Leafer 画板"]').first()
  const wbMounted = (await modal.count()) > 0 && (await leaferHost.count()) > 0
  check('画板 modal + leafer 挂载（白板 churn 零回归）', wbMounted)
  await snap('whiteboard-open')

  check('全程零 console error / pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (e) {
  check('走查异常', false, String(e).slice(0, 200))
} finally {
  await snap('final')
  const passed = results.filter((r) => r.ok).length
  console.log(`\n抠图 R13: ${passed}/${results.length} 通过 · console错误 ${consoleErrors.length} 条 · 截图 ${shotsDir}`)
  if (consoleErrors.length) console.log('errors:\n' + consoleErrors.slice(0, 8).map((e) => '  - ' + e).join('\n'))
  await app.close().catch(() => {})
  try { vite.kill('SIGKILL') } catch { /* */ }
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}
