// R13 真机走查：公开站点捕捞 sweep（2026-07-22 审计验收：普通公开图片站 ≥8/10
// 候选→落库→magic 正确；失败必须是可行动分类，不许通用「请重试」；最后验一次「放到画布」）。
// 与生产同路：真 UI 开浏览器 → sendInputEvent 悬停（bridge 冻结候选）→ overlay Ctrl/Cmd+C →
// 会话下载/诚实降级 → assets/imported 落盘 + magic + captureQuality 标注。
// 用法：pnpm build && node scripts/browser-live-capture-sweep.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.browser-live-sweep')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const base = '/tmp/nomi-live-sweep'
const settingsDir = path.join(base, 'settings')
const projectsDir = path.join(base, 'projects')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(settingsDir, { recursive: true })
const projectId = 'live-sweep-0001'
const projDir = path.join(projectsDir, `live-sweep-${projectId}`)
fs.mkdirSync(path.join(projDir, '.nomi'), { recursive: true })
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const project = {
  id: projectId, name: '公开站捕捞', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projDir,
  workbenchDocument: null, timeline: null, generationCanvas,
  payload: { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false },
}
fs.writeFileSync(path.join(projDir, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projDir, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

// 图片基准站（验收主口径，取 ≥8/10）+ 追加 MSE 视频站（B站，验「当前帧」降级，不计入 10）
const SITES = [
  { key: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Rain' },
  { key: 'wikimedia', url: 'https://commons.wikimedia.org/wiki/Main_Page' },
  { key: 'unsplash', url: 'https://unsplash.com/s/photos/rainy-night' },
  { key: 'pexels', url: 'https://www.pexels.com/search/rainy%20night/' },
  { key: 'pixabay', url: 'https://pixabay.com/images/search/rainy%20night/' },
  { key: 'giphy', url: 'https://giphy.com/search/rainy-night' },
  { key: 'dribbble', url: 'https://dribbble.com/search/sci-fi-control-room' },
  { key: 'artstation', url: 'https://www.artstation.com/search?query=scifi' },
  { key: 'behance', url: 'https://www.behance.net/search/projects/scifi%20control%20room' },
  { key: 'picsum', url: 'https://picsum.photos/' },
]
const VIDEO_SITE = { key: 'bilibili', url: 'https://www.bilibili.com/video/BV1GJ411x7h7/' }

const MAGIC = [
  { type: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'gif', bytes: [0x47, 0x49, 0x46] },
  { type: 'webp/avif/mp4', riff: true },
]
function sniffMagic(file) {
  const fd = fs.openSync(file, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  fs.closeSync(fd)
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png'
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg'
  if (head.subarray(0, 3).equals(Buffer.from([0x47, 0x49, 0x46]))) return 'gif'
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4-family'
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm'
  return `unknown(${head.subarray(0, 8).toString('hex')})`
}

const importedDir = path.join(projDir, 'assets', 'imported')
const listImported = () => (fs.existsSync(importedDir)
  ? fs.readdirSync(importedDir, { recursive: true }).map(String)
    .filter((f) => !f.endsWith('.meta') && !f.endsWith('.DS_Store'))
    .filter((f) => { try { return fs.statSync(path.join(importedDir, f)).isFile() } catch { return false } })
  : [])

const results = []
let app = null
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NOMI_E2E: '1',
      NOMI_E2E_SMOKE: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      NOMI_PROJECTS_DIR: projectsDir,
      NOMI_SETTINGS_DIR: settingsDir,
    },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.setItem('__nomiE2E', '1')
  })
  await win.reload()
  await win.waitForTimeout(1500)
  for (let i = 0; i < 5; i++) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成/ }).first()
    if (await skip.count()) await skip.click({ timeout: 1000 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(300)
  }
  const card = win.getByText('公开站捕捞', { exact: false }).first()
  if (await card.count()) {
    await card.click({ timeout: 4000 }).catch(() => {})
    await win.waitForTimeout(400)
    const cont = win.getByText('继续创作', { exact: false }).first()
    if (await cont.count()) await cont.click({ timeout: 3000 }).catch(() => {})
    await card.dblclick({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(2500)
  }
  // 进画布视图（「放到画布」验收需要 GenerationCanvas 挂载 + E2E store 桥）
  await win.getByRole('button', { name: '生成', exact: false }).first().click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(1500)

  await win.locator('button[aria-label="打开浏览器"]').first().click({ timeout: 5000 })
  await win.waitForTimeout(1800)

  // 开素材盒 + 捕捞模式（可见按钮产路）
  await win.locator('[role="dialog"][aria-label="浏览器"] button[aria-label="打开素材盒"]').first().click({ timeout: 3000 })
  let overlayPage = null
  for (let i = 0; i < 12 && !overlayPage; i++) {
    await win.waitForTimeout(350)
    overlayPage = app.windows().find((p) => p.url().includes('browser-asset-overlay')) || null
  }
  if (!overlayPage) throw new Error('overlay 没出现')
  // 捕捞开关必须等真实网页在场（起始页无 viewId 时按钮禁用）——首个站点导航完成后再开。
  let captureEnabled = false
  const ensureCaptureOn = async () => {
    if (captureEnabled) return
    const captureOn = overlayPage.locator('button[aria-label="开启资源捕捞"]').first()
    if (await captureOn.count()) {
      await captureOn.click({ timeout: 2500 }).catch(() => {})
      await overlayPage.waitForTimeout(500)
    }
    captureEnabled = (await overlayPage.locator('button[aria-label="关闭资源捕捞"][aria-pressed="true"]').count()) > 0
    console.log('  [capture-on]', captureEnabled)
  }

  const address = win.locator('input[aria-label="地址栏"]').first()
  const findView = async (prefix) => app.evaluate(async ({ webContents }, p) => {
    const wc = webContents.getAllWebContents().find((c) => c.getURL().startsWith(p))
    return wc ? wc.id : null
  }, prefix)

  const captureOnSite = async (site, wantVideo = false) => {
    const entry = { site: site.key, url: site.url, candidate: null, outcome: 'no-candidate', file: null, magic: null, quality: 'original', error: null }
    results.push(entry)
    try {
      await address.click({ timeout: 3000 })
      await address.fill(site.url)
      await address.press('Enter')
      // 等页面可用（重站点给足 12s）
      await win.waitForTimeout(site.key === 'picsum' ? 5000 : 12000)
      const viewId = await findView('http')
      if (viewId === null) { entry.outcome = 'view-missing'; return }
      await ensureCaptureOn()
      const diag = await app.evaluate(async ({ webContents }, id) => {
        const wc = webContents.getAllWebContents().find((c) => c.id === id)
        if (!wc) return null
        const state = await wc.executeJavaScript('({ ready: document.readyState, images: document.images.length, videos: document.querySelectorAll("video").length, title: document.title.slice(0, 40) })', true).catch((error) => ({ error: String(error).slice(0, 80) }))
        return { url: wc.getURL().slice(0, 90), ...state }
      }, viewId)
      console.log(`  [diag] ${site.key}:`, JSON.stringify(diag))

      const beforeFiles = listImported()
      if (wantVideo) {
        // 视频站：先点一下视频中心促发播放/清蒙层，再等 buffer（MSE currentSrc 需要播放器起来）
        await app.evaluate(async ({ webContents }, id) => {
          const wc = webContents.getAllWebContents().find((c) => c.id === id)
          if (!wc) return
          const point = await wc.executeJavaScript(`(() => {
            const video = document.querySelector('video');
            if (!video) return null;
            const rect = video.getBoundingClientRect();
            return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
          })()`, true).catch(() => null)
          if (!point) return
          wc.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
          wc.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        }, viewId)
        await win.waitForTimeout(6000)
      }
      // 找最大可见媒体元素中心 → 真输入事件悬停 → 读冻结候选
      let candidate = null
      for (let attempt = 0; attempt < 3 && !candidate; attempt++) {
        candidate = await app.evaluate(async ({ webContents }, input) => {
          const wc = webContents.getAllWebContents().find((c) => c.id === input.viewId)
          if (!wc) return null
          const point = await wc.executeJavaScript(`(async () => {
            const wantVideo = ${input.wantVideo ? 'true' : 'false'};
            const nodes = wantVideo ? [...document.querySelectorAll('video')] : [...document.images];
            const scored = nodes.map((el) => {
              const r = el.getBoundingClientRect();
              return { el, area: r.width * r.height, big: r.width >= 100 && r.height >= 80 };
            }).filter((x) => x.big).sort((a, b) => b.area - a.area);
            const best = scored[0];
            if (!best) return { reason: 'no-big-media', images: nodes.length };
            try { best.el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
            await new Promise((r) => setTimeout(r, 400));
            const r2 = best.el.getBoundingClientRect();
            const x = Math.round(Math.min(Math.max(r2.left + r2.width / 2, 4), window.innerWidth - 4));
            const y = Math.round(Math.min(Math.max(r2.top + r2.height / 2, 4), window.innerHeight - 4));
            return { x, y };
          })()`, true)
          if (!point || point.reason) return { diagPoint: point }
          wc.sendInputEvent({ type: 'mouseMove', x: point.x - 3, y: point.y - 3 })
          wc.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y })
          await new Promise((r) => setTimeout(r, 600))
          const bridge = await wc.executeJavaScript(`({
            hasFn: typeof window.__nomiReadBrowserResourceCapture,
            enabled: window.__nomiBrowserResourceCaptureBridge?.enabled ?? null,
            candidate: window.__nomiReadBrowserResourceCapture?.() || null,
          })`, true)
          return { ...bridge, point }
        }, { viewId, wantVideo })
        if (candidate && !candidate.candidate) {
          console.log(`  [bridge] ${site.key}:`, JSON.stringify({ hasFn: candidate.hasFn, enabled: candidate.enabled, diagPoint: candidate.diagPoint, point: candidate.point }))
        }
        candidate = candidate?.candidate ?? null
        if (!candidate) {
          // 滚一屏再试（懒加载站点首屏可能没大图）
          await app.evaluate(async ({ webContents }, id) => {
            const wc = webContents.getAllWebContents().find((c) => c.id === id)
            wc?.executeJavaScript('window.scrollBy(0, 600)', true)
          }, viewId)
          await win.waitForTimeout(1500)
        }
      }
      if (!candidate?.url) { entry.outcome = 'no-candidate'; return }
      entry.candidate = candidate.url.slice(0, 120)

      await overlayPage.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
      // 等落盘或错误卡（25s：含降级路）
      let newFile = null
      let errorText = null
      for (let i = 0; i < 50 && !newFile && !errorText; i++) {
        await win.waitForTimeout(500)
        const after = listImported()
        newFile = after.find((f) => !beforeFiles.includes(f)) || null
        if (!newFile) {
          errorText = await overlayPage.evaluate(() => {
            const strip = document.querySelector('[aria-label="捕捞进行中或失败"]')
            if (!strip) return null
            const text = strip.textContent || ''
            return /重试|移除/.test(text) && !/下载中/.test(text) ? text.slice(0, 160) : null
          }).catch(() => null)
        }
      }
      if (newFile) {
        const full = path.join(importedDir, newFile)
        entry.file = newFile
        entry.magic = sniffMagic(full)
        const metaPath = `${full}.meta`
        if (fs.existsSync(metaPath)) {
          const sidecar = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
          entry.quality = sidecar.captureQuality || 'original'
          if (typeof sidecar.originalUrl === 'string' && /^https?:/i.test(sidecar.originalUrl)) entry.error = 'SIDECAR-LEAK'
        }
        entry.outcome = 'landed'
      } else if (errorText) {
        entry.outcome = 'actionable-error'
        entry.error = errorText
      } else {
        entry.outcome = 'timeout-no-feedback'
      }
      // 清理临时错误卡，避免影响下一站判定
      await overlayPage.evaluate(() => {
        document.querySelectorAll('[aria-label="捕捞进行中或失败"] button').forEach((b) => {
          if (b.textContent === '移除') b.click()
        })
      }).catch(() => {})
    } catch (error) {
      entry.outcome = 'exception'
      entry.error = String(error?.message || error).slice(0, 160)
    }
  }

  const only = String(process.env.SWEEP_ONLY || '').split(',').filter(Boolean)
  for (const site of SITES) {
    if (only.length && !only.includes(site.key)) continue
    await captureOnSite(site)
  }
  if (!only.length || only.includes(VIDEO_SITE.key)) await captureOnSite(VIDEO_SITE, true)
  await overlayPage.screenshot({ path: path.join(outDir, 'overlay-final.png') }).catch(() => {})

  // —— 放到画布（contained 探测 + IPC 管道）：选一张 ready 素材 → 右键 → 导入画布 → 画布节点 +1 ——
  let canvasImport = { attempted: false, nodeAdded: false, menuVisible: false }
  const readyTile = overlayPage.locator('[data-browser-asset-tile]').first()
  if (await readyTile.count()) {
    canvasImport.attempted = true
    const nodesBefore = await win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.length ?? -1)
    await readyTile.click({ timeout: 2000 }).catch(() => {})
    await readyTile.click({ button: 'right', timeout: 2000 }).catch(() => {})
    await overlayPage.waitForTimeout(800)
    const importItem = overlayPage.getByText('导入画布', { exact: false }).first()
    canvasImport.menuVisible = (await importItem.count()) > 0
    console.log('  [canvas-import] nodesBefore=', nodesBefore)
    if (canvasImport.menuVisible) {
      await importItem.click({ timeout: 2000 }).catch(() => {})
      for (let i = 0; i < 10 && !canvasImport.nodeAdded; i++) {
        await win.waitForTimeout(500)
        const nodesAfter = await win.evaluate(() => window.__nomiCanvasStore?.getState().nodes.length ?? -1)
        canvasImport.nodeAdded = nodesAfter > nodesBefore && nodesBefore >= 0
      }
      canvasImport.toast = await win.evaluate(() => document.body.innerText.includes('已导入')).catch(() => false)
    }
    await overlayPage.screenshot({ path: path.join(outDir, 'canvas-import.png') }).catch(() => {})
  }
  results.push({ site: '__canvas-import__', ...canvasImport })
} catch (error) {
  console.error('sweep 异常:', error?.stack || error)
} finally {
  if (app) {
    const proc = app.process()
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 8000))])
    try { proc?.kill('SIGKILL') } catch { /* 已退出 */ }
  }
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2))
console.log('\n===== 公开站捕捞 sweep =====')
for (const r of results) {
  if (r.site === '__canvas-import__') {
    console.log(`  放到画布: attempted=${r.attempted} menu=${r.menuVisible} nodeAdded=${r.nodeAdded}`)
    continue
  }
  console.log(`  ${r.site.padEnd(11)} ${r.outcome.padEnd(18)} magic=${String(r.magic).padEnd(12)} quality=${r.quality}${r.error ? ' | ' + r.error.slice(0, 90) : ''}`)
}
const imageSites = results.filter((r) => SITES.some((s) => s.key === r.site))
const landedOk = imageSites.filter((r) => r.outcome === 'landed' && !String(r.magic).startsWith('unknown'))
const actionable = imageSites.filter((r) => r.outcome === 'actionable-error')
const silent = imageSites.filter((r) => ['timeout-no-feedback', 'exception', 'view-missing'].includes(r.outcome))
console.log(`\n  落库+magic OK: ${landedOk.length}/10 · 可行动失败: ${actionable.length} · 无候选: ${imageSites.filter((r) => r.outcome === 'no-candidate').length} · 静默失败: ${silent.length}`)
console.log(`  结果 JSON: ${path.join(outDir, 'results.json')}`)
