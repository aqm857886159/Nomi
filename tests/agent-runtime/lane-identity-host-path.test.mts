// 对话身份不是宿主路径（2026-09-24 Windows 真机：Agent 面板点发送没有任何反应）。
//
// `laneSessionCwd` 给每条对话一个 `/nomi-lane/<名字>` 的身份，写进 SessionManager 表头并决定目录 slug。
// 1.7.0 起 `laneSessionCwd` / `laneSessionSlug` 直接按稳定身份串计算，不经宿主 `path.resolve`；
// 同时 `laneSessionV4Migration.mts` 对存量曾被 Windows 补上盘符的 v4 会话也归一回 `/nomi-lane/<名字>`。
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import test from 'node:test'
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs'
import { LANE_IDENTITY_ROOT } from '../../electron/agentLane/laneFileSystem.mjs'
import { laneSessionCwd, laneSessionsRoot, laneSessionSlug, listLaneSessions } from '../../electron/agentLane/laneSession.mjs'
import { laneConversationOf } from '../../electron/shared/agentLane/laneConversation.js'
import { createLaneFixture } from './laneFixture.mjs'

test('a fresh project lists its conversation with stable identity slug and recovers Windows-prefixed v4 headers', async t => {
  assert.equal(laneSessionCwd('main'), `${LANE_IDENTITY_ROOT}main`)
  assert.equal(laneSessionSlug(laneSessionCwd('main')), '--nomi-lane-main--')

  const fixture = await createLaneFixture(t, [])
  // 预置一条曾被 Windows `win32.resolve` 污染过 `cwd` 的 v4 会话表头，验证冷读与打开均认回稳定身份。
  const slugDir = join(laneSessionsRoot(fixture.projectDir), '--C--nomi-lane-windows-legacy--')
  await mkdir(slugDir, { recursive: true })
  const pollutedCwd = win32.resolve('C:\\project', '/nomi-lane/windows-legacy')
  await writeFile(
    join(slugDir, '11111111-1111-4111-8111-111111111111.jsonl'),
    `${JSON.stringify({ v: 4, kind: 'header', id: '11111111-1111-4111-8111-111111111111', cwd: pollutedCwd, createdAt: 1000 })}\n`,
  )

  const freshFixture = await createLaneFixture(t, [])
  const { model: _model, ...historyOptions } = freshFixture.options
  const workspace = await openLaneWorkspace(historyOptions)
  t.after(() => workspace.close())

  const projection = workspace.projection()
  assert.deepEqual(projection.lanes.map(lane => lane.laneName), ['main'],
    '新项目一打开就要有 main 这一条——列表为空时渲染层没有任何地方能把第一句话装进去')
  assert.ok(laneConversationOf(projection), '渲染层判「有没有对话」用的就是这一个函数')
  const listed = await listLaneSessions(freshFixture.projectDir)
  assert.deepEqual(listed.map(lane => [lane.laneName, lane.sessionId]), [['main', projection.lanes[0]!.sessionId]],
    '冷读列表与打开时认到的是同一条会话——身份在写入与读回两侧是同一个串')

  const pollutedListed = await listLaneSessions(fixture.projectDir)
  assert.deepEqual(pollutedListed.map(lane => [lane.laneName, lane.sessionId]), [
    ['windows-legacy', '11111111-1111-4111-8111-111111111111'],
  ])
})
