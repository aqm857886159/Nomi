import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRuntimeWalk, chooseAssistantModel, recorded, sendCreation, waitForV4TurnIdle, CREATION_PANEL, COMPOSER } from './agent-runtime-walk-support.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { readLaneTranscripts, laneMessages, laneMessageText, laneDiskSnapshot } from './agent-lane-observer.mjs'
import { backToLibrary } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { redact } from './nomi-user-workflow-performance.e2e.mjs'
import { validateNativeWalkEvidence, assertNativeProjectIsolation } from './nomi-native-evidence-contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outputDir = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/journeys', `cross-project-agent-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
fs.mkdirSync(outputDir, { recursive: true })
const guardLog = path.join(outputDir, 'network.jsonl')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const ownerPath = 'electron/agentLane/laneIpc.ts'
const receipt = {
  schemaVersion: 1,
  source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), sha256: sha256(fs.readFileSync(fileURLToPath(import.meta.url))),
    fileHashes: Object.fromEntries(['tests/ux/nomi-native-evidence-contract.mjs', 'tests/ux/agent-runtime-walk-support.mjs', 'tests/ux/agent-runtime-fixture.mjs', 'tests/ux/agent-lane-observer.mjs', 'tests/ux/_launchApp.mjs', 'tests/ux/_shell.mjs', 'tests/ux/_station-budget.mjs', 'scripts/walkthrough-network-guard.cjs'].map((file) => [file, sha256(fs.readFileSync(path.join(root, file)))])),
    hashScope: 'Selected actual run/fixture/observer/guard owners; not the entire transitive application graph' },
  buildReceipt: JSON.parse(fs.readFileSync(path.join(root, 'dist/build-stamp.json'), 'utf8')),
  existingWorkspaceContract: { path: ownerPath, sha256: sha256(fs.readFileSync(path.join(root, ownerPath))), behavior: 'One active native workspace per renderer sender; opening another project closes the previous workspace before replacement' },
  scope: 'Real UI project switches during native streaming, independent complete transcripts and actual process cold recovery. Loopback replaces only the model endpoint; no performance acceptance or background concurrency claim.',
  cases: [], projects: [], functionalPassed: false, performanceAcceptance: 'unverified', nativeBackgroundConcurrency: 'not-exercised',
}
const walk = await createRuntimeWalk('nomi-cross-project-agent-recovery', { env: { NOMI_WALK_NET_LOG: guardLog, NOMI_WALK_ALLOW_ORIGINS: '' } })
let win, failure

async function selectModel() {
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await win.locator(`${CREATION_PANEL} [data-v4-control="model"]`).click()
}

async function completedTurn(tag) {
  const reply = walk.fixture.expectText({ label: `${tag} native completion`, match: (body) => flattenRequestText(body).includes(`${tag}_PROMPT`), reply: { type: 'text', text: `**${tag}_DONE**\n\n| Project | Result |\n| --- | --- |\n| ${tag} | Preserved |` } })
  await sendCreation(win, `${tag}_PROMPT`)
  await recorded(reply.received, `${tag} loopback request`)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: win.locator(CREATION_PANEL).getByText(`${tag}_DONE`, { exact: false }) })
  await expect(win.locator(`${CREATION_PANEL} [data-v4-markdown] table`).first()).toBeVisible()
}

async function openProject(project) {
  const card = win.locator(`[data-project-card][data-project-id="${project.projectId}"]`)
  await card.hover()
  await card.getByRole('button', { name: uiText('zh-CN', 'library.continueCreating'), exact: true }).click()
  await win.locator('[data-shell-topbar] [data-mode="creation"]').click()
  await expect(win.locator(CREATION_PANEL)).toBeVisible({ timeout: stationTimeout() })
  await expect.poll(() => win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })).toBe(project.projectId)
}

function nativeSession(project, ownTag, otherTag) {
  const sessions = readLaneTranscripts(project.projectRoot)
  assert.equal(sessions.length, 1, 'Each isolated project retains its one actual native conversation')
  const session = sessions[0]
  const messages = laneMessages(session)
  const text = messages.map(laneMessageText).join('\n')
  assert.ok(text.includes(`${ownTag}_PROMPT`) && text.includes(`${ownTag}_DONE`))
  assertNativeProjectIsolation(session.bytes, `${ownTag}_`, `${otherTag}_`)
  return { session, messages }
}

function archiveFullTranscripts(project, label, snapshot) {
  return Object.entries(snapshot).map(([relativePath, bytes], index) => {
    const file = `${project.tag}-${index + 1}-${label}.jsonl`
    const archived = redact(bytes)
    fs.writeFileSync(path.join(outputDir, file), archived, { flag: 'wx' })
    return { relativePath, file, originalSha256: sha256(bytes), archivedSha256: sha256(archived), originalBytes: Buffer.byteLength(bytes), fullRecordsPreserved: true, redaction: 'Checkout/temp path redaction after original full-byte comparison; not a message-only projection' }
  })
}

try {
  ;({ win } = await walk.start({ first: true }))
  win.setDefaultTimeout(stationTimeout())
  const projectA = { ...await walk.newProject(), tag: 'A' }
  receipt.projects.push(projectA)
  await selectModel()
  await completedTurn('PROJECT_A')
  const held = walk.fixture.expectText({ label: 'PROJECT_A actual stream across project switch', match: (body) => flattenRequestText(body).includes('PROJECT_A_SWITCH_PROMPT'), reply: { type: 'hold', text: 'PROJECT_A_SWITCH_PARTIAL' } })
  await sendCreation(win, 'PROJECT_A_SWITCH_PROMPT')
  await recorded(held.received, 'PROJECT_A streaming request')
  await expect(win.locator(CREATION_PANEL)).toContainText('PROJECT_A_SWITCH_PARTIAL')
  await expect(win.locator(`${CREATION_PANEL} ${COMPOSER}`)).toHaveAttribute('data-mode', 'running')
  await walk.snap('project-a-real-stream-before-switch')
  await backToLibrary(win)
  const projectB = { ...await walk.newProject(), tag: 'B' }
  receipt.projects.push(projectB)
  assert.notEqual(projectA.projectId, projectB.projectId)
  assert.notEqual(projectA.projectRoot, projectB.projectRoot)
  await selectModel()
  await completedTurn('PROJECT_B')
  const a = nativeSession(projectA, 'PROJECT_A', 'PROJECT_B')
  const b = nativeSession(projectB, 'PROJECT_B', 'PROJECT_A')
  assert.notEqual(a.session.sessionId, b.session.sessionId, 'Same main lane name belongs to independent native project sessions')
  assert.equal(a.messages.at(-1).stopReason, 'aborted')
  assert.ok(laneMessageText(a.messages.at(-1)).includes('PROJECT_A_SWITCH_PARTIAL'))
  assert.equal(b.messages.at(-1).stopReason, 'stop')
  receipt.cases.push({ id: 'agent.cross-project-running-switch', executed: true, functionalPassed: true, firstNativeStopReason: 'aborted', secondNativeStopReason: 'stop', independentSessionIds: true, crossProjectRequestResponseIsolation: true })
  await expect(win.locator(CREATION_PANEL)).not.toContainText('PROJECT_A_')
  await walk.snap('project-b-independent-completed-native-turn')
  await backToLibrary(win)
  await openProject(projectA)
  await expect(win.locator(CREATION_PANEL)).toContainText('PROJECT_A_DONE')
  await expect(win.locator(`${CREATION_PANEL} [data-v4-block="assistant"][data-status="interrupted"]`)).toContainText('PROJECT_A_SWITCH_PARTIAL')
  await expect(win.locator(CREATION_PANEL)).not.toContainText('PROJECT_B_')
  const requestsBeforeCold = walk.fixture.requests.length
  assert.equal(requestsBeforeCold, 3)
  await walk.stopApp()
  const before = receipt.projects.map((project) => laneDiskSnapshot(project.projectRoot))
  receipt.transcripts = receipt.projects.map((project, index) => ({ tag: project.tag, before: archiveFullTranscripts(project, 'before-cold', before[index]) }))
  ;({ win } = await walk.start())
  win.setDefaultTimeout(stationTimeout())
  assert.notEqual(walk.report.launches[0].pid, walk.report.launches[1].pid, 'Recovery must use a new actual Electron process')
  await openProject(projectB)
  await expect(win.locator(CREATION_PANEL)).toContainText('PROJECT_B_DONE')
  await expect(win.locator(CREATION_PANEL)).not.toContainText('PROJECT_A_')
  await walk.snap('cold-project-b-preserves-own-transcript')
  await backToLibrary(win)
  await openProject(projectA)
  await expect(win.locator(CREATION_PANEL)).toContainText('PROJECT_A_DONE')
  await expect(win.locator(`${CREATION_PANEL} [data-v4-block="assistant"][data-status="interrupted"]`)).toContainText('PROJECT_A_SWITCH_PARTIAL')
  await expect(win.locator(CREATION_PANEL)).not.toContainText('PROJECT_B_')
  await walk.snap('cold-project-a-preserves-completed-and-interrupted-content')
  await walk.stopApp()
  for (const [index, project] of receipt.projects.entries()) {
    const after = laneDiskSnapshot(project.projectRoot)
    assert.deepEqual(after, before[index], 'Every complete original transcript byte, record, note and branch survives cold recovery and final teardown')
    receipt.transcripts[index].after = archiveFullTranscripts(project, 'after-cold', after)
    nativeSession(project, `PROJECT_${project.tag}`, `PROJECT_${project.tag === 'A' ? 'B' : 'A'}`)
  }
  assert.equal(walk.fixture.requests.length, requestsBeforeCold, 'Cold open, switching and final teardown cannot replay model requests')
  receipt.cases.push({ id: 'agent.cross-project-cold-recovery', executed: true, functionalPassed: true, originalFullTranscriptBytesUnchanged: true, allRecordTypesCompared: true, noModelRequestOnReopenOrTeardown: true, projectSelectionAndVisibleContentMatched: true, actualNewProcess: true })
  receipt.functionalPassed = true
  walk.fixture.assertClean()
} catch (error) {
  failure = error
  receipt.failure = error.message
  receipt.functionalPassed = false
  process.exitCode = 1
} finally {
  try { await walk.finish(failure) } catch (error) { receipt.finishFailure = error.message; receipt.functionalPassed = false; process.exitCode = 1 }
  receipt.runtimeReport = walk.report
  try { receipt.nativeSessions = receipt.projects.map((project) => ({ tag: project.tag, sessions: readLaneTranscripts(project.projectRoot).map((session) => ({ laneName: session.laneName, sessionId: session.sessionId, sha256: sha256(session.bytes), messages: laneMessages(session) })) })) }
  catch (error) { receipt.nativeSnapshotFailure = error.message; receipt.functionalPassed = false; process.exitCode = 1 }
  for (const file of walk.report.screenshots || []) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(outputDir, path.basename(file)), fs.constants.COPYFILE_EXCL)
  try { receipt.guard = validateNativeWalkEvidence(walk.report, guardLog, 3); receipt.evidenceValid = true }
  catch (error) { receipt.guard = error.guard; receipt.evidenceFailure = error.message; receipt.evidenceValid = false; receipt.functionalPassed = false; process.exitCode = 1 }
  if (fs.existsSync(guardLog)) fs.writeFileSync(guardLog, redact(fs.readFileSync(guardLog, 'utf8')))
  fs.writeFileSync(path.join(outputDir, 'receipt.json'), JSON.stringify(redact(receipt), null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output: path.join(outputDir, 'receipt.json'), cases: receipt.cases, functionalPassed: receipt.functionalPassed, evidenceValid: receipt.evidenceValid, failure: receipt.failure, finishFailure: receipt.finishFailure, evidenceFailure: receipt.evidenceFailure }))
}
