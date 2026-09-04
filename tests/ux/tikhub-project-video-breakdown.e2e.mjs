// TikHub → project asset → video deconstruction → storyboard side effect.
//
// This is a real Electron journey. TikHub and the vision model are both local
// HTTP fixtures; no real provider key, upstream request, paid provider, or
// screenshot artifact is used. The only canvas setup seam creates the source
// video node from the asset imported by the visible Asset Library flow. It
// never injects a deconstruction result.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'

const FIXTURE_VIDEO = path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4')
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-tikhub-video-breakdown-'))
const userDataDir = path.join(TEMP_ROOT, 'user-data')
const settingsDir = path.join(TEMP_ROOT, 'settings')
const projectsDir = path.join(TEMP_ROOT, 'projects')
for (const dir of [userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-09-04T00:00:00.000Z'
const FIXTURE_VENDOR = 'local-video-breakdown-vision'
const FIXTURE_MODEL = 'local-video-breakdown-model'

function json(res, status, value) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
  return `http://127.0.0.1:${server.address().port}`
}

function streamCompletion(res, content) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const frame = (delta, finishReason = null) => `data: ${JSON.stringify({
    id: 'local-video-breakdown', object: 'chat.completion.chunk', created: 1,
    model: FIXTURE_MODEL, choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
  res.write(frame({ role: 'assistant', content: '' }))
  res.write(frame({ content }))
  res.write(frame({}, 'stop'))
  res.end('data: [DONE]\n\n')
}

async function startTikHubFixture() {
  const requests = []
  const videoBytes = fs.readFileSync(FIXTURE_VIDEO)
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization || '' })
    if (req.url?.startsWith('/fixture.mp4')) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'video/mp4')
      res.end(videoBytes)
      return
    }
    if (req.url?.startsWith('/api/v1/tikhub/user/get_user_info')) {
      if (req.headers.authorization !== 'Bearer fixture-tikhub-key') return json(res, 401, { code: 401, message: 'fixture key required' })
      return json(res, 200, { code: 200, data: { user_id: 'fixture-user' } })
    }
    if (req.url?.startsWith('/api/v1/douyin/web/fetch_video_high_quality_play_url')) {
      if (req.headers.authorization !== 'Bearer fixture-tikhub-key') return json(res, 401, { code: 401, message: 'fixture key required' })
      return json(res, 200, { code: 200, data: {
        video_id: 'fixture-video-001',
        original_video_url: `${origin}/fixture.mp4`,
      } })
    }
    return json(res, 404, { code: 404, message: 'fixture route not found' })
  })
  const origin = await listen(server)
  return { origin, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function startVisionFixture() {
  const requests = []
  let mode = 'happy'
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') return json(res, 404, { error: 'route not found' })
    const body = await readBody(req)
    requests.push({ url: req.url, body })
    streamCompletion(res, mode === 'malformed' ? '模型暂时无法按约定格式返回' : JSON.stringify({
      shotSize: '中景',
      mood: '明快',
      visual: '本地 fixture 视频中的主体完成一次连续动作，画面保持清晰构图与稳定光线。',
      onScreenText: 'FIXTURE / LOCAL',
      imagePrompt: '本地 fixture 主体，中景构图，稳定光线，真实视频分析',
      motionPrompt: '主体完成连续动作，镜头平稳跟随',
    }))
  })
  const origin = await listen(server)
  return {
    origin,
    requests,
    setMode: (nextMode) => { mode = nextMode },
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function writeFixtureCatalog(baseUrl) {
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), `${JSON.stringify({
    version: 12,
    vendors: [{
      key: FIXTURE_VENDOR, name: 'Local video breakdown fixture', enabled: true,
      baseUrlHint: baseUrl, authType: 'none', providerKind: 'openai-compatible',
      assetIngestion: { strategy: 'inline-base64', accepts: ['image'] },
      createdAt: NOW, updatedAt: NOW,
    }],
    models: [{
      vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_MODEL, labelZh: '本地拆解视觉模型',
      kind: 'text', enabled: true, meta: { supportsImageInput: true, supportsToolCalls: true },
      createdAt: NOW, updatedAt: NOW,
    }],
    mappings: [],
    apiKeysByVendor: {},
  }, null, 2)}\n`, 'utf8')
}

const failures = []
let electronAssertions = 0
function check(label, value, detail = '') {
  electronAssertions += 1
  const ok = Boolean(value)
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

async function dismissChrome(win) {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('__nomiE2E', '1')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  for (let i = 0; i < 6; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛|Skip/i }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(220)
  }
}

async function openProjectFromLibrary(win) {
  const card = win.locator('[data-project-card="true"]').first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.click()
  const continueButton = win.getByText('继续创作', { exact: false }).first()
  if (await continueButton.count()) await continueButton.click({ timeout: 4_000 }).catch(() => {})
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 15_000 })
}

function projectIdFromUrl(url) {
  return /[?#&]projectId=([^&#]+)/.exec(url)?.[1] || null
}

async function openAssets(win) {
  const assetSection = win.locator('section[aria-label="素材库"]')
  if (!(await assetSection.isVisible().catch(() => false))) {
    const libraryButton = win.getByRole('button', { name: '素材库', exact: true }).first()
    await libraryButton.click()
  }
  await assetSection.waitFor({ state: 'visible', timeout: 10_000 })
  return assetSection
}

async function runJourney(app, win, tikhub, vision) {
  await dismissChrome(win)
  const newProject = win.getByText('新建空白项目', { exact: true }).first()
  await newProject.waitFor({ state: 'visible', timeout: 15_000 })
  await newProject.click()
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 15_000 })
  const projectId = projectIdFromUrl(win.url())
  check('真实 Electron 创建并进入项目', Boolean(projectId), projectId || '')

  const keyStatus = await win.evaluate(async () => window.nomiDesktop.connector.tikhub.saveKey({ apiKey: 'fixture-tikhub-key' }))
  check('本地 TikHub fixture key 通过真实保存校验', keyStatus?.status === 'ok', JSON.stringify(keyStatus))

  await win.locator('[data-mode="generation"]').click()
  await win.waitForTimeout(500)
  const assetSection = await openAssets(win)
  const paste = win.locator('button[aria-label="贴链接导入"]').first()
  await paste.waitFor({ state: 'visible', timeout: 10_000 })
  await paste.click()
  const input = win.locator('[data-confirm-dialog-input="true"]')
  await input.fill('抖音本地测试 https://v.douyin.com/local-fixture/')
  await win.locator('[data-confirm-dialog-confirm="true"]').click()
  await assetSection.locator('text=fixture-video-001').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})

  const assets = await win.evaluate(async (id) => window.nomiDesktop.assets.list({ projectId: id }), projectId)
  const imported = assets.items.find((item) => item.data?.sourceEvidence?.connectorId === 'tikhub') || assets.items.find((item) => item.data?.mediaType === 'video')
  check('项目素材库出现导入视频', Boolean(imported), JSON.stringify(assets.items.map((item) => item.name)))
  check('持久化 source evidence 指向 TikHub', imported?.data?.sourceEvidence?.connectorId === 'tikhub', JSON.stringify(imported?.data?.sourceEvidence || null))
  check('source evidence 保留原始分享文本与 resolved URL', imported?.data?.sourceEvidence?.originalUrl?.includes('v.douyin.com') && imported?.data?.sourceEvidence?.resolvedUrl?.endsWith('/fixture.mp4'), JSON.stringify(imported?.data?.sourceEvidence || null))

  await win.getByRole('button', { name: '生成', exact: true }).click().catch(async () => {
    await win.locator('[data-mode="generation"]').click()
  })
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: 15_000 })
  const source = await win.evaluate(({ url, id }) => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: 'video', title: 'TikHub 本地素材', position: { x: 120, y: 120 } })
    store.updateNode(node.id, { result: { id: `asset-${Date.now()}`, type: 'video', url, createdAt: Date.now() } })
    store.selectNode(node.id)
    return { nodeId: node.id, projectId: id }
  }, { url: imported?.data?.url || imported?.data?.renderUrl, id: projectId })
  check('导入素材进入真实视频拆解入口', Boolean(source.nodeId && source.projectId), JSON.stringify(source))

  const node = win.locator(`[data-node-id="${source.nodeId}"]`).first()
  await node.hover()
  const deconstruct = win.getByRole('button', { name: '拆解', exact: true }).first()
  await deconstruct.waitFor({ state: 'visible', timeout: 10_000 })
  await deconstruct.click()
  const panel = win.locator(`[data-deconstruct-panel="${source.nodeId}"]`)
  await panel.locator('[data-deconstruct-start="true"]').click()
  await panel.locator('[data-deconstruct-shots="true"]').waitFor({ state: 'visible', timeout: 120_000 })
  const result = await win.evaluate((id) => {
    const node = window.__nomiCanvasStore.getState().nodes.find((item) => item.id === id)
    return node?.meta?.videoDeconstruction || null
  }, source.nodeId)
  const modelRows = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels())
  const vendorRows = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors())
  check('拆解模型仍来自隔离本地 fixture', modelRows.some((row) => row.vendorKey === FIXTURE_VENDOR && row.modelKey === FIXTURE_MODEL) && vendorRows.some((row) => row.key === FIXTURE_VENDOR && row.baseUrlHint === vision.origin), 'no live provider')
  check('真实拆解结果包含镜头表', Boolean(result?.shots?.length), JSON.stringify({ shotCount: result?.shots?.length, failed: result?.failedShotIndexes }))
  const modelBody = tikhub.modelRequests[0]?.body
  const messageParts = Array.isArray(modelBody?.messages)
    ? modelBody.messages.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    : []
  const promptParts = Array.isArray(modelBody?.prompt)
    ? modelBody.prompt.flatMap((message) => Array.isArray(message?.content) ? message.content : [])
    : []
  const hasImagePart = [...messageParts, ...promptParts].some((part) => part?.type === 'image' || part?.type === 'image_url' || typeof part?.image === 'string' || typeof part?.image_url?.url === 'string')
  check('真实模型请求携带参考帧并返回结构化字段', tikhub.modelRequests.length > 0 && hasImagePart && result?.shots?.some((shot) => shot.visual && shot.shotSize), JSON.stringify({ modelRequests: tikhub.modelRequests.length, bodyKeys: Object.keys(modelBody || {}), partTypes: [...messageParts, ...promptParts].map((part) => part?.type) }))
  check('拆解结果不是注入值且有原片帧证据', result?.shots?.every((shot) => shot.sourceFrameUrl && shot.sourceFrameUrl.startsWith('nomi-local://')), 'sourceFrameUrl')

  const addToCanvas = panel.locator('[data-deconstruct-add-to-canvas="true"]')
  await addToCanvas.click()
  await win.waitForTimeout(1_200)
  const sideEffects = await win.evaluate((id) => {
    const state = window.__nomiCanvasStore.getState()
    return { sourceMeta: state.nodes.find((node) => node.id === id)?.meta?.videoDeconstruction || null, nodeCount: state.nodes.length, imageNodes: state.nodes.filter((node) => node.kind === 'image').length }
  }, source.nodeId)
  check('加入画布产生分镜图像节点副作用', sideEffects.imageNodes > 0 && sideEffects.nodeCount > 1, JSON.stringify(sideEffects))

  await win.waitForTimeout(1_500)
  const persisted = await win.evaluate(async (id) => window.nomiDesktop.projects.readAsync(id), projectId)
  const persistedCanvas = persisted?.payload?.generationCanvas || persisted?.generationCanvas || {}
  const persistedSource = persistedCanvas.nodes?.find((node) => node.id === source.nodeId)
  check('保存前 readback 含拆解结果与画布副作用', Boolean(persistedSource?.meta?.videoDeconstruction && persistedCanvas.nodes?.length > 1), `nodes=${persistedCanvas.nodes?.length || 0}`)

  vision.setMode('malformed')
  const failedSource = await win.evaluate((url) => {
    const store = window.__nomiCanvasStore.getState()
    const node = store.addNode({ kind: 'video', title: 'TikHub malformed model fixture', position: { x: 420, y: 120 } })
    store.updateNode(node.id, { result: { id: `asset-${Date.now()}`, type: 'video', url, createdAt: Date.now() } })
    store.selectNode(node.id)
    return { nodeId: node.id }
  }, imported?.data?.url || imported?.data?.renderUrl)
  const failedNode = win.locator(`[data-node-id="${failedSource.nodeId}"]`).first()
  await failedNode.hover()
  await win.getByRole('button', { name: '拆解', exact: true }).first().click()
  const failedPanel = win.locator(`[data-deconstruct-panel="${failedSource.nodeId}"]`)
  await failedPanel.locator('[data-deconstruct-start="true"]').click()
  await failedPanel.locator('[data-deconstruct-shots="true"]').waitFor({ state: 'visible', timeout: 120_000 })
  const failedResult = await win.evaluate((id) => window.__nomiCanvasStore.getState().nodes.find((item) => item.id === id)?.meta?.videoDeconstruction || null, failedSource.nodeId)
  check('模型解析失败在真实拆解入口 fail-closed', failedResult?.failedShotIndexes?.length === 1 && failedResult.shots?.[0]?.visionFailed === true && !failedResult.shots?.[0]?.visual, JSON.stringify({ failed: failedResult?.failedShotIndexes, visionFailed: failedResult?.shots?.[0]?.visionFailed }))
  vision.setMode('happy')
  return { projectId, nodeId: source.nodeId }
}

async function runColdReadback(tikhub, projectId, nodeId) {
  const launched = await launchNomiApp({
    name: 'tikhub-project-video-breakdown-cold', userDataDir, settingsDir, projectsDir,
    syntheticCredentialStorage: true, env: { NODE_ENV: 'production', NOMI_TIKHUB_TEST_ORIGIN: tikhub.origin }, settleMs: 0,
  })
  try {
    await dismissChrome(launched.win)
    await openProjectFromLibrary(launched.win)
    await launched.win.getByRole('button', { name: '生成', exact: true }).click().catch(async () => launched.win.locator('[data-mode="generation"]').click())
    await launched.win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: 15_000 })
    const cold = await launched.win.evaluate(async ({ id, nodeId: sourceNodeId }) => {
      const persisted = await window.nomiDesktop.projects.readAsync(id)
      const canvas = persisted?.payload?.generationCanvas || persisted?.generationCanvas || {}
      const node = canvas.nodes?.find((item) => item.id === sourceNodeId)
      const live = window.__nomiCanvasStore.getState().nodes.find((item) => item.id === sourceNodeId)
      if (live) window.__nomiCanvasStore.getState().selectNode(sourceNodeId)
      return { persisted: node?.meta?.videoDeconstruction || null, live: live?.meta?.videoDeconstruction || null, nodeCount: canvas.nodes?.length || 0 }
    }, { id: projectId, nodeId })
    check('cold restart 后 readback 保留拆解结果', Boolean(cold.persisted?.shots?.length && cold.live?.shots?.length), JSON.stringify({ nodeCount: cold.nodeCount, shots: cold.persisted?.shots?.length }))
    const node = launched.win.locator(`[data-node-id="${nodeId}"]`).first()
    await node.hover()
    await launched.win.getByRole('button', { name: '拆解', exact: true }).first().click()
    const panel = launched.win.locator(`[data-deconstruct-panel="${nodeId}"]`)
    await panel.locator('[data-deconstruct-shots="true"]').waitFor({ state: 'visible', timeout: 15_000 })
    check('cold restart 后真实分镜表 UI 回读可见', await panel.locator('[data-deconstruct-shot]').count() > 0)
  } finally {
    await launched.app.close().catch(() => {})
  }
}

let app
let tikhub
let vision
try {
  if (!fs.existsSync(FIXTURE_VIDEO)) throw new Error(`missing fixture video: ${FIXTURE_VIDEO}`)
  tikhub = await startTikHubFixture()
  vision = await startVisionFixture()
  tikhub.modelRequests = vision.requests
  writeFixtureCatalog(vision.origin)
  const launched = await launchNomiApp({
    name: 'tikhub-project-video-breakdown', userDataDir, settingsDir, projectsDir,
    syntheticCredentialStorage: true,
    env: { NODE_ENV: 'production', NOMI_TIKHUB_TEST_ORIGIN: tikhub.origin }, settleMs: 0,
  })
  app = launched.app
  const identity = await runJourney(launched.app, launched.win, tikhub, vision)
  await launched.app.close()
  app = null
  await runColdReadback(tikhub, identity.projectId, identity.nodeId)
  console.log(`ELECTRON ASSERTIONS: ${electronAssertions}`)
  console.log(`FIXTURE REQUESTS: tikhub=${tikhub.requests.length} model=${vision.requests.length}`)
  if (failures.length) throw new Error(`failed assertions: ${failures.join(', ')}`)
  console.log('✓ TikHub → project asset → video deconstruction → storyboard side effect → cold readback complete')
} finally {
  await app?.close().catch(() => {})
  await vision?.close().catch(() => {})
  await tikhub?.close().catch(() => {})
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true })
}
