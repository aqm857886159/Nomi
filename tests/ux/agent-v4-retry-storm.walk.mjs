#!/usr/bin/env node
import { stationTimeout } from './_station-budget.mjs'
// 真实任务走查（R16）：**Agent 反复试同一个工具**。
//
// 复现的是 2026-09-06 晚打包版上的现场：用户在分镜表里让 Agent「从原稿重拆 10 镜」，
// 右侧面板出现 6 条一模一样的「创建或修改镜头卡 · ⚠ <1s」，中间夹着模型的自言自语
// （「参数需要是数组而不是字符串」「我把 JSON 字符串化两次了」），最后它放弃工具改口。
// 用户原话：「这堆工具没什么重要的东西……不可能有这么多都放在那里……看的时候得点入」。
//
// 这条走查证的是三件事，逐条对应那次截图里的三个问题：
//   A 展开一条收据，**输入是真实入参、输出是真实结果**，两栏不再是同一句工具描述；
//   B 同名工具连着调 3 次折成**一行**，行内带失败原因，展开才逐次；
//   C lane 保留工具之间的独立助手文本：自我纠正折成过程行，最终回答保持展开。
//
// 零额度：供应商是 loopback（`agent-runtime-fixture.mjs`）。工具调用是**真的**被执行、
// 真的失败——入参喂的是解不出的 JSON 文本，所以它走的是生产的失败路径，不是假装失败。
//
// 用法：node tests/ux/agent-v4-retry-storm.walk.mjs
import { clickOrFail, expect, proveProbe } from './_assert.mjs'
import { laneMessages, laneMessageText, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL,
  TOOL_RECEIPT,
  ASSISTANT_MESSAGE,
  chooseAssistantModel,
  createRuntimeWalk,
  hasToolResult,
  openCanvas,
  readProject,
  recorded,
  sendCanvas,
  waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'

const TOOL_GROUP = '[data-v4-block="tool-group"]'
const PROCESS_ROW = '[data-v4-block="process"]'

const ASK = '从原稿重拆 10 镜，只建卡不生成。'
// 解不出的 JSON 文本：容错层会试着解开它，解不出就 fail-closed——正是我们要的真实失败。
// （能解开的那一半由 `jsonArgTolerance.test.ts` 证明；这里要的是失败那一半的界面行为。）
const BROKEN_NODES = '[{"clientId":"s1","kind":"image"'
const READ_TOOL = 'v4-canvas-read-1'
const ATTEMPTS = ['v4-retry-1', 'v4-retry-2', 'v4-retry-3']
const SELF_TALK = [
  '我看到参数需要是数组而不是字符串，让我修正。',
  '我把 JSON 字符串化两次了，这次直接传数组。',
]
const GIVE_UP = '工具这条路走不通，我直接把分镜写进文稿。'

const walk = await createRuntimeWalk('v4-retry-storm')
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId, projectRoot } = await walk.newProject()
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)
  await openCanvas(win)
  const panel = win.locator(CANVAS_PANEL)

  // 走默认的「自动改」——用户 2026-09-06 那次就在这一档。
  // 先读一眼画布——这一次**成功**，它是 A 的正面证据：一条真的跑通的调用，
  // 展开后输入是它真的发过去的入参、输出是它真的拿回来的结果。
  const read = walk.fixture.expectText({
    label: 'agent reads the canvas first',
    match: (body) => flattenRequestText(body).includes(ASK) && !hasToolResult(body, READ_TOOL),
    // `canvas.read` 的契约就是**不收参数**（`z.object({}).strict()`），所以入参就是 `{}`。
    // 它照样是 A 的正面证据：那一栏印的是这次调用真的发过去的东西，而不是一句工具描述。
    reply: { type: 'tool', id: READ_TOOL, name: 'look_at_canvas', args: {} },
  })
  // 然后是第一次建卡尝试。
  const first = walk.fixture.expectText({
    label: 'agent attempts the first shot-card write',
    match: (body) => hasToolResult(body, READ_TOOL) && !hasToolResult(body, ATTEMPTS[0]),
    reply: {
      type: 'tool',
      id: ATTEMPTS[0],
      name: 'draft_shots',
      args: { shots: BROKEN_NODES },
    },
  })
  // 第二、三次：**同一条消息里既说话又调工具**——真实模型就是这么写的，
  // 而那句话正是用户看到的「让我修正…」。
  const retries = ATTEMPTS.slice(1).map((id, index) => walk.fixture.expectText({
    label: `agent retries the shot-card write (${index + 1})`,
    match: (body) => hasToolResult(body, ATTEMPTS[index]) && !hasToolResult(body, id),
    reply: {
      type: 'tool',
      id,
      name: 'draft_shots',
      text: SELF_TALK[index],
      args: { shots: BROKEN_NODES },
    },
  }))
  const giveUp = walk.fixture.expectText({
    label: 'agent gives up on the tool and answers in prose',
    match: (body) => hasToolResult(body, ATTEMPTS[2]),
    reply: { type: 'text', text: GIVE_UP },
  })

  await sendCanvas(win, ASK)
  await recorded(read.received, 'canvas read')
  await recorded(first.received, 'first shot-card attempt')
  for (const [index, retry] of retries.entries()) await recorded(retry.received, `retry ${index + 1}`)
  await recorded(giveUp.received, 'give-up answer')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.locator(ASSISTANT_MESSAGE).last() })

  // ── B 三次同名调用折成一行 ───────────────────────────────────────────────
  const group = panel.locator(TOOL_GROUP)
  const groupProof = await proveProbe(group, '三次同名调用折成了一行')
  await expect(group, '连着三次同名调用必须只占一行').toHaveCount(1)
  await expect(group).toHaveAttribute('data-count', '3')
  await expect(group).toHaveAttribute('data-status', 'output-error')
  // 行内必须带**原因**。用户那次连吃六条「⚠ <1s」，一个字的原因都没有，
  // 只能靠模型自己在正文里猜——一行收据的意义就是「不展开也知道发生了什么」。
  await expect(group, '折起来的失败行必须在行内说清为什么失败').not.toHaveText(/^\s*$/)
  const groupHeadline = (await group.locator('> summary').innerText()).trim()
  if (groupHeadline.length < 8) throw new Error(`折起来那一行太空了，读不出发生了什么：「${groupHeadline}」`)
  // 折起来的时候，逐次那三条**不该**摊在流里——那正是「不可能有这么多都放在那里」。
  await expect(panel.locator(`${TOOL_GROUP} ${TOOL_RECEIPT}`)).toHaveCount(3)
  await walk.snap('01-collapsed-retry-row')

  // ── C lane 原始消息顺序 → 过程折叠 + 一条最终回答 ──────────────────────
  // pi 每次 assistant 消息保留正文与调用位置，不再依赖旧 Host 的审批锚点。
  const answers = panel.locator(ASSISTANT_MESSAGE)
  await expect(answers, '自我纠正折叠之后最终回答仍须展开').toHaveCount(1)
  await expect(answers.first()).toContainText(GIVE_UP)
  const process = panel.locator(PROCESS_ROW)
  await expect(process, '两段自我纠正必须归在同一条过程行').toHaveCount(1)
  await expect(process).toHaveAttribute('data-count', '2')
  await clickOrFail(process.locator('> summary'), '展开真实的工具重试过程')
  for (const text of SELF_TALK) await expect(process).toContainText(text)
  await clickOrFail(process.locator('> summary'), '收起工具重试过程')

  await expect.poll(() => readLaneTranscripts(projectRoot).flatMap(laneMessages)
    .filter(message => message.role === 'toolResult' && ATTEMPTS.includes(message.toolCallId)).length,
  { message: '三次真实失败结果必须写入 lane JSONL', timeout: stationTimeout({ operations: 2 }) }).toBe(3)
  const messages = readLaneTranscripts(projectRoot).flatMap(laneMessages)
  const calls = messages.filter(message => message.role === 'assistant')
    .flatMap(message => message.content).filter(part => part.type === 'toolCall')
  expect(calls.filter(call => ATTEMPTS.includes(call.id)).map(call => [call.name, call.arguments.shots]))
    .toEqual(ATTEMPTS.map(() => ['draft_shots', BROKEN_NODES]))
  const results = messages.filter(message => message.role === 'toolResult' && ATTEMPTS.includes(message.toolCallId))
  expect(results.every(message => message.isError && laneMessageText(message).length > 0)).toBe(true)
  expect(messages.filter(message => message.role === 'assistant').map(laneMessageText).filter(Boolean))
    .toEqual([...SELF_TALK, GIVE_UP])
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes,
    '三次非法工具入参不能创建任何节点').toHaveLength(0)
  await walk.snap('02-answer-still-readable')

  // ── A 展开收据：输入是真入参，输出是真结果 ──────────────────────────────
  //
  // 先看那条**跑通的** `读取画布`：两栏都齐，而且不是同一句话。
  // 「输入 = 输出」正是 2026-09-06 那张截图的病——两栏印的都是工具描述。
  const readReceipt = panel.locator(TOOL_RECEIPT).filter({ hasText: '读取画布' }).first()
  await clickOrFail(readReceipt.locator('> summary'), '展开「读取画布」那条收据')
  const [inputBlock, outputBlock] = await readReceipt.locator('pre').allInnerTexts()
  if (!inputBlock || !outputBlock) throw new Error(`收据展开体缺了输入或输出那一段：input=${inputBlock} output=${outputBlock}`)
  if (inputBlock.trim() !== '{}') throw new Error(`输入栏读到的不是这次真的发过去的入参：「${inputBlock}」`)
  if (inputBlock.trim() === outputBlock.trim()) {
    throw new Error(`收据的输入与输出仍然是同一句话（这就是那个 bug）：「${inputBlock.trim()}」`)
  }
  await walk.snap('03-receipt-expanded')

  // 再看失败的那三条：展开后必须读得到**真实的失败原因**，而不是「打算做什么」。
  await clickOrFail(group.locator('> summary'), '展开折叠的收据行')
  const failed = panel.locator(`${TOOL_GROUP} ${TOOL_RECEIPT}`).first()
  await clickOrFail(failed.locator('> summary'), '展开第一条失败收据')
  const failureBody = (await failed.locator('pre').allInnerTexts()).join('\n').trim()
  if (!failureBody) throw new Error('失败收据展开后什么都没有——那正是用户看到的样子')
  if (failureBody.includes('把镜头卡写入当前画布')) {
    throw new Error(`失败收据仍然在印工具描述，而不是这次为什么失败：「${failureBody}」`)
  }
  await walk.snap('04-failed-receipt-expanded')

  // 收尾：证明上面那些断言不是对着一块空面板做的。
  await expect(panel.locator(TOOL_GROUP), '面板上确实有那一行').toHaveCount(1)
  if (!groupProof) throw new Error('折叠行的存在性探针没有留下证据')
} catch (error) {
  failure = error
}
await walk.finish(failure)
