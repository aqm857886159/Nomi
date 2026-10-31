#!/usr/bin/env node
// 真付费走查 run-retrieval-recovery-real.paid.mjs 的零额度演练：真 Electron、真 Run、真观察者，只有供应商是环回夹具。
// 前三段：关窗（进程还在，窗口回来）、重启 App、重启 App + 真付费用的那个断网。都是取回失败 → 重开 → 重新取回落地，每段 POST=1。
// 中间四段是本机查不了（模型被关）：关窗、重启、窗口一直开着都写真实原因，开回来落地，POST=1；标记失败之后才给重试，这时 POST=2。
// 最后一段窗口一直开着、单还在跑：放手给观察者；还在跑时重试被挡并说清楚；跑完点一下重新取回即现；跑完标记失败产物还在素材里。
// 中英两轨：node <本文件> / node <本文件> --en。需要先构建。
// 证据目录用 RUN_RETRIEVAL_RECOVERY_OUT 指定，缺省 docs/evidence/2026-10-31-run-retrieval-recovery。
import fs from 'node:fs'
import path from 'node:path'
import { assertPaidBuildReady } from './_paidRun.mjs'
import { closeNomiApp, launchNomiApp } from './_launchApp.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { FIXTURE_VENDOR } from './agent-runtime-fixture.mjs'
import { createProcessFixture } from './process-feedback-real-fixture.mjs'
import { collapseAgentPanel } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { RECOVERY_BUILD_MARKERS, blockVendorOrigins, giveUpJourney, recoveryJourney, unavailableJourney, unblockVendorOrigins, waitStoppedForRetrieval, windowOpenJourney } from './_runRetrievalRecoverySteps.mjs'

const repoRoot = process.cwd()
assertPaidBuildReady(repoRoot, { markers: RECOVERY_BUILD_MARKERS })
const locale = process.argv.includes('--en') ? 'en' : 'zh-CN'
const evidence = process.env.RUN_RETRIEVAL_RECOVERY_OUT || path.join(repoRoot, 'docs/evidence/2026-10-31-run-retrieval-recovery')
fs.mkdirSync(evidence, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), `retrieval-recovery-${locale}-`))
const projectsDir = path.join(tempRoot, 'projects')
const settingsDir = path.join(tempRoot, 'settings')
const fixture = createCanvasPerformanceFixture({ projectsDir, scale: 'empty', withProjectIdentity: true })
const provider = await createProcessFixture(repoRoot, settingsDir)
const errors = []
let app = null

async function enterProject(page) {
  page.on('pageerror', error => errors.push(String(error)))
  await page.locator('[data-project-card]', { hasText: fixture.record.name }).first().click()
  await page.locator('.generation-canvas-v2__stage').waitFor({ timeout: stationTimeout({ operations: 4 }) })
  await page.waitForFunction(() => Boolean(window.__nomiCanvasStore))
  // Agent 浮窗会盖住节点底栏的 ↑：像人一样先收成小球。
  await collapseAgentPanel(page)
  return page
}

async function launch() {
  const launched = await launchNomiApp({ name: 'run-retrieval-recovery', tempRoot, projectsDir, settingsDir, settleMs: 0, viewportSize: { width: 1280, height: 860 },
    mainRequire: [path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs')], env: { NOMI_TEST_NETWORK_GUARD: '1' },
    args: ['--no-proxy-server'],
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', '__nomiE2E': '1' } })
  app = launched.app
  return enterProject(launched.win)
}

async function restartApp(between) {
  await closeNomiApp(app)
  app = null
  between()
  return launch()
}

const finishJobs = () => { for (const job of provider.jobs) job.done = true }
/** 用户在模型设置里关掉 / 开回这个模型（产品自己的接口）。 */
const setModelEnabled = (page, enabled) => page.evaluate(({ vendorKey, modelKey, enabled }) => window.nomiDesktop.modelCatalog.upsertModel({ vendorKey, modelKey, enabled }),
  { vendorKey: FIXTURE_VENDOR, modelKey: 'pf-video', enabled })
const common = {
  locale,
  projectRoot: fixture.projectRoot,
  node: { kind: 'video', vendor: FIXTURE_VENDOR, modelKey: 'pf-video', prompt: 'A blue marble rolling on a table' },
  faultOff: async () => { provider.setQueryFault(false); finishJobs() },
  posts: () => provider.jobs.length,
  gets: () => provider.jobs.reduce((sum, job) => sum + job.queries, 0),
  shot: async (name, locator) => { await locator.screenshot({ path: path.join(evidence, `${locale}-${name}.png`) }) },
}

const closeWindowAndWait = async (current, runRecordId) => {
  const reopened = app.waitForEvent('window', { timeout: stationTimeout({ operations: 4 }), predicate: win => win !== current })
  await (await app.browserWindow(current)).evaluate(win => win.close())
  await waitStoppedForRetrieval(fixture.projectRoot, runRecordId)
  await app.evaluate(({ app: electronApp }) => { electronApp.emit('activate') })
  return enterProject(await reopened)
}

/** 上一段的节点都落定了：清掉，画布上只留这一段的，截图才看得清。 */
const cleared = async (page) => {
  await page.evaluate(() => window.__nomiCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] }))
  return page
}

let failure
try {
  let page = await launch()
  const windowClosed = await recoveryJourney({
    ...common, page, scenario: 'window-closed', position: { x: 40, y: 40 },
    // 关窗：进程还在（macOS），观察者接手，窗口回来之前这一笔就已经停成待取回。
    interrupt: async (current, runRecordId) => {
      provider.setQueryFault(true)
      return closeWindowAndWait(current, runRecordId)
    },
  })
  page = windowClosed.page
  const restarted = await recoveryJourney({
    ...common, page: await cleared(page), scenario: 'restart', position: { x: 620, y: 40 },
    // 重启：进程没了，新的 Run 宿主打开项目时接手，第一次查询失败。
    interrupt: () => restartApp(() => provider.setQueryFault(true)),
  })
  page = restarted.page
  // 真付费用的那个断网：查询到不了供应商（夹具数不到 GET），先在这里证明它停成待取回，真付费才不白花。
  const blocked = await recoveryJourney({
    ...common, page: await cleared(page), scenario: 'restart-blocked', position: { x: 40, y: 400 }, gets: undefined, shot: async () => {},
    interrupt: () => restartApp(() => blockVendorOrigins([provider.origin])),
    faultOff: () => restartApp(() => { unblockVendorOrigins(); finishJobs() }),
  })
  page = blocked.page
  const local = {
    modelOff: current => setModelEnabled(current, false),
    modelOn: async (current) => { await setModelEnabled(current, true); finishJobs() },
  }
  const localClosed = await unavailableJourney({ ...common, ...local, page: await cleared(page), scenario: 'local-window-closed', position: { x: 620, y: 400 }, interrupt: closeWindowAndWait })
  page = localClosed.page
  const localRestart = await unavailableJourney({ ...common, ...local, page: await cleared(page), scenario: 'local-restart', position: { x: 1200, y: 40 }, interrupt: () => restartApp(() => {}) })
  page = localRestart.page
  const localOpen = await unavailableJourney({ ...common, ...local, page: await cleared(page), scenario: 'local-window-open', position: { x: 1200, y: 400 } })
  page = localOpen.page
  const gaveUp = await giveUpJourney({ ...common, ...local, finishJobs, page: await cleared(page), scenario: 'local-give-up', position: { x: 40, y: 760 } })
  page = gaveUp.page
  const windowOpen = await windowOpenJourney({ ...common, finishJobs, page: await cleared(page), scenario: 'window-open',
    imageNode: { kind: 'image', vendor: FIXTURE_VENDOR, modelKey: 'agent-runtime-image', prompt: 'A blue marble rolling on a table' } })
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`)
  console.log('RUN_RETRIEVAL_RECOVERY', JSON.stringify({ locale, windowClosed: windowClosed.report, restarted: restarted.report, blocked: blocked.report,
    localClosed: localClosed.report, localRestart: localRestart.report, localOpen: localOpen.report, gaveUp: gaveUp.report, windowOpen: windowOpen.report }))
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error(error)
} finally {
  unblockVendorOrigins()
  if (app) await closeNomiApp(app).catch(() => undefined)
  await provider.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
if (failure) process.exit(1)
