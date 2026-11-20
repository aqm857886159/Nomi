// 常驻交互驱动（开一次、不关、边看边点）——各线验证界面的默认工具，技能见 .agents/skills/verify-nomi/SKILL.md。
//
// 不直接跑它：用 `node tests/ux/ui.mjs up [参数]` 起（它在后台起本文件、等到可驱动才返回），`node tests/ux/ui.mjs down` 关。
// 默认隔离 + 安静：临时资料、临时能力目录、屏外不抢焦点；要真实资料必须 `--real-profile` + NOMI_WALK_FOREGROUND_OK=1。
// 参数见 uiDriverOptions.mjs；命令见 ui.mjs。证据（截图、命令流水 commands.jsonl、错误日志）落仓库外的证据目录。
//
// Electron 专用（Nomi 要主进程 + IPC 桥，普通浏览器预览工具附不上去）。
import { exitIfWalkSkipped, launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { verifyBuild } from '../../scripts/package-build-stamp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { UI_DIR } from './uiDir.mjs'
import {
  acquireInstanceLock, buildLaunchOptions, parseDriverArgs, profileBanner, seedDataFixture, shotFileName,
} from './uiDriverOptions.mjs'
import { FEATURES, describeWhere } from './verifyFeatures.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = UI_DIR

let options
try {
  options = parseDriverArgs(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exit(2)
}
let lock
try {
  lock = acquireInstanceLock(DIR)
} catch (error) {
  console.error(error.message)
  process.exit(error.code === 'INSTANCE_RUNNING' ? 3 : 1)
}
for (const name of ['req.json', 'res.json', 'ready', 'state.json']) fs.rmSync(path.join(DIR, name), { force: true })
const releaseLock = () => {
  for (const name of ['ready', 'state.json']) fs.rmSync(path.join(DIR, name), { force: true })
  try {
    if (Number(fs.readFileSync(lock, 'utf8')) === process.pid) fs.rmSync(lock, { force: true })
  } catch { /* already gone */ }
}
process.once('exit', releaseLock)

console.log(profileBanner(options))
const OUT = options.out
fs.mkdirSync(OUT, { recursive: true })
const ERRLOG = path.join(OUT, 'errors.log')
const JOURNAL = path.join(OUT, 'commands.jsonl')
const logErr = (kind, msg) => { try { fs.appendFileSync(ERRLOG, `[${new Date().toISOString()}] [${kind}] ${msg}\n`) } catch { /* ignore */ } }

const startedAt = Date.now()
const tempRoot = options.isolated ? makeTempDir('ui-driver-') : null
let settingsDir = options.isolated ? seedDataFixture(options.data, tempRoot) : null
let fakeVendor = null
const saveVendorHits = () => {
  if (fakeVendor) fs.writeFileSync(path.join(OUT, 'vendor-requests.json'), JSON.stringify(fakeVendor.hits, null, 2))
}
const launchOptions = buildLaunchOptions(options, { tempRoot, settingsDir })
if (options.vendor) {
  const { startFakeApimartServer, writeFakeApimartCatalog } = await import('./_mcpL2Fixture.mjs')
  fakeVendor = await startFakeApimartServer({ pendingPolls: options.vendorPending })
  settingsDir ??= path.join(tempRoot, 'settings')
  const userDataDir = path.join(tempRoot, 'user-data')
  for (const dir of [settingsDir, userDataDir]) fs.mkdirSync(dir, { recursive: true })
  const oldCatalog = options.data.startsWith('v0.24.1-') ? JSON.parse(fs.readFileSync(path.join(settingsDir, 'model-catalog.json'), 'utf8')) : null
  const seeded = writeFakeApimartCatalog(settingsDir, userDataDir, fakeVendor.origin)
  if (oldCatalog) {
    // Keep shipped business fields; only rewrap synthetic keys and move loopback endpoints to this run.
    for (const vendor of oldCatalog.vendors) {
      if (vendor.baseUrlHint && new URL(vendor.baseUrlHint).hostname === '127.0.0.1') {
        vendor.baseUrlHint = `${fakeVendor.origin}/v1`
        if (vendor.credentialBinding) vendor.credentialBinding.origin = fakeVendor.origin
      }
    }
    for (const key of Object.values(oldCatalog.apiKeysByVendor)) key.apiKey = seeded.apiKeysByVendor.apimart.apiKey
    fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify(oldCatalog))
  }
  launchOptions.settingsDir = settingsDir
  launchOptions.syntheticCredentialStorage = true
  launchOptions.mainRequire = [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')]
  Object.assign(launchOptions.env, {
    NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_ALLOW_ORIGINS: '', NOMI_TEST_NETWORK_FIXTURE_ORIGINS: '',
    NOMI_WALK_NET_LOG: path.join(OUT, 'network.jsonl'), NOMI_DISABLE_AUTO_UPDATE: '1',
    NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: 'https://api.apimart.ai', to: fakeVendor.origin }]),
    NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: fakeVendor.origin,
  })
}
const launched = await launchNomiApp(launchOptions).catch(async (error) => {
  saveVendorHits()
  await fakeVendor?.close()
  exitIfWalkSkipped(error)
})
const { app } = launched
const appPid = app.process()?.pid ?? null

// 多窗口：打开项目会新开一个 studio 窗口、关掉起始窗口。命令前用 getWin() 取活窗口；新窗口一律套上点名的内容尺寸。
async function applySize(page) {
  if (!options.isolated) return
  try {
    const browserWindow = await app.browserWindow(page)
    await browserWindow.evaluate((window, size) => window.setContentSize(size.width, size.height), options.size)
    await page.setViewportSize(options.size)
  } catch (error) {
    logErr('resize', String(error?.message || error))
  }
}
function wireWin(w) {
  w.on('pageerror', (e) => logErr('pageerror', (e && e.stack) || String(e)))
  w.on('console', (m) => { if (m.type() === 'error') logErr('console.error', m.text()) })
  w.on('crash', () => logErr('crash', 'renderer crashed'))
  w.on('close', () => logErr('close', 'page closed'))
}
wireWin(launched.win)
app.on('window', (w) => { wireWin(w); logErr('window', 'new window seen'); void applySize(w) })
let win = launched.win
function pickLiveWin() {
  const live = app.windows().filter((w) => !w.isClosed())
  if (live.length === 0) return win
  // 多窗口时优先「打开了项目的 studio 窗口」（hash 含 projectId），避免粘在项目库 / 起始窗口上。
  const proj = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } })
  if (proj) return proj
  const main = live.find((w) => { try { return /studio|library|#\//.test(w.url()) } catch { return false } })
  return main || live[live.length - 1]
}
function getWin() {
  win = pickLiveWin()
  return win
}

// 设计实验室不是 Electron 窗口（vite 开发服务器上的独立页）：`goto design-lab` 时由 verifyFeatures 起它，
// 之后的 shot / snap / click 落在实验室页上，直到 goto 一个应用里的功能再切回来。
const surface = { lab: null }
const target = () => (surface.lab?.active ? surface.lab.page : getWin())

// ── E5 体验探针（页面侧）：延迟 / 帧率 / 认知密度 / 对比度。注入式，只读，不改产品行为。
// 见 docs/plan/2026-06-20-experience-feel-audit.md §3。
const PROBE_SRC = `(() => {
  if (window.__nomiProbe) return 'exists';
  const _cv = document.createElement('canvas'); _cv.width = _cv.height = 1; const _ctx = _cv.getContext('2d', { willReadFrequently: true });
  const toRGBA = (s) => { _ctx.clearRect(0,0,1,1); _ctx.fillStyle = '#000000'; _ctx.fillStyle = String(s||''); _ctx.fillRect(0,0,1,1); const d = _ctx.getImageData(0,0,1,1).data; return [d[0], d[1], d[2], d[3]]; };
  const overWhite = (c) => { const a = c[3]/255; return [Math.round(c[0]*a + 255*(1-a)), Math.round(c[1]*a + 255*(1-a)), Math.round(c[2]*a + 255*(1-a))]; };
  const relLum = (c) => { const [r,g,b] = c.map((v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const loadingHit = (n, rec) => {
    if (!(n instanceof Element)) return;
    const raw = n.className; const cls = String(raw && raw.baseVal !== undefined ? raw.baseVal : (raw || ''));
    if (/skeleton|shimmer|animate-pulse/i.test(cls)) rec.sawSkeleton = true;
    if (/spinner|loading|loader|animate-spin/i.test(cls)) rec.sawSpinner = true;
    if ((n.getAttribute && n.getAttribute('role') === 'progressbar') || /progress/i.test(cls)) rec.sawProgress = true;
  };
  window.__nomiProbe = {
    startLatency() {
      const rec = { t0: performance.now(), first: null, last: performance.now(), mutations: 0, sawSkeleton: false, sawSpinner: false, sawProgress: false };
      const mo = new MutationObserver((muts) => {
        const now = performance.now();
        if (rec.first === null) rec.first = now;
        rec.last = now; rec.mutations += muts.length;
        for (const m of muts) { loadingHit(m.target, rec); m.addedNodes && m.addedNodes.forEach((x) => loadingHit(x, rec)); }
      });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      rec.mo = mo; this._lat = rec; return 'started';
    },
    readLatency() {
      const rec = this._lat; if (!rec) return null; rec.mo.disconnect(); this._lat = null;
      return { firstFeedbackMs: rec.first ? Math.round(rec.first - rec.t0) : null, contentSettleMs: Math.round(rec.last - rec.t0), mutations: rec.mutations, sawSkeleton: rec.sawSkeleton, sawSpinner: rec.sawSpinner, sawProgress: rec.sawProgress };
    },
    startFps() {
      const rec = { t0: performance.now(), frames: 0, lastFrame: performance.now(), maxGap: 0, longTasks: 0, longTaskMs: 0 };
      const loop = () => { const now = performance.now(); const gap = now - rec.lastFrame; if (gap > rec.maxGap) rec.maxGap = gap; rec.lastFrame = now; rec.frames++; rec.raf = requestAnimationFrame(loop); };
      rec.raf = requestAnimationFrame(loop);
      try { rec.po = new PerformanceObserver((list) => { for (const e of list.getEntries()) { rec.longTasks++; rec.longTaskMs += e.duration; } }); rec.po.observe({ entryTypes: ['longtask'] }); } catch (e) { /* ignore */ }
      this._fps = rec; return 'started';
    },
    readFps() {
      const rec = this._fps; if (!rec) return null; cancelAnimationFrame(rec.raf); if (rec.po) rec.po.disconnect(); this._fps = null;
      const elapsed = performance.now() - rec.t0;
      return { elapsedMs: Math.round(elapsed), frames: rec.frames, fps: Math.round((rec.frames / elapsed) * 1000 * 10) / 10, longTasks: rec.longTasks, longTaskMs: Math.round(rec.longTaskMs), maxFrameGapMs: Math.round(rec.maxGap) };
    },
    density() {
      const sel = 'button,a,[role="button"],[role="tab"],input,select,textarea,[contenteditable="true"]';
      let vis = 0;
      for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(); if (r.width > 3 && r.height > 3 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) vis++; }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let runs = 0, chars = 0, node;
      while ((node = walker.nextNode())) { const t = node.textContent.trim(); if (t) { runs++; chars += t.length; } }
      return { visibleClickable: vis, textRuns: runs, textChars: chars, vw: innerWidth, vh: innerHeight };
    },
    contrast(sel) {
      const el = document.querySelector(sel); if (!el) return null;
      const fg = overWhite(toRGBA(getComputedStyle(el).color));
      let bgEl = el, bg = [255, 255, 255];
      while (bgEl) { const c = toRGBA(getComputedStyle(bgEl).backgroundColor); if (c[3] > 0) { bg = overWhite(c); break; } bgEl = bgEl.parentElement; }
      const L1 = relLum(fg) + 0.05, L2 = relLum(bg) + 0.05; const ratio = L1 > L2 ? L1 / L2 : L2 / L1;
      return { ratio: Math.round(ratio * 100) / 100, fg, bg };
    },
  };
  return 'installed';
})()`
async function ensureProbe(w) { try { await w.evaluate(PROBE_SRC) } catch { /* ignore */ } }

await launched.win.waitForLoadState('domcontentloaded')
await launched.win.waitForTimeout(800)
const readySec = Math.round((Date.now() - startedAt) / 100) / 10
const state = {
  driverPid: process.pid,
  appPid,
  isolated: options.isolated,
  locale: options.locale,
  theme: options.theme,
  size: options.sizeName,
  data: options.data,
  out: OUT,
  tempRoot,
  executable: options.executablePath ?? 'dev-build',
  startedAt: new Date(startedAt).toISOString(),
  readySec,
  ...(fakeVendor ? { fakeVendor: { name: options.vendor, origin: fakeVendor.origin } } : {}),
}
fs.writeFileSync(path.join(DIR, 'state.json'), JSON.stringify(state, null, 2))
fs.writeFileSync(path.join(DIR, 'ready'), String(process.pid))
console.log(`DRIVER READY in ${readySec}s pid=${process.pid} app=${appPid} out=${OUT} IPC=${DIR}`)

async function shot(name) {
  const p = path.join(OUT, shotFileName(name, options))
  await target().screenshot({ path: p })
  return p
}
// 快照：当前所有「可交互元素」的 标签 / 文字 / aria / 位置——据此决定点哪，不用盲猜。
async function snap() {
  return target().evaluate(() => {
    const out = []
    const els = document.querySelectorAll('button,a,[role="button"],[role="tab"],[role="option"],[role="menuitem"],input,select,textarea,[contenteditable="true"]')
    for (const e of els) {
      const r = e.getBoundingClientRect()
      if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight) continue
      const text = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48)
      const aria = e.getAttribute('aria-label') || ''
      const ph = e.getAttribute('placeholder') || ''
      out.push({ tag: e.tagName.toLowerCase(), text, aria, ph, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) })
    }
    return out.slice(0, 140)
  })
}
// 点击：支持 "aria:xxx" / "css:sel" / "text:xxx" / "role:button=名字" / 纯文字（默认按可见文字模糊匹配）/ "xy:120,80"。
async function click(spec) {
  const w = target()
  if (spec.startsWith('xy:')) {
    const [x, y] = spec.slice(3).split(',').map(Number)
    await w.mouse.click(x, y)
    return 'clicked xy ' + x + ',' + y
  }
  await locate(w, spec).first().click({ timeout: stationTimeout() })
  return 'clicked: ' + spec
}
function locate(w, spec) {
  if (spec.startsWith('css:')) return w.locator(spec.slice(4))
  if (spec.startsWith('aria:')) return w.locator(`[aria-label="${spec.slice(5)}"]`)
  if (spec.startsWith('role:')) {
    const [role, name] = spec.slice(5).split('=')
    return w.getByRole(role, name ? { name, exact: false } : {})
  }
  return w.getByText(spec.startsWith('text:') ? spec.slice(5) : spec, { exact: false })
}

// 自检：只读，回答「这个实例值不值得驱动」。
async function doctor() {
  saveVendorHits()
  const problems = []
  let build = 'packaged executable (not checked)'
  if (!options.executablePath) {
    try {
      verifyBuild(repoRoot)
      build = 'fresh (构建戳 = 当前源码)'
    } catch (error) {
      build = 'STALE'
      problems.push(`构建产物比源码旧：先 pnpm run build 再 down / up（${String(error.message).slice(0, 160)}）`)
    }
  }
  const appAlive = (() => { try { process.kill(appPid, 0); return true } catch { return false } })()
  if (!appAlive) problems.push(`App 进程 ${appPid} 不在了：down 再 up`)
  const w = getWin()
  let page = null
  try {
    page = await w.evaluate(() => ({
      url: location.href.replace(/^file:\/\/.*?#/, '#'),
      vw: innerWidth,
      vh: innerHeight,
      lang: document.documentElement.lang,
      locale: localStorage.getItem('nomi:locale:v1'),
      scheme: localStorage.getItem('nomi-color-scheme'),
      dark: document.documentElement.classList.contains('dark') || document.documentElement.dataset.colorScheme === 'dark',
    }))
  } catch (error) {
    problems.push(`读不到窗口：${String(error.message).slice(0, 120)}`)
  }
  const where = page ? await describeWhere(w).catch((error) => `unknown (${error.message})`) : 'unknown'
  if (page && options.isolated && (page.vw !== options.size.width || page.vh !== options.size.height)) {
    problems.push(`窗口内容尺寸 ${page.vw}×${page.vh}，不是点名的 ${options.sizeName}`)
  }
  if (page && options.isolated && page.locale !== options.locale) problems.push(`语言是 ${page.locale}，不是点名的 ${options.locale}`)
  const errors = fs.existsSync(ERRLOG) ? fs.readFileSync(ERRLOG, 'utf8').split('\n').filter((line) => /\[(pageerror|crash)\]/.test(line)).length : 0
  if (errors) problems.push(`渲染层报错 ${errors} 条（见 ${ERRLOG}）`)
  return {
    ok: problems.length === 0,
    ours: { driverPid: process.pid, appPid, appAlive, startedAt: state.startedAt },
    profile: options.isolated ? `isolated (${tempRoot ?? options.userDataDir})` : 'REAL PROFILE',
    build,
    locale: page?.locale ?? null,
    theme: page ? `${page.scheme ?? 'system'}${page.dark ? ' (dark rendered)' : ''}` : null,
    size: page ? `${page.vw}x${page.vh}` : null,
    where,
    windows: app.windows().filter((x) => !x.isClosed()).length,
    labOpen: Boolean(surface.lab?.active),
    out: OUT,
    problems,
    ...(fakeVendor ? { fakeVendor: state.fakeVendor } : {}),
  }
}

async function goto(name, args) {
  const feature = FEATURES[name]
  if (!feature) return { error: `没有这个功能名「${name}」。可选：${Object.keys(FEATURES).join(' / ')}` }
  const ctx = { app, win: getWin, options, surface, repoRoot, out: OUT, args, logErr }
  if (surface.lab && !feature.lab) surface.lab.active = false
  try {
    await feature.goto(ctx)
  } catch (error) {
    const failedShot = await shot(`goto-${name}-failed`).catch(() => null)
    return { error: `goto ${name} 没走到：${String(error?.message || error).split('\n')[0]}`, shot: failedShot }
  }
  const page = target()
  await page.waitForTimeout(300)
  const where = surface.lab?.active ? `design-lab ${surface.lab.url}` : await describeWhere(page).catch(() => 'unknown')
  return { at: where, shot: await shot(`goto-${name}`) }
}

async function run(cmd) {
  switch (cmd.action) {
    case 'shot': return { shot: await shot(cmd.name) }
    case 'snap': return { snap: await snap() }
    case 'doctor': return { doctor: await doctor() }
    case 'features': return { features: Object.fromEntries(Object.entries(FEATURES).map(([key, f]) => [key, f.summary])) }
    case 'goto': return goto(cmd.name, cmd.args ?? [])
    case 'click': { const r = await click(cmd.target); await target().waitForTimeout(cmd.wait ?? 700); return { ok: r, shot: await shot('live') } }
    case 'fill': { await locate(target(), cmd.sel).first().fill(cmd.val, { timeout: stationTimeout() }); await target().waitForTimeout(300); return { ok: true, shot: await shot('live') } }
    case 'press': { await target().keyboard.press(cmd.key); await target().waitForTimeout(cmd.wait ?? 400); return { ok: `pressed ${cmd.key}`, shot: await shot('live') } }
    case 'hover': { await locate(target(), cmd.target).first().hover({ timeout: 5000 }); await target().waitForTimeout(cmd.wait ?? 400); return { ok: `hovered ${cmd.target}`, shot: await shot('live') } }
    case 'setfile': { await target().locator(cmd.sel).first().setInputFiles(cmd.path, { timeout: 5000 }); await target().waitForTimeout(cmd.wait ?? 800); return { ok: true, shot: await shot('live') } }
    // read 只当只读探针（读 DOM / 读文字）；改状态一律走界面动作（验收走查规矩 1：禁 evaluate 改状态）。
    case 'read': return { value: await target().evaluate(cmd.js) }
    case 'drag': {
      // 真鼠标拖拽：按下 → 分步移动 → 松手。用于 trim / 拖片 / reorder / scrub 等手势（click 测不了）。
      const w = target()
      const steps = Math.max(1, cmd.steps ?? 12)
      await w.mouse.move(cmd.x1, cmd.y1)
      await w.mouse.down()
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps
        await w.mouse.move(cmd.x1 + (cmd.x2 - cmd.x1) * t, cmd.y1 + (cmd.y2 - cmd.y1) * t)
        await w.waitForTimeout(12)
      }
      await w.mouse.up()
      await w.waitForTimeout(cmd.wait ?? 400)
      return { ok: `drag ${cmd.x1},${cmd.y1} -> ${cmd.x2},${cmd.y2}`, shot: await shot('live') }
    }
    case 'move': { await target().mouse.move(cmd.x, cmd.y); await target().waitForTimeout(cmd.wait ?? 250); return { ok: `move ${cmd.x},${cmd.y}`, shot: await shot('live') } }
    case 'wait': await target().waitForTimeout(cmd.ms ?? 500); return { ok: true }
    // ── E5 探针动作 ──
    case 'probe-latency': {
      // 测「click → 首视觉反馈」与「内容沉降」延迟 + 有无 skeleton / spinner / 进度。target 同 click 语法。
      const w = target(); await ensureProbe(w)
      await w.evaluate('window.__nomiProbe.startLatency()')
      const r = await click(cmd.target)
      await w.waitForTimeout(cmd.wait ?? 1800)
      const m = await w.evaluate('window.__nomiProbe.readLatency()')
      return { ok: r, latency: m, shot: await shot(cmd.name || 'live') }
    }
    case 'fps-start': { const w = target(); await ensureProbe(w); await w.evaluate('window.__nomiProbe.startFps()'); return { ok: 'fps measuring…' } }
    case 'fps-stop': { const m = await target().evaluate('window.__nomiProbe.readFps()'); return { fps: m } }
    case 'density': { const w = target(); await ensureProbe(w); return { density: await w.evaluate('window.__nomiProbe.density()') } }
    case 'contrast': { const w = target(); await ensureProbe(w); return { contrast: await w.evaluate(`window.__nomiProbe.contrast(${JSON.stringify(cmd.sel)})`) } }
    case 'quit': return { quit: true }
    default: return { error: 'unknown action: ' + cmd.action }
  }
}

let running = true
const stop = () => { running = false }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
while (running) {
  const reqP = path.join(DIR, 'req.json')
  if (fs.existsSync(reqP)) {
    let cmd = null
    try { cmd = JSON.parse(fs.readFileSync(reqP, 'utf8')) } catch { /* ignore */ }
    fs.rmSync(reqP, { force: true })
    const t0 = Date.now()
    let res
    try { res = cmd ? await run(cmd) : { error: 'bad req' } } catch (e) { res = { error: String((e && e.message) || e) } }
    fs.appendFileSync(JOURNAL, JSON.stringify({ t: new Date(t0).toISOString(), ms: Date.now() - t0, ...(cmd ?? {}), ok: !res.error, ...(res.error ? { error: String(res.error).slice(0, 300) } : {}) }) + '\n')
    fs.writeFileSync(path.join(DIR, 'res.json'), JSON.stringify(res))
    if (res.quit) running = false
  }
  await new Promise((r) => setTimeout(r, 150))
}
await surface.lab?.close?.().catch(() => {})
await launched.close().catch(() => {})
saveVendorHits()
await fakeVendor?.close()
releaseLock()
console.log(`DRIVER STOPPED（证据留在 ${OUT}）`)
process.exit(0)
