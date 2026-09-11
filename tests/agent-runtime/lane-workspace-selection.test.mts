import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context'
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs'
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs'
import { deleteLaneSession, listLaneSessions } from '../../electron/agentLane/laneSession.mjs'
import { createLaneFixture } from './laneFixture.mjs'
import type { LaneWorkspaceProjection } from '../../electron/shared/agentLane/laneContracts.js'

const selectionPath = (projectDir: string) => join(projectDir, '.nomi', 'agent-workspace.json')
const exec = promisify(execFile)

async function coldHistory(projectDir: string): Promise<LaneWorkspaceProjection> {
  const url = new URL('../../electron/agentLane/laneWorkspace.mjs', import.meta.url).href
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', `
    const { openLaneWorkspace } = await import(${JSON.stringify(url)});
    const workspace = await openLaneWorkspace({ projectDir: process.argv[1], tools: [], systemPrompt: 'Fixture history' });
    try { process.stdout.write(JSON.stringify(workspace.projection())); } finally { await workspace.close(); }
  `, projectDir])
  return JSON.parse(stdout) as LaneWorkspaceProjection
}

test('a new process restores the last selected conversation without changing its session timestamps or transcript', async t => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Fixture B reply.' }])
  const workspace = await openLaneWorkspace(fixture.options)
  t.after(() => workspace.close())
  await workspace.execute({ kind: 'lane-create', laneName: 'research' })
  await workspace.execute({ kind: 'prompt', text: 'Fixture B question.' })
  await workspace.execute({ kind: 'lane-select', laneName: 'main' })
  await workspace.execute({ kind: 'lane-select', laneName: 'research' })
  const before = workspace.projection()
  await workspace.close()
  const cold = await coldHistory(fixture.projectDir)
  assert.equal(cold.active.lane, 'research')
  assert.deepEqual(cold.lanes, before.lanes)
  assert.deepEqual(cold.active.parts, before.active.parts)
})

test('deleting main and the formerly selected conversation cannot recreate either on cold start', async t => {
  const fixture = await createLaneFixture(t, [])
  const workspace = await openLaneWorkspace(fixture.options)
  t.after(() => workspace.close())
  await workspace.execute({ kind: 'lane-create', laneName: 'research' })
  await workspace.execute({ kind: 'lane-delete', laneName: 'main' })
  await workspace.execute({ kind: 'lane-create', laneName: 'replacement' })
  await workspace.execute({ kind: 'lane-delete', laneName: 'research' })
  const before = workspace.projection()
  await workspace.close()
  const cold = await coldHistory(fixture.projectDir)
  assert.equal(cold.active.lane, 'replacement')
  assert.deepEqual(cold.lanes, before.lanes)
  assert.deepEqual(cold.lanes.map(lane => lane.laneName), ['replacement'])
})

test('missing, malformed and stale selection can only choose a real existing session', async t => {
  const fixture = await createLaneFixture(t, [])
  const workspace = await openLaneWorkspace(fixture.options)
  t.after(() => workspace.close())
  await workspace.execute({ kind: 'lane-create', laneName: 'survivor' })
  await workspace.execute({ kind: 'lane-delete', laneName: 'main' })
  await workspace.close()
  const before = await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT)
  for (const value of [undefined, '{', JSON.stringify({ laneName: 'main', sessionId: 'deleted-id' }),
    JSON.stringify({ laneName: 'survivor', sessionId: 'wrong-identity' })]) {
    if (value === undefined) await rm(selectionPath(fixture.projectDir), { force: true })
    else await writeFile(selectionPath(fixture.projectDir), value)
    const cold = await coldHistory(fixture.projectDir)
    assert.equal(cold.active.lane, 'survivor')
    assert.deepEqual(cold.lanes, before)
  }
})

test('selection pointers are project-local and unchanged model attachment does not rewrite them', async t => {
  const first = await createLaneFixture(t, [])
  const second = await createLaneFixture(t, [])
  const a = await openLaneWorkspace(first.options)
  const b = await openLaneWorkspace(second.options)
  t.after(async () => { await a.close(); await b.close() })
  await a.execute({ kind: 'lane-create', laneName: 'research' })
  const before = await readFile(selectionPath(first.projectDir), 'utf8')
  const beforeStat = await stat(selectionPath(first.projectDir))
  await a.configureModel(first.options.model)
  assert.equal(await readFile(selectionPath(first.projectDir), 'utf8'), before)
  const afterStat = await stat(selectionPath(first.projectDir))
  assert.equal(afterStat.ino, beforeStat.ino, 'same identity must not atomically replace the pointer')
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs)
  await a.close(); await b.close()
  assert.equal((await coldHistory(first.projectDir)).active.lane, 'research')
  assert.equal((await stat(selectionPath(first.projectDir))).ino, beforeStat.ino)
  assert.equal((await coldHistory(second.projectDir)).active.lane, 'main')
})

test('a failed selection commit closes its opened host and cannot admit more workspace commands', async t => {
  const fixture = await createLaneFixture(t, [])
  const workspace = await openLaneWorkspace(fixture.options)
  t.after(() => workspace.close())
  await rm(selectionPath(fixture.projectDir))
  await mkdir(selectionPath(fixture.projectDir))
  await assert.rejects(workspace.execute({ kind: 'lane-create', laneName: 'research' }))
  await assert.rejects(workspace.execute({ kind: 'prompt', text: 'Never admitted.' }), /agent_lane_disposed/)
  const reopened = await openLaneHistory({ projectDir: fixture.projectDir, laneName: 'research' })
  await reopened.close()
  assert.equal(fixture.http.requests.length, 0)
})

test('an explicit missing selection cannot create a conversation in a nonempty project', async t => {
  const fixture = await createLaneFixture(t, [])
  const workspace = await openLaneWorkspace(fixture.options)
  await workspace.close()
  const before = await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT)
  await assert.rejects(openLaneWorkspace({ ...fixture.options, laneName: 'deleted' }), /agent_lane_conversation_missing/)
  assert.deepEqual(await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT), before)
})

test('a deleted selected session with no survivors creates exactly one fresh main', async t => {
  const fixture = await createLaneFixture(t, [])
  const workspace = await openLaneWorkspace(fixture.options)
  await workspace.close()
  assert.equal(await deleteLaneSession(fixture.projectDir, 'main', BACKGROUND_CONTEXT), true)
  const cold = await coldHistory(fixture.projectDir)
  assert.equal(cold.active.lane, 'main')
  assert.equal(cold.lanes.length, 1)
})
