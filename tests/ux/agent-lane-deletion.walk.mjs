#!/usr/bin/env node
// Delete real native tool history, including the default lane, then cold-open.
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { clickOrFail, expect } from './_assert.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CREATION_PANEL, DOCUMENT, HISTORY_BUTTON, THREAD_ROW, chooseAssistantModel,
  createRuntimeWalk, hasToolResult, newConversation, recorded, sendCreation, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { laneDiskSnapshot, laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'

const STORY = '旧故事中的红色杯子。'
const OLD = 'DELETE_OLD_HISTORY：读一遍文稿并记住这个旧对话标记。'
const SECOND = 'DELETE_SECOND_HISTORY：这也是稍后会删除的独立对话。'
const FRESH = 'DELETE_FRESH：现在开始一个全新的任务。'
const output = process.env.NOMI_WALK_OUT || process.env.EVIDENCE_DIR
process.env.NOMI_WALK_OUT = output ? assertOutsideRepo(output) : makeTempDir('agent-lane-deletion-')
process.env.EVIDENCE_DIR = process.env.NOMI_WALK_OUT
const walk = await createRuntimeWalk('lane-deletion')
let failure
try {
  let { win } = await walk.start({ first: true })
  const { projectId, projectRoot, name } = await walk.newProject()
  await win.locator(DOCUMENT).fill(STORY)
  await expect(win.locator(DOCUMENT)).toHaveText(STORY)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  const read = walk.fixture.expectText({ label: 'default lane executes a real document read',
    match: (body) => flattenRequestText(body).includes(OLD) && !hasToolResult(body, 'delete-old-read'),
    reply: { type: 'tool', id: 'delete-old-read', name: 'read_script', args: { scope: 'full' } } })
  const readDone = walk.fixture.expectText({ label: 'default lane receives its actual tool result',
    match: (body) => hasToolResult(body, 'delete-old-read'), reply: { type: 'text', text: '旧对话已经读到红色杯子。' } })
  await sendCreation(win, OLD)
  await recorded(read.received, 'default lane request')
  const resultWire = await recorded(readDone.received, 'default lane tool result')
  expect(flattenRequestText(resultWire.body)).toContain(STORY)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('旧对话已经读到红色杯子。', { exact: true }) })
  const original = readLaneTranscripts(projectRoot)[0]
  expect(original.laneName).toBe('main')
  expect(laneMessages(original).some((message) => message.role === 'toolResult'
    && message.toolCallId === 'delete-old-read' && !message.isError)).toBe(true)

  await newConversation(win, CREATION_PANEL)
  const second = walk.fixture.expectText({ label: 'new lane is independent before both are deleted',
    match: (body) => flattenRequestText(body).includes(SECOND), reply: { type: 'text', text: '第二条独立对话。' } })
  await sendCreation(win, SECOND)
  const secondWire = await recorded(second.received, 'second lane request')
  expect(flattenRequestText(secondWire.body)).not.toContain(OLD)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('第二条独立对话。', { exact: true }) })
  const lanes = () => readLaneTranscripts(projectRoot)
  expect(lanes()).toHaveLength(2)
  const secondLane = lanes().find((session) => session.sessionId !== original.sessionId)
  await clickOrFail(win.locator(`${CREATION_PANEL} ${HISTORY_BUTTON}`), '打开对话列表')
  const rows = win.locator(THREAD_ROW)
  await expect(rows).toHaveCount(2)
  const oldRow = rows.filter({ has: win.getByRole('button', { name: '未命名对话', exact: true }) })
  await clickOrFail(oldRow.getByRole('button', { name: '删除对话' }), '删除含真实工具历史的默认对话')
  await expect.poll(() => lanes().map((session) => session.sessionId)).toEqual([secondLane.sessionId])
  await expect(rows).toHaveCount(1)
  const secondRow = rows.filter({ has: win.getByRole('button', { name: secondLane.laneName, exact: true }) })
  await clickOrFail(secondRow.getByRole('button', { name: '删除对话' }), '删除当前独立对话')
  await expect.poll(() => ({ count: lanes().length, original: lanes().some((session) => [original.sessionId, secondLane.sessionId].includes(session.sessionId)) }))
    .toEqual({ count: 1, original: false })
  const surviving = lanes()[0]
  expect(surviving.laneName).not.toBe('main')
  expect(laneMessages(surviving)).toEqual([])
  await walk.snap('deleted-default-and-active-lanes')
  const requestsBeforeCold = walk.fixture.requests.length
  await walk.stopApp()
  const durable = laneDiskSnapshot(projectRoot)
  ;({ win } = await walk.start())
  expect(walk.report.launches[1].pid).not.toBe(walk.report.launches[0].pid)
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: name })
  await expect(projectCard).toBeVisible()
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: /继续创作/ }), '冷启动打开删除历史后的项目')
  await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId)
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '返回创作区')
  await expect(win.locator(CREATION_PANEL)).toBeVisible()
  expect(lanes().map((session) => session.sessionId), 'Cold opening must not recreate the deleted default lane').toEqual([surviving.sessionId])
  expect(laneDiskSnapshot(projectRoot), 'Cold opening cannot rewrite or recreate deleted transcripts').toEqual(durable)
  expect(walk.fixture.requests).toHaveLength(requestsBeforeCold)
  const fresh = walk.fixture.expectText({ label: 'surviving lane runs a fresh turn after deletion and cold restart',
    match: (body) => flattenRequestText(body).includes(FRESH), reply: { type: 'text', text: '全新任务已开始。' } })
  await sendCreation(win, FRESH)
  const freshWire = await recorded(fresh.received, 'fresh lane request')
  expect(flattenRequestText(freshWire.body)).not.toContain(OLD)
  expect(flattenRequestText(freshWire.body)).not.toContain(SECOND)
  expect(hasToolResult(freshWire.body, 'delete-old-read')).toBe(false)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: win.locator(CREATION_PANEL).getByText('全新任务已开始。', { exact: true }) })
  await walk.snap('cold-open-surviving-lane')
  walk.fixture.assertClean()
  walk.report.verified = ['delete-default-native-tool-history', 'delete-active-lane-creates-empty-replacement',
    'cold-open-does-not-resurrect-main', 'fresh-turn-does-not-inherit-deleted-history']
} catch (error) { failure = error; process.exitCode = 1 }
finally { await walk.finish(failure) }
