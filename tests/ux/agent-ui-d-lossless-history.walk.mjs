#!/usr/bin/env node
// Agent UI D · 对话「不失忆」真实 Electron 走查（零额度 loopback provider）。
//
// 用户故事：第一句让 Agent 去查一件事（它调工具、拿到结果），第二句用「刚才你说的那个」
// 指回第一句的结果。修复前 Host 把历史转述成中文散文并丢掉全部工具记录，第二句必然落空；
// 这条走查在真实 HTTP 出站报文上逐轮断言工具调用与工具结果确实随对话一起走。
//
// 只有远端供应商是本地 loopback；渲染层、IPC、Host、pi SDK、磁盘持久化全走生产路径。
import path from 'node:path'
import { clickOrFail, expect } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CREATION_PANEL, DOCUMENT, chooseAssistantModel, createRuntimeWalk, enableAgentHostThroughSettings,
  hasToolResult, readDurableThreadContexts, readCurrentProjectAgentHostSnapshot, recorded, sendCreation,
} from './agent-runtime-walk-support.mjs'

const STORY = 'F_SEG_A：她推开咖啡馆的门。F_SEG_B：她把红色杯子放在白色桌面上，调好相机，坐下来等自然光落到杯沿，这一段是全篇最长的一段。F_SEG_C：她按下录制键。'
const READ_CALL = 'f-d-read-1'
const TURN1 = 'F_D1：读一遍当前文稿，告诉我最长的一段是哪个。'
const TURN1_REPLY = 'F_D1_DONE：最长的一段是 F_SEG_B。'
const TURN2 = 'F_D2：把刚才你说的最长那段删掉。'
const TURN2_REPLY = 'F_D2_DONE：我知道你指的是 F_SEG_B。'
const TURN3 = 'F_D3：改回去。'
const TURN3_REPLY = 'F_D3_DONE：已还原 F_SEG_B。'
const TURN4 = 'F_D4：重启之后，你还记得第一轮读到的是哪一段吗？'
const TURN4_REPLY = 'F_D4_DONE：重启后我仍然记得 F_SEG_B。'

/** 上一轮的工具调用是否原样留在本轮出站报文里（不是被转述成散文）。 */
function hasToolCall(body, id) {
  return (body.messages ?? []).some((message) => message.role === 'assistant'
    && (message.tool_calls ?? []).some((call) => call.id === id))
}

const walk = await createRuntimeWalk('agent-ui-d')
let failure
try {
  let { win } = await walk.start({ first: true })
  await enableAgentHostThroughSettings(win)
  const project = await walk.newProject()
  const { projectRoot } = project
  const settingsRoot = path.join(walk.report.tempRoot, 'settings')
  await chooseAssistantModel(win, 'agent-runtime-loopback/agent-runtime-text')
  await win.locator(DOCUMENT).fill(STORY)
  await expect(win.locator(DOCUMENT)).toHaveText(STORY)

  // 第一轮：Agent 真的调一次只读工具，拿到真实结果后回话。
  const readRequest = walk.fixture.expectText({
    label: 'turn 1 asks the document read tool',
    match: (body) => flattenRequestText(body).includes(TURN1) && !hasToolResult(body, READ_CALL),
    reply: { type: 'tool', id: READ_CALL, name: 'nomi_document_read', args: { scope: 'full' } },
  })
  const readFollowup = walk.fixture.expectText({
    label: 'turn 1 receives the real tool result',
    match: (body) => hasToolResult(body, READ_CALL),
    reply: { type: 'text', text: TURN1_REPLY },
  })
  await sendCreation(win, TURN1)
  await recorded(readRequest.received, 'turn 1 first request')
  const firstResultWire = await recorded(readFollowup.received, 'turn 1 tool-result request')
  expect(hasToolCall(firstResultWire.body, READ_CALL), '第一轮的工具调用进入模型输入').toBe(true)
  expect(flattenRequestText(firstResultWire.body), '工具结果里带着真实文稿').toContain('F_SEG_B')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_D1_DONE')
  await walk.snap('turn-1-tool-result')

  // 第二轮：这是修复前必然失败的那一句——「刚才你说的」只有在工具记录随行时才能指得动。
  const secondTurn = walk.fixture.expectText({
    label: 'turn 2 must still see turn 1 tool call and result',
    match: (body) => flattenRequestText(body).includes(TURN2),
    reply: { type: 'text', text: TURN2_REPLY },
  })
  await sendCreation(win, TURN2)
  const secondWire = await recorded(secondTurn.received, 'turn 2 request')
  expect(hasToolCall(secondWire.body, READ_CALL), '第二轮命中第一轮的工具调用').toBe(true)
  expect(hasToolResult(secondWire.body, READ_CALL), '第二轮命中第一轮的工具结果').toBe(true)
  const secondText = flattenRequestText(secondWire.body)
  expect(secondText, '第一轮的用户原话仍在').toContain(TURN1)
  expect(secondText, '第一轮的助手回复仍在').toContain(TURN1_REPLY)
  // 旧路径把历史拼成 `此前同一项目线程：\n用户：…\nNomi：…`。这两个标记再出现即为回归。
  expect(secondText, '不再有转述前缀').not.toContain('此前同一项目线程')
  expect(secondText, '不再把角色压成散文前缀').not.toContain('Nomi：')
  await expect(win.locator(CREATION_PANEL)).toContainText('F_D2_DONE')
  await walk.snap('turn-2-references-turn-1')

  // 第三轮：第一轮的记录不是只活一轮。
  const thirdTurn = walk.fixture.expectText({
    label: 'turn 3 still carries the whole thread',
    match: (body) => flattenRequestText(body).includes(TURN3),
    reply: { type: 'text', text: TURN3_REPLY },
  })
  await sendCreation(win, TURN3)
  const thirdWire = await recorded(thirdTurn.received, 'turn 3 request')
  expect(hasToolCall(thirdWire.body, READ_CALL), '第三轮仍带着第一轮的工具调用').toBe(true)
  expect(hasToolResult(thirdWire.body, READ_CALL), '第三轮仍带着第一轮的工具结果').toBe(true)
  expect(flattenRequestText(thirdWire.body), '第三轮只把本轮请求当请求').toContain(TURN3)
  await expect(win.locator(CREATION_PANEL)).toContainText('F_D3_DONE')
  await walk.snap('turn-3-still-has-turn-1')

  // 线程 history 落在项目自己的目录里，键是 Host 的规范线程身份。
  const hostSnapshot = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  const activeThreadId = hostSnapshot?.activeThreadId
  expect(typeof activeThreadId, 'Host 有一个当前线程').toBe('string')
  await expect.poll(() => (readDurableThreadContexts(projectRoot) ?? []).length,
    { message: '线程 history 必须落盘到项目目录', timeout: 30_000 }).toBeGreaterThan(0)
  const durable = readDurableThreadContexts(projectRoot)
  const record = durable.find((entry) => entry.threadId === activeThreadId)
  expect(record, '落盘记录挂在当前线程上').toBeTruthy()
  expect(record.sessionKey, '只有一种线程 session key 词表').toBe(
    `nomi:project-agent:${record.project.immutableProjectUuid}:g${record.project.projectGeneration}`)
  expect(typeof record.snapshot, '落盘的是真实 pi 快照').toBe('string')

  // 冷重启：同一条线程重开，第一轮的工具结果仍在。
  const requestsBeforeRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  const card = win.locator('[data-project-card="true"]').filter({ hasText: project.name }).first()
  await expect(card).toBeVisible()
  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作/ }), '冷重启后打开同一项目')
  // 项目库打开默认落在生成区，先走可见的「创作」页签再断言文稿与常驻面板。
  await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`),
    project.projectId, { timeout: 30_000 })
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '创作工作区')
  await expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 30_000 })
  await expect(win.locator(CREATION_PANEL)).toContainText('F_D3_DONE')
  expect(walk.fixture.requests, '冷启动本身不发任何模型请求').toHaveLength(requestsBeforeRestart)
  const fourthTurn = walk.fixture.expectText({
    label: 'turn 4 after a cold restart still carries turn 1',
    match: (body) => flattenRequestText(body).includes(TURN4),
    reply: { type: 'text', text: TURN4_REPLY },
  })
  await sendCreation(win, TURN4)
  const fourthWire = await recorded(fourthTurn.received, 'turn 4 request after restart')
  expect(hasToolCall(fourthWire.body, READ_CALL), '重启后仍带着第一轮的工具调用').toBe(true)
  expect(hasToolResult(fourthWire.body, READ_CALL), '重启后仍带着第一轮的工具结果').toBe(true)
  expect(flattenRequestText(fourthWire.body), '重启后仍带着第一轮的用户原话').toContain(TURN1)
  await expect(win.locator(CREATION_PANEL)).toContainText('F_D4_DONE')
  expect(walk.report.launches[1].pid, '这确实是第二个进程').not.toBe(walk.report.launches[0].pid)
  await walk.snap('cold-restart-keeps-thread-history')

  walk.fixture.assertClean()
  walk.report.verified = [
    'turn-2-hits-turn-1-tool-result',
    'turn-3-still-carries-turn-1',
    'no-prose-renarration-in-wire',
    'thread-history-persists-in-project-dir',
    'cold-restart-keeps-thread-history',
  ]
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}
