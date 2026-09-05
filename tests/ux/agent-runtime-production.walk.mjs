#!/usr/bin/env node
// R1-F: inline planner, renderer image judge, direction task and script task.
// Only the vendor is a loopback fixture; no direct Agent calls or canned ProductionRun driver.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL, CREATION_PANEL, DOCUMENT, chooseCreationMode, createRuntimeWalk, hasToolResult,
  openCanvas, readConversations, readNativeContexts, readProject, recorded, sendCreation,
  readCurrentProjectAgentHostSnapshot, snapshotMessages, toolNames,
} from './agent-runtime-walk-support.mjs'

const STORY = 'F_INLINE_STORY：清晨，一位创作者来到咖啡馆。她将红色杯子放到白桌正中央，然后坐在窗边整理相机。镜头保持正面中景，自然光照亮杯沿，背景不要多余物件。画面只需要表现拍摄开始前安静的准备时刻。'
const PLAN_CALL = 'f-inline-plan-1'
const PARENT = 'F_PARENT_THREAD：先只记住代号红杯，不做任何操作。'
const GOAL = 'F_DIRECTION_GOAL：为独立创作者展示一次本地视频创作流程。'
const SCRIPT = 'F_SCRIPT_1：创作者打开项目，完成剪辑，画面停在成片。'
const CANDIDATES = [
  { key: 'a', title: '真实桌面', oneLiner: '跟随创作者完成一次剪辑。' },
  { key: 'b', title: '产品特写', oneLiner: '用界面细节展示创作过程。' },
]

function snapshots(projectRoot, settingsRoot) {
  const host = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  // Include the complete Host snapshot as the positive persistence control;
  // ephemeral tasks must leave this canonical source unchanged.
  return { host: host ? JSON.stringify(host) : null }
}

const walk = await createRuntimeWalk('production')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  // A real new user reaches the Agent through the visible Settings toggle. Keep
  // this journey on that same boundary before locating the resident composer.
  await (await import('./agent-runtime-walk-support.mjs')).enableAgentHostThroughSettings(win)
  const settingsRoot = path.join(walk.report.tempRoot, 'settings')
  await win.locator(DOCUMENT).fill(STORY)
  await expect(win.locator(DOCUMENT)).toHaveText(STORY)
  await chooseCreationMode(win, 'general')
  const parent = walk.fixture.expectText({
    label: 'establish an actual parent conversation before inline planning',
    match: (body) => flattenRequestText(body).includes(PARENT),
    reply: { type: 'text', text: 'F_PARENT_ACK：已记住红杯。' },
  })
  await sendCreation(win, PARENT)
  await recorded(parent.received, 'parent conversation request')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_PARENT_ACK')
  // The resident composer owns the send control; its accessible label is
  // localized and changed with the Agent shell copy, while this data contract
  // remains the stable user action.
  await expect(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"]`)).toBeVisible()
  const durableRoots = { settingsRoot, projectRoot }
  await expect.poll(async () => (await readConversations(win, projectId, durableRoots))?.creation.threads[0]?.messages
    .some((message) => message.content === PARENT), { timeout: 30_000 }).toBe(true)
  const persistedConversations = await readConversations(win, projectId, durableRoots)
  const parentThreadId = persistedConversations.creation.activeId
  expect(parentThreadId).toMatch(/^thread-/)
  // The current cutover snapshot is the persistence proof; the retired
  // agent-session.json container is intentionally absent in fresh projects.
  expect(persistedConversations.creation.threads
    .find((thread) => thread.id === parentThreadId)?.messages
    .some((message) => message.role === 'user' && message.content === PARENT)).toBe(true)
  const planner = walk.fixture.expectText({
    label: 'inline storyboard planner inherits the creation thread',
    match: (body) => flattenRequestText(body).includes('F_INLINE_STORY') && !hasToolResult(body, PLAN_CALL),
    reply: { type: 'tool', id: PLAN_CALL, name: 'nomi_canvas_plan', args: {
      operation: 'propose_storyboard_plan', title: 'F镜头', anchors: [],
      shots: [{ index: 1, shotKind: 'image', durationSec: 0, anchorIds: [],
        modelKey: FIXTURE_IMAGE_MODEL, modeId: 't2i', params: { size: '1024x1024' },
        prompt: '正面中景，红色杯子放在白桌中央。' }],
    } },
  })
  const plannerDone = walk.fixture.expectText({
    label: 'inline storyboard tool result completes through the same SDK turn',
    match: (body) => hasToolResult(body, PLAN_CALL),
    reply: { type: 'text', text: 'F_PLAN_DONE：请先审阅，再落到画布。' },
  })
  // The inline storyboard action is selection-scoped: a fresh user must select
  // the brief text before the popover action becomes enabled.
  const document = win.locator(DOCUMENT)
  await document.click()
  await document.selectText()
  const selectionStoryboardButton = win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true })
  await expect(selectionStoryboardButton).toBeEnabled()
  await clickOrFail(selectionStoryboardButton, '在创作区就地拆镜头')
  const plannerWire = await recorded(planner.received, 'inline planner request')
  expect(toolNames(plannerWire.body)).toEqual([
    'load_skill', 'nomi_canvas_edit', 'nomi_canvas_plan', 'nomi_canvas_read',
    'nomi_document_edit', 'nomi_document_read', 'nomi_generation_plan', 'nomi_generation_status',
  ])
  expect(plannerWire.body.messages.some((message) => message.role === 'user'
    && flattenRequestText({ messages: [message] }).includes(PARENT)),
  'Planning must retain the parent thread context in the Host request').toBe(true)
  const storyboardApproval = win.locator(`${CREATION_PANEL} [data-agent-approval="true"][data-agent-approval-state="pending"]`)
  const storyboardApprovalProof = await proveProbe(storyboardApproval,
    'Inline storyboard planning reaches the real Resident approval boundary')
  await clickOrFail(storyboardApproval.getByRole('button', { name: '批准', exact: true }),
    '批准内联分镜规划', { noWaitAfter: true })
  await expectAbsent(storyboardApproval.getByRole('button', { name: '批准', exact: true }), {
    provenBy: storyboardApprovalProof,
    message: 'The applied storyboard approval is no longer actionable',
  })
  await recorded(plannerDone.received, 'inline planner result')
  // v5：方案落成中列摘要卡（完整编辑器只住分镜页），先卡后审。
  await expect(win.locator('[data-storyboard-card="draft"]')).toBeVisible()
  await expect(win.locator('[data-workspace-mode="creation"]')).toBeVisible()
  await expect.poll(async () => {
    const payload = (await readProject(win, projectId)).payload
    return payload.storyboardDesignsByDocumentId?.[payload.activeDocumentId]?.[0]?.plan?.title
  },
    { timeout: 30_000 }).toBe('F镜头')
  const draft = (await readProject(win, projectId)).payload
  expect(draft.storyboardDesignsByDocumentId?.[draft.activeDocumentId]?.[0]?.committed).toBe(false)
  expect(draft.generationCanvas.nodes).toHaveLength(0)
  expect(walk.fixture.images).toHaveLength(0)
  await expect.poll(() => readNativeContexts(projectRoot, settingsRoot)?.some((record) => record.snapshot
    && snapshotMessages(record).some((message) => message.role === 'toolResult' && message.toolCallId === PLAN_CALL)),
  { timeout: 30_000 }).toBe(true)
  const plannerContext = readNativeContexts(projectRoot, settingsRoot).find((record) => record.snapshot
    && snapshotMessages(record).some((message) => message.role === 'toolResult' && message.toolCallId === PLAN_CALL))
  expect(plannerContext.sessionKey, 'A creation bubble must not secretly use the generation memory bucket')
    .toBe(`nomi:workbench:${projectId}:creation`)
  expect(plannerContext.threadId, 'Inline planning must keep the exact initiating thread, not open a new creation thread')
    .toBe(parentThreadId)
  expect((await readConversations(win, projectId, durableRoots)).creation.activeId).toBe(parentThreadId)
  await walk.snap('inline-plan-awaits-human')

  // v5 执行面：没有「确认落画布」——进分镜页，footer「生成未生成的 N 镜」按需 materialize + 批量。
  await clickOrFail(win.getByRole('button', { name: '打开分镜', exact: true }), '从方案卡进入分镜页')
  await expect(win.getByRole('textbox', { name: '方案标题', exact: true })).toHaveValue('F镜头')
  const beforeJudge = snapshots(projectRoot, settingsRoot)
  const judge = walk.fixture.expectText({
    label: 'batch completion invokes the actual image judge',
    match: (body) => flattenRequestText(body).includes('资深影视分镜审片'),
    reply: { type: 'text', text: JSON.stringify({
      reason: 'F_VERIFY_LOW：杯子偏到画面边缘。', scores: { identity: 5, composition: 1 },
    }) },
  })
  await clickOrFail(win.locator('[data-storyboard-batch="true"]'), '生成未生成的镜头')
  // materialize 是免费副作用：节点先建（零 vendor 调用），确认卡再守花钱那一步。
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: 30_000 }).toBe(1)
  const canvas = (await readProject(win, projectId)).payload.generationCanvas
  const shot = canvas.nodes[0]
  expect(shot.kind).toBe('image')
  expect(shot.shotIndex).toBe(1)
  expect(shot.meta.modelKey).toBe(FIXTURE_IMAGE_MODEL)
  const spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: '开始生成' }).last()
  const spendProof = await proveProbe(spendDialog, 'Real batch generation asks for approval')
  expect(walk.fixture.images).toHaveLength(0)
  await walk.snap('batch-generation-awaits-approval')
  await clickOrFail(spendDialog.getByRole('button', { name: '生成', exact: true }), '批准本机图片生成')
  await expectAbsent(spendDialog, { provenBy: spendProof, message: 'Generation confirmation is consumed' })
  const judgeWire = await recorded(judge.received, 'real renderer image-judge request')
  await openCanvas(win)
  expect(toolNames(judgeWire.body)).toEqual([])
  const imageParts = judgeWire.body.messages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
    .filter((part) => part.type === 'image_url')
  expect(imageParts).toHaveLength(1)
  expect(imageParts[0].image_url.url).toMatch(/^data:image\//)
  await expect(win.locator(`[data-node-id="${shot.id}"][data-status="success"]`)).toBeVisible({ timeout: 30_000 })
  const deviation = win.locator(`${CANVAS_PANEL} [data-reconcile-deviation-card="true"]`)
  await expect(deviation).toContainText('F_VERIFY_LOW')
  await expect(deviation.locator('[data-reconcile-ai-fix="true"]')).toBeVisible()
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes[0].result?.url,
    { timeout: 30_000 }).toBeTruthy()
  expect(walk.fixture.images).toHaveLength(1)
  expect(snapshots(projectRoot, settingsRoot), 'Ephemeral image judging must not touch project or local working contexts').toEqual(beforeJudge)
  await walk.snap('real-judge-reports-shot-deviation')

  const beforeProduction = snapshots(projectRoot, settingsRoot)
  let runDir
  let scriptGateAtDispatch
  const directions = walk.fixture.expectText({
    label: 'public production draft delegates actual directions to the renderer',
    match: (body) => flattenRequestText(body).includes(GOAL) && flattenRequestText(body).includes('资深创意总监'),
    reply: { type: 'text', text: JSON.stringify({ candidates: CANDIDATES }) },
  })
  const script = walk.fixture.expectText({
    label: 'human direction approval triggers the real script task',
    match: (body) => {
      if (!flattenRequestText(body).includes(GOAL) || !flattenRequestText(body).includes('你是短视频编剧')) return false
      // Capture the actual durable authorization at HTTP arrival, not after the
      // click has finished and a prematurely sent request could look authorized.
      scriptGateAtDispatch = runDir ? JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'))
        .run.gates.find((gate) => gate.gateId === 'gate-direction-v1') : null
      return true
    },
    reply: { type: 'text', text: SCRIPT },
  })
  const run = await win.evaluate((id) => window.nomiDesktop.productionRuns.createDraft({
    projectId: id, playbook: { name: 'brand.promo', version: '1.0.0' },
    origin: { host: 'codex', actorId: 'codex' },
    brief: { goal: 'F_DIRECTION_GOAL：为独立创作者展示一次本地视频创作流程。' },
  }), projectId)
  expect(run.runId).toBeTruthy()
  runDir = path.join(projectRoot, '.nomi', 'runs', run.runId)
  const readRun = () => win.evaluate(({ pid, rid }) => window.nomiDesktop.productionRuns.read(pid, rid),
    { pid: projectId, rid: run.runId })
  const directionWire = await recorded(directions.received, 'direction task model request')
  expect(toolNames(directionWire.body)).toEqual([])
  await expect.poll(async () => (await readRun()).gates.find((gate) => gate.gateId === 'gate-direction-v1')?.directionCandidates,
    { timeout: 30_000 }).toEqual(CANDIDATES)
  const directionFile = JSON.parse(fs.readFileSync(path.join(runDir, 'direction-v1.json'), 'utf8'))
  expect(directionFile.candidates).toEqual(CANDIDATES)
  await clickOrFail(win.locator('[data-task-center-trigger="true"]'), '打开真实任务中心')
  await clickOrFail(win.locator('[data-production-task-card] [data-production-primary-action]'), '审阅创意方向')
  await expect(win.locator('[data-direction-candidates]')).toBeVisible()
  await expect(win.locator('[data-direction-candidate]')).toHaveCount(2)
  await clickOrFail(win.locator('[data-direction-candidate="b"]'), '选择产品特写方向')
  await expect(win.locator('[data-direction-candidate="b"]')).toHaveAttribute('aria-checked', 'true')
  await walk.snap('direction-candidates-real-task')
  expect(scriptGateAtDispatch, 'No script request may be dispatched before the real approval').toBeUndefined()
  expect((await readRun()).artifacts.some((item) => item.kind === 'script')).toBe(false)
  expect(fs.existsSync(path.join(runDir, 'script-v1.json'))).toBe(false)
  await clickOrFail(win.getByRole('button', { name: '批准并继续', exact: true }), '批准方向并制作初稿')
  const scriptWire = await recorded(script.received, 'script task model request')
  expect(toolNames(scriptWire.body)).toEqual([])
  expect(scriptGateAtDispatch, 'The authorization must already be saved when the vendor receives the script request')
    .toMatchObject({ status: 'approved', decidedChoiceKey: 'b' })
  await expect.poll(async () => (await readRun()).status, { timeout: 30_000 }).toBe('awaiting_script_review')
  const completed = await readRun()
  expect(completed.stageId).toBe('script')
  expect(completed.gates.find((gate) => gate.gateId === 'gate-direction-v1'))
    .toMatchObject({ status: 'approved', decidedChoiceKey: 'b' })
  const artifact = completed.artifacts.find((item) => item.artifactId === 'artifact-script-v1')
  expect(artifact).toMatchObject({ kind: 'script', version: 1, status: 'candidate', source: 'nomi-agent', reviewStatus: 'waiting' })
  expect(artifact.contentHash).toBe(createHash('sha256').update(SCRIPT).digest('hex'))
  const scriptFile = JSON.parse(fs.readFileSync(path.join(runDir, 'script-v1.json'), 'utf8'))
  expect(scriptFile.content).toBe(SCRIPT)
  expect(scriptFile.contentHash).toBe(artifact.contentHash)
  const productionStatus = win.locator('[data-production-status-title]')
  if (!await productionStatus.isVisible()) {
    await clickOrFail(win.locator('[data-task-center-trigger="true"]'), '重新打开任务中心查看剧本候选状态')
  }
  await expect(productionStatus).toContainText('剧本草稿已准备好')
  expect(snapshots(projectRoot, settingsRoot), 'Direction and script tasks must not touch project or local working contexts').toEqual(beforeProduction)
  expect(flattenRequestText(directionWire.body)).not.toContain('F_PLAN_DONE')
  expect(flattenRequestText(scriptWire.body)).not.toContain('F_VERIFY_LOW')
  expect(walk.fixture.requests).toHaveLength(6)
  walk.fixture.assertClean()
  await walk.snap('script-artifact-awaits-human-review')
  walk.report.runId = run.runId
  walk.report.verified = ['inline-planner-parent-thread', 'plan-review-before-canvas-write',
    'real-image-batch-and-ephemeral-judge', 'public-production-directions', 'human-direction-choice-and-script-artifact']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
