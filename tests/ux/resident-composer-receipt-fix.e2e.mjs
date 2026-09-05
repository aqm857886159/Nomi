#!/usr/bin/env node
// Real user task: visible Resident Composer -> real Agent/Host proposal -> user approval or
// refusal -> durable proposal receipt -> real MCP stdio document write -> cold restart readback.
// The model is deterministic only at the external provider boundary. This file never injects
// Host items, reducer state, conversation results, receipt files, or the final project state.
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { DOCUMENT, createRuntimeWalk, hasToolResult, openCanvas, readProject, recorded } from './agent-runtime-walk-support.mjs'

const ORIGINAL = '真实用户任务基线：创作者准备在文末补充收尾。'
const RESIDENT_INTENT = '请在文末补一句收尾，保留原文并等待我确认。'
const RESIDENT_APPEND = 'ResidentHostApproved她按下录制键，开始拍摄。'
const MCP_APPEND = 'McpStdioProductionWrite这次写入必须经过同一确认回执。'
const CREATION_PANEL = '[data-agent-resident="true"]'

async function sendResidentIntent(win, text) {
  const input = win.getByRole('textbox', { name: '给 Nomi 的消息', exact: true })
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.getByRole('button', { name: '发送', exact: true }), '发送 Resident Composer 意图')
}

const walk = await createRuntimeWalk('resident-composer-receipt-fix')
let mcp
let failure
const blockers = []
walk.report.matrix = {
  H: { status: 'running', evidence: [] },
  B: { status: 'not-run', evidence: [] },
  E: { status: 'not-run', evidence: [] },
  T: { status: 'covered-by-contract', evidence: ['electron/capabilityCore/mcpRealUserJourneys.test.ts'] },
  N: { status: 'running', evidence: [] },
}
walk.report.blockers = blockers
function recordBlocker(code, message) {
  blockers.push({ code, message })
}

try {
  // Use the deterministic loopback provider only at the provider HTTP boundary. The Agent,
  // Host, approval UI, project repository, and MCP stdio process remain production paths.
  const catalogPath = path.join(walk.report.tempRoot, 'settings', 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  catalog.version = 12
  catalog.vendors[0].authType = 'none'
  catalog.apiKeysByVendor = {}
  catalog.models[0].meta = {
    ...(catalog.models[0].meta || {}),
    adapter: { activeRevision: 'resident-receipt-fix-v1', modes: [{ taskKind: 'chat', state: 'verified' }] },
  }
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })

  let { win } = await walk.start({ first: true })

  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  const document = win.locator(DOCUMENT)
  await document.fill(ORIGINAL)
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
    message: 'Human-entered baseline must reach the real project persistence path',
    timeout: 30_000,
  }).toContain(ORIGINAL)
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '进入创作工作区')

  // Matchers key on this turn's own tool_call_id, never on "no tool message at all":
  // the Host owns one lossless resident thread, so every later request carries the
  // earlier turns' tool calls and results.
  const proposalRequest = walk.fixture.expectText({
    label: 'Resident Composer plans a real document write',
    match: (body) => flattenRequestText(body).includes(RESIDENT_INTENT)
      && !hasToolResult(body, 'resident-receipt-fix-1'),
    reply: {
      type: 'tool', id: 'resident-receipt-fix-1', name: 'nomi_document_edit',
      args: { operation: 'append', content: RESIDENT_APPEND },
    },
  })
  const approvedFollowup = walk.fixture.expectText({
    label: 'Agent receives the real approved write result',
    match: (body) => hasToolResult(body, 'resident-receipt-fix-1'),
    reply: { type: 'text', text: '已按确认写入文稿，并保留可追溯回执。' },
  })
  await sendResidentIntent(win, RESIDENT_INTENT)
  await recorded(proposalRequest.received, 'the real Agent planning request')
  const approval = win.locator(`${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)
  const composerProof = await proveProbe(win.locator(CREATION_PANEL), 'Resident Composer renders the real planning surface')
  await expectAbsent(approval, {
    provenBy: composerProof,
    message: 'A reversible local document edit is auto-approved in safe-auto mode',
  })
  walk.report.matrix.H.evidence.push('visible intent -> real Agent planning request -> safe-auto reversible write without a card')
  await recorded(approvedFollowup.received, 'the auto-approved write result')
  await expect(document).toContainText(RESIDENT_APPEND)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
    message: 'Auto-approved Resident write must persist to the project',
    timeout: 30_000,
  }).toContain(RESIDENT_APPEND)
  const receiptPath = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  const beforeMcp = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null
  if (!beforeMcp) {
    walk.report.matrix.H.status = 'blocked'
    walk.report.matrix.H.evidence.push('project persistence succeeded but durable receipt file was absent')
    recordBlocker('resident-host-document-receipt-missing',
      'Host approval changed the project but did not persist a durable proposal receipt')
  } else {
    expect(beforeMcp.lifecycle).toBe('committed')
    expect(beforeMcp.revision).toBeGreaterThan(0)
    expect(beforeMcp.proposal?.stepLabels?.[0]).toMatch(/^append:/)
    walk.report.matrix.H.status = 'passed'
    walk.report.persistence = { receiptPath, hostReceipt: beforeMcp }
  }

  // B: the real Composer rejects empty input and preserves Unicode through the same UI path.
  const composerInput = win.getByRole('textbox', { name: '给 Nomi 的消息', exact: true })
  const composerSend = win.getByRole('button', { name: '发送', exact: true })
  await composerInput.fill('')
  await expect(composerSend, 'Empty Resident Composer intent must not be submitted').toBeDisabled()
  walk.report.matrix.B = {
    status: 'passed', evidence: ['real Composer empty input remains disabled', 'Unicode content persisted through H'],
  }

  await openCanvas(win)
  await expect(win.locator(`${CREATION_PANEL}[data-agent-surface="generation"]`)).toBeVisible()

  const canvasCreateRequest = walk.fixture.expectText({
    label: 'Resident Composer creates a reversible canvas fixture node',
    match: (body) => flattenRequestText(body).includes('请创建一个临时图片节点')
      && !hasToolResult(body, 'resident-receipt-fix-canvas-create'),
    reply: {
      type: 'tool', id: 'resident-receipt-fix-canvas-create', name: 'nomi_canvas_edit',
      args: {
        operation: 'create_canvas_nodes', summary: 'resident receipt approval fixture',
        nodes: [{ clientId: 'resident-receipt-fix-node', kind: 'image', title: 'Resident approval fixture', prompt: 'temporary approval fixture', modelKey: 'agent-runtime-image', modeId: 't2i', params: { size: '1024x1024' } }],
      },
    },
  })
  const canvasCreateFollowup = walk.fixture.expectText({
    label: 'Agent receives the canvas fixture result',
    match: (body) => hasToolResult(body, 'resident-receipt-fix-canvas-create'),
    reply: { type: 'text', text: '已创建临时画布节点。' },
  })
  await sendResidentIntent(win, '请创建一个临时图片节点，只用于接下来验证审批。')
  const canvasCreateWire = await recorded(canvasCreateRequest.received, 'the real canvas fixture request')
  // One resident thread spans both surfaces, so a canvas turn still carries the creation
  // turn's tool result. A matcher may only exclude *this* turn's own tool_call_id.
  expect(hasToolResult(canvasCreateWire.body, 'resident-receipt-fix-1'),
    'The canvas turn must still carry the earlier creation turn\'s tool result').toBe(true)
  await recorded(canvasCreateFollowup.received, 'the canvas fixture result')
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length, {
    message: 'Canvas fixture node must persist before the irreversible proposal', timeout: 30_000,
  }).toBeGreaterThan(0)
  const canvasNodesBeforeDelete = (await readProject(win, projectId)).payload.generationCanvas.nodes
  const fixtureNodeId = canvasNodesBeforeDelete.at(-1).id
  const fixtureNode = win.locator(`.generation-canvas-v2-node[data-node-id="${fixtureNodeId}"]`)
  await expect(fixtureNode).toBeVisible()
  await fixtureNode.click({ position: { x: 12, y: 12 } })
  await expect(fixtureNode).toHaveAttribute('data-selected', 'true')

  // E: a real gated action is denied at the UI approval boundary. Approval/spend
  // policy no longer lives in the work-mode popover; use an irreversible canvas
  // maintenance action so the default safe-auto posture still has to show the
  // intervention card without spending provider credits.
  const rejectedRequest = walk.fixture.expectText({
    label: 'Resident Composer gated-action rejection proposal',
    match: (body) => flattenRequestText(body).includes('请提出一个需要拒绝的删除动作')
      && !hasToolResult(body, 'resident-receipt-fix-rejected'),
    reply: {
      type: 'tool', id: 'resident-receipt-fix-rejected', name: 'nomi_canvas_maintenance',
      args: { operation: 'delete_canvas_nodes', nodeIds: [fixtureNodeId], reason: 'journey approval gate' },
    },
  })
  const rejectedFollowup = walk.fixture.expectText({
    label: 'Agent receives the real denied gated-action result',
    match: (body) => hasToolResult(body, 'resident-receipt-fix-rejected'),
    reply: { type: 'text', text: '已记录拒绝，本次没有删除画布内容。' },
  })
  await sendResidentIntent(win, '请提出一个需要拒绝的删除动作，不要自行删除。')
  await recorded(rejectedRequest.received, 'the real gated-action proposal')
  const rejectedApprovalCard = win.locator(`${CREATION_PANEL} [data-agent-intervention-slot="true"]`).last()
  await expect(rejectedApprovalCard).toHaveAttribute('data-agent-approval-state', 'pending')
  await proveProbe(rejectedApprovalCard, 'Resident Composer shows a real irreversible approval')
  await expect(rejectedApprovalCard.locator('[data-agent-approval-scope="once"]')).toHaveCount(1)
  await expect(rejectedApprovalCard.locator('[data-agent-approval-scope="session"]')).toHaveCount(0)
  await expect(rejectedApprovalCard.locator('[data-agent-approval-scope="always"]')).toHaveCount(0)
  await expect(rejectedApprovalCard.locator('[data-agent-intervention-boundary="true"]')).toBeVisible()
  await rejectedApprovalCard.locator('[data-agent-reject-reason]').fill('这次先不删，保留镜头待复核。')
  await walk.snap('irreversible-approval-with-reason')
  await clickOrFail(rejectedApprovalCard.getByRole('button', { name: '拒绝', exact: true }), '用户拒绝 Resident 删除提案')
  await recorded(rejectedFollowup.received, 'the denied gated-action result')
  await expect(win.locator(`${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)).toHaveCount(0)
  await walk.snap('irreversible-rejection-receipt')
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes.map((node) => node.id)).toContain(fixtureNodeId)
  walk.report.matrix.E = { status: 'passed', evidence: ['irreversible action -> real approval card -> refusal -> no project mutation'] }
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '返回创作工作区')

  // N: use a separately spawned production MCP stdio Electron process. Elicitation accepts the
  // user's confirmation, then the GUI RPC boundary owns the same project-bound receipt service.
  const tempRoot = walk.report.tempRoot
  mcp = spawnMcpStdioClient({
    settingsDir: path.join(tempRoot, 'settings'), userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'), capabilityDir: path.join(tempRoot, 'capability'),
    captureStderr: true, env: { NOMI_RPC_TIMEOUT_MS: '2_000' },
  })
  walk.report.mcpPid = mcp.child.pid
  await mcp.initialize()
  const opened = parseToolResult(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  expect(leaseHandle, 'Real MCP stdio must open the current GUI project session').toBeTruthy()
  const mcpResult = parseToolResult(await mcp.callTool('nomi_document_edit', {
    leaseHandle, projectId, operation: 'append', content: MCP_APPEND,
  }))
  expect(mcpResult.isError, 'Real production MCP write must return a typed success result').toBe(false)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
    message: 'Real MCP stdio write must be observable in the open project', timeout: 30_000,
  }).toContain(MCP_APPEND)
  const afterMcp = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null
  if (!afterMcp) {
    walk.report.matrix.N.status = 'blocked'
    recordBlocker('mcp-stdio-bypasses-resident-receipt',
      'MCP stdio changed project persistence but did not mint a durable receipt')
  } else if (!beforeMcp || afterMcp.revision <= beforeMcp.revision) {
    walk.report.matrix.N.status = 'blocked'
    recordBlocker('mcp-stdio-revision-not-advanced',
      'MCP stdio document.write did not advance the shared receipt revision')
  } else {
    expect(afterMcp.lifecycle).toBe('committed')
    expect(afterMcp.proposal?.summary).toContain('MCP')
    walk.report.matrix.N = { status: 'passed', evidence: ['stdio process', 'MCP elicitation', 'GUI RPC', 'revision advanced'], afterMcp }
  }

  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '打开 Resident Composer')
  await expect(win.locator(DOCUMENT)).toContainText(RESIDENT_APPEND)
  await expect(win.locator(DOCUMENT)).toContainText(MCP_APPEND)
  expect(walk.report.launches[1].pid).not.toBe(walk.report.launches[0].pid)
  walk.report.restart = {
    status: 'passed', firstPid: walk.report.launches[0].pid, secondPid: walk.report.launches[1].pid,
    readBack: [RESIDENT_APPEND, MCP_APPEND],
  }
  if (blockers.length) failure = new Error(blockers.map(({ code, message }) => `${code}: ${message}`).join('\n'))
} catch (error) {
  failure = error
} finally {
  if (mcp) await mcp.terminate().catch(() => {})
  walk.report.paidCalls = 0
  walk.report.coverage = {
    changedProductionScope: [
      'electron/projectAgentHost/projectAgentTurnExecution.ts',
      'electron/capabilityCore/mcpDocumentWriteReceipt.ts',
      'electron/capabilityCore/mcpProtocol.ts',
      'electron/capabilityCore/rpcServer.ts',
      'src/workbench/capability/capabilityApplyHandler.ts',
    ],
    v8: 'recorded-by-focused-vitest-command',
    note: 'This Electron walk records the production effect; raw V8 receipt is produced separately.',
  }
  await walk.finish(failure)
}

if (failure) process.exitCode = 1
