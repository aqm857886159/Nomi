import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真实 Electron：分镜表的读图腿（2026-10-11 走查 §1）——失败原话看得见、读图模型换得了。零花费：只摆一张「部分没读出」的表，不调任何模型。
// 走生产构建（先 `pnpm run build`），隔离资料目录，窗口在屏幕外不抢焦点。
//
// 断言（用户看得见的事实）：
//   ① 顶上一行说清「N 镜没读出：<供应商原话>」，且是原话（不是泛泛的「没读出」）；
//   ② 没读出的那几行，状态列也写着原话；读出来的那行没有；
//   ③ 选中表后下方拆解栏有「读图模型」选择，默认「自动选择」（换模型的入口；2026-10-18 从表内底栏挪出）。
// 用法：node tests/ux/shot-table-vision-leg.walk.mjs [--locale en] [--scheme dark]
// 截图：docs/evidence/2026-10-11-canvas-ux-8/s1-shot-table-vision-<zh|en>[-dark].png
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { canvasFitView } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argValue = (flag, fallback) => { const index = process.argv.indexOf(flag); return index > 0 ? process.argv[index + 1] : fallback }
const locale = argValue('--locale', 'zh-CN')
const scheme = argValue('--scheme', 'light')
const tag = `${locale === 'en' ? 'en' : 'zh'}${scheme === 'dark' ? '-dark' : ''}`
const zhOrEn = (zh, en) => (locale === 'en' ? en : zh)
const evidence = path.join(repoRoot, 'docs/evidence/2026-10-11-canvas-ux-8')
fs.mkdirSync(evidence, { recursive: true })

const temp = makeTempDir('nomi-shot-table-vision-')
const projectsDir = path.join(temp, 'projects')
const projectId = 'shot-table-vision'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const REASON = "You've reached the API rate limit for free users"
const row = (order, failed) => ({
  rowId: `fact-${order}`, order, startSeconds: (order - 1) * 2, endSeconds: order * 2, durationSeconds: 2, carriedOver: false,
  ...(failed ? { visionFailed: true, failureReason: REASON } : {}),
  cells: failed
    ? { shotSize: '', motion: '', visual: '', dialogue: '', onScreenText: '', mood: '' }
    : { shotSize: zhOrEn('特写', 'Close-up'), motion: '', visual: zhOrEn('一只金毛跑向镜头', 'A golden retriever runs at the camera'), dialogue: '', onScreenText: '', mood: zhOrEn('欢快', 'Cheerful') },
})
const title = zhOrEn('雨夜街口', 'Rainy street')
const table = {
  schemaVersion: 1,
  source: { kind: 'deconstruction', sourceNodeId: 'src-video', title, status: 'ready', durationSeconds: 6, failedShotIndexes: [2, 3] },
  columnSetId: 'facts',
  columns: ['shotSize', 'motion', 'visual', 'dialogue', 'onScreenText', 'mood'].map((columnId, order) => ({ columnId, kind: 'builtin', labelKey: columnId, order, visible: true })),
  rows: [row(1, false), row(2, true), row(3, true)],
  view: { selectedRowIds: [], density: 'full' }, revision: 3, updatedAt: new Date().toISOString(),
}
const nodes = [
  { id: 'src-video', kind: 'video', categoryId: 'shots', prompt: '', title, position: { x: 120, y: 160 }, size: { width: 300, height: 170 }, status: 'success',
    result: { id: 'r', type: 'video', url: `nomi-local://asset/${projectId}/assets/imported/none.mp4`, createdAt: 1, durationSeconds: 6 }, meta: {} },
  { id: 'table', kind: 'shot_table', categoryId: 'shots', prompt: '', title, position: { x: 520, y: 120 }, size: { width: 1100, height: 360 }, status: 'success', meta: { shotTable: table } },
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [{ id: 'e1', source: 'src-video', target: 'table' }], groups: [], selectedNodeIds: [] }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: 'Shot table vision', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, ...payload, payload }
for (const name of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, name), JSON.stringify(project))

const results = []
const run = await launchNomiApp({
  name: 'shot-table-vision-leg', projectsDir, settleMs: 0, viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
})
const { app } = run
let win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))
async function task(name, body) {
  try { await body(); results.push({ name, pass: true }) } catch (error) {
    results.push({ name, pass: false, error: String(error?.message ?? error).split('\n').filter(Boolean).slice(0, 6).join(' | ') })
    await win.screenshot({ path: path.join(repoRoot, '.tmp', `FAIL-shot-table-vision-${name}-${tag}.png`) }).catch(() => {})
  }
  console.log(JSON.stringify(results.at(-1)))
}

try {
  await win.locator('[data-project-card]', { hasText: project.name }).first().click()
  await expect.poll(() => app.windows().some((page) => /projectId=/.test(page.url())), { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  win.setDefaultTimeout(stationTimeout({ operations: 2 }))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await waitForCanvasViewportSettled(win)
  await canvasFitView(win, 'fit view before reading the shot table')
  await waitForCanvasViewportSettled(win)
  await waitForVisualQuiescence(win)
  const node = win.locator('[data-testid="shot-table-node"]').first()
  await node.waitFor()

  await task('01-summary-line-says-the-provider-words', async () => {
    const summary = node.locator('[data-testid="shot-table-vision-failure-summary"]')
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('rate limit')
    await expect(summary).toContainText('2')
  })
  await task('02-failed-rows-carry-reason-and-ok-row-does-not', async () => {
    const reasons = node.locator('[data-testid="shot-table-row-failure-reason"]')
    await expect(reasons).toHaveCount(2)
    await expect(reasons.first()).toContainText('rate limit')
    // 先证明探针测得到东西（没读出的那行里确实有原话），再断言读出来的那行没有。
    const proof = await proveProbe(node.locator('[data-shot-table-row="fact-2"] [data-testid="shot-table-row-failure-reason"]'), '没读出的那行里有原话')
    await expectAbsent(node.locator('[data-shot-table-row="fact-1"] [data-testid="shot-table-row-failure-reason"]'), { provenBy: proof, message: '读出来的那行不该有失败原话' })
  })
  await task('03-deconstruct-bar-has-vision-model-picker-default-auto', async () => {
    // 2026-10-18 拆解前选模型：读图模型从表内底栏挪到选中表后出现的下方拆解栏（和表是同一个 React Flow 节点里的兄弟，不在表卡里）。
    await node.locator('header').click({ position: { x: 300, y: 20 } })
    const bar = win.locator('.react-flow__node:has([data-testid="shot-table-node"]) [data-shot-table-composer]').first()
    await expect(bar).toBeVisible()
    const label = uiText(locale, 'shotTable.visionModel')
    const picker = bar.getByRole('button', { name: label }).or(bar.getByRole('combobox', { name: label })).first()
    await expect(picker).toBeVisible()
    await expect(picker).toContainText(uiText(locale, 'shotTable.visionAuto'))
    await waitForVisualQuiescence(win)
    await screenshotSettled(win, { path: path.join(evidence, `s1-shot-table-vision-${tag}.png`) })
  })
} finally {
  await app.close().catch(() => {})
}
const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${tag})`)
process.exit(failed.length ? 1 : 0)
