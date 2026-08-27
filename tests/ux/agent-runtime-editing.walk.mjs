#!/usr/bin/env node
// R1-F: real editor/Agent/tool-host/IPC/SDK/disk path, also runnable against Nomi.app.
// No adapter call, renderer module import, seeded project or production fixture.
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, CREATION_PANEL, DOCUMENT, chooseCreationMode, createRuntimeWalk, hasToolResult,
  newConversation, openCanvas, readConversations, readNativeContexts, readProject, recorded,
  selectConversation, sendCanvas, sendCreation, snapshotMessages, toolNames,
} from './agent-runtime-walk-support.mjs'

const ORIGINAL = '清晨，创作者打开咖啡馆的门。她将红色杯子放到白色桌面，整理相机，再坐下来准备一天的拍摄。窗外的自然光照亮杯沿，背景保持简洁。'
const A_PROMPT = 'F_A_文稿追加：在文末加一句收尾。'
// Editor writes intentionally parse Markdown; use a literal, non-formatting marker.
const APPEND = 'FAPPROVEDAPPEND：她按下录制键。'
const DOC_TOOL = 'f-doc-append-1'
const CANVAS_TOOL = 'f-canvas-create-1'
const B_PROMPT = 'F_B_独立对话：只回复这条新消息。'
const RESUMED_REPLY = 'F_RESTORED：我记得已批准的追加及其工具结果。'
const DOC_TOOLS = ['append_to_end', 'author_skill', 'insert_at_cursor', 'read_full_text', 'read_selection', 'replace_selection'].sort()
const CANVAS_TOOLS = ['arrange_storyboard_to_timeline', 'connect_canvas_edges', 'create_camera_move',
  'create_canvas_nodes', 'create_staging_reference', 'delete_canvas_nodes', 'propose_storyboard_plan',
  'read_canvas_state', 'run_generation_batch', 'set_node_prompt', 'tidy_canvas'].sort()

const walk = await createRuntimeWalk('editing')
let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  const document = win.locator(DOCUMENT)
  await document.fill(ORIGINAL)
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument),
    { message: 'Human typing must reach the real saved project', timeout: 30_000 }).toContain(ORIGINAL)
  await chooseCreationMode(win, 'script')

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
  expect(toolNames(docWire.body), 'The real editor profile advertises precisely its six tools').toEqual(DOC_TOOLS)
  const approval = win.locator(`${CREATION_PANEL} [data-tool-call-id="${DOC_TOOL}"]`)
  const approvalProof = await proveProbe(approval, 'A real document write approval is visible')
  await expect(document, 'A proposal must not mutate the live document').toHaveText(ORIGINAL)
  expect(JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument)).not.toContain(APPEND)
  await walk.snap('document-awaits-approval')
  await clickOrFail(approval.getByRole('button', { name: '应用', exact: true }), '批准文稿追加')
  await recorded(appendFollowup.received, 'approved document tool result')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(CREATION_PANEL).getByRole('button', { name: '停止生成', exact: true })).toBeHidden()
  await expect(document).toContainText(APPEND)
  expect((await document.innerText()).split(APPEND)).toHaveLength(2)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument),
    { timeout: 30_000 }).toContain(APPEND)
  await expectAbsent(approval, { provenBy: approvalProof, message: 'Applied approval is no longer actionable' })
  await clickOrFail(win.locator('[aria-label="文本工具栏"]').getByRole('button', { name: '撤销', exact: true }), '撤销实际文稿变更')
  await expect(document).toHaveText(ORIGINAL)
  await expect.poll(async () => JSON.stringify((await readProject(win, projectId)).payload.workbenchDocument),
    { timeout: 30_000 }).not.toContain(APPEND)
  await walk.snap('document-undone')

  await expect.poll(() => readNativeContexts(projectRoot)?.some((record) => record.snapshot
    && snapshotMessages(record).some((message) => message.role === 'toolResult' && message.toolCallId === DOC_TOOL)),
  { message: 'Full real tool result must be persisted in the new context, not only chat bubbles', timeout: 30_000 }).toBe(true)
  const creationA = readNativeContexts(projectRoot).find((record) => record.snapshot
    && snapshotMessages(record).some((message) => message.role === 'toolResult' && message.toolCallId === DOC_TOOL))
  expect(creationA.sessionKey).toBe(`nomi:workbench:${projectId}:creation`)
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
    reply: { type: 'tool', id: CANVAS_TOOL, name: 'create_canvas_nodes', args: createArgs },
  })
  const canvasFollowup = walk.fixture.expectText({
    label: 'canvas receipt returns exactly once',
    match: (body) => hasToolResult(body, CANVAS_TOOL),
    reply: { type: 'text', text: 'F_CANVAS_DONE：两张卡已落画布。' },
  })
  await sendCanvas(win, 'F_CANVAS_REQUEST：创建两个杯子镜头并连接参考，不要生成。')
  const canvasWire = await recorded(canvasRequest.received, 'canvas HTTP request')
  expect(toolNames(canvasWire.body)).toEqual(CANVAS_TOOLS)
  const plan = win.locator('[data-agent-plan-card="true"]')
  await expect(plan).toBeVisible()
  await expect(plan.locator('[data-plan-node-id]')).toHaveCount(2)
  const beforeCanvas = (await readProject(win, projectId)).payload.generationCanvas
  expect(beforeCanvas.nodes).toHaveLength(0)
  expect(beforeCanvas.edges).toHaveLength(0)
  expect(walk.fixture.images).toHaveLength(0)
  await walk.snap('canvas-proposal')
  await clickOrFail(plan.locator('[data-plan-confirm-all="true"]'), '批准两个节点及参考关系')
  await recorded(canvasFollowup.received, 'canvas tool result')
  await expect(win.locator(CANVAS_PANEL)).toContainText('F_CANVAS_DONE')
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 2, edges: 1 })
  const landed = (await readProject(win, projectId)).payload.generationCanvas
  const sourceId = landed.nodes.find((node) => node.title === 'F_SOURCE').id
  const targetId = landed.nodes.find((node) => node.title === 'F_TARGET').id
  expect(landed.edges[0]).toMatchObject({ source: sourceId, target: targetId })
  const receipt = win.locator('[data-committed-proposal-card]')
  const receiptProof = await proveProbe(receipt, 'A committed canvas proposal has an Undo receipt')
  const proposalId = await receipt.getAttribute('data-committed-proposal-card')
  expect(proposalId).toBeTruthy()
  await expect.poll(() => readNativeContexts(projectRoot)?.some((record) => record.snapshot
    && snapshotMessages(record).some((message) => message.role === 'toolResult'
      && message.toolCallId === CANVAS_TOOL && message.details?.proposalId === proposalId)),
  { timeout: 30_000 }).toBe(true)
  await walk.snap('canvas-committed')
  await clickOrFail(receipt.locator('[data-proposal-undo-all="true"]'), '整笔撤销画布提案')
  await expectAbsent(receipt, { provenBy: receiptProof, message: 'Undo consumes this proposal receipt' })
  await expect.poll(async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes.length, edges: canvas.edges.length }
  }, { timeout: 30_000 }).toEqual({ nodes: 0, edges: 0 })
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
  await clickOrFail(win.locator(CREATION_PANEL).getByRole('button', { name: '停止生成', exact: true }), '停止在途模型请求')
  await expect(win.locator(CREATION_PANEL).getByRole('button', { name: '创作 AI 发送', exact: true })).toBeVisible()
  await expect(win.locator(CREATION_PANEL)).toContainText('已停止')
  stoppedRequest.release({ type: 'tool', id: 'f-late-write', name: 'append_to_end', args: { content: 'F_FORBIDDEN_LATE_WRITE' } })
  await expectAbsent(win.locator(`${CREATION_PANEL} [data-tool-call-id="f-late-write"]`),
    { provenBy: approvalProof, message: 'Stopped request cannot publish a late approval' })
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  const savedA = readNativeContexts(projectRoot).find((record) => record.threadId === creationA.threadId)
  expect(snapshotMessages(savedA).filter((message) => message.role === 'toolResult' && message.toolCallId === DOC_TOOL)).toHaveLength(1)
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
  await expect.poll(async () => (await readConversations(win, projectId))?.creation.threads.length,
    { timeout: 30_000 }).toBe(2)
  const conversationsB = await readConversations(win, projectId)
  expect(conversationsB.creation.activeId).not.toBe(creationA.threadId)
  const originalBubbles = conversationsB.creation.threads.find((thread) => thread.id === creationA.threadId)
    .messages.map(({ id, role, content }) => ({ id, role, content }))
  expect(originalBubbles.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(originalBubbles[1].content).toContain('F_DOC_DONE')
  expect(originalBubbles[3].content).toContain('F_STOP_PARTIAL')
  expect(readNativeContexts(projectRoot).find((record) => record.threadId === creationA.threadId).snapshot).toBe(savedA.snapshot)
  await walk.snap('independent-thread-b')

  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  await clickOrFail(win.locator('[data-project-card="true"]').filter({ hasText: project.name }), '冷重启后打开同一项目')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_B_DONE')
  await selectConversation(win, CREATION_PANEL, A_PROMPT.slice(0, 24))
  await expect(win.locator(CREATION_PANEL)).toContainText('F_DOC_DONE')
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect(walk.fixture.requests).toHaveLength(requestsBeforeRestart)
  expect(readNativeContexts(projectRoot).find((record) => record.threadId === creationA.threadId).snapshot).toBe(savedA.snapshot)
  const resume = walk.fixture.expectText({
    label: 'cold restored A contains native tool history',
    match: (body) => flattenRequestText(body).includes('F_RESUME_A'),
    reply: { type: 'text', text: RESUMED_REPLY },
  })
  await sendCreation(win, 'F_RESUME_A：回顾刚才已批准的操作，不要再次执行。')
  const restoredWire = await recorded(resume.received, 'cold restored request')
  expect(hasToolResult(restoredWire.body, DOC_TOOL)).toBe(true)
  expect(flattenRequestText(restoredWire.body)).toContain(A_PROMPT)
  expect(flattenRequestText(restoredWire.body)).not.toContain(B_PROMPT)
  await expect(win.locator(CREATION_PANEL)).toContainText('F_RESTORED')
  await expect(win.locator(CREATION_PANEL).getByRole('button', { name: '停止生成', exact: true })).toBeHidden()
  const assistantBubbles = win.locator(`${CREATION_PANEL} [data-role="assistant"]`)
  await expect(assistantBubbles).toHaveCount(3)
  await expect(assistantBubbles.nth(0), 'A resumed reply must not overwrite an older bubble with the same ID').toContainText('F_DOC_DONE')
  await expect(assistantBubbles.nth(1)).toContainText('F_STOP_PARTIAL')
  await expect(assistantBubbles.last(), 'The new reply belongs at the end of the resumed conversation').toContainText('F_RESTORED')
  await expect(win.locator(`${CREATION_PANEL} [data-role="user"]`)).toHaveCount(3)
  await expect.poll(async () => {
    const saved = await readConversations(win, projectId)
    return { activeId: saved.creation.activeId,
      reply: saved.creation.threads.find((thread) => thread.id === creationA.threadId)?.messages.at(-1)?.content }
  }, { message: 'The completed resumed turn must be saved before the app closes', timeout: 30_000 })
    .toEqual({ activeId: creationA.threadId, reply: RESUMED_REPLY })
  const resumedBubbles = (await readConversations(win, projectId)).creation.threads
    .find((thread) => thread.id === creationA.threadId).messages
  expect(resumedBubbles).toHaveLength(originalBubbles.length + 2)
  expect(resumedBubbles.slice(0, originalBubbles.length).map(({ id, role, content }) => ({ id, role, content })))
    .toEqual(originalBubbles)
  expect(new Set(resumedBubbles.map((message) => message.id)).size, 'Message identity must remain unique after a cold restart')
    .toBe(resumedBubbles.length)
  expect(resumedBubbles.slice(-2).map((message) => message.role)).toEqual(['user', 'assistant'])
  await expect(win.locator(DOCUMENT)).toHaveText(ORIGINAL)
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes).toHaveLength(0)
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
