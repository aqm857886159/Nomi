// 画布跟手量具 · 会话：起被测构建的隔离实例 → 打开夹具项目 → 画布就绪 → 缩放到全部在屏上。
// 被测构建由 --repo 决定：启动器从**那个仓库**的 tests/ux/_launchApp.mjs 加载（它按自己所在目录找 dist / dist-electron），
// 所以同一份量具能量「改前 / 改后」两棵树。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { PAGE_PROBE } from './probe.mjs'
import { buildProject } from './fixture.mjs'
import { stationTimeout } from '../_station-budget.mjs'

export const EDITOR = '[data-composer-host] .ProseMirror[contenteditable="true"]'
export const STAGE = '.generation-canvas-v2__stage'
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const VIEWPORT = { width: 1280, height: 933 }

/** 同机别的 Electron / Nomi 进程会抢 GPU 与 CPU，帧数就不可比了。 */
export function otherElectronProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      return out.split(/\r?\n/).map((l) => l.split('","')[0]?.replace(/^"/, '')).filter((n) => /^(electron|nomi)(\.exe)?$/i.test(n || ''))
    }
    const out = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8' })
    return out.split('\n').map((l) => path.basename(l.trim())).filter((n) => /^(electron|nomi|Nomi Helper.*)$/i.test(n))
  } catch {
    return []
  }
}

/**
 * Windows 上真实光标停在 Electron 窗口里时，会把 Playwright 合成的拖动取消（系统光标的一次 WM_MOUSEMOVE 插进来）。
 * 把系统光标挪到所有窗口之外；挪完用 Electron 自己的 getCursorScreenPoint 复核。其他平台不需要。
 */
export async function parkOsCursor(app) {
  if (process.platform !== 'win32') return { parked: 'not-needed' }
  const info = await app.evaluate(({ BrowserWindow, screen }) => ({
    wins: BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.getBounds()),
    work: screen.getPrimaryDisplay().workArea,
    scale: screen.getPrimaryDisplay().scaleFactor,
  }))
  const inside = (p) => info.wins.some((b) => p.x >= b.x - 4 && p.x <= b.x + b.width + 4 && p.y >= b.y - 4 && p.y <= b.y + b.height + 4)
  const w = info.work
  const candidates = [{ x: w.x + 3, y: w.y + w.height - 3 }, { x: w.x + w.width - 3, y: w.y + w.height - 3 }, { x: w.x + 3, y: w.y + 3 }, { x: w.x + w.width - 3, y: w.y + 3 }]
  const target = candidates.find((p) => !inside(p)) || candidates[0]
  const px = Math.round(target.x * info.scale); const py = Math.round(target.y * info.scale)
  const ps = `Add-Type -Name U -Namespace CfhCursor -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'; [void][CfhCursor.U]::SetProcessDPIAware(); [void][CfhCursor.U]::SetCursorPos(${px}, ${py})`
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
  const now = await app.evaluate(({ screen }) => screen.getCursorScreenPoint())
  return { parked: inside(now) ? 'STILL-INSIDE-WINDOW' : 'outside', at: now, windows: info.wins }
}

/**
 * 给隔离 profile 的模型目录塞一把占位 key，只为让 apimart 的 Seedance 2.0 可选（提示词面板出生成方式与时长参数）；
 * 全程不点生成、不发请求。用**被测实例自己的** safeStorage 加密：Windows 的 os_crypt 密钥存在 userData 的 Local State 里，
 * 另起一个 electron 进程加密再退出时 Local State 来不及落盘，被测实例就解不开（实测 hasApiKey=false）。
 * 目录文件每次 IPC 读取都重读盘（catalogStore.readCatalog 无缓存），写完重载页面即生效。
 */
async function seedPlaceholderKey(app, settingsDir) {
  const apiKey = await app.evaluate(({ safeStorage }) => safeStorage.encryptString('nomi-e2e-placeholder').toString('base64'))
  const file = path.join(settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const now = new Date().toISOString()
  catalog.apiKeysByVendor = { ...(catalog.apiKeysByVendor || {}), apimart: { vendorKey: 'apimart', apiKey, enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now } }
  fs.writeFileSync(file, JSON.stringify(catalog))
}

async function setWindowViewport(app, win) {
  const bw = await app.browserWindow(win)
  await bw.evaluate((w, size) => w.setContentSize(size.width, size.height), VIEWPORT)
  await win.setViewportSize(VIEWPORT)
  return win.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
}

export async function openCanvasSession({ repo, workRoot, label, media, fixtureOptions = {} }) {
  const tempRoot = path.join(workRoot, `cfh-${label}-${Date.now()}`)
  fs.mkdirSync(tempRoot, { recursive: true })
  const projectsDir = path.join(tempRoot, 'projects')
  const settingsDir = path.join(tempRoot, 'settings')
  fs.mkdirSync(projectsDir, { recursive: true })
  const fixture = buildProject(projectsDir, media, fixtureOptions)
  const { launchNomiApp } = await import(pathToFileURL(path.join(repo, 'tests/ux/_launchApp.mjs')).href)
  const launched = await launchNomiApp({
    name: `cfh-${label}`, tempRoot, settingsDir, projectsDir, settleMs: 0, syntheticCredentialStorage: true,
    timeout: stationTimeout({ operations: 4 }),
    env: { NOMI_DISABLE_AUTO_UPDATE: '1' },
    args: ['--no-proxy-server', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    initialLocalStorage: {
      'nomi:locale:v1': 'zh-CN', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1',
    },
  })
  const { app } = launched
  const s = { app, win: launched.win, tempRoot, fixture, label, repo, mainLogTail: launched.mainLogTail }
  s.close = async () => { await app.close().catch(() => undefined) }
  try {
    await seedPlaceholderKey(app, settingsDir)
    // 探针要在 React 加载前就位：注册后重载库窗口；之后新开的项目窗口自动带上。
    await app.context().addInitScript(PAGE_PROBE)
    await s.win.reload()
    await s.win.waitForLoadState('domcontentloaded')
    s.win = await openProjectFromLibrary(app, s.win, fixture.name)
    const gen = s.win.getByRole('button', { name: '生成', exact: true }).first()
    await gen.waitFor({ timeout: stationTimeout() })
    await gen.click()
    await s.win.locator(STAGE).first().waitFor({ state: 'visible', timeout: stationTimeout() })
    s.viewport = await setWindowViewport(app, s.win)
    const ok = await s.win.evaluate(() => Boolean(window.__cfhProbe?.hookInstalled() && window.__nomiCanvasStore))
    if (!ok) throw new Error('页面探针或 React 钩子没装上（__cfhProbe / __nomiCanvasStore 缺失）——量出来的数不可信')
    s.storeNodeCount = await s.win.evaluate(() => window.__nomiCanvasStore.getState().nodes.length)
    if (s.storeNodeCount !== fixture.nodeCount) throw new Error(`画布节点数 ${s.storeNodeCount} ≠ 夹具 ${fixture.nodeCount}`)
    const decline = s.win.getByRole('button', { name: '不分享', exact: true })
    if (await decline.count()) await decline.first().click().catch(() => undefined)
    await s.win.keyboard.press('Escape').catch(() => undefined)
    s.cursor = await parkOsCursor(app)
    return s
  } catch (error) {
    const shot = path.join(tempRoot, 'open-failure.png')
    await s.win.screenshot({ path: shot }).catch(() => undefined)
    await s.close()
    error.message = `${error.message}\n  失败截图：${shot}\n  主进程日志尾：\n${(s.mainLogTail?.() || []).slice(-15).join('\n')}`
    throw error
  }
}

/**
 * 库里点项目卡进项目；项目可能在新窗口或同窗口打开（URL 带 projectId=）。
 * 冷启动打开 76 个节点的项目偶尔要十几秒，期间库里的卡会被藏起来——所以卡不可见时不再点，只继续等窗口；
 * 卡还露着且等满一轮也没进项目，才再点一次。
 */
async function openProjectFromLibrary(app, libraryWin, name) {
  const projectWindow = () => app.windows().filter((p) => !p.isClosed()).find((p) => /projectId=/.test(p.url()))
  const card = libraryWin.locator('[data-project-card="true"]', { hasText: name }).first()
  for (let i = 0; i < 3; i++) { await libraryWin.keyboard.press('Escape').catch(() => undefined); await sleep(120) }
  await card.waitFor({ state: 'visible', timeout: stationTimeout() })
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await card.isVisible().catch(() => false)) {
      await card.hover().catch(() => undefined)
      const cont = card.getByRole('button', { name: /继续创作/ }).first()
      if (await cont.count()) await cont.click().catch(() => undefined)
      else await card.click().catch(() => undefined)
    }
    for (let i = 0; i < 150; i++) {
      const hit = projectWindow()
      if (hit) return hit
      await sleep(200)
    }
  }
  throw new Error('点了两次项目卡、等了 60 秒都没进项目（没有 URL 带 projectId= 的窗口）')
}

/** 缩放到全部节点在屏上，并等视口停稳。 */
export async function fitAll(s) {
  await s.win.locator('button[aria-label="适应视图"]').first().click()
  let last = ''
  for (let i = 0; i < 30; i++) {
    await sleep(150)
    const t = await s.win.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform || '')
    if (t && t === last) break
    last = t
  }
  return last
}

export function census(s) {
  return s.win.evaluate(() => {
    const vs = Array.from(document.querySelectorAll('video'))
    const posters = document.querySelectorAll('[data-node-video-poster="true"]').length
    const st = window.__nomiCanvasStore.getState()
    const videoNodes = st.nodes.filter((n) => n.kind === 'video' && n.result?.type === 'video')
    return {
      videos: vs.length,
      playing: vs.filter((v) => !v.paused && !v.ended).length,
      preload: [...new Set(vs.map((v) => v.preload))].join('/'),
      buffered: vs.reduce((sum, v) => sum + (v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0), 0),
      posters,
      videoNodes: videoNodes.length,
      videoNodesWithThumbnail: videoNodes.filter((n) => String(n.result.thumbnailUrl || '').trim()).length,
      renderedNodes: document.querySelectorAll('.react-flow__node').length,
    }
  })
}

/** 主进程视角的各进程内存（KB）：GPU 进程与页面进程。 */
export async function processMemory(s) {
  const pid = await s.win.evaluate(() => (window.nomiDesktop?.processId ?? null)).catch(() => null)
  const metrics = await s.app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.name || m.serviceName || '', ws: m.memory?.workingSetSize || 0, priv: m.memory?.privateBytes || 0 })))
  const gpu = metrics.filter((m) => m.type === 'GPU')
  const tabs = metrics.filter((m) => m.type === 'Tab')
  const sum = (xs, k) => xs.reduce((a, m) => a + (m[k] || 0), 0)
  return { gpuPrivMB: Math.round(sum(gpu, 'priv') / 1024), gpuWsMB: Math.round(sum(gpu, 'ws') / 1024), tabPrivMB: Math.round(sum(tabs, 'priv') / 1024), tabWsMB: Math.round(sum(tabs, 'ws') / 1024), tabs: tabs.length, rendererPid: pid }
}

export async function nodeRect(s, id) {
  return s.win.evaluate((id) => { const el = document.querySelector(`.react-flow__node[data-id="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }, id)
}

export async function storeNode(s, id) {
  return s.win.evaluate((id) => { const n = window.__nomiCanvasStore.getState().nodes.find((x) => x.id === id); return n ? { position: n.position, meta: n.meta, prompt: n.prompt, result: n.result ? { url: n.result.url, thumbnailUrl: n.result.thumbnailUrl } : null } : null }, id)
}

/** 选中待写节点、打开它的提示词面板（点卡片标题带）。 */
export async function selectIdle(s, idleId) {
  await s.win.keyboard.press('Escape').catch(() => undefined)
  const node = s.win.locator(`.react-flow__node[data-id="${idleId}"]`)
  await node.waitFor({ state: 'visible', timeout: stationTimeout() })
  const r = await node.boundingBox()
  const stage = await s.win.locator(STAGE).first().boundingBox()
  const p = { x: r.x + Math.min(40, r.width / 3), y: r.y + Math.min(14, r.height / 6) }
  if (p.x < stage.x || p.y < stage.y || p.x > stage.x + stage.width || p.y > stage.y + stage.height) {
    throw new Error(`待写节点不在画布舞台内（${JSON.stringify(p)} vs 舞台 ${JSON.stringify(stage)}）——点下去会点到别的界面`)
  }
  await s.win.mouse.click(p.x, p.y)
  await s.win.locator(EDITOR).first().waitFor({ state: 'visible', timeout: stationTimeout() })
}
