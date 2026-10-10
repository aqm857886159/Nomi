import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 「刚打开项目、马上选中图片节点」整块画布崩（React #185 无限更新）的真机复现 / 回归循环。
//
// 走的是生产构建（dist + dist-electron，先 `pnpm run build`），隔离资料目录、窗口挂屏幕外不抢焦点，
// 零花费（隔离资料里没有任何凭据）。每一轮：项目库双击打开 → 节点一出现就点它 → 看控制台有没有 #185 /
// 「Maximum update depth」、浮条有没有挂出来 → 回项目库。崩了就重起 App 接着跑。
//
// 用法：node tests/ux/canvas-toolbar-open-select.walk.mjs [--rounds 30] [--instant] [--inject-toolbar-error] [--trace] [--shot] [--locale en]
//   缺省：人手节奏（节点挂出来再点）；--instant：摆全貌同一帧点（确定性撞窗口，修前每次「同一 App 再次打开」必崩）；
//   --inject-toolbar-error：浮条一量就抛错，验错误边界只降级浮条；--trace：记下每次测量的 transform 与矩形。
// 输出：每轮一行 + 结尾一行 `CRASH_RATE crashed/rounds`，任一轮崩 / 画布没了 / 浮条不符预期就非零退出；
// 证据 JSON 与截图写到 tests/ux/shots/canvas-toolbar-open-select/。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expectVisible } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { backToLibrary } from './_shell.mjs'

const roundsArg = process.argv.indexOf('--rounds')
const rounds = roundsArg > 0 ? Number(process.argv[roundsArg + 1]) : 30
// --instant：不靠手速撞窗口，而是在「摆全貌」改掉 React Flow 缩放的**同一帧**（它回写 store 的 setTimeout 之前）点节点。
// 这就是 L-qa2 撞到的那一刻：屏幕上已是 2.1 倍，store 里还是 1。
const instant = process.argv.includes('--instant')
// --inject-toolbar-error：浮条一量尺寸就抛错——验浮条外壳的错误边界只降级浮条、画布照常（不是整块「加载失败」）。
const injectToolbarError = process.argv.includes('--inject-toolbar-error')
// --locale en：英文轨（截图用）；--shot：第 2 轮（同一 App 里再次打开，正好落在窗口里）截一张整窗。
const localeArg = process.argv.indexOf('--locale')
const locale = localeArg > 0 ? process.argv[localeArg + 1] : 'zh-CN'
const shot = process.argv.includes('--shot')
const GENERATE_TAB = /^(生成|Generate)$/
const offscreen = path.resolve('tests/ux/full-walk/offscreenWindow.cjs')
const root = makeTempDir('nomi-toolbar-open-select-')
const projectsDir = path.join(root, 'projects')
const projectId = 'toolbar-open-select'
const projectRoot = path.join(projectsDir, projectId)
const assetsDir = path.join(projectRoot, 'assets/generated')
const output = path.resolve('tests/ux/shots/canvas-toolbar-open-select')
fs.mkdirSync(assetsDir, { recursive: true })
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(output, { recursive: true })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1024x768', '-frames:v', '1', path.join(assetsDir, 'still.png')], { stdio: 'pipe' })

// 一张图片节点：打开时「摆全貌」会把画布放大到 2 倍以上——浮条的反向缩放和屏幕上的真实缩放差得最远的那一档。
const nodes = [{
  id: 'still', kind: 'image', categoryId: 'shots', title: '静帧',
  position: { x: 160, y: 180 }, size: { width: 340, height: 255 }, status: 'success',
  result: { id: 'still-result', type: 'image', url: `nomi-local://asset/${projectId}/assets/generated/still.png`, createdAt: 1 },
  runs: [{ id: 'still-run', status: 'success', resultId: 'still-result', startedAt: 1, updatedAt: 2 }],
  meta: { previewHeight: 255 },
}]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: '浮条打开即选', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const CRASH = /Maximum update depth|Minified React error #185/
let run = null
let crashedThisRound = false
async function launch() {
  run = await launchNomiApp({
    name: 'canvas-toolbar-open-select', projectsDir, settleMs: 0, mainRequire: [offscreen],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
  })
  const page = run.win
  page.setDefaultTimeout(stationTimeout({ operations: 2 }))
  page.on('console', (message) => { if (message.type() === 'error' && CRASH.test(message.text())) crashedThisRound = true })
  page.on('pageerror', (error) => { if (CRASH.test(String(error?.message ?? error))) crashedThisRound = true })
  // offscreen hook 之外再补一刀：App 自己定位窗口之后也必须留在屏幕外。
  const win = await run.app.browserWindow(page)
  await win.evaluate((w) => w.setBounds({ x: -32000, y: -32000, width: 1680, height: 1050 }))
}

const results = []
const failures = []
await launch()
try {
  for (let round = 1; round <= rounds; round += 1) {
    crashedThisRound = false
    const page = run.win
    if (process.argv.includes('--trace')) await page.evaluate(() => {
      // 诊断：记下浮条每一次被量时它身上的 transform（含反向缩放 = store 缩放）与量到的矩形。
      const original = Element.prototype.getBoundingClientRect
      const log = []
      window.__shellMeasures = log
      Element.prototype.getBoundingClientRect = function patched() {
        const rect = original.call(this)
        if (this.dataset?.nodeFloatingToolbar === 'true' && log.length < 60) {
          const v = document.querySelector('.react-flow__viewport')
          log.push({ t: this.style.transform, mw: this.style.maxWidth, l: Math.round(rect.left), r: Math.round(rect.right), top: Math.round(rect.top), b: Math.round(rect.bottom), ow: this.offsetWidth, flow: v ? +new DOMMatrixReadOnly(getComputedStyle(v).transform).a.toFixed(3) : null })
        }
        return rect
      }
    })
    if (injectToolbarError) await page.evaluate(() => {
      const original = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function injected() {
        if (this.dataset?.nodeFloatingToolbar === 'true') throw new Error('injected floating toolbar failure')
        return original.call(this)
      }
    })
    if (instant) await page.evaluate(() => {
      // 盯住 React Flow 视口的 transform：缩放一离开 1（摆全貌落下），在同一个微任务里就把节点点下去。
      const observer = new MutationObserver(() => {
        const viewport = document.querySelector('.react-flow__viewport')
        const node = document.querySelector('[data-node-id="still"]')
        if (!viewport || !node) return
        const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a
        if (Math.abs(zoom - 1) < 1e-3) return
        observer.disconnect()
        const box = node.getBoundingClientRect()
        const at = { bubbles: true, cancelable: true, composed: true, clientX: box.left + 40, clientY: box.top + 40, button: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse' }
        const target = document.elementFromPoint(at.clientX, at.clientY) ?? node
        target.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }))
        target.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 }))
        target.dispatchEvent(new PointerEvent('pointerup', at))
        target.dispatchEvent(new MouseEvent('mouseup', at))
        target.dispatchEvent(new MouseEvent('click', at))
        window.__toolbarInstantClickZoom = zoom
        const img = node.querySelector('img')
        window.__toolbarInstantClickImage = Boolean(img && img.complete && img.naturalWidth > 0)
        // 点下去之后、onMoveEnd 回写 store 之前：浮条挂没挂出来。
        queueMicrotask(() => queueMicrotask(() => { window.__toolbarInstantMounted = Boolean(document.querySelector('[data-node-floating-toolbar="true"]')) }))
        const samples = []
        window.__toolbarSamples = samples
        const t0 = performance.now()
        const sample = () => {
          const v = document.querySelector('.react-flow__viewport')
          const shell = document.querySelector('[data-node-floating-toolbar="true"]')
          const m = shell && /scale\(([^)]+)\)/.exec(shell.style.transform)
          samples.push([Math.round(performance.now() - t0), v ? +new DOMMatrixReadOnly(getComputedStyle(v).transform).a.toFixed(3) : null, m ? +(1 / Number(m[1])).toFixed(3) : null])
          if (samples.length < 40) setTimeout(sample, 0)
        }
        sample()
      })
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
    })
    await page.locator('[data-project-card]', { hasText: '浮条打开即选' }).first().dblclick()
    // 打开后默认停在「创作」：切到生成画布（与 canvas-image-aspect 走查同一条路）。
    await clickOrFail(page.getByRole('button', { name: GENERATE_TAB }).first(), '切到生成画布')
    const node = page.locator('[data-node-id="still"]')
    await node.waitFor({ state: 'visible' }).catch(() => {})
    // 「马上」：节点一挂出来就点，不等图片 / 摆全貌落定。
    if (!instant) await node.click({ position: { x: 40, y: 40 } })
    await page.waitForTimeout(1200)
    const probe = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport')
      const flowZoom = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a : null
      const shell = document.querySelector('[data-node-floating-toolbar="true"]')
      const rect = shell?.getBoundingClientRect()
      const canvasAlive = Boolean(document.querySelector('[data-node-id="still"]')) && !document.querySelector('[data-chunk-boundary]')
      const toolbarFailed = Boolean(document.querySelector('[data-floating-toolbar-failed]'))
      return { canvasAlive, toolbarFailed, flowZoom, toolbar: Boolean(shell), netScale: shell && rect ? rect.width / shell.offsetWidth : null, clickedAtZoom: window.__toolbarInstantClickZoom ?? null, imageAtClick: window.__toolbarInstantClickImage ?? null, samples: window.__toolbarSamples ?? null, mountedBeforeStoreSync: window.__toolbarInstantMounted ?? null }
    }).catch(() => ({ canvasAlive: false, flowZoom: null, toolbar: false, netScale: null }))
    const crashed = crashedThisRound
    if (process.argv.includes('--trace')) {
      const measures = await page.evaluate(() => window.__shellMeasures ?? []).catch(() => [])
      fs.writeFileSync(path.join(output, `trace-round-${round}.json`), JSON.stringify(measures, null, 1))
    }
    results.push({ round, crashed, ...probe })
    if (crashed) failures.push(`第 ${round} 轮：React #185 无限更新`)
    if (!probe.canvasAlive) failures.push(`第 ${round} 轮：画布没了（节点不在或整块换成了加载失败）`)
    // 注入模式下浮条该被边界降级掉；其余模式选中后浮条必须挂出来。
    // 兜底必须留记号：注入时要看得见，平时一个都不许有（浮条静默消失骗过验收的那条路堵死）。
    if (injectToolbarError ? !probe.toolbarFailed : probe.toolbarFailed) failures.push(`第 ${round} 轮：错误兜底记号${injectToolbarError ? '没出现（兜底静默）' : '出现了（浮条被兜底藏掉）'}`)
    if (injectToolbarError ? probe.toolbar : !probe.toolbar) failures.push(`第 ${round} 轮：浮条${injectToolbarError ? '出错后仍挂着（边界没接住）' : '没有挂出来'}`)
    console.log(`round ${round}: ${crashed ? 'CRASH' : 'ok'} canvasAlive=${probe.canvasAlive} toolbarFailed=${probe.toolbarFailed} flowZoom=${probe.flowZoom?.toFixed?.(3)} toolbar=${probe.toolbar} netScale=${probe.netScale?.toFixed?.(3)} clickedAtZoom=${probe.clickedAtZoom} imageAtClick=${probe.imageAtClick} mountedBeforeStoreSync=${probe.mountedBeforeStoreSync} samples=${JSON.stringify(probe.samples?.filter((x, i, a) => i === 0 || JSON.stringify(x.slice(1)) !== JSON.stringify(a[i - 1].slice(1))))}`)
    if (crashed || !probe.canvasAlive) {
      await run.close().catch(() => {})
      await launch()
      continue
    }
    if (shot && round === 2) {
      await expectVisible(page.locator('[data-node-floating-toolbar="true"]'), '再次打开、摆全貌同一帧选中后浮条挂出来')
      await page.screenshot({ path: path.join(output, `open-select-toolbar-${locale}.png`) })
    }
    await backToLibrary(page)
    await page.locator('[data-project-card]', { hasText: '浮条打开即选' }).first().waitFor({ state: 'visible' })
  }
} finally {
  await run?.close().catch(() => {})
  const crashedCount = results.filter((r) => r.crashed).length
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(output, `crash-rate-${stamp}.json`), JSON.stringify({ rounds: results.length, crashed: crashedCount, results }, null, 2))
  console.log(`CRASH_RATE ${crashedCount}/${results.length}`)
  fs.rmSync(root, { recursive: true, force: true })
}
if (failures.length) {
  console.error(`❌ ${failures.length} 条失败：`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exitCode = 1
} else console.log('✅ 全部轮次画布存活、浮条行为符合预期')
