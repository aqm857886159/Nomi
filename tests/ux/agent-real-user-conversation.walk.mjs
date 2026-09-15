#!/usr/bin/env node
import { stationTimeout } from './_station-budget.mjs'
// R13/R16 · 常驻 Agent 对话面的「真实用户任务」体验走查（零额度 loopback 供应商）。
//
// 人物设定：林秋，一个人做美食短片。她今天要做一条「一碗深夜牛肉面」的片子——
// 先在创作面把脚本写出来、让 Nomi 读一遍并记住它读到了什么；再去生成面让 Nomi 摆镜头节点、
// 删掉一个不要的、补一个新的；中途改主意，插一句更急的指令并叫停正在跑的那一轮；
// 最后去剪辑面让 Nomi 加一条片头字幕。
//
// 这条走查同时是审批分档、队列/插队/停止、模式弹层单一语义 owner 三件事的运行时证据：
//   · reversible_local 且需要读计划的（apply_edit_plan）→ 计划卡只给本次确认，不承诺抬档；
//   · irreversible（delete_canvas_nodes）→ 只给「这次」，并且必须画出边界行；
//   · reversible_local 且不需读计划的（create_canvas_nodes）→ safe-auto 下**不出卡**，
//     但写入必须真的发生（先证探针会亮，再断言它不亮，避免空洞通过）。
//
// 只有远端供应商是本机 loopback；渲染层、IPC、AgentLane、pi SDK、磁盘持久化全走生产路径。
// Run: pnpm run build && node tests/ux/agent-real-user-conversation.walk.mjs
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, ASSISTANT_MESSAGE, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_PERMISSION,
  COMPOSER_SEND, CREATION_PANEL, DOCUMENT, HISTORY_BUTTON, INTERVENTION_CONFIRM,
  INTERVENTION_ESCALATE, PERMISSION_POPOVER, PREVIEW_PANEL, QUEUE, QUEUE_ROW, THREAD_MENU,
  TOOL_RECEIPT, USER_BUBBLE, chooseAssistantModel, createRuntimeWalk,
  hasToolResult, newConversation, openCanvas,
  recorded, sendCanvas, sendCreation, toolNames, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { laneDiskSnapshot, laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { residentToolNames } from './agent-runtime-walk-support.mjs'

const INTERVENTION = APPROVAL_CARD

const SCRIPT = [
  'K_SEG_A：深夜十一点，招牌灯还亮着。',
  'K_SEG_B：她把牛骨汤从锅里舀进碗，热气糊住镜头，面条一根根落下去，'
    + '最后撒一把葱花——这一段是全片最长的一段，也是我想留给观众的那口气。',
  'K_SEG_C：她端着碗坐下，吸溜第一口。',
].join('\n')

const READ_CALL = 'k-read-1'
const T1 = 'K_T1：先读一遍我的文稿，告诉我哪一段最长。'
const T1_REPLY = 'K_T1_DONE：最长的是 K_SEG_B，那段热气糊镜头的。'
const T2 = 'K_T2：这条片子给我一个 30 秒的节奏建议。'
const T2_REPLY = 'K_T2_DONE：前 5 秒放招牌灯，中间 20 秒给你说的那段，最后 5 秒收在第一口。'
const T3 = 'K_T3：你第一轮读到的那段最长的，帮我再想一句更抓人的开头。'
const T3_REPLY = 'K_T3_DONE：K_SEG_B 的开头改成「汤先到，人后到」。'

const LONG_ASK = `K_LONG：${'我想把这段热气糊镜头的部分讲清楚一点，'.repeat(20)}你觉得该怎么剪？`
const LONG_REPLY = 'K_LONG_DONE：抓住热气最浓的那两秒就够了。'
const LONG_ASK_2 = 'K_LONG2：这段到底该留几秒？把你的理由讲全。'
const LONG_REPLY_FULL = `K_LONG2_DONE：${'先把热气最浓的那两秒单独切出来，再决定前后各留多少。'.repeat(45)}`

const CREATE_CALL = 'k-create-1'
const CREATE_REPLY = 'K_CANVAS1_DONE：三个镜头节点已经摆好了。'
const DELETE_CALL = 'k-delete-1'
const DELETE_REPLY = 'K_CANVAS2_DONE：已经把那个多余的镜头删掉了。'
const REFILL_CALL = 'k-create-2'
const REFILL_REPLY = 'K_CANVAS3_DONE：补上了收尾的那个镜头。'
const FAIL_CALL = 'k-fail-1'
const FAIL_REPLY = 'K_FAIL_DONE：这一步没成功，画布上什么都没加。'

const HOLD_ASK = 'K_HOLD：把刚才三个镜头的提示词都往「暖光、慢镜」上靠。'
const QUEUE_B = 'K_QB：顺便把第一个镜头改成竖构图。'
const QUEUE_C = 'K_QC：再给我一版冷色调的备选。'
const INSERT_D = 'K_QD：等一下，先帮我确认现在画布上还剩几个节点。'
const QUEUE_B_REPLY = 'K_QB_DONE：第一个镜头已改竖构图。'
const QUEUE_C_REPLY = 'K_QC_DONE：冷色调备选已记下。'
const INSERT_D_REPLY = 'K_QD_DONE：画布上现在是 3 个节点。'

const TIMELINE_READ_CALL = 'k-timeline-read-1'
const TIMELINE_PLAN_CALL = 'k-timeline-plan-1'
const TIMELINE_ASK = 'K_TL：片头加一条字幕「汤先到，人后到」，前两秒。'
const TIMELINE_REPLY = 'K_TL_DONE：片头字幕加好了。'
const CAPTION_ID = 'k-caption-1'
const CAPTION_TEXT = '汤先到，人后到'

const AFTER_DELETE_ASK = 'K_AFTER：旧对话删掉了，我还能接着跟你说话吗？'
const AFTER_DELETE_REPLY = 'K_AFTER_DONE：能，这是一条全新的对话。'

/** 上一轮的工具调用是否原样留在本轮出站报文里（不是被转述成散文）。 */
function hasToolCall(body, id) {
  return (body.messages ?? []).some((message) => message.role === 'assistant'
    && (message.tool_calls ?? []).some((call) => call.id === id))
}

function toolResultText(body, toolCallId) {
  const message = (body.messages ?? []).find((entry) => entry.role === 'tool' && entry.tool_call_id === toolCallId)
  return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
}

/** 计划的 compare-and-swap 守卫要用真实读取结果的 revision，不能猜。 */
function revisionFromToolResult(body, toolCallId) {
  const text = toolResultText(body, toolCallId)
  const match = /"revision"\s*:\s*"([^"]+)"/.exec(text)
  if (!match) throw new Error(`read_timeline 的结果里没有 revision：${text.slice(0, 400)}`)
  return match[1]
}

const walk = await createRuntimeWalk('agent-real-user-conversation')
const seen = []
const note = (line) => { seen.push(line); console.log(`· ${line}`) }
/**
 * 体验摩擦的**量化取证**：这些是人眼在截图里看见、再回来用 DOM 量准的数字。
 * 它们不做断言——把「现在就是坏的」写成断言等于把 bug 钉成规范；数字进 report.json，
 * 结论留给人。(R16 情绪摩擦日志的取证部分)
 */
const friction = {}
const record = (key, value) => { friction[key] = value; console.log(`⚠︎ ${key}: ${JSON.stringify(value)}`) }
walk.report.friction = friction

let failure
try {
  let { win } = await walk.start({ first: true })
  const project = await walk.newProject()
  const { projectId, projectRoot } = project
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL)

  /** 读回 app 自己持久化的项目记录（走它自己的项目 IPC，不是我们另开一把读盘）。 */
  const persisted = async () => win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
  const canvasNodeIds = async () => {
    const record = await persisted()
    const canvas = record?.payload?.generationCanvas ?? record?.generationCanvas ?? { nodes: [] }
    return (canvas.nodes ?? []).map((node) => node.id)
  }
  const lanes = () => readLaneTranscripts(projectRoot)
  const nativeResult = (id) => lanes().flatMap(laneMessages).find((message) => message.role === 'toolResult' && message.toolCallId === id)

  // ── 幕一 · 创作面：三轮一条对话，第三轮指回第一轮的工具结果 ─────────────────────
  await win.locator(DOCUMENT).fill(SCRIPT)
  await expect(win.locator(DOCUMENT), '文稿必须真的落到编辑器里').toContainText('K_SEG_B')
  const creation = win.locator(CREATION_PANEL)
  await expect(creation, '创作面常驻 Agent 必须挂载').toBeVisible()
  await expect(creation, '默认审批档位是 safe-auto——后面「不出卡」的断言以它为前提')
    .toHaveAttribute('data-agent-approval-mode', 'safe-auto')
  await expect(creation.locator(COMPOSER), 'composer 也必须自报同一档，两处不能各说各的')
    .toHaveAttribute('data-permission', 'safe-auto')

  const t1Call = walk.fixture.expectText({
    label: 'turn 1 asks the document read tool',
    match: (body) => flattenRequestText(body).includes(T1) && !hasToolResult(body, READ_CALL),
    reply: { type: 'tool', id: READ_CALL, name: 'read_full_text', args: {} },
  })
  const t1Result = walk.fixture.expectText({
    label: 'turn 1 receives the real document text back',
    match: (body) => hasToolResult(body, READ_CALL),
    reply: { type: 'text', text: T1_REPLY },
  })
  await sendCreation(win, T1)
  const t1Wire = await recorded(t1Call.received, 'turn 1 first request')
  note(`创作面工具目录：${toolNames(t1Wire.body).join(', ')}`)
  expect(toolNames(t1Wire.body), '创作面必须把文稿读写能力摆上桌')
    .toEqual(residentToolNames())
  const t1ResultWire = await recorded(t1Result.received, 'turn 1 tool-result request')
  expect(flattenRequestText(t1ResultWire.body), '工具结果里带着真实文稿').toContain('K_SEG_B')
  await expect(creation, '第一轮的回答必须出现在面板里').toContainText('K_T1_DONE')

  const readToolLine = creation.locator(TOOL_RECEIPT).first()
  await expect(readToolLine, '读文稿必须留下一行收据').toBeVisible()
  const readRowEffect = (await readToolLine.innerText()).replace(/\s+/g, ' ').trim()
  record('readToolRowEffect', readRowEffect)
  expect(readRowEffect, '读文稿这一行必须说清「只是看一眼」').toContain('只是看一眼，不改动任何东西')
  expect(readRowEffect, '读工具不许再落回通用的「查看细节」').not.toContain('查看细节')
  await expect(readToolLine, '这一行还得自报它是「读取文稿」').toContainText('读取文稿')
  note(`读工具行的效果说的是「${readRowEffect}」，不是通用的「查看细节」`)
  await walk.snap('01-creation-turn1-tool-result')

  const t2 = walk.fixture.expectText({
    label: 'turn 2 is a plain conversational turn',
    match: (body) => flattenRequestText(body).includes(T2),
    reply: { type: 'text', text: T2_REPLY },
  })
  await sendCreation(win, T2)
  await recorded(t2.received, 'turn 2 request')
  await expect(creation).toContainText('K_T2_DONE')

  const t3 = walk.fixture.expectText({
    label: 'turn 3 must still carry turn 1 tool call and tool result',
    match: (body) => flattenRequestText(body).includes(T3),
    reply: { type: 'text', text: T3_REPLY },
  })
  await sendCreation(win, T3)
  const t3Wire = await recorded(t3.received, 'turn 3 request')
  expect(hasToolCall(t3Wire.body, READ_CALL), '第三轮仍带着第一轮的工具调用').toBe(true)
  expect(hasToolResult(t3Wire.body, READ_CALL), '第三轮仍带着第一轮的工具结果').toBe(true)
  const t3Text = flattenRequestText(t3Wire.body)
  expect(t3Text, '第三轮仍带着第一轮的用户原话').toContain(T1)
  expect(t3Text, '第三轮仍带着第一轮的助手回复').toContain(T1_REPLY)
  expect(t3Text, '第三轮仍带着第二轮').toContain(T2_REPLY)
  expect(t3Text, '历史不许被转述成散文前缀').not.toContain('此前同一项目线程')
  await expect(creation).toContainText('K_T3_DONE')
  await expect(creation.locator(USER_BUBBLE), '三轮用户消息都留在誊本里')
    .toHaveCount(3)
  await walk.snap('02-creation-turn3-references-turn1')
  note('三轮同一条对话，第三轮的出站报文里仍有第一轮的 tool_call + tool result')

  const replyClipping = () => creation.locator(ASSISTANT_MESSAGE).evaluateAll((nodes) => nodes
    .map((node) => {
      const wrap = node.firstElementChild
      const body = wrap?.firstElementChild
      const clip = (element) => (element
        ? { x: Math.max(0, element.scrollWidth - element.clientWidth), y: Math.max(0, element.scrollHeight - element.clientHeight) }
        : { x: 0, y: 0 })
      const [outer, middle, inner] = [clip(node), clip(wrap), clip(body)]
      return {
        chars: (node.textContent || '').length,
        head: (node.textContent || '').slice(0, 14),
        clippedPx: Math.max(outer.x, middle.x, inner.x),
        clippedHeightPx: Math.max(outer.y, middle.y, inner.y),
        hasFoldLink: Boolean(node.querySelector('[data-v4-markdown][data-folded="true"]')),
      }
    })
    .filter((item) => item.clippedPx > 0 || item.clippedHeightPx > 0))
  const replyOverflow = await replyClipping()
  record('assistantReplyOverflow', replyOverflow)
  expect(replyOverflow, '回复气泡不许再被裁掉任何一个方向').toEqual([])

  const t2Reply = creation.locator(ASSISTANT_MESSAGE).filter({ hasText: 'K_T2_DONE' }).last()
  const t2Geometry = await t2Reply.evaluate((node) => {
    const body = node.firstElementChild?.firstElementChild ?? node
    const lineHeight = Number.parseFloat(getComputedStyle(body).lineHeight) || 20
    return {
      lines: Math.round(body.getBoundingClientRect().height / lineHeight),
      clippedPx: Math.max(0, body.scrollWidth - body.clientWidth),
      clippedHeightPx: Math.max(0, body.scrollHeight - body.clientHeight),
      rendered: body.textContent || '',
    }
  })
  record('assistantReplyWrapping', { lines: t2Geometry.lines, clippedPx: t2Geometry.clippedPx, clippedHeightPx: t2Geometry.clippedHeightPx })
  expect(t2Geometry.lines, '这条回复本来就得换行才放得下——不换行的话下面那条「没被裁」是空洞的')
    .toBeGreaterThanOrEqual(2)
  expect(t2Geometry.clippedHeightPx, '换行后的回复不许被高度夹住').toBe(0)
  expect(t2Geometry.clippedPx, '换行后的回复不许横向溢出').toBe(0)
  expect(t2Geometry.rendered, '回复的最后一句必须真的看得见，而不是停在半截').toContain('最后 5 秒收在第一口。')
  note(`K_T2_DONE 渲染成 ${t2Geometry.lines} 行，横/纵裁切都是 0，句尾完整`)

  // ── 幕二 · 授权只有一个控件：权限三档 ───────────────────────────────────────
  await clickOrFail(creation.locator(COMPOSER_PERMISSION), '打开权限弹层')
  const permissionMenu = creation.locator(PERMISSION_POPOVER)
  await expect(permissionMenu, '权限弹层必须打开').toBeVisible()
  await expect(permissionMenu.locator('[data-tier]'), '授权只有三档，不多不少').toHaveCount(3)
  for (const label of ['每步问', '自动改', '全自动']) {
    await expect(permissionMenu, `权限档缺了「${label}」`).toContainText(label)
  }
  await expect(permissionMenu.locator('[data-tier][data-active="true"]'), '当前档恰有一个').toHaveCount(1)
  await expect(permissionMenu.locator('[data-tier="safe-auto"][data-active="true"]'), '出厂档就是「自动改」')
    .toBeVisible()
  await walk.snap('03-permission-popover-three-tiers')
  await win.keyboard.press('Escape')
  await expect(permissionMenu, '按 Esc 必须关掉弹层').toBeHidden()

  // ── 幕三 · 长消息与长回复：v4 只折**助手文本**，用户气泡照原样换行 ─────────────
  const long = walk.fixture.expectText({
    label: 'a very long user question still runs normally',
    match: (body) => flattenRequestText(body).includes('K_LONG：'),
    reply: { type: 'text', text: LONG_REPLY },
  })
  await sendCreation(win, LONG_ASK)
  await recorded(long.received, 'long question request')
  await expect(creation).toContainText('K_LONG_DONE')
  const longBubble = creation.locator(USER_BUBBLE).filter({ hasText: 'K_LONG：' }).last()
  await expect(longBubble, '超长用户消息必须留在誊本里').toBeVisible()
  expect(LONG_ASK.length, '这条消息必须真的很长，否则下面的断言是空的').toBeGreaterThan(360)
  const longBubbleGeometry = await longBubble.evaluate((node) => {
    const panel = node.closest('[data-agent-panel="true"]')
    return {
      clippedX: Math.max(0, node.scrollWidth - node.clientWidth),
      clippedY: Math.max(0, node.scrollHeight - node.clientHeight),
      pastPanelEdge: Math.round(node.getBoundingClientRect().right - panel.getBoundingClientRect().right),
    }
  })
  record('longUserBubbleGeometry', longBubbleGeometry)
  expect(longBubbleGeometry.clippedX, '超长用户消息不许横向溢出').toBe(0)
  expect(longBubbleGeometry.clippedY, '超长用户消息不许被高度夹断').toBe(0)
  expect(longBubbleGeometry.pastPanelEdge, '超长用户消息不许伸出面板右缘').toBeLessThanOrEqual(0)
  await expect(longBubble, '超长消息的结尾必须真的看得见').toContainText('你觉得该怎么剪？')
  await walk.snap('04-long-message-wrapped')

  const long2 = walk.fixture.expectText({
    label: 'a very long assistant reply still renders',
    match: (body) => flattenRequestText(body).includes('K_LONG2：'),
    reply: { type: 'text', text: LONG_REPLY_FULL },
  })
  await sendCreation(win, LONG_ASK_2)
  await recorded(long2.received, 'long reply request')
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL,
    settledBy: creation.getByText('K_LONG2_DONE', { exact: false }).last() })
  const longReplyBubble = creation.locator(ASSISTANT_MESSAGE).filter({ hasText: 'K_LONG2_DONE' }).last()
  const shortReplyBubble = creation.locator(ASSISTANT_MESSAGE).filter({ hasText: 'K_T2_DONE' }).last()
  const naturalHeight = await longReplyBubble.locator('[data-v4-markdown]').evaluate((node) => ({
    text: node.firstElementChild.scrollHeight,
    panel: node.closest('[data-agent-panel="true"]').getBoundingClientRect().height,
  }))
  expect(naturalHeight.text, 'Long-reply fixture must exceed the actual panel height; character counts do not prove overflow')
    .toBeGreaterThan(naturalHeight.panel)
  const foldStateOf = async (bubble) => bubble.locator('[data-v4-markdown]').first()
    .evaluate((node) => ({ folded: node.dataset.folded ?? null, expandLabel: (node.querySelector('button')?.textContent || '').trim() }))
  const longFold = await foldStateOf(longReplyBubble)
  const shortFold = await foldStateOf(shortReplyBubble)
  record('assistantReplyFolding', { longChars: LONG_REPLY_FULL.length, longFold, shortChars: T2_REPLY.length, shortFold })
  expect(longFold.folded, '超长回复必须折起来，而不是把誊本撑爆').toBe('true')
  expect(longFold.expandLabel, '折起来的回复必须给得出「还有 N 行 · 展开」').toMatch(/还有 \d+ 行/)
  expect(shortFold.folded, '短回复不许折——那是给一句话配一个展开钮').toBe(null)
  note('长回复折到面板高 60% 并给出展开入口、短回复不折，两半都在同一个现场证过')


  // ── 幕四 · 生成面：safe-auto 直接写 / 不可逆要卡 / 再写仍不出卡 ─────────────────
  await openCanvas(win)
  const canvas = win.locator(CANVAS_PANEL)
  await expect(canvas, '生成面常驻 Agent 必须挂载').toBeVisible()

  const createCall = walk.fixture.expectText({
    label: 'canvas turn 1 proposes three shot nodes',
    match: (body) => flattenRequestText(body).includes('K_CANVAS1') && !hasToolResult(body, CREATE_CALL),
    reply: {
      type: 'tool', id: CREATE_CALL, name: 'draft_shots',
      // 20 动词：只有 draft_shots 能在画布上造出会生成的镜头（草稿落画布、不出卡、不花钱）。
      args: {
        shots: [
          { title: '招牌灯', prompt: '深夜街边招牌灯，暖光，中景', taskKind: 'text_to_image' },
          { title: '舀汤', prompt: '热气糊镜头，牛骨汤舀进碗，特写', taskKind: 'text_to_image' },
          { title: '多余的一个', prompt: '备用镜头，暂时用不上', taskKind: 'text_to_image' },
        ],
      },
    },
  })
  const createResult = walk.fixture.expectText({
    label: 'canvas turn 1 receives the real create receipt',
    match: (body) => hasToolResult(body, CREATE_CALL),
    reply: { type: 'text', text: CREATE_REPLY },
  })
  await sendCanvas(win, 'K_CANVAS1：按我的脚本，在画布上摆三个镜头。')
  const createWire = await recorded(createCall.received, 'canvas create request')
  note(`生成面工具目录：${toolNames(createWire.body).join(', ')}`)
  expect(toolNames(createWire.body), '生成面必须摆出画布读写能力')
    .toEqual(expect.arrayContaining(['look_at_canvas']))
  const createResultWire = await recorded(createResult.received, 'canvas create tool-result request')
  expect(hasToolResult(createResultWire.body, CREATE_CALL)).toBe(true)
  expect(nativeResult(CREATE_CALL), '建草稿必须有真实成功的落盘结果').toMatchObject({ isError: false, details: { operation: { state: 'draft' } } })
  await expect(canvas).toContainText('K_CANVAS1_DONE')
  await expect.poll(canvasNodeIds, { message: '三个镜头节点必须真的落到画布上', timeout: 30_000 })
    .toHaveLength(3)
  const nodesAfterCreate = await canvasNodeIds()
  await walk.snap('06-canvas-three-nodes-no-card')

  const deleteCall = walk.fixture.expectText({
    label: 'canvas turn 2 proposes an irreversible delete',
    match: (body) => flattenRequestText(body).includes('K_CANVAS2') && !hasToolResult(body, DELETE_CALL),
    reply: {
      type: 'tool', id: DELETE_CALL, name: 'delete_canvas_nodes',
      args: { nodeIds: [nodesAfterCreate[2]], reason: '这个镜头用不上' },
    },
  })
  const deleteResult = walk.fixture.expectText({
    label: 'canvas turn 2 receives the delete receipt after approval',
    match: (body) => hasToolResult(body, DELETE_CALL),
    reply: { type: 'text', text: DELETE_REPLY },
  })
  await sendCanvas(win, 'K_CANVAS2：把第三个多余的镜头删除。')
  const deleteRequestWire = await recorded(deleteCall.received, 'canvas delete request')
  expect(toolNames(deleteRequestWire.body), '维护工具常驻，真实执行仍须审批').toContain('delete_canvas_nodes')
  const approval = win.locator(INTERVENTION)
  const approvalProof = await proveProbe(approval, '不可逆动作会浮出介入槽审批卡')
  expect(await canvasNodeIds(), '工具已调用但未经审批，节点必须保持原样').toEqual(nodesAfterCreate)
  await expect(approval, '删节点是不可逆动作').toHaveAttribute('data-kind', 'approval-irreversible')
  await expect(approval.locator(INTERVENTION_CONFIRM), '不可逆动作必须给「确认」（= 仅这一次）').toBeVisible()
  await expect(approval, '不可逆动作必须把授权范围写在卡面上').toContainText('范围：仅这一次')
  const onceOnlyProof = await proveProbe(approval.locator(INTERVENTION_CONFIRM), '审批卡上的「确认」按钮')
  await expectAbsent(approval.locator(INTERVENTION_ESCALATE),
    { provenBy: onceOnlyProof, message: '不可逆动作不该给「不再问 →」' })
  const deleteCardText = await approval.evaluate((node) => node.textContent || '')
  const deleteHeading = await approval.evaluate((node) => ({
    title: (node.querySelector('header')?.textContent || '').trim(),
    summary: (node.querySelector('p')?.textContent || '').trim(),
  }))
  record('deleteCardHeading', deleteHeading)
  record('deleteCardSummary', deleteCardText.slice(0, 200))
  expect(deleteHeading.title, '不可逆卡的抬头必须点名这次的动作').toContain('删除镜头卡')
  expect(deleteHeading.title, '抬头不许再是那句放之四海皆准的「执行确认」').not.toBe('执行确认')
  expect(deleteCardText, '整张卡上任何一处都不该再出现通用的「执行确认」').not.toContain('执行确认')
  expect(deleteCardText, 'v4 已删除详情折叠，动作不能退化成通用摘要').not.toContain('查看细节')
  const summaryLine = approval.locator('p').first()
  await expect(summaryLine, '摘要那一行本身必须可见').toBeVisible()
  await expect(summaryLine, '摘要必须报出这次要删几个对象').toContainText('1 个对象')
  await expect(summaryLine, '模型给的理由必须在静息态就读得到，而不是折叠一层之下')
    .toContainText('这个镜头用不上')
  const restingSummary = (await summaryLine.innerText()).trim()
  record('deleteCardAtRest', { title: deleteHeading.title, summary: restingSummary })
  expect(deleteCardText, '整张卡上必须读得到模型自己给的理由').toContain('这个镜头用不上')
  record('deleteCardIdentifiesTarget', {
    nodeId: nodesAfterCreate[2],
    mentionsNodeId: deleteCardText.includes(nodesAfterCreate[2]),
    mentionsShotTitle: deleteCardText.includes('多余的一个'),
  })
  await walk.snap('07-irreversible-once-only')

  expect(deleteCardText, '整张卡上任何一处都不该出现「生成设置」——这张卡不生成任何东西')
    .not.toContain('生成设置')
  record('deleteCardParams', await approval.locator('span').allInnerTexts().then((rows) => rows.join(' | ').slice(0, 200)))
  await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '批准这一次删除', { noWaitAfter: true })
  const deleteWire = await recorded(deleteResult.received, 'canvas delete tool-result request')
  expect(hasToolResult(deleteWire.body, DELETE_CALL)).toBe(true)
  expect(nativeResult(DELETE_CALL), '批准后必须有真实成功的删除结果').toMatchObject({ isError: false, details: { applied: true, deletedNodeIds: [nodesAfterCreate[2]] } })
  await expect(canvas).toContainText('K_CANVAS2_DONE')
  await expect.poll(canvasNodeIds, { message: '批准后的删除必须真的落盘', timeout: 30_000 }).toHaveLength(2)
  await expect(canvas.locator(TOOL_RECEIPT).last(), '工具行必须叫它「删除镜头卡」，而不是一句通用的「查看细节」')
    .toContainText('删除镜头卡')
  await walk.snap('08-irreversible-applied')
  note('irreversible 只给「确认（仅这一次）」；卡片报出「1 个对象」，工具行叫它「删除镜头卡」')

  const refillCall = walk.fixture.expectText({
    label: 'canvas turn 3 writes again under safe-auto',
    match: (body) => flattenRequestText(body).includes('K_CANVAS3') && !hasToolResult(body, REFILL_CALL),
    reply: {
      type: 'tool', id: REFILL_CALL, name: 'draft_shots',
      args: { shots: [{ title: '第一口', prompt: '她吸溜第一口，暖光特写', taskKind: 'text_to_image' }] },
    },
  })
  const refillResult = walk.fixture.expectText({
    label: 'canvas turn 3 receives the second create receipt',
    match: (body) => hasToolResult(body, REFILL_CALL),
    reply: { type: 'text', text: REFILL_REPLY },
  })
  await sendCanvas(win, 'K_CANVAS3：再补一个「第一口」的收尾镜头。')
  await recorded(refillCall.received, 'canvas refill request')
  await expectAbsent(approval, {
    provenBy: approvalProof,
    message: 'safe-auto 下的可逆本地写不该再拦一次用户',
  })
  await recorded(refillResult.received, 'canvas refill tool-result request')
  await expect(canvas).toContainText('K_CANVAS3_DONE')
  await expect.poll(canvasNodeIds, { message: '不出卡不等于没写：这一笔必须真的落盘', timeout: 30_000 })
    .toHaveLength(3)
  await walk.snap('09-safe-auto-write-without-card')
  note('safe-auto 的 draft_shots 全程无卡，但草稿节点确实写进去了')

  // ── 幕四·尾 · 一步没成功，必须不展开就看得见 ─────────────────────────────────────
  const failCall = walk.fixture.expectText({
    label: 'canvas turn 4 calls a tool that is not on the table',
    match: (body) => flattenRequestText(body).includes('K_FAIL') && !hasToolResult(body, FAIL_CALL),
    reply: {
      type: 'tool', id: FAIL_CALL, name: 'fixture_unknown_canvas_write',
      args: {
        operation: 'create_canvas_nodes',
        summary: '再补一个镜头',
        nodes: [{ clientId: 'k-shot-5', kind: 'image', title: '不会成功的一个', prompt: '这一步注定失败' }],
      },
    },
  })
  const failFollow = walk.fixture.expectText({
    label: 'canvas turn 4 keeps going after the step failed',
    match: (body) => flattenRequestText(body).includes('K_FAIL'),
    reply: { type: 'text', text: FAIL_REPLY },
  })
  await sendCanvas(win, 'K_FAIL：再补一个候补镜头。')
  await recorded(failCall.received, 'failing tool request')
  const toolLine = canvas.locator(`${TOOL_RECEIPT}[data-status="output-error"]`)
  await expect(toolLine, '有一步失败了，那一行收据必须自己变成失败态')
    .toBeVisible({ timeout: 30_000 })
  record('failedToolItems', lanes().flatMap(laneMessages)
    .filter((message) => message.role === 'toolResult' && message.isError)
    .map((message) => ({ toolName: message.toolName, toolCallId: message.toolCallId, isError: message.isError })))
  await expect(toolLine, '失败的那一行必须自己说「失败」，而不是安静地留在流里').toContainText('失败')
  await recorded(failFollow.received, 'post-failure request')
  await expect(canvas).toContainText('K_FAIL_DONE')
  await expect.poll(canvasNodeIds, { message: '失败的那一步不许在画布上留下半个节点', timeout: 30_000 })
    .toHaveLength(3)
  await walk.snap('09b-failed-step-visible-while-collapsed')
  note('目录外的工具调用真的失败了：工具行 data-state=failed + 收起状态下的红色「1 步没成功」徽标')

  // ── 幕五 · 取消后重发、真实插话消费顺序、停止 ─────────────────────────────
  const held = walk.fixture.expectText({
    label: 'a streaming turn leaves time to queue and revise instructions',
    match: (body) => flattenRequestText(body).includes('K_HOLD'),
    reply: { type: 'hold', text: '正在检查当前镜头。' },
  })
  await sendCanvas(win, HOLD_ASK)
  await recorded(held.received, 'held turn request')
  await expect(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}[aria-label="停止"]`)).toBeVisible()
  const canvasInput = canvas.locator(COMPOSER_INPUT)
  const enqueue = async (text) => { await canvasInput.fill(text); await canvasInput.press('Enter') }
  await enqueue(QUEUE_B)
  await enqueue(QUEUE_C)
  const queue = canvas.locator(QUEUE)
  await expect(canvas.locator(QUEUE_ROW), '只有尚未消费的两句列入队列').toHaveCount(2)
  await expect(canvas, '取消后重发的语义必须明说').toContainText('排队的指令可以取消后重发')
  for (const marker of ['K_QB：', 'K_QC：']) {
    await clickOrFail(canvas.locator(QUEUE_ROW).filter({ hasText: marker }).getByRole('button', { name: '删', exact: true }), `取消 ${marker}`)
  }
  await expect(canvas.locator(QUEUE_ROW)).toHaveCount(0)
  await enqueue(INSERT_D)
  await enqueue(QUEUE_B)
  await enqueue(QUEUE_C)
  await expect(canvas.locator(QUEUE_ROW)).toHaveCount(3)
  expect((await canvas.locator(QUEUE_ROW).allInnerTexts()).map((text) => /K_Q[A-Z]/.exec(text)?.[0]))
    .toEqual(['K_QD', 'K_QB', 'K_QC'])
  const queueOverflow = await queue.evaluate((node) => {
    const panelRight = node.closest('[data-agent-panel="true"]').getBoundingClientRect().right
    const controls = [...node.querySelectorAll(':scope > div[data-status] button')]
    return { panelRight: Math.round(panelRight), queueRight: Math.round(node.getBoundingClientRect().right),
      rowButtons: controls.length,
      buttonsPastPanelEdge: controls.filter((button) => button.getBoundingClientRect().right > panelRight + 0.5).length }
  })
  record('queueRowOverflow', queueOverflow)
  expect(queueOverflow.rowButtons, '三条待发指令各有取消入口').toBe(3)
  expect(queueOverflow.buttonsPastPanelEdge, '任何队列按钮都不许越出面板').toBe(0)
  expect(queueOverflow.queueRight).toBeLessThanOrEqual(queueOverflow.panelRight)
  await walk.snap('10-queue-cancel-and-resend')
  const queuedD = walk.fixture.expectText({ label: 'urgent instruction is consumed first',
    match: (body) => flattenRequestText(body).includes(INSERT_D) && !flattenRequestText(body).includes(QUEUE_B),
    reply: { type: 'tool', id: 'k-queue-d-read', name: 'look_at_canvas', args: {} } })
  const queuedB = walk.fixture.expectText({ label: 'first resent instruction is consumed at the next tool boundary',
    match: (body) => hasToolResult(body, 'k-queue-d-read') && flattenRequestText(body).includes(QUEUE_B) && !flattenRequestText(body).includes(QUEUE_C),
    reply: { type: 'tool', id: 'k-queue-b-read', name: 'look_at_canvas', args: {} } })
  const queuedC = walk.fixture.expectText({ label: 'second resent instruction is consumed last',
    match: (body) => hasToolResult(body, 'k-queue-b-read') && flattenRequestText(body).includes(QUEUE_C),
    reply: { type: 'text', text: [INSERT_D_REPLY, QUEUE_B_REPLY, QUEUE_C_REPLY].join('\n') } })
  held.release({ type: 'text', text: '当前检查结束。' })
  await recorded(queuedD.received, 'urgent instruction request')
  await recorded(queuedB.received, 'first resent request')
  const queueWire = await recorded(queuedC.received, 'second resent request')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: canvas.getByText('K_QC_DONE', { exact: false }).last() })
  const queueNodeIds = await canvasNodeIds()
  for (const id of ['k-queue-d-read', 'k-queue-b-read']) {
    expect(nativeResult(id), 'The scheduling boundary must also complete the real canvas read')
      .toMatchObject({ isError: false, details: { nodeCount: queueNodeIds.length } })
    // The established canvasReadCompact presentation is prose, not a JSON envelope.
    for (const nodeId of queueNodeIds) expect(toolResultText(queueWire.body, id)).toContain(`- ${nodeId} | `)
  }
  const stopRequest = walk.fixture.expectText({ label: 'user stops a new actual stream',
    match: (body) => flattenRequestText(body).includes('K_STOP_ONLY'), reply: { type: 'hold', text: '这一步正在继续检查。' } })
  await sendCanvas(win, 'K_STOP_ONLY：再核对一次这些镜头。')
  await recorded(stopRequest.received, 'stream before cancellation')
  await clickOrFail(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}[aria-label="停止"]`), '停止当前流')
  stopRequest.release({ type: 'text', text: '这一句在取消之后到达，不应变成成功。' })
  await expect(canvas.locator(`${ASSISTANT_MESSAGE}[data-status="interrupted"]`).last()).toBeVisible()
  await expect(canvas.locator(COMPOSER)).toHaveAttribute('data-mode', 'idle')
  for (const marker of ['K_T1_DONE', 'K_T3_DONE', 'K_CANVAS2_DONE', 'K_CANVAS3_DONE']) {
    await expect(canvas, `停止后 ${marker} 必须仍在对话里`).toContainText(marker)
  }
  expect(await canvasNodeIds(), '停止不能回滚已落盘的镜头').toHaveLength(3)
  await walk.snap('11-after-stop-transcript-intact')
  note('取消重发改变真实消费顺序；停止当前流保留已完成的回答和镜头')

  // ── 幕六 · 剪辑面：需要读计划的可逆改动给足三档 ───────────────────────────────
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]'), '进入剪辑面')
  const preview = win.locator(PREVIEW_PANEL)
  await expect(preview, '剪辑面常驻 Agent 必须挂载').toBeVisible({ timeout: 30_000 })

  const readCall = walk.fixture.expectText({
    label: 'the timeline turn reads the live timeline first',
    match: (body) => flattenRequestText(body).includes('K_TL：') && !hasToolResult(body, TIMELINE_READ_CALL),
    reply: { type: 'tool', id: TIMELINE_READ_CALL, name: 'read_timeline', args: {} },
  })
  const planCall = walk.fixture.expectText({
    label: 'the timeline turn proposes a revision-guarded plan',
    match: (body) => hasToolResult(body, TIMELINE_READ_CALL) && !hasToolResult(body, TIMELINE_PLAN_CALL),
    reply: { type: 'hold' },
  })
  const planResult = walk.fixture.expectText({
    label: 'the applied timeline plan returns to the model',
    match: (body) => hasToolResult(body, TIMELINE_PLAN_CALL),
    reply: { type: 'text', text: TIMELINE_REPLY },
  })
  const previewInput = preview.locator(COMPOSER_INPUT)
  await expect(previewInput).toBeVisible()
  await previewInput.fill(TIMELINE_ASK)
  await clickOrFail(preview.locator(COMPOSER_SEND), '发送剪辑面指令')
  const readWire = await recorded(readCall.received, 'timeline read request')
  note(`剪辑面工具目录：${toolNames(readWire.body).join(', ')}`)
  expect(toolNames(readWire.body), '剪辑面必须摆出时间轴读写链')
    .toContain('read_timeline')
  expect(toolNames(readWire.body), '时间轴写工具常驻，真实执行仍须计划审批').toContain('apply_edit_plan')
  const planWire = await recorded(planCall.received, 'timeline plan request')
  expect(toolNames(planWire.body)).toEqual(expect.arrayContaining(['apply_edit_plan', 'undo_timeline_edit']))
  planCall.release({
    type: 'tool', id: TIMELINE_PLAN_CALL, name: 'apply_edit_plan',
    args: {
      planId: 'k-plan-caption',
      baseRevision: revisionFromToolResult(planWire.body, TIMELINE_READ_CALL),
      summary: '片头加一条字幕',
      operations: [{
        kind: 'text', action: 'add', id: CAPTION_ID, text: CAPTION_TEXT,
        style: 'caption', startFrame: 0, endFrame: 60,
      }],
    },
  })

  const planApproval = win.locator(INTERVENTION)
  await expect(planApproval, '需要读计划的改动必须先浮出审批卡').toBeVisible({ timeout: 30_000 })
  await expect(planApproval, '这是可逆的本地改动').not.toHaveAttribute('data-kind', 'approval-irreversible')
  await expect(planApproval.locator(INTERVENTION_CONFIRM), '必须给「确认」（= 仅这一次）').toBeVisible()
  await expect(planApproval.locator(INTERVENTION_ESCALATE), '计划卡按定稿不提供抬档').toHaveCount(0)
  await expect(planApproval, '不描述不存在的动作').not.toContainText('不再问')
  const planDetail = planApproval.locator('[data-v4-block="plan-detail"]')
  await expect(planDetail.locator('summary'), '默认显示动作与目标').toContainText(CAPTION_TEXT)
  await expect(planDetail.locator('summary')).toContainText('字幕')
  await expect(planDetail.locator('pre'), 'JSON 默认折叠').not.toBeVisible()
  await walk.snap('12-readable-plan-confirm')
  await clickOrFail(planDetail.locator('summary'), '展开计划技术详情')
  await expect(planDetail.locator('pre'), '展开后可查原始操作').toContainText('"kind":"text"')
  await clickOrFail(planDetail.locator('summary'), '收起计划技术详情')
  await clickOrFail(planApproval.locator(INTERVENTION_CONFIRM), '应用这次', { noWaitAfter: true })
  const planResultWire = await recorded(planResult.received, 'timeline plan tool-result request')
  expect(toolResultText(planResultWire.body, TIMELINE_PLAN_CALL), '批准后的计划必须真的应用')
    .toContain('"applied":true')
  await expect(preview).toContainText('K_TL_DONE')
  await expect.poll(async () => {
    const record = await persisted()
    const timeline = record?.payload?.timeline ?? record?.timeline ?? {}
    return (timeline.textClips ?? []).map((clip) => clip.text)
  }, { message: '批准后的字幕必须真的落盘', timeout: 30_000 }).toContain(CAPTION_TEXT)
  await walk.snap('13-timeline-caption-applied')
  note('reversible_local + 计划审阅：批准后字幕真的落盘')

  // ── 收尾 · 已知无调用点的例外卡在真实运行时确实一次都没出现 ─────────────────────
  const transcript = win.locator('[data-agent-resident="true"]')
  const transcriptProof = await proveProbe(transcript.locator('[data-v4-block]'), '誊本里有真实条目')
  for (const [selector, label] of [
    [`${APPROVAL_CARD}[data-kind="spend"]`, '付费介入槽'],
    ['[data-v4-block="task"] [data-adopted]', '任务卡候选采用态'],
    [`${APPROVAL_CARD}[data-kind="question"]`, '反问介入槽'],
  ]) {
    await expectAbsent(win.locator(selector), {
      provenBy: transcriptProof,
      message: `${label} 在整条真实旅程里一次都没被渲染过`,
    })
  }
  note('付费槽 / 候选采用 / 反问槽在真实旅程里确实零出现')

  // ── 幕七 · 冷重启：把进程真的杀掉再起，做过的事必须还在 ─────────────────────────
  const nodesBeforeRestart = await canvasNodeIds()
  await waitForV4TurnIdle(win, { panel: PREVIEW_PANEL, settledBy: win.locator(PREVIEW_PANEL).locator(ASSISTANT_MESSAGE).filter({ hasText: TIMELINE_REPLY }).last() })
  const threadsBeforeRestart = lanes().map((session) => session.sessionId)
  expect(threadsBeforeRestart, '重启前这个项目只有一条对话').toHaveLength(1)
  const requestsBeforeRestart = walk.fixture.requests.length

  await walk.stopApp()
  const beforeColdBytes = laneDiskSnapshot(projectRoot)
  ;({ win } = await walk.start())
  expect(walk.report.launches[1].pid, '这必须是第二个真进程，不是同一个页面刷新')
    .not.toBe(walk.report.launches[0].pid)

  const libraryCard = () => win.locator('[data-project-card="true"]').filter({ hasText: project.name }).first()
  const reopenProject = async (label) => {
    const card = libraryCard()
    await expect(card, '冷启动后必须落在项目库，并且看得见这个项目').toBeVisible({ timeout: 30_000 })
    await card.hover()
    await clickOrFail(card.getByRole('button', { name: /继续创作/ }), label)
    await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`),
      projectId, { timeout: 30_000 })
  }
  await reopenProject('冷重启后回到同一项目')
  expect(walk.fixture.requests, '冷启动本身一个模型请求都不该发').toHaveLength(requestsBeforeRestart)

  expect(laneDiskSnapshot(projectRoot), '冷重启不能重写或丢失 native JSONL').toEqual(beforeColdBytes)

  await expect(win.locator('.generation-canvas-v2__stage'), '继续创作直接落在生成区')
    .toBeVisible({ timeout: 30_000 })
  await expect(win.locator('.react-flow__node'), '重启后画布上的镜头节点数必须和重启前一样')
    .toHaveCount(nodesBeforeRestart.length)
  expect(await canvasNodeIds(), '落盘的节点 id 也要逐个对上').toEqual(nodesBeforeRestart)

  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '重启后进入创作工作区')
  const creationAfter = win.locator(CREATION_PANEL)
  await expect(creationAfter, '重启后创作面常驻 Agent 必须挂载').toBeVisible({ timeout: 30_000 })
  for (const marker of [T1, T1_REPLY, T2_REPLY, T3_REPLY, LONG_ASK_2,
    'K_LONG2_DONE', 'K_CANVAS1_DONE', 'K_CANVAS2_DONE', 'K_QC_DONE', 'K_TL_DONE']) {
    await expect(creationAfter, `重启后「${marker.slice(0, 12)}」必须还在誊本里`).toContainText(marker)
  }

  await clickOrFail(creationAfter.locator(HISTORY_BUTTON), '重启后打开会话列表')
  const threadRows = win.locator(`${THREAD_MENU} > div`)
  await expect(threadRows, '表头 + 唯一那条幸存对话').toHaveCount(2)
  await clickOrFail(threadRows.nth(1).getByRole('button').first(), '重启后选回原来那条对话')
  await expect(creationAfter, '选回来之后誊本仍是那一条').toContainText('K_T3_DONE')

  const persistedCaptions = async () => {
    const projectRecord = await persisted()
    const timeline = projectRecord?.payload?.timeline ?? projectRecord?.timeline ?? {}
    return (timeline.textClips ?? []).map((clip) => clip.text)
  }
  expect(await persistedCaptions(), '重启后落盘的片头字幕必须还在').toContain(CAPTION_TEXT)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]'), '重启后进入剪辑面')
  await expect(win.locator(`.workbench-timeline-text-clip[data-text-clip-id="${CAPTION_ID}"]`),
    '重启后片头字幕必须仍画在时间轴上').toContainText(CAPTION_TEXT)
  await walk.snap('14-cold-restart-state-survives')
  note(`冷重启：誊本、${nodesBeforeRestart.length} 个画布节点、片头字幕（UI + 落盘）全都还在`)

  // ── 幕八 · 删对话：删别人、也删自己，然后再冷启一次 ───────────────────────────
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '回到创作面')
  await expect(creationAfter).toBeVisible({ timeout: 30_000 })
  const oldThreadId = threadsBeforeRestart[0]
  const oldSession = lanes().find((session) => session.sessionId === oldThreadId)
  expect(laneMessages(oldSession).length, '必须真的删除带有多轮和工具结果的历史').toBeGreaterThan(20)
  expect(laneMessages(oldSession).some((message) => message.role === 'toolResult' && message.toolCallId === READ_CALL)).toBe(true)
  await newConversation(win, CREATION_PANEL)
  await expect.poll(() => lanes().length, { message: '新建后两份独立 native session', timeout: stationTimeout({ operations: 2 }) }).toBe(2)
  const newSession = lanes().find((session) => session.sessionId !== oldThreadId)
  await expect(creationAfter, '新对话必须为空').not.toContainText('K_T3_DONE')
  await clickOrFail(creationAfter.locator(HISTORY_BUTTON), '打开列表删除旧对话')
  await expect(threadRows).toHaveCount(3)
  const oldRow = threadRows.filter({ has: win.getByRole('button', { name: '未命名对话', exact: true }) })
  await clickOrFail(oldRow.getByRole('button', { name: '删除对话' }), '删除非当前的旧对话')
  await expect.poll(() => lanes().map((session) => session.sessionId), { timeout: stationTimeout({ operations: 2 }) }).toEqual([newSession.sessionId])
  await expect(threadRows).toHaveCount(2)
  await clickOrFail(threadRows.nth(1).getByRole('button', { name: '删除对话' }), '删除当前对话')
  await expect.poll(() => ({ ids: lanes().map((session) => session.sessionId).filter((id) => id === newSession.sessionId), count: lanes().length }),
    { message: '删除当前对话必须切到新的独立空 session', timeout: stationTimeout({ operations: 2 }) }).toEqual({ ids: [], count: 1 })
  const survivingThreadId = lanes()[0].sessionId
  expect(survivingThreadId).not.toBe(oldThreadId)
  expect(laneMessages(lanes()[0])).toEqual([])
  await walk.snap('15-threads-deleted')
  note('删非当前与当前对话均生效：两份原 JSONL 已消失，仅剩独立空 session')

  // ── 幕九 · 删过带 turn 的对话之后，再冷启一次：历史必须还打得开 ────────────────
  const requestsBeforeSecondRestart = walk.fixture.requests.length
  await walk.stopApp()
  ;({ win } = await walk.start())
  expect(walk.report.launches[2].pid, '这必须是第三个真进程')
    .not.toBe(walk.report.launches[1].pid)
  await reopenProject('删完对话之后再冷启一次')
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '再次进入创作工作区')
  const creationFinal = win.locator(CREATION_PANEL)
  await expect(creationFinal, '删过带 turn 的对话之后，Agent 面板必须照样起得来')
    .toBeVisible({ timeout: 30_000 })
  expect(walk.fixture.requests, '第二次冷启动本身也不该发模型请求')
    .toHaveLength(requestsBeforeSecondRestart)

  expect(lanes().map((session) => session.sessionId), '冷重启不能复活已删除的 session 或 main lane')
    .toEqual([survivingThreadId])
  expect(laneMessages(lanes()[0]), '幸存空对话不能继承删除历史').toEqual([])
  record('agentErrorBannersAfterRestart',
    await win.locator('[data-agent-error="true"]').count())
  await clickOrFail(creationFinal.locator(HISTORY_BUTTON), '删完对话冷启后打开会话列表')
  await expect(win.locator(`${THREAD_MENU} > div`), '表头 + 唯一那条幸存对话')
    .toHaveCount(2)
  await clickOrFail(creationFinal.locator(HISTORY_BUTTON), '收起会话列表')

  const afterDelete = walk.fixture.expectText({
    label: 'a fresh turn still runs after the deleted-thread cold restart',
    match: (body) => flattenRequestText(body).includes('K_AFTER：'),
    reply: { type: 'text', text: AFTER_DELETE_REPLY },
  })
  await sendCreation(win, AFTER_DELETE_ASK)
  const freshWire = await recorded(afterDelete.received, 'post-deletion request')
  expect(flattenRequestText(freshWire.body), '新模型请求不能带已删历史').not.toContain(T1)
  expect(hasToolCall(freshWire.body, READ_CALL)).toBe(false)
  expect(hasToolResult(freshWire.body, READ_CALL)).toBe(false)
  await expect(creationFinal, '删完对话冷启之后，新的一轮照样跑得通').toContainText('K_AFTER_DONE')
  await walk.snap('16-history-opens-after-thread-deletion')
  note('删除含工具回执的旧历史后冷启：唯一幸存 JSONL 可读，新轮不带删除内容')

  walk.fixture.assertClean()
  walk.report.verified = seen
  walk.report.friction = friction
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
