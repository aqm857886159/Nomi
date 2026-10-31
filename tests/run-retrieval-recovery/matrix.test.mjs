// 类检查：供应商已经收下、钱已经花了的单，只要任务号还在，就只该取回。
// 从 tests/fixtures/run-retrieval-recovery-cases.json 遍历「失败时机 × 有无任务号 × 窗口开着 / 关掉 / 重启」，
// 每格判 POST 数、GET 数、主按钮。真 Run、真观察者、真传输、环回假供应商；主按钮来自真的错误卡。
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { createProductionGenerationSubmission } from '../../electron/productionRun/productionGenerationSubmission.ts'
import { createProductionRunRepository } from '../../electron/productionRun/productionRunRepository.ts'
import { createProductionRunService } from '../../electron/productionRun/productionRunService.ts'
import { createProject, fetchTaskResult, runTask } from '../../electron/runtime.ts'
import { jobAwaitsRetrieval } from '../../electron/shared/productionShotPhase.ts'
import { RUN_APPROVED_ADMISSION } from '../../electron/tasks/taskSpend.ts'
import i18n from '../../src/i18n/index.ts'
import { NodeErrorReport } from '../../src/workbench/generationCanvas/nodes/NodeErrorReport.tsx'
import { useGenerationCanvasStore } from '../../src/workbench/generationCanvas/store/generationCanvasStore.ts'

vi.mock('electron', async (original) => ({ ...await original(), safeStorage: {
  isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`test:${s}`), decryptString: (s) => s.toString().replace(/^test:/, ''),
} }))

const CASES = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../fixtures/run-retrieval-recovery-cases.json', import.meta.url)), 'utf8'))
const PNG = fs.readFileSync(fileURLToPath(new URL('../../electron/providerAdapter/__fixtures__/certification-media/valid.png', import.meta.url)))
const API_KEY = 'loopback-test-key'
const NODE_ID = 'node-1'
const SENDER = 7
const OLD_LOST_SENTENCE = '生成结果未能安全落入项目，请查看任务并处理'
const OLD_UNKNOWN_SENTENCE = '供应商返回了未识别的任务状态，需要人工核对'

let root, vendor, rigs = [], serial = 0

beforeEach(async () => {
  root = makeTempDir('run-retrieval-recovery-')
  vi.stubEnv('NOMI_SETTINGS_DIR', path.join(root, 'settings'))
  vi.stubEnv('NOMI_PROJECTS_DIR', path.join(root, 'projects'))
  await i18n.changeLanguage('zh-CN')
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
})
afterEach(async () => {
  registerBatchSchedulerKicker(null)
  for (const rig of rigs.splice(0)) rig.drivers.stop()
  await vendor?.close(); vendor = undefined
  fs.rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** 环回假供应商：提交 → 查询 → 下载，每一步都能按当前故障出错，并数清收到几次 POST / GET。 */
async function startVendor() {
  const sockets = new Set()
  const state = { fault: null, posts: 0, gets: 0, downloads: 0 }
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    const pathname = new URL(req.url, 'http://fixture').pathname
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (pathname === '/art.png') {
      state.downloads += 1
      if (state.fault === 'download-disconnect') return res.destroy()
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
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

async function prepareProject() {
  vendor = await startVendor()
  const reply = await submitDeclaration({ name: 'Loopback retrieval', declaration: JSON.stringify(declaration(vendor.origin())) })
  expect(reply.ok, JSON.stringify(reply)).toBe(true)
  const row = readCatalog().models.find((model) => model.modelKey === 'retrieval-paint')
  upsertModelCatalogVendorApiKey(row.vendorKey, { apiKey: API_KEY, enabled: true })
  const projectRoot = path.join(root, 'project')
  const project = createProject({ name: 'Retrieval', rootPath: projectRoot })
  return { row, project, projectRoot }
}

/** 一次 Run 宿主（进程）。重启 = 丢掉它的内存状态，在同一份盘上再建一个。 */
function createHost({ project, projectRoot, row }, crash) {
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
  const transport = { networkTransport: 'app-fetch', execute: (payload) => runTask(payload, RUN_APPROVED_ADMISSION), fetchResult: (payload) => fetchTaskResult(payload) }
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

async function waitFor(condition, label) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const ACTION_LABELS = {
  'open-recoverable': 'generationCommon.observability.action.openRecoverable.main',
  retry: 'generationCommon.observability.action.retry.main',
  'view-task': 'generationCommon.observability.action.viewTask.main',
  reconcile: 'generationCommon.observability.action.reconcile.main',
  'open-model-access': 'generationCommon.observability.action.openModelAccess.main',
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
    if (isSubmitFailure) vendor.state.fault = cell.failure

    let submitted = null
    let submitError = null
    try { submitted = await host.submit(record) } catch (error) { submitError = error }
    if (isSubmitFailure) expect(submitError, 'submit should fail').toBeTruthy()
    else expect(submitError).toBeNull()
    expect(vendor.state.posts).toBe(1)

    if (crash) crash.armed = true
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
      host = createHost(prepared, crash)
      host.runs.recoverOrphans(prepared.project.id)
    }

    const settled = (job) => job?.status === cell.after.jobStatus
    await waitFor(() => settled(host.job(record)) || (cell.after.jobStatus === 'provider_accepted' && failed.threw), `job ${cell.after.jobStatus}`)
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
      await waitFor(() => host.run(record)?.status === 'completed', 'run completed by the observer')
    } else if (cell.button === 'none') {
      // 还在跑：没有主按钮，节点照旧转圈。状态好了就落地，窗口开着由渲染层查，关着由观察者查。
      expect(failed.threw).toBeNull()
      vendor.state.fault = null
      const getsBefore = vendor.state.gets
      if (cell.window === 'open') await host.poll(record)
      await waitFor(() => host.run(record)?.status === 'completed', 'run completed')
      expect(vendor.state.posts).toBe(cell.click.posts)
      expect(vendor.state.gets - getsBefore).toBeGreaterThanOrEqual(cell.click.minGets)
    } else {
      // 用户这时看到什么：关窗 / 重启后节点收敛成可找回面板；窗口开着查不到也落可找回；其余读真的错误卡。
      const onPanel = cell.window !== 'open' ? cell.taskId : Boolean(failed.threw)
      const message = submitError ? String(submitError.message ?? submitError) : failed.result?.error
      let button = onPanel ? 'panel-retrieve' : cardMainButton(message, cell.taskId ? job.providerTaskId : undefined)
      if (cell.button === 'SUBMIT_UNKNOWN') expect(button).not.toBe('retry')
      else expect(button).toBe(cell.button)

      if (crash) vendor.state.fault = null
      if (cell.failsAgain) {
        const getsBefore = vendor.state.gets
        await expect(clickMainButton(host, record, button)).resolves.toMatchObject({ kept: true })
        expect(vendor.state.gets, 'retrieving again really queried').toBeGreaterThan(getsBefore)
        expect(vendor.state.posts).toBe(1)
        // 这一次又没成：不是判死。停过的回到待取回（不能卡在轮询里，否则 ↑ 永远说还在生成）；窗口开着、从没停过的还在进行中。
        if (cell.after.awaitsRetrieval) expect(jobAwaitsRetrieval(host.job(record))).toBe(true)
        else expect(['provider_accepted', 'polling']).toContain(host.job(record).status)
        button = 'panel-retrieve'
      }

      vendor.state.fault = null
      const getsBefore = vendor.state.gets - (cell.failsAgain ? 1 : 0)
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
      await waitFor(() => host.run(record)?.status === 'completed', 'run completed')
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
    await waitFor(() => host.job('rec-old')?.status === 'needs_attention', 'attention')
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
    await waitFor(() => host.run('rec-old')?.status === 'completed', 'run completed')
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

describe('另一扇门：任务面板的「重新取回」（job.retry_retrieval）', () => {
  it('单镜也能用：放回轮询、观察者真去查、落地，POST 仍 1', async () => {
    const prepared = await prepareProject()
    const host = createHost(prepared)
    await host.submit('rec-panel')
    vendor.state.fault = 'query-5xx'
    host.runs.releaseSender(SENDER)
    await waitFor(() => host.job('rec-panel')?.status === 'needs_attention', 'attention')
    vendor.state.fault = null
    const getsBefore = vendor.state.gets
    const job = host.job('rec-panel')
    const run = host.run('rec-panel')
    await host.service.command(prepared.project.id, run.runId, { commandId: 'panel-retry', expectedRevision: run.revision, type: 'job.retry_retrieval', issuedAt: new Date().toISOString(), payload: { jobId: job.jobId } })
    await waitFor(() => host.job('rec-panel')?.status === 'ready', 'job ready')
    expect(vendor.state.gets).toBeGreaterThan(getsBefore)
    expect(vendor.state.posts).toBe(1)
  }, 60_000)
})
