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
// 工具调用是**真的**过生产的入参边界、真的被拒。夹具模型是一条固定的「策略」，修前修后同一条：
//   · 读到「停」就改问用户；
//   · 否则同一个错写连发，最多 6 次；第 6 次之后改对一次（去掉不存在的字段）。
// 用户那次是一回合 21 次工具、14 次重试；这里取同一形状里最常见的一段：同错 6 次 + 改对 1 次。
//
// 修后（缺省）证：
//   A 模型第一次就读到「shots.0.duration 没有这个字段，应写 durationSec」；
//   B 第 3 次的拒收正文带「停」——这一轮别再发，去问用户（于是只发了 3 次）；
//   C 面板的失败行在行内说「哪个字段 · 该填什么」，中英两轨各截一张。
// 修前（`TOOLFAIL_REPLAY=before`，跑在合入基点的构建上）证复现了：6 次全被拒、一次都没拦、
// 正文不点名 `durationSec`，第 7 次改对才起草出来；面板同样截 zh / en。
//
// 用法：node tests/ux/agent-tool-failure-boundary.walk.mjs
//       TOOLFAIL_REPLAY=before node tests/ux/agent-tool-failure-boundary.walk.mjs
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

const MODE = process.env.TOOLFAIL_REPLAY === 'before' ? 'before' : 'after'
const TOOL_GROUP = '[data-v4-block="tool-group"]'
const ASK = 'TOOLFAIL_ASK：帮我起草一镜「窗台橘猫」，5 秒，先不生成。'
const BAD_LIMIT = 6
const badId = (n) => `toolfail-${n}`
const FIXED_ID = 'toolfail-fixed'
const ASK_USER = 'TOOLFAIL_ASKED：时长那一栏我连着填错了三次，你想要几秒？我按你说的再起草。'
const DONE = 'TOOLFAIL_DONE：去掉时长那一栏后起草好了。'
const shot = () => ({
  title: '窗台橘猫', prompt: '一只在窗台上晒太阳的橘猫', taskKind: 'text_to_image',
  candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL },
})
// 模型真会犯的错：时长写成 `duration`（契约里是 `durationSec`）。每次都一样——它没读懂拒收正文时就是这样。
const badShot = () => ({
  title: '窗台橘猫', prompt: '一只在窗台上晒太阳的橘猫', taskKind: 'text_to_image',
  candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL },
  /* walkthrough-tool-args: intentional-bad-key duration — 复现模型把 durationSec 写成 duration、一错再错 */ duration: 5,
})
const FIELD_LINE = /shots\.0\.duration: no such field here; did you mean "durationSec"\?/
const STOP_LINE = /draft_shots has failed the same way 3 times in a row\. Do not send it again in this turn/

const toolText = (body, id) => (body.messages ?? [])
  .filter((message) => message.role === 'tool' && message.tool_call_id === id)
  .map((message) => (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)))
  .join('\n')

// 起 App 的子进程用假主目录：宿主配置、~ 下的一切都不碰用户真实资料。
const fakeHome = makeTempDir('nomi-pi-tool-failure-home-')
const walk = await createRuntimeWalk(`tool-failure-boundary-${MODE}`, { generationProvider: 'apimart', env: { HOME: fakeHome } })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  const panel = win.locator(CANVAS_PANEL)

  // 夹具模型的策略：每个请求按「已经读到了哪些结果」决定下一步。`seen[i]` = 第 i+1 次错写读到的正文。
  const seen = []
  const replies = []
  let settle
  const settled = new Promise((resolve) => { settle = resolve })
  walk.fixture.respond({
    label: 'scripted model: same wrong key until told to stop, then ask; corrects after 6 tries',
    match: (body) => flattenRequestText(body).includes(ASK),
    reply: (body) => {
      let sent = 0
      while (hasToolResult(body, badId(sent + 1))) {
        seen[sent] = toolText(body, badId(sent + 1))
        sent += 1
      }
      let reply
      if (sent > 0 && STOP_LINE.test(seen[sent - 1])) reply = { type: 'text', text: ASK_USER }
      else if (hasToolResult(body, FIXED_ID)) reply = { type: 'text', text: DONE }
      else if (sent < BAD_LIMIT) reply = { type: 'tool', id: badId(sent + 1), name: 'draft_shots', args: { shots: [badShot()] } }
      else reply = { type: 'tool', id: FIXED_ID, name: 'draft_shots', args: { shots: [shot()] } }
      replies.push(reply.type === 'tool' ? reply.id : reply.text.split('：', 1)[0])
      if (reply.type === 'text') settle(reply.text)
      return reply
    },
  })

  await sendCanvas(win, ASK)
  const finalText = await recorded(settled, 'the scripted model ends the turn', 120_000)
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })

  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
  const results = readLaneTranscripts(projectRoot).flatMap(laneMessages)
    .filter((message) => message.role === 'toolResult' && String(message.toolCallId).startsWith('toolfail-'))
  const group = panel.locator(TOOL_GROUP)
  const groups = await group.evaluateAll((elements) => elements.map((element) => ({
    status: element.getAttribute('data-status'),
    count: element.getAttribute('data-count'),
    summary: element.querySelector(':scope > summary')?.textContent?.trim() ?? '',
  })))
  const facts = {
    mode: MODE,
    modelSteps: replies,
    toolCalls: results.length,
    rejected: results.filter((message) => message.isError).length,
    namesTheField: seen.map((text) => FIELD_LINE.test(text)),
    stopNoteAt: seen.findIndex((text) => STOP_LINE.test(text)) + 1 || null,
    firstRejection: (seen[0] ?? '').slice(0, 400),
    nodes: nodes.length,
    providerImageRequests: walk.fixture.images.length,
    panelGroups: groups,
  }
  console.log(`[tool-failure-boundary] facts ${JSON.stringify(facts)}`)
  expect(walk.fixture.images, '起草不生成：供应商一次请求都没收到').toHaveLength(0)

  if (MODE === 'after') {
    // ── A 模型第一次就读到哪个字段、该填什么 ──
    expect(seen, '读到「停」就改问：只发了 3 次').toHaveLength(3)
    expect(seen[0], '第 1 次拒收正文点名字段并给出该填的名字').toMatch(FIELD_LINE)
    expect(seen[0], '第 1 次不带「停」').not.toMatch(STOP_LINE)
    expect(seen[1], '第 2 次照样点名字段').toMatch(FIELD_LINE)
    // ── B 第 3 次带「停」 ──
    expect(seen[2], '第 3 次仍点名字段').toMatch(FIELD_LINE)
    expect(seen[2], '第 3 次带「停」：这一轮别再发，去问用户').toMatch(STOP_LINE)
    expect(finalText, '收尾是问用户').toBe(ASK_USER)
    expect(nodes, '三次被拒，画布上没有任何节点').toHaveLength(0)
    expect(results.map((message) => message.isError), '三次都是真失败、写进了 lane 转录').toEqual([true, true, true])
  } else {
    // ── 修前的样子：6 次全被拒、一次都没拦、正文不点名该写的字段；第 7 次改对才起草出来 ──
    expect(seen, '没人叫停：同一个错写发满 6 次').toHaveLength(BAD_LIMIT)
    expect(seen.some((text) => STOP_LINE.test(text)), '修前：没有一次带「停」').toBe(false)
    expect(seen.some((text) => FIELD_LINE.test(text)), '修前：正文不点名 durationSec').toBe(false)
    expect(finalText, '改对一次后收尾').toBe(DONE)
    expect(results.map((message) => message.isError), '6 次失败 + 1 次成功，都写进了 lane 转录')
      .toEqual([...Array(BAD_LIMIT).fill(true), false])
  }

  // ── C 面板失败行 ──
  const groupProof = await proveProbe(group.first(), '同名工具调用折成的那一行')
  if (MODE === 'after') {
    await expect(group).toHaveCount(1)
    await expect(group).toHaveAttribute('data-status', 'output-error')
    await expect(group.locator('> summary'), '中文：失败行点名字段、给出该写的名字').toContainText('durationSec')
    await expect(panel.locator(ASSISTANT_MESSAGE).last()).toContainText('TOOLFAIL_ASKED')
  }
  await walk.snap(`${MODE}-01-zh-failure-row`)
  await clickOrFail(group.first().locator('> summary'), '展开折叠的失败行')
  const first = panel.locator(`${TOOL_GROUP} ${TOOL_RECEIPT}`).first()
  await clickOrFail(first.locator('> summary'), '展开第一条失败收据')
  if (MODE === 'after') await expect(first, '中文展开体：字段 · 该填什么').toContainText('durationSec')
  await walk.snap(`${MODE}-02-zh-failure-expanded`)

  // 英文同一态（EN 串更长，截断只有眼睛看得出）：从设置里切语言，像真人那样。
  await switchAppLocale(win, 'en')
  if (MODE === 'after') await expect(group.locator('> summary'), '英文：失败行点名字段、给出该写的名字').toContainText('durationSec')
  await walk.snap(`${MODE}-03-en-failure-row`)
  if (!groupProof) throw new Error('失败行的存在性探针没有留下证据')
} catch (error) {
  failure = error
}
await walk.finish(failure)
