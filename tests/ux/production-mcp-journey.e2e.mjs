// Real built Electron + real MCP stdio Production Run journey. No provider calls: the fixture is
// double-gated and disabled in packaged builds. This test owns all four GUI approvals and proves
// durable restart recovery, safe MCP projections, preview authorization, and a valid final MP4.
//
// Transport framing (spawn / initialize / rpc / callTool / terminate) lives in the ONE shared module
// _mcpJourney.mjs — this sibling and J-MCP1 (mcp-journey.e2e.mjs) both drive it, so there is a single
// spawn/JSON-RPC implementation (P1: no copy-paste). Differences from J-MCP1 are passed as options:
// the io.modelcontextprotocol/ui client capability + Codex clientInfo, and the production fixture env.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot, spawnMcpStdioClient } from './_mcpJourney.mjs'

const require = createRequire(import.meta.url)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-mcp-e2e-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-mcp')
// Append-only observer trace. The human simulator writes decisions here; the main
// observer reads the same file at the end and validates that every gate was crossed
// by a user action. It never writes artifacts or edits the ProductionRun snapshot.
const trajectoryPath = process.env.NOMI_TRAJECTORY_OUT
  ? path.resolve(process.env.NOMI_TRAJECTORY_OUT)
  : path.join(tempRoot, 'trajectory.jsonl')
let trajectorySeq = 0
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })
fs.mkdirSync(path.dirname(trajectoryPath), { recursive: true })

function appendTrajectory(entry) {
  trajectorySeq += 1
  fs.appendFileSync(trajectoryPath, `${JSON.stringify({
    seq: trajectorySeq,
    at: new Date().toISOString(),
    ...entry,
  })}\n`, 'utf8')
}

function readTrajectory() {
  return fs.readFileSync(trajectoryPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function safeTraceValue(value) {
  if (Array.isArray(value)) return value.map(safeTraceValue)
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (/key|secret|token|authorization|providerUrl|rawPrompt|idempotency/i.test(key)) continue
    result[key] = safeTraceValue(child)
  }
  return result
}

// Isolation env + client identity the shared spawner needs to reproduce this sibling's transport exactly:
// the production fixture flag (double-gated, never calls a provider) and Codex's UI-extension capability.
const mcpDirs = { settingsDir: userDataDir, userDataDir, projectsDir, capabilityDir }
const mcpEnv = { NOMI_E2E_PRODUCTION_FIXTURE: '1' }
const mcpClientInfo = { name: 'OpenAI Codex', version: 'e2e' }
const mcpCapabilities = {
  elicitation: {},
  extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
}
const externalAgentOnly = process.env.NOMI_EXTERNAL_AGENT_ONLY === '1'
const normalApprovalControls = new Set([
  'direction-choice', 'direction-approve', 'approve-script', 'approve-storyboard',
  'materialize-confirm', 'contract-approve', 'sample-approve', 'rough-cut-approve', 'export-approve', 'rough-cut-and-export',
])

function isNormalApprovalControl(control) {
  return normalApprovalControls.has(control) || /^shot-\d+-approve$/.test(String(control || ''))
}

const launchGuiOptions = {
  name: 'production-mcp-journey',
  userDataDir,
  settingsDir: userDataDir,
  projectsDir,
  env: {
    NOMI_E2E_PRODUCTION_FIXTURE: '1',
    NOMI_CAPABILITY_DIR: capabilityDir,
  },
}

let passed = 0
let activeRunId = ''
function check(condition, label) {
  if (!condition) throw new Error(`PRODUCTION MCP E2E FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function launchGui() {
  const { app, win: window } = await launchNomiApp(launchGuiOptions)
  await window.setViewportSize({ width: 1440, height: 900 })
  return { app, window }
}

async function initializeMcp() {
  let response = null
  for (let attempt = 0; attempt < 20 && !response; attempt += 1) {
    try { response = await mcp.initialize(4_000) } catch { await delay(500) }
  }
  check(Boolean(response?.result), 'real MCP stdio initialize handshake succeeds')
}

// Tool calls in this journey use the strict shape (throw on JSON-RPC OR tool-level isError) with the
// sibling's original 40s ceiling, so any failure aborts rather than flowing a bad result forward.
const callTool = async (name, args) => {
  const startedAt = Date.now()
  const result = await mcp.callToolOrThrow(name, args, { timeoutMs: 40_000 })
  const runData = result?.structuredContent?.nomiRunData
  appendTrajectory({
    actor: 'main-observer',
    surface: 'mcp-stdio',
    action: name,
    request: safeTraceValue(args),
    resultSource: 'production-run-service',
    outcome: 'accepted',
    durationMs: Date.now() - startedAt,
    after: runData ? {
      runId: runData.runId,
      status: runData.status,
      revision: runData.revision,
      eventCursor: runData.snapshotCursor,
      artifactKinds: Array.isArray(runData.artifacts) ? runData.artifacts.map((artifact) => artifact.kind) : undefined,
    } : undefined,
  })
  return result
}

async function getRunData(projectId, runId) {
  const result = await callTool('nomi_get_run', { projectId, runId })
  return result.structuredContent?.nomiRunData
}

async function recordHumanDecision({ projectId, runId, action, control, decision, before, evidence = [] }) {
  const isGuiApproval = control === 'direction-choice'
    || control === 'direction-approve'
    || control === 'contract-approve'
    || control === 'sample-approve'
    || control === 'rough-cut-approve'
    || control === 'export-approve'
    || /^shot-\d+-approve$/.test(String(control || ''))
  const after = runId ? await getRunData(projectId, runId) : undefined
  appendTrajectory({
    actor: 'human-simulator',
    surface: isGuiApproval ? 'desktop-click' : 'mcp-tool-call',
    action,
    control,
    projectId,
    ...(runId ? { runId } : {}),
    before: before ? {
      status: before.status,
      revision: before.revision,
      eventCursor: before.snapshotCursor,
    } : undefined,
    decision,
    after: after ? {
      status: after.status,
      revision: after.revision,
      eventCursor: after.snapshotCursor,
    } : undefined,
    evidence,
    reason: '子 agent 模拟用户点击/确认；主 agent 只记录结果',
  })
  return after
}

async function waitForRunStatus(projectId, runId, expected, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let run = null
  while (Date.now() < deadline) {
    run = await getRunData(projectId, runId)
    if (run?.status === expected) return run
    await delay(250)
  }
  throw new Error(`Run ${runId} did not reach ${expected}; last=${JSON.stringify({ status: run?.status, stageId: run?.stageId, stages: run?.stages?.map((stage) => [stage.stageId, stage.status]), jobs: run?.jobs?.map((job) => [job.jobId, job.status]), gates: run?.gates?.map((gate) => [gate.gateId, gate.status]) })}`)
}

async function waitForWaitingGate(projectId, runId, gateIdPrefix, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const run = await getRunData(projectId, runId)
    if (run?.gates?.some((gate) => gate.gateId.startsWith(gateIdPrefix) && gate.status === 'waiting')) return run
    await delay(250)
  }
  throw new Error(`Run ${runId} did not raise a waiting gate ${gateIdPrefix}*`)
}

/**
 * 制作任务的家 = 任务中心（不再跳去画布助手面板）。打开顶栏任务 → 卡就地长在里面。
 * 走查证据：shotName 传了就截图，人眼判断卡的状态/产物/指路是否成立（R13）。
 */
async function openRunFromTaskCenter(window, shotName) {
  const panel = window.locator('[data-nomi-right-panel="tasks"]')
  if (!(await panel.isVisible().catch(() => false))) {
    await window.locator('[data-task-center-trigger="true"]').click()
  }
  await window.locator('[data-production-task-card]').waitFor({ timeout: 10_000 })
  await window.locator('[data-production-status-title]').waitFor({ timeout: 10_000 })
  // 面板有 140ms pop 动画：不等落定就截图会拍到半透明重影，证据不可读。
  if (shotName) {
    await window.waitForTimeout(260)
    await window.screenshot({ path: path.join(shotsDir, shotName) })
  }
}

async function approveCurrentProductionGate(window, { projectId, runId, control }) {
  const before = await getRunData(projectId, runId)
  await openRunFromTaskCenter(window)
  await window.locator('[data-production-primary-action]').first().click()
  const overlay = window.locator('.fixed.inset-0').filter({ has: window.locator('button') }).last()
  await overlay.waitFor({ timeout: 5_000 })
  await overlay.locator('button').last().click()
  await recordHumanDecision({
    projectId,
    runId,
    action: 'production-gate-confirm',
    control,
    decision: 'approved',
    before,
  })
}

function projectRootFor(projectId) {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(projectsDir, entry.name)
    const descriptor = path.join(root, '.nomi', 'project.json')
    try {
      if (JSON.parse(fs.readFileSync(descriptor, 'utf8')).id === projectId) return root
    } catch {
      // Ignore unrelated directories.
    }
  }
  return null
}

let gui = null
let mcp = null
let exitCode = 0
try {
  gui = await launchGui()
  const window = gui.window
  await window.getByText('新建空白项目', { exact: false }).first().click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  const projectId = await window.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  check(Boolean(projectId), 'isolated local project opens in built Nomi')

  mcp = spawnMcpStdioClient({ ...mcpDirs, clientInfo: mcpClientInfo, capabilities: mcpCapabilities, env: mcpEnv })
  await initializeMcp()
  const tools = (await mcp.rpc('tools/list', {}, 20_000)).result?.tools || []
  // The production review protocol exposes proposal + gate tools as
  // first-class MCP surfaces. Keep the catalog count explicit so an omitted
  // or accidental extra tool is visible in this black-box contract.
  check(tools.length === 27, 'real MCP stdio exposes the exact 27-tool catalog')
  for (const name of [
    'nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact',
    'nomi_read_artifact', 'nomi_review_artifact', 'nomi_materialize_storyboard', 'nomi_approve_rough_cut',
  ]) {
    check(tools.some((tool) => tool.name === name), `${name} is registered over real stdio`)
  }

  const resources = (await mcp.rpc('resources/list', {}, 20_000)).result?.resources || []
  const directorResource = resources.find((resource) => resource.uri === 'nomi-skill://director-cinematography')
  check(Boolean(directorResource), 'director cinematography skill is discoverable through MCP resources')
  const director = (await mcp.rpc('resources/read', { uri: directorResource.uri }, 20_000)).result?.contents?.[0]?.text || ''
  check(director.includes('镜头语言') && director.length > 1_000, 'director skill body can be loaded progressively over MCP')

  const started = await callTool('nomi_start_playbook', {
    projectId,
    playbook: 'brand.promo',
    trustLevel: 'confirm_all',
    brief: {
      goal: 'Create a truthful local-first Nomi product promo fixture.',
      audience: 'AI creators',
      channel: 'product demo',
      durationSeconds: 60,
      sellingPoints: ['Local project data', 'Bring any API', 'Codex and Claude Code over MCP', 'Open source'],
    },
  })
  const runId = started.structuredContent?.nomiRunData?.runId
  activeRunId = runId
  check(Boolean(runId), 'MCP creates a durable Production Run without approving spend')
  check(started.structuredContent.nomiRunData.budget.authorized === 0, 'draft has zero authorized spend')
  appendTrajectory({
    actor: 'main-observer',
    surface: 'mcp-stdio',
    action: 'nomi_start_playbook',
    projectId,
    runId,
    after: { status: started.structuredContent.nomiRunData.status, budgetAuthorized: started.structuredContent.nomiRunData.budget.authorized },
    outcome: 'accepted',
  })

  await openRunFromTaskCenter(window, '00-task-center.png')
  check((await window.locator('[data-production-status-title]').textContent())?.length > 0, 'Task Center hosts the run card itself (no hop to the assistant panel)')
  check(await window.locator('[data-nomi-right-panel="tasks"] [data-production-task-card]').count() === 1, 'the production card lives inside the Task Center panel')
  check(await window.locator('.generation-canvas-v2-assistant [data-production-task-card]').count() === 0, 'the canvas assistant panel no longer hosts production controls')
  await window.screenshot({ path: path.join(shotsDir, '01-direction-gate.png') })

  // B1/B5 方向门三选一：外部 Agent 先通过 MCP 提交候选，随后子 Agent
  // 只读取安全投影并作一次用户决策。Nomi-origin 的旧 fixture 仍保留
  // 内部候选作为 GUI 回归；external-only 必须显式提供候选 JSON。
  if (externalAgentOnly) {
    const candidateText = String(process.env.NOMI_DIRECTION_CANDIDATES_JSON || '').trim()
    if (!candidateText) throw new Error('NOMI_DIRECTION_CANDIDATES_JSON is required when NOMI_EXTERNAL_AGENT_ONLY=1')
    let candidates
    try { candidates = JSON.parse(candidateText) } catch { throw new Error('NOMI_DIRECTION_CANDIDATES_JSON must be valid JSON when NOMI_EXTERNAL_AGENT_ONLY=1') }
    await callTool('nomi_propose_directions', { projectId, runId, candidates })
  }
  const atDirection = (await callTool('nomi_get_run', { projectId, runId })).structuredContent.nomiRunData
  const directionGate = atDirection.gates.find((gate) => gate.gateId === 'gate-direction-v1')
  check(directionGate?.directionCandidates?.length === 3, 'direction gate projects three LLM-planned candidates over MCP')
  check(externalAgentOnly
    ? directionGate.directionCandidates.every((candidate) => typeof candidate.key === 'string' && candidate.key.length > 0)
    : directionGate.directionCandidates.some((candidate) => candidate.key === 'kinetic'), 'candidate keys survive the safe projection')
  let run
  const selectedDirection = directionGate.directionCandidates.find((candidate) => candidate.key === 'kinetic') || directionGate.directionCandidates[0]
  if (externalAgentOnly) {
    // External Agent path: the MCP result is the only direction UI. Read the
    // candidate key, submit one elicited gate decision, and leave Nomi's panel
    // as a read-only progress surface—no candidate/confirm DOM click.
    appendTrajectory({
      actor: 'human-simulator',
      surface: 'mcp-elicitation',
      action: 'direction-choice',
      control: 'direction-choice',
      projectId,
      runId,
      decision: { choiceKey: selectedDirection.key },
      before: { status: atDirection.status, revision: atDirection.revision, eventCursor: atDirection.snapshotCursor },
      reason: '子 agent 从 MCP 返回的 directionCandidates 选择方向，不点击 Nomi 方向卡',
    })
    await callTool('nomi_decide_gate', {
      projectId,
      runId,
      gateId: directionGate.gateId,
      decision: 'approved',
      choiceKey: selectedDirection.key,
    })
    const afterDirection = await getRunData(projectId, runId)
    appendTrajectory({
      actor: 'human-simulator',
      surface: 'mcp-elicitation',
      action: 'direction-gate-confirm',
      control: 'direction-approve',
      projectId,
      runId,
      decision: { choiceKey: selectedDirection.key, status: 'approved' },
      before: { status: atDirection.status, revision: atDirection.revision, eventCursor: atDirection.snapshotCursor },
      after: { status: afterDirection.status, revision: afterDirection.revision, eventCursor: afterDirection.snapshotCursor },
      reason: 'MCP elicitation 已确认方向，不走 Nomi DOM 审批',
    })
    const externalScriptContent = String(process.env.NOMI_SCRIPT_CONTENT || '').trim()
    if (!externalScriptContent) throw new Error('NOMI_SCRIPT_CONTENT is required when NOMI_EXTERNAL_AGENT_ONLY=1')
    const candidateRun = await getRunData(projectId, runId)
    if (!candidateRun.artifacts.some((artifact) => artifact.kind === 'script' && artifact.status === 'candidate')) {
      await callTool('nomi_propose_script', { projectId, runId, content: externalScriptContent })
    }
    run = await waitForRunStatus(projectId, runId, 'awaiting_script_review')
  } else {
    await window.locator('[data-production-primary-action]').click()
    const candidateRows = window.locator('[data-direction-candidate]')
    await candidateRows.first().waitFor({ timeout: 5_000 })
    check(await candidateRows.count() === 3, 'direction dialog renders all three candidates')
    await window.locator('[data-direction-candidate="kinetic"]').click()
    check(await window.locator('[data-direction-candidate="kinetic"]').getAttribute('data-direction-selected') === 'true', 'clicking a candidate selects it')
    appendTrajectory({
      actor: 'human-simulator',
      surface: 'desktop-click',
      action: 'direction-candidate-select',
      control: 'direction-choice',
      projectId,
      runId,
      decision: { choiceKey: 'kinetic' },
      before: { status: atDirection.status, revision: atDirection.revision, eventCursor: atDirection.snapshotCursor },
      reason: '子 agent 选择 MCP 返回的方向候选，不自行写方向文本',
    })
    // 选择稳定性：600ms 后选中不得被任何重渲染/轮询重置回默认（验收抓到的视觉回落疑点）。
    await window.waitForTimeout(600)
    check(await window.locator('[data-direction-candidate="kinetic"]').getAttribute('data-direction-selected') === 'true', 'selection survives re-renders (no reset to first candidate)')
    await window.screenshot({ path: path.join(shotsDir, '01a-direction-candidates.png') })
    const directionOverlay = window.locator('.fixed.inset-0').filter({ has: window.locator('button') }).last()
    const beforeDirectionApprove = await getRunData(projectId, runId)
    await directionOverlay.locator('button').last().click()
    run = await waitForRunStatus(projectId, runId, 'awaiting_script_review')
    await recordHumanDecision({
      projectId,
      runId,
      action: 'direction-gate-confirm',
      control: 'direction-approve',
      decision: { choiceKey: 'kinetic', status: 'approved' },
      before: beforeDirectionApprove,
    })
  }
  const decidedDirection = run.gates.find((gate) => gate.gateId === 'gate-direction-v1')
  check(decidedDirection?.decidedChoiceKey === selectedDirection.key, 'approval records the chosen direction as decidedChoiceKey')
  const scriptArtifact = run.artifacts.find((artifact) => artifact.kind === 'script')
  check(Boolean(scriptArtifact) && !run.artifacts.some((artifact) => artifact.kind === 'storyboard'), 'direction approval produces a durable script candidate before any storyboard')
  const scriptBeforeReview = run
  await callTool('nomi_review_artifact', {
    projectId,
    runId,
    artifactId: scriptArtifact.artifactId,
    expectedVersion: scriptArtifact.version || 1,
    decision: 'approved',
  })
  run = externalAgentOnly
    ? await waitForRunStatus(projectId, runId, 'running')
    : await waitForRunStatus(projectId, runId, 'awaiting_storyboard_review')
  await recordHumanDecision({
    projectId,
    runId,
    action: 'script-review',
    control: 'approve-script',
    decision: 'approved',
    before: scriptBeforeReview,
    evidence: [`nomi://project/${projectId}/run/${runId}/artifact/${scriptArtifact.artifactId}`],
  })
  if (externalAgentOnly) {
    const storyboardPlanText = String(process.env.NOMI_STORYBOARD_PLAN_JSON || '').trim()
    if (!storyboardPlanText) throw new Error('NOMI_STORYBOARD_PLAN_JSON is required when NOMI_EXTERNAL_AGENT_ONLY=1')
    let storyboardPlan
    try { storyboardPlan = JSON.parse(storyboardPlanText) } catch { throw new Error('NOMI_STORYBOARD_PLAN_JSON must be valid JSON when NOMI_EXTERNAL_AGENT_ONLY=1') }
    await callTool('nomi_propose_storyboard', { projectId, runId, plan: storyboardPlan })
    run = await waitForRunStatus(projectId, runId, 'awaiting_storyboard_review')
  }
  check(run.artifacts.some((artifact) => artifact.kind === 'storyboard'), 'script approval produces the durable storyboard candidate')
  const events = await callTool('nomi_subscribe_run', { projectId, runId, afterCursor: 0, waitMs: 0 })
  check(events.structuredContent?.nomiRunData?.events?.some((event) => event.type === 'skill.loaded'), 'MCP event stream exposes durable skill evidence')

  const storyboardArtifact = run.artifacts.find((artifact) => artifact.kind === 'storyboard')
  const storyboardBeforeReview = run
  await callTool('nomi_review_artifact', {
    projectId,
    runId,
    artifactId: storyboardArtifact.artifactId,
    expectedVersion: storyboardArtifact.version || 1,
    decision: 'approved',
  })
  await recordHumanDecision({
    projectId,
    runId,
    action: 'storyboard-review',
    control: 'approve-storyboard',
    decision: 'approved',
    before: storyboardBeforeReview,
    evidence: [`nomi://project/${projectId}/run/${runId}/artifact/${storyboardArtifact.artifactId}`],
  })
  const materializeBefore = await getRunData(projectId, runId)
  const materialized = await callTool('nomi_materialize_storyboard', {
    projectId,
    runId,
    artifactId: storyboardArtifact.artifactId,
    expectedVersion: storyboardArtifact.version || 1,
  })
  await recordHumanDecision({
    projectId,
    runId,
    action: 'storyboard-materialize',
    control: 'materialize-confirm',
    decision: 'confirmed',
    before: materializeBefore,
    evidence: [`nomi://project/${projectId}/run/${runId}/artifact/${storyboardArtifact.artifactId}`],
  })
  const attached = materialized.structuredContent?.nomiOutcome
  check(attached?.kind === 'storyboard_materialized' && Number(attached?.bindingCount) === 8, 'approved storyboard materializes through the external MCP seam with eight planned jobs')
  const materializedRun = await window.evaluate(async ({ projectId: pid, runId: rid }) => {
    return window.nomiDesktop?.productionRuns?.read(pid, rid)
  }, { projectId, runId })
  check(materializedRun.jobs[0]?.metadata?.subtitle === '1', 'external materialize preserves storyboard subtitle metadata on the first job')
  check(materializedRun.jobs[0]?.metadata?.transition?.type === 'dissolve' && materializedRun.jobs[0]?.metadata?.transition?.durationFrames === 12, 'external materialize preserves authored transition metadata')
  await window.screenshot({ path: path.join(shotsDir, '02-contract.png') })

  // A bounded external-surface RED run can stop immediately after the
  // review/materialize seam. This proves the direction click violation without
  // entering any paid/fixture generation gate or creating a media artifact.
  if (externalAgentOnly && process.env.NOMI_EXTERNAL_STOP_BEFORE_MEDIA === '1') {
    const trajectory = readTrajectory()
    const forbidden = trajectory.filter((entry) => (
      entry.actor === 'human-simulator'
      && entry.surface === 'desktop-click'
      && isNormalApprovalControl(entry.control)
    ))
    check(forbidden.length === 0, `external-agent-only run has no normal-path desktop-click approvals (found ${forbidden.length})`)
    appendTrajectory({
      actor: 'main-observer',
      surface: 'mcp-stdio',
      action: 'trajectory-validate',
      projectId,
      runId,
      outcome: 'accepted',
      observedEntries: trajectory.length,
      externalAgentOnly: true,
    })
    const stop = new Error('external-agent-only bounded run complete before media')
    stop.code = 'EXTERNAL_SURFACE_STOP'
    throw stop
  }

  // 钱门必须在 Nomi 批准；confirm_all 随后在第一次供应商提交前创建逐镜头门。
  await approveCurrentProductionGate(window, { projectId, runId, control: 'contract-approve' })
  await waitForWaitingGate(projectId, runId, 'gate-shot-', 30_000)
  let atShot = await getRunData(projectId, runId)
  check(atShot.jobs.every((job) => job.status === 'authorized'), 'first shot gate stops before every provider submission')
  await openRunFromTaskCenter(window, '02a-shot-1-gate.png')

  // 在逐镜头门等待时重启真实 Nomi；门与零提交状态必须从磁盘恢复。
  await gui.app.close()
  gui = await launchGui()
  await gui.window.locator('[data-project-card="true"]').first().click()
  await gui.window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })
  await openRunFromTaskCenter(gui.window)
  atShot = await waitForWaitingGate(projectId, runId, 'gate-shot-')
  check(atShot.jobs.every((job) => job.status === 'authorized'), 'restart recovers the waiting shot gate without submitting or spending')
  await approveCurrentProductionGate(gui.window, { projectId, runId, control: 'shot-1-approve' })

  // 首镜获批并生成后停样片门；看过样片后，第二镜仍要单独确认。
  await waitForWaitingGate(projectId, runId, 'gate-sample-', 30_000)
  const atSample = await getRunData(projectId, runId)
  check(atSample.status === 'running' && atSample.jobs.filter((job) => job.status === 'adopted').length === 1, 'one approved shot submits exactly once before the sample gate')
  // 截图要拍到卡本身（拍在开面板之前只会拍到空画布，等于没证据）。
  await openRunFromTaskCenter(gui.window, '03a-sample-gate.png')
  await approveCurrentProductionGate(gui.window, { projectId, runId, control: 'sample-approve' })

  await waitForWaitingGate(projectId, runId, 'gate-shot-', 30_000)
  const beforeShotTwo = await getRunData(projectId, runId)
  const waitingShotGates = beforeShotTwo.gates.filter((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')
  check(waitingShotGates.length === 1 && waitingShotGates[0].jobIds.length === 1, 'second shot receives its own durable one-job gate')
  check(beforeShotTwo.jobs.filter((job) => job.status === 'adopted').length === 1, 'second shot is still unsubmitted before approval')
  await openRunFromTaskCenter(gui.window, '03b-shot-2-gate.png')
  await approveCurrentProductionGate(gui.window, { projectId, runId, control: 'shot-2-approve' })

  // The approved storyboard is eight shots. In confirm_all mode every remaining
  // shot gets the same durable one-job gate; walk them rather than silently
  // assuming that approving shot two authorizes the whole batch.
  for (let shotNumber = 3; shotNumber <= 8; shotNumber += 1) {
    await waitForWaitingGate(projectId, runId, 'gate-shot-', 30_000)
    const waiting = await getRunData(projectId, runId)
    const waitingGate = waiting.gates.find((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')
    check(waitingGate?.jobIds?.length === 1, `shot ${shotNumber} receives one explicit approval gate`)
    await approveCurrentProductionGate(gui.window, { projectId, runId, control: `shot-${shotNumber}-approve` })
  }

  run = await waitForRunStatus(projectId, runId, 'awaiting_rough_cut_review', 30_000)
  check(run.jobs.length === 8 && run.jobs.every((job) => job.status === 'adopted'), 'each approved fixture shot reaches adopted exactly once')
  check(run.artifacts.some((artifact) => artifact.kind === 'video') && run.artifacts.some((artifact) => artifact.kind === 'timeline'), 'generation and assembly produce local video and timeline artifacts')
  await openRunFromTaskCenter(gui.window)
  // 获批样张：视频先出封面 + 播放键（原生 controls chrome 在窄卡里又挤又脏），点了才进播放态。
  check(await gui.window.locator('[data-production-preview] video').count() === 0, 'rough-cut preview starts as a cover, not a raw player')
  await gui.window.locator('[data-production-preview-open]').click()
  const roughCutVideo = gui.window.locator('[data-production-preview] video')
  await roughCutVideo.waitFor({ timeout: 5_000 })
  check(await roughCutVideo.count() === 1, 'clicking the cover reveals exactly one playable video in Nomi')
  await gui.window.screenshot({ path: path.join(shotsDir, '03-rough-cut-player.png') })

  await gui.window.locator('[data-production-primary-action]').click()
  const roughCutConfirm = gui.window.locator('[data-confirm-dialog-confirm="true"]:visible')
  await roughCutConfirm.waitFor({ timeout: 5_000 })
  const roughCutBefore = await getRunData(projectId, runId)
  await roughCutConfirm.click()
  const roughCutAfter = await waitForRunStatus(projectId, runId, 'awaiting_export')
  appendTrajectory({
    actor: 'human-simulator',
    surface: 'desktop-click',
    action: 'rough-cut-review',
    control: 'rough-cut-approve',
    projectId,
    runId,
    before: { status: roughCutBefore.status, revision: roughCutBefore.revision, eventCursor: roughCutBefore.snapshotCursor },
    decision: 'approved',
    after: { status: roughCutAfter.status, revision: roughCutAfter.revision, eventCursor: roughCutAfter.snapshotCursor },
    reason: '子 agent 模拟用户看过粗剪后确认进入导出',
  })
  await openRunFromTaskCenter(gui.window)
  await approveCurrentProductionGate(gui.window, { projectId, runId, control: 'export-approve' })
  run = await waitForRunStatus(projectId, runId, 'completed', 30_000)
  check(run.budget.actual === 0 && run.budget.unsettled === 0, 'fixture completes with truthful zero actual and unsettled spend')
  check(run.stages.length === 9 && run.stages.every((stage) => stage.status === 'completed'), 'completed Run reports all 9 production stages complete')
  const exportArtifact = run.artifacts.find((artifact) => artifact.kind === 'export')
  check(Boolean(exportArtifact?.artifactId), 'completed Run exposes a scoped export artifact identity')

  const artifactResult = await callTool('nomi_get_artifact', { projectId, runId, artifactId: exportArtifact.artifactId })
  const serializedArtifact = JSON.stringify(artifactResult)
  const artifactData = artifactResult.structuredContent?.nomiRunData
  check(artifactData.nomiUri === `nomi://project/${projectId}/run/${runId}/artifact/${exportArtifact.artifactId}`, 'MCP returns a scoped nomiUri for the final export')
  check(!serializedArtifact.includes(tempRoot) && !/providerTaskId|rawPrompt|idempotencyKey/.test(serializedArtifact), 'MCP artifact result leaks no local path, prompt, or provider internals')
  const previewResponse = await fetch(artifactData.preview.url, { headers: { Range: 'bytes=0-127' } })
  check([200, 206].includes(previewResponse.status) && (await previewResponse.arrayBuffer()).byteLength > 0, 'expiring loopback preview token authorizes the final MP4 bytes')

  const projectRoot = projectRootFor(projectId)
  const exportPath = path.join(projectRoot, 'exports', `nomi-${runId}.mp4`)
  const ffprobePath = require('@ffprobe-installer/ffprobe').path
  const probe = JSON.parse(execFileSync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath,
  ], { encoding: 'utf8' }))
  check(Number(probe.format?.duration) > 0, 'final MP4 has a positive playable duration')
  check(probe.streams?.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'), 'final MP4 contains H.264 video')
  check(probe.streams?.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'), 'final MP4 contains AAC audio')

  // 窄窗（900×700）下的完成态：卡必须仍然装得下（380px 浮层 + 产物预览不挤爆）。
  await gui.window.setViewportSize({ width: 900, height: 700 })
  await openRunFromTaskCenter(gui.window)
  await gui.window.locator('[data-production-tone="success"]').waitFor({ timeout: 10_000 })
  await gui.window.waitForFunction(() => document.querySelector('[data-production-task-card]')?.textContent?.includes('9 / 9'), undefined, { timeout: 10_000 })
  check(await gui.window.getByText(/进行中 1|1 进行中/).count() === 0, 'completed task center does not retain a running summary')
  await gui.window.screenshot({ path: path.join(shotsDir, '04-completed-900x700.png') })
  check((await gui.window.locator('[data-production-task-card]').textContent())?.includes('9 / 9'), 'completed task card shows 9 / 9 stages')
  // 主观察器从 append-only 文件回读轨迹：没有人类模拟动作就不能把 Run 当成完成。
  // 这里只读 Run / 轨迹，不修复、不补写 artifact；任何缺口直接让黑盒旅程失败。
  const trajectory = readTrajectory()
  const humanControls = new Set(trajectory
    .filter((entry) => entry.actor === 'human-simulator')
    .map((entry) => entry.control))
  for (const control of ['direction-choice', 'direction-approve', 'approve-script', 'approve-storyboard', 'materialize-confirm', 'contract-approve', 'sample-approve', 'rough-cut-approve', 'export-approve']) {
    check(humanControls.has(control), `trajectory records human simulator control: ${control}`)
  }
  check([...humanControls].some((control) => /^shot-\d+-approve$/.test(control)), 'trajectory records per-shot generation approval')
  check(trajectory.every((entry) => entry.actor === 'human-simulator' || entry.actor === 'main-observer'), 'trajectory has no untrusted actor')
  if (externalAgentOnly) {
    // RED contract for Task 5: this fixture currently owns normal approvals in
    // the Nomi DOM. An external-origin run must instead record MCP elicitation
    // decisions; takeover/recovery desktop clicks are the only exception.
    const forbidden = trajectory.filter((entry) => (
      entry.actor === 'human-simulator'
      && entry.surface === 'desktop-click'
      && isNormalApprovalControl(entry.control)
    ))
    check(forbidden.length === 0, `external-agent-only run has no normal-path desktop-click approvals (found ${forbidden.length})`)
  }
  appendTrajectory({
    actor: 'main-observer',
    surface: 'mcp-stdio',
    action: 'trajectory-validate',
    projectId,
    runId,
    outcome: 'accepted',
    observedEntries: trajectory.length,
    requiredControls: [...humanControls],
  })
  console.log(`\nPRODUCTION MCP JOURNEY PASS: ${passed} assertions`)
  console.log(`  Run: ${runId}`)
  console.log(`  MP4: ${exportPath}`)
  console.log(`  Screenshots: ${shotsDir}`)
  console.log(`  Human-simulator trajectory: ${trajectoryPath}`)
} catch (error) {
  if (error?.code === 'EXTERNAL_SURFACE_STOP') {
    exitCode = 0
    console.log(`external-agent-only surface GREEN: Run ${activeRunId}; media generation intentionally not started`)
  } else {
  console.error(error?.stack || error)
  exitCode = 1
  }
} finally {
  const guiChild = gui?.app?.process?.()
  // mcp.terminate() ends stdin then SIGTERM→SIGKILL the stdio server (shared module). The Playwright GUI
  // app process is NOT owned by that module, so it gets its own SIGTERM→SIGKILL sweep here.
  await mcp?.terminate().catch(() => undefined)
  if (gui?.app) await Promise.race([gui.app.close().catch(() => undefined), delay(3_000)])
  if (guiChild && guiChild.exitCode === null) {
    try { guiChild.kill('SIGTERM') } catch {}
    await Promise.race([new Promise((resolve) => guiChild.once('exit', resolve)), delay(2_000)])
    if (guiChild.exitCode === null) { try { guiChild.kill('SIGKILL') } catch {} }
  }
  process.exitCode = exitCode
}
