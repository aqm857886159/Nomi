#!/usr/bin/env node
// R1-F: real editor/Agent/tool-host/IPC/SDK/disk path, also runnable against Nomi.app.
// No adapter call, renderer module import, seeded project or production fixture.
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import path from 'node:path'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, CREATION_PANEL, DOCUMENT, chooseAssistantModel, createRuntimeWalk, hasToolResult,
  newConversation, openCanvas, readCurrentProjectAgentHostSnapshot, readCurrentProjectAgentToolEvidence, readProject,
  recorded, requireCurrentPersistedWorkbenchDocument,
  selectConversationAt, sendCanvas, sendCreation, toolNames,
} from './agent-runtime-walk-support.mjs'

const ORIGINAL = '清晨，创作者打开咖啡馆的门。她将红色杯子放到白色桌面，整理相机，再坐下来准备一天的拍摄。窗外的自然光照亮杯沿，背景保持简洁。'
const A_PROMPT = 'F_A_文稿追加：在文末加一句收尾。'
// Editor writes intentionally parse Markdown; use a literal, non-formatting marker.
const APPEND = 'FAPPROVEDAPPEND：她按下录制键。'
const DOC_TOOL = 'f-doc-append-1'
const CANVAS_TOOL = 'f-canvas-create-1'
const B_PROMPT = 'F_B_独立对话：只回复这条新消息。'
const RESUMED_REPLY = 'F_RESTORED：我记得已批准的追加及其工具结果。'
const DOC_TOOLS = ['load_skill', 'nomi_document_edit', 'nomi_document_read'].sort()
const CANVAS_TOOLS = ['load_skill', 'nomi_canvas_edit', 'nomi_canvas_plan', 'nomi_canvas_read',
  'nomi_generation_plan', 'nomi_generation_status'].sort()

function readCurrentAgentConversations(settingsRoot, projectRoot) {
  const state = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  if (!state) return null
  const turns = new Map(state.turns.map((turn) => [turn.turnId, turn]))
  return {
    creation: {
      activeId: state.activeThreadId,
      threads: state.threads.map((thread) => ({
        id: thread.threadId,
        messages: state.items
          .filter((item) => item.threadId === thread.threadId && (item.kind === 'user' || item.kind === 'assistant'))
          .filter((item) => turns.get(item.turnId)?.capabilityVersions.some(({ id }) => id === 'creation-editor'))
          .map((item) => ({ id: item.itemId, role: item.kind, content: item.text })),
      })),
    },
  }
}

function threadState(state, threadId) {
  return {
    thread: state.threads.find((thread) => thread.threadId === threadId),
    turns: state.turns.filter((turn) => turn.threadId === threadId),
    items: state.items.filter((item) => item.threadId === threadId),
    queue: state.queue.filter((item) => item.threadId === threadId),
  }
}

const walk = await createRuntimeWalk('editing')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  const settingsRoot = path.join(walk.report.tempRoot, 'settings')
  await chooseAssistantModel(win, 'agent-runtime-loopback/agent-runtime-text')
  const document = win.locator(DOCUMENT)
  await document.fill(ORIGINAL)
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { message: 'Human typing must reach the real saved project', timeout: 30_000 }).toContain(ORIGINAL)

  const appendRequest = walk.fixture.expectText({
    label: 'creation-editor proposes a real append',
    match: (body) => flattenRequestText(body).includes(A_PROMPT) && !hasToolResult(body, DOC_TOOL),
    reply: { type: 'tool', id: DOC_TOOL, name: 'nomi_document_edit', args: { operation: 'append', content: APPEND } },
  })
  const appendFollowup = walk.fixture.expectText({
    label: 'document execution result returns to the model',
    match: (body) => hasToolResult(body, DOC_TOOL),
    reply: { type: 'text', text: 'F_DOC_DONE：已按你的批准追加。' },
  })
  await sendCreation(win, A_PROMPT)
  const docWire = await recorded(appendRequest.received, 'creation editor HTTP request')
  expect(toolNames(docWire.body), 'The real editor profile advertises precisely its six tools').toEqual(DOC_TOOLS)
  // 出厂审批档是 safe-auto（electron/shared/projectAgentContracts.ts:60-63）：
  // document.write 的 effectClass 是 reversible_local 且不需要计划审阅，于是它**不弹审批卡**，
  // 直接应用并留收据（projectAgentExecutionPolicy.ts:83-88）。
  // 这条走查原来在这里等一张卡再去点「批准」——那是 step 档的行为。审批分档合入后产品不再
  // 那样跑，走查却没跟着改，于是它在 main 上一直红着，报的还是「面板没渲染」这种误导人的话。
  // 现在验的是**产品真正的承诺**：可逆本地写自动落，落完仍然有完整证据链（下面那段 evidence）。
  await recorded(appendFollowup.received, 'auto-applied document tool result')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"][data-agent-stop="true"]`)).toHaveCount(0)
  await expect(document).toContainText(APPEND)
  expect((await document.innerText()).split(APPEND), '自动落也只能落一次，不许重放成两段').toHaveLength(2)
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { timeout: 30_000 }).toContain(APPEND)
  await walk.snap('document-auto-applied')
  await clickOrFail(win.locator('[aria-label="文本工具栏"]').getByRole('button', { name: '撤销', exact: true }), '撤销实际文稿变更')
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { timeout: 30_000 }).not.toContain(APPEND)
  await walk.snap('document-undone')

  await expect.poll(() => {
    const evidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write')
    return Boolean(evidence?.tool?.status === 'done'
      && evidence.tool.resultRef
      && evidence.proposal?.approval?.toolCallId
      && evidence.receipt?.lifecycle === 'committed'
      && evidence.receipt.proposal?.hostApprovalId === evidence.proposal.approval.approvalId
      && evidence.receipt.proposal?.proposalId === evidence.proposal.approval.receiptProposalId)
  }, { message: 'Full real tool result evidence must bind Host tool item, approval and disk receipt, not only chat bubbles', timeout: 30_000 }).toBe(true)
  const documentEvidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write')
  expect(documentEvidence.tool).toMatchObject({ kind: 'tool', status: 'done', resultRef: expect.any(String) })
  expect(documentEvidence.proposal?.approval?.toolCallId).toBeTruthy()
  expect(documentEvidence.receipt).toMatchObject({
    lifecycle: 'committed',
    proposal: {
      hostApprovalId: documentEvidence.proposal.approval.approvalId,
      proposalId: documentEvidence.proposal.approval.receiptProposalId,
    },
  })
  const creationA = {
    threadId: documentEvidence.proposal.approval.threadId,
    state: documentEvidence.state,
  }
  expect(creationA.threadId).toMatch(/^thread-/)

  await openCanvas(win)
  const createArgs = {
    summary: 'F_CANVAS：两张镜头卡和一条参考关系。',
    nodes: [
      { clientId: 'f-source', kind: 'image', title: 'F_SOURCE', prompt: '清晨红色杯子，正面中景。',
        modelKey: FIXTURE_IMAGE_MODEL, modeId: 't2i', params: { size: '1024x1024' } },
      { clientId: 'f-target', kind: 'image', title: 'F_TARGET', prompt: '同一只红色杯子，侧面近景。',
        modelKey: FIXTURE_IMAGE_MODEL, modeId: 'edit', params: { size: '1024x1024' } },
    ],
    edges: [{ sourceClientId: 'f-source', targetClientId: 'f-target', mode: 'reference' }],
  }
  const canvasRequest = walk.fixture.expectText({
    label: 'canvas-agent proposes linked nodes',
    match: (body) => flattenRequestText(body).includes('F_CANVAS_REQUEST') && !hasToolResult(body, CANVAS_TOOL),
    reply: { type: 'tool', id: CANVAS_TOOL, name: 'nomi_canvas_edit', args: { operation: 'create_canvas_nodes', ...createArgs } },
  })
  const canvasFollowup = walk.fixture.expectText({
    label: 'canvas receipt returns exactly once',
    match: (body) => hasToolResult(body, CANVAS_TOOL),
    reply: { type: 'text', text: 'F_CANVAS_DONE：两张卡已落画布。' },
  })
  await sendCanvas(win, 'F_CANVAS_REQUEST：创建两个杯子镜头并连接参考，不要生成。')
  const canvasWire = await recorded(canvasRequest.received, 'canvas HTTP request')
  expect(toolNames(canvasWire.body)).toEqual(CANVAS_TOOLS)
  // 同上：canvas.write 也是 reversible_local，safe-auto 档下自动落，不弹卡。
  // 「用户能读到它做了什么」这条承诺没变——两个镜头的标题必须出现在面板的工具明细里。
  expect(walk.fixture.images, '落画布不许顺手触发生成').toHaveLength(0)
  await recorded(canvasFollowup.received, 'canvas tool result')
  const canvasToolLine = win.locator(`${CANVAS_PANEL} [data-agent-tool-line="true"]`).last()
  await proveProbe(canvasToolLine, '落画布之后，面板上有这次工具调用的那一行')
  // 自动落之后，用户能读到的那句话就是这一行的无障碍名。它必须说清「建了卡、没有去生成」
  // ——safe-auto 不问自答，这一行就是唯一的交代。
  await expect(canvasToolLine.locator('button[aria-expanded]').last(),
    '落画布那一行要说清它做了什么').toHaveAttribute('aria-label', /只建卡.*不生成/)
  await walk.snap('canvas-auto-applied')
  await expect(win.locator(CANVAS_PANEL)).toContainText('F_CANVAS_DONE')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 2, edges: 1 })
  const landed = (await readProject(win, projectId)).payload.generationCanvas
  const sourceId = landed.nodes.find((node) => node.title === 'F_SOURCE').id
  const targetId = landed.nodes.find((node) => node.title === 'F_TARGET').id
  expect(landed.edges[0]).toMatchObject({ source: sourceId, target: targetId })
  const receipt = win.locator(`${CANVAS_PANEL} [data-agent-proposal-receipt="true"]`).last()
  await proveProbe(receipt, 'A committed canvas proposal has an Undo receipt')
  await expect.poll(() => {
    const evidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'canvas.write')
    return Boolean(evidence?.tool?.status === 'done'
      && evidence.proposal?.approval?.toolCallId
      && evidence.receipt?.lifecycle === 'committed'
      && evidence.receipt.proposal?.hostApprovalId === evidence.proposal.approval.approvalId
      && evidence.receipt.proposal?.proposalId === evidence.proposal.approval.receiptProposalId)
  }, { timeout: 30_000 }).toBe(true)
  const canvasEvidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'canvas.write')
  const proposalId = canvasEvidence?.receipt?.proposalId
  expect(proposalId).toBeTruthy()
  await walk.snap('canvas-committed')
  // 先证明这颗撤销钮真的能被探针找到，下面两处「撤销过就不该再有撤销钮」才不是空话。
  const undoButtonProof = await proveProbe(receipt.locator('[data-agent-receipt-undo="true"]'), '收据上的整笔撤销钮可见')
  await clickOrFail(receipt.locator('[data-agent-receipt-undo="true"]'), '整笔撤销画布提案')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    const evidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'canvas.write')
    return {
      nodes: canvas.nodes.length,
      edges: canvas.edges.length,
      toolStatus: evidence?.tool?.status ?? null,
      receiptLifecycle: evidence?.receipt?.lifecycle ?? null,
      receiptOperationId: evidence?.receipt?.operationId ?? null,
      receiptProposalId: evidence?.receipt?.proposalId ?? null,
    }
  }, { timeout: 30_000 }).toEqual({
    nodes: 0,
    edges: 0,
    toolStatus: 'done',
    receiptLifecycle: 'undone',
    receiptOperationId: `proposal-undo-complete:${proposalId}`,
    receiptProposalId: proposalId,
  })
  await expect(receipt, 'Undo keeps the immutable audit receipt visible').toHaveCount(1)
  await expect(receipt).toHaveAttribute('data-agent-proposal-receipt', 'true')
  await expectAbsent(receipt.locator('[data-agent-receipt-undo="true"]'),
    { provenBy: undoButtonProof, message: 'An undone receipt cannot trigger Undo again' })
  expect(walk.fixture.images).toHaveLength(0)

  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '回到原创作对话')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  const stoppedRequest = walk.fixture.expectText({
    label: 'a streaming turn which the user stops',
    match: (body) => flattenRequestText(body).includes('F_STOP_REQUEST'),
    reply: { type: 'hold', text: 'F_STOP_PARTIAL：正在检查。' },
  })
  await sendCreation(win, 'F_STOP_REQUEST：先检查原稿，等我决定再改。')
  await recorded(stoppedRequest.received, 'streaming request before Stop')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_STOP_PARTIAL')
  await clickOrFail(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"][data-agent-stop="true"]`), '停止在途模型请求')
  await expect(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"]:not([data-agent-stop])`)).toBeVisible()
  const stoppedAssistant = win.locator(`${CREATION_PANEL} [data-agent-item-kind="assistant"][data-agent-status="stopped"]`).last()
  await expect(stoppedAssistant, 'A stopped assistant item remains visible with its terminal status').toBeVisible()
  await expect(stoppedAssistant.locator('[data-agent-status-label="stopped"]'), 'The retained stopped turn has an explicit user-facing marker').toHaveText('已停止')
  stoppedRequest.release({ type: 'tool', id: 'f-late-write', name: 'nomi_document_edit', args: { operation: 'append', content: 'F_FORBIDDEN_LATE_WRITE' } })
  // 「晚到的写入不许落」这条以前是靠「审批卡没冒出来」来证的。safe-auto 档下可逆写本来就
  // 不弹卡，那条缺席断言于是恒真——换成直接查**文稿本身**：晚到的写入真落了，这段文字就会
  // 出现在编辑器和盘上，这是个有值的判据，不是空话。
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    '被停止的请求不许把晚到的写入落到盘上').not.toContain('F_FORBIDDEN_LATE_WRITE')
  const savedA = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write')
  expect(savedA?.tool?.status).toBe('done')
  expect(savedA?.proposal?.approval?.threadId).toBe(creationA.threadId)
  const savedAThreadState = threadState(readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write').state, creationA.threadId)
  await walk.snap('stopped-without-late-write')

  await newConversation(win, CREATION_PANEL)
  const bRequest = walk.fixture.expectText({
    label: 'new thread B is independent from A',
    match: (body) => flattenRequestText(body).includes(B_PROMPT),
    reply: { type: 'text', text: 'F_B_DONE：这是一条独立的新对话。' },
  })
  await sendCreation(win, B_PROMPT)
  const bWire = await recorded(bRequest.received, 'new thread B request')
  expect(flattenRequestText(bWire.body)).not.toContain(A_PROMPT)
  expect(hasToolResult(bWire.body, DOC_TOOL)).toBe(false)
  await expect(win.locator(CREATION_PANEL)).toContainText('F_B_DONE')
  await expect.poll(() => readCurrentAgentConversations(settingsRoot, projectRoot)?.creation.threads.length,
    { timeout: 30_000 }).toBe(2)
  const conversationsB = readCurrentAgentConversations(settingsRoot, projectRoot)
  expect(conversationsB.creation.activeId).not.toBe(creationA.threadId)
  const originalBubbles = conversationsB.creation.threads.find((thread) => thread.id === creationA.threadId)
    .messages.map(({ id, role, content }) => ({ id, role, content }))
  expect(originalBubbles.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(originalBubbles[1].content).toContain('F_DOC_DONE')
  expect(originalBubbles[3].content).toContain('F_STOP_PARTIAL')
  expect(threadState(readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write').state, creationA.threadId)).toEqual(savedAThreadState)
  await walk.snap('independent-thread-b')

  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_B_DONE')
  const coldConversations = readCurrentAgentConversations(settingsRoot, projectRoot)
  expect(coldConversations.creation.threads.find((thread) => thread.id !== creationA.threadId)?.messages.at(-1)?.content).toContain('F_B_DONE')
  await selectConversationAt(win, CREATION_PANEL, 0)
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  expect(threadState(readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write').state, creationA.threadId)).toEqual(savedAThreadState)
  const resume = walk.fixture.expectText({
    label: 'cold restored A contains native tool history',
    match: (body) => flattenRequestText(body).includes('F_RESUME_A'),
    reply: { type: 'text', text: RESUMED_REPLY },
  })
  await sendCreation(win, 'F_RESUME_A：回顾刚才已批准的操作，不要再次执行。')
  const restoredWire = await recorded(resume.received, 'cold restored request')
  // A resident thread's history is the durable Pi context, so a cold restart
  // restores the real tool call and its result rather than a prose retelling.
  // The tool is never re-executed: only the recorded result travels.
  expect(hasToolResult(restoredWire.body, DOC_TOOL)).toBe(true)
  expect(flattenRequestText(restoredWire.body)).toContain(A_PROMPT)
  expect(flattenRequestText(restoredWire.body)).not.toContain(B_PROMPT)
  const resumedEvidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'document.write')
  const resumedDocumentTools = resumedEvidence.state.items.filter((item) => item.kind === 'tool' && item.capability?.id === 'document.write')
  expect(resumedDocumentTools).toHaveLength(1)
  expect(resumedDocumentTools[0]).toMatchObject({ status: 'done', resultRef: expect.any(String) })
  const provenanceKeys = resumedDocumentTools[0].provenance.map(({ source, sourceRef }) => `${source}:${sourceRef}`)
  expect(new Set(provenanceKeys).size).toBe(provenanceKeys.length)
  expect(resumedEvidence.receipt).toMatchObject({ lifecycle: 'undone', proposalId })
  await expect(win.locator(CREATION_PANEL)).toContainText('F_RESTORED')
  await expect(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"][data-agent-stop="true"]`)).toHaveCount(0)
  const assistantBubbles = win.locator(`${CREATION_PANEL} [data-agent-reply="true"]`)
  await expect(assistantBubbles).toHaveCount(4)
  await expect(assistantBubbles.nth(0), 'A resumed reply must not overwrite an older bubble with the same ID').toContainText('F_DOC_DONE')
  await expect(assistantBubbles.nth(1)).toContainText('F_CANVAS_DONE')
  await expect(assistantBubbles.nth(2)).toContainText('F_STOP_PARTIAL')
  await expect(assistantBubbles.last(), 'The new reply belongs at the end of the resumed conversation').toContainText('F_RESTORED')
  await expect(win.locator(`${CREATION_PANEL} [data-agent-user-bubble="true"]`)).toHaveCount(4)
  await expect.poll(async () => {
    const saved = readCurrentAgentConversations(settingsRoot, projectRoot)
    return { activeId: saved.creation.activeId,
      reply: saved.creation.threads.find((thread) => thread.id === creationA.threadId)?.messages.at(-1)?.content }
  }, { message: 'The completed resumed turn must be saved before the app closes', timeout: 30_000 })
    .toEqual({ activeId: creationA.threadId, reply: RESUMED_REPLY })
  const resumedBubbles = readCurrentAgentConversations(settingsRoot, projectRoot).creation.threads
    .find((thread) => thread.id === creationA.threadId).messages
  expect(resumedBubbles).toHaveLength(originalBubbles.length + 2)
  expect(resumedBubbles.slice(0, originalBubbles.length).map(({ id, role, content }) => ({ id, role, content })))
    .toEqual(originalBubbles)
  expect(new Set(resumedBubbles.map((message) => message.id)).size, 'Message identity must remain unique after a cold restart')
    .toBe(resumedBubbles.length)
  expect(resumedBubbles.slice(-2).map((message) => message.role)).toEqual(['user', 'assistant'])
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '冷重启后生成工作区')
  await expect(win.locator(CANVAS_PANEL)).toBeVisible()
  const coldCanvasReceipt = win.locator(`${CANVAS_PANEL} [data-agent-proposal-receipt="true"]`).last()
  await expect(coldCanvasReceipt, 'Cold start keeps the undone audit receipt').toHaveCount(1)
  await expectAbsent(coldCanvasReceipt.locator('[data-agent-receipt-undo="true"]'),
    { provenBy: undoButtonProof, message: 'Cold start must not restore an undone action' })
  const coldCanvas = (await readProject(win, projectId)).payload.generationCanvas
  expect({ nodes: coldCanvas.nodes.length, edges: coldCanvas.edges.length }).toEqual({ nodes: 0, edges: 0 })
  const coldCanvasEvidence = readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, 'canvas.write')
  expect(coldCanvasEvidence?.tool?.status).toBe('done')
  expect(coldCanvasEvidence?.receipt).toMatchObject({ lifecycle: 'undone', proposalId })
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart + 1)
  expect(walk.report.launches[1].pid).not.toBe(walk.report.launches[0].pid)
  await walk.snap('cold-restored-native-context')
  walk.fixture.assertClean()
  walk.report.verified = ['creation-approval-apply-undo', 'canvas-linked-proposal-undo',
    'real-stream-stop-no-late-write', 'new-thread-isolation', 'cold-native-tool-history-no-reexecution',
    'cold-resume-keeps-old-bubbles-and-persists-unique-new-messages']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
