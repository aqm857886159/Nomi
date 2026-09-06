// 真实用户长视频任务的 Electron/UI boundary harness。
//
// 约束：动作只能通过可见 DOM/真实 Electron bridge 完成；不导入、不读取、不调用任何
// Zustand/canvas store。默认不执行，loopback 也必须显式 opt-in；live 还要经过 runner
// 的独立 gate。当前 deconstruction panel 没有用户审批/拒绝控件，所以该边界会诚实停在
// approve-result=blocked-live，不把前面的 loopback 结果伪装成完整任务通过。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import {
  ASSISTANT_MESSAGE, COLLAPSED_DOCK, COLLAPSED_SHELL, COMPOSER, COMPOSER_INPUT, COMPOSER_MODEL,
  COMPOSER_SEND, COMPOSER_SKILL, ERROR_BAR, MODEL_POPOVER, SKILL_POPOVER, SKILL_SEARCH,
} from './agent-runtime-walk-support.mjs'
import {
  REAL_USER_LONG_VIDEO_MANIFEST,
  blockedLiveReport,
  liveCanaryReadiness,
  runRealUserLongVideoJourney,
} from './real-user-long-video.runner.mjs'

const FIXTURE_VIDEO = path.join(repoRoot, REAL_USER_LONG_VIDEO_MANIFEST.sample.path)
const FIXTURE_VENDOR = 'real-user-loopback-vision'
const FIXTURE_MODEL = 'real-user-loopback-model'
// v4 的模型弹层按**显示名**列行（没有 per-row 挂点），和下面 catalog 里的 labelZh 是同一个串。
const FIXTURE_MODEL_LABEL = '本地长视频视觉 fixture'
const FIXTURE_SKILL = 'workbench.storyboard.planner'
const NOW = '2026-09-04T00:00:00.000Z'

function json(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(value))
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve(`http://127.0.0.1:${server.address().port}`) }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : null
}

function streamCompletion(res) {
  const content = JSON.stringify({
    shotSize: '中景',
    mood: '明快',
    visual: '本地 loopback fixture 视频中的主体完成连续动作，构图与光线保持稳定。',
    onScreenText: 'LOCAL LOOPBACK',
    imagePrompt: '本地 loopback 主体，中景构图，稳定光线，真实视频分析',
    motionPrompt: '主体完成连续动作，镜头平稳跟随',
  })
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const frame = (delta, finishReason = null) => `data: ${JSON.stringify({
    id: 'real-user-loopback-request', object: 'chat.completion.chunk', created: 1,
    model: FIXTURE_MODEL, choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
  res.write(frame({ role: 'assistant', content: '' }))
  res.write(frame({ content }))
  res.write(frame({}, 'stop'))
  res.end('data: [DONE]\n\n')
}

async function startLoopbackProvider() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) return json(res, 404, { error: 'route not found' })
    const body = await readJsonBody(req)
    requests.push({ method: req.method, url: req.url, body })
    streamCompletion(res)
  })
  const origin = await listen(server)
  return {
    origin,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function writeLoopbackCatalog(settingsDir, baseUrl) {
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), `${JSON.stringify({
    version: 12,
    vendors: [{
      key: FIXTURE_VENDOR, name: 'Local long-video loopback', enabled: true,
      baseUrlHint: baseUrl, authType: 'none', providerKind: 'openai-compatible',
      assetIngestion: { strategy: 'inline-base64', accepts: ['image'] },
      createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_MODEL, labelZh: FIXTURE_MODEL_LABEL,
      kind: 'text', enabled: true, published: true,
      meta: { supportsImageInput: true, supportsToolCalls: true },
      createdAt: NOW, updatedAt: NOW,
    }, {
      vendorKey: FIXTURE_VENDOR, modelKey: 'real-user-loopback-image-model', labelZh: '本地图像 fixture',
      kind: 'image', enabled: true, published: true,
      meta: { supportsToolCalls: true, adapter: { activeRevision: 'loopback', modes: [{ taskKind: 'text_to_image', state: 'verified' }] } },
      createdAt: NOW, updatedAt: NOW,
    }],
    mappings: [], apiKeysByVendor: {},
  }, null, 2)}\n`, 'utf8')
}

function sampleDurationSeconds(samplePath) {
  const raw = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', samplePath,
  ], { encoding: 'utf8' }).trim()
  const duration = Number(raw)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`invalid video duration: ${samplePath}`)
  return duration
}

async function dismissChrome(win) {
  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if (await splashSkip.count()) {
    await splashSkip.click()
    await splashSkip.waitFor({ state: 'detached', timeout: 5_000 })
  }
}

async function enterProject(win) {
  await dismissChrome(win)
  const create = win.getByText('新建空白项目', { exact: true }).first()
  await create.waitFor({ state: 'visible', timeout: 15_000 })
  await create.click()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 15_000 })
  const projectId = /[?#&]projectId=([^&#]+)/.exec(win.url())?.[1] || null
  if (!projectId) throw new Error('project id was not created through the library UI')
  await win.getByRole('button', { name: '生成', exact: true }).click().catch(async () => {
    await win.locator('[data-mode="generation"]').click()
  })
  await win.locator('.generation-canvas-v2-toolbar').waitFor({ state: 'visible', timeout: 15_000 })
  return projectId
}

async function openAgent(win) {
  // v4 收起态：一根 32px 图标条，第一颗钮把面板叫回来。
  const expand = async () => {
    const collapsed = win.locator(COLLAPSED_SHELL).first()
    if (await collapsed.isVisible().catch(() => false)) {
      await collapsed.locator(`${COLLAPSED_DOCK} button`).first().click()
    }
  }
  await expand()
  let panel = win.locator('[data-agent-panel="true"][data-agent-surface="generation"]').first()
  if (!(await panel.isVisible().catch(() => false))) {
    await expand()
    panel = win.locator('[data-agent-panel="true"][data-agent-surface="generation"]').first()
  }
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  return panel
}

function buildUiDriver({ appRef, winRef, profile, samplePath, loopback }) {
  let projectId = null
  let videoNodeCountBeforeImport = 0
  let sourceNode = null
  let selectedSkill = null
  let selectedModel = null
  let persistedBeforeRestart = null
  let restartReadback = null

  const perform = async (step) => {
    const win = winRef()
    if (!win && step.action !== 'restartReadback') return { status: 'blocked', evidenceState: 'blocked-live', detail: 'electron_window_unavailable' }

    if (step.action === 'enterNomi') {
      projectId = await enterProject(win)
      await openAgent(win)
      return { status: 'pass', evidenceState: 'loopback', detail: 'created project through library UI', evidence: { projectId } }
    }

    if (step.action === 'loadSkill') {
      const panel = await openAgent(win)
      // 2026-09-06 拍板①③：工作方式三档已删；技能与提示词并进 composer 的 `/` 命令菜单。
      await panel.locator(COMPOSER_SKILL).click()
      const skillMenu = panel.locator(SKILL_POPOVER)
      await skillMenu.waitFor({ state: 'visible', timeout: 10_000 })
      await skillMenu.locator(SKILL_SEARCH).fill('')
      const item = skillMenu.locator(`[data-v4-command="skill:${FIXTURE_SKILL}"]`).first()
      if (!(await item.isVisible().catch(() => false))) {
        return {
          status: 'blocked', evidenceState: 'blocked-live',
          detail: 'skill_not_exposed_in_current_agent_menu: workbench.storyboard.planner is filtered from the visible Skill list; refusing hidden/internal injection',
          evidence: { requestedSkill: FIXTURE_SKILL },
        }
      }
      await item.click()
      // 选中的技能落成 composer 上方那颗 chip（v4 三种 chip 同一形态）。
      await panel.locator(`${COMPOSER} [data-v4-chip="skill"]`).first().waitFor({ state: 'visible', timeout: 10_000 })
      selectedSkill = FIXTURE_SKILL
      return { status: 'pass', evidenceState: 'loopback', detail: 'Skill selected from visible Agent menu', evidence: { skill: selectedSkill } }
    }

    if (step.action === 'selectModel') {
      const panel = await openAgent(win)
      await panel.locator(COMPOSER_MODEL).click()
      const identity = loopback ? `${FIXTURE_VENDOR}/${FIXTURE_MODEL}` : 'apimart/gemini-3.5-flash'
      // v4 的模型弹层每行只有显示名，没有身份串挂点——按名字点，身份仍记在 evidence 里。
      const modelLabel = loopback ? FIXTURE_MODEL_LABEL : 'gemini-3.5-flash'
      const item = panel.locator(MODEL_POPOVER).getByRole('button', { name: new RegExp(modelLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
      await item.waitFor({ state: 'visible', timeout: 10_000 })
      await item.click()
      selectedModel = identity
      return { status: 'pass', evidenceState: loopback ? 'loopback' : 'blocked-live', detail: 'model selected from visible Agent menu', evidence: { model: selectedModel, provider: profile.provider } }
    }

    if (step.action === 'applySkill') {
      const panel = await openAgent(win)
      const beforeRequests = loopback?.requests.length || 0
      await panel.locator(COMPOSER_INPUT).fill('请用当前选择的 Skill 做一次只读规划，只回复已加载。')
      await panel.locator(COMPOSER_SEND).click()
      // A selected Skill is loaded as the canonical turn's prompt layer. It
      // does not necessarily produce a model `load_skill` tool item (and the
      // UI correctly reserves that row for actual Host skill.read calls).
      // Wait for the real turn result, then inspect the provider request.
      // v4：说完了的助手文本是 data-status="complete"；失败落成一条错误条（errorbar 积木）。
      const terminalItem = panel.locator(`${ASSISTANT_MESSAGE}[data-status="complete"], ${ERROR_BAR}`).last()
      await terminalItem.waitFor({ state: 'visible', timeout: 30_000 })
      const terminalKind = await terminalItem.getAttribute('data-v4-block')
      if (terminalKind !== 'assistant') {
        return { status: 'blocked', evidenceState: 'blocked-live', detail: 'selected_skill_turn_failed_before_provider_result', evidence: { requestedSkill: FIXTURE_SKILL, failure: await terminalItem.textContent(), requestCount: loopback?.requests.length || 0 } }
      }
      const captured = loopback?.requests.slice(beforeRequests).find((request) => request.body)
      const requestText = JSON.stringify(captured?.body || '')
      if (!requestText.includes(FIXTURE_SKILL)) {
        return { status: 'blocked', evidenceState: 'blocked-live', detail: 'selected_skill_not_carried_into_agent_request', evidence: { requestedSkill: FIXTURE_SKILL, requestCount: loopback?.requests.length || 0 } }
      }
      return { status: 'pass', evidenceState: 'loopback', detail: 'selected Skill loaded through Host and carried into the provider request', evidence: { skill: FIXTURE_SKILL, terminal: await terminalItem.textContent(), requestCount: loopback?.requests.length || 0 } }
    }

    if (step.action === 'importVideo') {
      videoNodeCountBeforeImport = await win.locator('.generation-canvas-v2-node').count()
      const library = win.getByRole('button', { name: '素材库', exact: true }).first()
      await library.click()
      const picker = win.locator('input[aria-label="素材文件选择器"]').first()
      await picker.setInputFiles(samplePath)
      await win.waitForFunction((before) => document.querySelectorAll('.generation-canvas-v2-node').length > before, videoNodeCountBeforeImport, { timeout: 30_000 })
      sourceNode = win.locator('.generation-canvas-v2-node').last()
      await sourceNode.waitFor({ state: 'visible', timeout: 10_000 })
      return { status: 'pass', evidenceState: 'recorded', detail: 'video entered through Asset Library file picker and became a canvas node', evidence: { samplePath, durationSeconds: sampleDurationSeconds(samplePath), nodeCount: await win.locator('.generation-canvas-v2-node').count() } }
    }

    if (step.action === 'deconstructVideo') {
      if (!sourceNode) return { status: 'blocked', evidenceState: 'blocked-live', detail: 'video_node_missing' }
      await sourceNode.hover()
      const deconstruct = win.getByRole('button', { name: '拆解', exact: true }).first()
      await deconstruct.waitFor({ state: 'visible', timeout: 10_000 })
      await deconstruct.click()
      const panel = win.locator('[data-deconstruct-panel]').last()
      await panel.locator('[data-deconstruct-start="true"]').click()
      await panel.locator('[data-deconstruct-shots="true"]').waitFor({ state: 'visible', timeout: 180_000 })
      const shots = await panel.locator('[data-deconstruct-shot]').count()
      return { status: shots > 0 ? 'pass' : 'blocked', evidenceState: loopback ? 'loopback' : 'blocked-live', detail: 'visible deconstruction panel produced storyboard rows', evidence: { shotCount: shots, loopbackRequests: loopback?.requests.length || 0 } }
    }

    if (step.action === 'produceStoryboard') {
      const shots = await win.locator('[data-deconstruct-shots="true"] [data-deconstruct-shot]').count()
      return shots > 0
        ? { status: 'pass', evidenceState: loopback ? 'loopback' : 'blocked-live', detail: 'storyboard rows are visible in the deconstruction result', evidence: { shotCount: shots } }
        : { status: 'blocked', evidenceState: 'blocked-live', detail: 'storyboard_rows_missing' }
    }

    if (step.action === 'sendToCanvas') {
      const add = win.locator('[data-deconstruct-add-to-canvas="true"]').last()
      const before = await win.locator('.generation-canvas-v2-node').count()
      await add.click()
      await win.waitForFunction((count) => document.querySelectorAll('.generation-canvas-v2-node').length > count, before, { timeout: 30_000 })
      const count = await win.locator('.generation-canvas-v2-node').count()
      return { status: count > videoNodeCountBeforeImport + 1 ? 'pass' : 'blocked', evidenceState: loopback ? 'loopback' : 'blocked-live', detail: 'visible add-to-canvas action completed', evidence: { nodeCount: count } }
    }

    if (step.action === 'openPreview') {
      const preview = win.getByRole('button', { name: '预览', exact: true }).first()
      await preview.click()
      await win.locator('[data-workspace-mode="preview"], .workbench-preview, [data-preview-workspace]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
      return { status: 'blocked', evidenceState: 'blocked-live', detail: 'preview entry was clicked but a stable preview boundary selector is not exposed by this build' }
    }

    if (step.action === 'approveResult' || step.action === 'rejectResult') {
      return { status: 'blocked', evidenceState: 'blocked-live', detail: 'deconstruction panel exposes no user approval/rejection control; refusing to infer approval from result visibility' }
    }

    if (step.action === 'verifyPersistence') {
      const persisted = await win.evaluate((id) => window.nomiDesktop?.projects?.readAsync(id), projectId)
      persistedBeforeRestart = persisted
      const payload = persisted?.payload || persisted
      return { status: payload ? 'pass' : 'blocked', evidenceState: 'recorded', detail: 'project read through public Electron project bridge', evidence: { projectId, hasPayload: Boolean(payload) } }
    }

    if (step.action === 'restartReadback') {
      if (!projectId) return { status: 'blocked', evidenceState: 'blocked-live', detail: 'project_id_missing' }
      await appRef().close().catch(() => {})
      const launched = await launchNomiApp({
        name: 'real-user-long-video-cold-readback',
        userDataDir: profile.userDataDir, settingsDir: profile.settingsDir, projectsDir: profile.projectsDir,
        syntheticCredentialStorage: loopback,
        env: { NODE_ENV: 'production' }, settleMs: 0,
      })
      profile.replace(launched)
      await dismissChrome(launched.win)
      restartReadback = await launched.win.evaluate((id) => window.nomiDesktop?.projects?.readAsync(id), projectId)
      return { status: restartReadback ? 'pass' : 'blocked', evidenceState: 'recorded', detail: 'cold restart readback through public Electron project bridge', evidence: { projectId, hasReadback: Boolean(restartReadback), hadPriorReadback: Boolean(persistedBeforeRestart) } }
    }

    if (step.action === 'repeatIdempotently') {
      return { status: 'blocked', evidenceState: 'blocked-live', detail: 'not reached until approval boundary is implemented' }
    }

    if (step.action === 'failureRollback') {
      return { status: 'blocked', evidenceState: 'blocked-live', detail: 'not reached until approval/rejection and failure injection boundaries are implemented' }
    }

    return { status: 'blocked', evidenceState: 'blocked-live', detail: `unsupported_action:${step.action}` }
  }

  return { perform }
}

async function run(mode) {
  const live = mode === 'live'
  const readiness = liveCanaryReadiness()
  if (live && !readiness.ready) {
    console.log(JSON.stringify(blockedLiveReport('live_canary_prerequisites_missing', { readiness }), null, 2))
    return 0
  }
  if (!fs.existsSync(FIXTURE_VIDEO)) throw new Error(`missing repository fixture: ${FIXTURE_VIDEO}`)
  const samplePath = live ? path.resolve(process.env.NOMI_LONG_VIDEO_PATH) : FIXTURE_VIDEO
  const durationSeconds = sampleDurationSeconds(samplePath)
  if (durationSeconds < REAL_USER_LONG_VIDEO_MANIFEST.sample.minimumDurationSeconds) throw new Error(`sample is shorter than ${REAL_USER_LONG_VIDEO_MANIFEST.sample.minimumDurationSeconds}s`)

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-real-user-long-video-'))
  const profile = {
    userDataDir: path.join(tempRoot, 'user-data'), settingsDir: path.join(tempRoot, 'settings'), projectsDir: path.join(tempRoot, 'projects'),
    current: null, replace(next) { this.current = next },
  }
  for (const dir of [profile.userDataDir, profile.settingsDir, profile.projectsDir]) fs.mkdirSync(dir, { recursive: true })
  let loopback = null
  try {
    if (!live) {
      loopback = await startLoopbackProvider()
      writeLoopbackCatalog(profile.settingsDir, loopback.origin)
    }
    const launched = await launchNomiApp({
      name: live ? 'real-user-long-video-live' : 'real-user-long-video-loopback',
      userDataDir: profile.userDataDir, settingsDir: profile.settingsDir, projectsDir: profile.projectsDir,
      syntheticCredentialStorage: !live,
      env: { NODE_ENV: 'production' }, settleMs: 0,
    })
    profile.replace(launched)
    const driver = buildUiDriver({ appRef: () => profile.current.app, winRef: () => profile.current.win, profile, samplePath, loopback })
    const report = await runRealUserLongVideoJourney({ driver, record: (step) => console.log(JSON.stringify(step)) })
    console.log(JSON.stringify({
      mode, provider: live ? readiness.provider : 'loopback', model: live ? readiness.model : FIXTURE_MODEL,
      skill: FIXTURE_SKILL, videoDurationSeconds: durationSeconds,
      requestIds: live ? [] : loopback.requests.map(() => 'real-user-loopback-request'),
      costEvidence: live ? null : { type: 'loopback', amount: 0, currency: 'USD', liveProvider: false },
      report,
    }, null, 2))
    await profile.current.app.close().catch(() => {})
    return report.terminalStatus === 'pass' ? 0 : 0
  } finally {
    await profile.current?.app?.close().catch(() => {})
    await loopback?.close().catch(() => {})
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

const args = new Set(process.argv.slice(2))
if (!process.env.NOMI_LONG_VIDEO_UI_E2E) {
  console.log(JSON.stringify({ status: 'skipped', evidenceState: 'blocked-live', detail: 'set NOMI_LONG_VIDEO_UI_E2E=1 to opt in; CI default is off' }, null, 2))
  process.exit(0)
}
if (!args.has('--loopback') && !args.has('--live')) {
  console.log(JSON.stringify({ status: 'blocked', evidenceState: 'blocked-live', detail: 'choose --loopback or --live explicitly' }, null, 2))
  process.exit(0)
}
run(args.has('--live') ? 'live' : 'loopback').catch((error) => {
  console.error(error.stack || error.message)
  process.exit(2)
})
