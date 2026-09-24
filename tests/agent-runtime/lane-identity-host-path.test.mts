// 对话身份不是宿主路径（2026-09-24 Windows 真机：Agent 面板点发送没有任何反应）。
//
// `laneSessionCwd` 给每条对话一个 `/nomi-lane/<名字>` 的身份，pi 把它当会话 cwd 写进表头、
// 拿它算目录 slug。pi 用宿主 `path.resolve` 解析 cwd——POSIX 上这个串解析完还是自己，
// Windows 上会被补成 `<项目所在盘>:\nomi-lane\main`。于是列表按前缀一条都认不出，
// 新项目打开后 `lanes` 为空，渲染层认定「没有对话」，发送钮静默返回。
//
// 这条测试在任何平台上都要能红：它把宿主解析换成 Windows 的行为（只对身份串），
// 然后走桌面打开项目的真实路径（不带模型 = 只读历史视图），用渲染层同一个判据问「有没有对话」。
import assert from 'node:assert/strict'
import { win32 } from 'node:path'
import test from 'node:test'
import { ok } from '@earendil-works/pi-agent-core'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/harness/env/nodejs'
import { openLaneWorkspace } from '../../electron/agentLane/laneWorkspace.mjs'
import { LANE_IDENTITY_ROOT } from '../../electron/agentLane/laneFileSystem.mjs'
import { listLaneSessions } from '../../electron/agentLane/laneSession.mjs'
import { laneConversationOf } from '../../electron/shared/agentLane/laneConversation.js'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/pi-agent-core/harness/context'
import { createLaneFixture } from './laneFixture.mjs'

test('a fresh project lists its conversation even when the host resolves "/nomi-lane/…" like Windows does', async t => {
  const hostAbsolutePath = NodeExecutionEnv.prototype.absolutePath
  t.mock.method(NodeExecutionEnv.prototype, 'absolutePath', async function (this: NodeExecutionEnv, path: string, context: Context) {
    // Windows 的 path.resolve：以 `/` 开头的串被补上当前盘符。只改身份串，真路径照旧走宿主。
    return path.startsWith(LANE_IDENTITY_ROOT) ? ok(win32.resolve('C:\\project', path)) : hostAbsolutePath.call(this, path, context)
  })
  const fixture = await createLaneFixture(t, [])
  // 桌面开项目时不带模型（`laneDesktopRuntime` openWorkspace）：走只读历史视图，正是用户那一刻的路径。
  const { model: _model, ...historyOptions } = fixture.options
  const workspace = await openLaneWorkspace(historyOptions)
  t.after(() => workspace.close())

  const projection = workspace.projection()
  assert.deepEqual(projection.lanes.map(lane => lane.laneName), ['main'],
    '新项目一打开就要有 main 这一条——列表为空时渲染层没有任何地方能把第一句话装进去')
  assert.ok(laneConversationOf(projection), '渲染层判「有没有对话」用的就是这一个函数')
  const listed = await listLaneSessions(fixture.projectDir, BACKGROUND_CONTEXT)
  assert.deepEqual(listed.map(lane => [lane.laneName, lane.sessionId]), [['main', projection.lanes[0].sessionId]],
    '冷读列表与打开时认到的是同一条会话——身份在写入与读回两侧是同一个串')
})
