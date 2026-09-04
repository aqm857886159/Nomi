#!/usr/bin/env node
// Real user task: visible Resident Composer -> real Agent/Host proposal -> approval -> durable receipt,
// then the same isolated GUI project through the real MCP stdio production write boundary.
// No Host item, reducer state, conversation result, or final project state is injected.
import fs from 'node:fs'
import path from 'node:path'

import { clickOrFail, expect, proveProbe } from './_assert.mjs'
import { parseToolResult, spawnMcpStdioClient } from './_mcpJourney.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { DOCUMENT, createRuntimeWalk, readProject, recorded } from './agent-runtime-walk-support.mjs'

const ORIGINAL = '真实用户任务基线：创作者准备在文末补充收尾。'
const RESIDENT_INTENT = '请在文末补一句收尾，保留原文并等待我确认。'
const RESIDENT_APPEND = 'ResidentHostApproved她按下录制键，开始拍摄。'
const RESIDENT_TOOL = 'resident-mcp-alias-1'
const MCP_APPEND = 'McpStdioProductionWrite这次写入必须经过同一确认回执。'
const CREATION_PANEL = '[data-agent-resident="true"]'

async function sendResidentIntent(win, text) {
  const input = win.getByRole('textbox', { name: '给 Nomi 的消息', exact: true })
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.getByRole('button', { name: '发送', exact: true }), '发送 Resident Composer 意图')
}

const walk = await createRuntimeWalk('resident-composer-production')
let mcp
let failure
const blockers = []
walk.report.matrix = {
  H: { status: 'running', evidence: [] },
  B: { status: 'not-run', evidence: [] },
  E: { status: 'not-run', evidence: [] },
  T: { status: 'covered-by-contract', evidence: ['electron/capabilityCore/mcpRealUserJourneys.test.ts'] },
  N: { status: 'covered-by-contract', evidence: ['electron/capabilityCore/mcpRealUserJourneys.test.ts'] },
}
walk.report.blockers = blockers
function recordBlocker(code, message) {
  blockers.push({ code, message })
}
try {
  // The current catalog requires explicit publication evidence and refuses legacy plaintext
  // credentials for Agent execution. Keep the external dependency at the loopback boundary, but
  // make this isolated test vendor auth-free so no keychain or paid credential is involved.
  const catalogPath = path.join(walk.report.tempRoot, 'settings', 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  catalog.version = 12
  catalog.vendors[0].authType = 'none'
  catalog.apiKeysByVendor = {}
  catalog.models[0].meta = {
    ...(catalog.models[0].meta || {}),
    adapter: { activeRevision: 'resident-journey-v1', modes: [{ taskKind: 'chat', state: 'verified' }] },
  }
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })
  let { win } = await walk.start({ first: true })
  // Host is an explicit user preference. Set only the preference, reload, then create the project via UI.
  await win.evaluate(() => localStorage.setItem('nomi.agentHost.enabled', 'true'))
  await win.reload({ waitUntil: 'domcontentloaded' })

  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  const document = win.locator(DOCUMENT)
  await document.fill(ORIGINAL)
  await expect(document).toHaveText(ORIGINAL)
  await expect
    .poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
      message: 'Human-entered baseline must reach the real project persistence path',
      timeout: 30_000,
    })
    .toContain(ORIGINAL)
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '进入创作工作区')

  const proposalRequest = walk.fixture.expectText({
    label: 'Resident Composer plans a real document write',
    match: (body) =>
      flattenRequestText(body).includes(RESIDENT_INTENT) && !body.messages?.some((message) => message.role === 'tool'),
    reply: {
      type: 'tool',
      id: RESIDENT_TOOL,
      name: 'nomi_document_edit',
      args: { operation: 'append', content: RESIDENT_APPEND },
    },
  })
  const approvedFollowup = walk.fixture.expectText({
    label: 'Agent receives the real approved write result',
    match: (body) =>
      body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === RESIDENT_TOOL),
    reply: { type: 'text', text: '已按确认写入文稿，并保留可追溯回执。' },
  })
  await sendResidentIntent(win, RESIDENT_INTENT)
  await recorded(proposalRequest.received, 'the real Agent planning request')
  const approval = win.locator(`${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)
  await proveProbe(approval, 'Resident Composer shows a real pending approval')
  walk.report.matrix.H.evidence.push('visible intent -> real Agent planning request -> pending approval')
  await expect(document, 'A proposal must not mutate the document before user approval').toHaveText(ORIGINAL)
  await clickOrFail(approval.getByRole('button', { name: '批准', exact: true }), '用户确认 Resident 文稿提案')
  await recorded(approvedFollowup.received, 'the approved write result')
  await expect(document).toContainText(RESIDENT_APPEND)
  await expect
    .poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
      message: 'Approved Resident write must persist to the project',
      timeout: 30_000,
    })
    .toContain(RESIDENT_APPEND)
  await expect(
    approval.getByRole('button', { name: '批准', exact: true }),
    'An applied approval must no longer be actionable',
  ).toHaveCount(0)

  const receiptPath = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  const beforeMcp = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null
  if (!beforeMcp) {
    walk.report.matrix.H.status = 'blocked'
    walk.report.matrix.H.evidence.push(
      'project.json persisted the approved append, but .nomi/project-agent-proposal-receipt.json is absent',
    )
    recordBlocker(
      'resident-host-document-receipt-missing',
      'Resident Host document approval mutates project.json but does not persist the required durable proposal receipt/revision journal',
    )
  } else {
    expect(beforeMcp.lifecycle).toBe('committed')
    expect(beforeMcp.revision).toBeGreaterThan(0)
    walk.report.matrix.H.status = 'passed'
  }

  // Boundary B: the real Composer rejects an empty user task at the UI boundary; Unicode is
  // already exercised by the human-entered intent and approved document content above.
  const composerInput = win.getByRole('textbox', { name: '给 Nomi 的消息', exact: true })
  const composerSend = win.getByRole('button', { name: '发送', exact: true })
  await composerInput.fill('')
  await expect(composerSend, 'Empty Resident Composer intent must not be submitted').toBeDisabled()
  walk.report.matrix.B = {
    status: 'passed',
    evidence: ['real Composer empty input remains disabled', 'Unicode intent/content persisted through the real path'],
  }

  // Boundary E: a second real task is planned by the Agent, displayed as a real approval card,
  // and denied by the user. The document must remain unchanged.
  const rejectedAppend = 'RejectedResidentWrite不得写入。'
  const rejectedRequest = walk.fixture.expectText({
    label: 'Resident Composer rejection proposal',
    match: (body) =>
      flattenRequestText(body).includes('请提出一个需要拒绝的收尾') &&
      !body.messages?.some((message) => message.role === 'tool'),
    reply: {
      type: 'tool',
      id: 'resident-mcp-rejected-1',
      name: 'nomi_document_edit',
      args: { operation: 'append', content: rejectedAppend },
    },
  })
  const rejectedFollowup = walk.fixture.expectText({
    label: 'Agent receives the real denied write result',
    match: (body) =>
      body.messages?.some((message) => message.role === 'tool' && message.tool_call_id === 'resident-mcp-rejected-1'),
    reply: { type: 'text', text: '已记录拒绝，本次没有写入文稿。' },
  })
  await sendResidentIntent(win, '请提出一个需要拒绝的收尾，不要自行写入。')
  await recorded(rejectedRequest.received, 'the real rejection proposal')
  const rejectedApproval = win.locator(
    `${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`,
  )
  await proveProbe(rejectedApproval, 'Resident Composer shows the rejection approval')
  await clickOrFail(rejectedApproval.getByRole('button', { name: '拒绝', exact: true }), '用户拒绝 Resident 文稿提案')
  await recorded(rejectedFollowup.received, 'the denied write result')
  await expect(document).not.toContainText(rejectedAppend)
  walk.report.matrix.E = { status: 'passed', evidence: ['real approval card -> user refusal -> no project mutation'] }

  const tempRoot = walk.report.tempRoot
  mcp = spawnMcpStdioClient({
    settingsDir: path.join(tempRoot, 'settings'),
    userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'),
    capabilityDir: path.join(tempRoot, 'capability'),
    captureStderr: true,
    env: { NOMI_RPC_TIMEOUT_MS: '2_000' },
  })
  await mcp.initialize()
  const opened = parseToolResult(await mcp.callTool('nomi_session_open', { bootstrap: { mode: 'current_project' } }))
  const leaseHandle = opened.json?.leaseHandle || opened.outcome?.leaseHandle
  expect(leaseHandle, 'Real MCP stdio must open the current GUI project session').toBeTruthy()
  const mcpResult = parseToolResult(
    await mcp.callTool('nomi_document_edit', {
      leaseHandle,
      projectId,
      operation: 'append',
      content: MCP_APPEND,
    }),
  )
  expect(mcpResult.isError, 'The real production MCP write must return a typed result').toBe(false)
  await expect
    .poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocuments), {
      message: 'Real MCP stdio write must be observable in the open project',
      timeout: 30_000,
    })
    .toContain(MCP_APPEND)

  const afterMcp = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null
  if (!afterMcp) {
    walk.report.matrix.N = {
      status: 'blocked',
      evidence: ['real MCP stdio write changed project.json while the shared Host receipt file remained absent'],
    }
    recordBlocker(
      'mcp-stdio-bypasses-resident-receipt',
      'Real MCP stdio document.write reaches the production dispatcher and persists content, but does not mint or advance the Resident Host receipt/revision journal',
    )
  } else if (!beforeMcp || afterMcp.revision <= beforeMcp.revision) {
    walk.report.matrix.N = {
      status: 'blocked',
      evidence: ['real MCP stdio write did not advance the shared Host receipt revision'],
    }
    recordBlocker(
      'mcp-stdio-revision-not-advanced',
      'Real MCP stdio document.write did not advance the shared Resident Host receipt/revision journal',
    )
  } else {
    expect(afterMcp.lifecycle).toBe('committed')
  }

  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '打开 Resident Composer')
  await expect(win.locator(DOCUMENT)).toContainText(RESIDENT_APPEND)
  await expect(win.locator(DOCUMENT)).toContainText(MCP_APPEND)
  expect(walk.report.launches[1].pid).not.toBe(walk.report.launches[0].pid)
  walk.report.restart = {
    status: 'passed',
    firstPid: walk.report.launches[0].pid,
    secondPid: walk.report.launches[1].pid,
    readBack: [RESIDENT_APPEND, MCP_APPEND],
  }
  if (blockers.length) failure = new Error(blockers.map(({ code, message }) => `${code}: ${message}`).join('\n'))
} catch (error) {
  failure = error
} finally {
  if (mcp) await mcp.terminate().catch(() => {})
  walk.report.coverage = {
    changedProductionScope: [],
    v8: 'not-applicable',
    reason: 'This change adds test/docs only; no production source was modified.',
  }
  await walk.finish(failure)
}

if (failure) process.exitCode = 1
