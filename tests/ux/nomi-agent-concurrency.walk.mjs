import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRuntimeWalk, chooseAssistantModel, recorded, sendCreation, newConversation, selectConversation, waitForV4TurnIdle, CREATION_PANEL, COMPOSER, COMPOSER_SEND, APPROVAL_CARD } from './agent-runtime-walk-support.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { readLaneTranscripts, laneMessages, laneMessageText, laneDiskSnapshot } from './agent-lane-observer.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expect } from './_assert.mjs'
import { redact } from './nomi-user-workflow-performance.e2e.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/journeys', `agent-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
fs.mkdirSync(out, { recursive: true })
const guardLog = path.join(out, 'network.jsonl')
const walk = await createRuntimeWalk('nomi-performance-concurrency', { env: { NOMI_WALK_NET_LOG: guardLog, NOMI_WALK_ALLOW_ORIGINS: '' } })
const receipt = { schemaVersion: 1, sourceHash: createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), buildReceipt: JSON.parse(fs.readFileSync(path.join(root, 'dist/build-stamp.json'), 'utf8')), cases: [],
  scope: 'Real native Agent lanes with only the external model endpoint replaced by loopback SSE. Functional overlap/correlation/cancel/cold-recovery evidence, not latency budgets, CPU distributions or fixed1+5 acceptance. Stream/stream, waiting-tool/waiting-tool and stream/waiting-tool; tool is production ask_user awaiting actual UI response. No paid model or permission-policy changes.' }
let win, project, failure
const title = (lane) => lane === 'main' ? uiText('zh-CN', 'agentResident.untitledThread') : lane
async function activeLane() {
  const all = readLaneTranscripts(project.projectRoot)
  return all.at(-1).laneName
}
async function freshLane() {
  const count = readLaneTranscripts(project.projectRoot).length
  await newConversation(win, CREATION_PANEL)
  await expect.poll(() => readLaneTranscripts(project.projectRoot).length).toBe(count + 1)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.locator(`${CREATION_PANEL} [data-v4-control="model"]`).click()
  return activeLane()
}
async function select(lane) { await selectConversation(win, CREATION_PANEL, title(lane)) }
async function ask(tag, lane) {
  const call = `${tag}-ask`
  const requested = walk.fixture.expectText({ label: `${tag} actual production ask_user`, match: (body) => flattenRequestText(body).includes(`${tag}_PROMPT`), reply: { type: 'tool', id: call, name: 'ask_user', args: { questions: [{ question: `${tag}_QUESTION` }] } } })
  const completed = walk.fixture.expectText({ label: `${tag} receives its own actual tool result`, match: (body) => (body.messages || []).some((message) => message.role === 'tool' && message.tool_call_id === call), reply: { type: 'text', text: `${tag}_DONE` } })
  await sendCreation(win, `${tag}_PROMPT`)
  const wire = await recorded(requested.received, `${tag} tool request`)
  await expect(win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}[data-kind="question"]`)).toContainText(`${tag}_QUESTION`)
  return { tag, lane, call, wireAt: wire.at, completed }
}
async function answer(task) {
  await select(task.lane)
  const card = win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}[data-kind="question"]`)
  await expect(card).toContainText(`${task.tag}_QUESTION`)
  await card.locator('[data-v4-control="question-answer"]').fill(`${task.tag}_ANSWER`)
  await card.locator('[data-v4-control="question-answer"]').press('Enter')
  const wire = await recorded(task.completed.received, `${task.tag} follow-up result`)
  assert.ok(flattenRequestText(wire.body).includes(`${task.tag}_ANSWER`))
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: win.locator(CREATION_PANEL).getByText(`${task.tag}_DONE`, { exact: false }) })
}
async function held(tag, lane) {
  const reply = walk.fixture.expectText({ label: `${tag} real held SSE`, match: (body) => flattenRequestText(body).includes(`${tag}_PROMPT`), reply: { type: 'hold', text: `**${tag}_PARTIAL**\n\n| Scene | Choice |\n| --- | --- |\n| Opening | Close-up |` } })
  await sendCreation(win, `${tag}_PROMPT`)
  const wire = await recorded(reply.received, `${tag} held stream`)
  await expect(win.locator(CREATION_PANEL)).toContainText(`${tag}_PARTIAL`)
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}`)).toHaveAttribute('data-mode', 'running')
  return { tag, lane, wireAt: wire.at, reply, released: false }
}
async function finishStream(task) {
  task.reply.release({ type: 'text', text: `\n\n${task.tag}_DONE` }); task.released = true
  await select(task.lane)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: win.locator(CREATION_PANEL).getByText(`${task.tag}_DONE`, { exact: false }) })
  await expect(win.locator(`${CREATION_PANEL} [data-v4-markdown] table`).first()).toBeVisible()
}
try {
  ;({ win } = await walk.start({ first: true }))
  project = await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.locator(`${CREATION_PANEL} [data-v4-control="model"]`).click()
  const streamA = await held('STREAM_A', await activeLane())
  const streamB = await held('STREAM_B', await freshLane())
  assert.equal(streamA.released, false)
  assert.notEqual(streamA.lane, streamB.lane)
  receipt.cases.push({ id: 'agent.stream-stream', executed: true, simultaneousExternalResponsesHeld: 2, lanes: [streamA.lane, streamB.lane], requestAt: [streamA.wireAt, streamB.wireAt], functionalPassed: false })
  const firstNative = laneMessages(readLaneTranscripts(project.projectRoot).find((session) => session.laneName === streamA.lane)).at(-1)
  if (firstNative?.stopReason === 'aborted') {
    Object.assign(receipt.cases.at(-1), { status: 'blocked', attempted: true, executed: false, nativeOverlapObserved: false })
    receipt.concurrencyBlocker = 'Creating the second conversation aborts the first native lane; two held external responses do not prove concurrent native execution'
    await finishStream(streamB)
    await select(streamA.lane)
    await expect(win.locator(`${CREATION_PANEL} [data-v4-block="assistant"][data-status="interrupted"]`)).toContainText('STREAM_A_PARTIAL')
    const requestsBeforeCold = walk.fixture.requests.length
    await walk.snap('native-switch-aborts-first-stream')
    await walk.stopApp()
    const durable = laneDiskSnapshot(project.projectRoot)
    ;({ win } = await walk.start())
    const card = win.locator(`[data-project-card][data-project-id="${project.projectId}"]`)
    await card.hover()
    await card.getByRole('button', { name: uiText('zh-CN', 'library.continueCreating'), exact: true }).click()
    await win.locator('[data-shell-topbar] [data-mode="creation"]').click()
    await expect(win.locator(CREATION_PANEL)).toBeVisible({ timeout: 30000 })
    await select(streamA.lane)
    await expect(win.locator(CREATION_PANEL)).toContainText('STREAM_A_PARTIAL')
    await select(streamB.lane)
    await expect(win.locator(CREATION_PANEL)).toContainText('STREAM_B_DONE')
    assert.deepEqual(laneDiskSnapshot(project.projectRoot), durable)
    assert.equal(walk.fixture.requests.length, requestsBeforeCold)
    receipt.coldRecovery = { transcriptBytesUnchanged: true, noModelRequest: true, interruptedContentVisible: true, otherConversationResultVisible: true, scope: 'Actual conversation-switch abort, not concurrent stream acceptance' }
    receipt.cases.push({ id: 'agent.switch-cancel-cold-recovery', executed: true, functionalPassed: true })
    await walk.snap('switch-abort-cold-recovery-preserves-independent-transcripts')
    throw new Error(receipt.concurrencyBlocker)
  }
  await walk.snap('two-streams-distinct-native-lanes')
  await finishStream(streamB); await finishStream(streamA)
  receipt.cases.at(-1).functionalPassed = true
  const toolA = await ask('TOOL_A', await freshLane())
  const toolB = await ask('TOOL_B', await freshLane())
  assert.notEqual(toolA.lane, toolB.lane)
  await select(toolA.lane)
  await expect(win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}[data-kind="question"]`)).toContainText('TOOL_A_QUESTION')
  await select(toolB.lane)
  await expect(win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}[data-kind="question"]`)).toContainText('TOOL_B_QUESTION')
  receipt.cases.push({ id: 'agent.waiting-tool-waiting-tool', executed: true, actualTool: 'ask_user', simultaneousNativeQuestionsUnanswered: 2, lanes: [toolA.lane, toolB.lane], calls: [toolA.call, toolB.call], functionalPassed: false })
  await walk.snap('two-native-tool-interventions-independent')
  await answer(toolB); await answer(toolA)
  receipt.cases.at(-1).functionalPassed = true
  const interrupted = await held('INTERRUPTED', await freshLane())
  const waiting = await ask('WAITING', await freshLane())
  assert.equal(interrupted.released, false)
  receipt.cases.push({ id: 'agent.stream-waiting-tool-cancel-recover', executed: true, lanes: [interrupted.lane, waiting.lane], functionalPassed: false })
  await select(interrupted.lane)
  await win.locator(`${CREATION_PANEL} ${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}`).click()
  await expect(win.locator(`${CREATION_PANEL} [data-v4-block="assistant"][data-status="interrupted"]`)).toContainText('INTERRUPTED_PARTIAL')
  await answer(waiting)
  const sessions = readLaneTranscripts(project.projectRoot)
  for (const session of sessions) {
    const text = laneMessages(session).map(laneMessageText).join('\n')
    const tags = ['STREAM_A', 'STREAM_B', 'TOOL_A', 'TOOL_B', 'INTERRUPTED', 'WAITING'].filter((tag) => text.includes(tag))
    assert.equal(tags.length, 1, `Native lane ${session.laneName} must contain one independently scoped conversation`)
  }
  receipt.nativeSessions = sessions.map((session) => ({ laneName: session.laneName, sessionId: session.sessionId, sha256: createHash('sha256').update(session.bytes).digest('hex'), messages: laneMessages(session) }))
  const stopped = laneMessages(sessions.find((session) => session.laneName === interrupted.lane)).at(-1)
  assert.equal(stopped.role, 'assistant'); assert.equal(stopped.stopReason, 'aborted'); assert.ok(laneMessageText(stopped).includes('INTERRUPTED_PARTIAL'))
  receipt.nativeAbort = { stopReason: stopped.stopReason, partialContentPreserved: true }
  const requestsBeforeCold = walk.fixture.requests.length
  await walk.stopApp()
  const durable = laneDiskSnapshot(project.projectRoot)
  ;({ win } = await walk.start())
const card = win.locator(`[data-project-card][data-project-id="${project.projectId}"]`)
    await card.hover()
    await card.getByRole('button', { name: uiText('zh-CN', 'library.continueCreating'), exact: true }).click()
  await win.locator('[data-shell-topbar] [data-mode="creation"]').click()
  await expect(win.locator(CREATION_PANEL)).toBeVisible({ timeout: 30000 })
  await select(interrupted.lane)
  await expect(win.locator(CREATION_PANEL)).toContainText('INTERRUPTED_PARTIAL')
  await select(waiting.lane)
  await expect(win.locator(CREATION_PANEL)).toContainText('WAITING_DONE')
  assert.deepEqual(laneDiskSnapshot(project.projectRoot), durable)
  assert.equal(walk.fixture.requests.length, requestsBeforeCold)
  receipt.cases.at(-1).functionalPassed = true
  receipt.coldRecovery = { transcriptBytesUnchanged: true, noModelRequest: true, interruptedContentVisible: true, otherConversationResultVisible: true }
  await walk.snap('cold-recovery-preserves-independent-transcripts')
  walk.fixture.assertClean()
} catch (error) { failure = error; receipt.failure = error.message; process.exitCode = 1 }
finally {
  if (project) receipt.nativeSessions = readLaneTranscripts(project.projectRoot).map((session) => ({ laneName: session.laneName, sessionId: session.sessionId, sha256: createHash('sha256').update(session.bytes).digest('hex'), messages: laneMessages(session) }))
  for (const id of ['agent.waiting-tool-waiting-tool', 'agent.stream-waiting-tool-cancel-recover']) if (!receipt.cases.some((entry) => entry.id === id)) receipt.cases.push({ id, implemented: true, executed: false, functionalPassed: false, status: 'blocked', reason: receipt.concurrencyBlocker || receipt.failure })
  try { await walk.finish(failure) } catch (error) { receipt.finishFailure = error.message; process.exitCode = 1 }
  receipt.runtimeReport = walk.report
  for (const file of walk.report.screenshots || []) {
    if (!fs.existsSync(file)) continue
    fs.copyFileSync(file, path.join(out, path.basename(file)), fs.constants.COPYFILE_EXCL)
  }
  if (fs.existsSync(guardLog)) {
    const events = fs.readFileSync(guardLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    receipt.guard = { loaded: events.filter((event) => event.kind === 'guard-loaded').map((event) => event.layers), blockedAttempts: events.filter((event) => event.kind === 'blocked').length, errors: events.filter((event) => event.kind === 'guard-error') }
    try {
      assert.equal(receipt.guard.loaded.length, walk.report.launches.length, 'Every actual native app launch must install network guards')
      for (const layers of receipt.guard.loaded) assert.ok(['fetch', 'http', 'https', 'socket', 'chromium'].every((layer) => layers.includes(layer)))
      assert.equal(receipt.guard.blockedAttempts, 0); assert.equal(receipt.guard.errors.length, 0)
    } catch (error) { receipt.guardFailure = error.message; process.exitCode = 1 }
    fs.writeFileSync(guardLog, events.map((event) => JSON.stringify(redact(event))).join('\n') + '\n')
  }
  const output = path.join(out, 'receipt.json'); fs.writeFileSync(output, JSON.stringify(redact(receipt), null, 2), { flag: 'wx' }); console.log(JSON.stringify({ output, cases: receipt.cases, failure: receipt.failure, finishFailure: receipt.finishFailure }))
}
