import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { prepareGenerationIdle, ensureGenerationIdle } from '../perf/canvas-scale/generationIdleScenario.mjs'
import { canvasFitViewButton, canvasSetZoomPercent } from './_shell.mjs'
import { expect, proveProbe, expectAbsent } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = process.cwd()
const out = process.env.GENERATION_IDLE_OUT
if (!out) throw new Error('GENERATION_IDLE_OUT must point to this run’s isolated evidence directory')
fs.mkdirSync(out, { recursive: true })
const locale = process.argv.includes('--en') ? 'en' : 'zh-CN'
const tempRoot = fs.mkdtempSync(path.join(out, `${locale}-profile-`))
const projectsDir = path.join(tempRoot, 'projects')
const fixture = createCanvasPerformanceFixture({ projectsDir, scale: 'I60', withProjectIdentity: true })
const extras = await prepareGenerationIdle({ fixture, root: tempRoot, repoRoot })
const report = { locale, screenshots: [], checks: [], errors: [] }
let app
let page
function startConditions() {
  if (process.platform !== 'darwin') return
  const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
  const front = execFileSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' })
  const load5 = os.loadavg()[1]
  if (/Claude/i.test(front) || load5 >= 10) throw new Error(`quiet window unavailable: ${front.trim()} load5=${load5}`)
  report.conditions = { front: front.trim(), load5 }
}
async function open() {
  startConditions()
  const launched = await launchNomiApp({ name: 'generation-idle', tempRoot, projectsDir, ...extras.launch,
    settleMs: 0, viewportSize: { width: 1600, height: 1000 },
    args: ['--no-proxy-server', '--disable-features=CalculateNativeWinOcclusion'],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', '__nomiE2E': '1' } })
  app = launched.app
  page = launched.win
  page.on('pageerror', error => report.errors.push(String(error)))
  await page.locator('[data-project-card]', { hasText: fixture.record.name }).first().click()
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: stationTimeout({ operations: 4 }) })
  await page.waitForFunction(() => Boolean(window.__nomiCanvasStore))
  return launched
}
async function shot(name) {
  const file = path.join(out, 'waiting-now', `${locale}-${name}.png`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await page.screenshot({ path: file })
  report.screenshots.push(file)
}
try {
  await open()
  const ids = await ensureGenerationIdle(page, { app, extras, fixture, state: {} })
  await canvasSetZoomPercent(page, 60)
  await expect(page.locator('[data-process-static-grid]')).toHaveCount(12)
  const waitingProof = await proveProbe(page.locator('[data-generation-waiting]'), '12 live waiting cards are observable')
  await expectAbsent(page.locator('[data-process-fx]'), { provenBy: waitingProof, message: 'Waiting cards have no shader surface' })
  await shot('no-percent')
  // Real store action: the same progress write used by the ComfyUI bridge, no product flag.
  await page.evaluate(id => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.nodes.find(node => node.id === id)
    store.setNodeProgress(id, { ...node.progress, percent: 42 })
  }, ids[0])
  await expect(page.locator(`.react-flow__node[data-id="${ids[0]}"] [data-process-progress]`)).toBeVisible()
  await shot('percent')
  report.checks.push('12 real loopback tasks, static grey grid, visible progress with and without percent')
  const submissions = extras.provider.jobs.length
  const taskIds = await page.evaluate(ids => ids.map(id => window.__nomiCanvasStore.getState().nodes.find(node => node.id === id)?.runs?.[0]?.taskId), ids)
  await closeNomiApp(app)
  app = null
  await open()
  await expect.poll(() => page.evaluate(ids => ids.map(id => window.__nomiCanvasStore.getState().nodes.find(node => node.id === id)?.runs?.[0]?.taskId), ids)).toEqual(taskIds)
  expect(extras.provider.jobs.length).toBe(submissions)
  // Resume through the existing retrieval entry, never the generate button.
  await canvasFitViewButton(page).click()
  await canvasSetZoomPercent(page, 60)
  for (const job of extras.provider.jobs) job.done = true
  for (const id of ids) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`)
    const retrieve = node.getByRole('button', { name: uiText(locale, 'generationCommon.production.runAction.retry-retrieval'), exact: true }).first()
    if (await retrieve.count()) await retrieve.click()
  }
  await expect.poll(() => page.evaluate(ids => ids.filter(id => window.__nomiCanvasStore.getState().nodes.find(node => node.id === id)?.status === 'success').length, ids), { timeout: stationTimeout({ operations: 8 }) }).toBe(12)
  expect(extras.provider.jobs.length).toBe(submissions)
  await expectAbsent(page.locator('[data-generation-waiting]'), { provenBy: waitingProof, message: 'Original waiting surfaces leave after retrieved results land' })
  await canvasFitViewButton(page).click()
  await canvasSetZoomPercent(page, 60)
  await shot('restarted-results')
  report.checks.push('restart retained all original taskIds, retrieved original tasks, zero resubmissions, all results landed')
  report.submissions = { beforeRestart: submissions, afterResults: extras.provider.jobs.length }
  report.queries = extras.provider.jobs.map(job => ({ id: job.id, queries: job.queries }))
  expect(report.errors).toEqual([])
} catch (error) {
  report.failure = String(error?.stack || error)
  if (page && !page.isClosed()) await shot('failure').catch(() => {})
  throw error
} finally {
  if (app) await closeNomiApp(app)
  await extras.close()
  fs.writeFileSync(path.join(out, `${locale}-report.json`), JSON.stringify(report, null, 2))
}
