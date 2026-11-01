// 类检查：供应商已经收下、钱已经花了的单，只要任务号还在，就只该取回。
// 从 tests/fixtures/run-retrieval-recovery-cases.json 遍历「失败时机 × 有无任务号 × 窗口开着 / 关掉 / 重启」，
// 每格判 POST 数、GET 数、主按钮。真 Run、真观察者、真传输、环回假供应商；主按钮来自真的错误卡。
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { setTimeout } from 'node:timers'
import { fileURLToPath, URL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { createApprovalReceiptAuthority } from '../../electron/capabilityCore/approvalReceipt.ts'
import { canvasLocalArtifactReceipt, createCanvasShotRuns } from '../../electron/capabilityCore/appIntegrationCanvasShot.ts'
import { createRunObservationDrivers } from '../../electron/capabilityCore/appIntegrationRunObservation.ts'
import { createCanvasTransportProvider } from '../../electron/capabilityCore/canvasTransportProvider.ts'
import { submitDeclaration } from '../../electron/capabilityCore/modelOnboarding/submitDeclaration.ts'
import { readCatalog, upsertModelCatalogVendorApiKey } from '../../electron/catalog/catalogStore.ts'
import { registerBatchSchedulerKicker } from '../../electron/productionRun/batchSchedulerKick.ts'
import { canvasRunIdFor, openCanvasRuns } from '../../electron/productionRun/canvasShotRunIndex.ts'
import { runHasBeenOnCanvas } from '../../electron/productionRun/multiShotCanvasLanding.ts'
import { createProductionGenerationSubmission } from '../../electron/productionRun/productionGenerationSubmission.ts'
import { createProductionRunRepository } from '../../electron/productionRun/productionRunRepository.ts'
import { createProductionRunService } from '../../electron/productionRun/productionRunService.ts'
import { waitForProduction } from '../../electron/productionRun/productionRunTestHelpers.ts'
import { createProject, fetchTaskResult, runTask, taskCache } from '../../electron/runtime.ts'
import { jobAwaitsRetrieval } from '../../electron/shared/productionShotPhase.ts'
import { runTaskIpcGuard } from '../../electron/tasks/taskIpcGuard.ts'
import { RUN_APPROVED_ADMISSION } from '../../electron/tasks/taskSpend.ts'
import { listWorkspaceFiles } from '../../electron/workspace/workspaceFileIndex.ts'
import i18n from '../../src/i18n/index.ts'
import { NodeErrorReport } from '../../src/workbench/generationCanvas/nodes/NodeErrorReport.tsx'
import { NodeRecoverableReport } from '../../src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx'
import { matchNomiErrorCode } from '../../electron/shared/nomiErrorCodes.ts'
import { useGenerationCanvasStore } from '../../src/workbench/generationCanvas/store/generationCanvasStore.ts'
import { dismissRecoverableNode, recoverNodeResult } from '../../src/workbench/generationCanvas/runner/recoverTaskActions.ts'
import { deliverRunOutcome } from '../../src/workbench/generationCanvas/runner/runProjectDelivery.ts'
import { filterCanvasLibraryAssets } from '../../src/workbench/assets/assetLibrarySources.ts'
import { flattenWorkspaceFiles, workspaceNodeToAssetRef } from '../../src/workbench/assets/assetTypes.ts'
import { describeOpaqueFailure } from '../../src/workbench/observability/opaqueFailure.ts'
import { withProjectAction } from '../../src/workbench/project/projectCanvasReadSurface.ts'
import { createProjectSessionTestHarness } from '../../src/workbench/project/projectSessionTestHarness.ts'

vi.mock('electron', async (original) => ({ ...await original(), safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`test:${s}`), decryptString: (s) => s.toString().replace(/^test:/, ''),
} }))
const renderer = vi.hoisted(() => ({ bridge: null }))
vi.mock('../../src/desktop/bridge.ts', async (original) => ({ ...await original(), getDesktopBridge: () => renderer.bridge }))

const CASES = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../fixtures/run-retrieval-recovery-cases.json', import.meta.url)), 'utf8'))
const PNG = fs.readFileSync(fileURLToPath(new URL('../../electron/providerAdapter/__fixtures__/certification-media/valid.png', import.meta.url)))
const API_KEY = 'loopback-test-key'
const NODE_ID = 'node-1'
const SENDER = 7
const OLD_LOST_SENTENCE = '生成结果未能安全落入项目，请查看任务并处理'
const OLD_UNKNOWN_SENTENCE = '供应商返回了未识别的任务状态，需要人工核对'

let root, vendor, rigs = [], sessions = [], serial = 0

/** 本机这一侧的故障：供应商什么都没说，是 Nomi 现在没法去问。开回来就好了。 */
const LOCAL_FAULTS = {
  'local-vendor-off': (catalog, row) => { catalog.vendors.find((item) => item.key === row.vendorKey).enabled = false },
  'local-model-off': (catalog, row) => { catalog.models.find((item) => item.modelKey === row.modelKey).enabled = false },
  'local-key-gone': (catalog, row) => { delete catalog.apiKeysByVendor[row.vendorKey] },
}

function breakLocally(failure, row) {
  const file = path.join(root, 'settings', 'model-catalog.json')
  const saved = fs.readFileSync(file)
  const catalog = JSON.parse(saved)
  LOCAL_FAULTS[failure](catalog, row)
  fs.writeFileSync(file, JSON.stringify(catalog))
  return () => fs.writeFileSync(file, saved)
}

beforeEach(async () => {
  root = makeTempDir('run-retrieval-recovery-')
  vi.stubEnv('NOMI_SETTINGS_DIR', path.join(root, 'settings'))
  vi.stubEnv('NOMI_PROJECTS_DIR', path.join(root, 'projects'))
  await i18n.changeLanguage('zh-CN')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
})
afterEach(async () => {
  registerBatchSchedulerKicker(null)
  renderer.bridge = null
  for (const session of sessions.splice(0)) session.dispose()
  for (const rig of rigs.splice(0)) rig.drivers.stop()
  await vendor?.close(); vendor = undefined
  fs.rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** 环回假供应商：提交 → 查询 → 下载，每一步都能按当前故障出错，并数清收到几次 POST / GET。 */
async function startVendor() {
  const sockets = new Set()
  const state = { fault: null, pending: false, getDelayMs: 0, posts: 0, gets: 0, downloads: 0 }
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk
    const pathname = new URL(req.url, 'http://fixture').pathname
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (pathname === '/art.png') {
      state.downloads += 1
      if (state.fault === 'download-disconnect') return res.destroy()
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    if (req.method === 'POST' && pathname === '/v1/sync') {
      state.posts += 1
      return json(200, { image: { url: `${origin()}/art.png` } })
    }
    if (req.method === 'POST' && pathname === '/v1/jobs') {
      state.posts += 1
      if (state.fault === 'submit-disconnect') return res.destroy()
      if (state.fault === 'submit-rejected') return json(400, { error: { message: 'prompt rejected' } })
      return json(200, { id: `job-${++serial}`, status: 'queued' })
    }
    const job = /^\/jobs\/([\w-]+)$/.exec(pathname)
    if (req.method === 'GET' && job) {
      state.gets += 1
      if (state.getDelayMs) await new Promise((resolve) => setTimeout(resolve, state.getDelayMs))
      if (state.pending) return json(200, { id: job[1], status: 'in_progress' })
      if (state.fault === 'query-disconnect') return res.destroy()
      if (state.fault === 'query-5xx') return json(503, { error: { message: 'no capacity' } })
      if (state.fault === 'query-unknown-status') return json(200, { id: job[1], status: 'mystery_state' })
      if (state.fault === 'provider-failed') return json(200, { id: job[1], status: 'failed', detail: 'content policy rejected the prompt' })
      return json(200, { id: job[1], status: 'completed', image: { url: `${origin()}/art.png` } })
    }
    return json(404, { error: { message: `no route ${pathname}` } })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = () => `http://127.0.0.1:${server.address().port}`
  return { state, origin, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)) } }
}

function declaration(baseUrl) {
  const docs = 'https://docs.example-loopback.test/api'
  return {
    provider: { baseUrl, authType: 'bearer', authHeader: 'Authorization', authScheme: 'Bearer' },
    sources: [{ url: docs, evidence: 'POST /v1/jobs returns id+status; GET /jobs/{id}' }],
    assetIngestion: { strategy: 'none', sourceUrl: docs },
    models: [{ modelKey: 'retrieval-paint', labelZh: 'Retrieval Paint', kind: 'image', modes: [{
      taskKind: 'text_to_image', delivery: 'asynchronous',
      create: { method: 'POST', path: '/v1/jobs', body: { prompt: '{{request.prompt}}' }, response_mapping: { task_id: 'id', status: 'status' }, provider_meta_mapping: { task_id: 'id' } },
      query: { method: 'GET', path: '/jobs/{{providerMeta.task_id}}', response_mapping: { task_id: 'id', status: 'status', image_url: 'image.url', error_message: 'detail' } },
      statusMapping: { succeeded: ['completed'], running: ['in_progress', 'queued'], failed: ['failed'] }, sourceUrls: [docs],
    }] }],
  }
}

/** 同步模型：提交就回结果，没有查询接口。 */
function syncDeclaration(baseUrl) {
  const docs = 'https://docs.example-loopback.test/api'
  return {
    provider: { baseUrl, authType: 'bearer', authHeader: 'Authorization', authScheme: 'Bearer' },
    sources: [{ url: docs, evidence: 'POST /v1/sync returns the image at once' }],
    assetIngestion: { strategy: 'none', sourceUrl: docs },
    models: [{ modelKey: 'retrieval-paint', labelZh: 'Retrieval Paint', kind: 'image', modes: [{
      taskKind: 'text_to_image', delivery: 'synchronous',
      create: { method: 'POST', path: '/v1/sync', body: { prompt: '{{request.prompt}}' }, response_mapping: { image_url: 'image.url' } },
      sourceUrls: [docs],
    }] }],
  }
}

async function prepareProject({ sync = false } = {}) {
  vendor = await startVendor()
  const reply = await submitDeclaration({ name: 'Loopback retrieval', declaration: JSON.stringify((sync ? syncDeclaration : declaration)(vendor.origin())) })
  expect(reply.ok, JSON.stringify(reply)).toBe(true)
  const row = readCatalog().models.find((model) => model.modelKey === 'retrieval-paint')
  upsertModelCatalogVendorApiKey(row.vendorKey, { apiKey: API_KEY, enabled: true })
  const projectRoot = path.join(root, 'project')
  const project = createProject({ name: 'Retrieval', rootPath: projectRoot })
  return { row, project, projectRoot }
}

/** 一次 Run 宿主（进程）。重启 = 丢掉它的内存状态，在同一份盘上再建一个。 */
function createHost({ project, projectRoot, row }, crash, { forgetSubmitResult = false } = {}) {
  const repository = createProductionRunRepository({ projectDirResolver: (id) => (id === project.id ? projectRoot : null) })
  if (crash?.commandFragment) {
    const execute = repository.execute.bind(repository)
    repository.execute = (projectId, runId, command) => {
      if (crash.armed && command.commandId.includes(crash.commandFragment)) { crash.armed = false; throw new Error('simulated crash while landing') }
      return execute(projectId, runId, command)
    }
  }
  const receipts = createApprovalReceiptAuthority({ filePath: path.join(root, 'receipts.json'), macKey: 'k', storeMacKey: 's', keyId: 'v1' })
  const service = createProductionRunService({ repository, projectRootResolver: () => projectRoot, requestRenderer: async () => { throw new Error('no renderer') }, approvalReceiptAuthority: receipts, projectRevisionResolver: () => 0 })
  // forgetSubmitResult：提交时拿到的结果只在进程内存里。要测「崩在受理和落地之间」，这一份不能带到重启之后。
  const execute = async (payload) => {
    const result = await runTask(payload, RUN_APPROVED_ADMISSION)
    return forgetSubmitResult ? { ...result, status: 'queued', assets: [] } : result
  }
  const transport = { networkTransport: 'app-fetch', execute, fetchResult: (payload) => fetchTaskResult(payload) }
  const providers = [createCanvasTransportProvider(row.vendorKey, transport)]
  const buildSubmission = (input) => createProductionGenerationSubmission({
    repository, projectRoot: input.projectRoot, immutableProjectUuid: input.immutableProjectUuid, projectGeneration: input.projectGeneration, intentMacKey: 'intent-key', providers: input.providers,
    materializeOutput: async ({ projectId, providerTaskId, output }) => canvasLocalArtifactReceipt({ projectId, projectRoot: input.projectRoot, providerTaskId, output }),
  })
  const identity = { immutableProjectUuid: 'uuid-1', projectGeneration: 1 }
  const drivers = createRunObservationDrivers({
    repository, buildSchedulerForRun: () => null,
    buildSubmissionForRun: () => buildSubmission({ projectRoot, ...identity, providers }),
  })
  registerBatchSchedulerKicker(drivers.kickSchedulerForRun)
  const runs = createCanvasShotRuns({
    service, readProject: () => ({ id: project.id, ...identity, revision: 3 }), resolveProjectRoot: () => projectRoot, receipts, providers: () => providers, buildSubmission,
    previewBlock: async () => null, quote: () => ({ known: false }), observe: (submission, projectId, runId) => drivers.observeSingleShotRun(submission, projectId, runId),
  })
  const host = {
    repository, service, runs, drivers,
    submit: (runRecordId) => runs.submit({ projectId: project.id, nodeId: NODE_ID, runRecordId, vendor: row.vendorKey, request: { kind: 'text_to_image', prompt: 'A blue marble', extras: { nodeId: NODE_ID, projectId: project.id, modelKey: row.modelKey, idempotencyKey: runRecordId } }, gesture: { webContentsId: SENDER, frameId: 1, origin: 'app://nomi' }, senderId: SENDER }),
    poll: (runRecordId) => runs.poll({ projectId: project.id, runRecordId, senderId: SENDER }),
    run: (runRecordId) => repository.read(project.id, canvasRunIdFor(runRecordId)),
    job: (runRecordId) => repository.read(project.id, canvasRunIdFor(runRecordId))?.jobs.at(-1) ?? null,
  }
  rigs.push(host)
  return host
}

/** 和真的 IPC 一样：错误经 runTaskIpcGuard 编码，到渲染层前面多一段 Electron 的前缀。 */
const overIpc = (channel, payload, thunk) => runTaskIpcGuard(payload, thunk).catch((error) => { throw new Error(`Error invoking remote method '${channel}': ${error}`) })

/**
 * 真的渲染层：节点在真的画布 store 里，落可找回走真的投递口，点按钮走真的 recoverNodeResult，
 * 桥接到同一个进程里真的 Run 宿主。放手在投递口里，这里不手动放手。
 */
async function openRenderer(prepared, host) {
  const session = createProjectSessionTestHarness()
  sessions.push(session)
  const binding = await session.open(prepared.project.id)
  const store = useGenerationCanvasStore.getState()
  const added = store.addNode({ kind: 'image', prompt: 'A blue marble', meta: { modelVendor: prepared.row.vendorKey, modelKey: prepared.row.modelKey } })
  store.restoreSnapshot({ nodes: [{ ...added, id: NODE_ID }], edges: [], selectedNodeIds: [], groups: [] })
  const view = {
    polls: 0,
    afterPoll: null,
    node: () => useGenerationCanvasStore.getState().nodes.find((item) => item.id === NODE_ID),
    /** 受理之后节点上记下这一次运行和任务号，和渲染层轮询时一样。 */
    accepted(runRecordId) {
      const now = Date.now()
      useGenerationCanvasStore.getState().appendNodeRun(NODE_ID, { id: runRecordId, status: 'running', startedAt: now, updatedAt: now, taskId: host.job(runRecordId).providerTaskId, projectId: prepared.project.id })
      useGenerationCanvasStore.getState().setNodeStatus(NODE_ID, 'running')
    },
    /** 渲染层不再等这一笔：和 generationRunController 等够宽限时同一个投递口。 */
    giveUpWaiting: (error = 'timed out') => deliverRunOutcome(binding, NODE_ID, { kind: 'status', status: 'recoverable', error }),
    clickRetrieve: () => withProjectAction((project) => recoverNodeResult(NODE_ID, project)),
    clickMarkFailed: () => dismissRecoverableNode(NODE_ID),
    /** 重试：错误和真的那条 IPC 一样编码，落到节点上的就是这一句。 */
    retry: (runRecordId) => overIpc('nomi:tasks:canvas-submit', {}, () => host.submit(runRecordId)),
  }
  renderer.bridge = { tasks: {
    canvasPoll: (input) => overIpc('nomi:tasks:canvas-poll', input, async () => {
      view.polls += 1
      const result = await host.poll(input.runRecordId)
      view.afterPoll?.()
      return result
    }),
    canvasRelease: async (input) => host.runs.release(input),
  } }
  return view
}

/** 素材面板看到的项目素材：和面板同一条路（列项目文件 → 转素材 → 画布素材库筛选）。 */
function libraryPaths({ project, projectRoot }) {
  const files = flattenWorkspaceFiles(listWorkspaceFiles({ rootPath: projectRoot, maxFiles: 2000 }).items)
  return filterCanvasLibraryAssets(files.map((file) => workspaceNodeToAssetRef(file, project.id)).filter(Boolean)).map((asset) => asset.origin.relativePath)
}

const readyArtifacts = (run) => run.artifacts.filter((artifact) => artifact.status === 'ready')

const ACTION_LABELS = {
  'open-recoverable': 'generationCommon.observability.action.openRecoverable.main',
  retry: 'generationCommon.observability.action.retry.main',
  'view-task': 'generationCommon.observability.action.viewTask.main',
  reconcile: 'generationCommon.observability.action.reconcile.main',
  'open-model-access': 'generationCommon.observability.action.openModelAccess.main',
}

/** 真的待取回卡：Nomi 没法去问时，卡要说这个原因，不能说「已经生成」或「等超时了」。还要有「标记失败」可点。 */
async function expectLocalUnavailableCard(message, taskId) {
  for (const [language, says] of [['zh-CN', /现在用不了/], ['en', /(?:not|n.t) available right now/]]) {
    await i18n.changeLanguage(language)
    const markup = renderToStaticMarkup(createElement(NodeRecoverableReport, { node: { runs: [{ id: 'run-1', taskId }], error: message }, onRecover: () => {}, onDismiss: () => {} }))
    expect(markup, `card in ${language}`).toMatch(says)
    expect(markup, `card in ${language}`).not.toMatch(/已经生成|等待已超上限|already generated|wait timed out/i)
    expect(markup, `card in ${language}`).toContain(i18n.t('generationCommon.recoverable.dismiss'))
  }
  await i18n.changeLanguage('zh-CN')
}

/** 真的错误卡：把这句话和这个任务号交给 NodeErrorReport，读它排在最前面的动作。 */
function cardMainButton(message, taskId) {
  const store = useGenerationCanvasStore.getState()
  const node = store.addNode({ kind: 'image', prompt: 'A blue marble', meta: { modelVendor: 'loopback', modelKey: 'retrieval-paint' } })
  const markup = renderToStaticMarkup(createElement(NodeErrorReport, { message, nodeId: node.id, run: { id: 'run-1', ...(taskId ? { taskId } : {}) }, meta: {}, onRetry: () => {} }))
  const shown = Object.entries(ACTION_LABELS)
    .map(([action, key]) => [action, markup.indexOf(`>${i18n.t(key)}<`)])
    .filter(([, index]) => index >= 0)
    .sort((left, right) => left[1] - right[1])
  return shown[0]?.[0] ?? null
}

describe('任务号还在就只取回：矩阵', () => {
  it.each(CASES)('$id', async (cell) => {
    const prepared = await prepareProject()
    const crash = cell.failure === 'crash-after-artifact-add' ? { commandFragment: 'materialize-job:', armed: false } : null
    let host = createHost(prepared, crash)
    const record = 'rec-1'
    const isSubmitFailure = cell.failure.startsWith('submit-')
    const isLocalFault = cell.failure in LOCAL_FAULTS
    let clearFault = () => { vendor.state.fault = null }
    if (isSubmitFailure) vendor.state.fault = cell.failure

    let submitted = null
    let submitError = null
    try { submitted = await host.submit(record) } catch (error) { submitError = error }
    if (isSubmitFailure) expect(submitError, 'submit should fail').toBeTruthy()
    else expect(submitError).toBeNull()
    expect(vendor.state.posts).toBe(1)

    if (crash) crash.armed = true
    else if (isLocalFault) clearFault = breakLocally(cell.failure, prepared.row)
    else if (!isSubmitFailure) vendor.state.fault = cell.failure
    const failed = { threw: null, result: null }
    if (cell.window === 'open') {
      if (!isSubmitFailure) {
        try { failed.result = await host.poll(record) } catch (error) { failed.threw = error }
      }
    } else if (cell.window === 'closed') {
      host.runs.releaseSender(SENDER)
    } else {
      host.drivers.stop()
      if (submitted) taskCache.delete(host.job(record)?.providerTaskId)
      host = createHost(prepared, crash)
      host.runs.recoverOrphans(prepared.project.id)
    }

    const settled = (job) => job?.status === cell.after.jobStatus
      // 本机故障这一格：已经停下来了就别等到超时，下面的断言会说清楚停成了什么。
      || (isLocalFault && job?.status === 'needs_attention')
    await waitForProduction(() => settled(host.job(record)) || (cell.after.jobStatus === 'provider_accepted' && (failed.threw || failed.result)))
    const job = host.job(record)
    expect(vendor.state.posts, 'the failure itself never posts again').toBe(1)
    if (cell.after.jobStatus !== 'provider_accepted') {
      expect(job.status).toBe(cell.after.jobStatus)
      expect(job.errorCode ?? null).toBe(cell.after.errorCode)
    }
    expect(jobAwaitsRetrieval(job)).toBe(cell.after.awaitsRetrieval)
    expect(Boolean(job.providerTaskId)).toBe(cell.taskId)

    if (crash && cell.window === 'open') {
      // 渲染层已经拿到结果，不会再来：观察者把没收尾的这一笔补齐。
      expect(failed.result?.status).toBe('succeeded')
      await waitForProduction(() => host.run(record)?.status === 'completed')
    } else if (cell.button === 'none') {
      // 还在跑：没有主按钮，节点照旧转圈。状态好了就落地，窗口开着由渲染层查，关着由观察者查。
      expect(failed.threw).toBeNull()
      vendor.state.fault = null
      const getsBefore = vendor.state.gets
      if (cell.window === 'open') await host.poll(record)
      await waitForProduction(() => host.run(record)?.status === 'completed')
      expect(vendor.state.posts).toBe(cell.click.posts)
      expect(vendor.state.gets - getsBefore).toBeGreaterThanOrEqual(cell.click.minGets)
    } else {
      // 用户这时看到什么：关窗 / 重启后节点收敛成可找回面板；窗口开着查不到也落可找回；其余读真的错误卡。
      const onPanel = cell.window !== 'open' ? cell.taskId : Boolean(failed.threw)
      const message = submitError ? String(submitError.message ?? submitError) : failed.result?.error
      if (isLocalFault) await expectLocalUnavailableCard(failed.threw ? String(failed.threw.message ?? failed.threw) : job.errorMessage, job.providerTaskId)
      let button = onPanel ? 'panel-retrieve' : cardMainButton(message, cell.taskId ? job.providerTaskId : undefined)
      if (cell.button === 'SUBMIT_UNKNOWN') expect(button).not.toBe('retry')
      else expect(button).toBe(cell.button)

      if (crash) vendor.state.fault = null
      if (cell.failsAgain) {
        const getsBefore = vendor.state.gets
        const again = await clickMainButton(host, record, button)
        expect(again).toMatchObject({ kept: true })
        // 供应商出故障：真去查了。本机查不了：一个请求都发不出去，点过之后卡上写真实原因，账本也记着（任务面板读它）。
        if (isLocalFault) {
          expect(vendor.state.gets, 'nothing can reach the provider yet').toBe(getsBefore)
          await expectLocalUnavailableCard(String(again.error?.message ?? again.error), job.providerTaskId)
          if (cell.after.awaitsRetrieval) expect(matchNomiErrorCode(host.job(record).errorMessage ?? '')).toBe('retrieval-unavailable')
        } else expect(vendor.state.gets, 'retrieving again really queried').toBeGreaterThan(getsBefore)
        expect(vendor.state.posts).toBe(1)
        // 这一次又没成：不是判死。停过的回到待取回（不能卡在轮询里，否则 ↑ 永远说还在生成）；窗口开着、从没停过的还在进行中。
        if (cell.after.awaitsRetrieval) expect(jobAwaitsRetrieval(host.job(record))).toBe(true)
        else expect(['provider_accepted', 'polling']).toContain(host.job(record).status)
        button = 'panel-retrieve'
      }

      clearFault()
      const getsBefore = vendor.state.gets - (cell.failsAgain && !isLocalFault ? 1 : 0)
      const clicked = await clickMainButton(host, record, button)
      if (cell.click.thenButton) {
        expect(clicked.result?.status).toBe('failed')
        const next = cardMainButton(clicked.result.error, job.providerTaskId)
        expect(next).toBe(cell.click.thenButton)
        await clickMainButton(host, record, next)
      }
      expect(vendor.state.posts).toBe(cell.click.posts)
      expect(vendor.state.gets - getsBefore).toBeGreaterThanOrEqual(cell.click.minGets)
    }

    if (cell.click.landed) {
      await waitForProduction(() => host.run(record)?.status === 'completed')
      const run = host.run(record)
      expect(host.job(record).status).toBe('ready')
      const artifact = run.artifacts.find((value) => value.status === 'ready')
      expect(artifact?.projectRelativePath).toBeTruthy()
      expect(fs.existsSync(path.join(prepared.projectRoot, artifact.projectRelativePath))).toBe(true)
      // 打开项目时会清掉已经收尾的标记：这个节点不再被这一笔锁着。
      host.runs.recoverOrphans(prepared.project.id)
      expect(openCanvasRuns(prepared.projectRoot)).toEqual([])
      expect(run.artifacts.filter((value) => value.status === 'ready')).toHaveLength(1)
    }
  }, 60_000)
})

/** 用户点主按钮时主进程真正做的那件事。「重新取回」只查；重试才会下新单。 */
async function clickMainButton(host, record, button) {
  if (button === 'panel-retrieve' || button === 'open-recoverable') {
    try { return { result: await host.poll(record) } } catch (error) { return { kept: true, error } }
  }
  if (button === 'retry') {
    try { return { result: await host.submit(`rec-${++serial}-retry`) } } catch (error) { return { error } }
  }
  return {}
}

describe('旧数据：0.24.0 及更早已经落下的这一笔', () => {
  async function stoppedOnce(prepared) {
    const host = createHost(prepared)
    await host.submit('rec-old')
    vendor.state.fault = 'query-disconnect'
    host.runs.releaseSender(SENDER)
    await waitForProduction(() => host.job('rec-old')?.status === 'needs_attention')
    vendor.state.fault = null
    return host
  }

  it('旧观察者写下的 single_shot_observation_failed：点重新取回真去查，落地，POST 仍 1', async () => {
    const prepared = await prepareProject()
    const host = await stoppedOnce(prepared)
    const runId = canvasRunIdFor('rec-old')
    const run = host.repository.read(prepared.project.id, runId)
    host.repository.execute(prepared.project.id, runId, { commandId: 'old-data', expectedRevision: run.revision, type: 'job.patch', issuedAt: new Date().toISOString(), payload: { jobId: host.job('rec-old').jobId, patch: { errorCode: 'single_shot_observation_failed', errorMessage: OLD_LOST_SENTENCE } } })
    expect(jobAwaitsRetrieval(host.job('rec-old'))).toBe(true)
    const getsBefore = vendor.state.gets
    const result = await host.poll('rec-old')
    expect(vendor.state.gets).toBeGreaterThan(getsBefore)
    expect(result.status).toBe('succeeded')
    expect(vendor.state.posts).toBe(1)
    await waitForProduction(() => host.run('rec-old')?.status === 'completed')
  }, 60_000)

  it('供应商回过认不出的状态（provider_status_unknown）：供应商没说失败，点重新取回真去查，落地，POST 仍 1', async () => {
    const prepared = await prepareProject()
    const host = await stoppedOnce(prepared)
    const runId = canvasRunIdFor('rec-old')
    const run = host.repository.read(prepared.project.id, runId)
    host.repository.execute(prepared.project.id, runId, { commandId: 'old-data', expectedRevision: run.revision, type: 'job.patch', issuedAt: new Date().toISOString(), payload: { jobId: host.job('rec-old').jobId, patch: { errorCode: 'provider_status_unknown', errorMessage: OLD_UNKNOWN_SENTENCE } } })
    expect(jobAwaitsRetrieval(host.job('rec-old'))).toBe(true)
    const getsBefore = vendor.state.gets
    expect((await host.poll('rec-old')).status).toBe('succeeded')
    expect(vendor.state.gets).toBeGreaterThan(getsBefore)
    expect(vendor.state.posts).toBe(1)
  }, 60_000)

  it.each([
    ['第一句 + 有任务号', OLD_LOST_SENTENCE, 'task-1', 'open-recoverable'],
    ['第二句 + 有任务号', OLD_UNKNOWN_SENTENCE, 'task-1', 'open-recoverable'],
    ['第一句 + 没有任务号：没有东西可取，主按钮还是重试', OLD_LOST_SENTENCE, undefined, 'retry'],
    ['第二句 + 没有任务号：同上', OLD_UNKNOWN_SENTENCE, undefined, 'retry'],
    ['供应商说失败的那句不解码', '供应商任务已返回失败状态', 'task-1', 'retry'],
  ])('节点上已经存着的错误卡：%s', (_label, message, taskId, expected) => {
    expect(cardMainButton(message, taskId)).toBe(expected)
  })
})

describe('窗口一直开着：渲染层等够宽限、不再等这一笔之后', () => {
  // 渲染层落可找回就放手（投递口 deliverRunOutcome）：没人接手的话这一笔一直算在生成，新单被挡，「标记失败」之后也重试不了。
  async function acceptedOnNode(prepared, host) {
    const view = await openRenderer(prepared, host)
    await host.submit('rec-1')
    view.accepted('rec-1')
    return view
  }

  /** 查询在出错时渲染层等够宽限落可找回；放手之后观察者第一次查询失败，这一笔停成待取回。 */
  async function stopAfterGivingUp(view, host, expectedCode) {
    const polled = await host.poll('rec-1').then(() => null, (error) => error)
    expect(polled).toBeTruthy()
    expect(host.job('rec-1').status).not.toBe('needs_attention')
    // 渲染层还在等的时候，这个节点照旧不许下新单。
    await expect(host.submit('rec-blocked')).rejects.toThrow(/node_generation_in_flight/)
    await view.giveUpWaiting(describeOpaqueFailure(polled))
    expect(view.node().status).toBe('recoverable')
    await waitForProduction(() => host.job('rec-1')?.status === 'needs_attention')
    expect(jobAwaitsRetrieval(host.job('rec-1'))).toBe(true)
    expect(matchNomiErrorCode(host.job('rec-1').errorMessage ?? '')).toBe(expectedCode)
    expect(vendor.state.posts).toBe(1)
  }

  /** 放手之后观察者查到结果：Run 完成，产物在项目里，节点还在可找回。 */
  async function completedInBackground(prepared, host, view) {
    const getsAtGiveUp = vendor.state.gets
    vendor.state.pending = true
    await view.giveUpWaiting()
    await waitForProduction(() => vendor.state.gets > getsAtGiveUp)
    vendor.state.pending = false
    await waitForProduction(() => host.run('rec-1')?.status === 'completed')
    expect(view.polls).toBe(0)
    const [artifact, ...others] = readyArtifacts(host.run('rec-1'))
    expect(others).toEqual([])
    expect(fs.existsSync(path.join(prepared.projectRoot, artifact.projectRelativePath))).toBe(true)
    expect(libraryPaths(prepared)).toContain(artifact.projectRelativePath)
    expect(vendor.state.posts).toBe(1)
    // 节点不跟随画布单镜 Run（一个节点的落地只归渲染层一处）：结果先落进项目，节点上点一下才显示。
    expect(runHasBeenOnCanvas(host.run('rec-1'))).toBe(false)
    expect(view.node().status).toBe('recoverable')
    expect(view.node().result).toBeUndefined()
    return artifact
  }

  it('放手后观察者查到结果：先落进项目，节点还是可找回；点一下重新取回即现，一个版本，这一下不联网', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    const artifact = await completedInBackground(prepared, host, view)
    const before = { ...vendor.state }
    await view.clickRetrieve()
    expect(view.node().status).toBe('success')
    expect(view.node().result.url).toContain(encodeURI(path.basename(artifact.projectRelativePath)))
    expect(view.node().history).toHaveLength(1)
    expect(vendor.state).toMatchObject({ posts: before.posts, gets: before.gets, downloads: before.downloads })
    expect(readyArtifacts(host.run('rec-1'))).toHaveLength(1)
  }, 60_000)

  it('放手后观察者还在查，用户点重新取回：Run 一份产物，节点一个版本，POST=1；素材最多多一份相同文件', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    vendor.state.pending = true
    vendor.state.getDelayMs = 300
    await view.giveUpWaiting()
    await waitForProduction(() => vendor.state.gets > 0)
    const clicked = view.clickRetrieve()
    await waitForProduction(() => view.polls > 0)
    vendor.state.pending = false
    await clicked
    await waitForProduction(() => host.run('rec-1')?.status === 'completed')
    expect(view.node().status).toBe('success')
    expect(view.node().history).toHaveLength(1)
    expect(readyArtifacts(host.run('rec-1'))).toHaveLength(1)
    // 已知限制：两边同时查到时各下载一次，素材里可能多一份。不多扣钱；这里钉住上限，不许变成更多份、也不许内容不同。
    const files = libraryPaths(prepared)
    expect(files.length, files.join(' ')).toBeGreaterThanOrEqual(1)
    expect(files.length, files.join(' ')).toBeLessThanOrEqual(2)
    expect(vendor.state.downloads).toBe(files.length)
    const contents = files.map((file) => fs.readFileSync(path.join(prepared.projectRoot, file)))
    expect(contents.every((content) => content.equals(contents[0]))).toBe(true)
    expect(vendor.state.posts).toBe(1)
  }, 60_000)

  it.each(Object.keys(LOCAL_FAULTS))('%s：观察者停成待取回，账本和卡都是真实原因；这单不要了，标记失败后才能重试，这时才算第二单', async (failure) => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    const restore = breakLocally(failure, prepared.row)
    await stopAfterGivingUp(view, host, 'retrieval-unavailable')
    await expectLocalUnavailableCard(view.node().error, host.job('rec-1').providerTaskId)
    restore()
    view.clickMarkFailed()
    expect(view.node().status).toBe('error')
    expect(cardMainButton(view.node().error, host.job('rec-1').providerTaskId)).toBe('retry')
    expect(vendor.state.posts).toBe(1)
    await view.retry('rec-2')
    expect(vendor.state.posts).toBe(2)
  }, 60_000)

  it('供应商出故障也一样：故障好了点重新取回就落地，只下过一单', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    vendor.state.fault = 'query-5xx'
    await stopAfterGivingUp(view, host, 'retrieval-query')
    vendor.state.fault = null
    await view.clickRetrieve()
    expect(view.node().status).toBe('success')
    await waitForProduction(() => host.run('rec-1')?.status === 'completed')
    expect(vendor.state.posts).toBe(1)
  }, 60_000)

  it('查得了、单还在跑：标记失败再重试被挡，卡上说这一单还在跑，不露错误码；跑完才放行', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    vendor.state.pending = true
    await view.giveUpWaiting()
    view.clickMarkFailed()
    const refused = await view.retry('rec-2').then(() => null, (error) => error)
    expect(refused).toBeTruthy()
    expect(vendor.state.posts).toBe(1)
    const message = describeOpaqueFailure(refused)
    for (const language of ['zh-CN', 'en']) {
      await i18n.changeLanguage(language)
      const markup = renderToStaticMarkup(createElement(NodeErrorReport, { message, nodeId: NODE_ID, run: { id: 'rec-2' }, meta: {}, onRetry: () => {} }))
      expect(markup, `card in ${language}`).toContain(i18n.t('generationCommon.observability.error.nodeInFlight.reason'))
      expect(markup, `card in ${language}`).toContain(i18n.t('generationCommon.observability.error.nodeInFlight.hint'))
      expect(markup, `card in ${language}`).not.toContain('node_generation_in_flight')
    }
    await i18n.changeLanguage('zh-CN')
    vendor.state.pending = false
    await waitForProduction(() => host.run('rec-1')?.status === 'completed')
    await view.retry('rec-3')
    expect(vendor.state.posts).toBe(2)
  }, 60_000)

  it('点重新取回等满上限、单还在跑：退回可找回并放手，观察者接着查，不锁死', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    // 重开项目收敛成可找回的那种节点：还没有放过手。
    useGenerationCanvasStore.getState().setNodeStatus(NODE_ID, 'recoverable')
    vendor.state.pending = true
    // 只在这一次查询回来、到它比较时限的那几步里把钟拨过 10 分钟，别的时间都是真钟：观察者和锁都不受影响。
    const realNow = Date.now.bind(Date)
    let shift = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + shift)
    view.afterPoll = () => { shift = 601_000 }
    try {
      await view.clickRetrieve()
    } finally {
      clock.mockRestore()
      view.afterPoll = null
    }
    expect(view.polls).toBe(1)
    expect(view.node().status).toBe('recoverable')
    expect(matchNomiErrorCode(view.node().error ?? '')).toBe('retrieval-timeout')
    const getsAfterClick = vendor.state.gets
    await waitForProduction(() => vendor.state.gets > getsAfterClick)
    expect(view.polls).toBe(1)
    view.clickMarkFailed()
    await expect(view.retry('rec-2')).rejects.toThrow(/node_generation_in_flight/)
    expect(vendor.state.posts).toBe(1)
    vendor.state.pending = false
    await waitForProduction(() => host.run('rec-1')?.status === 'completed')
    await view.retry('rec-3')
    expect(vendor.state.posts).toBe(2)
  }, 60_000)

  it('Run 已经完成，用户没点重新取回而是标记失败：节点进错误卡，产物还在素材里；重试算第二单，第一份不丢', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared, null)
    const view = await acceptedOnNode(prepared, host)
    const artifact = await completedInBackground(prepared, host, view)
    const bytes = fs.readFileSync(path.join(prepared.projectRoot, artifact.projectRelativePath))
    view.clickMarkFailed()
    expect(view.node().status).toBe('error')
    expect(view.node().result).toBeUndefined()
    expect(cardMainButton(view.node().error, host.job('rec-1').providerTaskId)).toBe('retry')
    expect(libraryPaths(prepared)).toContain(artifact.projectRelativePath)
    expect(vendor.state.posts).toBe(1)
    await view.retry('rec-2')
    expect(vendor.state.posts).toBe(2)
    expect((await host.poll('rec-2')).status).toBe('succeeded')
    await waitForProduction(() => host.run('rec-2')?.status === 'completed')
    const second = readyArtifacts(host.run('rec-2'))[0]
    expect(libraryPaths(prepared)).toEqual(expect.arrayContaining([artifact.projectRelativePath, second.projectRelativePath]))
    expect(fs.readFileSync(path.join(prepared.projectRoot, artifact.projectRelativePath)).equals(bytes)).toBe(true)
    expect(host.run('rec-1').status).toBe('completed')
  }, 60_000)
})

describe('同步模型崩在受理和落地之间', () => {
  it('重启后没有查询接口可问：停在待取回，点重新取回 POST 仍 1；标记失败后能重试', async () => {
    const prepared = await prepareProject({ sync: true })
    let host = createHost(prepared, null, { forgetSubmitResult: true })
    await host.submit('rec-sync')
    expect(vendor.state.posts).toBe(1)
    const taskId = host.job('rec-sync').providerTaskId
    host.drivers.stop()
    taskCache.delete(taskId)
    host = createHost(prepared, null, { forgetSubmitResult: true })
    host.runs.recoverOrphans(prepared.project.id)
    await waitForProduction(() => host.job('rec-sync')?.status === 'needs_attention')
    expect(jobAwaitsRetrieval(host.job('rec-sync'))).toBe(true)

    await expect(clickMainButton(host, 'rec-sync', 'panel-retrieve')).resolves.toMatchObject({ kept: true })
    expect(jobAwaitsRetrieval(host.job('rec-sync'))).toBe(true)
    expect(vendor.state.posts).toBe(1)

    expect(cardMainButton(i18n.t('generationCommon.recoverable.markedFailed'), taskId)).toBe('retry')
    await host.submit('rec-sync-2')
    expect(vendor.state.posts).toBe(2)
  }, 60_000)
})

describe('另一扇门：任务面板的「重新取回」（job.retry_retrieval）', () => {
  it('单镜也能用：放回轮询、观察者真去查、落地，POST 仍 1', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared)
    await host.submit('rec-panel')
    vendor.state.fault = 'query-5xx'
    host.runs.releaseSender(SENDER)
    await waitForProduction(() => host.job('rec-panel')?.status === 'needs_attention')
    vendor.state.fault = null
    const getsBefore = vendor.state.gets
    const job = host.job('rec-panel')
    const run = host.run('rec-panel')
    await host.service.command(prepared.project.id, run.runId, { commandId: 'panel-retry', expectedRevision: run.revision, type: 'job.retry_retrieval', issuedAt: new Date().toISOString(), payload: { jobId: job.jobId } })
    await waitForProduction(() => host.job('rec-panel')?.status === 'ready')
    expect(vendor.state.gets).toBeGreaterThan(getsBefore)
    expect(vendor.state.posts).toBe(1)
  }, 60_000)
})
