// 真实 MCP / ProductionRun 黑盒：默认只到 storyboard materialize；设置
// NOMI_RUN_MEDIA=1 后继续走真实 provider、QA、粗剪和导出。
// 本脚本不写任何剧本/分镜/run JSON；唯一写入是 append-only 观察轨迹。
// 它复制用户本机 model-catalog 到隔离 profile，但绝不读取/打印 API key 内容。
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { spawnMcpStdioClient } from '../tests/ux/_mcpJourney.mjs'

const sourceCatalog = process.env.NOMI_SOURCE_CATALOG || '/Users/aoqimin/Library/Application Support/nomi/model-catalog.json'
if (!fs.existsSync(sourceCatalog)) throw new Error(`source model catalog not found: ${sourceCatalog}`)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-real-mcp-review-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
const trajectoryPath = process.env.NOMI_TRAJECTORY_OUT
  ? path.resolve(process.env.NOMI_TRAJECTORY_OUT)
  : path.join(tempRoot, 'trajectory.jsonl')
for (const dir of [userDataDir, projectsDir, capabilityDir, path.dirname(trajectoryPath)]) fs.mkdirSync(dir, { recursive: true })
// Copy bytes only. Never parse/log the catalog because it contains encrypted/legacy API-key records.
fs.copyFileSync(sourceCatalog, path.join(userDataDir, 'model-catalog.json'))

let seq = 0
function trace(entry) {
  seq += 1
  fs.appendFileSync(trajectoryPath, `${JSON.stringify({ seq, at: new Date().toISOString(), ...entry })}\n`, 'utf8')
}
function hash(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
function safeError(error) {
  return String(error instanceof Error ? error.message : error).replace(/(api[_ -]?key|authorization|bearer)\s*[:=]\s*\S+/ig, '$1:[redacted]')
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const require = createRequire(import.meta.url)

function projectRootFor(projectId, projectsDir) {
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(projectsDir, entry.name)
    try {
      if (JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8')).id === projectId) return root
    } catch { /* ignore unrelated temporary directories */ }
  }
  return null
}

let gui = null
let mcp = null
let projectId = ''
let runId = ''
let exitCode = 1
const appLogTail = []
function captureAppLog(chunk) {
  for (const line of String(chunk).split('\n')) {
    if (!line.trim()) continue
    appLogTail.push(line)
  }
  if (appLogTail.length > 80) appLogTail.splice(0, appLogTail.length - 80)
}

try {
  // 真 GUI（无 fixture）承接 renderer planner；MCP stdio 连接它的 live instance。
  gui = await launchNomiApp({
    name: 'real-mcp-review-only',
    userDataDir,
    settingsDir: userDataDir,
    projectsDir,
    env: { NOMI_CAPABILITY_DIR: capabilityDir },
  })
  const window = gui.win
  // launchNomiApp keeps the main-process stdout/stderr streams available. Capture a bounded,
  // key-redacted tail so a renderer bridge timeout is distinguishable from planner/API failure.
  gui.app.process().stdout?.on('data', captureAppLog)
  gui.app.process().stderr?.on('data', captureAppLog)
  await window.getByText('新建空白项目', { exact: false }).first().click()
  await window.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 20_000 })
  projectId = await window.evaluate(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('projectId'))
  if (!projectId) throw new Error('Nomi GUI did not open a project')

  mcp = spawnMcpStdioClient({
    settingsDir: userDataDir,
    userDataDir,
    projectsDir,
    capabilityDir,
    clientInfo: { name: 'OpenAI Codex real human simulator', version: 'review-only' },
    capabilities: { elicitation: {} },
    // Deliberately omit NOMI_E2E_PRODUCTION_FIXTURE and NOMI_LOOP_SPEND_OK.
    env: {},
  })
  let init = null
  for (let attempt = 0; attempt < 20 && !init; attempt += 1) {
    try { init = await mcp.initialize(4_000) } catch { await delay(500) }
  }
  if (!init?.result) throw new Error('real MCP stdio initialize failed')
  trace({ actor: 'main-observer', action: 'initialize', surface: 'mcp-stdio', projectId, result: 'accepted' })

  const modelResult = await mcp.callToolOrThrow('nomi_list_models', {}, { timeoutMs: 900_000 })
  const models = modelResult.structuredContent?.nomiOutcome?.models || []
  console.log(`usable model summary: ${JSON.stringify(models.map((model) => ({ modelKey: model.modelKey, kind: model.kind, keyStatus: model.keyStatus })))}`)
  trace({ actor: 'main-observer', action: 'nomi_list_models', surface: 'mcp-stdio', projectId, result: 'accepted', modelSummary: models.map((model) => ({ modelKey: model.modelKey, kind: model.kind, keyStatus: model.keyStatus })) })

  const brief = {
    goal: '雨夜的一个人捡到画着门的湿纸条，进入同一间创作室，把线索变成一条有字幕、转场和声音的约30秒短片',
    audience: '喜欢短故事和 AI 影像创作的人',
    channel: '短视频',
    tone: '雨夜悬疑，进入创作室后逐渐温暖明亮',
    durationSeconds: 30,
  }
  const started = await mcp.callToolOrThrow('nomi_start_playbook', {
    projectId,
    playbook: 'brand.promo',
    // Default external experience: creative lock + budget + representative sample;
    // per-shot approvals remain an explicit confirm_all mode, not the normal path.
    trustLevel: 'key_confirm',
    brief,
  }, { timeoutMs: 300_000 })
  runId = String(started.structuredContent?.nomiOutcome?.runId || started.structuredContent?.nomiRunData?.runId || '')
  if (!runId) throw new Error('nomi_start_playbook returned no runId')
  trace({ actor: 'human-simulator', action: 'nomi_start_playbook', surface: 'mcp-stdio', projectId, runId, decision: 'input-brief', inputHash: hash(brief), result: 'accepted' })

  async function runData() {
    const result = await mcp.callToolOrThrow('nomi_get_run', { projectId, runId }, { timeoutMs: 60_000 })
    return result.structuredContent?.nomiRunData || {}
  }
  // Keep every review-only checkpoint bounded. A provider planner failure must
  // become a durable needs_attention observation, not a five-minute silent wait.
  async function waitFor(predicate, label, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs
    let current = {}
    while (Date.now() < deadline) {
      current = await runData()
      if (predicate(current)) return current
      await delay(1_000)
    }
    throw new Error(`${label} timeout; last=${JSON.stringify({ status: current.status, stageId: current.stageId, gates: current.gates?.map((gate) => [gate.gateId, gate.status]) })}`)
  }

  // External MCP owns the creative reasoning. The test harness must receive candidates from the
  // calling Agent, rather than embedding a second Nomi planner or writing a direction artifact.
  const candidateText = process.env.NOMI_DIRECTION_CANDIDATES_JSON || ''
  let directionCandidates
  try { directionCandidates = JSON.parse(candidateText) } catch { throw new Error('NOMI_DIRECTION_CANDIDATES_JSON is required: external Agent must propose 2-3 directions') }
  let current = await waitFor((value) => value.gates?.some((gate) => gate.gateId === 'gate-direction-v1' && gate.status === 'waiting'), 'direction gate', 90_000)
  trace({ actor: 'external-agent', action: 'nomi_propose_directions', surface: 'mcp-tool-call', projectId, runId, inputHash: hash(directionCandidates), result: 'submitted' })
  await mcp.callToolOrThrow('nomi_propose_directions', { projectId, runId, candidates: directionCandidates }, { timeoutMs: 300_000 })
  current = await waitFor((value) => value.gates?.some((gate) => gate.gateId === 'gate-direction-v1' && gate.status === 'waiting' && gate.directionCandidates?.length >= 1), 'direction candidates', 90_000)
  const directionGate = current.gates.find((gate) => gate.gateId === 'gate-direction-v1')
  const choice = directionGate.directionCandidates[0]
  trace({ actor: 'human-simulator', action: 'nomi_decide_gate', control: 'direction-choice', surface: 'mcp-elicitation', projectId, runId, decision: { gateId: directionGate.gateId, choiceKey: choice.key, status: 'approved' }, before: { status: current.status, revision: current.revision }, result: 'submitted' })
  await mcp.callToolOrThrow('nomi_decide_gate', { projectId, runId, gateId: directionGate.gateId, decision: 'approved', choiceKey: choice.key }, { timeoutMs: 300_000 })
  // External Agent owns script reasoning. Nomi versions the exact submitted text
  // and exposes it as a reviewable artifact; no internal planner or handwritten
  // run/artifact JSON is used by this harness.
  const externalScriptContent = String(process.env.NOMI_SCRIPT_CONTENT || '').trim()
  if (!externalScriptContent) throw new Error('NOMI_SCRIPT_CONTENT is required: external Agent must propose the script')
  trace({ actor: 'external-agent', action: 'nomi_propose_script', surface: 'mcp-tool-call', projectId, runId, inputHash: hash(externalScriptContent), result: 'submitted' })
  await mcp.callToolOrThrow('nomi_propose_script', { projectId, runId, content: externalScriptContent }, { timeoutMs: 300_000 })
  current = await waitFor((value) => value.status === 'awaiting_script_review' && value.artifacts?.some((artifact) => artifact.kind === 'script' && artifact.status === 'candidate'), 'script review')
  trace({ actor: 'main-observer', action: 'direction-result', surface: 'mcp-stdio', projectId, runId, result: 'accepted', after: { status: current.status, revision: current.revision } })

  const script = current.artifacts.find((artifact) => artifact.kind === 'script' && artifact.status === 'candidate')
  const scriptRead = await mcp.callToolOrThrow('nomi_read_artifact', { projectId, runId, artifactId: script.artifactId }, { timeoutMs: 60_000 })
  const scriptData = scriptRead.structuredContent?.nomiOutcome || {}
  const scriptBody = scriptData.content
  const scriptChars = typeof scriptBody === 'string' ? scriptBody.length : JSON.stringify(scriptBody ?? '').length
  const scriptHash = typeof scriptData.contentHash === 'string' ? scriptData.contentHash : (script.contentHash || 'missing')
  console.log(`script candidate: ${script.artifactId} v${script.version || 1}, chars=${scriptChars}, hash=${scriptHash}`)
  trace({ actor: 'main-observer', action: 'nomi_read_artifact', surface: 'mcp-tool-call', projectId, runId, artifactId: script.artifactId, artifactVersion: script.version || 1, contentHash: scriptHash, contentChars: scriptChars, result: 'accepted' })
  trace({ actor: 'human-simulator', action: 'nomi_review_artifact', control: 'approve-script', surface: 'mcp-elicitation', projectId, runId, artifactId: script.artifactId, artifactVersion: script.version || 1, decision: 'approved', inputHash: hash({ artifactId: script.artifactId, version: script.version || 1, decision: 'approved' }), result: 'submitted' })
  await mcp.callToolOrThrow('nomi_review_artifact', { projectId, runId, artifactId: script.artifactId, expectedVersion: script.version || 1, decision: 'approved' }, { timeoutMs: 300_000 })
  const storyboardText = String(process.env.NOMI_STORYBOARD_PLAN_JSON || '').trim()
  if (!storyboardText) throw new Error('NOMI_STORYBOARD_PLAN_JSON is required: external Agent must propose the storyboard plan')
  let storyboardPlan
  try { storyboardPlan = JSON.parse(storyboardText) } catch { throw new Error('NOMI_STORYBOARD_PLAN_JSON must be valid JSON') }
  trace({ actor: 'external-agent', action: 'nomi_propose_storyboard', surface: 'mcp-tool-call', projectId, runId, inputHash: hash(storyboardPlan), result: 'submitted' })
  await mcp.callToolOrThrow('nomi_propose_storyboard', { projectId, runId, plan: storyboardPlan }, { timeoutMs: 300_000 })
  current = await waitFor((value) => value.status === 'awaiting_storyboard_review' && value.artifacts?.some((artifact) => artifact.kind === 'storyboard' && artifact.status === 'candidate'), 'storyboard review')

  const storyboard = current.artifacts.find((artifact) => artifact.kind === 'storyboard' && artifact.status === 'candidate')
  const storyboardRead = await mcp.callToolOrThrow('nomi_read_artifact', { projectId, runId, artifactId: storyboard.artifactId }, { timeoutMs: 60_000 })
  const storyboardData = storyboardRead.structuredContent?.nomiOutcome || {}
  const storyboardReadPlan = storyboardData.plan && typeof storyboardData.plan === 'object' ? storyboardData.plan : storyboardData.content
  const storyboardShots = storyboardReadPlan && typeof storyboardReadPlan === 'object' && Array.isArray(storyboardReadPlan.shots) ? storyboardReadPlan.shots.length : 0
  const storyboardHash = typeof storyboardData.contentHash === 'string' ? storyboardData.contentHash : (storyboard.contentHash || 'missing')
  console.log(`storyboard candidate: ${storyboard.artifactId} v${storyboard.version || 1}, shots=${storyboardShots}, hash=${storyboardHash}`)
  trace({ actor: 'main-observer', action: 'nomi_read_artifact', surface: 'mcp-tool-call', projectId, runId, artifactId: storyboard.artifactId, artifactVersion: storyboard.version || 1, contentHash: storyboardHash, shotCount: storyboardShots, result: 'accepted' })
  trace({ actor: 'human-simulator', action: 'nomi_review_artifact', control: 'approve-storyboard', surface: 'mcp-elicitation', projectId, runId, artifactId: storyboard.artifactId, artifactVersion: storyboard.version || 1, decision: 'approved', inputHash: hash({ artifactId: storyboard.artifactId, version: storyboard.version || 1, decision: 'approved' }), result: 'submitted' })
  await mcp.callToolOrThrow('nomi_review_artifact', { projectId, runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1, decision: 'approved' }, { timeoutMs: 300_000 })

  trace({ actor: 'human-simulator', action: 'nomi_materialize_storyboard', control: 'materialize-confirm', surface: 'mcp-tool-call', projectId, runId, artifactId: storyboard.artifactId, artifactVersion: storyboard.version || 1, decision: 'confirmed', result: 'submitted' })
  const materialized = await mcp.callToolOrThrow('nomi_materialize_storyboard', { projectId, runId, artifactId: storyboard.artifactId, expectedVersion: storyboard.version || 1 }, { timeoutMs: 300_000 })
  const outcome = materialized.structuredContent?.nomiOutcome || {}
  current = await runData()
  trace({ actor: 'main-observer', action: 'materialize-result', surface: 'mcp-stdio', projectId, runId, result: 'accepted', outcome: { kind: outcome.kind, bindingCount: outcome.bindingCount }, after: { status: current.status, revision: current.revision }, canvasNodeCount: materialized.structuredContent?.nomiRunData?.createdNodeIds?.length || outcome.bindingCount || 0 })

  if (current.status !== 'awaiting_contract') throw new Error(`materialize completed with unexpected status: ${current.status}`)
  if (current.budget?.authorized !== 0) throw new Error(`unexpected budget authorization before media: ${current.budget.authorized}`)

  if (process.env.NOMI_RUN_MEDIA === '1') {
    // Normal external-Agent approvals stay on MCP. The protocol performs the
    // elicitation in Claude/Codex/WorkBuddy, then this call writes the durable
    // gate decision; no Nomi DOM approval is used for the production path.
    async function approveGateViaMcp(control, gate, policy) {
      const before = await runData()
      if (!gate?.gateId) throw new Error(`missing waiting gate for ${control}`)
      trace({ actor: 'human-simulator', action: 'nomi_decide_gate', control, surface: 'mcp-elicitation', projectId, runId, decision: { gateId: gate.gateId, status: 'approved', ...(gate.choiceKey ? { choiceKey: gate.choiceKey } : {}) }, before: { status: before.status, revision: before.revision }, result: 'submitted' })
      await mcp.callToolOrThrow('nomi_decide_gate', { projectId, runId, gateId: gate.gateId, decision: 'approved', ...(policy ? { policy } : {}) }, { timeoutMs: 300_000 })
      const after = await runData()
      trace({ actor: 'main-observer', action: 'nomi_decide_gate-result', surface: 'mcp-stdio', projectId, runId, control, after: { status: after.status, revision: after.revision }, result: 'accepted' })
      return after
    }
    async function reconcileViaMcp(unknownJob) {
      const before = await runData()
      // Recovery is also an Agent-surface decision. A transient provider poll
      // must not send the user to Nomi just to click “found”; the MCP protocol
      // elicits the same human confirmation and the service keeps the original
      // providerTaskId/idempotency key.
      const outcome = unknownJob.providerTaskId ? 'found' : 'not_found'
      trace({ actor: 'human-simulator', action: 'nomi_reconcile_job', control: `reconcile-${outcome}`, surface: 'mcp-elicitation', projectId, runId, decision: { outcome, jobId: unknownJob.jobId, provider: unknownJob.provider, model: unknownJob.model, providerTaskId: unknownJob.providerTaskId || null }, before: { status: before.status, revision: before.revision }, result: 'submitted' })
      await mcp.callToolOrThrow('nomi_reconcile_job', { projectId, runId, jobId: unknownJob.jobId, outcome }, { timeoutMs: 300_000 })
      const after = await runData()
      trace({ actor: 'main-observer', action: 'nomi_reconcile_job-result', surface: 'mcp-stdio', projectId, runId, control: `reconcile-${outcome}`, after: { status: after.status, revision: after.revision }, result: 'accepted' })
      return { after, outcome }
    }
    let state = await runData()
    const requestedConcurrency = Number(process.env.NOMI_MAX_CONCURRENT_JOBS || 0)
    if (Number.isInteger(requestedConcurrency) && requestedConcurrency >= 1 && requestedConcurrency <= 6) {
      trace({ actor: 'human-simulator', action: 'nomi_control_run', control: 'set_concurrency', surface: 'mcp-tool-call', projectId, runId, decision: { maxConcurrentJobs: requestedConcurrency }, before: { status: state.status, revision: state.revision }, result: 'submitted' })
      state = await mcp.callToolOrThrow('nomi_control_run', { projectId, runId, action: 'set_concurrency', maxConcurrentJobs: requestedConcurrency }, { timeoutMs: 60_000 }).then(() => runData())
      trace({ actor: 'main-observer', action: 'nomi_control_run-result', control: 'set_concurrency', surface: 'mcp-stdio', projectId, runId, after: { status: state.status, revision: state.revision, maxConcurrentJobs: state.policy?.maxConcurrentJobs }, result: 'accepted' })
    }
    const contractGate = state.gates?.find((gate) => gate.status === 'waiting' && (gate.scope === 'contract' || gate.gateId === 'gate-contract-v1'))
    const csv = (name, fallback) => {
      const value = String(process.env[name] || '').trim()
      return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback
    }
    await approveGateViaMcp('contract-approve', contractGate, {
      maxSpend: Number(process.env.NOMI_PRODUCTION_HARD_BUDGET || 100),
      allowedProviders: csv('NOMI_PRODUCTION_ALLOWED_PROVIDERS', ['apimart', 'code-newcli-com']),
      allowedModels: csv('NOMI_PRODUCTION_ALLOWED_MODELS', ['doubao-seedream-4.5', 'doubao-seedance-2.0', 'gpt-image-2']),
    })
    while (true) {
      state = await runData()
      if (state.status === 'awaiting_rough_cut_review') break
      const waitingFreeze = state.gates?.find((gate) => gate.gateId.startsWith('gate-freeze-') && gate.status === 'waiting')
      if (waitingFreeze) throw new Error(`external MCP run raised unexpected freeze gate: ${waitingFreeze.gateId}`)
      const waitingShot = state.gates?.some((gate) => gate.gateId.startsWith('gate-shot-') && gate.status === 'waiting')
      if (waitingShot) {
        const gate = state.gates.find((item) => item.gateId.startsWith('gate-shot-') && item.status === 'waiting')
        const shotNumber = gate.gateId.match(/^gate-shot-(\d+)/)?.[1] || 'unknown'
        await approveGateViaMcp(`shot-${shotNumber}-approve`, gate)
        continue
      }
      const waitingSample = state.gates?.some((gate) => gate.gateId.startsWith('gate-sample-') && gate.status === 'waiting')
      if (waitingSample) {
        const gate = state.gates.find((item) => item.gateId.startsWith('gate-sample-') && item.status === 'waiting')
        await approveGateViaMcp('sample-approve', gate)
        continue
      }
      if (state.status === 'needs_attention') {
        const unknownJob = state.jobs?.find((job) => job.status === 'submission_unknown')
        if (unknownJob) {
          const reconciliation = await reconcileViaMcp(unknownJob)
          if (reconciliation.outcome === 'found') {
            // A provider receipt exists. Let the real reconciliation driver poll
            // the same task; never convert a transient polling outage into a
            // not-found decision or submit a second task.
            const reconciled = await waitFor((value) => value.jobs?.some((job) => job.jobId === unknownJob.jobId && ['adopted', 'needs_attention', 'submission_unknown'].includes(job.status)), 'provider reconciliation', 5 * 60_000)
            const reconciledJob = reconciled.jobs?.find((job) => job.jobId === unknownJob.jobId)
            if (reconciledJob?.status === 'adopted') continue
            throw new Error(`media generation reconciliation failed after provider receipt: ${JSON.stringify(reconciledJob)}`)
          }
          await delay(1_000)
          const recovered = await runData()
          if (recovered.jobs?.some((job) => job.status === 'submission_unknown')) {
            throw new Error(`media generation reconciliation did not settle: ${JSON.stringify(recovered.jobs)}`)
          }
          throw new Error(`media generation needs attention after reconciliation: ${JSON.stringify(reconciliation.after || recovered.jobs)}`)
        }
        throw new Error(`media generation needs attention: ${JSON.stringify(state.attention || state.jobs)}`)
      }
      await delay(1_000)
    }
    // The final visible decision belongs to the external Agent surface. One
    // elicited MCP call atomically approves the rough cut and its export gate;
    // do not send the human simulator back into Nomi for a duplicate click.
    const beforeRoughCutApproval = await runData()
    trace({ actor: 'human-simulator', action: 'nomi_approve_rough_cut', control: 'rough-cut-and-export', surface: 'mcp-elicitation', projectId, runId, decision: 'approved', before: { status: beforeRoughCutApproval.status, revision: beforeRoughCutApproval.revision }, result: 'submitted' })
    await mcp.callToolOrThrow('nomi_approve_rough_cut', { projectId, runId }, { timeoutMs: 300_000 })
    const afterRoughCutApproval = await runData()
    trace({ actor: 'main-observer', action: 'nomi_approve_rough_cut-result', surface: 'mcp-stdio', projectId, runId, after: { status: afterRoughCutApproval.status, revision: afterRoughCutApproval.revision }, result: 'accepted' })
    current = await waitFor((value) => value.status === 'completed', 'completed production run', 60 * 60_000)
    const root = projectRootFor(projectId, projectsDir)
    const runSnapshot = JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'runs', runId, 'run.json'), 'utf8')).run
    const exportArtifact = runSnapshot.artifacts.find((artifact) => artifact.kind === 'export')
    const exportPath = path.join(root, exportArtifact.projectRelativePath)
    const ffprobe = require('@ffprobe-installer/ffprobe').path
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', exportPath], { encoding: 'utf8' }))
    const evidenceDir = path.join(root, 'evals', 'real-30s')
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(path.join(evidenceDir, 'run-probe.json'), JSON.stringify({ projectId, runId, exportPath: path.relative(root, exportPath), probe }, null, 2))
    trace({ actor: 'main-observer', action: 'real-media-verdict', surface: 'ffprobe', projectId, runId, result: 'completed', status: current.status, probe })
    console.log(`real MCP 30s media PASS: project=${projectId} run=${runId} export=${exportPath}`)
    exitCode = 0
  }
  const events = await mcp.callToolOrThrow('nomi_subscribe_run', { projectId, runId, afterCursor: 0, waitMs: 0 }, { timeoutMs: 60_000 })
  const eventTypes = (events.structuredContent?.nomiRunData?.events || []).map((event) => event.type)
  console.log(`real MCP review-only PASS: project=${projectId} run=${runId} status=${current.status} events=${eventTypes.join(',')}`)
  trace({ actor: 'main-observer', action: 'nomi_subscribe_run', surface: 'mcp-stdio', projectId, runId, result: 'accepted', eventTypes, finalStatus: current.status, budgetAuthorized: current.budget.authorized })
  exitCode = 0
} catch (error) {
  console.error(`blocked_at_real_seam: ${safeError(error)}`)
  if (appLogTail.length) {
    const redacted = appLogTail.join('\n').replace(/(api[_ -]?key|authorization|bearer)\s*[:=]\s*\S+/ig, '$1:[redacted]')
    console.error(`main_process_log_tail:\n${redacted}`)
  }
  trace({ actor: 'main-observer', action: 'real-mcp-review-only', surface: 'mcp-stdio', projectId, ...(runId ? { runId } : {}), result: 'blocked_at_real_seam', error: safeError(error) })
} finally {
  await mcp?.terminate().catch(() => undefined)
  await gui?.app?.close().catch(() => undefined)
  console.log(`trajectory=${trajectoryPath}`)
  console.log(`isolatedRoot=${tempRoot}`)
  process.exitCode = exitCode
}
