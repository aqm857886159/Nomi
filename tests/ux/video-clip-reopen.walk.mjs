import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：剪辑中关窗再开（V-clip1 阻断：重开后新卡永远 running，没有收敛路径）。
// 走生产构建（先 `pnpm run build`），隔离资料目录（两次启动用同一份），窗口在屏幕外，零花费：全程本机 ffmpeg。
//
// 断言：
//   ① 剪辑跑到一半（新卡「剪辑中 · N%」、项目已存盘带着这张 running 的卡）→ 关掉整个 App；
//   ② 关窗后没有留下我们的 ffmpeg 进程（命令行里有 nomi-trim- 的）；
//   ③ 重开同一个项目：那张卡**不再 running**——变成「被打断」的失败卡，只有「重试」没有「换个模型」，原视频→新卡的线还在；
//   ④ 点「重试」→ 同一张卡重新剪（running），再点「取消」→ 卡和线没有、原视频不动。
// 用法：node tests/ux/video-clip-reopen.walk.mjs [--locale en] [--scheme dark]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findNodeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const offscreen = path.join(repoRoot, 'tests/ux/full-walk/offscreenWindow.cjs')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-10-video-clip-direct')
fs.mkdirSync(evidence, { recursive: true })
const failShotDir = path.join(repoRoot, '.tmp/walk-fail')
fs.mkdirSync(failShotDir, { recursive: true })

const temp = makeTempDir('nomi-video-clip-reopen-')
const userDataDir = path.join(temp, 'user-data')
const settingsDir = path.join(temp, 'settings')
const projectsDir = path.join(temp, 'projects')
const projectId = 'video-clip-reopen'
const projectRoot = path.join(projectsDir, projectId)
const importedDir = path.join(projectRoot, 'assets/imported')
for (const dir of [userDataDir, settingsDir, importedDir, path.join(projectRoot, '.nomi')]) fs.mkdirSync(dir, { recursive: true })
execFileSync(ffmpeg.path, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=150', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', path.join(importedDir, 'long.mp4')], { stdio: 'pipe' })

const nodes = [{
  id: 'long-video', kind: 'video', categoryId: 'shots', prompt: '', title: zhOrEn('长镜头 · 150 秒', 'Long take · 150 s'), position: { x: 200, y: 100 }, size: { width: 340, height: 191 }, status: 'success',
  result: { id: 'long-result', type: 'video', url: `nomi-local://asset/${projectId}/assets/imported/long.mp4`, createdAt: 1, durationSeconds: 150 },
  meta: { videoWidth: 1280, videoHeight: 720, videoAspectRatio: 16 / 9, videoDuration: 150 },
}]
function zhOrEn(zhText, enText) { return locale === 'en' ? enText : zhText }
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Video clip reopen', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const tr = (key) => uiText(locale, key)
const L = {
  trim: tr('generationCommon.videoTrim.toolbar'),
  confirm: tr('generationCommon.videoTrim.confirm'),
  retry: tr('generationCommon.observability.action.retry.main'),
  switchModel: [tr('generationCommon.observability.action.switchModel.main'), tr('generationCommon.observability.action.switchModel.alt')],
  cancel: tr('generationCommon.card.generationCancelAria'),
  interrupted: tr('generationCommon.localProcessing.interrupted'),
  resetView: tr('generationCommon.navigation.resetView'),
}

const results = []
const launch = () => launchNomiApp({
  name: 'video-clip-reopen', userDataDir, settingsDir, projectsDir, settleMs: 0, mainRequire: [offscreen],
  viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const nodeSel = (id) => `.react-flow__node[data-id="${id}"]`
let app
let win
const snapshot = () => win.evaluate(() => {
  const state = /** @type {any} */ (window).__nomiCanvasStore.getState()
  return {
    nodes: state.nodes.map((node) => ({ id: node.id, status: node.status, error: node.error, progress: node.progress ?? null, meta: node.meta ?? {} })),
    edges: state.edges.map((edge) => ({ source: edge.source, target: edge.target })),
  }
})
const newCards = (state) => state.nodes.filter((node) => node.id !== 'long-video')
/** 我们的剪辑进程（命令行里带 nomi-trim-）：只读查询，不碰任何进程。 */
function trimProcessCount() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Where-Object { $_.CommandLine -like '*nomi-trim-*' } | Measure-Object).Count"], { encoding: 'utf8' })
  return Number(out.trim() || 0)
}
async function task(name, body) {
  try { await body(); results.push({ name, pass: true }) } catch (error) {
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 8).join(' | ') })
    await win?.screenshot({ path: path.join(failShotDir, `FAIL-${name}.png`) }).catch(() => {})
  }
  console.log(JSON.stringify(results.at(-1)))
}
async function openProject() {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await expect(win.locator('.react-flow__node').first()).toBeVisible()
  await waitForCanvasViewportSettled(win)
  await win.getByRole('button', { name: L.resetView, exact: true }).first().click()
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)
}

try {
  let first = await launch()
  app = first.app
  win = first.win
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))

  await task('01-close-the-app-in-the-middle-of-a-trim', async () => {
    await openProject()
    let point = null
    await expect.poll(async () => { point = await findNodeHitPoint(win, { nodeSelector: nodeSel('long-video') }); return point !== null }).toBe(true)
    await win.mouse.click(point.x, point.y)
    await win.locator('[data-node-floating-toolbar]').getByRole('button', { name: L.trim, exact: true }).first().click()
    await expect(win.locator('[data-video-clip-panel]')).toBeVisible()
    await win.getByRole('button', { name: L.confirm, exact: true }).click()
    await expect.poll(async () => newCards(await snapshot())[0]?.status, { timeout: stationTimeout({ operations: 1 }) }).toBe('running')
    await expect.poll(async () => newCards(await snapshot())[0]?.progress?.percent ?? 0, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
    // 关窗那一刻存下的就是这张 running 的卡（pagehide 里立即存盘；这里只要保证它确实在跑）
    await win.waitForTimeout(1500)
    expect(trimProcessCount()).toBeGreaterThan(0) // 探针活着：关窗前确实有我们的 ffmpeg 在跑
    await app.close()
    // ② 进程：关窗之后不能留下我们的 ffmpeg
    await expect.poll(() => trimProcessCount(), { timeout: stationTimeout({ operations: 1 }) }).toBe(0)
  })

  await task('02-reopen-converges-the-card-to-an-interrupted-failure-with-retry-only', async () => {
    first = await launch()
    app = first.app
    win = first.win
    win.setDefaultTimeout(stationTimeout({ operations: 2 }))
    await openProject()
    await expect.poll(async () => newCards(await snapshot())[0]?.status, { timeout: stationTimeout({ operations: 1 }) }).toBe('error')
    const state = await snapshot()
    const card = newCards(state)[0]
    expect(state.edges).toEqual([{ source: 'long-video', target: card.id }])
    expect(card.progress).toBeNull()
    const alert = win.locator(`${nodeSel(card.id)} [role="alert"]`)
    const proof = await proveProbe(alert.getByRole('button', { name: L.retry }), '被打断的剪辑卡上有「重试」')
    await expect(win.locator(nodeSel(card.id))).toContainText(L.interrupted)
    for (const label of L.switchModel) await expectAbsent(alert.getByText(label, { exact: true }), { provenBy: proof, message: `本机处理失败卡不该有「${label}」` })
    expect(trimProcessCount()).toBe(0)
    await win.getByRole('button', { name: L.resetView, exact: true }).first().click()
    await waitForCanvasViewportSettled(win)
    await screenshotSettled(win, { path: path.join(evidence, `15-trim-interrupted-${tag}.png`) })
  })

  await task('03-retry-restarts-the-same-card-and-cancel-removes-it', async () => {
    const card = newCards(await snapshot())[0]
    await win.locator(`${nodeSel(card.id)} [role="alert"]`).getByRole('button', { name: L.retry }).click()
    await expect.poll(async () => (await snapshot()).nodes.find((node) => node.id === card.id)?.status, { timeout: stationTimeout({ operations: 1 }) }).toBe('running')
    await expect.poll(async () => (await snapshot()).nodes.find((node) => node.id === card.id)?.progress?.percent ?? 0, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
    await win.locator(nodeSel(card.id)).getByRole('button', { name: L.cancel }).click()
    await expect.poll(async () => newCards(await snapshot()).length, { timeout: stationTimeout({ operations: 1 }) }).toBe(0)
    expect((await snapshot()).edges).toEqual([])
    await expect.poll(() => trimProcessCount(), { timeout: stationTimeout({ operations: 1 }) }).toBe(0)
  })
} finally {
  await app?.close().catch(() => {})
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
