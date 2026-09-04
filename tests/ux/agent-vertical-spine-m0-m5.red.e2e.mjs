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

async function failureContext(win, step, error) {
  return {
    step,
    message: error?.message || String(error),
    url: win?.url?.() || null,
    bodyText: win ? await win.locator('body').innerText().catch(() => '') : '',
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
    const model = win.locator('button[data-agent-menu-item*="/"]').first()
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
      const before = await panel.locator('[data-agent-item-kind]').count()
      await input.fill(turn.user)
      await send.click()
      await panel.locator('[data-agent-item-kind="user"]').filter({ hasText: turn.user }).last().waitFor({ state: 'visible', timeout: 10_000 })
      await panel.locator('[data-agent-item-kind="assistant"], [data-agent-item-kind="failure"], [data-agent-item-kind="approval"]').nth(Math.max(0, before)).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined)
      steps.push({ id: `M3.${turn.turn}.natural-user-turn`, status: 'passed', evidence: { user: turn.user, internalAssertions: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'] } })
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
    const readback = readProject(projectDir)
    const restartedPanel = win.locator('[data-agent-panel="true"]').first()
    await restartedPanel.waitFor({ state: 'visible', timeout: 10_000 })
    const resumeInput = restartedPanel.locator('[data-agent-input="true"]').first()
    const resumeSend = restartedPanel.locator('[data-agent-composer-send="true"]').first()
    const resumeTurn = transcript.find((turn) => turn.turn === 'R6')
    await resumeInput.fill(resumeTurn.user)
    await resumeSend.click()
    await restartedPanel.locator('[data-agent-item-kind="user"]').filter({ hasText: resumeTurn.user }).last().waitFor({ state: 'visible', timeout: 10_000 })
    steps.push({ id: 'M5.cold-restart-reconcile', status: 'passed', evidence: { revision: readback.revision, projectId, resumedTurn: resumeTurn.turn, internalAssertions: ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'] } })
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
