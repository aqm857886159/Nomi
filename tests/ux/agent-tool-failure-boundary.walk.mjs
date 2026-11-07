#!/usr/bin/env node
// 真实场景复现（2026-11-07）：用户原话「经常出现什么参数不对 重试等问题」。
//
// 现场：用户在画布面板里让 Agent 起草镜头，模型给镜头写了一个不存在的字段（`duration`，
// 契约里叫 `durationSec`），然后一错再错。修之前三件事一起坏：
//   ① 模型读到的拒收正文不说哪个字段、该填什么，它只能瞎猜着重发；
//   ② 形状错是 pi 的立即结果，跳过 after_tool，「同错三次就停」一次都数不到；
//   ③ 面板那一行只说「参数没填对」，用户看不出错在哪。
//
// 这条走查按真人的手法走（一个窗口、只点界面、模型从下拉里选），零额度：模型是 loopback 夹具，
// 工具调用是**真的**过生产的入参边界、真的被拒。它证：
//   A 模型第一次就读到「shots.0.duration 没有这个字段，应写 durationSec」；
//   B 第 3 次的拒收正文带「停」——这一轮别再发，去问用户；
//   C 面板的失败行在行内说「哪个字段 · 该填什么」，中英两轨各截一张。
//
// 用法：node tests/ux/agent-tool-failure-boundary.walk.mjs
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { clickOrFail, expect, proveProbe } from './_assert.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  ASSISTANT_MESSAGE,
  CANVAS_PANEL,
  TOOL_RECEIPT,
  chooseAssistantModel,
  createRuntimeWalk,
  hasToolResult,
  openCanvas,
  readProject,
  recorded,
  sendCanvas,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { switchAppLocale } from './_permissionTiersPaidSteps.mjs'

const TOOL_GROUP = '[data-v4-block="tool-group"]'
const ASK = 'TOOLFAIL_ASK：帮我起草一镜「窗台橘猫」，5 秒，先不生成。'
const ATTEMPTS = ['toolfail-1', 'toolfail-2', 'toolfail-3']
const ASK_USER = 'TOOLFAIL_ASKED：时长那一栏我连着填错了三次，你想要几秒？我按你说的再起草。'
// 模型真会犯的错：时长写成 `duration`（契约里是 `durationSec`）。三次都一样——它没读懂拒收正文时就是这样。
const badShot = () => ({
  title: '窗台橘猫', prompt: '一只在窗台上晒太阳的橘猫', taskKind: 'text_to_image',
  candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL },
  /* walkthrough-tool-args: intentional-bad-key duration — 复现模型把 durationSec 写成 duration、连错三次 */ duration: 5,
})
const FIELD_LINE = /shots\.0\.duration: no such field here; did you mean "durationSec"\?/
const STOP_LINE = /draft_shots has failed the same way 3 times in a row\. Do not send it again in this turn/

const toolText = (body, id) => (body.messages ?? [])
  .filter((message) => message.role === 'tool' && message.tool_call_id === id)
  .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
  .join('\n')

// 起 App 的子进程用假主目录：宿主配置、~ 下的一切都不碰用户真实资料。
const fakeHome = makeTempDir('nomi-pi-tool-failure-home-')
const walk = await createRuntimeWalk('tool-failure-boundary', { generationProvider: 'apimart', env: { HOME: fakeHome } })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  const panel = win.locator(CANVAS_PANEL)

  // 模型每次读到的那段拒收正文（第 i 次调用的结果，在第 i+1 个请求里）。
  const seen = []
  const calls = ATTEMPTS.map((id, index) => walk.fixture.expectText({
    label: `agent drafts the shot with the wrong duration key (${index + 1})`,
    match: (body) => {
      if (index === 0 ? !flattenRequestText(body).includes(ASK) || hasToolResult(body, id) : !hasToolResult(body, ATTEMPTS[index - 1]) || hasToolResult(body, id)) return false
      if (index > 0) seen[index - 1] = toolText(body, ATTEMPTS[index - 1])
      return true
    },
    reply: { type: 'tool', id, name: 'draft_shots', args: { shots: [badShot()] } },
  }))
  const asked = walk.fixture.expectText({
    label: 'after the stop note the agent asks the user instead of retrying',
    match: (body) => {
      if (!hasToolResult(body, ATTEMPTS[2])) return false
      seen[2] = toolText(body, ATTEMPTS[2])
      return true
    },
    reply: { type: 'text', text: ASK_USER },
  })

  await sendCanvas(win, ASK)
  for (const [index, call] of calls.entries()) await recorded(call.received, `wrong-key attempt ${index + 1}`)
  await recorded(asked.received, 'agent asks the user')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })

  // ── A 模型第一次就读到哪个字段、该填什么 ──
  expect(seen[0], '第 1 次拒收正文点名字段并给出该填的名字').toMatch(FIELD_LINE)
  expect(seen[0], '第 1 次不带「停」').not.toMatch(STOP_LINE)
  expect(seen[1], '第 2 次照样点名字段').toMatch(FIELD_LINE)
  // ── B 第 3 次带「停」 ──
  expect(seen[2], '第 3 次仍点名字段').toMatch(FIELD_LINE)
  expect(seen[2], '第 3 次带「停」：这一轮别再发，去问用户').toMatch(STOP_LINE)
  expect(walk.fixture.images, '三次被拒，供应商一次请求都没收到').toHaveLength(0)
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes, '三次被拒，画布上没有任何节点').toHaveLength(0)
  const results = readLaneTranscripts(projectRoot).flatMap(laneMessages)
    .filter((message) => message.role === 'toolResult' && ATTEMPTS.includes(message.toolCallId))
  expect(results.map((message) => message.isError), '三次都是真失败、写进了 lane 转录').toEqual([true, true, true])

  // ── C 面板失败行：行内说「哪个字段 · 该填什么」 ──
  const group = panel.locator(TOOL_GROUP)
  const groupProof = await proveProbe(group, '三次同名失败折成一行')
  await expect(group).toHaveCount(1)
  await expect(group).toHaveAttribute('data-status', 'output-error')
  await expect(group.locator('> summary'), '中文：失败行点名字段、给出该写的名字').toContainText('durationSec')
  await expect(panel.locator(ASSISTANT_MESSAGE).last()).toContainText('TOOLFAIL_ASKED')
  await walk.snap('01-zh-failure-row')
  await clickOrFail(group.locator('> summary'), '展开折叠的失败行')
  const first = panel.locator(`${TOOL_GROUP} ${TOOL_RECEIPT}`).first()
  await clickOrFail(first.locator('> summary'), '展开第一条失败收据')
  await expect(first, '中文展开体：字段 · 该填什么').toContainText('durationSec')
  await walk.snap('02-zh-failure-expanded')

  // 英文同一态（EN 串更长，截断只有眼睛看得出）：从设置里切语言，像真人那样。
  await switchAppLocale(win, 'en')
  await expect(group.locator('> summary'), '英文：失败行点名字段、给出该写的名字').toContainText('durationSec')
  await walk.snap('03-en-failure-row')
  if (!groupProof) throw new Error('失败行的存在性探针没有留下证据')
} catch (error) {
  failure = error
}
await walk.finish(failure)
