#!/usr/bin/env node
// R13/R16 · 常驻 Agent 对话面的「真实用户任务」体验走查（零额度 loopback 供应商）。
//
// 人物设定：林秋，一个人做美食短片。她今天要做一条「一碗深夜牛肉面」的片子——
// 先在创作面把脚本写出来、让 Nomi 读一遍并记住它读到了什么；再去生成面让 Nomi 摆镜头节点、
// 删掉一个不要的、补一个新的；中途改主意，插一句更急的指令并叫停正在跑的那一轮；
// 最后去剪辑面让 Nomi 加一条片头字幕。
//
// 这条走查同时是审批分档、队列/插队/停止、模式弹层单一语义 owner 三件事的运行时证据：
//   · reversible_local 且需要读计划的（apply_edit_plan）→ 卡片给「这次 / 本会话 / 总是」三档；
//   · irreversible（delete_canvas_nodes）→ 只给「这次」，并且必须画出边界行；
//   · reversible_local 且不需读计划的（create_canvas_nodes）→ safe-auto 下**不出卡**，
//     但写入必须真的发生（先证探针会亮，再断言它不亮，避免空洞通过）。
//
// 只有远端供应商是本机 loopback；渲染层、IPC、ProjectAgentHost、pi SDK、磁盘持久化全走生产路径。
// Run: pnpm run build && node tests/ux/agent-real-user-conversation.walk.mjs
import path from 'node:path'
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { FIXTURE_TEXT_MODEL_LABEL } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, ASSISTANT_MESSAGE, CANVAS_PANEL, COMPOSER, COMPOSER_INPUT, COMPOSER_PERMISSION,
  COMPOSER_SEND, CREATION_PANEL, DOCUMENT, HISTORY_BUTTON, INTERVENTION_CONFIRM,
  INTERVENTION_ESCALATE, PERMISSION_POPOVER, PREVIEW_PANEL, QUEUE, QUEUE_ROW, THREAD_MENU,
  TOOL_RECEIPT, USER_BUBBLE, chooseAssistantModel, createRuntimeWalk,
  hasToolResult, newConversation, openCanvas,
  readCurrentProjectAgentHostSnapshot, recorded, sendCanvas, sendCreation, toolNames,
} from './agent-runtime-walk-support.mjs'

const INTERVENTION = APPROVAL_CARD

// 林秋真的会写在文稿里的东西。三段有明确长短差，第三轮才指得回第一轮读到的那一段。
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

// 一条真的很长的用户消息（> 360 字符），用来验用户气泡的折叠。
const LONG_ASK = `K_LONG：${'我想把这段热气糊镜头的部分讲清楚一点，'.repeat(20)}你觉得该怎么剪？`
const LONG_REPLY = 'K_LONG_DONE：抓住热气最浓的那两秒就够了。'
// 一条真的很长的**助手回复**。v4 的助手文本超过面板高 60% 时折叠，尾巴上给「还有 N 行 · 展开」；
// 短回复不折。两半都得有现场：只有长回复就只证得出「会折」，只有短回复就只证得出「不折」——
// 而「永远折」和「永远不折」各能骗过其中一条。
const LONG_ASK_2 = 'K_LONG2：这段到底该留几秒？把你的理由讲全。'
const LONG_REPLY_FULL = `K_LONG2_DONE：${'先把热气最浓的那两秒单独切出来，再决定前后各留多少。'.repeat(15)}`

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

/** 计划的 compare-and-swap 守卫要用 Host 刚报出来的 revision，不能猜。 */
function revisionFromToolResult(body, toolCallId) {
  const text = toolResultText(body, toolCallId)
  const match = /"revision"\s*:\s*"([^"]+)"/.exec(text)
  if (!match) throw new Error(`read_timeline 的结果里没有 revision：${text.slice(0, 400)}`)
  return match[1]
}

const walk = await createRuntimeWalk('agent-real-user-conversation')
const settingsRoot = path.join(walk.report.tempRoot, 'settings')
const seen = []
const note = (line) => { seen.push(line); console.log(`· ${line}`) }
/**
 * 体验摩擦的**量化取证**：这些是人眼在截图里看见、再回来用 DOM 量准的数字。
 * 它们不做断言——把「现在就是坏的」写成断言等于把 bug 钉成规范；数字进 report.json，
 * 结论留给人。(R16 情绪摩擦日志的取证部分)
 */
const friction = {}
const record = (key, value) => { friction[key] = value; console.log(`⚠︎ ${key}: ${JSON.stringify(value)}`) }
// 早挂上去（而不是等 try 跑完再赋值）：断言挂掉时这些数字仍进 report.json，
// 否则最需要它们的那一次恰好什么都读不到。
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
  const hostState = () => readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  // v4 没有「工具调用组」这个折叠头：每条收据就是流里的一行（`data-v4-block="tool"`），
  // 内联在它发生的位置、不置顶、不成组（2026-09-06 定稿 ③）。想看输入/输出就点那一行本身。

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
    reply: { type: 'tool', id: READ_CALL, name: 'nomi_document_read', args: { scope: 'full' } },
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
    .toEqual(expect.arrayContaining(['nomi_document_read', 'nomi_document_edit']))
  const t1ResultWire = await recorded(t1Result.received, 'turn 1 tool-result request')
  expect(flattenRequestText(t1ResultWire.body), '工具结果里带着真实文稿').toContain('K_SEG_B')
  await expect(creation, '第一轮的回答必须出现在面板里').toContainText('K_T1_DONE')

  // 读工具在 readableToolPreview 里从前没有自己的分支，于是「读一遍文稿」这一行落回通用的
  // 「查看细节」——和一个谁也认不出的工具说的是同一句话。修复后它走 isReadOnlyToolName，
  // 说出读的诚实效果：什么都不改。
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

  // 人眼在 02 号截图里看到「K_T2_DONE：…中间 20 秒给你说的那」被硬切断，回来量准它。
  // 2026-09-06 修复后这个数组必须是**空的**：旧的 `h-5 overflow-hidden` + `whitespace-nowrap`
  // 单行夹一旦回来，短回复要么横向溢出、要么纵向被高度夹住——两个方向都在这里现形。
  // 只量 clippedPx 是不够的：只留 `h-5`、去掉 nowrap 的半吊子回退会横向干净、纵向照切。
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

  // 「没被裁」本身可能是空洞的——一行就放得下的短句当然不会被裁。所以先证明这一条**必须**换行
  // 才放得下，再断言它没被夹住，最后断言它的**结尾**真的渲染出来了（旧夹子正是从中间切断的）。
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
  // 2026-09-06 拍板①：工作方式三档（Ask / 编辑选中 / Agent）已删——范围由 composer 上的
  // 「选中」chip 决定，不再是一个模式。权限档因此是**唯一**的授权入口，这一幕验的就是它。
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
  // 用户气泡在 v4 里**不折**（V4UserBubble 只是 max-w-86% 的一段文字）——旧的
  // `data-fold-text` / `data-fold-expand` 挂点随旧面板一起删了。所以这里验的是它的现役承诺：
  // 超长消息靠换行装下，既不被夹断、也不横向撑破面板。
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

  // 长回复折到面板高 60% 并给出「还有 N 行 · 展开」；短回复不折（折了就是给一句话配一个展开钮）。
  const long2 = walk.fixture.expectText({
    label: 'a very long assistant reply still renders',
    match: (body) => flattenRequestText(body).includes('K_LONG2：'),
    reply: { type: 'text', text: LONG_REPLY_FULL },
  })
  await sendCreation(win, LONG_ASK_2)
  await recorded(long2.received, 'long reply request')
  await expect(creation).toContainText('K_LONG2_DONE')
  expect(LONG_REPLY_FULL.length, '这条回复必须真的过 360 字门槛').toBeGreaterThan(360)
  expect(T2_REPLY.length, '这条回复必须真的在 360 字门槛之下').toBeLessThanOrEqual(360)
  const longReplyBubble = creation.locator(ASSISTANT_MESSAGE).filter({ hasText: 'K_LONG2_DONE' }).last()
  const shortReplyBubble = creation.locator(ASSISTANT_MESSAGE).filter({ hasText: 'K_T2_DONE' }).last()
  const foldStateOf = async (bubble) => bubble.locator('[data-v4-markdown]').first()
    .evaluate((node) => ({ folded: node.dataset.folded ?? null, expandLabel: (node.querySelector('button')?.textContent || '').trim() }))
  const longFold = await foldStateOf(longReplyBubble)
  const shortFold = await foldStateOf(shortReplyBubble)
  record('assistantReplyFolding', { longChars: LONG_REPLY_FULL.length, longFold, shortChars: T2_REPLY.length, shortFold })
  expect(longFold.folded, '超长回复必须折起来，而不是把誊本撑爆').toBe('true')
  expect(longFold.expandLabel, '折起来的回复必须给得出「还有 N 行 · 展开」').toMatch(/还有 \d+ 行/)
  expect(shortFold.folded, '短回复不许折——那是给一句话配一个展开钮').toBe(null)
  note('长回复折到面板高 60% 并给出展开入口、短回复不折，两半都在同一个现场证过')

  // 2026-09-06 拍板③：@ 素材选择器随旧面板一起删了（技能与提示词并进 composer 的 `/` 命令菜单，
  // 附件走 [+] 那颗加号）。这一段原本验的 `data-agent-at-picker` 在 src/ 里已零调用点。

  // ── 幕四 · 生成面：safe-auto 直接写 / 不可逆要卡 / 再写仍不出卡 ─────────────────
  await openCanvas(win)
  const canvas = win.locator(CANVAS_PANEL)
  await expect(canvas, '生成面常驻 Agent 必须挂载').toBeVisible()

  const createCall = walk.fixture.expectText({
    label: 'canvas turn 1 proposes three shot nodes',
    match: (body) => flattenRequestText(body).includes('K_CANVAS1') && !hasToolResult(body, CREATE_CALL),
    reply: {
      type: 'tool', id: CREATE_CALL, name: 'nomi_canvas_edit',
      args: {
        operation: 'create_canvas_nodes',
        summary: '按脚本摆三个镜头',
        nodes: [
          { clientId: 'k-shot-1', kind: 'image', title: '招牌灯', prompt: '深夜街边招牌灯，暖光，中景' },
          { clientId: 'k-shot-2', kind: 'image', title: '舀汤', prompt: '热气糊镜头，牛骨汤舀进碗，特写' },
          { clientId: 'k-shot-3', kind: 'image', title: '多余的一个', prompt: '备用镜头，暂时用不上' },
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
    .toEqual(expect.arrayContaining(['nomi_canvas_read', 'nomi_canvas_edit']))
  const createResultWire = await recorded(createResult.received, 'canvas create tool-result request')
  expect(toolResultText(createResultWire.body, CREATE_CALL), '建节点必须真的成功，而不是回一句「不存在的工具」')
    .toContain('"applied":true')
  await expect(canvas).toContainText('K_CANVAS1_DONE')
  await expect.poll(canvasNodeIds, { message: '三个镜头节点必须真的落到画布上', timeout: 30_000 })
    .toHaveLength(3)
  const nodesAfterCreate = await canvasNodeIds()
  await walk.snap('06-canvas-three-nodes-no-card')

  // 不可逆：删节点。卡片必须出现，而且只给「这次」这一档 + 一条边界行。
  const deleteCall = walk.fixture.expectText({
    label: 'canvas turn 2 proposes an irreversible delete',
    match: (body) => flattenRequestText(body).includes('K_CANVAS2') && !hasToolResult(body, DELETE_CALL),
    reply: {
      type: 'tool', id: DELETE_CALL, name: 'nomi_canvas_maintenance',
      args: { operation: 'delete_canvas_nodes', nodeIds: [nodesAfterCreate[2]], reason: '这个镜头用不上' },
    },
  })
  const deleteResult = walk.fixture.expectText({
    label: 'canvas turn 2 receives the delete receipt after approval',
    match: (body) => hasToolResult(body, DELETE_CALL),
    reply: { type: 'text', text: DELETE_REPLY },
  })
  await sendCanvas(win, 'K_CANVAS2：把第三个多余的镜头删除。')
  const deleteRequestWire = await recorded(deleteCall.received, 'canvas delete request')
  expect(toolNames(deleteRequestWire.body), '说了「删除」才把破坏性维护工具摆上来')
    .toContain('nomi_canvas_maintenance')
  const approval = win.locator(INTERVENTION)
  const approvalProof = await proveProbe(approval, '不可逆动作会浮出介入槽审批卡')
  // v4：可逆 / 不可逆写在槽的 data-kind 上（认不出的能力 fail-closed 到不可逆）。
  await expect(approval, '删节点是不可逆动作').toHaveAttribute('data-kind', 'approval-irreversible')
  await expect(approval.locator(INTERVENTION_CONFIRM), '不可逆动作必须给「确认」（= 仅这一次）').toBeVisible()
  await expect(approval, '不可逆动作必须把授权范围写在卡面上').toContainText('范围：仅这一次')
  const onceOnlyProof = await proveProbe(approval.locator(INTERVENTION_CONFIRM), '审批卡上的「确认」按钮')
  // v4 只剩两档：「确认」（仅这一次）与「不再问 →」（这一个能力以后不再问）。
  // 旧的「本会话」那一档随 2026-09-06 收口一起删了，所以这里只断言不可逆动作**没有**「不再问」。
  await expectAbsent(approval.locator(INTERVENTION_ESCALATE),
    { provenBy: onceOnlyProof, message: '不可逆动作不该给「不再问 →」' })
  // 卡片必须自己说清「删几个」。修复前 readableToolPreview 的 delete 分支根本走不到——
  // `canvas_nodes` 是 `delete_canvas_nodes` 的子串，写分支先把它吃掉了，摘要退化成
  // 「查看细节」，和下面详情折叠的标题一字不差地在同一张卡上出现两次。
  const deleteCardText = await approval.evaluate((node) => node.textContent || '')
  // 抬头（title）和摘要（summary）是卡上唯二不用展开就读得到的两行。介入槽没给它们
  // 各自的挂点，所以按结构取：摘要是卡里第一个 <p>，抬头是它前面那个兄弟。
  // v4 的槽头是 <header>（icon + 标题 + 徽章），摘要是槽体里第一个 <p>。
  const deleteHeading = await approval.evaluate((node) => ({
    title: (node.querySelector('header')?.textContent || '').trim(),
    summary: (node.querySelector('p')?.textContent || '').trim(),
  }))
  record('deleteCardHeading', deleteHeading)
  record('deleteCardSummary', deleteCardText.slice(0, 200))
  // 修复前抬头恒是 `agentResident.approvalMode`（「执行确认」）——一句放之四海皆准的话，
  // 删镜头、写文稿、跑生成都长一样。修复后抬头 = readableToolName(工具名 + args.operation)。
  expect(deleteHeading.title, '不可逆卡的抬头必须点名这次的动作').toContain('删除镜头卡')
  expect(deleteHeading.title, '抬头不许再是那句放之四海皆准的「执行确认」').not.toBe('执行确认')
  expect(deleteCardText, '整张卡上任何一处都不该再出现通用的「执行确认」').not.toContain('执行确认')
  expect(deleteCardText.split('查看细节').length - 1,
    '「查看细节」只该是详情折叠的标题；它同时当摘要用 = 这张卡什么都没说').toBe(1)
  // 「静息态」= 详情折叠还关着，也就是人不动手时这张卡的样子。`textContent` 会把折叠**里面**的
  // 字一并算进来，所以「不展开就读得到」这件事不能拿整卡文本证，必须拆成两半：
  //   ① 折叠确实是关的、里面的 <dl> 确实不可见；
  //   ② 要证的那句话在**摘要那一行本身**的可见文本里。
  // 2026-09-06 拍板③：介入槽里的**详情折叠 / 内联提案编辑器**删掉了——槽只有「确认 / 不要 /
  // 不再问 →」，要改内容去那个对象自己的家。所以「静息态」就是整张卡：没有任何东西折在下面。
  const summaryLine = approval.locator('p').first()
  await expect(summaryLine, '摘要那一行本身必须可见').toBeVisible()
  await expect(summaryLine, '摘要必须报出这次要删几个对象').toContainText('1 个对象')
  // 这一条才是重点：模型自己给的理由从前折在 <details> 之下（还被算进匿名的「其他设置 2 项」），
  // 人要多点一下才知道为什么要删。现在它必须和数量并排落在卡面上，一眼可读。
  await expect(summaryLine, '模型给的理由必须在静息态就读得到，而不是折叠一层之下')
    .toContainText('这个镜头用不上')
  const restingSummary = (await summaryLine.innerText()).trim()
  record('deleteCardAtRest', { title: deleteHeading.title, summary: restingSummary })
  expect(deleteCardText, '整张卡上必须读得到模型自己给的理由').toContain('这个镜头用不上')
  // 还剩的一处摩擦：卡上说得出「删 1 个」和「为什么删」，仍说不出**删的是哪一个**。
  // 这里只量、不断言——把现状写成断言等于把它钉成规范。数字进 report.json，结论留给人。
  record('deleteCardIdentifiesTarget', {
    nodeId: nodesAfterCreate[2],
    mentionsNodeId: deleteCardText.includes(nodesAfterCreate[2]),
    mentionsShotTitle: deleteCardText.includes('多余的一个'),
  })
  await walk.snap('07-irreversible-once-only')

  // 参数以 chip 摊在卡面上（v4 槽体的 params），不再折在一个 <details> 之下。
  // 这张卡在删东西，不在生成东西——「生成设置」这个从生成路径继承来的标签在这里就是错的。
  expect(deleteCardText, '整张卡上任何一处都不该出现「生成设置」——这张卡不生成任何东西')
    .not.toContain('生成设置')
  record('deleteCardParams', await approval.locator('span').allInnerTexts().then((rows) => rows.join(' | ').slice(0, 200)))
  await clickOrFail(approval.locator(INTERVENTION_CONFIRM), '批准这一次删除', { noWaitAfter: true })
  const deleteWire = await recorded(deleteResult.received, 'canvas delete tool-result request')
  expect(toolResultText(deleteWire.body, DELETE_CALL), '批准后必须真的删掉，而不是被措辞盖过去')
    .toContain('"applied":true')
  await expect(canvas).toContainText('K_CANVAS2_DONE')
  await expect.poll(canvasNodeIds, { message: '批准后的删除必须真的落盘', timeout: 30_000 }).toHaveLength(2)
  await expect(canvas.locator(TOOL_RECEIPT).last(), '工具行必须叫它「删除镜头卡」，而不是一句通用的「查看细节」')
    .toContainText('删除镜头卡')
  await walk.snap('08-irreversible-applied')
  note('irreversible 只给「确认（仅这一次）」；卡片报出「1 个对象」，工具行叫它「删除镜头卡」')

  // safe-auto 的可逆本地写：不出卡，但写入必须真的发生。
  const refillCall = walk.fixture.expectText({
    label: 'canvas turn 3 writes again under safe-auto',
    match: (body) => flattenRequestText(body).includes('K_CANVAS3') && !hasToolResult(body, REFILL_CALL),
    reply: {
      type: 'tool', id: REFILL_CALL, name: 'nomi_canvas_edit',
      args: {
        operation: 'create_canvas_nodes',
        summary: '补一个收尾镜头',
        nodes: [{ clientId: 'k-shot-4', kind: 'image', title: '第一口', prompt: '她吸溜第一口，暖光特写' }],
      },
    },
  })
  const refillResult = walk.fixture.expectText({
    label: 'canvas turn 3 receives the second create receipt',
    match: (body) => hasToolResult(body, REFILL_CALL),
    reply: { type: 'text', text: REFILL_REPLY },
  })
  await sendCanvas(win, 'K_CANVAS3：再补一个「第一口」的收尾镜头。')
  await recorded(refillCall.received, 'canvas refill request')
  // 探针已在上一步证明会亮；这里在**同一个现场**断言它整整 800ms 都没亮起来。
  await expectAbsent(approval, {
    provenBy: approvalProof,
    message: 'safe-auto 下的可逆本地写不该再拦一次用户',
  })
  await recorded(refillResult.received, 'canvas refill tool-result request')
  await expect(canvas).toContainText('K_CANVAS3_DONE')
  await expect.poll(canvasNodeIds, { message: '不出卡不等于没写：这一笔必须真的落盘', timeout: 30_000 })
    .toHaveLength(3)
  await walk.snap('09-safe-auto-write-without-card')
  note('safe-auto 的 create_canvas_nodes 全程无卡，但节点确实写进去了')

  // ── 幕四·尾 · 一步没成功，必须不展开就看得见 ─────────────────────────────────────
  // 这一幕来自上一轮走查的一次真事故：我把工具名写成了 pi 目录里没有的 `create_canvas_nodes`
  // （目录上摆的是 `nomi_canvas_edit`），那一轮真的失败了——pi 抛 `Tool "..." not found`，
  // 画布一个节点都没多，而面板上什么都没变：折叠头照旧写「工具调用 · N」，助手照旧回一句
  // 「做好了」。誊本替一件没发生的事宣布了成功。这里把那次事故变成常设证据：
  // 同一个不在目录里的别名（它是注册过的 reversible_local 别名，所以不会先弹审批卡）。
  const failCall = walk.fixture.expectText({
    label: 'canvas turn 4 calls a tool that is not on the table',
    match: (body) => flattenRequestText(body).includes('K_FAIL') && !hasToolResult(body, FAIL_CALL),
    reply: {
      type: 'tool', id: FAIL_CALL, name: 'create_canvas_nodes',
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
  // v4：一行收据自己带七态，失败就地变红并在行尾写原因——不成组、不折叠、不弹窗，
  // 所以「不展开就看得见」在 v4 里是**默认**：那一行本身就是可见的失败态。
  const toolLine = canvas.locator(`${TOOL_RECEIPT}[data-status="output-error"]`)
  await expect(toolLine, '有一步失败了，那一行收据必须自己变成失败态')
    .toBeVisible({ timeout: 30_000 })
  record('failedToolItems', (hostState()?.items ?? [])
    .filter((item) => item.kind === 'tool')
    .map((item) => ({ capability: item.capability?.id ?? '?', status: item.status })))
  await expect(toolLine, '失败的那一行必须自己说「失败」，而不是安静地留在流里').toContainText('失败')
  await recorded(failFollow.received, 'post-failure request')
  await expect(canvas).toContainText('K_FAIL_DONE')
  await expect.poll(canvasNodeIds, { message: '失败的那一步不许在画布上留下半个节点', timeout: 30_000 })
    .toHaveLength(3)
  await walk.snap('09b-failed-step-visible-while-collapsed')
  note('目录外的工具调用真的失败了：工具行 data-state=failed + 收起状态下的红色「1 步没成功」徽标')

  // ── 幕五 · 队列 → 插队 → 停止 ────────────────────────────────────────────────
  const held = walk.fixture.expectText({
    label: 'a long-running turn keeps the queue busy',
    match: (body) => flattenRequestText(body).includes('K_HOLD'),
    reply: { type: 'hold' },
  })
  await sendCanvas(win, HOLD_ASK)
  await recorded(held.received, 'held turn request')
  // v4：运行中不再有「排队 / 插队 / 停止」三选一的模式钮——继续打字就是排队
  //（composer 占位文案「可继续输入，将排队发送」），插队与中断是**队列行自己的**行尾动作。
  await expect(canvas.locator(`${COMPOSER}[data-mode="running"] ${COMPOSER_SEND}[aria-label="停止"]`),
    '运行中发送键变成停止键——这时候只能靠回车排队').toBeVisible()

  const canvasInput = canvas.locator(COMPOSER_INPUT)
  const enqueue = async (text) => {
    await canvasInput.fill(text)
    await canvasInput.press('Enter')
  }
  await enqueue(QUEUE_B)
  await enqueue(QUEUE_C)
  const queue = canvas.locator(QUEUE)
  await expect(queue, '排队的两句必须出现在队列里').toBeVisible()
  await expect(canvas.locator(QUEUE_ROW), '运行中 1 条 + 排队 2 条').toHaveCount(3)

  await enqueue(INSERT_D)
  await expect(canvas.locator(QUEUE_ROW), '再排一条后共 4 条').toHaveCount(4)
  await expect(canvas.locator(`${QUEUE_ROW}[data-status="queued"]`).first().getByRole('button', { name: '删', exact: true }),
    '排队项必须带一个取消入口').toHaveCount(1)
  // 「插队」是行自己的动作：把 K_QD 那一行往前挪，直到它排在 K_QB / K_QC 前面。
  const insertedRow = canvas.locator(QUEUE_ROW).filter({ hasText: 'K_QD：' })
  for (let step = 0; step < 2; step += 1) {
    await clickOrFail(insertedRow.getByRole('button', { name: '插队', exact: true }), `把 K_QD 往前挪一位（第 ${step + 1} 次）`)
  }
  // 人眼在 10 号截图里看到队列行的状态字和按钮被面板右缘切掉，回来量准它。
  // 2026-09-06 起这是硬断言：`min-w-0` 一旦从 [data-v4-block="queue"] 或队列行上丢掉，
  // 长任务文案会把 flex 行撑过面板右缘，取消/停止键整排推出视口——看得见但点不着。
  const queueOverflow = await queue.evaluate((node) => {
    const panel = node.closest('[data-agent-panel="true"]')
    const panelRight = panel.getBoundingClientRect().right
    const controls = [...node.querySelectorAll(':scope > div[data-status] button')]
    return {
      panelRight: Math.round(panelRight),
      viewportWidth: window.innerWidth,
      queueRight: Math.round(node.getBoundingClientRect().right),
      rowButtons: controls.length,
      buttonsPastPanelEdge: controls.filter((button) => button.getBoundingClientRect().right > panelRight + 0.5).length,
    }
  })
  record('queueRowOverflow', queueOverflow)
  // 运行中那条只有「立即中断」一个；三条排队各有「插队 / 删」两个。
  expect(queueOverflow.rowButtons, '一条运行（1 个控件）+ 三条排队（各 2 个）').toBe(7)
  expect(queueOverflow.buttonsPastPanelEdge, '队列行的按钮一个都不许被推出面板右缘').toBe(0)
  expect(queueOverflow.queueRight, '队列本身不许伸出面板')
    .toBeLessThanOrEqual(queueOverflow.panelRight)
  note(`四条排队行：${queueOverflow.rowButtons} 个控件全在面板内（越界 ${queueOverflow.buttonsPastPanelEdge} 个）`)
  await walk.snap('10-queue-insert-and-fold')

  const queuedTexts = async () => {
    const state = hostState()
    const byTurn = new Map((state?.items ?? [])
      .filter((item) => item.kind === 'user')
      .map((item) => [item.turnId, item.text ?? '']))
    return (state?.queue ?? [])
      .filter((entry) => entry.status === 'queued')
      .map((entry) => /K_Q[A-Z]/.exec(byTurn.get(entry.turnId) ?? '')?.[0] ?? '?')
  }
  await expect.poll(queuedTexts, { message: '插队必须真的把它排到前面（Host 队列顺序）', timeout: 30_000 })
    .toEqual(['K_QD', 'K_QB', 'K_QC'])
  note('插队把 K_QD 排到 K_QB / K_QC 前面（Host 队列顺序为证）')

  // 排队的三句在被叫停后照常按新顺序跑完；到达顺序本身就是插队生效的第二重证据。
  const arrivals = []
  const queued = (label, marker, reply) => walk.fixture.expectText({
    label,
    match: (body) => flattenRequestText(body).includes(marker),
    reply: { type: 'text', text: reply },
  })
  const dTurn = queued('inserted turn runs first', 'K_QD：', INSERT_D_REPLY)
  const bTurn = queued('first queued turn runs second', 'K_QB：', QUEUE_B_REPLY)
  const cTurn = queued('second queued turn runs last', 'K_QC：', QUEUE_C_REPLY)
  void dTurn.received.then(() => arrivals.push('K_QD'))
  void bTurn.received.then(() => arrivals.push('K_QB'))
  void cTurn.received.then(() => arrivals.push('K_QC'))

  await clickOrFail(canvas.locator(`${QUEUE_ROW}[data-status="running"]`).getByRole('button', { name: '立即中断', exact: true }),
    '叫停正在跑的那一轮')
  held.release({ type: 'text', text: '（这一轮已被用户叫停）' })
  await recorded(dTurn.received, 'inserted turn request')
  await recorded(bTurn.received, 'first queued turn request')
  await recorded(cTurn.received, 'second queued turn request')
  expect(arrivals, '插队的那句必须第一个真的跑起来').toEqual(['K_QD', 'K_QB', 'K_QC'])
  await expect(canvas, '被叫停之后，队列里的活照常跑完').toContainText('K_QC_DONE')

  // 叫停不能把已经做完的事抹掉。
  for (const marker of ['K_T1_DONE', 'K_T3_DONE', 'K_CANVAS2_DONE', 'K_CANVAS3_DONE']) {
    await expect(canvas, `叫停后 ${marker} 必须还留在誊本里`).toContainText(marker)
  }
  await expect.poll(canvasNodeIds, { message: '叫停不该回滚已经写进画布的节点', timeout: 30_000 })
    .toHaveLength(3)
  await walk.snap('11-after-stop-transcript-intact')
  note('叫停只结束当前轮：此前的回答与已落盘的节点都还在')

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
    .toEqual(expect.arrayContaining(['read_timeline', 'apply_edit_plan', 'undo_timeline_edit']))
  const planWire = await recorded(planCall.received, 'timeline plan request')
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
  // 可逆的本地改动才有「不再问 →」；不可逆和花钱的永远逐次问（上面那张删除卡已证反面）。
  await expect(planApproval, '这是可逆的本地改动').not.toHaveAttribute('data-kind', 'approval-irreversible')
  await expect(planApproval.locator(INTERVENTION_CONFIRM), '必须给「确认」（= 仅这一次）').toBeVisible()
  await expect(planApproval.locator(INTERVENTION_ESCALATE), '可逆本地改动必须给「不再问 →」').toBeVisible()
  await expect(planApproval, '「不再问」的作用域必须写在卡面上，别让人以为是全项目放行')
    .toContainText('只对这一个操作生效')
  await expect(planApproval, '审批卡要说人话，而不是甩一段 operation JSON').toContainText(CAPTION_TEXT)
  await walk.snap('12-reversible-confirm-and-stop-asking')
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
  note('reversible_local + 计划审阅：三档齐全，批准后字幕真的落盘')

  // ── 收尾 · 已知无调用点的例外卡在真实运行时确实一次都没出现 ─────────────────────
  const transcript = win.locator('[data-agent-resident="true"]')
  const transcriptProof = await proveProbe(transcript.locator('[data-v4-block]'), '誊本里有真实条目')
  // v4 里这三件事都收进了介入槽的 kind（spend / question）与任务卡的候选缩略图。
  // 「整条真实旅程里一次都没花过钱、也没被反问过」仍然是要证的，所以断言按 kind 走。
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
  // 必须是真冷启（stopApp 会断言 exitCode/signalCode 非空），不许用 win.reload()：
  // 原地刷新之后 getActiveWorkbenchProjectId() 恒为 null、面板静默空掉，
  // 看起来和真 bug 一模一样（docs/lessons/walkthrough-no-win-reload.md）。
  const nodesBeforeRestart = await canvasNodeIds()
  const threadsBeforeRestart = (hostState()?.threads ?? []).map((thread) => thread.threadId)
  expect(threadsBeforeRestart, '重启前这个项目只有一条对话').toHaveLength(1)
  const requestsBeforeRestart = walk.fixture.requests.length

  await walk.stopApp()
  ;({ win } = await walk.start())
  expect(walk.report.launches[1].pid, '这必须是第二个真进程，不是同一个页面刷新')
    .not.toBe(walk.report.launches[0].pid)

  // 回项目走用户真实入口：项目库卡片上的「继续创作」。
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

  // ① 画布：节点数（和 id）必须和重启前一模一样，UI 与落盘两头都看。
  await expect(win.locator('.generation-canvas-v2__stage'), '继续创作直接落在生成区')
    .toBeVisible({ timeout: 30_000 })
  await expect(win.locator('.react-flow__node'), '重启后画布上的镜头节点数必须和重启前一样')
    .toHaveCount(nodesBeforeRestart.length)
  expect(await canvasNodeIds(), '落盘的节点 id 也要逐个对上').toEqual(nodesBeforeRestart)

  // ② 誊本：重启前的用户原话和助手回复必须还在同一条对话里。
  await clickOrFail(win.getByRole('button', { name: '创作', exact: true }), '重启后进入创作工作区')
  const creationAfter = win.locator(CREATION_PANEL)
  await expect(creationAfter, '重启后创作面常驻 Agent 必须挂载').toBeVisible({ timeout: 30_000 })
  for (const marker of [T1, T1_REPLY, T2_REPLY, T3_REPLY, LONG_ASK_2,
    'K_LONG2_DONE', 'K_CANVAS1_DONE', 'K_CANVAS2_DONE', 'K_QC_DONE', 'K_TL_DONE']) {
    await expect(creationAfter, `重启后「${marker.slice(0, 12)}」必须还在誊本里`).toContainText(marker)
  }

  // ③ 这条对话在会话列表里还**选得回来**——不是「还看得见」。点它，誊本仍是这一条。
  await clickOrFail(creationAfter.locator(HISTORY_BUTTON), '重启后打开会话列表')
  const threadRows = win.locator(`${THREAD_MENU} > div`)
  await expect(threadRows, '表头 + 唯一那条幸存对话').toHaveCount(2)
  await clickOrFail(threadRows.nth(1).getByRole('button').first(), '重启后选回原来那条对话')
  await expect(creationAfter, '选回来之后誊本仍是那一条').toContainText('K_T3_DONE')

  // ④ 时间轴字幕：落盘的和画在轨道上的都要在。
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
  await newConversation(win, CREATION_PANEL)
  await expect.poll(() => (hostState()?.threads ?? []).length,
    { message: '新建之后必须有两条对话', timeout: 30_000 }).toBe(2)
  const newThreadId = hostState()?.activeThreadId
  expect(newThreadId, '新建的那条要成为当前对话').not.toBe(oldThreadId)
  await expect(creationAfter, '切到新对话后誊本是空的').not.toContainText('K_T3_DONE')

  // ① 删「不是当前这条」的那条——它带着这一整条旅程的全部 turn。
  //    修复前这一删会让下一次冷启动整体验签失败：历史 patch 里仍指着这条已删线程，
  //    快照与备份双双读不出来，Host 抛 ProjectAgentRepositoryIntegrityError。
  await clickOrFail(creationAfter.locator(HISTORY_BUTTON), '打开会话列表准备删旧对话')
  await expect(threadRows, '表头 + 两条对话').toHaveCount(3)
  const threadOrder = (hostState()?.threads ?? []).map((thread) => thread.threadId)
  const oldRowIndex = threadOrder.indexOf(oldThreadId)
  expect(oldRowIndex, '旧对话必须还在 Host 的列表里').toBeGreaterThanOrEqual(0)
  await clickOrFail(threadRows.nth(oldRowIndex + 1).getByRole('button', { name: '删除对话' }), '删掉那条旧对话')
  await expect.poll(() => (hostState()?.threads ?? []).map((thread) => thread.threadId),
    { message: '旧对话必须真的从 Host 里消失', timeout: 30_000 }).toEqual([newThreadId])

  // ② 删「就是我正待着的这条」。修复前 Host 直接拒绝（删掉 activeThreadId 会让它悬空），
  //    而渲染层用一个光秃秃的 void 把拒绝丢掉了——按钮按下去，什么都不会发生，也不报错。
  await expect(threadRows, '现在只剩表头 + 一条对话').toHaveCount(2)
  await clickOrFail(threadRows.nth(1).getByRole('button', { name: '删除对话' }), '删掉我正待着的这条对话')
  await expect.poll(() => {
    const state = hostState()
    const threads = state?.threads ?? []
    return { stillThere: threads.some((thread) => thread.threadId === newThreadId), count: threads.length }
  }, { message: '删当前对话不许是个静默空操作', timeout: 30_000 }).toEqual({ stillThere: false, count: 1 })
  const survivingThreadId = hostState()?.activeThreadId
  expect(survivingThreadId, '删完当前对话后要落到一条新的空对话上').not.toBe(newThreadId)
  expect(survivingThreadId, '删完当前对话后要落到一条新的空对话上').not.toBe(oldThreadId)
  await walk.snap('15-threads-deleted')
  note('删非当前对话 + 删当前对话都真的生效（Host 线程表为证）')

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

  // Host 自己的快照文件仍读得出来，而且只剩那条幸存对话。修复前这一步拿不到任何东西。
  const snapshotAfterDelete = hostState()
  expect(snapshotAfterDelete, '删过带 turn 的对话之后，Host 快照仍必须读得出来').toBeTruthy()
  expect((snapshotAfterDelete.threads ?? []).map((thread) => thread.threadId), '快照里只剩那条幸存对话')
    .toEqual([survivingThreadId])
  // 防空洞通过：这次冷启动之所以危险，是因为快照的历史命令里**确实**还留着指向已删线程的 patch
  // （修复前正是它让整份快照验签失败）。先量出现场真的成立，再断言 Host 照样打得开——
  // 少了这一步，「打得开」可能只是因为根本没进入危险状态。
  const liveThreadIds = new Set((snapshotAfterDelete.threads ?? []).map((thread) => thread.threadId))
  const danglingThreadRefs = new Set()
  const scanThreadRefs = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(scanThreadRefs); return }
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'threadId' && typeof nested === 'string' && !liveThreadIds.has(nested)) danglingThreadRefs.add(nested)
      scanThreadRefs(nested)
    }
  }
  scanThreadRefs(snapshotAfterDelete.recentAppliedCommands ?? [])
  record('historyPatchesNamingDeletedThreads', {
    deletedThreadsStillNamedInHistory: [...danglingThreadRefs],
    recentAppliedCommands: (snapshotAfterDelete.recentAppliedCommands ?? []).length,
  })
  expect(danglingThreadRefs.size,
    '这条断言的现场必须真的成立：历史里得还留着指向已删线程的 patch，否则「打得开」证不了任何事')
    .toBeGreaterThan(0)
  // 「没有报错条」这件事这里不写成 expectAbsent：我造不出一个能证明 role=alert 真的会亮的基线，
  // 没基线的「没看到」是空话。改用更强的正面证据——面板列得出线程、而且还能真的跑一轮，
  // 历史打不开的话这两条都过不去。报错条的数量只记录，不断言。
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
  await recorded(afterDelete.received, 'post-deletion request')
  await expect(creationFinal, '删完对话冷启之后，新的一轮照样跑得通').toContainText('K_AFTER_DONE')
  await walk.snap('16-history-opens-after-thread-deletion')
  note('删掉带 turn 的对话后再冷启：快照读得出、面板起得来、新的一轮跑得通')

  walk.fixture.assertClean()
  walk.report.verified = seen
  walk.report.friction = friction
} catch (error) {
  failure = error
} finally {
  await walk.finish(failure)
}
