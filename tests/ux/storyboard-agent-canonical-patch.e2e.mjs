// Real Electron canonical storyboard user task.
// The journey starts the app, opens a persisted project, starts the real MCP stdio
// server, calls nomi_canvas_edit(operation=patch_shots), and checks disk + restart
// （2026-09-05：画布语义写在 MCP 上收敛成一个工具名，operation 语义一个字没变）
// readback. It deliberately uses no provider, UI selector, static projection, or
// legacy direct patch_shots tool name.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'

const dirs = makeIsolatedDirs('nomi-storyboard-canonical-patch-')
const projectId = 'storyboard-canonical-patch-e2e'
const projectRoot = path.join(dirs.projectsDir, projectId)
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const receiptFile = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
const binding = {
  immutableProjectUuid: '6b0f4a39-1ae4-4e1e-8b2e-0b9460a67a51',
  projectGeneration: 1,
}
const initialPlan = {
  title: '雨夜追凶',
  anchors: [],
  shots: [
    { index: 1, shotKind: 'image', durationSec: 5, anchorIds: ['hero'], prompt: '未选镜头：保持原样', subtitle: '不要改' },
    { index: 2, shotKind: 'video', durationSec: 8, anchorIds: ['hero'], prompt: '选中镜头：跟拍', subtitle: '也保持原样', params: { aspect_ratio: '16:9', quality: 'high' } },
    { index: 3, shotKind: 'image', durationSec: 5, anchorIds: [], prompt: '另一未选镜头：保持原样' },
  ],
}
const initialPayload = {
  workbenchDocuments: [{
    id: 'storyboard-doc', version: 1, title: '雨夜追凶', updatedAt: 1,
    contentJson: { type: 'doc', content: [] },
  }],
  activeDocumentId: 'storyboard-doc',
  timeline: null,
  generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
  storyboardDesignsByDocumentId: { 'storyboard-doc': [{ id: 'storyboard-design', documentId: 'storyboard-doc', title: initialPlan.title, plan: initialPlan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1 }] },
}
const initialProject = {
  id: projectId,
  name: 'Canonical storyboard patch journey',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  ...binding,
  payload: initialPayload,
}

fs.mkdirSync(path.dirname(projectFile), { recursive: true })
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(initialProject, null, 2), 'utf8')
fs.writeFileSync(projectFile, JSON.stringify(initialProject, null, 2), 'utf8')

let gui = null
let mcp = null
let appErrors = []
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`STORYBOARD CANONICAL PATCH FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}
const readPersistedProject = () => JSON.parse(fs.readFileSync(projectFile, 'utf8'))
const readReceipt = () => JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
async function waitFor(label, read, predicate, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timeout waiting for ${label}`)
}
async function openProject(instance) {
  // Navigate the real app document with the project route before React mounts.
  // A post-mount hash mutation can make disk reads pass while the app's Host
  // projection is still absent, which would not be a valid receipt journey.
  const appUrl = `${pathToFileURL(path.join(process.cwd(), 'dist', 'index.html')).href}#/studio?projectId=${encodeURIComponent(projectId)}`
  await instance.win.goto(appUrl, { waitUntil: 'domcontentloaded' })
  await instance.win.waitForFunction((id) => window.location.hash.includes(`projectId=${encodeURIComponent(id)}`), projectId, { timeout: 10_000 })
  // This is a real preload project read after app hydration, not a static DOM probe.
  await instance.win.waitForFunction(async (id) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    return record?.id === id && record?.payload?.storyboardDesignsByDocumentId?.['storyboard-doc']?.[0]?.plan?.shots?.length === 3
  }, projectId, { timeout: 15_000 })
}

try {
  gui = await launchNomiApp({
    name: 'storyboard-agent-canonical-patch',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
    settleMs: 0,
  })
  appErrors = []
  gui.win.on('console', (message) => { if (message.type() === 'error') appErrors.push(message.text()) })
  gui.win.on('pageerror', (error) => appErrors.push(`pageerror: ${error.message}`))
  await openProject(gui)
  // Disk hydration can satisfy the bridge read before the app's Host open has
  // installed its projection. Allow the real renderer lifecycle to finish
  // before the MCP request; no synthetic state is injected here.
  await gui.win.waitForTimeout(2_000)
  console.log('  · app route/bridge:', await gui.win.evaluate(() => ({
    href: window.location.href,
    hasSurfaceBridge: Boolean(window.nomiDesktop?.surface),
    hasProjectAgentBridge: Boolean(window.nomiDesktop?.projectAgent),
  })))
  check(true, 'Electron app started and hydrated the persisted storyboard project through the real preload bridge')

  mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'canonical-storyboard-e2e', version: '1' },
    capabilities: { elicitation: {} },
    captureStderr: true,
  })
  check(Boolean((await mcp.initialize())?.result), 'real MCP stdio client initialized against the Electron capability core')
  const opened = parseToolResult(await mcp.callTool('nomi_session_open', {
    bootstrap: { mode: 'current_project' },
  }))
  console.log('  · session/open raw:', opened.text.slice(0, 300))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  check(typeof leaseHandle === 'string' && leaseHandle.length > 20, 'current-project session returned a verified lease')
  const canvasRead = parseToolResult(await mcp.callTool('nomi_read', {
    target: 'canvas', projectId, leaseHandle,
  }))
  console.log('  · canvas/read raw:', canvasRead.text.slice(0, 500))

  const selectedArgs = {
    projectId,
    leaseHandle,
    operation: 'patch_shots',
    select: { kind: 'indexes', indexes: [2] },
    patch: { promptAppend: '雨天', aspectRatio: '9:16' },
  }
  const result = parseToolResult(await mcp.callToolOrThrow('nomi_canvas_edit', selectedArgs))
  check(mcp.elicitationCount() === 1, 'real MCP user task was explicitly approved through elicitation before the write')
  check(result.json?.operation === 'patch_shots' || result.outcome?.operation === 'patch_shots', 'MCP result identifies the canonical patch_shots operation')
  check((result.json?.changedShotIndexes || result.outcome?.changedShotIndexes || []).join(',') === '2', 'selection injection reaches only row 2')
  check((result.json?.changedFields || result.outcome?.changedFields || []).includes('prompt'), 'canonical result reports the changed prompt field')

  const changed = await waitFor('persisted canonical patch', async () => readPersistedProject(), (record) => {
    const shots = record.payload.storyboardDesignsByDocumentId['storyboard-doc'][0].plan.shots
    return shots[1].prompt === '选中镜头：跟拍，雨天' && shots[1].params.aspect_ratio === '9:16'
  })
  const changedShots = changed.payload.storyboardDesignsByDocumentId['storyboard-doc'][0].plan.shots
  check(changedShots[0].prompt === initialPlan.shots[0].prompt && changedShots[0].subtitle === initialPlan.shots[0].subtitle, 'unselected row 1 remains byte-equivalent in untouched fields')
  check(changedShots[2].prompt === initialPlan.shots[2].prompt, 'unselected row 3 remains unchanged')
  check(changedShots[1].params.quality === 'high' && changedShots[1].subtitle === initialPlan.shots[1].subtitle, 'unmentioned selected-row fields remain unchanged')

  const receipt = await waitFor('committed proposal receipt', async () => readReceipt(), (value) => value.lifecycle === 'committed')
  const resultProposalId = result.json?.proposalId || result.outcome?.proposalId
  console.log('  · receipt raw:', fs.readFileSync(receiptFile, 'utf8'))
  check(receipt.lifecycle === 'committed', 'durable receipt is committed')
  check(typeof receipt.proposalId === 'string' && receipt.proposalId === resultProposalId, 'receipt covers the canonical result proposal id')
  check(receipt.proposal?.hostApprovalId === undefined && receipt.proposal?.hostActionHash === undefined, 'receipt does not forge an unclaimed Host approval correlation')
  await mcp.terminate()
  mcp = null
  await gui.close()
  gui = null

  gui = await launchNomiApp({
    name: 'storyboard-agent-canonical-patch-restart',
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
    settleMs: 0,
  })
  await openProject(gui)
  console.log('  · app route/bridge:', await gui.win.evaluate(() => ({
    href: window.location.href,
    hasSurfaceBridge: Boolean(window.nomiDesktop?.surface),
    hasProjectAgentBridge: Boolean(window.nomiDesktop?.projectAgent),
  })))
  const restartReadback = await gui.win.evaluate(async (id) => window.nomiDesktop.projects.readAsync(id), projectId)
  const restartShots = restartReadback.payload.storyboardDesignsByDocumentId['storyboard-doc'][0].plan.shots
  check(restartShots[1].prompt === '选中镜头：跟拍，雨天' && restartShots[1].params.aspect_ratio === '9:16', 'cold Electron restart reads back the persisted canonical patch')
  check(readReceipt().lifecycle === 'committed' && readReceipt().proposalId === resultProposalId, 'cold restart keeps the same committed receipt')
  console.log(`\nSTORYBOARD CANONICAL PATCH PASS: ${passed} assertions — MCP canonical entry → Electron bridge → real store/persistence → receipt → restart readback.`)
} catch (error) {
  if (mcp) console.error('MCP stderr:', mcp.stderrText().slice(-1200))
  if (gui) console.error('Electron renderer errors:', appErrors?.slice(-10))
  console.error(`\n${error?.stack || error}`)
  process.exitCode = 1
} finally {
  if (mcp) await mcp.terminate().catch(() => undefined)
  if (gui) await gui.close().catch(() => undefined)
}
