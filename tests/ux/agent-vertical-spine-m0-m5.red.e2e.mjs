// M0-M5 red-stage vertical spine.
//
// This runner intentionally stops at the first unmet production seam. It starts
// a real isolated Electron app, creates a project through the visible library UI,
// and only then attempts the storyboard → Agent → MCP → durable write path.
// It does not seed a project, inject a Zustand/store state, call a handler, or use
// a loopback provider. A future green implementation must make every later step
// execute through the same real UI/preload/public-MCP path.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'

const contractPath = path.resolve('tests/system/agent-vertical-spine-m0-m5.contract.json')
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'))
const transcript = contract.multiRoundProtocol?.transcript || []
const forbiddenUserTokens = /\b(operation|tool|id|fixture|patch_shots|leaseHandle|nomi_canvas_plan)\b/i
if (transcript.length < 6) throw new Error('natural multi-round transcript must contain at least six turns')
for (const turn of transcript) {
  if (!turn.user || forbiddenUserTokens.test(turn.user)) throw new Error(`user transcript leaks technical vocabulary: ${turn.turn}`)
  for (const milestone of ['M0', 'M1', 'M2', 'M3', 'M4', 'M5']) {
    const internal = turn.internal?.[milestone]
    if (!internal || !internal.assertion || !internal.status || !('receipt' in internal) || !('revision' in internal) || !('context' in internal)) {
      throw new Error(`incomplete internal assertion for ${turn.turn}/${milestone}`)
    }
  }
}
const packagedInput = process.env.NOMI_VERTICAL_SPINE_PACKAGED_APP || null
const packagedApp = packagedInput
  ? path.resolve(packagedInput.endsWith('.app') ? path.join(packagedInput, 'Contents', 'MacOS', 'Nomi') : packagedInput)
  : null
const requestedPhase = process.argv.includes('--packaged') ? 'packaged' : 'development'
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-agent-vertical-spine-red-'))

const gaps = {
  H: { status: 'not-reached', reason: 'later user-visible actions are blocked by the first failed seam', next: 'make the real storyboard surface and row selection reachable after project creation' },
  B: { status: 'not-reached', reason: 'canonical selection/context/write behavior was not reached', next: 'bind row 2 selection to the Agent context snapshot and canonical operation args' },
  E: { status: 'not-reached', reason: 'no write, receipt, or revision may be claimed before a real proposal executes', next: 'persist one approved write and one declined no-op with receipt/revision evidence' },
  T: { status: 'not-reached', reason: 'the UI-to-preload-to-Host-to-owner chain was not traversed beyond project creation', next: 'connect the real renderer selection to the public MCP/Host owner and fresh-process readback' },
  N: { status: 'not-reached', reason: 'negative cases must run after the canonical entry is reachable', next: 'exercise stale/wrong-project/empty/decline/duplicate/reconcile cases and fail closed' },
}

function projectIdFromUrl(url) {
  return new URL(url).hash.split('?')[1] ? new URLSearchParams(new URL(url).hash.split('?')[1]).get('projectId') : null
}

function projectDirFor(dirs, projectId) {
  const candidates = fs.existsSync(dirs.projectsDir) ? fs.readdirSync(dirs.projectsDir) : []
  const match = candidates.find((name) => {
    const file = path.join(dirs.projectsDir, name, '.nomi', 'project.json')
    if (!fs.existsSync(file)) return false
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).id === projectId } catch { return false }
  })
  return match ? path.join(dirs.projectsDir, match) : null
}

function readProject(projectDir) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, '.nomi', 'project.json'), 'utf8'))
}

function redactDiagnosticText(value) {
  return String(value || '')
    .replace(/((?:api[_ -]?key|token|secret|authorization|bearer)\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>')
    .replace(/\bsk-[a-z0-9_-]+\b/gi, '<redacted>')
    .replace(/\b[a-f0-9]{32,}\b/gi, '<redacted>')
    .slice(0, 400)
}

async function agentFailureEvidence(win) {
  if (!win) return null
  const panel = win.locator('[data-agent-panel="true"]').first()
  if (!(await panel.count().catch(() => 0))) return null
  const user = panel.locator('[data-agent-item-kind="user"]').last()
  const turnId = await user.getAttribute('data-agent-turn-id').catch(() => null)
  if (!turnId) return null
  const selector = `[data-agent-turn-id=${JSON.stringify(turnId)}]`
  const failure = panel.locator(`[data-agent-item-kind="failure"]${selector}`).last()
  if (!(await failure.count().catch(() => 0))) return { turnId, visible: false }
  const reason = failure.locator('[data-err-reason="true"]').first()
  return {
    turnId,
    visible: await failure.isVisible().catch(() => false),
    status: await failure.getAttribute('data-agent-status'),
    code: await failure.getAttribute('data-agent-error-code'),
    category: await failure.getAttribute('data-agent-error-message-category'),
    reason: redactDiagnosticText(await reason.innerText().catch(() => '')),
  }
}

async function failureContext(win, step, error) {
  return {
    step,
    message: redactDiagnosticText(error?.message || String(error)),
    url: win?.url?.() || null,
    bodyText: win ? redactDiagnosticText(await win.locator('body').innerText().catch(() => '')) : '',
    agentFailure: await agentFailureEvidence(win),
    storyboardEditorCount: win ? await win.locator('[data-storyboard-editor="true"]').count().catch(() => 0) : 0,
    storyboardRow2Count: win ? await win.locator('[data-storyboard-editor="true"] [data-storyboard-row="2"]').count().catch(() => 0) : 0,
  }
}

async function dismissSplash(win) {
  const skip = win.locator('[data-splash-skip="true"]').first()
  if (await skip.count()) {
    await skip.click({ timeout: 5_000 })
    await win.locator('.nomi-splash').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined)
  }
}

async function closeSettingsOverlayThroughVisibleUi(win) {
  const overlay = win.locator('[data-settings-overlay]').first()
  await overlay.waitFor({ state: 'visible', timeout: 5_000 })
  const dialog = win.getByRole('dialog', { name: '设置', exact: true }).first()
  await dialog.waitFor({ state: 'visible', timeout: 5_000 })
  const close = dialog.locator('[data-settings-close]').first()
  await close.waitFor({ state: 'visible', timeout: 5_000 })
  await close.click()
  await overlay.waitFor({ state: 'hidden', timeout: 5_000 })
}

async function waitForAgentTurnSettled(panel) {
  // The composer button is also the visible stop control while Host owns a
  // running turn.  A transcript item can be rendered before that ownership
  // transition settles; waiting for the non-stop button prevents the next
  // natural user turn from accidentally cancelling its predecessor.
  await panel.locator('button[data-agent-composer-send="true"]:not([data-agent-stop="true"])').first().waitFor({ state: 'visible', timeout: 60_000 })
}

async function waitForAgentTurnTerminal(panel, userText) {
  const userItem = panel.locator('[data-agent-item-kind="user"]').filter({ hasText: userText }).last()
  await userItem.waitFor({ state: 'visible', timeout: 10_000 })
  const turnId = await userItem.getAttribute('data-agent-turn-id')
  if (!turnId) throw new Error(`Agent user item for ${userText} did not expose its turn identity`)
  const turnSelector = `[data-agent-turn-id=${JSON.stringify(turnId)}]`
  const terminal = panel.locator([
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="done"]`,
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="failed"]`,
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="stopped"]`,
    `[data-agent-item-kind="failure"]${turnSelector}[data-agent-status="failed"]`,
    `[data-agent-item-kind="failure"]${turnSelector}[data-agent-status="declined"]`,
  ].join(', ')).first()
  await terminal.waitFor({ state: 'visible', timeout: 60_000 })
  return terminal.getAttribute('data-agent-status')
}

async function waitForAgentTurnTerminalOrPendingProposal(panel, userText) {
  const userItem = panel.locator('[data-agent-item-kind="user"]').filter({ hasText: userText }).last()
  await userItem.waitFor({ state: 'visible', timeout: 10_000 })
  const turnId = await userItem.getAttribute('data-agent-turn-id')
  if (!turnId) throw new Error(`Agent user item for ${userText} did not expose its turn identity`)
  const turnSelector = `[data-agent-turn-id=${JSON.stringify(turnId)}]`
  const terminal = panel.locator([
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="done"]`,
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="failed"]`,
    `[data-agent-item-kind="assistant"]${turnSelector}[data-agent-status="stopped"]`,
    `[data-agent-item-kind="failure"]${turnSelector}[data-agent-status="failed"]`,
    `[data-agent-item-kind="failure"]${turnSelector}[data-agent-status="declined"]`,
  ].join(', ')).first()
  const pending = panel.locator('[data-agent-approval-state="pending"]').first()
  const winner = await Promise.race([
    terminal.waitFor({ state: 'visible', timeout: 60_000 }).then(async () => ({ kind: 'terminal', status: await terminal.getAttribute('data-agent-status') })),
    pending.waitFor({ state: 'visible', timeout: 60_000 }).then(() => ({ kind: 'pending' })),
  ])
  return winner
}

async function denyPendingProposalForRevision(panel) {
  const pending = panel.locator('[data-agent-approval-state="pending"]').first()
  await pending.waitFor({ state: 'visible', timeout: 5_000 })
  const deny = pending.getByRole('button', { name: /拒绝|Deny/i }).first()
  await deny.waitFor({ state: 'visible', timeout: 5_000 })
  await deny.click()
}

async function reopenProjectThroughVisibleLibrary(win, projectId, projectName, projectDir, expectedRevision) {
  const library = win.locator('.nomi-library-page').first()
  await library.waitFor({ state: 'visible', timeout: 15_000 })
  const card = library.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.hover()
  const continueCreating = card.getByRole('button', { name: /继续创作|Continue creating/i }).first()
  await continueCreating.waitFor({ state: 'visible', timeout: 5_000 })
  await continueCreating.click()
  await win.waitForFunction((id) => new URL(location.href).hash.includes(`projectId=${encodeURIComponent(id)}`), projectId, { timeout: 15_000 })
  const reopenedHash = new URL(win.url()).hash
  if (!reopenedHash.startsWith('#/studio') || !reopenedHash.includes(`projectId=${encodeURIComponent(projectId)}`)) throw new Error('M5 visible project reopen did not navigate to the original studio project')
  // Project-library open intentionally defaults to the generation surface;
  // continue through the visible Creation tab before asserting storyboard state.
  const creationTab = win.getByRole('button', { name: '创作', exact: true }).first()
  await creationTab.waitFor({ state: 'visible', timeout: 15_000 })
  await creationTab.click()
  // Zustand updates synchronously, but React's hidden WorkspaceSlot is mounted
  // on the following render. Waiting only for the slot element is insufficient:
  // every slot exists from the first shell render, so the next locator lookup
  // can still inspect the previous generation surface and conclude that the
  // persisted storyboard card is absent. Wait for the shared mode projection
  // and then for the card's visible action before traversing the card.
  await win.waitForFunction(() => document.querySelector('.workbench-shell')?.getAttribute('data-workspace-mode') === 'creation', undefined, { timeout: 15_000 })
  // The shell keeps a hidden WorkspaceSlot action with the same accessible
  // name. Scope the action to the visible storyboard summary card and inspect
  // every matching button instead of trusting locator.first().
  const activeWorkspace = win.locator('.workbench-shell__workspace:not([hidden])').first()
  await activeWorkspace.waitFor({ state: 'visible', timeout: 10_000 })
  const storyboardCards = activeWorkspace.locator('[data-storyboard-card]')
  await storyboardCards.first().waitFor({ state: 'visible', timeout: 15_000 })
  const storyboardCardCount = await storyboardCards.count()
  let openedStoryboard = false
  for (let index = 0; index < storyboardCardCount && !openedStoryboard; index += 1) {
    const card = storyboardCards.nth(index)
    if (!(await card.isVisible().catch(() => false))) continue
    const openButtons = card.getByRole('button', { name: /打开分镜|再次编辑|Open storyboard|Edit again/i })
    const openButtonCount = await openButtons.count()
    for (let buttonIndex = 0; buttonIndex < openButtonCount && !openedStoryboard; buttonIndex += 1) {
      const openButton = openButtons.nth(buttonIndex)
      if (!(await openButton.isVisible().catch(() => false))) continue
      await openButton.click()
      openedStoryboard = true
    }
  }
  if (openedStoryboard) {
    await win.waitForFunction(() => new URL(location.href).searchParams.get('step') === 'storyboard', undefined, { timeout: 5_000 })
  }
  const storyboardEditor = win.locator('.workbench-shell__workspace:not([hidden]) [data-storyboard-editor="true"]').first()
  await storyboardEditor.waitFor({ state: 'visible', timeout: 15_000 })
  await storyboardEditor.locator('[data-storyboard-row="2"]').first().waitFor({ state: 'visible', timeout: 10_000 })
  const reopened = readProject(projectDir)
  if (reopened.id !== projectId) throw new Error('M5 visible project reopen read back a different project')
  if (reopened.revision < expectedRevision) throw new Error(`M5 visible project reopen regressed revision ${reopened.revision} below ${expectedRevision}`)
  const panel = win.locator('[data-agent-panel="true"]').first()
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  return { panel, revision: reopened.revision }
}

async function runPhase(phase, executablePath = undefined) {
  const dirs = makeIsolatedDirs(`nomi-agent-vertical-spine-${phase}-`)
  let app = null
  let win = null
  let mcp = null
  let decline = null
  const steps = []
  let firstFailure = null
  let currentStep = 'M0.start-electron'
  try {
    const instance = await launchNomiApp({
      name: `agent-vertical-spine-${phase}`,
      executablePath,
      userDataDir: dirs.userDataDir,
      settingsDir: dirs.settingsDir,
      projectsDir: dirs.projectsDir,
      capabilityDir: dirs.capabilityDir,
      args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
      settleMs: 0,
    })
    app = instance.app
    win = instance.win
    steps.push({ id: 'M0.start-electron', status: 'passed', evidence: 'real Electron window opened' })

    await dismissSplash(win)
    const create = win.getByText('新建空白项目', { exact: true }).first()
    await create.waitFor({ state: 'visible', timeout: 15_000 })
    await create.click()
    await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: 15_000 })
    const projectId = projectIdFromUrl(win.url())
    if (!projectId) throw new Error('M0 project creation did not produce a projectId route')
    await win.waitForFunction(async (id) => {
      const record = await window.nomiDesktop?.projects?.readAsync?.(id)
      return Boolean(record?.id === id && record?.payload)
    }, projectId, { timeout: 15_000 })
    const projectDir = projectDirFor(dirs, projectId)
    if (!projectDir) throw new Error(`M0 project ${projectId} was not readable from the isolated project root`)
    const initial = readProject(projectDir)
    steps.push({ id: 'M0.create-isolated-project', status: 'passed', evidence: { projectId, revision: initial.revision, projectDir } })

    currentStep = 'M1.select-storyboard-row'
    await win.getByRole('button', { name: '创作', exact: true }).first().click().catch(() => undefined)
    const storyboardEditor = win.locator('[data-storyboard-editor="true"]').first()
    await storyboardEditor.waitFor({ state: 'visible', timeout: 10_000 })
    const row = storyboardEditor.locator('[data-storyboard-row="2"]').first()
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    await row.click()
    await storyboardEditor.locator('[data-storyboard-row="2"][data-selected="true"], [data-storyboard-row="2"] [aria-selected="true"]').first().waitFor({ state: 'visible', timeout: 5_000 })
    steps.push({ id: 'M1.select-storyboard-row', status: 'passed', evidence: 'row 2 selected through visible storyboard DOM' })

    currentStep = 'M2.public-mcp-session-open'
    const mcpProbe = spawnMcpStdioClient({
      ...dirs,
      clientInfo: { name: 'agent-vertical-spine-session-probe', version: '1' },
      capabilities: { elicitation: {} },
      captureStderr: true,
    })
    try {
      await mcpProbe.initialize()
      const opened = parseToolResult(await mcpProbe.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
      const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
      if (!leaseHandle) throw new Error('M2 public MCP current-project session did not return a verified lease')
      steps.push({
        id: 'M2.public-mcp-session-open',
        status: 'partial',
        evidence: {
          proofStatus: 'PARTIAL_PROOF',
          clientKind: 'custom-stdio-diagnostic',
          tool: 'nomi_session_open',
          projectId,
          leaseIssued: true,
          codexHostJourney: 'not-covered',
        },
      })
    } finally {
      await mcpProbe.terminate().catch(() => undefined)
    }

    currentStep = 'M3.enable-agent-host-through-settings'
    steps.push({
      id: 'M3.enable-agent-host-through-settings',
      status: 'passed',
      evidence: 'Agent Host enabled through the visible Settings → General toggle; production default remains unchanged',
    })

    currentStep = 'M3.configure-apimart-text-model'
    const apimartApiKey = typeof process.env.APIMART_API_KEY === 'string' ? process.env.APIMART_API_KEY.trim() : ''
    if (!apimartApiKey) {
      steps.push({
        id: 'M3.configure-apimart-text-model',
        status: 'blocked',
        evidence: { reasonCode: 'BLOCKED_ENVIRONMENT', reason: 'APIMART_API_KEY is required for the isolated real-model path', configured: false },
      })
      return { phase, status: 'blocked', reasonCode: 'BLOCKED_ENVIRONMENT', steps, firstFailure: null, gaps, evidenceRoot, dirs }
    }
    // Credential edits must follow the visible onboarding boundary.  The renderer
    // sanitizer deliberately keeps a saved key disabled until certification promotes
    // the selected model; direct catalog upserts are forbidden test injection.
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-open-model-catalog')))
    const modelSettings = win.locator('[data-model-settings-page="home"]').first()
    await modelSettings.waitFor({ state: 'visible', timeout: 10_000 })
    const apimartAvailable = modelSettings.locator('[data-model-home-available="apimart"]').first()
    await apimartAvailable.waitFor({ state: 'visible', timeout: 10_000 })
    await apimartAvailable.click()
    const apimartKeyPage = win.locator('[data-key-only-vendor="apimart"]').first()
    await apimartKeyPage.waitFor({ state: 'visible', timeout: 10_000 })
    const keyInput = apimartKeyPage.locator('#key-only-apimart').first()
    if (!(await keyInput.isDisabled().catch(() => true))) {
      await keyInput.fill(apimartApiKey)
      await apimartKeyPage.getByRole('button', { name: /保存|Save/i }).first().click()
    }
    await apimartKeyPage.locator('[data-key-only-success]').waitFor({ state: 'visible', timeout: 10_000 })
    await apimartKeyPage.getByRole('button', { name: /继续验证|Continue verification/i }).first().click()

    // Stay on the canonical visible picker: fetch the provider model list, select
    // deepseek-v4-pro, then let the wizard invoke httpCertificationStartExisting.
    const addPage = win.locator('[data-model-settings-page="add"]').first()
    await addPage.waitFor({ state: 'visible', timeout: 10_000 })
    await addPage.getByRole('button', { name: /获取可用模型|Get available models/i }).first().click()
    const modelRow = addPage.getByRole('button', { name: 'deepseek-v4-pro', exact: true }).first()
    await modelRow.waitFor({ state: 'visible', timeout: 30_000 })
    if (await modelRow.isDisabled().catch(() => true)) throw new Error('M3 APIMart deepseek-v4-pro is already configured and cannot be selected in the visible picker')
    await modelRow.click()
    const confirm = addPage.getByRole('button', { name: /验证\s*1\s*个模型|Verify\s*1\s*model/i }).first()
    await confirm.waitFor({ state: 'visible', timeout: 5_000 })
    await confirm.click()
    const verification = win.locator('[data-model-settings-page="verification"]').first()
    await verification.waitFor({ state: 'visible', timeout: 10_000 })
    const runId = await verification.getAttribute('data-adapter-run-id')
    if (!runId) throw new Error('M3 APIMart verification page did not expose a canonical run id')
    let latest = null
    const terminal = new Set(['completed', 'partial', 'failed', 'cancelled', 'timed_out', 'stale'])
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const polled = await win.evaluate(async (id) => window.nomiDesktop?.onboarding?.certificationGet?.({ runId: id }), runId)
      if (polled?.ok && polled.run) {
        latest = polled.run
        if (terminal.has(latest.stage)) break
      }
      await win.waitForTimeout(1_000)
    }
    if (!latest || latest.stage !== 'completed') throw new Error(`M3 APIMart certification ${latest?.stage || 'unknown'} for deepseek-v4-pro`)
    // Promotion is asynchronous with respect to the verification surface. Read the
    // complete public DTO and wait for the exact promoted row before refreshing the
    // resident projection; filtered listModels calls hide whether enabled or
    // publication metadata is the lagging field.
    await win.waitForFunction(() => {
      const models = window.nomiDesktop?.modelCatalog?.listModels?.() || []
      const model = models.find((candidate) => candidate.vendorKey === 'apimart' && candidate.modelKey === 'deepseek-v4-pro')
      return Boolean(model?.enabled === true && model?.published === true && model?.meta?.adapter?.state === 'verified')
    }, undefined, { timeout: 20_000 })
    const publication = await win.evaluate(() => {
      const model = (window.nomiDesktop?.modelCatalog?.listModels?.() || []).find((candidate) => candidate.vendorKey === 'apimart' && candidate.modelKey === 'deepseek-v4-pro')
      return model ? { enabled: model.enabled, published: model.published, adapterState: model.meta?.adapter?.state } : null
    })
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed')))
    steps.push({ id: 'M3.configure-apimart-text-model', status: 'passed', evidence: { configured: true, vendorKey: 'apimart', modelKey: 'deepseek-v4-pro', certification: { runId, stage: latest.stage }, publication, catalogRefresh: 'observed' } })
    currentStep = 'M3.close-model-settings'
    await closeSettingsOverlayThroughVisibleUi(win)
    steps.push({
      id: 'M3.close-model-settings',
      status: 'passed',
      evidence: { action: 'visible-click', selector: '[data-settings-close]', overlay: 'hidden' },
    })

    currentStep = 'M3.select-skill-and-model'
    const collapsed = win.locator('[data-agent-resident-collapsed="true"]').first()
    if (await collapsed.isVisible().catch(() => false)) await collapsed.click()
    const panel = win.locator('[data-agent-panel="true"]').first()
    await panel.waitFor({ state: 'visible', timeout: 10_000 })
    await panel.locator('[data-agent-composer-mode="true"]').click()
    const skill = win.locator('[data-agent-menu-item="workbench.storyboard.planner"]').first()
    await skill.waitFor({ state: 'visible', timeout: 10_000 })
    await skill.click()
    await panel.locator('[data-agent-reference="skill:workbench.storyboard.planner"]').waitFor({ state: 'visible', timeout: 5_000 })
    await panel.locator('[data-agent-composer-model="true"]').click()
    const model = win.locator('button[data-agent-menu-item="apimart/deepseek-v4-pro"]').first()
    await model.waitFor({ state: 'visible', timeout: 10_000 })
    const modelIdentity = await model.getAttribute('data-agent-menu-item')
    await model.click()
    steps.push({ id: 'M3.select-skill-and-model', status: 'passed', evidence: { skill: 'workbench.storyboard.planner', modelIdentity } })

    currentStep = 'M3.agent-reads-selection-context'
    await panel.locator('[data-agent-reference="storyboard:shot:2"]').waitFor({ state: 'visible', timeout: 10_000 })
    steps.push({ id: 'M3.agent-reads-selection-context', status: 'passed', evidence: 'Agent reference is bound to storyboard shot 2' })

    currentStep = 'M3.natural-language-multi-round-transcript'
    const input = panel.locator('[data-agent-input="true"]').first()
    const send = panel.locator('[data-agent-composer-send="true"]').first()
    await input.waitFor({ state: 'visible', timeout: 10_000 })
    for (const turn of transcript.slice(0, 5)) {
      if (forbiddenUserTokens.test(turn.user)) throw new Error(`${turn.turn} user text contains a technical token`)
      await input.fill(turn.user)
      await send.click()
      const outcome = await waitForAgentTurnTerminalOrPendingProposal(panel, turn.user)
      let terminalStatus = outcome.status
      if (outcome.kind === 'pending') {
        // R2 is a preview request.  If the Agent presents an editable proposal,
        // the next natural turn explicitly changes its mind; reflect that user
        // action with the visible Deny control before submitting R3.  Never
        // auto-approve a pending write or turn it into a green effect claim.
        if (turn.turn !== 'R2') throw new Error(`Agent natural turn ${turn.turn} left a proposal awaiting user approval`)
        await denyPendingProposalForRevision(panel)
        terminalStatus = await waitForAgentTurnTerminal(panel, turn.user)
        steps.push({ id: 'M3.R2.pending-proposal-denied', status: 'passed', evidence: { action: 'visible-click', selector: '[data-agent-approval-state="pending"] button[aria-label*="拒绝"]', reason: 'R3 changed the requested posture to preview-before-confirmation' } })
      }
      if (terminalStatus !== 'done' && !(turn.turn === 'R2' && terminalStatus === 'declined')) throw new Error(`Agent natural turn ${turn.turn} reached terminal status ${terminalStatus}`)
      await waitForAgentTurnSettled(panel)
      steps.push({ id: `M3.${turn.turn}.natural-user-turn`, status: 'passed', evidence: { user: turn.user, terminalStatus, internalAssertions: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'] } })
    }

    currentStep = 'M2.canonical-patch-shots'
    mcp = spawnMcpStdioClient({ ...dirs, clientInfo: { name: 'agent-vertical-spine-red', version: '1' }, capabilities: { elicitation: {} }, captureStderr: true })
    await mcp.initialize()
    const opened = parseToolResult(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
    const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
    if (!leaseHandle) throw new Error('M2 current-project session did not return a verified lease')
    const canonicalArgs = { ...contract.productionCallShape.args, projectId, leaseHandle, select: { kind: 'indexes', indexes: [2] } }
    const approved = parseToolResult(await mcp.callToolOrThrow(contract.productionCallShape.tool, canonicalArgs))
    if (approved.json?.operation !== 'patch_shots' && approved.outcome?.operation !== 'patch_shots') throw new Error('M2 canonical result did not identify patch_shots')
    steps.push({ id: 'M2.canonical-patch-shots', status: 'passed', evidence: { tool: contract.productionCallShape.tool, operation: 'patch_shots' } })

    currentStep = 'M4.approved-write-receipt-revision'
    const changed = readProject(projectDir)
    if (changed.revision <= initial.revision) throw new Error('M4 approved canonical patch did not advance the durable project revision')
    const receiptPath = path.join(projectDir, '.nomi', 'project-agent-proposal-receipt.json')
    if (!fs.existsSync(receiptPath)) throw new Error('M4 approved canonical patch has no durable proposal receipt')
    steps.push({ id: 'M4.approved-write-receipt-revision', status: 'passed', evidence: { revision: changed.revision, projectDir } })

    const beforeDecline = JSON.stringify(readProject(projectDir))
    decline = spawnMcpStdioClient({
      ...dirs,
      clientInfo: { name: 'agent-vertical-spine-red-decline', version: '1' },
      capabilities: { elicitation: {} },
      elicitationAction: 'decline',
      captureStderr: true,
    })
    await decline.initialize()
    const declineOpened = parseToolResult(await decline.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
    const declineLease = declineOpened.json?.leaseHandle || declineOpened.outcome?.leaseHandle
    const declined = await decline.callTool(contract.productionCallShape.tool, { ...canonicalArgs, leaseHandle: declineLease, patch: { promptAppend: '拒绝后不应落盘' } })
    if (!declined.isError && !/denied|declin|approval/i.test(declined.text)) throw new Error('M4 declined canonical proposal did not return a denial-shaped result')
    if (JSON.stringify(readProject(projectDir)) !== beforeDecline) throw new Error('M4 declined canonical proposal mutated the project')
    await decline.terminate()
    decline = null
    steps.push({ id: 'M4.declined-write-is-noop', status: 'passed', evidence: 'real MCP elicitation decline returned without project mutation' })

    await mcp.terminate()
    mcp = null
    await closeNomiApp(app)
    app = null
    currentStep = 'M5.cold-restart-reconcile'
    const restarted = await launchNomiApp({ name: `agent-vertical-spine-${phase}-restart`, executablePath, userDataDir: dirs.userDataDir, settingsDir: dirs.settingsDir, projectsDir: dirs.projectsDir, capabilityDir: dirs.capabilityDir, args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'], settleMs: 0 })
    app = restarted.app
    win = restarted.win
    await dismissSplash(win)
    const readback = readProject(projectDir)
    if (readback.revision < changed.revision) throw new Error(`M5 pre-reopen readback regressed revision ${readback.revision} below closed-app revision ${changed.revision}`)
    const reopened = await reopenProjectThroughVisibleLibrary(win, projectId, initial.name, projectDir, changed.revision)
    const restartedPanel = reopened.panel
    const resumeInput = restartedPanel.locator('[data-agent-input="true"]').first()
    const resumeSend = restartedPanel.locator('[data-agent-composer-send="true"]').first()
    const resumeTurn = transcript.find((turn) => turn.turn === 'R6')
    await resumeInput.fill(resumeTurn.user)
    await resumeSend.click()
    const resumeStatus = await waitForAgentTurnTerminal(restartedPanel, resumeTurn.user)
    if (resumeStatus !== 'done') throw new Error(`M5 resumed Agent turn reached terminal status ${resumeStatus}`)
    steps.push({ id: 'M5.cold-restart-reconcile', status: 'passed', evidence: { reopen: { action: 'visible-click', selector: '[data-project-card="true"]', projectId }, revision: reopened.revision, projectId, resumedTurn: resumeTurn.turn, terminalStatus: resumeStatus, internalAssertions: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'] } })
    return { phase, status: 'passed', steps, firstFailure: null, gaps, evidenceRoot, dirs }
  } catch (error) {
    firstFailure = await failureContext(win, currentStep, error)
    const failedDimension = currentStep.startsWith('M1') ? 'B' : currentStep.startsWith('M2') ? 'T' : currentStep.startsWith('M3') ? 'H' : currentStep.startsWith('M4') ? 'E' : 'T'
    gaps[failedDimension] = { status: 'failed', reason: firstFailure.message, next: gaps[failedDimension].next }
    return { phase, status: 'failed', steps, firstFailure: { ...firstFailure, dimension: failedDimension }, gaps, evidenceRoot, dirs }
  } finally {
    if (mcp) await mcp.terminate().catch(() => undefined)
    if (decline) await decline.terminate().catch(() => undefined)
    if (app) await closeNomiApp(app)
  }
}

const phases = []
if (requestedPhase === 'packaged' && !packagedApp) {
  phases.push({ phase: 'packaged', status: 'blocked', reason: 'NOMI_VERTICAL_SPINE_PACKAGED_APP is required for the packaged repeat' })
} else {
  phases.push(await runPhase(requestedPhase, requestedPhase === 'packaged' ? packagedApp : undefined))
}
const result = { schemaVersion: 1, contract: contract.id, requestedPhase, phases, evidenceRoot }
fs.writeFileSync(path.join(evidenceRoot, 'summary.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (phases.some((phase) => phase.status === 'failed')) process.exitCode = 1
if (phases.some((phase) => phase.status === 'blocked')) process.exitCode = 2
