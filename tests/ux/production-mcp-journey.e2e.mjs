import { require as tsxRequire } from 'tsx/cjs/api'
// Real built Electron + real MCP stdio Production Run journey. No provider calls: the fixture is
// double-gated and disabled in packaged builds. This test owns the GUI direction / script / storyboard /
// contract approvals and proves durable restart recovery and safe MCP projections; after the contract the
// retired legacy script writer stops the Run as needs_attention with zero submissions (engine convergence
// cut 1 step 4). Semantic generation through rough cut is walked by mcp-l2-journeys (C9).
//
// Transport framing (spawn / initialize / rpc / callTool / terminate) lives in the ONE shared module
// _mcpJourney.mjs — this production journey and the L1/L2 MCP lanes share one
// spawn/JSON-RPC implementation (P1: no copy-paste). Lane differences are passed as options:
// the io.modelcontextprotocol/ui client capability + Codex clientInfo, and the production fixture env.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot, spawnMcpStdioClient } from './_mcpJourney.mjs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-production-mcp-e2e-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
const capabilityDir = path.join(tempRoot, 'capability')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/production-mcp')
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(shotsDir, { recursive: true })

// Isolation env + client identity the shared spawner needs to reproduce this sibling's transport exactly:
// the production fixture flag (double-gated, never calls a provider) and Codex's UI-extension capability.
const mcpDirs = { settingsDir: userDataDir, userDataDir, projectsDir, capabilityDir }
const mcpEnv = { NOMI_E2E_PRODUCTION_FIXTURE: '1' }
const mcpClientInfo = { name: 'OpenAI Codex', version: 'e2e' }
const mcpCapabilities = {
  elicitation: {},
  extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
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
const callTool = (name, args) => mcp.callToolOrThrow(name, args, { timeoutMs: 40_000 })

async function getRunData(projectId, runId) {
  const result = await callTool('nomi_read', { target: 'run', projectId, runId })
  return result.structuredContent?.nomiRunData
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

/**
 * 按**身份**打开项目库里的某个项目，并证明真的进去了。
 *
 * 为什么不能 `.first()`：库卡的顺序是「最近用过」派生量（libraryDiscovery.sortByLibraryUsage），
 * 本旅程自 2026-09-04 起在同一个隔离库里有**两个**项目（GUI 建的制作项目 + MCP 建的语义夹具），
 * 两者 updatedAt 常落在同一秒里——`.first()` 于是变成掷硬币。点错那次，任务中心开出来是空的，
 * 报错却是下游的「[data-production-task-card] 10s 超时」，一路指向假方向。
 * 身份选择 + 这条 hash 屏障让「点错项目」当场按它真实的名字失败。
 */
async function openProjectFromLibrary(window, wantedProjectId) {
  // 不给 click 加更紧的超时：开屏动画（SplashIntro，5 段 × 2600ms ≈ 13.5s）会挡住库页，
  // 用 Playwright 默认超时才等得过它——收紧到 10s 会把这条重启步变成另一种抖动。
  await window.locator(`[data-project-card="true"][data-project-id="${wantedProjectId}"]`).click()
  await window.waitForFunction(
    (id) => window.location.hash.includes(`projectId=${id}`),
    wantedProjectId,
    { timeout: 10_000 },
  )
}

async function approveCurrentProductionGate(window) {
  await openRunFromTaskCenter(window)
  await window.locator('[data-production-primary-action]').first().click()
  const overlay = window.locator('.fixed.inset-0').filter({ has: window.locator('button') }).last()
  await overlay.waitFor({ timeout: 5_000 })
  await overlay.locator('button').last().click()
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
  // 期望清单从**源码目录** derive（MCP_TOOL_RESOLVER 就是 tools/list 用的同一份快照——单一真相，
  // 面收敛后 name 字面量散在多个文件+capability 投影里，regex 扫源文件会漏播 session_open 与 M2 编辑工具），
  // 断言集合相等：漏播/多播都抓得住，目录再长这里也不会烂成过期死数。
  const catalogNames = tsxRequire('../../electron/capabilityCore/mcpToolCatalog.ts', import.meta.url)
    .MCP_TOOL_RESOLVER.list().map((tool) => tool.name)
  const stdioNames = tools.map((tool) => tool.name)
  const missing = catalogNames.filter((name) => !stdioNames.includes(name))
  const extra = stdioNames.filter((name) => !catalogNames.includes(name))
  check(
    catalogNames.length > 0 && missing.length === 0 && extra.length === 0,
    `real MCP stdio exposes the exact ${catalogNames.length}-tool catalog (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
  )
  // 面收敛：Run 旅程的整套动词并进 4 个对象工具（读侧统一 nomi_read）。
  for (const name of ['nomi_run_start', 'nomi_read', 'nomi_artifact_review', 'nomi_run_gate']) {
    check(tools.some((tool) => tool.name === name), `${name} is registered over real stdio`)
  }

  // Semantic editing smoke: use the same real GUI+stdio connection as the Run
  // journey. Stdio's production binding intentionally has no implicit current
  // project selection, so create an explicit MCP project and open its returned
  // selection handle; this is the supported production authorization path.
  const semanticProjectResult = await callTool('nomi_project_create', { name: 'MCP semantic production fixture' })
  const semanticProjectText = semanticProjectResult.content?.find((block) => block.type === 'text')?.text || '{}'
  const semanticProject = JSON.parse(semanticProjectText)
  const semanticProjectId = semanticProject.id
  const openedSession = await callTool('nomi_session_open', { projectSelectionHandle: semanticProject.projectSelectionHandle })
  const sessionText = openedSession.content?.find((block) => block.type === 'text')?.text || '{}'
  const session = JSON.parse(sessionText)
  const leaseHandle = session.leaseHandle
  check(typeof leaseHandle === 'string' && leaseHandle.length > 0, 'semantic MCP session opens a verified project lease')
  const missingDocument = await mcp.callTool('nomi_document_read', { leaseHandle, projectId: semanticProjectId, scope: 'full' })
  check(missingDocument.isError === true && missingDocument.structuredContent?.nomiOutcome?.errorCode === 'document_not_found', `document MCP gap is explicit for a newly created project without a creation document; actual=${JSON.stringify(missingDocument)}`)

  const createdSemanticNode = await callTool('nomi_canvas_edit', {
    leaseHandle,
    projectId: semanticProjectId,
    operation: 'create_canvas_nodes',
    summary: 'semantic maintenance fixture node',
    nodes: [{ clientId: 'semantic-maintenance-node', kind: 'text', title: 'Semantic maintenance fixture', prompt: 'temporary MCP maintenance node' }],
  })
  const nodeId = createdSemanticNode.structuredContent?.clientIdToNodeId?.['semantic-maintenance-node']
  check(typeof nodeId === 'string' && nodeId.length > 0, 'canvas edit creates a real node before maintenance')
  const deletedSemanticNode = await callTool('nomi_canvas_maintenance', {
    leaseHandle,
    projectId: semanticProjectId,
    operation: 'delete_canvas_nodes',
    nodeIds: [nodeId],
    reason: 'semantic maintenance cleanup',
  })
  const undoToken = deletedSemanticNode.structuredContent?.undoToken
  check(deletedSemanticNode.structuredContent?.deletedNodeIds?.includes(nodeId) && typeof undoToken === 'string', 'canvas maintenance deletes through the real renderer gateway and returns undo')
  const restoredSemanticNode = await callTool('nomi_canvas_maintenance', {
    leaseHandle,
    projectId: semanticProjectId,
    operation: 'undo_canvas_delete',
    undoToken,
  })
  check(restoredSemanticNode.structuredContent?.restoredNodeIds?.includes(nodeId), 'canvas maintenance undo restores the real node')

  const resources = (await mcp.rpc('resources/list', {}, 20_000)).result?.resources || []
  // Host cutover content-addresses skill resources: nomi-skill://<dir>/<packageVersion>/<contentHash>.
  // Match by directory-name prefix and read via the returned uri (same as packaged-mcp-smoke).
  const directorResource = resources.find((resource) => resource.uri.startsWith('nomi-skill://director-cinematography/'))
  check(Boolean(directorResource), 'director cinematography skill is discoverable through MCP resources')
  const director = (await mcp.rpc('resources/read', { uri: directorResource.uri }, 20_000)).result?.contents?.[0]?.text || ''
  check(director.includes('镜头语言') && director.length > 1_000, 'director skill body can be loaded progressively over MCP')

  const started = await callTool('nomi_run_start', {
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
  check(Boolean(runId), 'MCP creates a durable Production Run without approving spend')
  check(started.structuredContent.nomiRunData.budget.authorized === 0, 'draft has zero authorized spend')

  await openRunFromTaskCenter(window, '00-task-center.png')
  check((await window.locator('[data-production-status-title]').textContent())?.length > 0, 'Task Center hosts the run card itself (no hop to the assistant panel)')
  check(await window.locator('[data-nomi-right-panel="tasks"] [data-production-task-card]').count() === 1, 'the production card lives inside the Task Center panel')
  check(await window.locator('.generation-canvas-v2-assistant [data-production-task-card]').count() === 0, 'the canvas assistant panel no longer hosts production controls')
  await window.screenshot({ path: path.join(shotsDir, '01-direction-gate.png') })

  // B1/B5 方向门三选一（获批样张贰幕）：MCP 投影带候选 → GUI 渲染可点 → 选中留痕。
  const atDirection = (await callTool('nomi_read', { target: 'run', projectId, runId })).structuredContent.nomiRunData
  const directionGate = atDirection.gates.find((gate) => gate.gateId === 'gate-direction-v1')
  check(directionGate?.directionCandidates?.length === 3, 'direction gate projects three LLM-planned candidates over MCP')
  check(directionGate.directionCandidates.some((candidate) => candidate.key === 'kinetic'), 'candidate keys survive the safe projection')
  await window.locator('[data-production-primary-action]').click()
  const candidateRows = window.locator('[data-direction-candidate]')
  await candidateRows.first().waitFor({ timeout: 5_000 })
  check(await candidateRows.count() === 3, 'direction dialog renders all three candidates')
  await window.locator('[data-direction-candidate="kinetic"]').click()
  check(await window.locator('[data-direction-candidate="kinetic"]').getAttribute('data-direction-selected') === 'true', 'clicking a candidate selects it')
  // 选择稳定性：600ms 后选中不得被任何重渲染/轮询重置回默认（验收抓到的视觉回落疑点）。
  await window.waitForTimeout(600)
  check(await window.locator('[data-direction-candidate="kinetic"]').getAttribute('data-direction-selected') === 'true', 'selection survives re-renders (no reset to first candidate)')
  await window.screenshot({ path: path.join(shotsDir, '01a-direction-candidates.png') })
  const directionOverlay = window.locator('.fixed.inset-0').filter({ has: window.locator('button') }).last()
  await directionOverlay.locator('button').last().click()
  let run = await waitForRunStatus(projectId, runId, 'awaiting_script_review')
  const decidedDirection = run.gates.find((gate) => gate.gateId === 'gate-direction-v1')
  check(decidedDirection?.decidedChoiceKey === 'kinetic', 'approval records the chosen direction as decidedChoiceKey')
  const scriptArtifact = run.artifacts.find((artifact) => artifact.kind === 'script')
  check(Boolean(scriptArtifact) && !run.artifacts.some((artifact) => artifact.kind === 'storyboard'), 'direction approval produces a durable script candidate before any storyboard')
  await callTool('nomi_artifact_review', {
    projectId,
    runId,
    artifactId: scriptArtifact.artifactId,
    expectedVersion: scriptArtifact.version || 1,
    action: 'approve',
  })
  run = await waitForRunStatus(projectId, runId, 'awaiting_storyboard_review')
  check(run.artifacts.some((artifact) => artifact.kind === 'storyboard'), 'script approval produces the durable storyboard candidate')
  const events = await callTool('nomi_read', { target: 'run_events', projectId, runId, afterCursor: 0, waitMs: 0 })
  check(events.structuredContent?.nomiRunData?.events?.some((event) => event.type === 'skill.loaded'), 'MCP event stream exposes durable skill evidence')

  const storyboardArtifact = run.artifacts.find((artifact) => artifact.kind === 'storyboard')
  await callTool('nomi_artifact_review', {
    projectId,
    runId,
    artifactId: storyboardArtifact.artifactId,
    expectedVersion: storyboardArtifact.version || 1,
    action: 'approve',
  })
  const materialized = await callTool('nomi_run_gate', {
    projectId,
    runId,
    action: 'materialize',
    artifactId: storyboardArtifact.artifactId,
    expectedVersion: storyboardArtifact.version || 1,
  })
  const attached = materialized.structuredContent?.nomiOutcome
  check(attached?.kind === 'storyboard_materialized' && Number(attached?.bindingCount) === 8, 'approved storyboard materializes through the external MCP seam with eight planned jobs')
  const materializedRun = await window.evaluate(async ({ projectId: pid, runId: rid }) => {
    return window.nomiDesktop?.productionRuns?.read(pid, rid)
  }, { projectId, runId })
  check(materializedRun.jobs[0]?.metadata?.subtitle === '1', 'external materialize preserves storyboard subtitle metadata on the first job')
  check(materializedRun.jobs[0]?.metadata?.transition?.type === 'dissolve' && materializedRun.jobs[0]?.metadata?.transition?.durationFrames === 12, 'external materialize preserves authored transition metadata')
  await window.screenshot({ path: path.join(shotsDir, '02-contract.png') })

  // 钱门（合同）必须在 Nomi 里批。批完之后，旧剧本那台向渲染层派 production.generate-node 的生成写手已经退役
  // （发动机收敛第一刀第 4 步；真实渲染层早就拒收这条，只有零额度夹具曾经替它出片）：这一批不派、不花钱，
  // 停成「需要处理」（legacy_generation_writer_retired），而不是假装在跑或卡在一道永远不来的逐镜门上。
  // 语义计划那条生成 → 粗剪的路由 mcp-l2-journeys（C9）走。
  await approveCurrentProductionGate(window)
  run = await waitForRunStatus(projectId, runId, 'needs_attention', 30_000)
  const readFullRun = (win) => win.evaluate(async ({ projectId: pid, runId: rid }) => window.nomiDesktop?.productionRuns?.read(pid, rid), { projectId, runId })
  const retiredJobs = (fullRun) => (fullRun?.jobs || []).filter((job) => job.stageId === 'generate')
  let fullRun = await readFullRun(window)
  check(retiredJobs(fullRun).length === 8 && retiredJobs(fullRun).every((job) => job.status === 'needs_attention' && job.errorCode === 'legacy_generation_writer_retired'), 'approved legacy script jobs stop as retired instead of dispatching')
  check(!fullRun.jobs.some((job) => job.providerTaskId) && fullRun.budget.actual === 0 && fullRun.budget.unsettled === 0, 'the retired legacy writer submits nothing and spends nothing')
  await openRunFromTaskCenter(window, '02a-legacy-retired.png')

  // 重启真实 Nomi：停下的状态从磁盘恢复，仍然零提交。
  await gui.app.close()
  gui = await launchGui()
  await openProjectFromLibrary(gui.window, projectId)
  const afterRestartCanvas = await callTool('nomi_read', { target: 'canvas', leaseHandle, projectId: semanticProjectId })
  check(afterRestartCanvas.structuredContent?.nodes?.some((node) => node.id === nodeId), 'canvas semantic undo survives real Nomi restart')
  await openRunFromTaskCenter(gui.window, '03-after-restart.png')
  run = await getRunData(projectId, runId)
  fullRun = await readFullRun(gui.window)
  check(run.status === 'needs_attention' && retiredJobs(fullRun).every((job) => job.status === 'needs_attention') && !fullRun.jobs.some((job) => job.providerTaskId), 'restart keeps the retired legacy run stopped without submitting')
  console.log(`\nPRODUCTION MCP JOURNEY PASS: ${passed} assertions`)
  console.log(`  Run: ${runId}`)
  console.log(`  Screenshots: ${shotsDir}`)
} catch (error) {
  console.error(error?.stack || error)
  exitCode = 1
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
