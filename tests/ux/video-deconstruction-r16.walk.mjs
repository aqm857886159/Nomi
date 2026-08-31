// R16 real-task journeys for evidence-first video deconstruction.
// Prerequisites: fresh `pnpm run build`, e-cut v2 on 127.0.0.1:8931, and
// ECCUT_API_TOKEN matching NOMI_R16_ECUT_TOKEN.
// Usage: NOMI_R16_ECUT_TOKEN=... node tests/ux/video-deconstruction-r16.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceVideo = process.env.NOMI_R16_VIDEO || '/tmp/chatcut-codex-editor-720.mp4'
const ecutToken = process.env.NOMI_R16_ECUT_TOKEN || ''
const harnessDir = path.join(repoRoot, '.agents', 'runtime', 'harness', '2026-08-08-video-deconstruction')
const shotsDir = path.join(harnessDir, 'screenshots')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-video-deconstruction-r16-'))
const projectsDir = path.join(tempRoot, 'projects')
const settingsDir = path.join(tempRoot, 'settings')

if (!fs.existsSync(sourceVideo)) throw new Error(`Missing real reference video: ${sourceVideo}`)
if (!ecutToken) throw new Error('NOMI_R16_ECUT_TOKEN is required')
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })
for (const entry of fs.readdirSync(shotsDir)) {
  if (entry.endsWith('.png')) fs.rmSync(path.join(shotsDir, entry))
}

const findings = []
const assertions = []
let screenshotIndex = 0

function check(condition, label, detail = '') {
  if (!condition) throw new Error(`R16 FAIL: ${label}${detail ? ` (${detail})` : ''}`)
  assertions.push({ label, detail })
  console.log(`  OK ${label}${detail ? `: ${detail}` : ''}`)
}

function seedProject({ id, name }) {
  const projectRoot = path.join(projectsDir, `${name}-${id}`)
  const relativeVideo = 'assets/imported/chatcut-reference.mp4'
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(path.dirname(path.join(projectRoot, relativeVideo)), { recursive: true })
  fs.copyFileSync(sourceVideo, path.join(projectRoot, relativeVideo))
  const assetUrl = `nomi-local://asset/${encodeURIComponent(id)}/${relativeVideo}`
  const node = {
    id: `${id}-video`,
    kind: 'video',
    categoryId: 'shots',
    title: 'ChatCut 参考片',
    position: { x: 180, y: 150 },
    exactPosition: true,
    size: { width: 520, height: 420 },
    status: 'success',
    result: { id: `${id}-result`, type: 'video', url: assetUrl, createdAt: 1 },
    meta: { videoDuration: 65.024 },
  }
  const generationCanvas = {
    nodes: [node], edges: [], selectedNodeIds: [], groups: [],
    canvasZoom: 1, canvasPan: { x: 0, y: 0 },
  }
  const payload = {
    workbenchDocument: null,
    timeline: null,
    generationCanvas,
    storyboardPlan: null,
    storyboardPlanCommitted: false,
  }
  const project = {
    id,
    name,
    version: 2,
    createdAt: 1,
    updatedAt: 1,
    savedAt: 1,
    revision: 1,
    lastKnownRootPath: projectRoot,
    workbenchDocument: null,
    timeline: null,
    generationCanvas,
    payload,
  }
  const serialized = JSON.stringify(project, null, 2)
  fs.writeFileSync(path.join(projectRoot, 'project.json'), serialized)
  fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), serialized)
  return { id, name, nodeId: node.id, projectRoot }
}

const onlineProject = seedProject({ id: 'r16-online', name: 'R16 在线拆解' })
const offlineProject = seedProject({ id: 'r16-offline', name: 'R16 离线降级' })
const recoveryProject = seedProject({ id: 'r16-recovery', name: 'R16 回执恢复' })

async function closeApp(app) {
  const proc = app.process()
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ])
  try {
    if (proc && proc.exitCode === null) proc.kill('SIGKILL')
  } catch {
    // Process already exited.
  }
}

async function launch(bounds = { width: 1540, height: 960 }) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.', `--user-data-dir=${settingsDir}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NOMI_E2E: '1',
      NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
      NOMI_ELECTRON_USER_DATA_DIR: settingsDir,
      NOMI_SETTINGS_DIR: settingsDir,
      NOMI_PROJECTS_DIR: projectsDir,
    },
  })
  const first = await app.firstWindow()
  const browserWindow = await app.browserWindow(first)
  await browserWindow.evaluate((window, nextBounds) => window.setBounds({ x: 0, y: 0, ...nextBounds }), bounds)
  await first.waitForLoadState('domcontentloaded')
  await first.evaluate(() => {
    window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await first.reload()
  await first.waitForLoadState('domcontentloaded')
  await first.waitForTimeout(1_200)
  const lightToggle = first.getByRole('button', { name: '切换到浅色模式' })
  if (await lightToggle.isVisible().catch(() => false)) await lightToggle.click()
  return app
}

function liveWindow(app) {
  const windows = app.windows().filter((candidate) => !candidate.isClosed())
  return windows.find((candidate) => /projectId=/.test(candidate.url())) || windows.at(-1)
}

async function openProject(app, project) {
  let win = liveWindow(app)
  const title = win.getByText(project.name, { exact: true }).first()
  const card = title.locator('xpath=ancestor::*[@data-project-card="true"]')
  await card.click()
  await win.waitForTimeout(2_000)
  win = liveWindow(app)
  await win.locator(`[data-node-id="${project.nodeId}"]`).waitFor({ timeout: 15_000 })
  const dismissGuide = win.getByRole('button', { name: '不再提示' })
  if (await dismissGuide.isVisible().catch(() => false)) await dismissGuide.click()
  return win
}

async function configure(win, origin, externalInference = false) {
  const stored = await win.evaluate(async ({ origin, token, externalInference }) => {
    return window.nomiDesktop.settings.videoAnalysis.set({
      engineOrigin: origin,
      apiToken: token,
      externalInference,
      engineSourceRetention: 'keep',
    })
  }, { origin, token: ecutToken, externalInference })
  check(stored.hasApiToken === true, 'e-cut token is stored without returning the secret')
  check(stored.externalInference === externalInference, externalInference
    ? 'external structure inference is explicitly allowed for the model fixture'
    : 'local evidence mode remains the default')
}

async function openPanel(win, project, initialView = 'cuts') {
  await win.locator(`[data-node-id="${project.nodeId}"]`).click({ force: true })
  const toolbar = win.locator('[role="toolbar"][aria-label="视频操作"]')
  await toolbar.waitFor({ state: 'visible', timeout: 15_000 })
  await toolbar.getByRole('button', { name: '拆解视频' }).click()
  const panel = win.locator('[data-video-deconstruction-panel="true"]')
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  if (initialView === 'structure') await panel.getByRole('radio', { name: '内容结构' }).click()
  return panel
}

async function shot(win, name) {
  screenshotIndex += 1
  const fileName = `${String(screenshotIndex).padStart(2, '0')}-${name}.png`
  const target = path.join(shotsDir, fileName)
  await win.screenshot({ path: target })
  console.log(`  SHOT ${fileName}`)
  return target
}

async function assertPanelGeometry(win, label) {
  const geometry = await win.locator('[data-video-deconstruction-panel="true"]').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
    }
  })
  check(
    geometry.left >= -1 && geometry.top >= -1
      && geometry.right <= geometry.viewportWidth + 1
      && geometry.bottom <= geometry.viewportHeight + 1
      && !geometry.horizontalOverflow,
    `${label} panel stays inside the viewport`,
    JSON.stringify(geometry),
  )
}

async function taskList(win, projectId) {
  return win.evaluate((id) => window.nomiDesktop.videoAnalysis.list(id), projectId)
}

async function waitForTask(win, projectId, predicate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tasks = await taskList(win, projectId)
    const task = tasks[0]
    if (task && predicate(task)) return task
    await win.waitForTimeout(500)
  }
  throw new Error(`Timed out waiting for video-analysis task in ${projectId}`)
}

function readPersistedNodes(project) {
  const value = JSON.parse(fs.readFileSync(path.join(project.projectRoot, '.nomi', 'project.json'), 'utf8'))
  return value?.payload?.generationCanvas?.nodes || value?.generationCanvas?.nodes || []
}

async function waitForPersistedNodes(win, project, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const nodes = readPersistedNodes(project)
    if (predicate(nodes)) return nodes
    await win.waitForTimeout(250)
  }
  throw new Error(`Timed out waiting for adopted nodes to persist in ${project.id}`)
}

async function runOnlineJourney() {
  console.log('\nJ1: Real 65-second reference -> evidence -> reusable structure')
  const app = await launch()
  try {
    const win = await openProject(app, onlineProject)
    await configure(win, 'http://127.0.0.1:8931')
    let panel = await openPanel(win, onlineProject)
    await panel.locator('[data-shot-cut]').first().waitFor({ timeout: 30_000 })
    check(await panel.locator('[data-shot-cut]').count() >= 20, 'local shot cuts work without content inference')
    await assertPanelGeometry(win, 'wide shot-cut')
    await shot(win, 'online-wide-cuts-light')

    await panel.getByRole('radio', { name: '内容结构' }).click()
    await panel.getByRole('button', { name: '开始分析' }).waitFor({ timeout: 10_000 })
    await panel.getByText('本次只在本机 e-cut 中处理镜头、OCR 和语音证据，不调用外部模型。', { exact: true }).waitFor({ timeout: 10_000 })
    await shot(win, 'online-structure-empty')
    await panel.getByRole('button', { name: '开始分析' }).click()
    const running = await waitForTask(win, onlineProject.id, (task) => ['running', 'completed'].includes(task.status))
    check(running.externalInference === false, 'real task is recorded as local evidence mode')
    if (running.status !== 'completed') {
      await panel.getByText(/分析画面与文字|整理结构|读取视频/).first().waitFor({ timeout: 10_000 }).catch(() => undefined)
      await shot(win, 'online-running-panel')
      await panel.getByRole('button', { name: '后台运行' }).click()
      await win.getByRole('button', { name: '任务' }).click()
      await win.locator('[data-nomi-right-panel="tasks"]').waitFor({ timeout: 10_000 })
      await win.waitForTimeout(350)
      await shot(win, 'online-running-task-center')
      await win.getByRole('button', { name: '关闭' }).first().click().catch(() => win.keyboard.press('Escape'))
    }

    const completed = await waitForTask(win, onlineProject.id, (task) => task.status === 'completed', 60_000)
    check(completed.resultAvailable, 'real e-cut result is durable and available')
    const expectedSourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourceVideo)).digest('hex')
    check(completed.sourceSha256 === expectedSourceSha256, 'real source SHA-256 matches the submitted bytes')
    const completedArtifacts = await win.evaluate(
      ({ projectId, analysisId }) => window.nomiDesktop.videoAnalysis.read(projectId, analysisId),
      { projectId: onlineProject.id, analysisId: completed.analysisId },
    )
    check(completedArtifacts.evidence?.rawEvidence?.length === 38, 'real result contains exactly 38 independently persisted evidence records')

    await win.getByRole('button', { name: '任务' }).click()
    const taskPanel = win.locator('[data-nomi-right-panel="tasks"]')
    await taskPanel.getByText(/视频拆解.*chatcut-reference\.mp4/).first().click()
    panel = win.locator('[data-video-deconstruction-panel="true"]')
    await panel.getByText(/个证据段落/).waitFor({ timeout: 15_000 })
    check(await panel.getByText('原始证据').count() > 0, 'raw evidence is presented before interpretation')
    check(await panel.getByText('未检测到可识别语音').count() > 0, 'missing speech is stated explicitly')
    await assertPanelGeometry(win, 'wide completed')
    await shot(win, 'online-complete-light')

    const browserWindow = await app.browserWindow(win)
    await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 920, height: 720 }))
    await win.waitForTimeout(1_200)
    await assertPanelGeometry(win, 'narrow completed')
    await shot(win, 'online-complete-narrow')

    await win.evaluate(() => window.localStorage.setItem('nomi-color-scheme', 'dark'))
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.waitForTimeout(1_200)
    check(await win.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'persisted dark theme is genuinely applied')
    await win.locator(`[data-node-id="${onlineProject.nodeId}"]`).waitFor({ timeout: 15_000 })
    panel = await openPanel(win, onlineProject, 'structure')
    await panel.getByText(/个证据段落/).waitFor({ timeout: 15_000 })
    await assertPanelGeometry(win, 'narrow completed dark')
    await shot(win, 'online-complete-narrow-dark')

    check(await panel.getByRole('button', { name: '沿用结构写新方案' }).count() === 0, 'local evidence does not masquerade as reusable marketing structure')
    check(await panel.getByRole('button', { name: '配置结构分析' }).count() === 1, 'local evidence offers an actionable path to semantic structure analysis')
    const sceneChecks = panel.locator('input[type="checkbox"]')
    const checkCount = await sceneChecks.count()
    for (let index = 1; index < checkCount; index += 1) await sceneChecks.nth(index).uncheck()
    await panel.getByRole('button', { name: '放到画布' }).click()
    await panel.waitFor({ state: 'hidden', timeout: 30_000 })
    const sourceVideoElement = win.locator(`[data-node-id="${onlineProject.nodeId}"] video`)
    await sourceVideoElement.evaluate((video) => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return
      return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(`source video did not become drawable: ${JSON.stringify({
          readyState: video.readyState,
          networkState: video.networkState,
          errorCode: video.error?.code || null,
          currentSrc: video.currentSrc,
          crossOrigin: video.crossOrigin,
        })}`)), 10_000)
        video.addEventListener('loadeddata', () => {
          window.clearTimeout(timeout)
          resolve(undefined)
        }, { once: true })
      })
    })
    const visibleCanvasNodes = await win.locator('[data-node-id]').count()
    check(visibleCanvasNodes > 1, 'adopted evidence frame remains visible on the canvas', String(visibleCanvasNodes))
    const adoptedImage = win.locator('[data-node-id]').filter({ has: win.locator('img') }).locator('img').last()
    await adoptedImage.waitFor({ state: 'visible', timeout: 10_000 })
    const adoptedPixelsDrawable = await adoptedImage.evaluate((image) => {
      if (image.complete) return image.naturalWidth > 0
      return new Promise((resolve) => {
        const timeout = window.setTimeout(() => resolve(false), 10_000)
        image.addEventListener('load', () => {
          window.clearTimeout(timeout)
          resolve(image.naturalWidth > 0)
        }, { once: true })
        image.addEventListener('error', () => {
          window.clearTimeout(timeout)
          resolve(false)
        }, { once: true })
      })
    })
    check(adoptedPixelsDrawable, 'adopted evidence pixels are drawable')
    await shot(win, 'online-adopted-evidence-dark')
    const persistedNodes = await waitForPersistedNodes(
      win,
      onlineProject,
      (nodes) => nodes.some((node) => node.meta?.videoAnalysis?.analysisId === completed.analysisId),
    )
    const adopted = persistedNodes.filter((node) => node.meta?.videoAnalysis?.analysisId === completed.analysisId)
    check(adopted.length >= 1, 'adopted frames retain their analysis provenance')
    check(Boolean(adopted[0]?.meta?.videoAnalysis?.timeRange), 'adopted frame retains evidence time range')
  } finally {
    await closeApp(app)
  }
}

async function runOfflineJourney() {
  console.log('\nJ2: Engine offline -> shot cuts still work -> settings is one action away')
  const app = await launch({ width: 980, height: 720 })
  try {
    const win = await openProject(app, offlineProject)
    await configure(win, 'http://127.0.0.1:65534')
    let panel = await openPanel(win, offlineProject)
    await panel.locator('[data-shot-cut]').first().waitFor({ timeout: 30_000 })
    check(await panel.locator('[data-shot-cut]').count() >= 20, 'offline engine does not block local shot cuts')
    await panel.getByRole('radio', { name: '内容结构' }).click()
    await panel.getByText('内容分析暂不可用').waitFor({ timeout: 20_000 })
    await assertPanelGeometry(win, 'offline narrow')
    await shot(win, 'offline-structure-degraded')
    await panel.getByRole('button', { name: '检查设置' }).click()
    const engineSettings = win.getByText('视频拆解引擎')
    await engineSettings.waitFor({ timeout: 15_000 })
    await win.waitForTimeout(400)
    check(await engineSettings.isVisible(), 'settings recovery lands directly on the video-analysis engine')
    await shot(win, 'offline-settings-automation')
  } finally {
    await closeApp(app)
  }
}

function startReceiptLossEngine() {
  const state = { posts: 0, lookups: 0, polls: 0, requestId: '', taskId: 'task-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const send = (status, value) => {
      const body = Buffer.from(JSON.stringify(value))
      response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-store' })
      response.end(body)
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      send(200, { ok: true, engine: 'r16-receipt-loss', version: 'eccut-local-api-v2', pipeline_ready: true, missing_dependencies: [], analysis_modes: ['deterministic', 'model'] })
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/deconstruct') {
      state.posts += 1
      state.requestId = String(request.headers['x-eccut-request-id'] || '')
      request.on('data', () => undefined)
      request.on('end', () => request.socket.destroy())
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/task-lookup') {
      state.lookups += 1
      send(200, { request_id: url.searchParams.get('request_id'), task_id: state.taskId })
      return
    }
    if (request.method === 'GET' && url.pathname === `/api/task/${state.taskId}`) {
      state.polls += 1
      send(200, {
        task_id: state.taskId,
        done: true,
        cancelled: false,
        stage: 6,
        stage_total: 6,
        stage_text: '结构完成',
        storyboard_source: 'model',
        metrics: { shot_count: 1 },
        storyboard: {
          video_title_summary: '回执恢复成功',
          hook_strategy_analysis: '只读 lookup 找回原任务，没有重复上传。',
          scenes: [{
            scene_index: 1,
            marketing_role: 'HOOK',
            scene_title: '长文本边界验证',
            time_range: '00:00:00.000-00:00:03.000',
            role_analysis: '用真实证据支撑开场主张。',
            shots: [{
              shot_id: 1,
              time_range: '00:00:00.000-00:00:03.000',
              visual_description: 'A'.repeat(2_500),
              spoken_text: '',
              ocr_text: 'LOCAL_FIRST_' + 'UNBROKEN_TEXT_'.repeat(320),
              camera_shot: 'screen recording',
              camera_move: 'static',
              psychological_effect: 'proof',
              evidence: {
                visual_ms: [0],
                spoken_text_ref: 'aligned.shots[1].spoken_text',
                ocr_text_ref: 'aligned.shots[1].ocr_text',
              },
            }],
          }],
          patterns: [],
        },
        raw_evidence: [{
          shot_id: 1,
          visual_ms: [0],
          spoken_text_ref: 'aligned.shots[1].spoken_text',
          spoken_text: '',
          ocr_text_ref: 'aligned.shots[1].ocr_text',
          ocr_text: 'LOCAL_FIRST_' + 'UNBROKEN_TEXT_'.repeat(320),
        }],
      })
      return
    }
    if (request.method === 'DELETE' && url.pathname === `/api/task/${state.taskId}/source`) {
      send(200, { task_id: state.taskId, removed: true })
      return
    }
    send(404, { error: 'not found' })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, state, origin: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function runReceiptRecoveryJourney() {
  console.log('\nJ3: Lost submit receipt -> restart -> lookup-only recovery')
  const fixture = await startReceiptLossEngine()
  let app = await launch()
  try {
    let win = await openProject(app, recoveryProject)
    await configure(win, fixture.origin, true)
    let panel = await openPanel(win, recoveryProject, 'structure')
    await panel.getByRole('button', { name: '开始分析' }).click()
    await waitForTask(win, recoveryProject.id, (task) => task.status === 'submission_unknown', 20_000)
    await panel.getByText('正在只读核对提交结果 · 不会重复提交').waitFor({ timeout: 10_000 })
    await shot(win, 'receipt-unknown-visible')
    check(fixture.state.posts === 1, 'receipt loss produced exactly one POST before restart')

    await closeApp(app)
    app = await launch()
    win = await openProject(app, recoveryProject)
    const completed = await waitForTask(win, recoveryProject.id, (task) => task.status === 'completed', 30_000)
    check(completed.resultAvailable, 'restart recovered the accepted task by request ID')
    check(completed.externalInference === true, 'recovered model task keeps its external-inference disclosure')
    check(fixture.state.posts === 1, 'restart recovery did not issue a second POST')
    check(fixture.state.lookups >= 1, 'restart recovery used the lookup endpoint')

    panel = await openPanel(win, recoveryProject, 'structure')
    await panel.getByText('长文本边界验证').waitFor({ timeout: 15_000 })
    await assertPanelGeometry(win, 'long OCR recovery')
    const panelMetrics = await panel.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
    }))
    check(panelMetrics.scrollWidth <= panelMetrics.clientWidth + 1, 'long unbroken OCR does not overflow the panel', JSON.stringify(panelMetrics))
    const ocrParagraph = panel.getByText(/LOCAL_FIRST_UNBROKEN_TEXT_/).first()
    const ocrMetrics = await ocrParagraph.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    check(ocrMetrics.scrollWidth <= ocrMetrics.clientWidth + 1, 'long OCR wraps inside its evidence column', JSON.stringify(ocrMetrics))
    await shot(win, 'receipt-recovered-long-ocr')

    await panel.getByRole('button', { name: '沿用结构写新方案' }).click()
    const assistantInput = win.getByRole('textbox', { name: '给生成助手发送消息' })
    await assistantInput.waitFor({ timeout: 15_000 })
    const draft = await assistantInput.inputValue()
    check(draft.includes('只复用段落角色、顺序和时长范围'), 'Chinese reuse action opens the assistant with an original-only contract')
    check(!/ChatCut|Guji|Codex/.test(draft), 'reuse draft excludes source brands and source wording')
    await shot(win, 'model-original-plan-draft')
  } finally {
    await closeApp(app)
    await new Promise((resolve) => fixture.server.close(resolve))
  }
}

let outcome = 'pass'
try {
  await runOnlineJourney()
  await runOfflineJourney()
  await runReceiptRecoveryJourney()
  check(screenshotIndex === 13, 'journey produced the exact 13 required screenshots')
} catch (error) {
  outcome = 'fail'
  findings.push(error instanceof Error ? error.stack || error.message : String(error))
  throw error
} finally {
  fs.writeFileSync(path.join(harnessDir, 'r16-journey-report.json'), JSON.stringify({
    outcome,
    sourceVideo,
    sourceBytes: fs.statSync(sourceVideo).size,
    assertions,
    findings,
    screenshots: fs.readdirSync(shotsDir).filter((name) => name.endsWith('.png')).sort(),
    isolatedWorkspace: tempRoot,
  }, null, 2))
}

console.log(`\nR16 VIDEO DECONSTRUCTION: PASS (${assertions.length} assertions, ${screenshotIndex} screenshots)`)
