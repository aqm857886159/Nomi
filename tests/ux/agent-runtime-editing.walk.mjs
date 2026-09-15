#!/usr/bin/env node
import { stationTimeout } from './_station-budget.mjs'
// R1-F: real editor/Agent/tool-host/IPC/SDK/disk path, also runnable against Nomi.app.
// No adapter call, renderer module import, seeded project or production fixture.
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE, CANVAS_PANEL, COMPOSER, COMPOSER_SEND, CREATION_PANEL, DOCUMENT, TOOL_RECEIPT,
  USER_BUBBLE, chooseAssistantModel, createRuntimeWalk, hasToolResult,
  newConversation, openCanvas, readProject, readProjectAgentProposalReceipt,
  recorded, requireCurrentPersistedWorkbenchDocument,
  selectConversation, sendCanvas, sendCreation, toolNames, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { laneMessages, laneMessageText, readLaneTranscripts } from './agent-lane-observer.mjs'
import { residentToolNames } from './agent-runtime-walk-support.mjs'

const ORIGINAL = '清晨，创作者打开咖啡馆的门。她将红色杯子放到白色桌面，整理相机，再坐下来准备一天的拍摄。窗外的自然光照亮杯沿，背景保持简洁。'
const A_PROMPT = 'F_A_文稿追加：在文末加一句收尾。'
// Editor writes intentionally parse Markdown; use a literal, non-formatting marker.
const APPEND = 'FAPPROVEDAPPEND：她按下录制键。'
const DOC_TOOL = 'f-doc-append-1'
const CANVAS_TOOL = 'f-canvas-create-1'
const B_PROMPT = 'F_B_独立对话：只回复这条新消息。'
const RESUMED_REPLY = 'F_RESTORED：我记得已批准的追加及其工具结果。'
const TOOLS = residentToolNames()

function toolEvidence(projectRoot, toolCallId) {
  const session = readLaneTranscripts(projectRoot).find((lane) => laneMessages(lane)
    .some((message) => message.role === 'toolResult' && message.toolCallId === toolCallId))
  if (!session) return undefined
  return {
    session,
    results: laneMessages(session).filter((message) => message.role === 'toolResult' && message.toolCallId === toolCallId),
    calls: laneMessages(session).filter((message) => message.role === 'assistant').flatMap((message) => message.content)
      .filter((part) => part.type === 'toolCall' && part.id === toolCallId),
    approvals: session.entries.filter((entry) => entry.type === 'custom' && entry.customType === 'nomi.ui.approval'
      && entry.data.toolCallId === toolCallId),
    authorities: session.entries.filter((entry) => entry.type === 'custom' && entry.customType === 'nomi.ui.receipt-authority'
      && entry.data.toolCallId === toolCallId),
  }
}

function assertCommittedWrite(projectRoot, toolCallId) {
  const evidence = toolEvidence(projectRoot, toolCallId)
  expect(evidence.calls).toHaveLength(1)
  expect(evidence.results).toEqual([expect.objectContaining({ toolCallId, isError: false })])
  expect(evidence.approvals).toEqual([expect.objectContaining({ data: expect.objectContaining({ decision: 'auto-granted' }) })])
  expect(evidence.authorities).toHaveLength(1)
  const authority = evidence.authorities[0].data
  const receipt = readProjectAgentProposalReceipt(projectRoot)
  expect(receipt).toMatchObject({ lifecycle: 'committed', proposalId: authority.receiptProposalId,
    proposal: { proposalId: authority.receiptProposalId, hostApprovalId: authority.approvalId, hostActionHash: authority.actionHash } })
  return { session: evidence.session, receipt }
}

// Preserve the actual SDK entry id and payload; exclude tool-only assistant entries from bubble counts.
const conversationEntries = (session) => session.entries.filter((entry) => entry.type === 'message'
  && (entry.message.role === 'nomi.input' || entry.message.role === 'assistant' && laneMessageText(entry.message)))

const walk = await createRuntimeWalk('editing')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  const document = win.locator(DOCUMENT)
  await document.fill(ORIGINAL)
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    { message: 'Human typing must reach the real saved project', timeout: 30_000 }).toContain(ORIGINAL)

  const appendRequest = walk.fixture.expectText({
    label: 'creation-editor proposes a real append',
    match: (body) => flattenRequestText(body).includes(A_PROMPT) && !hasToolResult(body, DOC_TOOL),
    reply: { type: 'tool', id: DOC_TOOL, name: 'append_to_end', args: { content: APPEND } },
  })
  const appendFollowup = walk.fixture.expectText({
    label: 'document execution result returns to the model',
    match: (body) => hasToolResult(body, DOC_TOOL),
    reply: { type: 'text', text: 'F_DOC_DONE：已按你的批准追加。' },
  })
  await sendCreation(win, A_PROMPT)
  const docWire = await recorded(appendRequest.received, 'creation editor HTTP request')
  expect(toolNames(docWire.body), 'The actual lane advertises its assembled default tools').toEqual(TOOLS)
  // safe-auto applies reversible local edits without an extra approval; disk receipts prove authority.
  await recorded(appendFollowup.received, 'auto-applied document tool result')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"]`)).toHaveCount(0)
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

  const creationA = assertCommittedWrite(projectRoot, DOC_TOOL).session
  expect(creationA.laneName).toBe('main')
  expect(creationA.sessionId).toMatch(/^[a-f0-9-]{36}$/)

  await openCanvas(win)
  // 20 动词：画布写动词造不出会生成的镜头（那只归 draft_shots）；这条走查证的是 canvas.write 的
  // 收据/撤销通路，所以用 make_artifact 落一件手艺产物（同一条 canvas.write 契约、同一份收据）。
  const createArgs = { fileType: 'markdown', title: 'F_SOURCE', content: '# F_CANVAS\n清晨红色杯子，正面中景。' }
  const canvasRequest = walk.fixture.expectText({
    label: 'canvas-agent proposes linked nodes',
    match: (body) => flattenRequestText(body).includes('F_CANVAS_REQUEST') && !hasToolResult(body, CANVAS_TOOL),
    reply: { type: 'tool', id: CANVAS_TOOL, name: 'make_artifact', args: createArgs },
  })
  const canvasFollowup = walk.fixture.expectText({
    label: 'canvas receipt returns exactly once',
    match: (body) => hasToolResult(body, CANVAS_TOOL),
    reply: { type: 'text', text: 'F_CANVAS_DONE：备注已落画布。' },
  })
  await sendCanvas(win, 'F_CANVAS_REQUEST：把开场备注放到画布上，不要生成。')
  const canvasWire = await recorded(canvasRequest.received, 'canvas HTTP request')
  expect(toolNames(canvasWire.body)).toEqual(TOOLS)
  // 同上：canvas.write 也是 reversible_local，safe-auto 档下自动落，不弹卡。
  // 「用户能读到它做了什么」这条承诺没变——两个镜头的标题必须出现在面板的工具明细里。
  expect(walk.fixture.images, '落画布不许顺手触发生成').toHaveLength(0)
  await recorded(canvasFollowup.received, 'canvas tool result')
  const canvasToolLine = win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last()
  await proveProbe(canvasToolLine, '落画布之后，面板上有这次工具调用的那一行')
  // 自动落之后，用户能读到的那句话就写在这一行上（v4 一行收据：动作名 + 摘要 + 状态）。
  // 它必须说清「建了卡、没有去生成」——safe-auto 不问自答，这一行就是唯一的交代。
  await expect(canvasToolLine, '落画布那一行要说清它做了什么').toContainText(/F_SOURCE|产物/)
  await walk.snap('canvas-auto-applied')
  await expect(win.locator(CANVAS_PANEL)).toContainText('F_CANVAS_DONE')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 1, edges: 0 })
  const landed = (await readProject(win, projectId)).payload.generationCanvas
  expect(landed.nodes.find((node) => node.title === 'F_SOURCE')).toBeTruthy()
  // v4：提案收据就是那条一行收据本身（`data-v4-block="tool"`），整笔撤销是它行尾的「撤销」钮
  // （`ToolReceipt.undoable` 渲染出来的那颗）。
  const receipt = win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last()
  await proveProbe(receipt, 'A committed canvas proposal has an Undo receipt')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL,
    settledBy: win.locator(CANVAS_PANEL).getByText('F_CANVAS_DONE：备注已落画布。', { exact: true }) })
  const canvasEvidence = assertCommittedWrite(projectRoot, CANVAS_TOOL)
  expect(canvasEvidence.session.sessionId).toBe(creationA.sessionId)
  const proposalId = canvasEvidence.receipt.proposalId
  await walk.snap('canvas-committed')
  // 先证明这颗撤销钮真的能被探针找到，下面两处「撤销过就不该再有撤销钮」才不是空话。
  const undoButton = receipt.getByRole('button', { name: '撤销', exact: true })
  const undoButtonProof = await proveProbe(undoButton, '收据上的整笔撤销钮可见')
  await clickOrFail(undoButton, '整笔撤销画布提案')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    const evidence = toolEvidence(projectRoot, CANVAS_TOOL)
    const savedReceipt = readProjectAgentProposalReceipt(projectRoot)
    return {
      nodes: canvas.nodes.length,
      edges: canvas.edges.length,
      toolSucceeded: evidence?.results[0]?.isError === false,
      receiptLifecycle: savedReceipt?.lifecycle ?? null,
      receiptOperationId: savedReceipt?.operationId ?? null,
      receiptProposalId: savedReceipt?.proposalId ?? null,
    }
  }, { timeout: stationTimeout({ operations: 2 }) }).toEqual({
    nodes: 0,
    edges: 0,
    toolSucceeded: true,
    receiptLifecycle: 'undone',
    receiptOperationId: `proposal-undo-complete:${proposalId}`,
    receiptProposalId: proposalId,
  })
  await expect(receipt, 'Undo keeps the immutable audit receipt visible').toHaveCount(1)
  await expect(receipt).toHaveAttribute('data-v4-block', 'tool')
  await expectAbsent(receipt.getByRole('button', { name: '撤销', exact: true }),
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
  // v4：发送与停止是同一颗钮，运行中由 composer 的 data-mode="running" 标记。
  await clickOrFail(win.locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`), '停止在途模型请求')
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}:not([data-mode="running"]) ${COMPOSER_SEND}`)).toBeVisible()
  // 助手文本三态里，被打断的那一态是 `interrupted`（灰字 + 一个「继续」出口）。
  const stoppedAssistant = win.locator(`${CREATION_PANEL} ${ASSISTANT_MESSAGE}[data-status="interrupted"]`).last()
  await expect(stoppedAssistant, 'A stopped assistant item remains visible with its terminal status').toBeVisible()
  await expect(stoppedAssistant.getByRole('button', { name: '继续', exact: true }),
    'The retained stopped turn has an explicit user-facing marker').toBeVisible()
  stoppedRequest.release({ type: 'tool', id: 'f-late-write', name: 'append_to_end', args: { content: 'F_FORBIDDEN_LATE_WRITE' } })
  // 「晚到的写入不许落」这条以前是靠「审批卡没冒出来」来证的。safe-auto 档下可逆写本来就
  // 不弹卡，那条缺席断言于是恒真——换成直接查**文稿本身**：晚到的写入真落了，这段文字就会
  // 出现在编辑器和盘上，这是个有值的判据，不是空话。
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(JSON.stringify(requireCurrentPersistedWorkbenchDocument(await readProject(win, projectId))),
    '被停止的请求不许把晚到的写入落到盘上').not.toContain('F_FORBIDDEN_LATE_WRITE')
  const savedA = toolEvidence(projectRoot, DOC_TOOL)
  expect(savedA.results).toHaveLength(1)
  expect(savedA.session.sessionId).toBe(creationA.sessionId)
  const savedABytes = savedA.session.bytes
  const originalEntries = conversationEntries(savedA.session)
  expect(originalEntries.map((entry) => entry.message.role))
    .toEqual(['nomi.input', 'assistant', 'nomi.input', 'assistant', 'nomi.input', 'assistant'])
  expect(laneMessageText(originalEntries[1].message)).toContain('F_DOC_DONE')
  expect(laneMessageText(originalEntries[3].message)).toContain('F_CANVAS_DONE')
  expect(laneMessageText(originalEntries[5].message)).toContain('F_STOP_PARTIAL')
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
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('F_B_DONE：这是一条独立的新对话。', { exact: true }) })
  const conversationsB = readLaneTranscripts(projectRoot)
  expect(conversationsB).toHaveLength(2)
  const b = conversationsB.find((session) => session.sessionId !== creationA.sessionId)
  expect(laneMessages(b).filter((message) => message.role === 'nomi.input').map(laneMessageText)).toEqual([B_PROMPT])
  expect(toolEvidence(projectRoot, DOC_TOOL).session.bytes).toBe(savedABytes)
  await walk.snap('independent-thread-b')

  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: project.name })
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_B_DONE')
  expect(laneMessageText(laneMessages(readLaneTranscripts(projectRoot).find((session) => session.sessionId === b.sessionId)).at(-1))).toContain('F_B_DONE')
  await selectConversation(win, CREATION_PANEL, '未命名对话')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  expect(toolEvidence(projectRoot, DOC_TOOL).session.bytes).toBe(savedABytes)
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
  const resumedEvidence = toolEvidence(projectRoot, DOC_TOOL)
  expect(resumedEvidence.results).toHaveLength(1)
  expect(resumedEvidence.calls).toHaveLength(1)
  expect(resumedEvidence.authorities).toHaveLength(1)
  expect(readProjectAgentProposalReceipt(projectRoot)).toMatchObject({ lifecycle: 'undone', proposalId })
  await expect(win.locator(CREATION_PANEL)).toContainText('F_RESTORED')
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"]`)).toHaveCount(0)
  const assistantBubbles = win.locator(`${CREATION_PANEL} ${ASSISTANT_MESSAGE}`)
  await expect(assistantBubbles).toHaveCount(4)
  await expect(assistantBubbles.nth(0), 'A resumed reply must not overwrite an older bubble with the same ID').toContainText('F_DOC_DONE')
  await expect(assistantBubbles.nth(1)).toContainText('F_CANVAS_DONE')
  await expect(assistantBubbles.nth(2)).toContainText('F_STOP_PARTIAL')
  await expect(assistantBubbles.last(), 'The new reply belongs at the end of the resumed conversation').toContainText('F_RESTORED')
  await expect(win.locator(`${CREATION_PANEL} ${USER_BUBBLE}`)).toHaveCount(4)
  const resumedEntries = conversationEntries(toolEvidence(projectRoot, DOC_TOOL).session)
  expect(resumedEntries).toHaveLength(originalEntries.length + 2)
  expect(resumedEntries.slice(0, originalEntries.length)).toEqual(originalEntries)
  expect(new Set(resumedEntries.map((entry) => entry.id)).size).toBe(resumedEntries.length)
  expect(resumedEntries.slice(-2).map((entry) => entry.message.role)).toEqual(['nomi.input', 'assistant'])
  expect(laneMessageText(resumedEntries.at(-1).message)).toBe(RESUMED_REPLY)
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '冷重启后生成工作区')
  await expect(win.locator(CANVAS_PANEL)).toBeVisible()
  const coldCanvasReceipt = win.locator(`${CANVAS_PANEL} ${TOOL_RECEIPT}`).last()
  await expect(coldCanvasReceipt, 'Cold start keeps the undone audit receipt').toHaveCount(1)
  await expectAbsent(coldCanvasReceipt.getByRole('button', { name: '撤销', exact: true }),
    { provenBy: undoButtonProof, message: 'Cold start must not restore an undone action' })
  const coldCanvas = (await readProject(win, projectId)).payload.generationCanvas
  expect({ nodes: coldCanvas.nodes.length, edges: coldCanvas.edges.length }).toEqual({ nodes: 0, edges: 0 })
  expect(toolEvidence(projectRoot, CANVAS_TOOL).results[0].isError).toBe(false)
  expect(readProjectAgentProposalReceipt(projectRoot)).toMatchObject({ lifecycle: 'undone', proposalId })
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
