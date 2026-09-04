// Real built Electron MCP user-task contract for the headless canvas.write slice.
// This is an executable post-build entry point; it deliberately does not reuse
// the legacy patch_shots journey or inject a renderer/store fake.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { assertBuilt, makeIsolatedDirs, parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'

assertBuilt()
const dirs = makeIsolatedDirs('nomi-canvas-write-receipt-')
const mcpOptions = {
  ...dirs,
  clientInfo: { name: 'OpenAI Codex', version: 'canvas-write-receipt-e2e' },
  capabilities: { elicitation: {} },
  captureStderr: true,
}

let mcp = null
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`CANVAS WRITE RECEIPT E2E FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}
const resultJson = (result) => parseToolResult(result).json || parseToolResult(result).outcome
const projectRootFor = (projectId) => fs.readdirSync(dirs.projectsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(dirs.projectsDir, entry.name))
  .find((root) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'project.json'), 'utf8')).id === projectId } catch { return false }
  })

try {
  mcp = spawnMcpStdioClient(mcpOptions)
  check(Boolean((await mcp.initialize())?.result), 'built Electron MCP stdio initializes')

  const project = resultJson(await mcp.callToolOrThrow('nomi_project_create', { name: 'Canvas receipt user task' }))
  check(typeof project?.id === 'string' && typeof project?.projectSelectionHandle === 'string', 'real MCP user task creates an isolated project and selection handle')
  const session = resultJson(await mcp.callToolOrThrow('nomi_session_open', { projectSelectionHandle: project.projectSelectionHandle }))
  check(typeof session?.leaseHandle === 'string', 'real MCP user task opens a verified project lease')

  const created = resultJson(await mcp.callToolOrThrow('nomi_canvas_edit', {
    projectId: project.id,
    leaseHandle: session.leaseHandle,
    operation: 'create_canvas_nodes',
    summary: 'Create one shot',
    nodes: [{ clientId: 'shot-1', kind: 'image', title: 'Shot 1', prompt: 'before' }],
  }))
  const nodeId = created?.clientIdToNodeId?.['shot-1']
  check(typeof nodeId === 'string', 'catalog-resolved canvas.write creates a real disk-backed node')

  const written = resultJson(await mcp.callToolOrThrow('nomi_canvas_edit', {
    projectId: project.id,
    leaseHandle: session.leaseHandle,
    operation: 'set_node_prompt',
    nodeId,
    prompt: 'after',
  }))
  const projectRoot = projectRootFor(project.id)
  const projectFile = path.join(projectRoot, '.nomi', 'project.json')
  const receiptFile = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  const persisted = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const persistedNode = persisted.payload.generationCanvas.nodes.find((node) => node.id === nodeId)
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  check(persistedNode?.prompt === 'after', 'real canvas.write changes the persisted project file')
  check(receipt.lifecycle === 'committed' && receipt.proposalId === written?.proposalId, 'committed durable receipt covers the returned proposal id')

  await mcp.terminate()
  mcp = spawnMcpStdioClient(mcpOptions)
  check(Boolean((await mcp.initialize())?.result), 'fresh built Electron MCP stdio restarts')
  const restartRead = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const restartReceipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
  check(restartRead.payload.generationCanvas.nodes.find((node) => node.id === nodeId)?.prompt === 'after', 'restart reads back the same canvas effect')
  check(restartReceipt.lifecycle === 'committed' && restartReceipt.proposalId === receipt.proposalId, 'restart keeps the same durable receipt')
  console.log(`CANVAS WRITE RECEIPT E2E PASS: ${passed} assertions — built Electron stdio → catalog/resolver → lease → dispatcher → disk → receipt → restart.`)
} catch (error) {
  if (mcp) console.error('MCP stderr:', mcp.stderrText().slice(-1200))
  console.error(error?.stack || error)
  process.exitCode = 1
} finally {
  if (mcp) await mcp.terminate().catch(() => undefined)
  fs.rmSync(dirs.tempRoot || os.tmpdir(), { recursive: true, force: true })
}
