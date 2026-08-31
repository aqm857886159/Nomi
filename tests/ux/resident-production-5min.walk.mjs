#!/usr/bin/env node
// Synthetic resident-production contract journey (zero quota).
//
// The text is entered through the real resident shell and travels through the
// real Host, semantic tools, ProductionRun, QA, Task Center, timeline and
// export owners.  The provider boundary is deliberately a local loopback:
// this proves orchestration and persisted effects, but it is NOT evidence that
// a real provider generated media.  The separately opt-in real canary is the
// only test allowed to make one paid provider request.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import {
  FIXTURE_API_KEY,
  FIXTURE_TEXT_MODEL,
  FIXTURE_VENDOR,
  flattenRequestText,
} from './agent-runtime-fixture.mjs'
import {
  createRuntimeWalk,
  readProject,
  recorded,
} from './agent-runtime-walk-support.mjs'

const require = createRequire(import.meta.url)
const GOAL = '帮我做一个5分钟品牌视频，剧本你决定，最终生成并导出'
const walk = await createRuntimeWalk('resident-production-5min', {
  syntheticCredentialStorage: true,
  apimartLoopback: true,
})

const catalogPath = path.join(walk.report.tempRoot, 'settings', 'model-catalog.json')
const defaultsPath = path.join(walk.report.tempRoot, 'settings', 'generation-model-defaults.json')
const policyPath = path.join(walk.report.tempRoot, 'settings', 'automation-policy.json')
const traceDir = path.join(walk.outputDir, 'trace')
fs.mkdirSync(traceDir, { recursive: true })

function writeProductionCatalog() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const now = new Date().toISOString()
  const fixtureVendor = catalog.vendors.find((vendor) => vendor.key === FIXTURE_VENDOR)
  if (!fixtureVendor) throw new Error('resident production fixture lost its loopback text vendor')
  // The resident conversation uses an auth-free loopback model.  APIMart is
  // kept inside its immutable direct-key scope; the guarded launch override
  // retargets only its HTTP requests to the in-process fixture.
  Object.assign(fixtureVendor, {
    enabled: true,
    authType: 'none',
    authHeader: null,
    authQueryParam: null,
    providerKind: 'openai-compatible',
    updatedAt: now,
  })
  const apimart = catalog.vendors.find((vendor) => vendor.key === 'apimart')
  if (!apimart) throw new Error('resident production fixture lost APIMart vendor')
  Object.assign(apimart, {
    enabled: true,
    baseUrlHint: 'https://api.apimart.ai',
    authType: 'bearer',
    authHeader: 'Authorization',
    authQueryParam: null,
    providerKind: 'openai-compatible',
    updatedAt: now,
  })
  // Startup owns the curated APIMart rows. Removing the copied fixture rows
  // here prevents an adapter marker or hand-written mapping from shadowing the
  // code-owned Seedance contract that the production provider checks.
  catalog.models = catalog.models.filter((model) => model.vendorKey !== 'apimart')
  catalog.mappings = catalog.mappings.filter((mapping) => mapping.vendorKey !== 'apimart')
  delete catalog.apiKeysByVendor.apimart
  // No stale plaintext secret should be needed for the auth-free chat seam.
  delete catalog.apiKeysByVendor[FIXTURE_VENDOR]
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  fs.writeFileSync(defaultsPath, `${JSON.stringify({
    schemaVersion: 1,
    byTaskKind: {
      text_to_video: { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0' },
      image_to_video: { vendorKey: 'apimart', modelKey: 'doubao-seedance-2.0' },
    },
  }, null, 2)}\n`, 'utf8')
  // The production fixture normally uses a zero-spend/one-attempt policy.
  // This walk opts into the isolated settings policy so the explicit QA
  // rework path can authorize one additional attempt; the APIMart transport is
  // still loopback and no provider account is charged.
  fs.writeFileSync(policyPath, `${JSON.stringify({
    schemaVersion: 1,
    mode: 'balanced',
    trustedHosts: ['nomi'],
    allowedProviders: ['apimart'],
    allowedModels: ['doubao-seedance-2.0'],
    maxSpend: 100,
    maxAttemptsPerJob: 2,
    confirmFirstSpend: true,
    autoContinueWithinBudget: true,
    confirmIrreversible: true,
    systemNotifications: false,
    notificationSound: false,
    notifyOnGate: false,
    notifyOnFailure: true,
    notifyOnCompletion: false,
    minimizeUploads: true,
    anonymousAssetHosting: 'ask',
  }, null, 2)}\n`, 'utf8')
}

function operationIdFromBody(body) {
  const seen = new Set()
  const visit = (value) => {
    if (typeof value === 'string') {
      try { return visit(JSON.parse(value)) } catch { return '' }
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return ''
    seen.add(value)
    if (typeof value.operationId === 'string' && value.operationId.trim()) return value.operationId.trim()
    if (value.operation && typeof value.operation === 'object') {
      const nested = visit(value.operation)
      if (nested) return nested
    }
    for (const child of Object.values(value)) {
      const nested = visit(child)
      if (nested) return nested
    }
    return ''
  }
  return visit(body)
}

function readHostSnapshot(tempRoot, project) {
  const immutable = project?.immutableProjectUuid
  const generation = project?.projectGeneration ?? 1
  if (!immutable) return null
  const dir = path.join(tempRoot, 'settings', 'project-agent-host', `project-agent.${immutable}.g${generation}`)
  const file = path.join(dir, 'snapshot-v1.json')
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8'))?.state ?? null } catch { return null }
}

function runFile(projectRoot, runId) {
  const file = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))?.run ?? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

async function waitForRun(win, projectId, runId, predicate, label, timeout = 300_000) {
  const deadline = Date.now() + timeout
  let last = null
  while (Date.now() < deadline) {
    last = await win.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { pid: projectId, rid: runId })
    if (last && predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label} timed out: ${JSON.stringify({
    status: last?.status,
    stageId: last?.stageId,
    stages: last?.stages?.map((stage) => [stage.stageId, stage.status]),
    jobs: last?.jobs?.map((job) => [job.jobId, job.status]),
  })}`)
}

function check(condition, label, details = '') {
  if (!condition) throw new Error(`${label}${details ? ` (${details})` : ''}`)
  console.log(`  ✓ ${label}${details ? ` · ${details}` : ''}`)
}

writeProductionCatalog()
const previousQaFlag = process.env.NOMI_E2E_PRODUCTION_QA_FAIL_ONCE
const previousPolicyFlag = process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY
process.env.NOMI_E2E_PRODUCTION_QA_FAIL_ONCE = '1'
process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY = '1'
let failure
let runId = ''
try {
  let { win } = await walk.start({ first: true })
  await win.setViewportSize({ width: 1440, height: 900 })
  // The model itself is a local text loopback.  APIMart is used only for the
  // semantic video provider, so the conversation never leaks the test key to
  // a real network endpoint.
  await win.evaluate(({ vendorKey, modelKey }) => {
    localStorage.setItem('nomi.assistantModel', JSON.stringify({ vendorKey, modelKey }))
  }, { vendorKey: FIXTURE_VENDOR, modelKey: FIXTURE_TEXT_MODEL })
  await win.reload({ waitUntil: 'domcontentloaded' })

  const apimartKey = await win.evaluate((apiKey) => window.nomiDesktop?.modelCatalog?.upsertVendorApiKey('apimart', { apiKey, enabled: true }), FIXTURE_API_KEY)
  check(apimartKey?.enabled === true, 'APIMart direct key is enabled through the isolated Settings path')
  // Curated APIMart rows intentionally ship without a price: production uses
  // the user's configured tariff.  This zero-quota walk supplies an explicit
  // test-only price through the same catalog mutation path so authorization
  // can be exercised without inventing a runtime price or touching the
  // provider/ProductionRun owners.
  const pricedSeedance = await win.evaluate(() => {
    const models = window.nomiDesktop?.modelCatalog?.listModels?.() || []
    const row = models.find((model) => model?.vendorKey === 'apimart' && model?.modelKey === 'doubao-seedance-2.0')
    if (!row) return null
    return window.nomiDesktop?.modelCatalog?.upsertModel?.({
      vendorKey: row.vendorKey,
      modelKey: row.modelKey,
      // The production retry policy reserves one authorization unit per
      // possible retry.  A synthetic ¥1 unit keeps that policy exercised while
      // the loopback provider still performs no paid network request.
      pricing: { cost: 1, enabled: true, specCosts: [] },
    })
  })
  check(pricedSeedance?.pricing?.enabled === true && pricedSeedance?.pricing?.cost === 1, 'synthetic lowest-cost Seedance price is explicit in the isolated catalog')
  const catalogAfterKey = await win.evaluate(() => window.nomiDesktop?.modelCatalog?.health?.())
  check(Boolean(catalogAfterKey), 'model catalog health is available before the production task')

  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  const baselineProject = await readProject(win, projectId)
  const baselineRevision = Number(baselineProject?.revision ?? baselineProject?.payload?.revision ?? 0)
  await expect.poll(async () => Number((await readProject(win, projectId))?.revision ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(baselineRevision)

  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '打开生成工作区')
  const resident = win.locator('[data-agent-resident][data-agent-surface="generation"]')
  await resident.waitFor({ state: 'visible', timeout: 30_000 })
  const collapsed = resident.locator('[data-agent-resident-collapsed="true"]')
  if (await collapsed.isVisible().catch(() => false)) await clickOrFail(collapsed, '展开生成 Agent')
  await expect(resident.locator('[data-agent-composer] textarea')).toBeVisible()

  const createId = 'resident-5m-create-1'
  const previewId = 'resident-5m-preview-1'
  const gateId = 'resident-5m-gate-1'
  let operationId = ''
  const createRequest = walk.fixture.expectText({
    label: 'resident 5-minute natural-language create',
    match: (body) => flattenRequestText(body).includes(GOAL) && !body.messages?.some((message) => message.role === 'tool'),
    reply: {
      type: 'tool', id: createId, name: 'nomi_operation_create',
      args: {
        prompt: GOAL,
        taskKind: 'text_to_video',
        parameters: { size: '16:9', resolution: '480p', generate_audio: false },
      },
    },
  })
  const previewRequest = walk.fixture.expectText({
    label: 'resident 5-minute plan preview',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === createId),
    reply: (body) => {
      operationId = operationIdFromBody(body)
      if (!operationId) throw new Error('semantic create result did not expose an operation id')
      return { type: 'tool', id: previewId, name: 'nomi_preview_execution', args: { operationId } }
    },
  })
  const gateRequest = walk.fixture.expectText({
    label: 'resident 5-minute generation gate',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === previewId),
    reply: (body) => {
      operationId = operationIdFromBody(body) || operationId
      if (!operationId) throw new Error('semantic preview result did not retain an operation id')
      return { type: 'tool', id: gateId, name: 'nomi_request_generation_gate', args: { operationId } }
    },
  })
  const finalRequest = walk.fixture.expectText({
    label: 'resident 5-minute gate receipt response',
    match: (body) => body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === gateId),
    reply: { type: 'text', text: '本地演练已完成五分钟粗剪，任务中心等待你审阅后导出。' },
  })

  const input = resident.locator('[data-agent-composer] textarea')
  await input.fill(GOAL)
  await clickOrFail(resident.locator('[data-agent-send]'), '发送五分钟品牌视频任务')
  await recorded(createRequest.received, 'resident 5-minute create request')
  await recorded(previewRequest.received, 'resident 5-minute preview request')
  // `createGenerationDraft` intentionally scopes only provider/model allowlists;
  // retry ceilings are a user automation-policy setting.  Refresh that setting
  // through the real ProductionRun command before the gate is sealed, so this
  // isolated walk exercises the approved two-attempt rework contract rather
  // than mutating the repository or bypassing its policy resolver.
  const refreshedPolicy = await win.evaluate(async ({ pid, rid }) => {
    const bridge = window.nomiDesktop?.productionRuns
    const current = await bridge?.read(pid, rid)
    if (!bridge || !current) return null
    return bridge.command(pid, rid, {
      commandId: `resident-5m-policy-refresh-${rid}`,
      expectedRevision: current.revision,
      type: 'policy.refresh',
      payload: {},
      issuedAt: new Date().toISOString(),
    })
  }, { pid: projectId, rid: operationId })
  check(refreshedPolicy?.run?.policy?.maxAttemptsPerJob === 2, 'isolated automation policy allows one explicit rework attempt')
  await recorded(gateRequest.received, 'resident 5-minute gate request')

  const gateCard = win.locator('div.fixed.inset-0:visible').filter({ hasText: '允许 Nomi 生成这一批镜头' }).last()
  await gateCard.waitFor({ state: 'visible', timeout: 30_000 })
  check(await gateCard.locator('[data-production-shot-row]').count() === 20, 'generation gate exposes all 20 planned shots')
  check((await gateCard.innerText()).includes('确认生成 20 镜'), 'generation gate keeps the batch action explicit and compact')
  await walk.snap('resident-5m-gate')
  await clickOrFail(gateCard.locator('[data-production-action="confirm"]'), '确认五分钟视频生成')
  await recorded(finalRequest.received, 'resident 5-minute gate receipt response')
  await expect(resident).toContainText('本地演练已完成五分钟粗剪')

  check(Boolean(operationId), 'Host tool sequence yields a durable operation id', operationId)
  const roughRun = await waitForRun(win, projectId, operationId, (run) => run.status === 'awaiting_rough_cut_review', 'semantic production through QA and assembly')
  runId = operationId
  check(roughRun.stages?.length === 4, 'ProductionRun owns generate, QA, assemble and export stages')
  check(roughRun.generationPlan?.shots?.length === 20, 'natural-language planner expands five minutes into 20 shots')
  const durations = roughRun.generationPlan.shots.map((shot) => Number(shot.candidate?.parameters?.duration ?? 0))
  check(durations.every((duration) => duration === 15) && durations.reduce((sum, duration) => sum + duration, 0) === 300, 'storyboard freezes 15-second clips covering 300 seconds')
  // The first QA pass is intentionally fail-once.  ProductionRun keeps the
  // initial twenty reservations, so the automatic retry planner has no
  // remaining envelope in this zero-quota walk.  We therefore exercise the
  // user-visible, explicit `productionRuns.rework` path below; this is the
  // same real re-authorization/receipt/scheduler path used in production and
  // keeps the original attempt inspectable.
  const initialGenerateJobs = roughRun.jobs?.filter((job) => job.stageId === 'generate') ?? []
  check(initialGenerateJobs.length === 20, 'initial ProductionRun keeps exactly 20 planned generation jobs')
  check(initialGenerateJobs.every((job) => job.status === 'adopted'), 'all initial jobs are adopted before targeted rework')
  const qaStageBeforeRework = roughRun.stages?.find((stage) => stage.stageId === 'qa')
  check(qaStageBeforeRework?.status === 'completed', 'QA records a completed fail-once review before explicit rework')
  check(String(qaStageBeforeRework?.qaSummary ?? '').includes('1 镜红标'), 'QA summary exposes the deterministic continuity failure')
  const failedShotJob = initialGenerateJobs.find((job) => job.metadata?.shotId === 'shot-1')
  check(Boolean(failedShotJob?.jobId), 'QA failure maps to the durable shot-1 job')
  check(roughRun.artifacts?.some((artifact) => artifact.kind === 'timeline'), 'timeline artifact is durable before rough-cut review')
  check(roughRun.gates?.some((gate) => gate.scope === 'export' && gate.status === 'waiting'), 'export remains a separate explicit gate')
  check(Number(roughRun.budget?.authorized) >= 20 && roughRun.budget?.actual === 0 && roughRun.budget?.unsettled === 0, 'fixture reports truthful zero spend with a synthetic lowest-cost authorization')
  const initialVideoSubmissions = walk.fixture.videos.filter((record) => record.path === '/v1/videos/generations')
  check(initialVideoSubmissions.length === 20, 'loopback observes one provider submission per initial shot')

  // Explicit single-shot rework: invoke the real preload bridge while the
  // modal is pending, then approve the fresh authorization on the same
  // confirmation surface.  Do not call the repository or scheduler directly.
  const reworkPromise = win.evaluate(({ pid, rid }) =>
    window.nomiDesktop?.productionRuns?.rework(pid, rid, 'shot-1'),
    { pid: projectId, rid: operationId },
  )
  const reworkDialog = win.locator('div.fixed.inset-0:visible')
    .filter({ hasText: '允许 Nomi 生成这一镜？' }).last()
  await reworkDialog.waitFor({ state: 'visible', timeout: 30_000 })
  check((await reworkDialog.innerText()).includes('doubao-seedance-2.0') || (await reworkDialog.innerText()).includes('Seedance'), 'targeted rework gate names the frozen video model')
  await walk.snap('resident-5m-rework-gate')
  await clickOrFail(reworkDialog.getByRole('button', { name: '确认生成', exact: true }), '确认 shot-1 定点重试')
  const reworkResult = await recorded(reworkPromise, 'resident shot-1 production rework')
  check(reworkResult?.ok === true && reworkResult?.code === 'reworked', 'productionRuns.rework returns the approved rework result')

  await expect.poll(() => walk.fixture.videos.filter((record) => record.path === '/v1/videos/generations').length, { timeout: 60_000 }).toBe(21)
  const reworkedRun = await waitForRun(win, projectId, operationId, (run) => {
    const retry = run.jobs?.find((job) => job.metadata?.shotId === 'shot-1' && job.retryCount === 1)
    return Boolean(retry && ['ready', 'adopted'].includes(retry.status) && run.stages?.some((stage) => stage.stageId === 'assemble' && stage.status === 'completed'))
  }, 'targeted shot-1 retry and re-assembly')
  const retryJobs = reworkedRun.jobs?.filter((job) => job.stageId === 'generate' && job.metadata?.shotId === 'shot-1') ?? []
  const retryJob = retryJobs.find((job) => job.retryCount === 1)
  check(reworkedRun.jobs?.filter((job) => job.stageId === 'generate').length === 21, 'targeted rework adds exactly one generation job')
  check(Boolean(retryJob?.parentJobId && retryJob.parentJobId === failedShotJob?.jobId), 'retry job retains shot-1 parent identity')
  check(retryJob?.retryReason === 'rework' && retryJob?.attempt === 2, 'retry job records explicit rework reason and attempt 2')
  check(retryJobs.some((job) => job.jobId === failedShotJob?.jobId), 'original shot-1 job remains available for version history')
  check(reworkedRun.jobs?.filter((job) => job.stageId === 'generate').every((job) => ['adopted', 'ready'].includes(job.status)), 'all original and retry jobs are materialized before final assembly')
  check(reworkedRun.stages?.find((stage) => stage.stageId === 'qa')?.status === 'completed', 'QA evidence remains durable after targeted rework')
  check(reworkedRun.artifacts?.filter((artifact) => artifact.kind === 'video' && retryJobs.some((job) => job.jobId === artifact.jobId)).length >= 2, 'shot-1 keeps both original and reworked video artifacts')
  check(reworkedRun.artifacts?.some((artifact) => artifact.kind === 'timeline'), 'timeline artifact is regenerated from the reworked job set')
  check(reworkedRun.gates?.some((gate) => gate.scope === 'export' && gate.status === 'waiting'), 'export gate remains explicit after rework')
  check(reworkedRun.budget?.actual === 0 && reworkedRun.budget?.unsettled === 0, 'targeted retry remains truthful zero actual/unsettled spend')
  check(new Set(walk.fixture.videos.filter((record) => record.path === '/v1/videos/generations').map((record) => record.body?.data?.[0]?.task_id ?? '')).size === 21, 'each initial/rework submission receives a unique provider task id')
  check(new Set(walk.fixture.taskQueries.map((record) => record.path)).size >= 21, 'every provider receipt is queried without duplicate task ids')

  const qaEvents = roughRun.snapshotCursor ? await win.evaluate(({ pid, rid }) => window.nomiDesktop?.productionRuns?.events?.(pid, rid), { pid: projectId, rid: operationId }).catch(() => []) : []
  const serializedRun = JSON.stringify(reworkedRun)
  check(serializedRun.includes('定向重滚') || serializedRun.includes('continuity') || serializedRun.includes('retry'), 'ProductionRun keeps durable QA/retry evidence')

  const projectAfterRough = await readProject(win, projectId)
  const hostState = readHostSnapshot(walk.report.tempRoot, projectAfterRough)
  const hostSerialized = JSON.stringify(hostState ?? {})
  check(Boolean(hostState), 'Host snapshot is persisted for the resident thread')
  check(hostSerialized.includes(operationId) || hostSerialized.includes(createId), 'Host history correlates the tool sequence with the ProductionRun')
  check(Number(projectAfterRough?.revision ?? 0) > baselineRevision, 'domain owner revision advances after the real production task')
  fs.writeFileSync(path.join(traceDir, 'host.json'), JSON.stringify(hostState, null, 2), 'utf8')
  fs.writeFileSync(path.join(traceDir, 'run-rough.json'), JSON.stringify(reworkedRun, null, 2), 'utf8')

  const taskPanel = win.locator('[data-nomi-right-panel="tasks"]')
  if (!(await taskPanel.isVisible().catch(() => false))) await clickOrFail(win.locator('[data-task-center-trigger="true"]'), '打开任务中心')
  await taskPanel.waitFor({ state: 'visible', timeout: 15_000 })
  const card = taskPanel.locator('[data-production-task-card]').first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  const cover = card.locator('[data-production-preview-open]')
  await cover.waitFor({ state: 'visible', timeout: 15_000 })
  await cover.click()
  await expect(card.locator('[data-production-preview] video')).toHaveCount(1)
  await walk.snap('resident-5m-rough-cut')
  await clickOrFail(card.locator('[data-production-primary-action]'), '审阅五分钟粗剪')
  const roughDialog = win.locator('[data-confirm-dialog-surface="confirm"]:visible')
  await roughDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await clickOrFail(roughDialog.locator('[data-confirm-dialog-confirm="true"]'), '批准粗剪并进入导出')
  await waitForRun(win, projectId, operationId, (run) => run.status === 'awaiting_export', 'rough-cut approval')

  if (!(await taskPanel.isVisible().catch(() => false))) await clickOrFail(win.locator('[data-task-center-trigger="true"]'), '重新打开任务中心')
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await clickOrFail(card.locator('[data-production-primary-action]'), '打开导出审批')
  const exportDialog = win.locator('div.fixed.inset-0:visible').filter({ hasText: '审看粗剪并批准导出' }).last()
  await exportDialog.waitFor({ state: 'visible', timeout: 15_000 })
  await clickOrFail(exportDialog.getByRole('button', { name: '批准并继续', exact: true }), '批准 MP4 导出')
  const completed = await waitForRun(win, projectId, operationId, (run) => run.status === 'completed', 'final export')
  check(completed.stages?.every((stage) => stage.status === 'completed'), 'all four ProductionRun stages complete')
  const exportArtifact = completed.artifacts?.find((artifact) => artifact.kind === 'export' && artifact.projectRelativePath)
  check(Boolean(exportArtifact), 'completed Run exposes a durable export artifact')
  const exportPath = exportArtifact ? path.join(projectRoot, exportArtifact.projectRelativePath) : ''
  check(Boolean(exportPath && fs.existsSync(exportPath)), 'export artifact exists in the project owner')
  if (exportPath && fs.existsSync(exportPath)) {
    const ffprobe = require('@ffprobe-installer/ffprobe').path
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath], { encoding: 'utf8' }))
    check(Number(probe.format?.duration) > 0, 'final MP4 has positive duration')
    check(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'), 'final MP4 has H.264 video')
    check(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'), 'final MP4 has AAC audio')
  }
  await walk.snap('resident-5m-completed')
  walk.report.runId = operationId
  walk.report.verified = [
    'natural-language-to-storyboard',
    'Host-to-ProductionRun',
    'QA-fail-once-targeted-retry',
    'timeline-and-export-owner',
    'synthetic-loopback-provider-receipts-only',
  ]
} catch (error) {
  failure = error
  console.error(error?.stack || error)
  process.exitCode = 1
} finally {
  if (previousQaFlag === undefined) delete process.env.NOMI_E2E_PRODUCTION_QA_FAIL_ONCE
  else process.env.NOMI_E2E_PRODUCTION_QA_FAIL_ONCE = previousQaFlag
  if (previousPolicyFlag === undefined) delete process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY
  else process.env.NOMI_E2E_PRODUCTION_MISSING_POLICY = previousPolicyFlag
  await walk.finish(failure)
}
